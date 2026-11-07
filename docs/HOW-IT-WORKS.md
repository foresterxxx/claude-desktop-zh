# 工作原理

本文说明 claude-desktop-zh 改了什么、为什么这样改，方便审阅与在客户端格式变化时维护。

## Claude Desktop 的结构（4.29+）

```
resources/
├── app.asar          主进程（Electron main），包含桌面壳层词库 resources/i18n/*.json
├── app.asar.unpacked 原生模块等不能放进 asar 的文件
└── ion-dist.asar     前端（React 应用），包含 i18n/*.json、i18n/dynamic/*.json 与 assets/v1/*.js
claude.exe            Windows：内嵌两个 asar 的 header SHA256
Info.plist            macOS：ElectronAsarIntegrity 字典
```

Electron 开启了 `EnableEmbeddedAsarIntegrityValidation`：启动时会校验 asar header 的 SHA256，
读取文件时还会按 4MB 分块校验每个文件的 integrity。任意改动 asar 都必须同步这两层哈希，否则应用直接退出。

## 补丁步骤

### 1. 备份

首次安装把 `claude.exe`、`app.asar`、`ion-dist.asar` 复制到数据目录（macOS 额外用 `ditto` 整包备份，
因为重签名会改动包内所有二进制）。`state.json` 记录每个文件原版与补丁版的 SHA256。

之后每次安装都**以备份为输入**重新生成，因此：

- 重复安装、切换语言是幂等的；
- 如果检测到安装目录中的文件既不是原版也不是上次的补丁版（例如客户端原地更新、或被其他工具改过），会重新备份；
- 首次备份前会检查是否残留其他汉化补丁（`ion-dist.asar` 中已有 `i18n/zh-*.json`），避免把被改过的文件当成原版。

### 2. 生成新的 asar

`src/asar.js` 实现了流式重写：

1. 解析原 header（Chromium Pickle：`[4][headerSize][payloadSize][jsonLength][json][padding]`）；
2. 把要替换/新增的条目写入 header（新内容计算整文件与分块 SHA256）；
3. 按原偏移顺序重新分配偏移；
4. 写出新 header，然后逐个条目从原文件按字节拷贝或写入新内容。

`unpacked`、`link`、`executable` 等字段原样保留，因此可以安全修改主进程包 `app.asar`，不必解包再打包。

#### 前端（ion-dist.asar）

| 条目 | 处理 |
| --- | --- |
| `i18n/<lang>.json` | 以当前版本的 `en-US.json` 为骨架合并译文（未翻译 key 保留英文，已删除 key 丢弃） |
| `i18n/en-US.json` | 默认同样替换为中文（`--no-override` 时不改） |
| `i18n/dynamic/<lang>.json` / `en-US.json` | 同上；4.x 起前端会强制加载 dynamic 词库，缺失会导致整个语言包回退英文 |
| `assets/**/*.js` 中的语言白名单 | `["en-US","de-DE","fr-FR","ko-KR","ja-JP",...]` 末尾加入所选中文变体 |
| 含 `Intl.DisplayNames` 的 JS | 追加一段补丁，让 `zh-CN/zh-TW/zh-HK` 显示中文名称 |
| 硬编码文案（`--hardcoded`） | 见下节 |

#### 硬编码文案替换

一部分界面文字没有走 i18n，而是直接写在 JS 里。替换它们有风险——同样的字符串可能是图标名、枚举值、
事件名或用于错误匹配。本项目的策略：

- 只扫描**简单字符串字面量**（不含转义与模板插值），按字符串长度和 SHA-256 指纹命中词表后才替换，
  单次线性扫描；仓库不保存用于匹配的官方英文原文；
- 跳过：纯小写标识符（`tokens`、`hours`）、高危短词（`Search`、`Settings`、`Copy`……）、
  对象键（`{"Done":1}`）、比较与匹配（`x==="Done"`、`case "Done"`、`.includes("...")`）、
  图标/类型等语义位置（`icon:"Add"`、`type:"Folder"` 及三元/默认值变体）；
- 不再对整段压缩代码做直接替换；这会牺牲少量覆盖率，但能降低误替换风险，并避免分发客户端原文片段。

### 3. 写入与完整性同步

- **Windows**：只对上述 3 个文件执行 `takeown /A` + `icacls /grant Administrators:F`（MSIX 目录默认归
  TrustedInstaller 所有），写入新 asar，再在 `claude.exe` 中定位
  `{"file":"resources\\app.asar","alg":"SHA256","value":"…"}` 并原地改写 64 字节哈希。
  写入前会先只读确认所有标记都能找到，避免出现“asar 已改、哈希没写回”的半坏状态。
- **macOS**：更新 `Info.plist` 的 `ElectronAsarIntegrity`；Electron 37+ 还会在 Electron Framework 中
  预埋整个字典的摘要（以 `AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A` 为标记），一并更新。随后做本机 ad-hoc
  重签名：保留各二进制原有 entitlements（去掉 team/keychain 相关项，加入 `disable-library-validation`），
  外层 app 使用 `identifier` 级 designated requirement，使官方自动更新仍可安装。

任一步骤失败都会从备份回滚。

### 4. 语言设置

把 `config.json` 中的 `locale` 改为所选语言。官方账号模式的数据目录是 `%APPDATA%\Claude`，
第三方 API（网关 / Bedrock / Vertex）模式是 `%LOCALAPPDATA%\Claude-3p`；MSIX 版还可能被虚拟化到
`%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude`。工具会处理所有存在的位置。

## 恢复

把备份复制回安装目录（macOS 为整包替换），Windows 上把文件所有权交还 `NT SERVICE\TrustedInstaller`
并移除额外授予的权限，`locale` 改回 `en-US`，删除备份与状态。

## 客户端格式变化时如何排查

1. `node bin/claude-zh.js install --dry-run`：只生成文件，观察哪一步报错；
2. 语言白名单：在 `ion-dist.asar` 的 JS 中搜索 `"en-US","de-DE","fr-FR"`；
3. 完整性标记：在 `claude.exe` 中搜索 `"alg":"SHA256"`；
4. 词库位置：`ion-dist.asar` 的 `i18n/`、`app.asar` 的 `resources/i18n/`。

## 在不影响日常使用的情况下验收

签名版 Claude 会忽略 `--user-data-dir` 与 `CLAUDE_USER_DATA_DIR`，同一数据目录只允许一个实例，
且带调试参数时拒绝启动。`tools/sandbox.js` 可以在**安装目录的副本**上注入独立数据目录，
启动一个与日常客户端完全隔离的实例：

```powershell
# 1. 复制安装目录（路径按实际版本修改）
robocopy "C:\Program Files\WindowsApps\Claude_<版本>_x64__pzs8sxrjxfjjc\app" C:\zhtest\app /E
# 2. 对副本安装补丁（CLAUDE_ZH_HOME 让备份与状态也和正式环境隔离）
$env:CLAUDE_ZH_HOME = "C:\zhtest\data"
node bin/claude-zh.js install --app-dir C:\zhtest\app --no-locale
# 3. 启动隔离实例并截图
node tools/sandbox.js C:\zhtest\app C:\zhtest\profile --lang zh-CN
powershell -ExecutionPolicy Bypass -File tools\capture-window.ps1 -PathLike "*zhtest*" -Out shot.png
```

`tools/sandbox.js` 会拒绝对正式安装目录运行。
