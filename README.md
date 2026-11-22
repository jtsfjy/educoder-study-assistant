# 头歌学习助手 · educoder-study-assistant

头歌（Educoder）实训题的浏览器扩展：**题面抽取 → 代码生成 → 写入编辑器 → 自动点评测 → 失败回灌重试**，通过后按题目指纹把答案存进本地答案库，同题二次进入零 token。

- 形态：Chromium 扩展（Manifest V3），`minimum_chrome_version: 114`，Edge / Chrome 通用
- 仓库：<https://github.com/jtsfjy/educoder-study-assistant>
- 目标站点：`https://*.educoder.net/classrooms/*`、`https://*.educoder.net/tasks/*`（`.com` 同理）
- 当前版本：**beta 0.3.2** · 版本记录见 [CHANGELOG.md](./CHANGELOG.md)
- 状态：beta。功能可日常使用，接口与消息字段仍可能调整；清单里的数字版本是 `0.3.2`，展示名走 `version_name: "beta 0.3.2"`。
- 许可证：[MIT](./LICENSE)

---

## 特性

| 能力 | 说明 |
|---|---|
| 题面抽取 | 候选选择器打分 + 语义锚点切段 + 结构指纹，平台改版只维护一个文件 |
| 代码生成 | 兼容 OpenAI 协议：DeepSeek / Moonshot / 智谱 / OpenRouter / 本地 Ollama，自填 endpoint 与 Key |
| 多编辑器写入 | CodeMirror 5/6、ACE、Monaco（含平台打包、没有全局实例的 Monaco）、contenteditable、textarea；穿透 open shadow root |
| 写入校验 | 文档值 + 屏幕渲染双视角判定，报成功后另起一次读取复核；隐藏/陈旧实例不会误报成功 |
| 终端写入 | xterm 类终端走 CDP 真实键入 + 回车，支持数据库登录与建库前置 |
| 自动评测闭环 | 定位「评测/提交」按钮 → 读结果 → 结论分类 → 错误回灌重试 |
| 本地答案库 | 只缓存通过评测的代码，指纹+语言为键，上限 200 条，30 天过期 |
| 只读自检 | 面板一键看清：帧数量、可写帧、编辑器类型、评测按钮、结果区、候选元素尺寸 |
| 密钥隔离 | API Key 只存在于 service worker，页面与内容脚本都拿不到明文 |

---

## 快速开始

### 环境

- Node.js ≥ 20（开发用 24）
- pnpm ≥ 9
- Edge / Chrome（`minimum_chrome_version: 114`）

### 方式一：使用打包好的压缩包（只想用，不想构建）

1. 下载 `educoder-study-assistant-v0.3.x.zip`（GitHub Releases 附件，或从构建者处获取）；
2. 解压到任意目录——解压后应**直接看到 `manifest.json`**，不要再套一层文件夹；
3. 打开 `edge://extensions`（或 `chrome://extensions`），开启「开发人员模式」；
4. 点「加载解压缩的扩展」，选择第 2 步解压出来的目录；
5. 点扩展图标打开设置页，填接口地址 / API Key / 模型名，点「测试连接」；首次使用自定义网关会弹域名授权，选「允许」。

### 方式二：从源码构建

```bash
git clone https://github.com/jtsfjy/educoder-study-assistant.git
cd educoder-study-assistant
pnpm install --node-linker=hoisted   # 必须带这个参数，原因见「开发注意」
pnpm build                            # 产出 dist/
```

构建完成后按「方式一」第 3–5 步加载 `dist` 目录。

> 仓库**不提交** `node_modules/` 与 `dist/`（见 `.gitignore`），所以从源码走必须先构建。
>
> `pnpm build` = `vite build` + `node scripts/postbuild.mjs`。后者把 crxjs 产物里镜像源码路径的 `dist/src/` 拍平，并同步改写 manifest，发布包结构为：
>
> ```
> manifest.json  probe.iife.js  service-worker-loader.js
> assets/  icons/  options/
> ```
>
> 打发布包：`Compress-Archive -Path dist\* -DestinationPath educoder-study-assistant-v<版本>.zip`。

