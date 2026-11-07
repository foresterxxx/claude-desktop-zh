'use strict';

const crypto = require('crypto');

// 前端 JS bundle 的文本级补丁：
// 1. 语言白名单：在 ["en-US","de-DE","fr-FR","ko-KR","ja-JP",...] 数组中加入中文变体；
// 2. 语言显示名：让 Intl.DisplayNames 对 zh-CN / zh-TW / zh-HK 返回中文名称；
// 3. 硬编码文案（可选）：替换未走 i18n 的界面字符串字面量。
//
// 硬编码替换的安全规则（结构性词汇跳过表、图标/枚举上下文识别）移植自
// javaht/claude-desktop-zh-cn（MIT License），在此基础上改为“按字符串字面量扫描 + 查表”，
// 单次线性扫描即可完成整份 bundle，不需要对每条规则做全文搜索。

const MANAGED_LANGS = ['zh-CN', 'zh-TW', 'zh-HK'];
const WHITELIST_ANCHOR = '"en-US","de-DE","fr-FR","ko-KR","ja-JP"';
const WHITELIST_RE = /\["en-US","de-DE","fr-FR","ko-KR","ja-JP"(?:,"[A-Za-z0-9-]+")*\]/g;

function patchWhitelist(text, lang) {
  let count = 0;
  let found = 0;
  const out = text.replace(WHITELIST_RE, (m) => {
    found++;
    const items = JSON.parse(m).filter((x) => !MANAGED_LANGS.includes(x));
    if (lang) items.push(lang);
    const next = JSON.stringify(items);
    if (next !== m) count++;
    return next;
  });
  return { text: out, count, found };
}

const DISPLAY_NAME_MARKER = '__claudeDesktopZhLabel';
const DISPLAY_NAME_PATCH =
  ';(()=>{const p=typeof Intl!=="undefined"&&Intl.DisplayNames&&Intl.DisplayNames.prototype;' +
  `if(!p||p.${DISPLAY_NAME_MARKER})return;const o=p.of;` +
  'const m={"zh-CN":"简体中文","zh-TW":"繁體中文（台灣）","zh-HK":"繁體中文（香港）"};' +
  'p.of=function(c){const k=String(c);return Object.prototype.hasOwnProperty.call(m,k)?m[k]:o.call(this,c)};' +
  `Object.defineProperty(p,"${DISPLAY_NAME_MARKER}",{value:!0})})();`;

function patchDisplayNames(text) {
  if (!text.includes('Intl.DisplayNames') || text.includes(DISPLAY_NAME_MARKER)) return { text, count: 0 };
  // 以 sourceMappingURL 注释结尾的文件，把补丁插在注释之前
  const sm = /\n\/\/# sourceMappingURL=[^\n]*\s*$/.exec(text);
  if (sm) return { text: text.slice(0, sm.index) + DISPLAY_NAME_PATCH + text.slice(sm.index), count: 1 };
  return { text: text + DISPLAY_NAME_PATCH, count: 1 };
}

// ---------- 硬编码文案 ----------

// 兼作图标名、按键名、事件后缀、枚举值的高危短词：只靠 i18n 翻译，不做静态替换。
const STRUCTURAL_LITERALS = new Set([
  'Search', 'Add', 'Copy', 'Check', 'Tasks', 'Settings', 'Command', 'Cancel', 'Sort', 'Voice',
  'Default', 'Arguments', 'Normal', 'All', 'Application', 'Medium', 'Motion', 'Thinking', 'Verbose',
  'Software Engineer',
]);

function isStructuralSource(source) {
  const bare = source.replace(/^"(.*)"$/, '$1');
  return /^[a-z][A-Za-z0-9_]*$/.test(source) || STRUCTURAL_LITERALS.has(bare);
}

function isPlainUiText(source) {
  if (source.includes('\n')) return false;
  return !['"', '\\', '=', ';', '=>'].some((m) => source.includes(m));
}

const STRUCTURAL_CONTEXT_RE = new RegExp(
  '(?<![A-Za-z0-9_$-])(?:as|component|displayName|glyph|[\\w$-]*[Ii]con(?:Name)?|name|role|type)\\s*[:=]\\s*' +
    '(?:(?:(?:(?:[^?:"\'`,;{}]|"[^"]{0,60}"|\'[^\']{0,60}\'|`[^`]{0,60}`){1,120}?)\\?\\??\\s*(?:"[^"]{0,80}"|\'[^\']{0,80}\'|`[^`]{0,80}`)\\s*:\\s*)*)' +
    '(?:(?:(?:[^?:"\'`,;{}]|"[^"]{0,60}"|\'[^\']{0,60}\'|`[^`]{0,60}`){1,120}?)(?:\\?\\??)?\\s*)?(?:=\\s*)?$',
);
const STRUCTURAL_ALIAS_RE = new RegExp(
  '(?<![A-Za-z0-9_$-])[\\w$-]*[Ii]con(?:Name)?\\s*:\\s*(?<alias>[A-Za-z0-9_$]+)\\b.*?' +
    '(?:=\\s*\\k<alias>\\s*===\\s*void 0\\s*\\?\\s*|=\\s*\\k<alias>\\s*!==\\s*void 0\\s*\\?\\s*\\k<alias>\\s*:\\s*|(?<![A-Za-z0-9_$-])\\k<alias>\\s*\\?\\?\\s*)$',
);

