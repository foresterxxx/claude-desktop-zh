'use strict';

// 安装 / 恢复 / 状态 的核心流程。
//
// 原则：
// - 永远基于“原版文件”打补丁：首次安装时备份原版，之后重复安装都从备份重新生成，
//   保证幂等、可切换语言、可随时恢复。
// - 先在工作目录生成全部新文件并校验，确认无误后才写入安装目录；写入失败自动回滚。

const fs = require('fs');
const path = require('path');
const asar = require('./asar');
const integrity = require('./integrity');
const locales = require('./locales');
const frontend = require('./frontend');
const platform = require('./platform');
const { locate, configPaths, dataDir, exists } = require('./locate');

const ASARS = ['app.asar', 'ion-dist.asar'];

function sha256File(file) {
  const crypto = require('crypto');
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(8 * 1024 * 1024);
  try {
    let n;
    let pos = 0;
    while ((n = fs.readSync(fd, buf, 0, buf.length, pos)) > 0) {
      h.update(buf.subarray(0, n));
      pos += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

// ---------- 状态与备份 ----------

function statePath() {
  return path.join(dataDir(), 'state.json');
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return null;
  }
}

function saveState(state) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8');
}

// 需要备份/改写的文件（相对于 appDir）
function managedFiles(target) {
  const rel = (p) => path.relative(target.appDir, p);
  const list = ASARS.map((n) => path.join(target.resourcesDir, n)).filter(exists);
  if (target.exePath) list.push(target.exePath);
  return list.map(rel);
}

function backupDirFor(target) {
  const safe = `${target.version}-${target.kind}`.replace(/[^\w.-]/g, '_');
  return path.join(dataDir(), 'backups', safe);
}

// 判断安装目录中的文件是否为原版：不含任何中文补丁痕迹。
function detectForeignPatch(target) {
  const ion = path.join(target.resourcesDir, 'ion-dist.asar');
  if (!exists(ion)) return null;
  const arc = asar.readArchive(ion);
  for (const lang of frontend.MANAGED_LANGS) {
    if (asar.getNode(arc.header, `i18n/${lang}.json`)) return `ion-dist.asar 中已存在 i18n/${lang}.json`;
  }
  return null;
}

function ensureBackup(target, log, { force = false } = {}) {
  const state = loadState();
  const dir = backupDirFor(target);
  const files = managedFiles(target);

  if (state && state.appDir === target.appDir && state.version === target.version && state.backupDir === dir) {
    const allPresent = files.every((f) => exists(path.join(dir, f)));
    if (allPresent) {
      // 校验当前文件要么是原版，要么是我们上次写入的版本；否则说明被第三方改过或客户端已原地更新。
      const unknown = files.filter((f) => {
        const cur = sha256File(path.join(target.appDir, f));
        const rec = state.files && state.files[f];
        return !rec || (cur !== rec.original && cur !== rec.patched);
      });
      if (unknown.length === 0) return { dir, state, reused: true };
      log(`  [提示] 检测到以下文件与记录不一致，将重新备份：${unknown.join(', ')}`);
    }
  }

  if (process.platform === 'darwin' && target.bundlePath) {
    // macOS 需要整包备份：重签名会改动包内所有二进制的签名。
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }

  const foreign = detectForeignPatch(target);
  if (foreign && !force) {
    throw new Error(
      `${foreign}，看起来已经安装过其他汉化补丁。\n` +
        '请先用原补丁的“恢复”功能还原，或重新安装官方 Claude Desktop 后再试；确认要继续请加 --force。',
    );
  }

  if (state && state.backupDir && state.backupDir !== dir && exists(state.backupDir)) {
    // 客户端已更新：旧版本的备份不再适用
    fs.rmSync(state.backupDir, { recursive: true, force: true });
    log(`  已清理旧版本 ${state.version} 的备份`);
  }

  log(`  备份原版文件到 ${dir}`);
  fs.mkdirSync(dir, { recursive: true });
  const record = {};
  for (const f of files) {
    const src = path.join(target.appDir, f);
    const dst = path.join(dir, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    record[f] = { original: sha256File(dst) };
  }
  if (process.platform === 'darwin' && target.bundlePath) {
    const full = path.join(dir, 'Claude.app');
    const r = platform.run('/usr/bin/ditto', [target.bundlePath, full]);
    if (r.code !== 0) throw new Error(`整包备份失败：${r.stderr}`);
  }
  const fresh = {
    tool: 'claude-desktop-zh',
    appDir: target.appDir,
    version: target.version,
    kind: target.kind,
    backupDir: dir,
    files: record,
    patched: false,
  };
  saveState(fresh);
  return { dir, state: fresh, reused: false };
}

// ---------- 生成补丁文件 ----------

function readJsonEntry(arc, p) {
  return JSON.parse(asar.readEntry(arc, p).toString('utf8').trimStart());
}

function buildIonDist(src, pack, opts, log) {
  const arc = asar.readArchive(src);
  const changes = new Map();
  const stats = { translated: 0, total: 0, jsFiles: 0, whitelist: 0, hardcoded: 0 };

  const en = readJsonEntry(arc, 'i18n/en-US.json');
  const merged = locales.mergeMessages(en, pack.frontend);
  stats.translated = merged.translated;
  stats.total = merged.total;
  const buf = locales.toJsonBuffer(merged.messages);
  changes.set(`i18n/${pack.lang}.json`, buf);
  if (opts.override) changes.set('i18n/en-US.json', buf);

  if (asar.getNode(arc.header, 'i18n/dynamic/en-US.json')) {
    const dyn = locales.mergeMessages(readJsonEntry(arc, 'i18n/dynamic/en-US.json'), pack.dynamic);
    const dbuf = locales.toJsonBuffer(dyn.messages);
    changes.set(`i18n/dynamic/${pack.lang}.json`, dbuf);
    if (opts.override) changes.set('i18n/dynamic/en-US.json', dbuf);
  }

  const rules = opts.hardcoded ? frontend.compileHardcodedRules(pack.hardcoded) : null;
  for (const p of asar.listFiles(arc)) {
    if (!p.startsWith('assets/') || !p.endsWith('.js')) continue;
    const node = asar.getNode(arc.header, p);
    if (node.unpacked) continue;
    const original = asar.readEntry(arc, p).toString('utf8');
    let text = original;
    if (text.includes(frontend.WHITELIST_ANCHOR)) {
      const r = frontend.patchWhitelist(text, pack.lang);
      text = r.text;
      stats.whitelist += r.found;
    }
    text = frontend.patchDisplayNames(text).text;
    if (rules) {
      const r = frontend.patchHardcoded(text, rules);
      text = r.text;
      stats.hardcoded += r.count;
    }
    if (text !== original) {
      changes.set(p, Buffer.from(text, 'utf8'));
      stats.jsFiles++;
    }
  }
  if (stats.whitelist === 0) {
    throw new Error('前端 bundle 中没有找到语言白名单，Claude 前端格式可能已经变化，请到项目 Issues 反馈版本号。');
  }
  log(
    `  ion-dist.asar：前端词条 ${stats.translated}/${stats.total} 已翻译，改写 JS ${stats.jsFiles} 个` +
      `（语言白名单 ${stats.whitelist} 处${rules ? `，硬编码文案 ${stats.hardcoded} 处` : ''}）`,
  );
  return { arc, changes, stats };
}

function buildAppAsar(src, pack, opts, log) {
  const arc = asar.readArchive(src);
  const changes = new Map();
  const base = 'resources/i18n/en-US.json';
  if (!asar.getNode(arc.header, base)) {
    log('  [提示] app.asar 中没有桌面壳层词库，跳过主进程汉化。');
    return { arc, changes, stats: {} };
  }
  const en = readJsonEntry(arc, base);
  const nativePath = `resources/i18n/${pack.nativeShell}.json`;
  const native = asar.getNode(arc.header, nativePath) ? readJsonEntry(arc, nativePath) : {};
  // 优先级：本项目词库 > 官方自带的 zh-Hans/zh-Hant > 英文
  const merged = locales.mergeMessages(en, native, pack.desktop);
  const buf = locales.toJsonBuffer(merged.messages);
  changes.set(`resources/i18n/${pack.lang}.json`, buf);
  if (opts.override) changes.set(base, buf);
  log(`  app.asar：桌面壳层词条 ${merged.translated}/${merged.total} 已翻译`);
  return { arc, changes, stats: { translated: merged.translated, total: merged.total } };
}

function buildOutputs(target, sourceDir, pack, opts, log) {
  const work = path.join(dataDir(), 'work');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const outputs = {};
  const srcOf = (name) => path.join(sourceDir, path.relative(target.appDir, path.join(target.resourcesDir, name)));

  for (const name of ASARS) {
    const src = srcOf(name);
    if (!exists(src)) continue;
    const built = name === 'ion-dist.asar' ? buildIonDist(src, pack, opts, log) : buildAppAsar(src, pack, opts, log);
    if (built.changes.size === 0) continue;
    const out = path.join(work, name);
    const { hash } = asar.writeArchive(built.arc, out, built.changes);
    const check = asar.verifyArchive(out);
    if (check.hash !== hash) throw new Error(`生成的 ${name} 校验失败`);
    const written = asar.readArchive(out);
    for (const p of built.changes.keys()) {
      const node = asar.getNode(written.header, p);
      if (node.integrity && asar.sha256(asar.readEntry(written, p)) !== node.integrity.hash) {
        throw new Error(`生成的 ${name} 中 ${p} integrity 不一致`);
      }
    }
    outputs[name] = { file: out, hash };
  }
  if (!outputs['ion-dist.asar']) {
    throw new Error('没有找到 resources/ion-dist.asar。本工具支持 Claude Desktop 4.29 及以上版本。');
  }
  return { work, outputs };
}

// ---------- 写入 ----------

function setUserLocale(lang, log) {
  for (const file of configPaths()) {
    if (!exists(path.dirname(file))) continue;
    let cfg = {};
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      if (exists(file)) continue; // 无法解析时不覆盖用户配置
    }
    if (cfg.locale === lang) continue;
    cfg.locale = lang;
    fs.writeFileSync(file, JSON.stringify(cfg, null, '\t'), 'utf8');
    log(`  已将 ${file} 的 locale 设置为 ${lang}`);
  }
}

function applyWindows(target, outputs, log) {
  const files = [...Object.keys(outputs).map((n) => path.join(target.resourcesDir, n)), target.exePath];
  for (const f of files) {
    if (platform.grantWrite(f).changed) log(`  已获取写权限：${path.basename(f)}`);
  }
  // 先做只读预检：确认 exe 中能找到所有完整性标记，避免出现“asar 已改、哈希没写回”的半坏状态。
  const found = integrity.readExeHashes(target.exePath, Object.keys(outputs));
  for (const n of Object.keys(outputs)) {
    if (!found[n]) throw new Error(`Claude.exe 中找不到 ${n} 的完整性标记，客户端格式可能已变化。`);
  }
  for (const [name, o] of Object.entries(outputs)) {
    fs.copyFileSync(o.file, path.join(target.resourcesDir, name));
    log(`  已写入 ${name}`);
  }
  const hashes = Object.fromEntries(Object.entries(outputs).map(([n, o]) => [n, o.hash]));
  const updates = integrity.writeExeHashes(target.exePath, hashes);
  for (const u of updates) log(`  已更新 ${path.basename(target.exePath)} 中 ${u.name} 的完整性哈希`);
}

function applyMac(target, outputs, log) {
  for (const [name, o] of Object.entries(outputs)) {
    fs.copyFileSync(o.file, path.join(target.resourcesDir, name));
    log(`  已写入 ${name}`);
  }
  const xml = platform.plistToXml(target.plistPath);
  const hashes = Object.fromEntries(Object.entries(outputs).map(([n, o]) => [n, o.hash]));
  const { text, changed } = integrity.updatePlistIntegrity(xml, hashes);
  if (changed.length) {
    platform.writePlistXml(target.plistPath, text);
    log(`  已更新 Info.plist 中 ${changed.join(', ')} 的完整性哈希`);
    const dict = integrity.parsePlistIntegrity(text);
    const slots = integrity.syncFrameworkDigest(target.frameworkPath, dict);
    if (slots) log(`  已同步 Electron Framework 完整性摘要（${slots} 处）`);
  }
  platform.resignMacApp(target.bundlePath, target.plistPath, log);
}

function restoreFiles(target, state, log) {
  if (process.platform === 'darwin' && target.bundlePath && exists(path.join(state.backupDir, 'Claude.app'))) {
    fs.rmSync(target.bundlePath, { recursive: true, force: true });
    const r = platform.run('/usr/bin/ditto', [path.join(state.backupDir, 'Claude.app'), target.bundlePath]);
    if (r.code !== 0) throw new Error(`恢复失败：${r.stderr}`);
    log(`  已从整包备份恢复 ${target.bundlePath}`);
    return;
  }
  for (const f of Object.keys(state.files)) {
    const src = path.join(state.backupDir, f);
    const dst = path.join(target.appDir, f);
    if (!exists(src)) throw new Error(`备份文件缺失：${src}`);
    platform.grantWrite(dst);
    fs.copyFileSync(src, dst);
    platform.revokeWrite(dst);
    log(`  已恢复 ${f}`);
  }
}

// ---------- 对外命令 ----------

function prepare(opts, log) {
  const target = locate(opts.appDir);
  log(`Claude Desktop ${target.version}（${target.kind}）：${target.appDir}`);
  if (!opts.dryRun && platform.isClaudeRunning(target)) {
    if (!opts.kill) throw new Error('Claude Desktop 正在运行，请先完全退出（包括托盘图标）后重试，或加 --kill 自动关闭。');
    log('  正在关闭 Claude Desktop…');
    if (!platform.killClaude(target)) throw new Error('无法关闭 Claude Desktop，请手动退出后重试。');
  }
  return target;
}

function install(opts, log = console.log) {
  const pack = locales.loadPack(opts.lang || 'zh-CN');
  const target = prepare(opts, log);

  log('[1/4] 备份原版文件');
  const sourceDir = opts.dryRun && !exists(statePath()) ? target.appDir : ensureBackup(target, log, opts).dir;

  log(`[2/4] 生成${pack.label}补丁`);
  const { work, outputs } = buildOutputs(target, sourceDir, pack, opts, log);
  if (opts.dryRun) {
    log(`[dry-run] 补丁文件已生成到 ${work}，未修改安装目录。`);
    return { target, outputs, dryRun: true };
  }

  log('[3/4] 写入安装目录');
  const state = loadState();
  try {
    if (target.platform === 'darwin') applyMac(target, outputs, log);
    else applyWindows(target, outputs, log);
  } catch (err) {
    log(`  写入失败，正在回滚：${err.message}`);
    try {
      restoreFiles(target, state, log);
    } catch (e2) {
      log(`  [严重] 回滚失败：${e2.message}。备份位于 ${state.backupDir}`);
    }
    throw err;
  }

  log('[4/4] 设置界面语言');
  if (opts.setLocale !== false) setUserLocale(pack.lang, log);
  else log('  已跳过（--no-locale）');
  for (const f of Object.keys(state.files)) {
    const p = path.join(target.appDir, f);
    if (exists(p)) state.files[f].patched = sha256File(p);
  }
  Object.assign(state, {
    patched: true,
    lang: pack.lang,
    options: { override: !!opts.override, hardcoded: !!opts.hardcoded },
    patchedAt: new Date().toISOString(),
  });
  saveState(state);
  fs.rmSync(work, { recursive: true, force: true });
  log(`完成！请重新打开 Claude Desktop。若界面仍为英文，可在左下角账号菜单 → Language 中选择“${pack.label}”。`);
  return { target, outputs };
}

function restore(opts, log = console.log) {
  const state = loadState();
  if (!state || !state.patched) throw new Error('没有找到本工具的安装记录，无需恢复。');
  const target = prepare({ ...opts, appDir: opts.appDir || state.appDir }, log);
  if (target.version !== state.version) {
    log(`  当前版本 ${target.version} 与打补丁时的版本 ${state.version} 不同，客户端已更新，旧备份不再适用，仅清理记录。`);
  } else {
    restoreFiles(target, state, log);
  }
  if (opts.setLocale !== false) setUserLocale('en-US', log);
  fs.rmSync(state.backupDir, { recursive: true, force: true });
  fs.rmSync(statePath(), { force: true });
  log('已恢复官方原版。');
}

function status(opts, log = console.log) {
  const target = locate(opts.appDir);
  const state = loadState();
  log(`安装目录：${target.appDir}`);
  log(`版本：${target.version}（${target.kind}）`);
  if (state && state.patched && state.appDir === target.appDir) {
    const same = state.version === target.version;
    log(`汉化状态：${same ? '已安装' : '客户端已更新，需要重新安装'}（${state.lang}，${state.patchedAt}）`);
  } else {
    log('汉化状态：未安装');
  }
  return { target, state };
}

// 统计当前客户端版本的翻译覆盖率；missingOut 不为空时导出未翻译条目，方便贡献翻译。
function coverageReport(opts, log = console.log) {
  const pack = locales.loadPack(opts.lang || 'zh-CN');
  const target = locate(opts.appDir);
  const state = loadState();
  const srcDir = state && state.version === target.version && exists(state.backupDir) ? state.backupDir : target.appDir;
  const file = (n) => path.join(srcDir, path.relative(target.appDir, path.join(target.resourcesDir, n)));
  const ion = asar.readArchive(file('ion-dist.asar'));
  const app = asar.readArchive(file('app.asar'));
  const sections = [
    ['frontend', readJsonEntry(ion, 'i18n/en-US.json'), pack.frontend],
    ['dynamic', readJsonEntry(ion, 'i18n/dynamic/en-US.json'), pack.dynamic],
    ['desktop', readJsonEntry(app, 'resources/i18n/en-US.json'), pack.desktop],
  ];
  const missing = {};
  for (const [name, base, tr] of sections) {
    const c = locales.coverage(base, tr);
    const pct = c.total ? (((c.total - c.missing.length) / c.total) * 100).toFixed(2) : '100';
    log(`${name.padEnd(9)} ${c.total - c.missing.length}/${c.total}（${pct}%），缺失 ${c.missing.length}`);
    missing[name] = Object.fromEntries(c.missing.map((k) => [k, base[k]]));
  }
  if (opts.out) {
    fs.writeFileSync(opts.out, JSON.stringify(missing, null, 2), 'utf8');
    log(`未翻译条目已导出到 ${opts.out}`);
  }
  return missing;
}

module.exports = { install, restore, status, coverageReport, buildOutputs, buildIonDist, buildAppAsar, loadState };
