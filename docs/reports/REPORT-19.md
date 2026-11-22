# 阶段报告（第 19 轮打点）

- **时间**：2026-11-22 20:50
- **本轮目标**：修「编辑器拿不到焦点（当前焦点：textarea.inputarea.monaco-mouse-cursor-text 1×1）」
- **结果**：版本 **0.3.5**。`tsc` 通过、28 条单测通过、`dist/` 已重建。

---

## 1. 报错本身就把答案写出来了

```
编辑器拿不到焦点（当前焦点：textarea.inputarea.monaco-mouse-cursor-text 1×1）
```

这行说明：**焦点确实在 Monaco 的输入框里**（用户也观察到编辑区有光标），而 `hasEditorFocus()` 返回了 false。

## 2. 根因：容器被自匹配成 `.view-lines`

0.3.4 的容器选取：

```ts
element.closest('.monaco-editor') ?? element.closest('[class*="monaco"]') ?? walkUpSized(element)
```

Monaco 的 `.view-lines` 元素 class 是 `view-lines monaco-mouse-cursor-text`——**自己也带 `monaco`**。
`closest()` 包含自身，于是 `'[class*="monaco"]'` 命中 `.view-lines` 自己，容器就被定成了 `.view-lines`。

而 Monaco 的 DOM 结构里，输入框是它的**兄弟节点**：

```
.monaco-editor
  └─ .overflow-guard
       ├─ .monaco-scrollable-element … .view-lines   ← 被选为"容器"
       └─ textarea.inputarea                          ← 焦点在这
```

于是 `host.contains(activeElement)` 恒为 false → 焦点判据永远失败 → 中止发送。

## 3. 改动

### 3.1 容器按"两个标记同时存在"来定

```ts
function monacoRoot(element) {
  const exact = element.closest('.monaco-editor, [class*="monaco-editor"]')
  if (exact) return exact
  // 最近的、同时含有 .view-lines 与 textarea.inputarea 的祖先
  for (let current = element; current; current = current.parentElement) {
    if (current.querySelector('.view-lines, .margin-view-overlays') &&
        current.querySelector('textarea.inputarea, textarea.monaco-mouse-cursor-text')) return current
  }
  return walkUpSized(element)
}
```

`walkUpSized()` 改为从 `parentElement` 起步，不再自匹配。

### 3.2 焦点按"编辑器根"比较

```ts
容器包含 active  ||  容器的编辑器根包含 active  ||  active 的编辑器根 === 容器的编辑器根
```

编辑器根 = `.monaco-editor` / `.CodeMirror` / `.cm-editor` / `.ace_editor`。
兄弟节点的输入框因此能被正确归到同一个编辑器里。

### 3.3 逐键降级不再要求"文档未变化"

原来只有"文档和插入前一样"才逐键重打。模块化 Monaco 没有文档视角，这个条件永远不成立。
现在条件改成「校验没过 + 代码 ≤ 1200 字符」，并且**先清空再键入**，不会拼出「旧代码 + 新代码」。

### 3.4 帧钉不丢

写入失败会广播到所有帧，之前广播后把 `pinned` 清空了，后续 `focus` / `active` / 按键可能发到别的帧。
现在按「报成功的那一帧优先，否则报失败的那一帧」重新钉住；`focusEditor` / `probeActive` 也会把钉住的帧更新为实际回包帧。

### 3.5 报错去重

`INJECT_MISMATCH` 里同一条详情之前会出现三遍（探针 error + 判据 detail + 编排层再拼一次），现在只保留一份。

## 4. 验证记录

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | ✅ |
| `node --test --test-isolation=none "test/**/*.test.ts"` | ✅ 28/28 |
| `vite build` | ✅ v0.3.5 |
| 真机（Edge + 头歌） | ⏳ 未验证，需加载 `dist/` 实测 |

## 5. 真机预期

同一道「删除表的外键约束」：

1. 状态行可能闪一下「编辑器没有焦点，用真实点击定位…」；
2. 随后「已写入 N 行（受信任插入 · Monaco）」；
3. 点评测，结果区应出现 `实际输出` 里没有 `CONSTRAINT emp_dept FOREIGN KEY …` 的那一版。

若仍是「拿不到焦点」，报错里的「当前焦点：…」应当不再是 inputarea；把它发回即可。

---

**结论**：不是焦点没进去，是**我们认错了编辑器容器**，把一个兄弟节点当成了子节点。容器与焦点都改成按编辑器根比较，这一类的误判不会再出现。
