#!/usr/bin/env node
'use strict';

const path = require('path');
const patcher = require('../src/patcher');
const { LANGUAGES } = require('../src/locales');
const pkg = require('../package.json');

const HELP = `claude-desktop-zh v${pkg.version} —— Claude Desktop 中文界面补丁

用法：
  node bin/claude-zh.js <命令> [选项]

命令：
  install            安装中文补丁（默认简体中文）
  restore            恢复官方原版
  status             查看当前安装与汉化状态
  coverage           统计当前客户端版本的翻译覆盖率

选项：
  --lang <代码>      语言：${Object.entries(LANGUAGES).map(([k, v]) => `${k}（${v.label}）`).join('、')}
  --app-dir <目录>   手动指定 Claude 安装目录（Windows 为包含 claude.exe 的 app 目录，macOS 为 Claude.app）
  --no-override      不覆盖 en-US 词库，仅注册独立的中文语言选项
  --no-locale        不修改 Claude 用户配置中的 locale
  --hardcoded        额外替换前端未走 i18n 的硬编码文案（覆盖更全，但随客户端更新风险更高）
  --kill             如果 Claude 正在运行，自动关闭它
  --force            检测到其他汉化补丁时仍然继续
  --dry-run          只生成补丁文件，不修改安装目录
  --out <文件>       coverage 命令：导出未翻译条目到 JSON 文件
  -h, --help         显示帮助
  -v, --version      显示版本

环境变量：
  CLAUDE_ZH_HOME     本工具的数据目录（备份与状态），默认在用户 AppData / Application Support 下
`;

function parseArgs(argv) {
  const opts = { override: true, lang: 'zh-CN' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`选项 ${a} 需要一个值`);
      return v;
    };
    switch (a) {
      case '--lang': opts.lang = next(); break;
      case '--app-dir': opts.appDir = path.resolve(next()); break;
      case '--out': opts.out = path.resolve(next()); break;
      case '--no-override': opts.override = false; break;
      case '--no-locale': opts.setLocale = false; break;
      case '--hardcoded': opts.hardcoded = true; break;
      case '--kill': opts.kill = true; break;
      case '--force': opts.force = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '-h': case '--help': opts.help = true; break;
      case '-v': case '--version': opts.version = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`未知选项：${a}`);
        rest.push(a);
    }
  }
  return { cmd: rest[0], opts };
}

function main() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 18) {
    console.error(`需要 Node.js 18 或更高版本，当前为 ${process.versions.node}`);
    return 1;
  }
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  const { cmd, opts } = parsed;
  if (opts.version) {
    console.log(pkg.version);
    return 0;
  }
  if (opts.help || !cmd) {
    console.log(HELP);
    return cmd || opts.help ? 0 : 2;
  }
  const commands = {
    install: patcher.install,
    restore: patcher.restore,
    status: patcher.status,
    coverage: patcher.coverageReport,
  };
  const fn = commands[cmd];
  if (!fn) {
    console.error(`未知命令：${cmd}\n`);
    console.log(HELP);
    return 2;
  }
  try {
    fn(opts);
    return 0;
  } catch (e) {
    console.error(`\n[错误] ${e.message}`);
    if (process.env.CLAUDE_ZH_DEBUG) console.error(e.stack);
    if (e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'EBUSY') {
      console.error('提示：请确认 Claude 已完全退出，并以管理员身份（Windows）或 sudo（macOS）运行。');
    }
    return 1;
  }
}

process.exitCode = main();
