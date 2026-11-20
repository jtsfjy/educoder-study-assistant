# 阶段报告（第 9 轮打点）

- **时间**：2026-11-20 18:40
- **本轮目标**：修"生成正常但注入无反应"（评测按钮能点，编辑器内容没变）
- **结果**：写入链路重做，版本 **0.2.5**。`tsc` 通过、15 条单测通过、`dist/` 已重建。

---

## 1. 现象

- 生成代码正常；
- 点"评测"能成功点击（说明探针在页面里工作、按钮定位没问题）；
- **编辑器内容没变**。

这排除了"探针没连上"，问题落在**写入目标或写入方式**。

## 2. 三个可能，一次全堵

### 2.1 编辑器在 shadow DOM 里（最可能）

平台如果用 Web Component 包编辑器，`document.querySelector('.CodeMirror')` 返回 null，探针就会退到别的东西上（或直接找不到），于是"看起来写入成功、页面没反应"。

修复：新增 `deepQuery()`，向下钻最多 3 层 **open shadow root**，所有编辑器查找（CM5 / CM6 / ACE / Monaco / textarea / contenteditable）都走它。

### 2.2 编辑器是 contenteditable，不是 CM/ACE/Monaco

你反馈的"防粘贴"正好是自绘可编辑区的典型特征：它只认自己的输入管线。原探针没有 contenteditable 适配器。

修复：新增 `contenteditable` 类型——读取取 `innerText`，写入用 **`focus()` + 全选 + `execCommand('insertText')`**。

### 2.3 直接改属性对受控组件无效

`value = xxx` / `innerText = xxx` 只改 DOM，框架状态不回写，随后被渲染覆盖。

修复：写入优先走 **`execCommand('insertText')`**——它会触发浏览器真实的 `beforeinput` / `input` 事件，受控组件能吃下；**它不是 paste**，所以平台的粘贴拦截拦不到它，也不需要剪贴板。

## 3. 写入链路（按优先级降级，每级都回读校验）

| 顺序 | 目标 | 策略 |
|---|---|---|
| 1 | CodeMirror 5 | `instance.setValue()` + `focus()` + `refresh()` |
| 2 | CodeMirror 6 | `view.dispatch({ changes })` |
| 3 | ACE | `editor.setValue(code, -1)` |
| 4 | Monaco | `editor.setValue()`（拿不到 editor 退 `model.setValue`） |
| 5 | contenteditable | `focus` → 全选 → `execCommand('insertText')` → 失败退 `innerText` |
| 6 | textarea | `focus` → `select()` → `execCommand('insertText')` → 失败退原生 setter |

**二次回读**：写入后先校验一次，再等 120ms 复查一次——有的页面"先接受、随后回滚"，一次校验看不出来。两次都一致才算写入成功。

**失败可诊断**：`INJECT_MISMATCH` 现在带三样东西——生效策略名、编辑器类型、六个探测位（CM5/CM6/ACE/Monaco/textarea/contenteditable 各自 true/false），一眼看出卡在哪。

状态行成功时也会写策略，例如：

```
已写入 30 行（contenteditable · contenteditable.execCommand）
```

## 4. 验证记录

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | ✅ |
| `node --test --test-isolation=none "test/**/*.test.ts"` | ✅ 15/15 |
| `vite build` | ✅ 193ms，v0.2.5 |
| `dist/manifest.json` | ✅ v0.2.5 |
| Edge 真机 | ⏸ 需你验证 |

**你的验证顺序**：

1. 重载扩展，面板标题须是 **v0.2.5**；
2. 打开实训题，看诊断区「编辑器」行现在显示什么类型（`contenteditable` / `codemirror*` / `textarea`）；
3. 点"自动解题"，看状态行那行 `已写入 N 行（类型 · 策略）`；
4. 若失败，把 `INJECT_MISMATCH` 那整段发我——里面有类型 + 策略 + 六个布尔位，能直接定位。

## 5. 下一轮候选

1. 按你回传的「编辑器」类型 + 策略名收口；
2. 若类型仍是 `textarea` 但写的是搜索框 → 给候选加"可见面积 + 邻近评测按钮"过滤；
3. 若六个位全 false → 编辑器可能在 closed shadow root 或 canvas 自绘，需要换注入方式（`chrome.scripting` 定向 + 触发框架内部 API）；
4. 真机通过后再排队列批处理与讲解缓存。

## 6. 风险备注

- `execCommand('insertText')` 已被标记 deprecated，但 Chromium 全系仍支持，且是绕过"受控组件 + 粘贴拦截"最稳的一条路；
- `deepQuery` 每次调用会遍历最多 1500 个节点，仅在读写时触发，不在轮询里；
- contenteditable 全选写入会覆盖整篇内容——这是预期行为（替换模板代码），但不会保留光标位置。

---

**结论**：注入失败的三条可能路径（找不到编辑器、类型不认识、改了 DOM 但不进框架状态）这次一次性覆盖；下次失败会直接把策略名和探测位摆出来，不用再猜。