// 字面量前面若是 icon:"X"、type:"X"、name:"X" 等程序语义位置，则跳过。
function isStructuralContext(text, literalStart) {
  const prefix = text.slice(Math.max(0, literalStart - 160), literalStart);
  if (STRUCTURAL_ALIAS_RE.test(prefix)) return true;
  return STRUCTURAL_CONTEXT_RE.test(prefix.slice(-96));
}

// 对象键位置（{"Foo":1} / ,'Foo':）不替换；三元表达式 a?"Foo":"Bar" 不受影响
function isObjectKey(text, literalStart, literalEnd) {
  let i = literalEnd;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  if (text[i] !== ':') return false;
  let j = literalStart - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  return j < 0 || text[j] === '{' || text[j] === ',';
}

// 参与比较或匹配的字面量（e.includes("Stream idle timeout")、x==="Done"、case "Foo":）
// 是程序逻辑而非展示文案，替换后会改变行为。
const COMPARE_BEFORE_RE =
  /(?:[!=]==?|\bcase|\.(?:includes|startsWith|endsWith|indexOf|lastIndexOf|has|get|delete|match|matchAll|search|split|replace|replaceAll|test|getItem|setItem|removeItem|querySelector|querySelectorAll|getAttribute|setAttribute|addEventListener|removeEventListener|on|off|emit)\()\s*$/;
function isComparisonContext(text, literalStart, literalEnd) {
  if (COMPARE_BEFORE_RE.test(text.slice(Math.max(0, literalStart - 40), literalStart))) return true;
  return /^\s*[!=]==?/.test(text.slice(literalEnd, literalEnd + 8));
}

function escapeForQuote(s, quote) {
  let out = s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n');
  out = out.split(quote).join('\\' + quote);
  if (quote === '`') out = out.replace(/\$\{/g, '\\${');
  return out;
}

function literalHash(source) {
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex');
}

// hardcoded.json 只保存原文指纹，因此哈希规则也必须执行与明文规则相同的高危词过滤。
const STRUCTURAL_HASHES = new Set(
  [...STRUCTURAL_LITERALS].map((source) => `${Buffer.byteLength(source, 'utf8')}:${literalHash(source)}`),
);

function isStructuralHashSource(source) {
  return STRUCTURAL_HASHES.has(`${Number(source.bytes)}:${String(source.sha256 || '').toLowerCase()}`);
}

function addHashedRule(hashed, source, target) {
  const bytes = Number(source.bytes);
  const hash = String(source.sha256 || '').toLowerCase();
  if (!Number.isSafeInteger(bytes) || bytes < 0 || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error('硬编码文案哈希规则无效');
  }
  let bucket = hashed.get(bytes);
  if (!bucket) {
    bucket = new Map();
    hashed.set(bytes, bucket);
  }
  bucket.set(hash, target);
}

function compileHardcodedRules(pairs) {
  const plain = new Map();
  const hashed = new Map();
  const direct = [];
  for (const item of pairs) {
    if (!Array.isArray(item) || item.length !== 2) continue;
    const sourceValue = item[0];
    const target = String(item[1]);
    if (sourceValue && typeof sourceValue === 'object' && !Array.isArray(sourceValue)) {
      if (isStructuralHashSource(sourceValue)) continue;
      addHashedRule(hashed, sourceValue, target);
      continue;
    }
    const source = String(sourceValue);
    if (!source || source === target || isStructuralSource(source)) continue;
    if (isPlainUiText(source)) plain.set(source, target);
    else direct.push([source, target]);
  }
  direct.sort((a, b) => b[0].length - a[0].length);
  return { plain, hashed, direct };
}

// 单次扫描所有简单字符串字面量（不含转义和模板插值），命中词表则替换。
const LITERAL_RE = /"([^"\\\n]{1,300})"|'([^'\\\n]{1,300})'|`([^`\\$]{1,300})`/g;

function patchHardcoded(text, rules) {
  let count = 0;
  let out = text;
  if (rules.direct.length) {
    for (const [source, target] of rules.direct) {
      if (!out.includes(source)) continue;
      const parts = out.split(source);
      count += parts.length - 1;
      out = parts.join(target);
    }
  }
  if (rules.plain.size || rules.hashed?.size) {
    const src = out;
    out = src.replace(LITERAL_RE, (m, d, s, b, index) => {
      const content = d ?? s ?? b;
      let target = rules.plain.get(content);
      if (target === undefined && rules.hashed?.size) {
        const bucket = rules.hashed.get(Buffer.byteLength(content, 'utf8'));
        if (bucket) target = bucket.get(literalHash(content));
      }
      if (target === undefined) return m;
      const end = index + m.length;
      if (isObjectKey(src, index, end) || isComparisonContext(src, index, end) || isStructuralContext(src, index)) return m;
      const q = m[0];
      count++;
      return q + escapeForQuote(target, q) + q;
    });
  }
  return { text: out, count };
}

module.exports = {
  MANAGED_LANGS,
  WHITELIST_ANCHOR,
  patchWhitelist,
  patchDisplayNames,
  DISPLAY_NAME_MARKER,
  compileHardcodedRules,
  patchHardcoded,
  literalHash,
  isStructuralContext,
  isComparisonContext,
};
