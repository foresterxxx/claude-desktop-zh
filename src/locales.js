'use strict';

// 语言包加载与词库合并。
// 语言包目录：locales/<lang>/
//   frontend.json   前端（ion-dist/i18n/<lang>.json）  key -> 译文
//   dynamic.json    前端动态词库（ion-dist/i18n/dynamic/<lang>.json）
//   desktop.json    桌面壳层（app.asar/resources/i18n/<lang>.json）
//   hardcoded.json  前端未走 i18n 的硬编码文案 [[{sha256, bytes}, 译文], ...]（可选）
//   supplement.json 本项目原创的补充翻译 { frontend, dynamic, desktop }，优先级最高（可选）
//
// frontend/dynamic/desktop 与 hardcoded 的译文源自 javaht/claude-desktop-zh-cn（MIT），见 NOTICE.md。

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');

const LANGUAGES = {
  'zh-CN': { label: '简体中文', nativeShell: 'zh-Hans' },
  'zh-TW': { label: '繁體中文（台灣）', nativeShell: 'zh-Hant' },
  'zh-HK': { label: '繁體中文（香港）', nativeShell: 'zh-Hant' },
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').trimStart()); // trimStart 同时去掉 UTF-8 BOM
}

function loadPack(lang) {
  if (!LANGUAGES[lang]) {
    throw new Error(`不支持的语言：${lang}（可选：${Object.keys(LANGUAGES).join(' / ')}）`);
  }
  const dir = path.join(LOCALES_DIR, lang);
  const opt = (name, fallback) => {
    const f = path.join(dir, name);
    return fs.existsSync(f) ? readJson(f) : fallback;
  };
  const sup = opt('supplement.json', {});
  const section = (name, file) => ({ ...opt(file, {}), ...(sup[name] || {}) });
  return {
    lang,
    ...LANGUAGES[lang],
    frontend: { ...readJson(path.join(dir, 'frontend.json')), ...(sup.frontend || {}) },
    dynamic: section('dynamic', 'dynamic.json'),
    desktop: section('desktop', 'desktop.json'),
    hardcoded: opt('hardcoded.json', []),
  };
}

// 以 base 为骨架叠加 override：只采用 base 中存在、且值为非空字符串的译文。
// 新版本新增但尚未翻译的 key 保留英文，避免界面缺字；不在 base 中的旧 key 丢弃。
function mergeMessages(base, ...overrides) {
  const out = { ...base };
  let translated = 0;
  for (const key of Object.keys(base)) {
    for (let i = overrides.length - 1; i >= 0; i--) {
      const v = overrides[i] && overrides[i][key];
      if (typeof v === 'string' && v.length > 0) {
        if (v !== base[key]) translated++;
        out[key] = v;
        break;
      }
    }
  }
  return { messages: out, translated, total: Object.keys(base).length };
}

function coverage(base, pack) {
  const missing = [];
  for (const key of Object.keys(base)) {
    const v = pack[key];
    if (typeof v !== 'string' || v.length === 0) missing.push(key);
  }
  return { total: Object.keys(base).length, missing };
}

function toJsonBuffer(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8');
}

module.exports = { LANGUAGES, LOCALES_DIR, readJson, loadPack, mergeMessages, coverage, toJsonBuffer };
