# 阶段报告（第 4 轮打点）

- **时间**：2026-11-20 16:40
- **本轮目标**：修掉反馈里的 bug 1（设置页保存被挡），并把自动注入 / 自动提交 / 失败回灌补回来
- **结果**：三项全部完成。`tsc` 通过、10 条单测通过、`dist/` 重新构建（v0.2.0）。真机加载仍需你验证——沙箱里起不了 Chromium。

---

## 1. bug 1：根因与修复

**现象**：在扩展设置页点保存，回显"设置只能在扩展选项页修改。"

**根因**：后台用 `Boolean(sender.tab)` 判断消息来源。Chrome 对"在标签页里打开的扩展页面"也会带上 `sender.tab`，设置页因此被当成 content script，`settings:save` / `settings:clear-key` 直接被挡。**这不是设置页写错了，是来源判定错了一整类上下文。**

**修复**：新增 `src/shared/sender.ts`，判据换成 origin/url 是否落在本扩展的 `chrome-extension://<id>/` 前缀内，`sender.tab` 完全不参与判断。

```ts
export function isExtensionContext(sender: SenderLike, runtimeId: string, extensionPrefix: string): boolean {
  if (sender.id !== runtimeId) return false
  const origin = sender.origin ?? ''
  const url = sender.url ?? ''
  return origin.startsWith(extensionPrefix) || url.startsWith(extensionPrefix)
}
```

**回归用例**（`test/sender.test.ts`，三条都过）：

| 场景 | 期望 |
|---|---|
| 设置页（带 `sender.tab`，origin 为 `chrome-extension://<id>`） | 允许保存 |
| content script（带 `sender.tab`，origin 为 `https://www.educoder.net`） | 拒绝保存 |
| 其它扩展 id | 一律拒绝 |

**安全边界没动**：content script 调 `settings:get` 仍然只拿到 `sanitizeSettings()` 的结果，明文 key 只在后台。

## 2. 自动注入

跨帧协议升到 v2：`editor` / `write` / `submit` / `result` 四种 op，请求与回包都带 `op` 字段。

写入走实例 API，按编辑器分派：

| 编辑器 | 写入路径 |
|---|---|
| CodeMirror 5 | `instance.setValue(code)` + `focus()` + `refresh()` |
| CodeMirror 6 | `view.dispatch({ changes: { from: 0, to: doc.length, insert: code } })` |
| ACE | `editor.setValue(code, -1)` + `clearSelection()` |
| Monaco | `editor.setValue(code)`（拿不到 editor 时退 `model.setValue`） |
| textarea | 原型链 `value` setter + `input`/`change` 合成事件 |

写完补发 `input` / `change`（bubbles），然后**回读校验**：回读内容与期望代码做归一化比对（忽略 CRLF 与行尾空白）。不一致直接报 `INJECT_MISMATCH` 并停下，不硬着头皮点评测——这是上一版方案里写明"最容易翻车"的一步，现在有代码兜住。

帧路由：top 侧记录回包最长的那个 frame（通常就是真编辑器所在帧），写入/点击只发给它；失败一次再广播重试。多帧同时回包不会写错地方。

## 3. 自动提交与失败回灌

**按钮定位**：`评测 / 提交 / 运行 / 自测 / 执行 / 测试 / 保存并评测` 打分（保存并评测 105、评测 100、提交 90、运行 80…），过滤不可见、`disabled`、`aria-disabled`；先在实训帧里找，找不到再扫顶层文档。点击按真实指针序列补全：`pointerdown → mousedown → pointerup → mouseup → click`——平台的按钮常绑在 mousedown 上，只发 click 会漏。

**结果读取**：`result / judge / output / console / terminal / compile / answer / score / pre / code` 候选容器，按"类名像结果区（+10）+ 正文含评测结论（+20）+ 文本长度"打分取最高分。顶层与实训帧各读一份，取"已识别出结论"或更长的那份。

**结论分类**（`src/shared/verdict.ts`）：

`passed` / `wrong_answer` / `compile_error` / `runtime_error` / `rate_limited` / `running` / `unknown`

顺序有讲究：`未通过`、`不通过`、`部分通过` 都含"通过"二字，先被 `wrong_answer` 吃掉才不会误判。

