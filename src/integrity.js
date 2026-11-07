'use strict';

// 同步 Electron 的 ASAR 完整性校验记录（EnableEmbeddedAsarIntegrityValidation）。
//
// - Windows：哈希以 JSON 形式嵌在 Claude.exe 的资源里，例如
//     [{"file":"resources\\app.asar","alg":"SHA256","value":"<64 位十六进制>"}, ...]
//   定位到 value 后原地改写 64 字节，exe 大小不变。
// - macOS：哈希位于 Info.plist 的 ElectronAsarIntegrity 字典；Electron 37+ 还会在
//   Electron Framework 中预埋整个字典的摘要槽位，需要同步更新。
//
// 标记格式的兼容写法参考了 javaht/claude-desktop-zh-cn（MIT License）。

const fs = require('fs');
const crypto = require('crypto');

const HEX64 = /^[0-9a-fA-F]{64}$/;

function exeMarkerCandidates(asarName) {
  const tail = `","alg":"SHA256","value":"`;
  return [
    `{"file":"resources\\\\${asarName}${tail}`,
    `resources\\\\${asarName}${tail}`,
    `{"file":"resources/${asarName}${tail}`,
    `resources/${asarName}${tail}`,
    `resources\\${asarName}${tail}`,
  ];
}

function findExeHashOffset(exeBuf, asarName) {
  for (const candidate of exeMarkerCandidates(asarName)) {
    const needle = Buffer.from(candidate, 'latin1');
    const idx = exeBuf.indexOf(needle);
    if (idx < 0) continue;
    if (exeBuf.indexOf(needle, idx + 1) >= 0) {
      throw new Error(`Claude.exe 中 ${asarName} 的完整性标记不唯一，客户端格式可能已变化。`);
    }
    const offset = idx + needle.length;
    const value = exeBuf.toString('latin1', offset, offset + 64);
    if (!HEX64.test(value)) {
      throw new Error(`Claude.exe 中 ${asarName} 的完整性值不是 SHA256 十六进制字符串。`);
    }
    return { offset, value };
  }
  return null;
}

function readExeHashes(exePath, asarNames) {
  const buf = fs.readFileSync(exePath);
  const out = {};
  for (const name of asarNames) {
    const hit = findExeHashOffset(buf, name);
    if (hit) out[name] = hit.value.toLowerCase();
  }
  return out;
}

// hashes: { 'app.asar': '<hex>', 'ion-dist.asar': '<hex>' }
function writeExeHashes(exePath, hashes) {
  const buf = fs.readFileSync(exePath);
  const updates = [];
  for (const [name, hash] of Object.entries(hashes)) {
    const hit = findExeHashOffset(buf, name);
    if (!hit) throw new Error(`在 Claude.exe 中找不到 ${name} 的完整性标记，客户端格式可能已变化。`);
    if (hit.value.toLowerCase() !== hash) updates.push({ name, offset: hit.offset, from: hit.value, to: hash });
  }
  if (updates.length === 0) return [];
  const fd = fs.openSync(exePath, 'r+');
  try {
    for (const u of updates) fs.writeSync(fd, Buffer.from(u.to, 'latin1'), 0, 64, u.offset);
  } finally {
    fs.closeSync(fd);
  }
  return updates;
}

// ---------- macOS ----------

const PLIST_ENTRY_RE = (key) =>
  new RegExp(
    `(<key>${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</key>\\s*<dict>[\\s\\S]*?<key>hash</key>\\s*<string>)([0-9a-fA-F]{64})(</string>)`,
  );

// 输入 XML 格式的 Info.plist 文本，返回 { text, changed }
function updatePlistIntegrity(xml, hashes) {
  let text = xml;
  const changed = [];
  for (const [name, hash] of Object.entries(hashes)) {
    const re = PLIST_ENTRY_RE(`Resources/${name}`);
    const m = re.exec(text);
    if (!m) continue;
    if (m[2].toLowerCase() !== hash) {
      text = text.replace(re, `$1${hash}$3`);
      changed.push(name);
    }
  }
  return { text, changed };
}

function parsePlistIntegrity(xml) {
  const out = {};
  const block = /<key>ElectronAsarIntegrity<\/key>\s*<dict>([\s\S]*?)<\/dict>\s*<\/dict>/.exec(xml);
  if (!block) return out;
  const re = /<key>([^<]+)<\/key>\s*<dict>\s*<key>algorithm<\/key>\s*<string>([^<]+)<\/string>\s*<key>hash<\/key>\s*<string>([^<]+)<\/string>/g;
  let m;
  while ((m = re.exec(block[1] + '</dict>'))) out[m[1]] = { algorithm: m[2], hash: m[3] };
  return out;
}

// Electron 37+：Electron Framework 内的字典摘要槽位
const DIGEST_SENTINEL = Buffer.from('AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A', 'latin1');

function integrityDictionaryDigest(integrity) {
  const h = crypto.createHash('sha256');
  for (const key of Object.keys(integrity).sort()) {
    h.update(key, 'utf8');
    h.update(String(integrity[key].algorithm || ''), 'utf8');
    h.update(String(integrity[key].hash || ''), 'utf8');
  }
  return h.digest();
}

function syncFrameworkDigest(frameworkPath, integrity) {
  if (!fs.existsSync(frameworkPath)) return 0;
  const data = fs.readFileSync(frameworkPath);
  const digest = integrityDictionaryDigest(integrity);
  let updated = 0;
  let start = 0;
  for (;;) {
    const idx = data.indexOf(DIGEST_SENTINEL, start);
    if (idx < 0) break;
    const slot = idx + DIGEST_SENTINEL.length;
    if (slot + 34 > data.length) break;
    if (data[slot] === 1) {
      data[slot + 1] = 1;
      digest.copy(data, slot + 2);
      updated++;
    }
    start = idx + 1;
  }
  if (updated) fs.writeFileSync(frameworkPath, data);
  return updated;
}

module.exports = {
  findExeHashOffset,
  readExeHashes,
  writeExeHashes,
  updatePlistIntegrity,
  parsePlistIntegrity,
  integrityDictionaryDigest,
  syncFrameworkDigest,
};
