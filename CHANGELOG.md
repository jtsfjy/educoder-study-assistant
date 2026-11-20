# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。

## [Unreleased]

- 终端多行 SQL 的分段执行与提示符等待（当前依赖 mysql 客户端的 `;` 结束符）
- 讲解 / 复盘结果按题目指纹缓存

## [0.3.1] - 2026-11-20

### Added

- 「SQL 前置语句」设置：终端型编辑器在键入代码前先执行建库/切库语句，默认 `CREATE DATABASE IF NOT EXISTS MyDb;` + `USE MyDb;`，可开关、可编辑。

## [0.3.0] - 2026-11-20

### Added

- 「终端前置命令」设置：终端任务先执行 shell 命令（默认 `mysql -h127.0.0.1 -uroot -p123123`），再键入代码。
- 终端环境下的提示词约束：已登录数据库时，要求模型只输出 SQL，不写登录/连接命令。

### Changed

- 终端写入不再做屏幕文本校验（canvas 渲染读不到文本），写入结果交由评测判定。

## [0.2.9] - 2026-11-20

### Added

- CDP 逐键键入模式（`mode: 'keys'`）：逐字符 `keyDown`/`keyUp`，换行发 `Enter`；终端首次 `insertText` 无变化时自动降级。
- 失败信息附带屏幕字数变化（`A → B 字`），用于区分「完全没输入」与「输入了不回显」。

### Fixed

- 逐键模式结束后无论代码是否以换行结尾，都补一次回车。

## [0.2.8] - 2026-11-20

### Added

- 终端（xterm）适配：识别 `.xterm` / `[class*=terminal]`，读取屏幕文本，写入走受信任键入 + 回车执行。
- 终端分支的焦点处理：焦点交给 xterm 的辅助 textarea。

## [0.2.7] - 2026-11-20

### Added

- 编辑器可见性闸门：宽 ≥ 80px、高 ≥ 18px、在视口内有占位、`display/visibility` 正常才算可写目标。
- 诊断区「候选」行：列出所有疑似编辑器元素的标签、类名与实际尺寸。

### Fixed

- 不再把 xterm 的 1×1 辅助输入框当作编辑器写入（表现为「写入成功、页面无反应」）。

## [0.2.6] - 2026-11-20

### Added

- CDP 受信任输入（`Input.insertText`，`isTrusted=true`）：常规写入回读不一致时自动降级；新增 `debugger` 权限与 `useTrustedInput` 开关。
- 受信任输入后仍做回读校验，失败时明确报「页面可能在回滚」。

## [0.2.5] - 2026-11-20

### Added

- 写入多策略：新增 `contenteditable` 适配器与 `execCommand('insertText')` 输入管线，失败再退原生 setter。
- `deepQuery()`：向下穿透最多 3 层 open shadow root 查找编辑器。
- 写入后 120ms 二次回读，捕获「先接受、随后回滚」。

### Changed

- `INJECT_MISMATCH` 报错附带策略名、编辑器类型与六个探测位。

## [0.2.4] - 2026-11-20

### Added

- 探针在每一帧监听（含顶层文档），修复编辑器内嵌在顶层时 `NO_EDITOR` 的问题。
- `match_about_blank`：覆盖 `about:blank` / `srcdoc` 帧。
- 诊断区显示 `iframe 数 · 回包数 · 可写数` 三个独立数字。
- 面板标题显示扩展版本号，便于确认加载的是哪一版。

### Changed

- 编辑器重探次数 2 → 4 次。

## [0.2.3] - 2026-11-20

### Fixed

- top 内容脚本匹配 `/tasks/*`，修复进入子网页后面板消失。
- 题面反复读取：
  - URL 判断改用 `origin + pathname`，query 抖动不再触发重读；
  - 自动读取只在实训题页面启动，读取成功后立即停止；
  - 重试退避 1.5s / 3s / 4.5s，上限 3 次后停止并提示手动重读；
  - 编辑器未连上时只重探编辑器，不重复抽题。

## [0.2.2] - 2026-11-20

### Added

- `optional_host_permissions` 与设置页运行时域名授权，修复自定义网关的 `Failed to fetch`。
- 后台在 fetch 前检查 host 权限，未授权时返回可读的 `NO_HOST_PERMISSION`。

### Changed

- 401 报错附带本次请求的 endpoint 与模型名；`TypeError` 统一转为 `NETWORK_ERROR` 并带完整 URL。

## [0.2.1] - 2026-11-20

### Added

- 悬浮面板诊断区与只读自检（帧数、可写数、编辑器类型、评测按钮、结果区、答案库、开关）。
- 跨帧协议新增 `diagnose` 操作。

## [0.2.0] - 2026-11-20

### Added

- 自动注入：CodeMirror 5/6、ACE、Monaco、textarea 写入 + 回读校验。
- 自动提交：按钮打分定位、真实指针序列点击、结果区扫描与结论分类。
- 失败回灌重试（`1 + maxRetries` 轮），限流即中止。
- 本地答案库：按指纹 + 语言缓存通过代码，上限 200 条，30 天过期。
- 设置项 `autoInject` / `autoSubmit` / `useAnswerCache`。

### Fixed

- 设置页保存被拒（「设置只能在扩展选项页修改」）：来源判定从 `sender.tab` 改为 `origin/url` 前缀匹配。

### Changed

- 探针改为 `.iife.ts`，打成自包含 IIFE，避免 MAIN world 的 ESM 加载被 CSP 拦截。

## [0.1.0] - 2026-11-20

### Added

- 题面结构化抽取：候选选择器打分 + 语义锚点切段 + SHA-256 结构指纹。
- Shadow DOM 悬浮面板：题面、输入输出规格、样例、约束、模板预览。
- 分步讲解与代码复盘（只读页面，不写入、不提交）。
- 设置页：提供商 / 接口地址 / Key / 模型 / 温度 / token / 间隔 / 重试 / 测试连接。
- 密钥隔离：`chrome.storage.local` 收紧为 `TRUSTED_CONTEXTS`，内容脚本只拿到剥离 Key 的版本。
- 串行限流闸门与按语言分配的 token 预算。