**闭环**：`rounds = 1 + maxRetries`。每轮：生成 → 注入 → 校验 → 点评测 → 读结论；未通过就把"上次代码 + 评测文本"回灌给模型要修复版。触发限流直接中止并报原因，不无限重试。结果区长时间不变且等于点评测前的文本时，判"没读到结果"，不空等满 120 秒。

生成侧 prompt 两条：首次是"竞赛级解题器，只输出代码、保留模板签名"；重试是"只输出修复后的完整代码"。模型偶尔仍会带 markdown 围栏，`normalizeCode()` 再兜一刀。

## 4. 开关与默认值

| 键 | 默认 | 说明 |
|---|---|---|
| `autoInject` | `true` | 生成后自动写入编辑器（实例 API + 回读校验） |
| `autoSubmit` | `true` | 写入后自动点评测并回灌重试 |
| `maxRetries` | `2` | 回灌轮数上限（0–3） |

两个开关都进了设置页，关掉即退回"只生成 + 注入"。注意：**自动评测消耗课程评测次数**，次数紧的课把重试调 0 或关掉自动提交。

## 5. 构建改动：探针改成真 IIFE

上一版 `world: 'MAIN'` 的探针产物是 `ESM chunk + 动态 import()` 的 loader。MAIN world 受页面 CSP 约束，`chrome-extension:` 的模块加载有概率被拦，等于探针没跑起来、面板永远"未连接实训区"。

这一轮把 `src/content/frame/probe.ts` 改名为 `probe.iife.ts`——crxjs 3 的文件名约定，走自包含 IIFE 打包：

```
[crx:content-scripts-iife] Building 1 content script(s) as IIFE...
  ✓ probe.iife.ts → src/content/frame/probe.iife.js   (8.09 kB，无 import、无 loader)
```

## 6. 验证记录

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | ✅ 通过 |
| `node --test --test-isolation=none "test/**/*.test.ts"` | ✅ 10 条通过（verdict 4 + sender 3 + frame 3） |
| `vite build` | ✅ 240ms，26 个模块 |
| `dist/manifest.json` | ✅ v0.2.0，两段 content script，`world: 'MAIN'` 指向 `probe.iife.js` |
| Edge 加载 / 真机回归 | ⏸ 沙箱不允许启动 Chromium（`platform_channel.cc` 拒绝访问），需你在本机验证 |

**手动验证步骤**（这轮的关键路径都在这里）：

1. `edge://extensions` → 移除旧版本 → "加载解压缩的扩展" → 选 `educoder-study-assistant\dist`；
2. 打开设置页，填接口地址 / Key / 模型，点"保存"——**这次不应再出现"设置只能在扩展选项页修改"**，点"测试连接"应回"可用"；
3. 打开实训题页，右上角面板出现，题面读取正常；
4. 点"自动解题"，观察状态行：生成代码 → 写入编辑器 → 回读校验 → 点击评测 → 等待结果；
5. 任何一步卡住，把面板上那行**原文**贴给我（尤其 `INJECT_MISMATCH` / `NO_EDITOR` / "没有找到评测按钮"）。

## 7. 风险与已知限制

| 风险 | 现状 |
|---|---|
| CM6 实例取法有多个变体 | `.cm-editor.cmView.view` 与 `.cm-content.cmView.rootView.view` 两路都试；都拿不到时报 `INJECT_MISMATCH`，不静默失败 |
| 评测按钮藏在终端组件里 | 先帧内后顶层两轮查找；合成事件已补 mousedown/pointerdown |
| 帧中帧 | 同源向下钻两层；跨源嵌套帧不支持 |
| 结果区文案改版 | 候选选择器集中在 `selectors.ts` + 结论关键词分类，改版只动一处 |
| 设置改动生效 | 保存后需刷新实训页（内容脚本不热更新） |
| 评测次数 | 自动提交是真实提交，会消耗课程次数 |

## 8. 下一轮计划（约 10 分钟）

1. **真机回归优先**：等你把面板报错原文或成功截图贴回来，按实际 DOM 调 `selectors.ts`（递增 `SELECTOR_VERSION`）。
2. 结果区识别补强：拿到真实结果区片段后，把精确选择器写进候选首位。
3. 答案库：按题目指纹缓存已通过的代码，同题二次进入零 token；本地存储，不共享。
4. 队列与批处理：一次导入整页作业列表，串行跑完。

---

**结论**：bug 1 已修，自动注入与自动提交闭环代码已就位，构建产物 v0.2.0 可加载。下一步缺的不是代码，是真机上的那一份 DOM 样本。
