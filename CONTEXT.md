# ApplyFlow Context

当前目标：完成 Internal Beta 1-user whitelist login acceptance 收口，并进入下一阶段隔离专项准备。

当前进度：
- staging D1 `staging_real_pool_user` 已完成 Full-5000+ 导入：`jobs=5001`、`sourceLabel=feishu_offline_real_pool=5001`。
- `demo_user` 全程保持 `jobs=12`，未污染；production 未触碰（仅 `--env staging --remote`）。
- 4 组画像 Top100 验收：
  - 产品经理+上海：A10/B90
  - 数据分析+上海：A14/B86
  - 算法工程师+上海：A48/B52
  - 后端开发+上海：A16/B84
- 四组 `highRoleFitButLowGrade=0`，结论为真实池排序链路正常；PM 旧“无A”源于 demo 小数据/画像，不是评分核心异常。
- `validate-staging-real-pool-scoring-smoke.js` 已做 Full 数据量兼容修复（`maxBuffer` + `wrangler --json` 解析），不涉及排序核心。
- staging demo canonical entry 继续使用 `https://applyflow-staging.applyflow-eugene.workers.dev/?mode=demo#/dashboard`。
- 1 个白名单用户 staging 手工验收已通过：
  - 白名单邮箱登录 PASS，且登录身份不是 `demo_user`
  - 可进入 Dashboard，快速偏好“产品经理+上海”可保存
  - Jobs / Profile 页面可正常打开
  - 退出或清 cookie 后普通路径不自动 demo
- 用户反馈一个“非阻断 UX polish”点，后续单独跟踪处理。
- 当前可用于“面试演示 + 本人 staging 自测 + 1 用户白名单登录验证”；仍不声明 3-5 人 fully ready / 50-user beta ready / Production Auth Ready。

下一步：
- 推进 A/B 用户隔离端到端验证。
- 推进 `user_a fallback / payload.userId` 专项治理。
- 将本轮非阻断 UX polish 纳入后续单独任务。

注意事项：
- 严禁提交 `data/applyflow.sqlite` 与 `data/*.bak`。
- 严禁提交 `tmp/` 导入与验收产物。
- 严禁部署 production。
- 不允许改排序核心、`userPriorityScore`、`comparator`、`acceptance/gate` 口径。
- 当前仍不是 Production Auth Ready，也不是 50-user beta ready。

最后更新时间：2026-05-14
