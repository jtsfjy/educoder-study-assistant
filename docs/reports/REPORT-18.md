# 阶段报告（第 18 轮打点）

- **时间**：2026-11-22 20:15
- **本轮目标**：修「Ctrl+A 会选中无关区域，无法选中答题区」
- **结果**：版本 **0.3.4**。`tsc` 通过、28 条单测通过、`dist/` 已重建。

---

## 1. 现象与判读

用户看到：按到全选时，选中范围是整页（题面），编辑器里什么都没变。

这说明 **`document.activeElement` 不在编辑器里**，而我们在 `inject()` 里先调了 `focusEditor()`，它返回了 `true`。也就是说：

- `focus` 操作是**盲发**的：`textarea.focus()` 调完就 `return { focused: true }`，从不检查焦点到底落在哪；
- Monaco 的输入框是 1×1、光标定位用的，`focus()` 经常不生效（节点在但不可聚焦，或平台随即把焦点移回）；
- 焦点留在 body 上时，CDP 的 `Ctrl+A` 作用在文档 → 选中题面；紧随其后的 `Input.insertText` 没有可编辑目标 → 空操作。

所以"全选"这一步不是编辑器内的全选，是网页级全选。

## 2. 改动

### 2.1 焦点必须验证（探针）

```ts
function hasEditorFocus(target) {
  const active = document.activeElement
  return active === target.host || target.host.contains(active)
}
```

- `focus` 返回 `focused`（真实结果）、`focusDetail`（活动元素摘要，如 `body`、`div.question-desc`），
  以及 `clickX` / `clickY`（编辑器正文的点击坐标）与 `isTop`（是否顶层文档）；
- 先试实例/元素 `focus()`；不在编辑器里就做一次**合成点击**（`pointerdown`/`mousedown`/`click`，
  Monaco / CM 的鼠标处理器不校验 `isTrusted`），再复查一次；
- 纠正了此前"调过 focus 就算成功"的假信号。

### 2.2 补焦点的手段（后台）

新增 `inject:click`：CDP `Input.dispatchMouseEvent`（mouseMoved → mousePressed → mouseReleased），
`isTrusted=true`，落在编辑器正文坐标上。只在回包帧是**顶层文档**时使用——只有顶层坐标等于标签页视口坐标。

### 2.3 编排层的顺序与守卫

```
requestEditor() 定帧        ← 先定帧，再把焦点发到同一帧
  └ terminal? → focus + 逐键键入
focusEditor()
  └ focused=false 且顶层 → inject:click 真实点击 → 再 focusEditor()
  └ 仍 false → 抛错中止（提示"在右侧编辑区点一下代码"）
probeActive()               ← Ctrl+A 之前再查一次焦点
  └ insideEditor=false → 中止，不发送任何按键
inject:trusted { selectAll: true }
probeActive()               ← 逐键降级之前再查一次
```

关键点：**焦点验证不过就什么都不发**。宁可报错让用户点一下，也不发送一个会选中整页的 Ctrl+A。

### 2.4 新增只读跨帧 op

`active`：只回答"焦点现在在哪、在不在编辑器里"，不改任何状态。`frame.ts` 的 op 联合类型与校验同步扩展。

## 3. 验证记录

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | ✅ |
| `node --test --test-isolation=none "test/**/*.test.ts"` | ✅ 28/28（新增 `active` op 可用性 1 条） |
| `vite build` | ✅ v0.3.4 |
| 真机（Edge + 头歌） | ⏳ 未验证，需加载 `dist/` 实测 |

## 4. 真机预期

打开同一道 MySQL 题 → 自动解题，两种走向：

1. 焦点成功：状态行出现「编辑器没有焦点，用真实点击定位…」后继续，代码进入编辑器，评测通过；
2. 焦点仍不进去：报错里带 `当前焦点：body（或某个题面容器）` 与「请在右侧编辑区里点一下代码」——
   这时手动点一次编辑区再点自动解题即可，扩展不会再把 Ctrl+A 打到页面上。

若第 2 种一直出现，需要回传：报错里那行「当前焦点：…」的原文，以及编辑器容器的 outerHTML。

---

**结论**：不是全选选错了地方，是**我们从来没确认过焦点在编辑器里**。这轮把"焦点"从假设变成了判据，验证不过就停手。
