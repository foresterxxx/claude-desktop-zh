'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const asar = require('../src/asar');

function tmpDir(prefix = 'claude-zh-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// 根据 { 'a/b.txt': 'content' | Buffer | { unpacked: true, size } } 生成一个最小 asar
function buildArchive(file, entries, { withIntegrity = true } = {}) {
  const header = { files: {} };
  const chunks = [];
  let offset = 0;
  for (const [p, value] of Object.entries(entries)) {
    const parts = p.split('/');
    let node = header;
    for (const dir of parts.slice(0, -1)) {
      node.files[dir] = node.files[dir] || { files: {} };
      node = node.files[dir];
    }
    const name = parts[parts.length - 1];
    if (value && value.unpacked) {
      node.files[name] = { size: value.size || 0, unpacked: true };
      continue;
    }
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    const entry = { size: buf.length, offset: String(offset) };
    if (withIntegrity) entry.integrity = asar.fileIntegrity(buf);
    node.files[name] = entry;
    chunks.push(buf);
    offset += buf.length;
  }
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const pickle = Math.ceil((4 + json.length) / 4) * 4 + 4;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(pickle, 4);
  prefix.writeUInt32LE(pickle - 4, 8);
  prefix.writeUInt32LE(json.length, 12);
  const pad = Buffer.alloc(8 + pickle - 16 - json.length);
  fs.writeFileSync(file, Buffer.concat([prefix, json, pad, ...chunks]));
  return file;
}

module.exports = { tmpDir, buildArchive };
