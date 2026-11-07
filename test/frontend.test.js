'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const frontend = require('../src/frontend');

const BASE = '["en-US","de-DE","fr-FR","ko-KR","ja-JP","es-419","it-IT"]';

test('语言白名单：添加、切换、移除，且幂等', () => {
  const src = `var a=${BASE};function f(e){return a.includes(e)}var b=${BASE};`;
  const once = frontend.patchWhitelist(src, 'zh-CN');
  assert.equal(once.found, 2);
  assert.equal(once.count, 2);
  assert.ok(once.text.includes('"it-IT","zh-CN"]'));
  assert.equal(frontend.patchWhitelist(once.text, 'zh-CN').count, 0);

  const switched = frontend.patchWhitelist(once.text, 'zh-TW').text;
  assert.ok(switched.includes('"it-IT","zh-TW"]') && !switched.includes('zh-CN'));
  assert.equal(frontend.patchWhitelist(switched, null).text, src);
});

test('语言白名单：不相关的数组不受影响', () => {
  const src = 'var x=["en-US","fr-FR"];';
  assert.equal(frontend.patchWhitelist(src, 'zh-CN').found, 0);
});

test('Intl.DisplayNames 补丁只追加一次，且位于 sourceMappingURL 之前', () => {
  const src = 'new Intl.DisplayNames(["en"],{type:"language"});\n//# sourceMappingURL=a.js.map';
  const r = frontend.patchDisplayNames(src);
  assert.equal(r.count, 1);
  assert.ok(r.text.trimEnd().endsWith('//# sourceMappingURL=a.js.map'));
  assert.equal(frontend.patchDisplayNames(r.text).count, 0);
  assert.equal(frontend.patchDisplayNames('no intl here').count, 0);
});

test('Intl.DisplayNames 补丁运行后返回中文名称', () => {
  const r = frontend.patchDisplayNames('void Intl.DisplayNames;');
  // eslint-disable-next-line no-new-func
  new Function(r.text)();
  const dn = new Intl.DisplayNames(['en'], { type: 'language' });
  assert.equal(dn.of('zh-CN'), '简体中文');
  assert.equal(dn.of('zh-TW'), '繁體中文（台灣）');
  assert.equal(dn.of('fr'), 'French');
});

test('硬编码替换：替换展示文案并正确转义引号', () => {
  const rules = frontend.compileHardcodedRules([
    ['Open settings', '打开"设置"'],
    ['Learn more', '了解更多'],
  ]);
  const src = 'f({children:"Open settings"});g(`Learn more`);h(\'Learn more\')';
  const r = frontend.patchHardcoded(src, rules);
  assert.equal(r.count, 3);
  assert.ok(r.text.includes('children:"打开\\"设置\\""'));
  assert.ok(r.text.includes('`了解更多`'));
  assert.ok(r.text.includes("'了解更多'"));
});

test('硬编码替换：跳过比较、对象键、图标/类型等程序语义位置', () => {
  const rules = frontend.compileHardcodedRules([
    ['Stream idle timeout', '流式空闲超时'],
    ['Done', '完成'],
    ['Folder', '文件夹'],
    ['Connected', '已连接'],
    ['Disconnected', '已断开'],
  ]);
  const cases = [
    'n.includes("Stream idle timeout")',
    'if(x==="Done")y()',
    'if("Done"===x)y()',
    'switch(s){case "Done":break}',
    'const m={"Done":1}',
    'p({icon:"Folder"})',
    'p({type:"Folder"})',
  ];
  for (const src of cases) {
    assert.equal(frontend.patchHardcoded(src, rules).text, src, src);
  }
  const ternary = frontend.patchHardcoded('label:e?"Connected":"Disconnected"', rules);
  assert.equal(ternary.text, 'label:e?"已连接":"已断开"');
});

test('硬编码替换：高危结构性短词与纯小写标识符不参与替换', () => {
  const rules = frontend.compileHardcodedRules([
    ['Settings', '设置'],
    ['tokens', '令牌'],
    ['"Search"', '"搜索"'],
  ]);
  assert.equal(rules.plain.size, 0);
  assert.equal(rules.direct.length, 0);
});

test('硬编码替换：含特殊字符的规则按原文直接替换', () => {
  const rules = frontend.compileHardcodedRules([['defaultMessage:"Name",id:"abc"', 'defaultMessage:"名称",id:"abc"']]);
  const r = frontend.patchHardcoded('x({defaultMessage:"Name",id:"abc"})', rules);
  assert.equal(r.text, 'x({defaultMessage:"名称",id:"abc"})');
  assert.equal(r.count, 1);
});

test('硬编码替换：哈希词表不保存英文原文也能替换展示文案', () => {
  const source = 'Open settings';
  const rules = frontend.compileHardcodedRules([
    [{ sha256: frontend.literalHash(source), bytes: Buffer.byteLength(source) }, '打开设置'],
  ]);
  assert.equal(rules.plain.size, 0);
  assert.equal(rules.hashed.size, 1);
  const r = frontend.patchHardcoded('f({children:"Open settings"})', rules);
  assert.equal(r.text, 'f({children:"打开设置"})');
  assert.equal(r.count, 1);
});

test('硬编码替换：哈希词表仍跳过比较、对象键和结构性上下文', () => {
  const source = 'Done';
  const pair = [{ sha256: frontend.literalHash(source), bytes: Buffer.byteLength(source) }, '完成'];
  const rules = frontend.compileHardcodedRules([pair]);
  for (const text of ['x==="Done"', '{"Done":1}', 'p({type:"Done"})']) {
    assert.equal(frontend.patchHardcoded(text, rules).text, text);
  }
});

test('硬编码替换：无效哈希规则会报错', () => {
  assert.throws(
    () => frontend.compileHardcodedRules([[{ sha256: 'bad', bytes: 3 }, '坏规则']]),
    /哈希规则无效/,
  );
});
