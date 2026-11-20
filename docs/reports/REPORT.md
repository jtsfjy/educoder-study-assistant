# 头歌学习助手 · 阶段报告

- **日期**：2026-11-20 15:12
- **状态**：WIP（typecheck 通过，尚未产出可加载的 `dist`）
- **说明**：按你的要求，CHANGELOG 不再更新，后续以本报告和代码为准。

---

## 1. 结论

骨架和核心链路（抽取 → 面板 → 模型调用 → 只读读取编辑器）已经成型，TypeScript 全量类型检查通过。**现在还装不到 Edge 上**：设置页、图标还没写，`vite build` 一次都没跑过，因此不存在 `dist/`。

粗算完成度：工程/共享/background/content 约 **75%**；距离"能加载、能讲解"还差设置页 + 图标 + 构建冒烟这一轮。

## 2. 定位与边界

| 做 | 不做 |
|---|---|
| 题面结构化抽取（标题/描述/输入输出规格/样例/约束/模板/语言/指纹） | 不往页面编辑器写入代码 |
| 右上角 Shadow DOM 悬浮面板展示 | 不点击"评测/提交"、不读评测结果 |
| 用户自配模型做"分步讲解思路" | 不自动重试到达标、不做答案库 |
| 只读编辑器内容，做"复盘我自己写的代码" | 不做任何规避风控的节奏伪装 |

原 v0.1 方案的自动注入、自动提交、失败回灌、答案库、3 秒"人类节奏"全部移除；跨帧总线、选择器集中维护、语义兜底、密钥只留在后台这几项可复用的工程设计保留。

## 3. 完成度总览

| 层 | 文件 | 状态 |
|---|---|---|
| 工程配置 | `package.json` / `tsconfig.json` / `vite.config.ts` / `manifest.config.ts` | ✅ |
| 共享层 | `src/shared/types.ts`、`selectors.ts`、`problem.ts`、`prompt.ts`、`messages.ts`、`frame.ts` | ✅ |
| background | `src/background/index.ts`、`settings.ts`、`limiter.ts`、`providers/openai.ts` | ✅ |
| content · top | `src/content/top/index.ts`、`extract.ts`、`bus.ts`、`panel.ts`、`orchestrator.ts` | ✅ |
| content · frame | `src/content/frame/probe.ts`（MAIN world 只读探针） | ✅ |
| options 页 | `src/options/index.html` / `options.ts` / `options.css` | ❌ 未创建 |
| 图标 | `src/icons/icon{16,32,48,128}.png` | ❌ 未创建 |
| 单元测试 | `test/*.test.ts` | ❌ 未创建 |
| 文档 | `README.md` | ❌ 未创建 |
| 构建产物 | `dist/` | ❌ 未生成 |

## 4. 数据流

```
实训题页面（top，隔离世界）
  ├─ MutationObserver / URL 轮询
  ├─ extract.ts ──► Problem（含 sha256 指纹）
  ├─ panel.ts  ──► 右上角悬浮面板
  ├─ bus.ts    ──postMessage──► 实训 iframe（MAIN world，probe.ts）
  │                               └─ getValue()：CM5 / CM6 / ACE / Monaco / textarea
  └─ 用户点击"讲解/复盘"
        └─ chrome.runtime.sendMessage ──► background/index.ts
              ├─ settings.ts（key 仅在此层可读）
              ├─ limiter.ts（串行 + 最小间隔）
              └─ providers/openai.ts ──► 用户配置的模型网关
```

密钥隔离：`chrome.storage.local` 通过 `setAccessLevel('TRUSTED_CONTEXTS')` 收紧，content script 读不到明文；页面侧请求返回的设置会自动剥离 `apiKey`。

## 5. 关键实现要点

- **抽取三层**：候选选择器打分 → 语义锚点（输入格式/样例输出/要求…）切段 → 结构指纹；选择器全部集中在 `selectors.ts`，带 `SELECTOR_VERSION`，面板展示版本便于判断平台改版。
- **跨帧只读**：CM/ACE/Monaco 的实例挂在页面主世界的 DOM expando 上，隔离世界看不到，所以探针必须 `world: 'MAIN'`；只调用 `getValue()`，不写回、不触发事件。
- **面板**：Shadow DOM 完全隔离页面样式，可拖动/收起，结果区支持复制；不注入内联脚本，符合 CSP 约束。
- **限流**：同一时刻只允许一个模型请求，间隔默认 3s，仅用于成本保护和误触保护，与风控规避无关。
- **错误可诊断**：`NO_API_KEY` / `PROVIDER_ERROR` / `RATE_LIMITED` / `TIMEOUT` 直接展示在面板与设置页。

