# 阶段报告（第 2 轮打点）

- **时间**：2026-11-20 15:24
- **本轮目标**：方案 A 前半段 —— 设置页 + 图标 + 构建
- **结果**：设置页与图标完成、类型检查通过；构建卡在 Vite 8 的 rolldown 依赖解析，尚未产出 `dist/`

---

## 1. 本轮完成

| 项 | 内容 | 状态 |
|---|---|---|
| 设置页 | `src/options/index.html` + `options.css` + `options.ts` | 完成 |
| 图标 | `src/icons/icon{16,32,48,128}.png` | 完成（脚本生成） |
| 图标脚本 | `scripts/make-icons.py`（渐变圆角 + 放大镜） | 完成 |
| `package.json` | `icons` 脚本改指向项目内 `scripts/make-icons.py` | 完成 |
| 类型检查 | `tsc --noEmit` | 通过（15:22） |
| 构建 | `vite build` | **失败**，原因见第 2 节 |
| Edge 冒烟 | 加载 `dist` | 未执行（无产物） |

设置页覆盖：提供商（OpenAI 兼容 / Ollama）、接口地址、API Key、模型名、温度、最大输出 token、请求最小间隔、失败重试次数，以及"保存 / 测试连接 / 清空密钥"和状态提示。选项页是扩展可信上下文，可以读写完整设置；页面侧依旧只能拿到剥离 key 的版本。

## 2. 构建失败详情

命令：`node node_modules/vite/bin/vite.js build`

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'rolldown'
imported from ...\node_modules\vite\dist\node\chunks\node.js
```

初步定位：

- `vite@8.3.8` 的依赖里包含 `rolldown ~1.2.18`；
- pnpm 实际已安装 `rolldown@1.2.19`（`.pnpm/rolldown@1.2.19`，含 `dist/`、`bin/`、平台绑定目录）；
- `vite` 的虚拟目录下也建了 `rolldown` 链接（junction 目标为 `Global\...\.pnpm\rolldown@1.2.19\node_modules\rolldown`）；
- 但 Node 24 的 ESM 解析仍然报找不到包，说明是 pnpm 虚拟仓库链接（junction）层面的解析问题，而非缺包。

**候选修复（下一轮执行，按顺序尝试）**

1. `pnpm install --force` 重建虚拟仓库链接，再跑构建；
2. 仍失败则降级到 `vite@^7`（crxjs 3 声明支持 `^7`），走 rollup/esbuild 构建链；
3. 仍失败则改用 crxjs 2.x 稳定线或改为手写 `manifest.json` + 两次 Vite 构建（内容脚本 IIFE）。

## 3. 当前产物与验证

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 通过 |
| 图标文件 | 16/32/48/128 四个 PNG 已生成 |
| `dist/` | 不存在 |
| Edge 加载 | 未验证 |
| 单测 | 未编写 |
| README | 未编写 |

## 4. 下一轮计划（约 10 分钟）

1. 修构建：`pnpm install --force` → 失败则降级 Vite 7 → 再失败走手写清单方案。
2. 构建成功后在 Edge 中 `--load-extension` 冒烟：确认后台服务注册、content script 注入、面板出现。
3. 若构建顺利且有余量，补 `problem.ts` 的 `node --test` 用例。

## 5. 风险备注

- 构建链是本轮唯一硬阻塞；设置页与图标本身已就绪，不依赖构建修复。
- 若降级 Vite 7，需重新确认 crxjs 3 的 `world: 'MAIN'` 打包产物仍是 IIFE，避免探针失效。
- 设置页保存后不会自动刷新已打开的实训页面，需刷新页面让新旧配置生效（可在 README 中说明）。