### 更新到新版本

```bash
git pull
pnpm install --node-linker=hoisted   # 依赖有变动时才需要
pnpm build
```

然后回到 `edge://extensions`，点该扩展卡片上的**重新加载**按钮（改动 `manifest` 后必须重新加载，仅刷新页面不生效）。

---

## 使用

打开一道实训题（`/classrooms/…/shixun_homework/…` 或 `/tasks/…`），右上角出现悬浮面板：

| 按钮 | 作用 |
|---|---|
| **自动解题** | 生成 → 写入 → 回读校验 → 点评测 → 读结论；未通过按评测信息回灌重试 |
| **讲解思路** | 分步提示与易错点，不给可提交的完整答案 |
| **复盘代码** | 检查你当前写的代码：现象 → 原因 → 修改方向 |
| **重新抽取** | 手动重读题面（自动读取成功后不再自动重跑） |
| **自检** | 只读诊断，见下 |

### 诊断区

每次抽题后自动跑一次自检，也可手动点「自检」：

```
选择器   2026-11-20.1
实训帧   2 个 iframe · 回包 2 · 可写 1
编辑器   终端（xterm）
评测按钮 已找到「评测」
候选     textarea:textarea.xterm-helper-textarea 10×19 | term:div.terminal.xterm 912×591
结果区   空
写入校验 未写入
答案库   3 条
开关     写入开 · 评测开 · 缓存开
```

- `可写 0`：探针没连上可见编辑器（帧未注入 / 编辑器不可见 / 只找到隐藏实例）；
- `候选` 一行列出页面上所有疑似编辑器元素的**标签、类名、实际尺寸、文档长度、渲染长度**；`*` 是本次选中的目标，`[隐藏]` 是可见性闸门挡掉的实例，`doc=?` 表示这个编辑器读不到文档值（平台打包的 Monaco）；一个可见候选都没有时会追加「未识别:」并把长得像编辑器的可见元素列出来；
- `写入校验` 一行显示最近一次写入走通的路径与判据（`verified` / `noop` / `render-stale` / `render-blind`）。

### 状态与原因码

| 提示 | 含义 |
|---|---|
| `NO_EDITOR` | 没有任何一帧交出**可见**的编辑器（隐藏实例不算） |
| `INJECT_MISMATCH` | 双视角校验没过：附判据、策略名、编辑器类型、候选摘要 |
| `render-stale` | 文档值变了但屏幕没变：命中隐藏/陈旧实例，已自动降级 |
| `editor-hidden` | 命中的编辑器不可见，直接不写 |
| `render-blind` | 读不到渲染文本（canvas/虚拟化），按可见性 + 文档视角判定 |
| `FOCUS_LOST`（报错文案） | 焦点不在编辑器里：此时 Ctrl+A 会选中整页，扩展直接中止，不发送按键 |
| `COMPILE_ERROR` / `WRONG_ANSWER` / `RUNTIME_ERROR` | 评测结论分类 |
| `触发评测频率限制` | 平台限流，直接中止本轮 |
| `评测通过（第 N 轮）` | 闭环完成，代码已写入答案库 |

