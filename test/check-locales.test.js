'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { placeholders } = require('../tools/check-locales');

test('ICU 占位符解析：忽略 plural/select 分支文本', () => {
  assert.equal(placeholders('{n} {n, plural, one {needs} other {need}} sign-in'), '{n}');
  assert.equal(placeholders('{has, select, both {By {author}} other {x}}'), '{author} {has}');
  assert.equal(placeholders('<b>{state, select, on {enabled} other {disabled}}</b>'), '<b> {state}');
  assert.equal(placeholders("It's '{literal}' text"), '');
  assert.equal(placeholders('{count, number} items'), '{count}');
});

test('ICU 占位符解析：能发现译文丢失或拼错参数', () => {
  const en = 'Allow {host} to connect';
  assert.notEqual(placeholders(en), placeholders('允许连接'));
  assert.notEqual(placeholders(en), placeholders('允许 {hots} 连接'));
  assert.equal(placeholders(en), placeholders('允许“{host}”连接'));
});
