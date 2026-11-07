#!/usr/bin/env node
'use strict';

// 翻译质量检查：对比本机 Claude Desktop 的英文词库，找出译文中 ICU 占位符（{name}、<tag>）
// 与原文不一致的条目——这类错误会导致界面显示异常或格式化报错。
//
// 用法：node tools/check-locales.js [--lang zh-CN] [--app-dir <目录>]
// 未安装 Claude Desktop 时只做 JSON 结构校验。

const path = require('path');
const asar = require('../src/asar');
const locales = require('../src/locales');
const { locate } = require('../src/locate');

function args() {
  const a = process.argv.slice(2);
  const get = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  return { lang: get('--lang'), appDir: get('--app-dir') };
}

// 简易 ICU MessageFormat 解析：收集参数名与富文本标签名。
// plural/select 的分支文本（如 {needs}）不是参数，按子消息递归解析。
function collectArgs(msg, names, start = 0, stopAtBrace = false) {
  let i = start;
  while (i < msg.length) {
    const ch = msg[i];
    if (ch === "'" && (msg[i + 1] === '{' || msg[i + 1] === '}' || msg[i + 1] === "'")) {
      const end = msg.indexOf("'", i + 1); // ICU 转义：'{...}' 原样输出
      i = end < 0 ? msg.length : end + 1;
      continue;
    }
    if (ch === '}' && stopAtBrace) return i + 1;
    if (ch === '<') {
      const m = /^<\/?([A-Za-z0-9_]+)\s*\/?>/.exec(msg.slice(i));
      if (m) {
        names.add(`<${m[1]}>`);
        i += m[0].length;
        continue;
      }
    }
    if (ch === '{') {
      const m = /^\{\s*([A-Za-z0-9_]+)\s*(,\s*([A-Za-z]+)\s*)?/.exec(msg.slice(i));
      if (!m) {
        i++;
        continue;
      }
      names.add(`{${m[1]}}`);
      i += m[0].length;
      const type = m[3];
      if (type === 'plural' || type === 'select' || type === 'selectordinal') {
        i = msg[i] === ',' ? i + 1 : i;
        // 分支：keyword {子消息} ...，直到参数的右花括号
        while (i < msg.length && msg[i] !== '}') {
          if (msg[i] === '{') i = collectArgs(msg, names, i + 1, true);
          else i++;
        }
        i++;
      } else {
        let depth = 1; // number/date 等类型：跳过格式说明
        while (i < msg.length && depth > 0) {
          if (msg[i] === '{') depth++;
          else if (msg[i] === '}') depth--;
          i++;
        }
      }
      continue;
    }
    i++;
  }
  return i;
}

function placeholders(msg) {
  const names = new Set();
  collectArgs(msg, names);
  return [...names].sort().join(' ');
}

function main() {
  const opts = args();
  const langs = opts.lang ? [opts.lang] : Object.keys(locales.LANGUAGES);
  let target = null;
  try {
    target = locate(opts.appDir);
  } catch (e) {
    console.log(`[提示] ${e.message} 仅进行结构校验。`);
  }

  let problems = 0;
  for (const lang of langs) {
    const pack = locales.loadPack(lang);
    console.log(`\n== ${lang}`);
    if (!target) {
      console.log(`  frontend ${Object.keys(pack.frontend).length} 条，desktop ${Object.keys(pack.desktop).length} 条，结构正常`);
      continue;
    }
    const ion = asar.readArchive(path.join(target.resourcesDir, 'ion-dist.asar'));
    const app = asar.readArchive(path.join(target.resourcesDir, 'app.asar'));
    const read = (arc, p) => JSON.parse(asar.readEntry(arc, p).toString('utf8').trimStart());
    const sections = [
      ['frontend', read(ion, 'i18n/en-US.json'), pack.frontend],
      ['dynamic', read(ion, 'i18n/dynamic/en-US.json'), pack.dynamic],
      ['desktop', read(app, 'resources/i18n/en-US.json'), pack.desktop],
    ];
    for (const [name, en, tr] of sections) {
      let bad = 0;
      for (const [key, source] of Object.entries(en)) {
        const t = tr[key];
        if (typeof t !== 'string' || typeof source !== 'string') continue;
        if (placeholders(source) !== placeholders(t)) {
          bad++;
          if (bad <= 20) console.log(`  [${name}] ${key}\n    EN: ${source}\n    ZH: ${t}`);
        }
      }
      if (bad > 20) console.log(`  [${name}] ……另有 ${bad - 20} 条`);
      console.log(`  ${name}: 占位符不一致 ${bad} 条`);
      problems += bad;
    }
  }
  return problems ? 1 : 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { placeholders };
