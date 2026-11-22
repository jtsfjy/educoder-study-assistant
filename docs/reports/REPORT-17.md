# 阶段报告（第 17 轮打点）

- **时间**：2026-11-22 20:05
- **本轮目标**：修真机反馈的「题面已读取；实训区未连接」——OJ 型实训区报 `可写 0`、`编辑器 未找到`
- **结果**：版本 **0.3.3**。`tsc` 通过、27 条单测通过、`dist/` 已重建。

---

## 1. 反馈里的有效信息

```
实训帧   0 个 iframe · 回包 1 · 可写 0
编辑器   未找到
候选     codemirror5:div.CodeMirror.cm-s-default 0×0[隐藏] doc=0 ren=10
        | textarea:textarea.inputarea.monaco-mouse-cursor-text 1×1[隐藏] doc=175 ren=175
        | textarea:textarea 0×0[隐藏] | textarea:textarea 0×0[隐藏]
        | textarea:textarea.ant-input.css-u1a3wc 0×0[隐藏]
```

三个判读：

1. `textarea.inputarea.monaco-mouse-cursor-text` 是 **Monaco 的输入框**，`doc=175` 正好是页面上那段模板代码的长度；
2. 候选里**没有 `monaco:` 条目**——不是页面没有 Monaco，是探针根本没去找；
3. 其余候选全是 `[隐藏]`，包括一个 0×0 的 CodeMirror 残留实例。

## 2. 根因

Monaco 分支写在 `if (window.monaco?.editor)` 里面。平台把 Monaco 打包成模块，**全局不存在**，于是：

- 探针从未查询 `.monaco-editor` / `.view-lines`；
- 唯一能看见的是 Monaco 的输入 textarea，而它天生 1×1、光标定位用，被可见性闸门（宽 ≥ 80）判成隐藏；
- 结论就是"本帧没有可见编辑器"。

另一个次生问题：Monaco 的 model 在模块作用域里，没有全局实例就读不到完整文档值。上一轮的判据要求"文档回读一致"，这类编辑器永远过不了。

## 3. 改动

### 3.1 按 DOM 识别 Monaco（不再依赖全局对象）

```
.monaco-editor / [class*="monaco-editor"]        → 直接是容器
.view-lines / .margin-view-overlays /
.monaco-scrollable-element                       → closest('.monaco-editor') ?? closest('[class*="monaco"]') ?? 向上找有面积的祖先
类名被改过                                        → textarea.inputarea + 向上找有面积的祖先（且祖先里有 Monaco 标记）
```

`walkUpSized()`：Monaco 的输入框 1×1，可见面积在祖先节点上，所以**可见性看容器**，不看输入框。

### 3.2 文档视角可缺失

新增 `docKnown`：

| 情况 | 判据 |
|---|---|
| 有全局实例 | 文档值 + 渲染文本（上一轮逻辑） |
| 无全局实例 | 只有渲染文本：特征行命中即 `verified`，没命中且渲染有内容 → `doc-mismatch`，渲染也读不到 → `render-blind` |

### 3.3 写入路径

- 没有全局实例的 Monaco 不做 API 写入，`writeInto` 直接返回 `api-unavailable`；
- 编排层接到后走受信任键入：`focus` → Monaco 的 `textarea.inputarea` 聚焦 → Ctrl+A 全选 → `Input.insertText` 整篇替换；
- 复核用 `matchesCode`：`docKnown === false` 时改用 `renderContains(renderText, code)`。

### 3.4 特征行判定收紧

- 参与判定的行必须 ≥ 12 个非空白字符。`int main() {`（10）这类模板通用短行会把"旧模板残留"命中成"写进去了"，之前是 6 字符阈值；
- 命中判定最多扫 40 行（默认展示仍取首/中/末 3 行），长代码在虚拟化视口里更容易命中。

### 3.5 诊断

- 候选行新增 `doc=?`（读不到文档值）；
- 一个可见候选都没有时，追加「未识别:」并列出页面上所有长得像编辑器的可见元素——下一轮不用再猜。

## 4. 验证记录

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | ✅ |
| `node --test --test-isolation=none "test/**/*.test.ts"` | ✅ 27/27（新增 Monaco 无文档视角 3 条、`renderContains` 1 条） |
| `vite build` | ✅ v0.3.3 |
| `dist/manifest.json` | ✅ v0.3.3 |
| 真机（Edge + 头歌） | ⏳ 未验证，需加载 `dist/` 实测 |

## 5. 仍可能失败的分支

- **容器被包在 closed shadow root 里**：探针钻不进去，候选会是空。届时「未识别:」行也不会有内容，需要 outerHTML；
- **Monaco 的 view-lines 无文本**（极老版本用 canvas 渲染）：`render-blind`，只能以评测结果为准；
- **文档值读不到 + 虚拟化视口没覆盖任何特征行**：判失败并要求受信任键入重试，仍失败则报错，不会静默通过。

---

**结论**：这一轮不是"判据又错一次"，是**编辑器识别漏了一类**——Monaco 认全局，不认 DOM。补上 DOM 识别后，OJ 型实训区从"未连接"变成"可写入 + 渲染校验"。
