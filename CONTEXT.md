# ApplyFlow Context

当前目标：完成正式自定义域名 `apply-flow-use.com` 的第一阶段切换，让 ApplyFlow 对外主入口从不稳定的 `workers.dev` 切到 `https://www.apply-flow-use.com`，同时保留旧 `workers.dev` 兜底。

当前进度：
- 已确认用户在 Cloudflare 购买并托管 `apply-flow-use.com`。
- 已将 Worker 自定义域名配置写入 `wrangler.jsonc`：`www.apply-flow-use.com` 绑定 `applyflow` Worker。
- 已显式保留 `workers_dev: true`，避免旧 `https://applyflow.applyflow-eugene.workers.dev` 被部署时关闭；已显式关闭 `preview_urls`。
- 已收紧正式域名 auth gate：`AUTH_PROVIDER=internal_beta`、`INTERNAL_BETA_ENABLED=true`、`BETA_ALLOWED_EMAILS=eugenec7012@126.com`，demo 自动登录和 dev bypass 均关闭。
- 已将线上 smoke、onboarding 诊断脚本、Edge 插件默认入口、插件下载包和作品集正式体验链接切到 `https://www.apply-flow-use.com`。
- 已重新生成 Edge 插件下载 ZIP。
- 已完成 Cloudflare 部署，当前版本 ID：`98145b28-cb76-4dcf-9e64-b7055093fb90`。
- 已完成正式入口风险审计并修复跳转兜底：`apply-flow-use.com` 和旧 `app.apply-flow-use.com` 均 301 到 `www.apply-flow-use.com`，避免用户漏写 `www` 或旧链接失效。
- 已验证新入口和旧兜底入口均可访问：`https://www.apply-flow-use.com/` 返回 200，`https://applyflow.applyflow-eugene.workers.dev/` 返回 200。
- 已通过 production online smoke：`validate-production-online-smoke: PASS (https://www.apply-flow-use.com)`，包含 `/api/login` 403（正式域名拒绝非 demo 登录）和页面标题 `ApplyFlow`。
- 已生成 onboarding/bootstrap 诊断报告：`tmp/production-onboarding-bootstrap/report.json`，`/api/auth/session` 返回 200，无 console/page error。
- 已完成 production D1 真实岗位池导入：`eugenec7012@126.com` 对应用户 `user_1191pcx1` 当前线上 D1 有 5001 条真实岗位；`/api/jobs` 默认展示去重后的 Top 494 条，登录态页面可正常渲染且无 console/page error。

下一步：
- 用浏览器手动打开新域名确认登录页、岗位列表和插件下载入口体验是否符合展示预期。
- 把飞书作品集、简历作品链接和面试材料统一改为 `https://www.apply-flow-use.com`，不要再使用 `workers.dev` 或 `app.apply-flow-use.com`。
- 后续如需要，再规划根域名 `apply-flow-use.com` 的跳转或作品集落地页；当前先不做。

注意事项：
- 本轮只做域名入口和验证脚本切换，不修改业务逻辑、D1 数据、评估规则。
- `workers.dev` 只作为兜底，不再发给朋友、面试官或作品集。
- `www.apply-flow-use.com` 是唯一正式对外入口；根域名和旧 `app` 入口只是 301 跳转兜底。
- `eugenec7012@126.com` 当前线上 D1 已挂 5001 条真实岗位；页面为了性能默认展示 Top 494 条，不要表述为浏览器一次渲染全部 5001 条。
- 当前仓库仍存在部分历史脏改和数据库/Word 临时文件，提交时必须只选择必要文件，不能把 `data/applyflow.sqlite`、`.bak` 或 Word 锁文件误提交。

最后更新时间：2026-06-03
