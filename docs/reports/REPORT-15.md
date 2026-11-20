# 阶段报告（第 15 轮打点）

- **时间**：2026-11-20 20:42
- **本轮目标**：把 `CREATE DATABASE IF NOT EXISTS MyDb;` 做进脚本，不再依赖人工添加
- **结果**：新增「SQL 前置语句」，版本 **0.3.1**。`tsc` 通过、15 条单测通过、`dist/` 已重建。

---

## 1. 改动

终端任务现在按三段执行：

```
① 终端前置命令（shell）：mysql -h127.0.0.1 -uroot -p123123
② SQL 前置语句（mysql 会话内）：CREATE DATABASE IF NOT EXISTS MyDb;
                                USE MyDb;
③ 生成的代码
```

- 「SQL 前置语句」是新增设置项，默认值已写死为上面两行；
- 输入方式是逐键键入，行内换行由 Enter 逐条提交——mysql 客户端以 `;` 结束语句，所以多行 `CREATE TABLE` 不会被提前截断；
- 开关 `useSqlPrelude` 可关闭；关闭后行为与 0.3.0 一致。

状态行会显示 `已键入 N 行（含建库语句），前置登录已执行；终端结果以评测为准`。

## 2. 验证记录

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | ✅ |
| `node --test --test-isolation=none "test/**/*.test.ts"` | ✅ 15/15 |
| `vite build` | ✅ 214ms，v0.3.1 |
| `dist/manifest.json` | ✅ v0.3.1 |

**验证**：重载扩展（标题须 **v0.3.1**）→ 打开 SQL 题 → 自动解题 → 终端里应先出现登录、再出现 `CREATE DATABASE IF NOT EXISTS MyDb;` 与 `USE MyDb;`、最后是题目 SQL。

## 3. 风险备注

- 建库语句在 mysql 会话内执行：若前置命令没进 mysql（比如终端是纯 shell），这行会报 `Unknown command`——此时把 `useTerminalPrelude` 与 `useSqlPrelude` 一起开着即可，顺序保证先登录再建库；
- `IF NOT EXISTS` 保证重复执行不报错，重试轮不会因为建库失败而卡住。

---

**结论**：建库从"人工补"变成"脚本自动补"，且可配置，不影响其他题型。
