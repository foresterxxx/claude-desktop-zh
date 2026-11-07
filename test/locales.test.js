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
      const source = item[0];
      assert.equal(typeof source, 'object', `${lang}/hardcoded.json 不应包含英文匹配原文`);
      assert.match(source.sha256, /^[0-9a-f]{64}$/);
      assert.ok(Number.isSafeInteger(source.bytes) && source.bytes > 0);
      assert.equal(typeof item[1], 'string');
    }
  });
}

const THINKING_LABEL_IDS = [
  'Jj0DasG7Mx',
  '4LM6AdGWNg',
  'vFyvc213kN',
  'voTuOb/ijW',
  'MFx4UWu2HS',
  'zl6fNbo7RW',
  'xIksaL4N9Q',
  'o38caaOAJl',
  'QrZMdiKa7h',
  'JKbbmmrW33',
  'TvfUJeEeqK',
  'j97FqneaDa',
  '+OiyRgcyfz',
  'oogxH3q75G',
  '33dVpMzc7p',
  'LtdsUMPzL6',
  'fM2TbrcEIJ',
  '2Fc6IvVyfr',
  'w3VoZRPW4Z',
];

for (const lang of Object.keys(locales.LANGUAGES)) {
  test(`语言包 ${lang} 覆盖思考状态标签`, () => {
    const frontend = locales.loadPack(lang).frontend;
    for (const id of THINKING_LABEL_IDS) {
      assert.equal(typeof frontend[id], 'string', `${lang} 缺少思考状态标签 ${id}`);
      assert.doesNotMatch(frontend[id], /\b(?:Thinking|Thought|Pondering|Reflecting|Ruminating)\b/i);
    }
    assert.match(frontend.Jj0DasG7Mx, /\{seconds\}/);
    assert.match(frontend['4LM6AdGWNg'], /\{minutes\}.*\{seconds\}/);
    assert.match(frontend['voTuOb/ijW'], /\{hours\}.*\{minutes\}/);
    assert.match(frontend.QrZMdiKa7h, /^正在思考…$/);
    assert.match(frontend['2Fc6IvVyfr'], /^正在思考…$/);
  });
}

test('不支持的语言会报错', () => {
  assert.throws(() => locales.loadPack('fr-FR'), /不支持/);
});
