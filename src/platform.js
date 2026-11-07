'use strict';

// 平台相关操作：进程检测、Windows 文件权限、macOS 重签名。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// ---------- 进程 ----------

// Windows 上按可执行文件完整路径匹配，避免误判其他位置的 Claude 实例
function windowsPids(target) {
  const exe = path.basename(target.exePath || 'claude.exe', '.exe');
  const r = run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Get-Process -Name '${exe}' -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)|$($_.Path)" }`,
  ]);
  const want = path.resolve(target.exePath || '').toLowerCase();
  return r.stdout
    .split(/\r?\n/)
    .map((l) => l.trim().split('|'))
    .filter(([pid, p]) => pid && (!p || !target.exePath || path.resolve(p).toLowerCase() === want))
    .map(([pid]) => pid);
}

function isClaudeRunning(target) {
  if (process.platform === 'win32') return windowsPids(target).length > 0;
  if (process.platform === 'darwin') {
    return run('pgrep', ['-f', path.join(target.bundlePath || '/Applications/Claude.app', 'Contents/MacOS/')]).code === 0;
  }
  return false;
}

function killClaude(target) {
  if (process.platform === 'win32') {
    for (const pid of windowsPids(target)) run('taskkill', ['/F', '/T', '/PID', pid]);
  } else if (process.platform === 'darwin') {
    run('osascript', ['-e', 'quit app "Claude"']);
    run('pkill', ['-f', path.join(target.bundlePath || '/Applications/Claude.app', 'Contents/MacOS/')]);
  }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && isClaudeRunning(target)) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  return !isClaudeRunning(target);
}

// ---------- Windows 权限 ----------

const ADMINISTRATORS_SID = '*S-1-5-32-544';

function isWindowsAdmin() {
  if (process.platform !== 'win32') return false;
  return run('net', ['session']).code === 0;
}

function canWrite(file) {
  try {
    const fd = fs.openSync(file, 'r+');
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

// 仅针对需要改写的单个文件接管所有权并授予管理员写权限，不动整个目录。
function grantWrite(file) {
  if (canWrite(file)) return { changed: false };
  if (process.platform !== 'win32') throw new Error(`没有写权限：${file}（请使用 sudo 运行）`);
  const t = run('takeown', ['/F', file, '/A']);
  if (t.code !== 0) throw new Error(`接管文件所有权失败：${file}\n${t.stdout}${t.stderr}`);
  const g = run('icacls', [file, '/grant', `${ADMINISTRATORS_SID}:F`]);
  if (g.code !== 0) throw new Error(`授予写权限失败：${file}\n${g.stdout}${g.stderr}`);
  if (!canWrite(file)) throw new Error(`仍然无法写入：${file}。请确认以管理员身份运行，且没有安全软件拦截。`);
  return { changed: true };
}

// 恢复时把所有权还给 TrustedInstaller 并移除额外授予的权限（尽力而为）。
function revokeWrite(file) {
  if (process.platform !== 'win32') return;
  run('icacls', [file, '/remove:g', ADMINISTRATORS_SID]);
  run('icacls', [file, '/setowner', 'NT SERVICE\\TrustedInstaller']);
}

// ---------- macOS ----------

function plistToXml(plistPath) {
  return execFileSync('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', plistPath], { encoding: 'utf8' });
}

function writePlistXml(plistPath, xml) {
  const tmp = path.join(os.tmpdir(), `claude-zh-${process.pid}-Info.plist`);
  fs.writeFileSync(tmp, xml, 'utf8');
  execFileSync('/usr/bin/plutil', ['-convert', 'binary1', '-o', plistPath, tmp]);
  fs.rmSync(tmp, { force: true });
}

function bundleIdentifier(plistPath) {
  const r = run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plistPath]);
  return r.code === 0 ? r.stdout.trim() : null;
}

function adjustEntitlements(xml) {
  if (!xml || !xml.includes('<dict>')) return null;
  let out = xml;
  for (const key of ['com.apple.application-identifier', 'com.apple.developer.team-identifier', 'keychain-access-groups']) {
    const k = key.replace(/\./g, '\\.');
    out = out.replace(new RegExp(`\\s*<key>${k}</key>\\s*(<string>[^<]*</string>|<array>[\\s\\S]*?</array>)`, 'g'), '');
  }
  if (!out.includes('com.apple.security.cs.disable-library-validation')) {
    out = out.replace('<dict>', '<dict>\n\t<key>com.apple.security.cs.disable-library-validation</key>\n\t<true/>');
  }
  return out;
}

function signOne(target, tmpDir, designated) {
  const ent = run('codesign', ['-d', '--entitlements', ':-', target]).stdout;
  const adjusted = adjustEntitlements(ent);
  const args = ['--force', '--sign', '-', '--timestamp=none', '--options', 'runtime', '--preserve-metadata=identifier,flags'];
  if (adjusted) {
    const f = path.join(tmpDir, `${Math.random().toString(36).slice(2)}.plist`);
    fs.writeFileSync(f, adjusted);
    args.push('--entitlements', f);
  }
  if (designated) args.push('-r', `=designated => ${designated}`);
  args.push(target);
  const r = run('codesign', args);
  if (r.code !== 0) throw new Error(`重签名失败：${target}\n${r.stderr}`);
}

function isMachO(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(4);
    fs.readSync(fd, b, 0, 4, 0);
    fs.closeSync(fd);
    const m = b.readUInt32BE(0);
    return [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(m);
  } catch {
    return false;
  }
}

// 本机 ad-hoc 重签名：先签内部 Mach-O，再签嵌套 bundle，最后签外层 app。
// 外层使用 identifier 级别的 designated requirement，使官方自动更新仍可安装。
function resignMacApp(bundlePath, plistPath, log = () => {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-zh-ent-'));
  const files = [];
  const bundles = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (/\.(app|framework)$/.test(ent.name)) bundles.push(p);
        walk(p);
      } else if (ent.isFile() && (/\.(dylib|node|so)$/.test(ent.name) || isMachO(p))) {
        files.push(p);
      }
    }
  };
  walk(path.join(bundlePath, 'Contents'));
  const depth = (p) => p.split(path.sep).length;
  files.sort((a, b) => depth(b) - depth(a));
  bundles.sort((a, b) => depth(b) - depth(a));
  log(`  重签名 ${files.length} 个二进制文件、${bundles.length + 1} 个 bundle（可能需要 1~3 分钟）`);
  for (const f of files) signOne(f, tmpDir);
  for (const b of bundles) signOne(b, tmpDir);
  const id = bundleIdentifier(plistPath);
  signOne(bundlePath, tmpDir, id ? `identifier "${id}"` : null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  run('xattr', ['-dr', 'com.apple.quarantine', bundlePath]);
}

module.exports = {
  run,
  isClaudeRunning,
  killClaude,
  isWindowsAdmin,
  canWrite,
  grantWrite,
  revokeWrite,
  plistToXml,
  writePlistXml,
  resignMacApp,
  adjustEntitlements,
};
