# ApplyFlow Context

当前目标：完成 ApplyFlow Internal Beta Batch UX-1 + UX-2：Profile/Dashboard 信息架构优化，并解除 name/background 对排序入口的阻断。

当前进度：
- 后端 `/api/profile/save` 已放宽 `name/background` 强校验，支持仅保存排序意图。
- Dashboard 文案已改为“快速求职意图”，并增加姓名/背景缺失的非阻断提醒。
- Profile 文案与分组已改为“必填排序意图/加分偏好/排除项/申请材料信息/高级设置”，且明确加分偏好非硬过滤。
- 排序核心（`userPriorityScore`/`comparator`/acceptance/gate）未改动。

下一步：
- 运行并归档本轮 UX/Profile flow 验证（含 quick preference flow 新脚本）。
- 继续保持 Internal Beta 边界，不进入 production deploy，不触碰排序核心改造。

注意事项：
- 严禁提交 `data/applyflow.sqlite` 与 `data/*.bak`。
- 严禁部署 production。
- 不允许改排序核心、`userPriorityScore`、`comparator`、`acceptance/gate` 口径。
- 当前仍不是 Production Auth Ready，也不是 50-user beta ready。

最后更新时间：2026-05-12
