'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const integrity = require('../src/integrity');
const { tmpDir } = require('./helpers');

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const N1 = '1'.repeat(64);
const N2 = '2'.repeat(64);

function fakeExe(dir) {
  const json =
    `[{"file":"resources\\\\app.asar","alg":"SHA256","value":"${H1}"},` +
    `{"file":"resources\\\\ion-dist.asar","alg":"SHA256","value":"${H2}"}]`;
  const file = path.join(dir, 'claude.exe');
  fs.writeFileSync(file, Buffer.concat([Buffer.alloc(1000, 0x90), Buffer.from(json, 'latin1'), Buffer.alloc(500, 0)]));
  return file;
}

test('Windows：读取并原地改写 exe 中的 asar 哈希', () => {
  const dir = tmpDir();
  const exe = fakeExe(dir);
  const size = fs.statSync(exe).size;
  assert.deepEqual(integrity.readExeHashes(exe, ['app.asar', 'ion-dist.asar']), { 'app.asar': H1, 'ion-dist.asar': H2 });
  const updates = integrity.writeExeHashes(exe, { 'app.asar': N1, 'ion-dist.asar': N2 });
  assert.equal(updates.length, 2);
  assert.equal(fs.statSync(exe).size, size);
  assert.deepEqual(integrity.readExeHashes(exe, ['app.asar', 'ion-dist.asar']), { 'app.asar': N1, 'ion-dist.asar': N2 });
  assert.deepEqual(integrity.writeExeHashes(exe, { 'app.asar': N1 }), []); // 幂等
});

test('Windows：找不到或不唯一的标记会报错', () => {
  const dir = tmpDir();
  const exe = path.join(dir, 'claude.exe');
  fs.writeFileSync(exe, Buffer.from('nothing here'));
  assert.throws(() => integrity.writeExeHashes(exe, { 'app.asar': N1 }), /找不到/);
  const marker = `{"file":"resources\\\\app.asar","alg":"SHA256","value":"${H1}"}`;
  fs.writeFileSync(exe, Buffer.from(marker + marker, 'latin1'));
  assert.throws(() => integrity.readExeHashes(exe, ['app.asar']), /不唯一/);
});

test('macOS：更新 Info.plist 中的 ElectronAsarIntegrity', () => {
  const xml = `<?xml version="1.0"?><plist><dict>
<key>ElectronAsarIntegrity</key>
<dict>
\t<key>Resources/app.asar</key>
\t<dict>
\t\t<key>algorithm</key>
\t\t<string>SHA256</string>
\t\t<key>hash</key>
\t\t<string>${H1}</string>
\t</dict>
\t<key>Resources/ion-dist.asar</key>
\t<dict>
\t\t<key>algorithm</key>
\t\t<string>SHA256</string>
\t\t<key>hash</key>
\t\t<string>${H2}</string>
\t</dict>
</dict>
</dict></plist>`;
  const { text, changed } = integrity.updatePlistIntegrity(xml, { 'app.asar': N1, 'ion-dist.asar': N2 });
  assert.deepEqual(changed, ['app.asar', 'ion-dist.asar']);
  const parsed = integrity.parsePlistIntegrity(text);
  assert.equal(parsed['Resources/app.asar'].hash, N1);
  assert.equal(parsed['Resources/ion-dist.asar'].hash, N2);
});

test('macOS：同步 Electron Framework 字典摘要槽位', () => {
  const dir = tmpDir();
  const fw = path.join(dir, 'Electron Framework');
  const sentinel = Buffer.from('AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A', 'latin1');
  const slot = Buffer.alloc(34);
  slot[0] = 1;
  const unused = Buffer.alloc(34); // used=0 的槽位不应被改动
  fs.writeFileSync(fw, Buffer.concat([Buffer.alloc(16), sentinel, slot, sentinel, unused]));
  const dict = { 'Resources/app.asar': { algorithm: 'SHA256', hash: N1 } };
  assert.equal(integrity.syncFrameworkDigest(fw, dict), 1);
  const data = fs.readFileSync(fw);
  const at = 16 + sentinel.length;
  assert.ok(data.subarray(at + 2, at + 34).equals(integrity.integrityDictionaryDigest(dict)));
  const at2 = at + 34 + sentinel.length;
  assert.ok(data.subarray(at2, at2 + 34).equals(unused));
});