## 6. 验证记录

| 项 | 结果 |
|---|---|
| `pnpm install` | ✅ `@crxjs/vite-plugin@3.0.0`、`vite@8.3.8`、`typescript@5.9.3`、`@types/chrome@0.3.7`、`@types/node@26.6.6` |
| `tsc --noEmit` | ✅ 通过（2026-11-20 15:10） |
| `vite build` | ⏸ 未执行：manifest 引用的 options 页与图标不存在，当前必然失败 |
| Edge `--load-extension` 冒烟 | ⏸ 未执行（无 `dist`） |
| 单测 | ⏸ 未编写；`problem.ts` 为纯函数，可直接用 `node --test` 覆盖 |
| 真实页面回归 | ⏸ 未做（目标页面需登录态） |

踩坑记录：中途用 PowerShell `Set-Content` 批量改导入路径时按 ANSI 落盘，破坏了三个文件的中文注释，已重写修复；后续源码改动只走 `write` / `edit`。

## 7. 风险与降级

| 风险 | 处置 |
|---|---|
| 平台 CSP 拦截 MAIN world 探针 | 面板提示"未连接实训区"，不退回写入 |
| 选择器随平台改版失效 | 单点改 `selectors.ts` + 递增版本；语义锚点兜底 |
| iframe 嵌套更深（帧中帧） | 当前只处理一层直达子帧；嵌套需后续转发 |
| 模型网关域名不在白名单 | 在 `manifest.config.ts` 的 `host_permissions` 追加 |
| 模型输出过长/不流式 | 当前非流式，设了 90–120s 超时与 token 上限 |

## 8. 未完成与工作量估计

| 项 | 内容 | 估计 |
|---|---|---|
| options 页 | provider / baseUrl / key / model / 温度 / 间隔 / 测试连接 | 1 轮内 |
| 图标 | 4 个尺寸 PNG + 项目内生成脚本 | 10 分钟 |
| 构建 | `vite build` 产出 `dist/`，修构建期报错 | 10–20 分钟 |
| Edge 冒烟 | 加载 `dist`、确认 SW 注册、面板出现 | 10 分钟 |
| 单测 | `buildProblem` / `detectLanguage` / 锚点解析 / 指纹稳定性 | 10–15 分钟 |
| README | 安装、配置、架构、隐私说明 | 10 分钟 |

## 9. 下一步可选

- **A（推荐）最小可用闭环**：options 页 + 图标 + 构建 + Edge 加载冒烟。交付"能装、能讲解"的 `dist`。
- **B 先补质量**：先写 `node --test` 单测与本地 mock 页面抽取回归，再构建。
- **C 扩展能力**：讲解结果缓存（按指纹）、流式输出、选择题/填空题的只读解析。
- **D 只交付源码与文档**：不构建，由你自行 `pnpm build` 并加载。

## 10. 文件清单

```
educoder-study-assistant/
├─ manifest.config.ts        MV3 清单（含 MAIN world 探针）
├─ vite.config.ts            @crxjs 构建
├─ tsconfig.json
├─ package.json / pnpm-lock.yaml
├─ REPORT.md                 本报告
├─ CHANGELOG.md              历史记录（已冻结）
└─ src/
   ├─ background/
   │  ├─ index.ts            消息路由、密钥隔离、生命周期
   │  ├─ settings.ts         默认值与收敛、sanitize
   │  ├─ limiter.ts          串行闸门
   │  └─ providers/openai.ts OpenAI 兼容网关
   ├─ content/
   │  ├─ top/                index / extract / bus / panel / orchestrator
   │  └─ frame/probe.ts      只读编辑器探针（MAIN world）
   ├─ options/               ❌ 待建
   ├─ icons/                 ❌ 待建
   └─ shared/                types / selectors / problem / prompt / messages / frame
```
