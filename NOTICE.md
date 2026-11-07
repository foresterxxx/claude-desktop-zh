# 第三方声明与致谢（NOTICE）

本项目以 MIT License 发布（见 [LICENSE](LICENSE)）。项目中包含或参考了以下第三方成果，
它们各自的版权与许可声明如下，再分发本项目时请一并保留本文件。

## 1. javaht/claude-desktop-zh-cn

- 项目地址：<https://github.com/javaht/claude-desktop-zh-cn>
- 许可证：MIT License
- 参考版本：commit `7a36e64c4b7c835b164810609f9872e39b2c78c9`（2026-11-06）

**本项目中来源于该项目的内容：**

| 本项目文件 | 来源文件 | 说明 |
| --- | --- | --- |
| `locales/<lang>/frontend.json` | `resources/frontend-<lang>.json` | 前端界面翻译，原样收录 |
| `locales/<lang>/dynamic.json` | `resources/dynamic-<lang>.json` | 前端动态词库翻译，原样收录 |
| `locales/<lang>/desktop.json` | `resources/desktop-<lang>.json` | 桌面壳层翻译，原样收录 |
| `locales/<lang>/hardcoded.json` | `resources/frontend-hardcoded-<lang>.json` | 硬编码文案映射，原样收录 |
| `src/frontend.js` 中的结构性词汇跳过表与图标/枚举上下文正则 | `scripts/install_windows.ps1` | 移植为 JavaScript，并增加了比较/对象键上下文保护 |
| `src/integrity.js` 中 Claude.exe 完整性标记的几种写法、Electron Framework 摘要槽位算法 | `scripts/install_windows.ps1`、`scripts/patch_claude_zh_cn.py` | 思路参考，代码重新实现 |
| `src/platform.js` 中 macOS ad-hoc 重签名流程（entitlements 处理、identifier 级 DR） | `scripts/patch_claude_zh_cn.py` | 思路参考，代码重新实现 |

其余代码（asar 流式读写、安装/备份/恢复流程、CLI、测试、隔离测试工具等）以及
`locales/<lang>/supplement.json` 中的补充翻译为本项目原创。

原项目许可声明全文：

```
MIT License

Copyright (c) 2025 javaht

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. 调研过但未使用其代码的项目

以下项目在调研阶段参考过公开说明，**未复制其任何代码或翻译**，在此致谢：

- [LifeActor/Claude_zh-CN_LanguagePack](https://github.com/LifeActor/Claude_zh-CN_LanguagePack)（CC BY-NC-SA 4.0，非商业 + 相同方式共享，与 MIT 不兼容，因此未采用其内容）
- [ldk-tokyo/claude-desktop-zh-cn](https://github.com/ldk-tokyo/claude-desktop-zh-cn)（仓库未声明许可证，默认保留所有权利，因此未采用其内容）
- [CGxiao5/claude-desktop-zh](https://github.com/CGxiao5/claude-desktop-zh)（MIT）

## 3. 商标与免责声明

- “Claude”“Claude Desktop”“Anthropic” 是 Anthropic PBC 的商标。本项目是社区非官方项目，
  与 Anthropic 无任何关联，也未获得其认可或支持。
- 本项目**不包含、不分发** Claude Desktop 的任何程序文件或英文原始词库；
  所有补丁均在用户本机、基于用户自己安装的客户端生成。
- 修改客户端文件可能违反相关服务条款、导致数字签名失效或部分功能（如 Cowork 沙盒）不可用。
  请自行评估风险，使用本项目即表示你理解并接受这些风险。
