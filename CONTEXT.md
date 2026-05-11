# ApplyFlow Context

当前目标：收口 Internal Beta Batch 4，准备干净 commit（Demo Mode + 白名单 Beta 门禁 + 验证脚本），且不触碰排序核心与生产部署。

当前进度：
- Batch 4 Fix/Close 验证已通过：`lint`、`typecheck`、`build`、`validate:ui-runtime-smoke`、`validate:ui-key-path-playwright`、`validate:job-scoring-derived-view`、`eval:acceptance`、`eval:gate`、以及 5 个 beta/demo 验证脚本。
- 当前达到“3-5 人 Internal Beta 候选可验证状态”。
- 明确仍不是 Production Auth Ready，也不是 50-user beta ready。
- `/api/demo/reset` 仍为 guarded `501`（未实现 reset）。
- `user_a fallback / payload.userId` 全量治理后置，未在本批次完成。

下一步：
- 完成 Batch 4 Closure commit（仅纳入本批次 auth/demo/beta 与验证脚本改动，排除 sqlite/bak 与无关历史改动）。
- 进入 Batch 5 二选一：`staging smoke` 或 `user_a/payload.userId` 专项治理。

注意事项：
- 严禁提交 `data/applyflow.sqlite` 与 `data/*.bak`。
- 严禁声明 Production Auth Ready 或 50-user beta ready。
- 不允许改排序核心、`userPriorityScore`、`comparator`、`acceptance/gate` 口径。

最后更新时间：2026-05-12
