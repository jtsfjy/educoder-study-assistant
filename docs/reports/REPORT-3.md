# 阶段报告（第 3 轮打点）

- **时间**：2026-11-20 16:00
- **本轮目标**：修通构建，产出可加载的 `dist/`
- **结果**：**构建成功**，`dist/` 已生成且 manifest 校验通过；Edge 冒烟被当前沙箱阻断，需你在本机手动加载验证

---

## 1. 本轮完成

| 项 | 结果 |
|---|---|
| 设置页 | `src/options/index.html` + `options.css` + `options.ts`（提供商 / 地址 / Key / 模型 / 温度 / token / 间隔 / 重试 + 保存、测试连接、清空密钥） |
| 图标 | `src/icons/icon{16,32,48,128}.png`，由 `scripts/make-icons.py` 生成 |
| `.npmrc` | 记录 `node-linker=hoisted` 的原因说明 |
| 依赖布局 | 重新安装为扁平 `node_modules`（真实目录，非 junction） |
| 构建 | `vite build` 成功（Vite 8.3.8，22 个模块，128ms） |
| `dist/manifest.json` | UTF-8 正常、无 BOM；`name` 为"头歌学习助手"；两段 content script（ISOLATED + MAIN world）均保留；`options_ui` 指向正确 |
| 类型检查 | 通过（15:22 修复 options 导入后） |

构建产物结构：

```
dist/
├─ manifest.json
├─ service-worker-loader.js
├─ assets/        （后台、options、top、probe 的打包结果 + 样式）
└─ src/
   ├─ icons/icon{16,32,48,128}.png
   └─ options/index.html
```

## 2. 构建问题与最终解法

| 尝试 | 结果 |
|---|---|
| Vite 8 + pnpm 虚拟仓库（junction） | `ERR_MODULE_NOT_FOUND: rolldown` |
| 加 `--preserve-symlinks` | 同样失败（路径已是非规范化形式，参数不解决） |
| 降级 Vite 7 | `ERR_MODULE_NOT_FOUND: rollup`，说明是 junction 层面的通用问题，非 rolldown 独有 |
| 改为扁平安装 `pnpm install --node-linker=hoisted` | 根因解除，`node_modules/vite` 变成真实目录 |
| Vite 7 扁平安装后构建 | `spawn EPERM` —— 当前 DSH 沙箱禁止子进程管道，esbuild 服务起不来 |
| **Vite 8 扁平安装后构建** | **成功**。Rolldown 在进程内加载原生模块，不 spawn 子进程，因此绕开沙箱限制 |

结论：**Node 24 + Windows junction 是根因；本机沙箱让 esbuild（Vite 7 构建链）不可用，最终组合 = Vite 8 + 扁平 `node_modules`**。

注意：`.npmrc` 里的 `node-linker=hoisted` 未被当前 pnpm 版本读取（`pnpm config get node-linker` 返回 undefined），本次是通过命令行 `--node-linker=hoisted` 生效的。下次重装依赖需要带这个参数，或改用 `pnpm-workspace.yaml` 的 `nodeLinker` 配置（下一轮确认）。

## 3. Edge 冒烟：被沙箱阻断

直接启动 Edge 失败：

```
FATAL: platform_channel.cc: Check failed: 拒绝访问 (0x5)
```

这是 DSH 沙箱禁止命名管道导致的 Chromium IPC 启动失败，不是扩展本身的问题。无头模式下同样无法建立 CDP 连接。

**请你在本机手动加载验证：**

1. 打开 `edge://extensions`，开启"开发人员模式"；
2. "加载解压缩的扩展"，选 `dist` 目录；
3. 点扩展图标打开设置页，填接口地址 / Key / 模型，点"测试连接"；
4. 打开头歌实训题页面，右上角应出现"头歌学习助手"面板。

## 4. 当前状态

| 项 | 状态 |
|---|---|
| 源码完整性 | 设置页、图标、构建产物均已就绪 |
| `tsc --noEmit` | 通过 |
| `dist/` | 已生成，manifest 合法 |
| Edge 加载 | 待你手动验证（本机沙箱不允许启动浏览器） |
| 单测 | 未编写 |
| README | 未编写 |

## 5. 下一轮计划（约 10 分钟）

1. 补 `test/problem.test.ts`：语言识别、锚点分段、样例配对、指纹稳定性（`node --test`）。
2. 写 `README.md`：安装、配置、隐私边界、开发命令、依赖安装注意（`--node-linker=hoisted`）。
3. 验证依赖重装可复现（`pnpm-workspace.yaml` 或脚本固化 `node-linker`）。
4. 检查 `dist/src/options/index.html` 的资源引用与 CSP 兼容性。

## 6. 风险备注

- 如果重新 `pnpm install` 未带 hoisted 参数，会再次生成 junction，构建会退回 `ERR_MODULE_NOT_FOUND`。
- Vite 8 的 Rolldown 链对 `world: 'MAIN'` 产物是 IIFE（`frame-*.js`），需在真实页面中确认探针能收到 postMessage。
- 设置页保存后需刷新实训页面才生效。
