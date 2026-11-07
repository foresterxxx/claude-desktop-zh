'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const locales = require('../src/locales');

test('mergeMessages：只采用基础词库中存在的 key，未翻译保留英文', () => {
  const base = { a: 'Hello', b: 'World', c: 'Same' };
  const r = locales.mergeMessages(base, { a: '你好', old: '过期', c: 'Same', b: '' });
  assert.deepEqual(r.messages, { a: '你好', b: 'World', c: 'Same' });
  assert.equal(r.translated, 1);
  assert.equal(r.total, 3);
});

test('mergeMessages：后面的覆盖优先级更高', () => {
  const r = locales.mergeMessages({ a: 'A', b: 'B' }, { a: '官方', b: '官方B' }, { a: '项目' });
  assert.deepEqual(r.messages, { a: '项目', b: '官方B' });
});

test('coverage 统计缺失条目', () => {
  const c = locales.coverage({ a: 'A', b: 'B' }, { a: '甲' });
  assert.equal(c.total, 2);
  assert.deepEqual(c.missing, ['b']);
});

for (const lang of Object.keys(locales.LANGUAGES)) {
  test(`语言包 ${lang} 结构有效`, () => {
    const pack = locales.loadPack(lang);
    for (const section of ['frontend', 'dynamic', 'desktop']) {
      const obj = pack[section];
      assert.equal(typeof obj, 'object');
      for (const [k, v] of Object.entries(obj)) {
        assert.equal(typeof v, 'string', `${lang}/${section}.json 中 ${k} 不是字符串`);
      }
    }
    assert.ok(Object.keys(pack.frontend).length > 1000);
    assert.ok(Array.isArray(pack.hardcoded));
    for (const item of pack.hardcoded) {
      assert.ok(Array.isArray(item) && item.length === 2, `${lang}/hardcoded.json 存在无效条目`);
    }
  });
}

test('不支持的语言会报错', () => {
  assert.throws(() => locales.loadPack('fr-FR'), /不支持/);
});