---

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `provider` | `openai-compatible` | 兼容 OpenAI 协议；`ollama` 可本地、Key 留空 |
| `baseUrl` | `https://api.deepseek.com/v1` | 网关地址；自定义域名首次需授权 |
| `apiKey` | — | 只存 `chrome.storage.local`，且收紧为可信上下文可读 |
| `model` | `deepseek-chat` | 模型名 |
| `temperature` | `0.2` | 生成温度 |
| `maxTokens` | `1600` | 代码题按语言自动上调（C++/Java ≥ 2048，上限 4096） |
| `requestGapMs` | `3000` | 两次模型请求最小间隔（串行闸门） |
| `maxRetries` | `2` | 评测失败后的回灌轮数（0–3） |
| `autoInject` | `true` | 生成后自动写入编辑器 |
| `autoSubmit` | `true` | 写入后自动点评测并回灌 |
| `useAnswerCache` | `true` | 命中本地答案库时复用缓存 |
| `useTrustedInput` | `true` | 常规写入无效时用 CDP `Input.insertText`（会短暂附加调试器） |
| `useTerminalPrelude` | `true` | 终端型编辑器先执行前置命令 |
| `terminalPrelude` | `mysql -h127.0.0.1 -uroot -p123123` | 前置命令，每行一条，按顺序执行 |
| `useSqlPrelude` | `true` | 终端型编辑器在键入代码前先执行 SQL 前置语句 |
| `sqlPrelude` | `CREATE DATABASE IF NOT EXISTS MyDb;` + `USE MyDb;` | SQL 前置语句，用于建库 / 切库 |

---

## 工作原理

```
options 页 ────── 提供商 / Key / 模型 / 间隔 / 重试 / 开关 / 答案库管理
      │
background (SW) ─ 消息路由、密钥隔离、串行限流、答案库、CDP 受信任输入
      │  ▲
      │  └─ chrome.runtime 消息
content top ───── 题面抽取、悬浮面板、状态机、编排（生成/写入/点评测/重试）
      │
      └─ postMessage ─→ content frame（probe.iife，MAIN world）
                          读编辑器 / 写入 / 点评测 / 读结果 / 只读自检
```

### 写入降级链

```
目标选取：所有候选编辑器过可见性闸门（宽 ≥ 80、高 ≥ 18、checkVisibility）
          → 按 面积 / 渲染文本 / 离评测按钮的距离 / 文档长度 打分 → 固定这一个元素
          （隐藏实例只出现在诊断候选里，标 [隐藏]，永远不当写入目标）
  (1) 实例 API（CM5 setValue / CM6 dispatch / ACE setValue / Monaco setValue）
  (2) contenteditable / textarea：focus + 全选 + execCommand('insertText') → 原生 setter
  (3) CDP 受信任输入：Ctrl+A 全选 + Input.insertText（isTrusted=true，整篇替换）
  (4) CDP 兜底：清空 + 逐键键入（终端必走；普通编辑器仅在 insertText 完全无效且 ≤1200 字符时）
```

每一级写完后都过**双视角校验**：

| 观测 | 结论 |
|---|---|
| 文档值一致 + 屏幕渲染命中特征行 | 通过 |
| 文档一致、渲染没变 | `render-stale`：写进了看不见的实例，降级到下一级 |
| 文档一致、渲染文本读不到 | `render-blind`：canvas/虚拟化编辑器，按可见性 + 文档视角判定 |
| 文档不一致 | `doc-mismatch`：编辑器没接受写入，或被页面回滚 |
| 文档值读不到（平台打包的 Monaco） | `docKnown=false`：只按屏幕渲染文本判，特征行命中即通过 |
| 命中的编辑器不可见 | `editor-hidden`：上一题的残留实例，不写 |

通过后再**另起一次读取复核**，复核一致才报「已写入」——写入和回读不再是同一条通道的自我确认。

> Monaco 的识别**不依赖 `window.monaco`**：平台把 Monaco 打成模块时全局不存在，但 `.monaco-editor` / `.view-lines` / `.inputarea` 输入框仍在 DOM 里。这种情况读不到 model，写入走受信任键入，校验只看屏幕渲染文本（候选行会显示 `doc=?`）。
>
> 受信任键入前有**焦点守卫**：先用 `document.activeElement` 确认焦点真的在编辑器里；不在就先 Ctrl+A 之外的办法补——按探针给的坐标做一次 CDP 真实点击，再复查。焦点始终进不去就中止并提示，不会把 Ctrl+A 落到整页上。

### 关键设计

