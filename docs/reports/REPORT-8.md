# 阶段报告（第 8 轮打点）

- **时间**：2026-11-20 18:20
- **本轮目标**：修 `NO_EDITOR`——实训区打不开，探针没有一帧应答
- **结果**：根因找到三处，全部修掉，版本 **0.2.4**。`tsc` 通过、15 条单测通过、`dist/` 已重建。

---

## 1. 现象与判断

你的反馈：题面读到了，但面板一直"实训区还没连上"，点自动解题报 `NO_EDITOR`，自检里"帧编辑器 未连接"。

`NO_EDITOR` 在代码里的唯一含义是：**top 广播了 `editor` 请求，但没有任何一帧回包**。所以问题不在写入，也不在 Key，而在"探针根本没应答"。

## 2. 根因：三处叠加

### 2.1 探针只在子帧监听（主因）

`probe.iife.ts` 末尾原本是：

```ts
if (window.top !== window) window.addEventListener('message', onMessage)
```

这句是按"实训区一定在 iframe 里"写的。但 `/tasks/...` 这一版页面把编辑器**内嵌在顶层文档**里，顶层帧自己从不监听 → 永远 0 回包。

### 2.2 top 侧只问 iframe，从不问自己

`bus.frameWindows()` 只收集 `iframe.contentWindow`，没把 `window` 自己算进去。就算探针在顶层监听了，也没人给它发请求。

### 2.3 `about:blank` / `srcdoc` 帧没覆盖

实训区若用空白帧渲染编辑器，content script 默认不注入。

## 3. 修复

| 位置 | 改动 |
|---|---|
| `probe.iife.ts` | 去掉顶层守卫：**每一帧都监听**（顶层帧 `window.parent === window`，天然能收到自己的请求） |
| `bus.ts` | `frameWindows()` 把 `window` 自己放进目标列表首位，再向下钻 iframe（同源两层） |
| `manifest.config.ts` | probe 加 `match_about_blank: true` |
| `orchestrator.ts` | 编辑器重探上限 2 → 4 次；未连上时状态指向诊断区 |
| `panel.ts` | 标题显示 `头歌学习助手 v0.2.4`——**一眼确认跑的是不是刚构建的包** |
| 诊断区 | 「实训帧」行改为 `X 个 iframe · 回包 Y · 可写 Z`，三个数分开看 |

诊断三个数的读法：

| 现象 | 含义 | 下一步 |
|---|---|---|
| `0 个 iframe · 回包 1 · 可写 1` | 编辑器在顶层文档，链路已通 | 直接试自动解题 |
| `N 个 iframe · 回包 0` | 探针没注入（CSP 或帧类型） | 反馈，我改 `chrome.scripting` 定向注入 |
| `回包 ≥1 · 可写 0` | 帧通，但没有可识别的编辑器 | 编辑器可能是自绘/自定义，需要加适配器 |

## 4. 验证记录

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | ✅ |
| `node --test --test-isolation=none "test/**/*.test.ts"` | ✅ 15/15 |
| `vite build` | ✅ 203ms |
| `dist/manifest.json` | ✅ v0.2.4，`match_about_blank: true` |
| 产物检查 | ✅ probe 已无 `top !== window` 守卫，`window.addEventListener('message')` 无条件绑定 |
| Edge 真机 | ⏸ 需你验证 |

**你的验证步骤**：

1. 重载扩展，面板标题必须是 **v0.2.4**（不是就说明加载的是旧包）；
2. 打开 `/tasks/56wf72xh/4328685/...` 页，看诊断区「实训帧」那一行；
3. 把那一行原文发我（`X 个 iframe · 回包 Y · 可写 Z`），按上表就能定位；
4. 若显示 `可写 ≥ 1`，直接点"自动解题"。

## 5. 下一轮候选

1. 按你的「实训帧」行原文收口；
2. `回包 0` → background `chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'MAIN' })` 兜底注入；
3. `可写 0` → 抓编辑器 DOM（`.cm-editor?` / `[contenteditable]` / canvas）补适配器；
4. 队列批处理、讲解缓存排在真机通过之后。

## 6. 风险备注

- 顶层帧现在也跑探针：它会在任意 `educoder.net` 页面响应 `editor/write/...`。顶层页若有 `textarea`（搜索框等），可能被误判成编辑器。当前判据是"回包代码最长者"，且写入前会回读校验，误写风险已被挡住；但若真遇到，下一轮给 textarea 加"可见面积 + 邻近评测按钮"的过滤条件。
- `match_about_blank` 会让探针进入空白帧，帧数量会变多，属正常。

---

**结论**：`NO_EDITOR` 不是编辑器识别失败，是"没有一帧在听"。补上顶层监听后，链路要么通，要么诊断区能明确指出卡在哪一环。
