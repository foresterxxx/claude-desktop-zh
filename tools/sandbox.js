#!/usr/bin/env node
'use strict';

// 开发者测试工具：在“Claude 安装目录的副本”上启动一个与正式客户端完全隔离的实例，
// 用于在不退出日常使用的 Claude 的情况下验收汉化效果。
//
// 原理：签名版 Claude 会忽略 --user-data-dir / CLAUDE_USER_DATA_DIR，且同一 userData 下只允许
// 一个实例。这里向副本的 app.asar 主入口注入 app.setPath('userData'/'appData')，并同步 exe 中的
// 完整性哈希，使副本拥有独立的数据目录。
//
// 警告：只能用于副本！不要对正式安装目录运行。
//
// 用法（Windows）：
//   xcopy /E /I "C:\Program Files\WindowsApps\Claude_x.y.z_x64__pzs8sxrjxfjjc\app" C:\zhtest\app
//   node bin/claude-zh.js install --app-dir C:\zhtest\app --no-locale   (配合 CLAUDE_ZH_HOME 隔离备份目录)
//   node tools/sandbox.js C:\zhtest\app C:\zhtest\profile [--lang zh-CN]

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const asar = require('../src/asar');
const integrity = require('../src/integrity');

const MARKER = '/*claude-desktop-zh-sandbox-v3*/';

function main() {
  const [appDir, profileDir] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const langIdx = process.argv.indexOf('--lang');
  const lang = langIdx > 0 ? process.argv[langIdx + 1] : null;
  if (!appDir || !profileDir) {
    console.log('用法：node tools/sandbox.js <Claude 副本 app 目录> <独立配置目录> [--lang zh-CN]');
    return 2;
  }
  if (/WindowsApps|AnthropicClaude|\/Applications\/Claude\.app/i.test(path.resolve(appDir))) {
    console.error('拒绝执行：这看起来是正式安装目录。请先复制一份再测试。');
    return 1;
  }
  const exe = path.join(appDir, 'claude.exe');
  const appAsar = path.join(appDir, 'resources', 'app.asar');
  const arc = asar.readArchive(appAsar);
  const pkg = JSON.parse(asar.readEntry(arc, 'package.json').toString('utf8'));
  const main = pkg.main.replace(/^\.\//, '');
  const original = asar.readEntry(arc, main).toString('utf8');
  if (!original.includes(MARKER)) {
    const inject =
      `${MARKER}try{const{app:a}=require("electron"),p=require("path"),d=process.env.CLAUDE_ZH_SANDBOX;` +
      'if(d){const sp=a.setPath.bind(a);a.setPath=(k,v)=>sp(k,k==="userData"?p.join(d,"AppData",p.basename(v)):k==="appData"?p.join(d,"AppData"):v);' +
      'a.setPath("appData","");a.setPath("userData","Claude");' +
      'const f=require("fs"),L=(m)=>{try{f.appendFileSync(p.join(d,"sandbox.log"),new Date().toISOString()+" "+m+"\\n")}catch{}};' +
      'L("started userData="+a.getPath("userData"));' +
      'for(const k of ["quit","exit"]){const o=a[k].bind(a);a[k]=(...x)=>{L(k+" called\\n"+new Error().stack);return o(...x)}}' +
      '{const r=a.requestSingleInstanceLock.bind(a);a.requestSingleInstanceLock=(...x)=>{const v=r(...x);L("singleInstanceLock="+v+" userData="+a.getPath("userData"));return v}}' +
      'process.on("exit",(c)=>L("process exit "+c));}}catch(e){}';
    const patched = original.replace(/^("use strict";)?/, (m) => m + inject);
    const tmp = `${appAsar}.sandbox`;
    const { hash } = asar.writeArchive(arc, tmp, new Map([[main, Buffer.from(patched, 'utf8')]]));
    fs.renameSync(tmp, appAsar);
    integrity.writeExeHashes(exe, { 'app.asar': hash });
    console.log('已向副本注入独立数据目录支持');
  }
  const profile = path.resolve(profileDir);
  for (const name of ['Claude', 'Claude-3p']) {
    const dir = path.join(profile, 'AppData', name);
    fs.mkdirSync(dir, { recursive: true });
    if (!lang) continue;
    const cfg = path.join(dir, 'config.json');
    const data = fs.existsSync(cfg) ? JSON.parse(fs.readFileSync(cfg, 'utf8')) : {};
    data.locale = lang;
    fs.writeFileSync(cfg, JSON.stringify(data, null, 2));
  }
  const child = spawn(exe, [], {
    cwd: appDir,
    env: { ...process.env, CLAUDE_ZH_SANDBOX: profile },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  console.log(`已启动隔离实例（PID ${child.pid}），数据目录：${profile}`);
  return 0;
}

process.exitCode = main();
