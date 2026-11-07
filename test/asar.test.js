'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const asar = require('../src/asar');
const { tmpDir, buildArchive } = require('./helpers');

test('读取条目与列出文件', () => {
  const dir = tmpDir();
  const file = buildArchive(path.join(dir, 'a.asar'), {
    'package.json': '{"version":"1.2.3"}',
    'i18n/en-US.json': '{"a":"Hello"}',
    'native/addon.node': { unpacked: true, size: 10 },
  });
  const arc = asar.readArchive(file);
  assert.deepEqual(asar.listFiles(arc).sort(), ['i18n/en-US.json', 'native/addon.node', 'package.json']);
  assert.equal(asar.readEntry(arc, 'i18n/en-US.json').toString(), '{"a":"Hello"}');
  assert.throws(() => asar.readEntry(arc, 'native/addon.node'), /unpacked/);
  assert.throws(() => asar.readEntry(arc, 'missing.txt'), /不存在/);
});

test('重写归档：替换、新增条目，保留未改动内容与 unpacked 元数据', () => {
  const dir = tmpDir();
  const big = Buffer.alloc(5 * 1024 * 1024, 7); // 跨越 4MB 分块
  const src = buildArchive(path.join(dir, 'src.asar'), {
    'a.txt': 'alpha',
    'big.bin': big,
    'native/addon.node': { unpacked: true, size: 10 },
    'i18n/en-US.json': '{"k":"v"}',
  });
  const arc = asar.readArchive(src);
  const out = path.join(dir, 'out.asar');
  const res = asar.writeArchive(
    arc,
    out,
    new Map([
      ['i18n/en-US.json', Buffer.from('{"k":"值"}')],
      ['i18n/zh-CN.json', Buffer.from('{"k":"中文"}')],
      ['new/dir/file.js', Buffer.from('x')],
    ]),
  );

  const next = asar.readArchive(out);
  assert.equal(res.hash, asar.headerHash(next.headerString));
  assert.equal(asar.readEntry(next, 'a.txt').toString(), 'alpha');
  assert.ok(asar.readEntry(next, 'big.bin').equals(big));
  assert.equal(asar.readEntry(next, 'i18n/en-US.json').toString(), '{"k":"值"}');
  assert.equal(asar.readEntry(next, 'i18n/zh-CN.json').toString(), '{"k":"中文"}');
  assert.equal(asar.readEntry(next, 'new/dir/file.js').toString(), 'x');
  assert.deepEqual(asar.getNode(next.header, 'native/addon.node'), { size: 10, unpacked: true });

  const node = asar.getNode(next.header, 'i18n/zh-CN.json');
  assert.equal(node.integrity.hash, asar.sha256(Buffer.from('{"k":"中文"}')));
  assert.equal(asar.getNode(next.header, 'big.bin').integrity.blocks.length, 2);
  assert.doesNotThrow(() => asar.verifyArchive(out, { checkIntegrity: true }));
});

test('空替换集合时输出与原归档内容等价', () => {
  const dir = tmpDir();
  const src = buildArchive(path.join(dir, 'src.asar'), { 'x.txt': 'x', 'y/z.txt': 'zz' });
  const out = path.join(dir, 'out.asar');
  asar.writeArchive(asar.readArchive(src), out, new Map());
  const a = asar.readArchive(src);
  const b = asar.readArchive(out);
  for (const p of asar.listFiles(a)) assert.ok(asar.readEntry(a, p).equals(asar.readEntry(b, p)));
});

test('不允许把文件路径当目录或改写 unpacked 条目', () => {
  const dir = tmpDir();
  const src = buildArchive(path.join(dir, 'src.asar'), {
    'a.txt': 'a',
    'n.node': { unpacked: true, size: 1 },
  });
  const arc = asar.readArchive(src);
  assert.throws(() => asar.writeArchive(arc, path.join(dir, 'o1.asar'), new Map([['a.txt/b', Buffer.from('')]])), /路径冲突/);
  assert.throws(() => asar.writeArchive(arc, path.join(dir, 'o2.asar'), new Map([['n.node', Buffer.from('')]])), /unpacked/);
});
