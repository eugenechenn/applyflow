# ApplyFlow Context

当前目标：完成 Internal Beta Batch 5E Close，提交 staging demo 入口收口修复与文档同步，保持仅 staging 范围。

当前进度：
- staging 已部署到 `72964f5c-cafa-4adc-80ab-5b178fd0c484`（`https://applyflow-staging.applyflow-eugene.workers.dev`）。
- 结论确认：staging 下 `/demo` 会 `307 -> /`，当前 canonical demo 入口改为 `/?mode=demo#/dashboard`。
- 普通路径未登录保持 Internal Beta 登录页，不自动 demo。
- 当前仍是“3-5 人 Internal Beta 候选可验证状态”，仍不是 Production Auth Ready，也不是 50-user beta ready。

下一步：
- 提交本轮 demo entry 修复（仅允许文件）并由人工完成 staging 手工验收记录。
- 后续再评估 `/demo` 在 workers.dev 的长期策略（保留 query 入口或切 custom domain）。

注意事项：
- 严禁提交 `data/applyflow.sqlite` 与 `data/*.bak`。
- 严禁部署 production。
- 不允许改排序核心、`userPriorityScore`、`comparator`、`acceptance/gate` 口径。

最后更新时间：2026-05-12
