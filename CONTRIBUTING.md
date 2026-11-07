# 参与贡献

感谢你愿意改进 claude-desktop-zh！

## 修正或补充翻译

- **新增 / 修正个别词条**：请改 `locales/<lang>/supplement.json`（本项目原创翻译，优先级最高），
  按 `frontend` / `dynamic` / `desktop` 分区填写 `key: 译文`。
- 查找 key：运行 `node bin/claude-zh.js coverage --out missing.json` 导出当前客户端版本中未翻译的条目，
  或在本机客户端的 `en-US.json` 中搜索英文原文。
- 三种语言请尽量同步更新；繁體（台灣）与繁體（香港）用词有差异（如「網路 / 網絡」「帳號 / 帳戶」）。
- 保持 ICU 占位符不变：`{name}`、`{count, plural, ...}`、`<link>…</link>` 中的名称不能翻译或删除。
  提交前运行 `node tools/check-locales.js` 检查。

### 用词约定（简体）

| 英文 | 译法 |
| --- | --- |
| Claude、Claude Code、Cowork、Artifact、MCP | 保留英文 |
| Project | 项目 |
| Chat / Conversation | 聊天 / 对话 |
| Session | 会话 |
| Connector | 连接器 |
| Skill | 技能 |
| Settings | 设置 |
| Sign in / Log in | 登录 |
| you | 你（不用“您”） |

## 修改代码

```bash
npm test                                  # 单元测试（不需要安装 Claude，不会触碰本机客户端）
node bin/claude-zh.js install --dry-run   # 对本机客户端生成补丁但不写入
```

- 不引入运行时依赖，保持“下载即用”。
- 涉及 asar / 完整性哈希 / 硬编码替换规则的改动请附带测试。
- 不要提交 Claude Desktop 二进制、ASAR、官方英文词库、客户端截图或硬编码英文原文。
  新增硬编码翻译时只提交由 `SHA-256 + UTF-8 字节长度` 组成的匹配指纹和中文译文。
  可运行 `node tools/hash-hardcoded.js "英文原文" "中文译文"` 生成规则，英文只用于本机计算，不会写入仓库。
- 请在真实客户端上验收（推荐使用 `docs/HOW-IT-WORKS.md` 中的隔离实例方法），并在 PR 中写明客户端版本与平台。

## 反馈问题

请附上：

- 操作系统与 Claude Desktop 版本；
- `node bin/claude-zh.js status` 的输出；
- 完整的报错信息（设置环境变量 `CLAUDE_ZH_DEBUG=1` 可以输出调用栈）。

## 许可

提交的代码与翻译将以 MIT License 发布。请不要提交从许可证不兼容的项目
（例如 CC BY-NC-SA、未声明许可证的仓库）复制的内容，也不要提交 Claude Desktop 的原始程序文件或英文词库。
