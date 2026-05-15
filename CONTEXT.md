# ApplyFlow Context

当前目标：完成 Internal Beta 的 user_a / payload.userId fallback 专项治理，确保 beta/staging 写入只使用 authenticated user。

当前进度：
- staging D1 `staging_real_pool_user` 已完成 Full-5000+ 导入：`jobs=5001`、`sourceLabel=feishu_offline_real_pool=5001`。
- `demo_user` 全程保持 `jobs=12`，未污染；production 未触碰（仅 `--env staging --remote`）。
- 仓库 demo seed 已升级为 curated pool（`38` 条，覆盖一线+新一线城市与 PM/数据/算法/后端/运营岗位），并新增 `validate-demo-curated-pool-ranking.js`。
- 本地 derived-view 验证显示 curated pool 满足面试演示目标（多画像 Top5 A/B 前移、`highRoleFitButLowGrade=0`）。
- staging demo 已受控 reseed 到 `demo_user=38`；`staging_real_pool_user=5001` 保持不变。
- 已完成 fallback 风险治理：
  - `store` 写入路径在 internal beta / staging / prod-like 下不再 fallback `user_a`
  - API 拒绝 forged `payload.userId`（与 authenticated user 不一致时拒绝）
  - discovery/import/sync 写链改为仅使用 request context authenticated userId，不再读取 `payload.userId`
- 4 组画像 Top100 验收：
  - 产品经理+上海：A10/B90
  - 数据分析+上海：A14/B86
  - 算法工程师+上海：A48/B52
  - 后端开发+上海：A16/B84
- 四组 `highRoleFitButLowGrade=0`，结论为真实池排序链路正常；PM 旧“无A”源于 demo 小数据/画像，不是评分核心异常。
- `validate-staging-real-pool-scoring-smoke.js` 已做 Full 数据量兼容修复（`maxBuffer` + `wrangler --json` 解析），不涉及排序核心。
- staging demo canonical entry 继续使用 `https://applyflow-staging.applyflow-eugene.workers.dev/?mode=demo#/dashboard`。
- 2 个白名单用户（A/B）staging 手工验收已通过：
  - A/B 均可登录，且登录身份不是 `demo_user`
  - Dashboard / Jobs / Profile 可正常打开，快速偏好可保存
  - A/B 账号互不串扰（手工验收通过）
  - 退出或清 cookie 后普通路径不自动 demo
- 用户反馈一个“非阻断 UX polish”点，后续单独跟踪处理。
- 当前可用于“面试演示 + 本人 staging 自测 + 2-user 白名单真实体验内测”；3-5 人白名单内测的核心 ownership 风险已收敛，但仍不声明 50-user beta ready / Production Auth Ready。

下一步：
- 若扩展到 3-5 人白名单：补齐远端可达网络环境下的自动脚本证据（当前 workers.dev TLS 在部分环境不可达）。
- 在可达网络环境补齐 A/B 自动化脚本与 demo/UI 远端 smoke 证据。
- 将本轮非阻断 UX polish 纳入后续单独任务。

注意事项：
- 严禁提交 `data/applyflow.sqlite` 与 `data/*.bak`。
- 严禁提交 `tmp/` 导入与验收产物。
- 严禁部署 production。
- 不允许改排序核心、`userPriorityScore`、`comparator`、`acceptance/gate` 口径。
- 当前仍不是 Production Auth Ready，也不是 50-user beta ready。

最后更新时间：2026-05-15
