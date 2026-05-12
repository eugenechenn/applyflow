# ApplyFlow Context

当前目标：完成 Full-5000+ real-pool staging 验收收口，并提交只读评分验证脚本兼容性修复。

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

下一步：
- 完成 closure commit（仅脚本与文档），保持 sqlite/bak/tmp 不提交。
- 继续保持 Internal Beta 边界，不进入 production deploy，不触碰排序核心改造。

注意事项：
- 严禁提交 `data/applyflow.sqlite` 与 `data/*.bak`。
- 严禁提交 `tmp/` 导入与验收产物。
- 严禁部署 production。
- 不允许改排序核心、`userPriorityScore`、`comparator`、`acceptance/gate` 口径。
- 当前仍不是 Production Auth Ready，也不是 50-user beta ready。

最后更新时间：2026-05-12
