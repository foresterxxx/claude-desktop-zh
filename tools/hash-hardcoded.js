#!/usr/bin/env node
'use strict';

const { literalHash } = require('../src/frontend');

const [source, target] = process.argv.slice(2);
if (!source || !target) {
  console.error('用法：node tools/hash-hardcoded.js <英文原文> <中文译文>');
  process.exitCode = 2;
} else {
  const rule = [{ sha256: literalHash(source), bytes: Buffer.byteLength(source, 'utf8') }, target];
  console.log(JSON.stringify(rule, null, 2));
}