- **跨帧只走 postMessage**：编辑器实例挂在页面主世界的 DOM expando 上（`.CodeMirror` / `.cmView` / `.env`），隔离世界读写不到，探针必须 `world: 'MAIN'`；
- **探针打成 IIFE**：文件名 `.iife.ts` 是 crxjs 约定，MAIN world 里避免 ESM 动态 `import()` 被页面 CSP 拦掉；
- **全帧监听**：编辑器可能内嵌在顶层文档，探针在每一帧都响应；
- **可见性闸门**：宽 ≥ 80px、高 ≥ 18px、`checkVisibility` 通过才算编辑器，所有类型共用——隐藏的旧实例只进诊断候选，永远不当写入目标；
- **双视角校验**：写入是否生效由「文档值 + 屏幕渲染文本」共同判定，报成功后再另起一次读取复核；
- **来源判定按 origin**，不看 `sender.tab`（标签页里打开的扩展页同样带 `tab`）；
- **请求无状态**：每次只发「题面 + 当前代码 + 最近一次评测」，不带对话历史；超长内容按字符上限截断。

---

## 隐私与权限

| 权限 | 用途 |
|---|---|
| `storage` | 保存设置与本地答案库 |
| `debugger` | 仅在常规写入被页面忽略时临时附加，插入文本后立即断开；不抓取页面数据 |
| `optional_host_permissions` | 自定义模型网关，用户点击时才请求授权 |

- 页面内容只发送到你自己配置的模型网关；
- API Key 不落页面、不进日志，内容脚本拿到的是剥离 `apiKey` 的版本；
- 答案库只在本机，不上传、不共享；
- 不采集浏览记录、不注入广告、不修改非目标站点。

---

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 加载时报「清单文件缺失」/ 找不到 `dist` | 仓库不提交构建产物 | 先在项目根目录执行 `pnpm install --node-linker=hoisted && pnpm build` |
| `鉴权失败（401）… key is invalid` | Key 与接口地址不是同一家提供商 | 报错里带本次 endpoint 与模型名，照着核对；或换回对应 baseUrl |
| `Failed to fetch` | 网关域名未授权，或地址不是完整 URL | 设置页点「保存 / 测试连接」，在弹窗里允许该域名 |
| `扩展没有被授权访问 https://…` | 同上，后台在 fetch 前先拦截 | 同上 |
| `请求超过 N 秒未返回` | 网关慢或模型长思考 | 调低 `maxTokens` 或换模型 |
| `NO_EDITOR` / `可写 0` | 探针没连上**可见**编辑器 | 看诊断区「候选」行是否全是 `[隐藏]`；展开实训区后点「自检」 |
| `INJECT_MISMATCH` | 双视角校验没过 | 报错含判据（`render-stale` / `doc-mismatch`）、策略名、候选摘要，按它定位 |
| `写入无反应，但面板说「已写入」` | 0.3.1 及以前只比对同一条通道，命中隐藏实例时误报 | beta 0.3.2 起双视角校验 + 独立复核；仍复现就把「候选」和「写入校验」两行发回 |
| `编辑器 未找到`，候选里只有一个 `1×1 doc=?` 的 Monaco 输入框 | 旧版只在 `window.monaco` 存在时找 `.monaco-editor`，平台打包的 Monaco 认不出来 | beta 0.3.2 起按 DOM 结构识别 |
| `Ctrl+A` 选中了题面，编辑器里没变化 | 旧版焦点没验证，Monaco 的 1×1 输入框没接住 `focus()`，全选落到整页 | beta 0.3.2 起焦点归属校验 + CDP 真实点击补焦点；失败会明确提示，不会盲发按键 |
| 编辑器里有光标，却报「编辑器拿不到焦点（当前焦点：textarea.inputarea… 1×1）」 | 旧版把 Monaco 容器认成了 `.view-lines` 自己（它的 class 里带 `monaco`），而输入框是它的兄弟节点，包含判断必然失败 | beta 0.3.2 起容器按「同时含 `.view-lines` 与 `.inputarea` 的祖先」定，焦点按编辑器根比较 |
| `没有找到「评测/提交」按钮` | 实训区未展开，或按钮文案变了 | 展开后重试；必要时补 `selectors.ts` |
| 终端里没出现代码 | 焦点没进终端 / 终端只认 keydown | 确认 `useTrustedInput` 开启；必要时反馈终端实现 |

