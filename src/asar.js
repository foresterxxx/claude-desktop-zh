'use strict';

// 零依赖的 ASAR 读写实现。
//
// 设计要点：
// - 不解包、不重打包整棵目录树，而是“流式重写”：未改动的文件直接从原归档按字节拷贝，
//   只有被替换/新增的条目使用新内容。这样 unpacked / executable / link 等元数据原样保留，
//   主进程包 app.asar 也能安全修改。
// - 改动或新增的条目会重新计算 Electron 要求的 integrity（整文件 SHA256 + 4MB 分块 SHA256）。
// - 返回新的 header 字符串，调用方据此计算 header hash 并同步到 Claude.exe / Info.plist。
//
// ASAR 格式（Chromium Pickle）：
//   [UInt32 4][UInt32 headerPickleSize][UInt32 headerPickleSize-4][UInt32 jsonLength][json][padding to 4]
//   之后紧跟文件数据区，每个文件节点的 offset 相对于数据区起点。

const fs = require('fs');
const crypto = require('crypto');

const BLOCK_SIZE = 4 * 1024 * 1024;
const COPY_CHUNK = 8 * 1024 * 1024;

function align4(n) {
  return n + ((4 - (n % 4)) % 4);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readArchive(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const prefix = Buffer.alloc(16);
    if (fs.readSync(fd, prefix, 0, 16, 0) !== 16) {
      throw new Error(`不是有效的 asar 文件（过短）：${file}`);
    }
    const sizeFieldLen = prefix.readUInt32LE(0);
    const headerPickleSize = prefix.readUInt32LE(4);
    const jsonLength = prefix.readUInt32LE(12);
    if (sizeFieldLen !== 4 || jsonLength > headerPickleSize) {
      throw new Error(`不是有效的 asar 文件（头部异常）：${file}`);
    }
    const json = Buffer.alloc(jsonLength);
    fs.readSync(fd, json, 0, jsonLength, 16);
    const headerString = json.toString('utf8');
    return {
      file,
      header: JSON.parse(headerString),
      headerString,
      dataOffset: 8 + headerPickleSize,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function headerHash(headerString) {
  return sha256(Buffer.from(headerString, 'utf8'));
}

function splitPath(p) {
  return p.replace(/\\/g, '/').split('/').filter(Boolean);
}

function getNode(header, p) {
  let node = header;
  for (const part of splitPath(p)) {
    if (!node.files || !Object.prototype.hasOwnProperty.call(node.files, part)) return null;
    node = node.files[part];
  }
  return node;
}

// 深度优先遍历所有文件条目（不含目录），回调参数为 (相对路径, 节点)。
function walkFiles(header, cb, prefix = '') {
  const files = header.files || {};
  for (const name of Object.keys(files)) {
    const node = files[name];
    const p = prefix ? `${prefix}/${name}` : name;
    if (node.files) walkFiles(node, cb, p);
    else cb(p, node);
  }
}

function listFiles(archive) {
  const out = [];
  walkFiles(archive.header, (p) => out.push(p));
  return out;
}

function readEntry(archive, p) {
  const node = getNode(archive.header, p);
  if (!node || node.files) throw new Error(`asar 中不存在文件：${p}`);
  if (node.unpacked) throw new Error(`该条目位于 .unpacked 目录，不能从 asar 内读取：${p}`);
  if (node.link) throw new Error(`该条目是符号链接：${p}`);
  const size = Number(node.size);
  const buf = Buffer.alloc(size);
  if (size === 0) return buf;
  const fd = fs.openSync(archive.file, 'r');
  try {
    fs.readSync(fd, buf, 0, size, archive.dataOffset + Number(node.offset));
  } finally {
    fs.closeSync(fd);
  }
  return buf;
}

function fileIntegrity(buf) {
  const blocks = [];
  for (let i = 0; i < buf.length; i += BLOCK_SIZE) {
    blocks.push(sha256(buf.subarray(i, i + BLOCK_SIZE)));
  }
  if (blocks.length === 0) blocks.push(sha256(Buffer.alloc(0)));
  return { algorithm: 'SHA256', hash: sha256(buf), blockSize: BLOCK_SIZE, blocks };
}

function ensureFileNode(header, p) {
  const parts = splitPath(p);
  let node = header;
  for (let i = 0; i < parts.length - 1; i++) {
    node.files = node.files || {};
    if (!node.files[parts[i]]) node.files[parts[i]] = { files: {} };
    node = node.files[parts[i]];
    if (!node.files) throw new Error(`路径冲突：${parts.slice(0, i + 1).join('/')} 是文件而不是目录`);
  }
  node.files = node.files || {};
  const name = parts[parts.length - 1];
  const existing = node.files[name];
  if (existing && existing.files) throw new Error(`路径冲突：${p} 是目录`);
  if (existing && (existing.unpacked || existing.link)) {
    throw new Error(`不支持修改 unpacked/link 条目：${p}`);
  }
  const fresh = existing || {};
  node.files[name] = fresh;
  return fresh;
}

/**
 * 基于原归档写出新归档。
 * @param {object} archive readArchive() 的返回值
 * @param {string} outFile 输出路径（不能与原文件相同）
 * @param {Map<string, Buffer>} changes 需要替换或新增的条目
 * @returns {{headerString: string, hash: string}}
 */
function writeArchive(archive, outFile, changes) {
  const header = JSON.parse(archive.headerString);
  const changed = new Map();
  for (const [p, buf] of changes) {
    const key = splitPath(p).join('/');
    changed.set(key, Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  }

  // 收集需要放入数据区的条目：未改动文件保持原有相对顺序，新增文件放在末尾。
  const entries = [];
  walkFiles(header, (p, node) => {
    if (node.unpacked || node.link) return;
    if (changed.has(p)) return;
    entries.push({ node, source: 'archive', srcOffset: Number(node.offset), size: Number(node.size) });
  });
  entries.sort((a, b) => a.srcOffset - b.srcOffset);
  for (const [p, buf] of changed) {
    const node = ensureFileNode(header, p);
    const hadIntegrity = Object.keys(node).length === 0 || !!node.integrity;
    node.size = buf.length;
    if (hadIntegrity) node.integrity = fileIntegrity(buf);
    entries.push({ node, source: 'buffer', buf, size: buf.length });
  }

  let offset = 0;
  for (const e of entries) {
    e.node.offset = String(offset);
    offset += e.size;
  }

  const headerString = JSON.stringify(header);
  const json = Buffer.from(headerString, 'utf8');
  const pickleSize = align4(4 + json.length) + 4; // UInt32 payload size + UInt32 string length + string(对齐)
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(pickleSize, 4);
  prefix.writeUInt32LE(pickleSize - 4, 8);
  prefix.writeUInt32LE(json.length, 12);
  const padding = Buffer.alloc(8 + pickleSize - 16 - json.length);

  const out = fs.openSync(outFile, 'w');
  const src = fs.openSync(archive.file, 'r');
  try {
    fs.writeSync(out, prefix);
    fs.writeSync(out, json);
    if (padding.length) fs.writeSync(out, padding);
    const chunk = Buffer.alloc(COPY_CHUNK);
    for (const e of entries) {
      if (e.source === 'buffer') {
        if (e.buf.length) fs.writeSync(out, e.buf);
        continue;
      }
      let remaining = e.size;
      let pos = archive.dataOffset + e.srcOffset;
      while (remaining > 0) {
        const n = fs.readSync(src, chunk, 0, Math.min(remaining, chunk.length), pos);
        if (n <= 0) throw new Error(`读取原 asar 数据失败（偏移 ${pos}）`);
        fs.writeSync(out, chunk, 0, n);
        remaining -= n;
        pos += n;
      }
    }
  } finally {
    fs.closeSync(src);
    fs.closeSync(out);
  }
  return { headerString, hash: headerHash(headerString) };
}

// 校验归档：头部可解析、每个打包文件都在数据区范围内，且（可选）逐文件校验 integrity。
function verifyArchive(file, { checkIntegrity = false } = {}) {
  const archive = readArchive(file);
  const total = fs.statSync(file).size;
  let count = 0;
  walkFiles(archive.header, (p, node) => {
    if (node.unpacked || node.link) return;
    const end = archive.dataOffset + Number(node.offset) + Number(node.size);
    if (end > total) throw new Error(`asar 条目越界：${p}`);
    if (checkIntegrity && node.integrity) {
      const actual = sha256(readEntry(archive, p));
      if (actual !== node.integrity.hash) throw new Error(`asar 条目 integrity 不匹配：${p}`);
    }
    count++;
  });
  return { files: count, hash: headerHash(archive.headerString) };
}

module.exports = {
  BLOCK_SIZE,
  readArchive,
  headerHash,
  getNode,
  walkFiles,
  listFiles,
  readEntry,
  fileIntegrity,
  writeArchive,
  verifyArchive,
  sha256,
};
