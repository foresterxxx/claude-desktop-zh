#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FORBIDDEN_EXTENSIONS = new Set([
  '.7z', '.appx', '.asar', '.dll', '.dmg', '.exe', '.gif', '.ico', '.jpeg', '.jpg', '.msix', '.node',
  '.pkg', '.png', '.so', '.dylib', '.webp', '.zip',
]);
const FORBIDDEN_NAMES = new Set(['claude.exe', 'app.asar', 'ion-dist.asar', 'en-us.json']);
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
];

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT });
  return out.toString('utf8').split('\0').filter(Boolean);
}

function validateHardcoded(file, errors) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8').trimStart());
  if (!Array.isArray(data)) {
    errors.push(`${path.relative(ROOT, file)}：词表不是数组`);
    return;
  }
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const source = Array.isArray(item) ? item[0] : null;
    if (
      !Array.isArray(item) || item.length !== 2 || !source || typeof source !== 'object' ||
      !/^[0-9a-f]{64}$/.test(String(source.sha256 || '')) ||
      !Number.isSafeInteger(source.bytes) || source.bytes <= 0 || typeof item[1] !== 'string'
    ) {
      errors.push(`${path.relative(ROOT, file)}：第 ${i + 1} 条不是有效的哈希翻译规则`);
      return;
    }
  }
}

function main() {
  const errors = [];
  for (const rel of trackedFiles()) {
    const normalized = rel.replace(/\\/g, '/');
    const ext = path.extname(normalized).toLowerCase();
    const base = path.basename(normalized).toLowerCase();
    if (FORBIDDEN_EXTENSIONS.has(ext) || FORBIDDEN_NAMES.has(base)) {
      errors.push(`${normalized}：发布物中禁止包含客户端、归档或视觉素材`);
      continue;
    }
    const file = path.join(ROOT, rel);
    if (/^locales\/(?:zh-CN|zh-TW|zh-HK)\/hardcoded\.json$/.test(normalized)) {
      validateHardcoded(file, errors);
    }
    const stat = fs.statSync(file);
    if (stat.size <= 5 * 1024 * 1024) {
      const text = fs.readFileSync(file, 'utf8');
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(text)) errors.push(`${normalized}：疑似包含密钥或访问令牌`);
      }
    }
  }
  if (errors.length) {
    console.error(errors.map((e) => `- ${e}`).join('\n'));
    return 1;
  }
  console.log('发布检查通过：未发现客户端文件、视觉素材、明文硬编码源或常见密钥。');
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { main, validateHardcoded };
