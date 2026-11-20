# 阶段报告（第 7 轮打点）

- **时间**：2026-11-20 17:31
- **本轮目标**：修反馈里的两个 bug——① 进子网页（`/tasks/...`）面板消失；② 题面读取一直重复运行
- **结果**：两处都修了，版本 **0.2.3**。`tsc` 通过、15 条单测通过、`dist/` 已重建（14 个文件 / 81 KB）。
- **背景**：测试连接已由你确认正常，本论不再动网络层。

---

## 1. bug 1：子网页面板消失

**现象**：主网页（`/classrooms/...`）面板正常；进 `https://www.educoder.net/tasks/56wf72xh/4328685/aghsfnb4trip?coursesId=56wf72xh` 后面板没了。

**根因**：不是面板被移除，是**脚本压根没在那页注入**。top 内容脚本的匹配只有 `https://*.educoder.net/classrooms/*`；`/tasks/...` 是另一个顶层文档，content script 不匹配 → 没有面板、没有抽取。

**修复**（`manifest.config.ts`）：

```
https://*.educoder.net/classrooms/*
https://*.educoder.net/tasks/*
https://*.educoder.com/classrooms/*
https://*.educoder.com/tasks/*
```

已核对构建产物 `dist/manifest.json`：四组 matches 均在位，版本 0.2.3。

## 2. bug 2：题面读取一直重复运行

**两个原因叠在一起**，单独修一个都断不了这个环：

| 原因 | 机理 | 修复 |
|---|---|---|
| 用 `location.href` 判断"页面跳转" | 平台在 query 上挂追踪参数（`?coursesId=…`、时间戳等），`href` 一变就被当成新题 → 重置计数 + 重新抽取，**永远到不了重试上限** | 改用 `origin + pathname` 签名，query/hash 抖动不再触发 |
| 失败重试复用整条流水线 | 每轮重跑"重探帧 + 重抽题 + 重渲染"，1.6s 一轮；编辑器没连上也会再抽一遍题 | 抽题失败退避 1.5s / 3s / 4.5s，**上限 3 次即停**；编辑器未连上只重探编辑器，不重抽题 |

**按你给的方案落地的三点行为**：

1. **进子网页再开始读**：只在 `/tasks/…`、`/shixun_homework/…` 路径启动自动读取；列表页只挂面板，状态写"这里是列表页：进入具体实训题后会自动读取题面"。
2. **读取成功即停**：成功后立刻 `observer.disconnect()` 并清掉待执行的定时器，页面再局部刷新也不会重跑。
3. **手动重读**：`重新抽取` 是唯一的重读入口——点了才重置计数、重挂 observer、立刻抽一次。

**顺带收紧的边界**：

- 重试耗尽后面板明确写"已停止自动重试，点「重新抽取」手动再试"，不再无提示地停在原地；
- 题面已读到、编辑器未连上时，只做最多 2 次编辑器重探（1.6s 间隔），成功后面板切"实训区已连接"并刷新诊断区；
- `dispose()` 仍会清 interval / timer / observer，页面卸载不留后台循环。

## 3. 改动清单

| 文件 | 改动 |
|---|---|
| `manifest.config.ts` | top 脚本 matches 增加 `/tasks/*`（`.net` + `.com`）；版本 0.2.3 |
| `src/content/top/orchestrator.ts` | 自动读取生命周期重写：任务页判定、成功即停、URL 签名、退避重试、编辑器单独重探 |
| `README.md` | 目标站点、使用步骤、0.2.3 变更记录 |
| `package.json` | 版本 0.2.3 |

关键新增（`orchestrator.ts`）：

```ts
function urlSignature(): string { return `${location.origin}${location.pathname}` }
function isTaskPage(): boolean { return /\/(tasks|shixun_homework)\//.test(location.pathname) }
```

## 4. 验证记录

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | ✅ 通过 |
| `node --test --test-isolation=none "test/**/*.test.ts"` | ✅ 15/15 |
| `vite build` | ✅ 350ms |
| `dist/` | ✅ 14 个文件 / 83,280 字节 |
| `dist/manifest.json` | ✅ v0.2.3，四组 matches |
| Edge 真机 | ⏸ 需你重载验证 |

**你的验证步骤**：

1. `edge://extensions` → 重新加载 `dist`，**版本号须显示 0.2.3**；
2. 打开 `https://www.educoder.net/tasks/56wf72xh/4328685/aghsfnb4trip?coursesId=56wf72xh`——面板应出现；
3. 观察状态行：应只出现一次"正在读取题面…"，随后停在"题面已就绪…"或"题面已读取；实训区还没连上"，**不应循环刷新**；
4. 看诊断区：`实训帧 N 个（可写 M）`、`评测按钮`；
5. 需要重读时点"重新抽取"。

## 5. 下一轮候选

1. 按你这轮的真机结果收口：面板是否出现、是否只读一次、诊断区 `可写` 是否 ≥ 1；
2. 若 `可写 0`：说明探针没进实训 iframe（帧嵌套/CSP），下一步改用 background `chrome.scripting.executeScript({ frameIds })` 定向注入；
3. 若面板出现但题面为空：拿页面结构补 `selectors.ts`；
4. 队列与批处理、讲解结果缓存，排在真机通过之后。

## 6. 风险备注

- `/tasks/*` 是新增匹配面：该页若也有编辑器，探针逻辑不变，只是多一个可用页面；
- URL 签名忽略 query 意味着"同一 pathname 不同 query"不会重读——这正是本次要的行为，但若平台用 query 区分不同题目（例如 `/task?id=2`），需要把特定参数纳入签名。当前 `/tasks/{course}/{task}/{hash}` 用 pathname 已足够区分；
- 重试上限 3 次是折中：页面极慢时可能"未识别"，此时手动点一次即可。

---

**结论**：两个 bug 都是"触发条件"问题而不是算法问题——一个是匹配面漏了页面，一个是把 query 抖动当成了跳转。修复后自动读取变成一次性动作，重读回归手动。
