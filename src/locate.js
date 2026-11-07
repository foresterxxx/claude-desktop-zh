'use strict';

// 定位 Claude Desktop 安装目录。
// 返回统一结构：
//   { platform, appDir, resourcesDir, exePath?, plistPath?, frameworkPath?, bundlePath?, version, kind }

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// 从 app.asar 内的 package.json 读取版本号（复制出来的目录、自定义目录无法从路径推断版本）
function versionFromAsar(resourcesDir) {
  try {
    const asar = require('./asar');
    const arc = asar.readArchive(path.join(resourcesDir, 'app.asar'));
    return JSON.parse(asar.readEntry(arc, 'package.json').toString('utf8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

// ---------- Windows ----------

function windowsFromAppDir(appDir, kind = 'custom', version) {
  const exe = ['claude.exe', 'Claude.exe'].map((n) => path.join(appDir, n)).find(exists);
  const resourcesDir = path.join(appDir, 'resources');
  if (!exe || !exists(path.join(resourcesDir, 'app.asar'))) return null;
  if (!version) {
    const m = /_(\d+(?:\.\d+)+)_/.exec(appDir) || /app-(\d+(?:\.\d+)+)/.exec(appDir);
    version = m ? m[1] : versionFromAsar(resourcesDir);
  }
  return { platform: 'win32', kind, appDir, resourcesDir, exePath: exe, version };
}

function findWindowsMsix() {
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-AppxPackage | Where-Object { $_.Name -match '(^|\\.)Claude$' } | ForEach-Object { $_.Name + '|' + $_.Version + '|' + $_.InstallLocation }",
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [name, version, loc] = l.split('|');
        return { name, version, loc };
      })
      .filter((p) => p.loc)
      .sort((a, b) => compareVersions(b.version, a.version))
      .map((p) => windowsFromAppDir(path.join(p.loc, 'app'), 'msix', p.version))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function findWindowsSquirrel() {
  const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'AnthropicClaude');
  if (!exists(root)) return [];
  return fs
    .readdirSync(root)
    .filter((n) => /^app-\d/.test(n))
    .sort((a, b) => compareVersions(b.slice(4), a.slice(4)))
    .map((n) => windowsFromAppDir(path.join(root, n), 'squirrel', n.slice(4)))
    .filter(Boolean);
}

// ---------- macOS ----------

function macFromBundle(bundlePath) {
  const contents = path.join(bundlePath, 'Contents');
  const resourcesDir = path.join(contents, 'Resources');
  const plistPath = path.join(contents, 'Info.plist');
  if (!exists(path.join(resourcesDir, 'app.asar')) || !exists(plistPath)) return null;
  let version = versionFromAsar(resourcesDir);
  try {
    version = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plistPath], {
      encoding: 'utf8',
    }).trim();
  } catch {
    /* ignore */
  }
  return {
    platform: 'darwin',
    kind: 'app',
    bundlePath,
    appDir: contents,
    resourcesDir,
    plistPath,
    frameworkPath: path.join(contents, 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Electron Framework'),
    version,
  };
}

// ---------- 入口 ----------

function locate(customDir) {
  if (customDir) {
    const dir = path.resolve(customDir);
    const found =
      (dir.endsWith('.app') && macFromBundle(dir)) ||
      windowsFromAppDir(dir) ||
      windowsFromAppDir(path.join(dir, 'app')) ||
      (exists(path.join(dir, 'app.asar')) && {
        platform: process.platform,
        kind: 'custom',
        appDir: path.dirname(dir),
        resourcesDir: dir,
        version: versionFromAsar(dir),
      });
    if (!found) throw new Error(`在 ${dir} 下没有找到 Claude Desktop（需要包含 resources/app.asar）。`);
    return found;
  }
  if (process.platform === 'win32') {
    const all = [...findWindowsMsix(), ...findWindowsSquirrel()];
    if (all.length === 0) throw new Error('没有找到 Claude Desktop 安装。可以使用 --app-dir 手动指定安装目录。');
    return all[0];
  }
  if (process.platform === 'darwin') {
    const candidates = ['/Applications/Claude.app', path.join(os.homedir(), 'Applications', 'Claude.app')];
    for (const c of candidates) {
      const r = macFromBundle(c);
      if (r) return r;
    }
    throw new Error('没有找到 /Applications/Claude.app。可以使用 --app-dir 手动指定。');
  }
  throw new Error('当前平台没有官方 Claude Desktop；如使用社区打包版本，请用 --app-dir 指定 resources 目录。');
}

// 通过 sudo 运行时，配置与数据应写到实际用户目录而不是 /var/root
function userHome() {
  const sudoUser = process.env.SUDO_USER;
  if (sudoUser && process.platform !== 'win32') {
    const base = process.platform === 'darwin' ? '/Users' : '/home';
    if (exists(path.join(base, sudoUser))) return path.join(base, sudoUser);
  }
  return os.homedir();
}

// Claude 用户配置文件（config.json）可能的位置
function configPaths() {
  const home = userHome();
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    // Claude-3p 为第三方 API 模式（Bedrock / Vertex / 网关）使用的独立数据目录
    const list = [path.join(roaming, 'Claude', 'config.json'), path.join(local, 'Claude-3p', 'config.json')];
    const pkgRoot = path.join(local, 'Packages');
    if (exists(pkgRoot)) {
      for (const n of fs.readdirSync(pkgRoot)) {
        if (/^(AnthropicPBC\.)?Claude_/i.test(n)) list.push(path.join(pkgRoot, n, 'LocalCache', 'Roaming', 'Claude', 'config.json'));
      }
    }
    return list;
  }
  if (process.platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support');
    return [path.join(base, 'Claude', 'config.json'), path.join(base, 'Claude-3p', 'config.json')];
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [path.join(base, 'Claude', 'config.json'), path.join(base, 'Claude-3p', 'config.json')];
}

function dataDir() {
  if (process.env.CLAUDE_ZH_HOME) return path.resolve(process.env.CLAUDE_ZH_HOME);
  const home = userHome();
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'claude-desktop-zh');
  }
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'claude-desktop-zh');
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'claude-desktop-zh');
}

module.exports = { locate, configPaths, dataDir, userHome, compareVersions, exists };
