# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。

## [Unreleased]

- 终端多行 SQL 的分段执行与提示符等待（当前依赖 mysql 客户端的 `;` 结束符）
- 讲解 / 复盘结果按题目指纹缓存

## [beta 0.3.2] - 2026-11-22

首个 beta：把「写入是否真的生效」从假设变成判据。原先的 `0.3.2` → `0.3.5` 编号作废，全部修复并入本版。

### Fixed

- **OJ 型实训区「写入无反应，插件却报写入完成」**。根因是判据只看一条通道：写入走实例 API，回读也走同一个实例，写进去就"一致"。
  - **可见性闸门覆盖全部编辑器类型**：CM5 / CM6 / ACE / Monaco 之前完全没有闸门，命中的可能是上一道题遗留的隐藏实例（写了、回读一致、屏幕没变）；现在统一要求可见、有面积、`checkVisibility` 通过，隐藏实例只出现在诊断候选里并标 `[隐藏]`。
  - **写入判据改为双视角**：文档值（实例 / value）+ 屏幕渲染文本（`.CodeMirror-code` / `.cm-content` / `.ace_text-layer` / `.view-lines`）。文档变了但渲染没变判 `render-stale`，视为失败并升级到受信任键入。
  - **写入报成功后另起一次读取复核**：不再复用写入那条通道的回包。
  - **跨帧按候选打分挑编辑器**（可见性、面积、渲染文本、离评测按钮距离），不再只按回读代码长度排序——OJ 页面里的题面搜索框、隐藏模板 textarea 都可能更长。
- **OJ 型实训区的残留代码**：受信任输入前先 Ctrl+A 全选再插入，整篇替换；逐键降级前先清空，旧代码不会和新代码拼在一起。
- **终端误判**：只有真正的 xterm 结构（`.xterm-rows` / `.xterm-screen` / `.xterm-helper-textarea`）才算终端；类名里带 `terminal` / `console` 的评测结果面板不再被当成终端。
- **Monaco 认不出来（`编辑器 未找到` / `可写 0`）**。平台把 Monaco 打成模块，`window.monaco` 不存在：
  - 改为**按 DOM 结构识别**：`.monaco-editor`、`.view-lines`、`.margin-view-overlays`、`.monaco-scrollable-element` 任一出现即认；容器类名被改过时用「同时含 `.view-lines` 与 `.inputarea` 的最近祖先」反推。
  - Monaco 的输入 textarea 天生 1×1，可见性闸门改成看**容器**尺寸，不再按输入框尺寸判隐藏。
  - 没有全局实例时读不到 model：新增 `docKnown`，只按屏幕渲染文本校验，不再拿空文档值比对而误判 `doc-mismatch`；写入直接走受信任键入。
  - **特征行判定收紧**：只有 ≥ 12 个非空白字符的行参与命中，`int main() {` 这类模板通用短行不再把残留模板命中成新代码；命中判定最多扫 40 行。
- **`Ctrl+A` 选中题面而不是答题区**。根因：焦点操作没有验证——`focus` 只要调过 `textarea.focus()` 就返回成功，而 Monaco 的 1×1 输入框经常接不住焦点，`document.activeElement` 仍在 body 上，CDP 的 Ctrl+A 就作用到整页。
  - `focus` 改为用 `document.activeElement` 归属校验，返回真实焦点状态与活动元素摘要（`body` / `div.question-desc` 之类）；
  - 焦点不在编辑器时，按探针给出的正文坐标做一次 **CDP 真实点击**（`Input.dispatchMouseEvent`，`isTrusted=true`），再复查；
  - 仍不成立就**中止**并提示「在右侧编辑区点一下代码」，不再盲发 Ctrl+A；Ctrl+A 之前、逐键降级之前各再校验一次焦点；
  - 先 `requestEditor()` 定帧，再发 `focus`，避免焦点送进另一帧的输入框。
- **焦点误判：编辑器里有光标，却报「拿不到焦点（当前焦点：textarea.inputarea… 1×1）」**。
  - 根因：容器用 `closest('[class*="monaco"]')` 选，而 `.view-lines` 自己的 class 里就带 `monaco`，**自匹配**把容器选成了 `.view-lines`；Monaco 的输入 textarea 是它的**兄弟节点**，`host.contains(activeElement)` 永远 false。
  - 容器改为「最近的、同时含有 `.view-lines` 与 `textarea.inputarea` 的祖先」，`.monaco-editor` 优先；`walkUpSized` 从父节点起步，不再自匹配。
  - 焦点判定改为三层，任一成立即算在编辑器里：容器包含活动元素 / 容器的**编辑器根**（`.monaco-editor`、`.CodeMirror`、`.cm-editor`、`.ace_editor`）包含它 / 两者属于同一个编辑器根。
- **`insertText` 未通过校验时不降级**：原来要求"文档和插入前一样"才逐键重打，模块化 Monaco 没有文档视角，永远满足不了。现在只要代码 ≤ 1200 字符就清空 + 逐键重打（清空在前，不会拼接）。
- **写入广播弄丢帧钉**：写入失败广播后没有重新钉住回包帧，后续 `focus` / `active` / 按键可能发到别的帧。现在按「报成功优先，否则报失败的那一帧」重新钉住。
- 报错文案去重：同一条详情不再重复三次。

### Added

- 受信任输入的 `selectAll`（Ctrl+A 整篇替换）与 `clearFirst`（清空后逐键）两种模式。
- 后台消息 `inject:click`：CDP 真实鼠标点击，仅在回包帧是顶层文档时使用（只有顶层坐标等于标签页视口坐标）。
- 只读跨帧 op `active`：只回答"焦点现在在哪、在不在编辑器里"。
- 诊断区新增「写入校验」行；候选行带 `*` 选中标记、`[隐藏]`、`doc=?`（读不到文档值）与「未识别:」兜底列表。
- `INJECT_MISMATCH` 报错附带判据、可见性与候选摘要；非终端编辑器在插入后仍读不到屏幕文本时按失败处理，不再静默通过。

### Changed

- 版本号统一为 **beta 0.3.2**：`package.json` 仍用数字 `0.3.2`（Chrome 清单只接受数字版本），展示名走清单的 `version_name: "beta 0.3.2"`，面板标题显示 `beta 0.3.2`。
- 旧的 `0.3.1`–`0.3.5` 构建包已删除，只保留一个 `educoder-study-assistant-v0.3.2-beta.zip`。

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
