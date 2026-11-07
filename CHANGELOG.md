# 更新日志

## 1.0.1 - 2026-11-07

- 修复 `--hardcoded` 将连接器职业枚举 `Software Engineer` 当作界面文案翻译，导致“技能 / 连接器 / 插件”设置页崩溃的问题。
- 哈希硬编码词表现在与明文规则共用高危结构性词汇过滤，避免词表指纹绕过枚举保护。

## 1.0.0 - 2026-11-07

首个版本。

- 支持简体中文、繁體中文（台灣）、繁體中文（香港）。
- 零依赖的 asar 流式读写，保留 unpacked / executable 元数据并重新计算 integrity。
- 同步 Windows `claude.exe` 与 macOS `Info.plist` / Electron Framework 中的 ASAR 完整性哈希。
- 首次安装自动备份，重复安装基于原版重新生成；写入失败自动回滚；`restore` 逐字节还原。
- 同时处理官方账号模式（`Claude`）与第三方 API 模式（`Claude-3p`）的配置目录。
- 可选的硬编码文案替换（`--hardcoded`），带比较 / 对象键 / 图标类型上下文保护。
- 硬编码匹配源改用不可逆 SHA-256 指纹，仓库不再保存对应的官方英文原文。
- 补充思考状态、思考耗时与思考过程标签的简体和繁体中文翻译。
- `coverage` 覆盖率统计与未翻译条目导出；`tools/check-locales.js` ICU 占位符检查。
- 提供 Windows / macOS 一键卸载入口，恢复官方原版并清理补丁状态。
- 增加法律与商标边界说明，以及客户端文件、视觉素材、明文匹配源和常见密钥的发布检查。
- 补充翻译 15 条（`supplement.json`），桌面壳层覆盖率 98.2% → 99.7%，dynamic 词库 100%。
- 开发工具：`tools/sandbox.js` 在安装目录副本上启动隔离实例用于验收。
- 已验证：Windows / Claude Desktop 4.4212.0。macOS 为实验性支持。