---

## 开发

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # node --test --test-isolation=none "test/**/*.test.ts"
pnpm build       # vite build → dist/
pnpm icons       # 重新生成图标 PNG
pnpm dev         # vite 开发服务器（HMR）
```

### 目录

```
.
├─ manifest.config.ts        MV3 清单（两段 content script + 可选 host 权限）
├─ vite.config.ts            @crxjs 构建配置
├─ src/
│  ├─ background/            index / settings / answers / limiter / trusted-input / providers/openai
│  ├─ content/
│  │  ├─ top/                index / extract / bus / orchestrator / panel
│  │  └─ frame/              probe.iife.ts（MAIN world 探针）
│  ├─ options/               index.html / options.ts / options.css
│  ├─ shared/                types / selectors / problem / prompt / messages / frame / verdict / inject-check / result-dom / sender / answers
│  └─ icons/
├─ test/                     verdict / sender / frame / answers（node --test）
└─ scripts/make-icons.py     图标生成脚本
```

### 开发注意

- **依赖必须扁平安装**（`pnpm install --node-linker=hoisted`）。Windows + Node 24 下 pnpm 默认用 junction 建虚拟仓库，Vite 8 的 ESM 解析会报 `ERR_MODULE_NOT_FOUND: rolldown`；扁平安装是已验证的解法。`.npmrc` 里的 `node-linker=hoisted` 在当前 pnpm 版本不生效，命令行参数才生效。
- **探针文件名必须带 `.iife`**：crxjs 3 按文件名约定打成自包含 IIFE，否则 MAIN world 里会走 ESM 动态加载。
- **测试用 `--test-isolation=none`**：默认隔离模式会 spawn 子进程，在受限终端环境里会 `EPERM`。
- **构建带后处理**：`pnpm build` 末尾执行 `scripts/postbuild.mjs`，把 `dist/src/` 拍平为 `options/` `icons/` `probe.iife.js` 并改写 manifest；直接跑 `vite build` 会得到带 `src/` 镜像目录的原始产物。
- **平台改版**：只改 `src/shared/selectors.ts` 并递增 `SELECTOR_VERSION`，优先补精确选择器而不是改逻辑。

---

## 已知限制

| 限制 | 说明 |
|---|---|
| 帧中帧 | 同源向下钻两层；跨源嵌套帧不支持 |
| 评测次数 | 自动提交是真实提交，会消耗课程评测次数 |
| 设置生效 | 保存设置后需刷新实训页 |
| 终端校验 | 终端用 canvas 渲染时读不到屏幕文本，写入结果以评测为准 |
| canvas 自绘编辑器 | 读不到渲染文本时只能按可见性 + 文档视角判定（判据 `render-blind`），无法比对屏幕 |
| Monaco（无全局实例） | 读不到 model，写入只能走受信任键入，校验依赖屏幕渲染文本（虚拟化只覆盖视口内几行） |
| 焦点被页面抢走 | 点完编辑区后平台若把焦点移回题面，扩展会中止并提示重点一次；不会盲发 Ctrl+A |
| 跨源 iframe 里的编辑器 | CDP 真实点击只在顶层文档坐标下启用；跨源帧只能靠元素自身 `focus()`，失败时同样中止 |
| 逐键降级 | 仅对 ≤ 1200 字符的代码启用（每字符两次 CDP 往返，再长会拖到分钟级） |
| 结果区识别 | 依赖文案与类名启发式，必要时补精确选择器 |
| 无流式输出 | 模型返回完整响应后才解析，长答案等待时间较长 |

---

## 版本记录

- 版本变更：[CHANGELOG.md](./CHANGELOG.md)
- 逐轮开发打点（问题定位过程、真机反馈与修复思路）：[`docs/reports/`](./docs/reports/)

## 许可证

[MIT](./LICENSE) © 2026 educoder-study-assistant contributors
