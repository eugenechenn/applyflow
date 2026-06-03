# ApplyFlow Context

当前目标：正式域名 `https://www.apply-flow-use.com` 已上线，当前重点是保证面试官能稳定访问真实岗位池驱动的产品页面，并把 Playwright 截图补进 Evidence Log。

当前进度：
- `www.apply-flow-use.com` 是唯一正式对外入口；根域名 `apply-flow-use.com` 和旧 `app.apply-flow-use.com` 均 301 到 `www`。
- Cloudflare Worker 当前线上版本 ID：`526e6606-2e32-4408-8fb5-952f64de352d`。
- Auth 保持 internal beta：`eugenec7012@126.com` 是白名单账号，demo 自动登录和 dev bypass 均关闭。
- production D1 中 `eugenec7012@126.com` 对应用户 `user_1191pcx1` 已挂 5001 条真实岗位。
- 发现并修复正式账号画像编码污染：原画像出现 `????`，已改为正常中文偏好（AI 产品经理/产品经理，上海/北京/杭州/深圳等）。
- 发现并修复线上 5001 岗位重排触发 Worker 资源超限风险：线上 `/api/jobs` 改为 D1 真实池保留 5001，Worker 每次取 Top 候选进入评分与页面展示；当前页面展示 116 条候选。
- 已新增并运行 `npm run validate:production-real-pool-flow`，Playwright 验证登录、Dashboard、Jobs、投递辅助弹窗、Profile、插件下载入口均通过，无 console/page error。
- 已生成正式线上截图：
  - `docs/portfolio/screenshots/production-www-dashboard.png`
  - `docs/portfolio/screenshots/production-real-pool-jobs-top-candidates.png`
  - `docs/portfolio/screenshots/production-apply-plugin-flow.png`
  - `docs/portfolio/screenshots/production-profile-autofill.png`
- 已将正式线上截图、D1 5001 / 页面 Top 116 口径和隐患修复记录写入 `docs/portfolio/APPLYFLOW_FEISHU_EVIDENCE_LOG_READY.md`。

下一步：
- 提交并推送本轮正式入口全流程验证、性能护栏、Evidence Log 与截图。
- 如继续完善作品集，可把 Evidence Log 内容复制到飞书，并配上上述 4 张截图。
- 后续如有时间，再基于正式域名线上账号做小规模抽样评估，对照本地 production-like 1000 样本结果。

注意事项：
- 不要说浏览器一次性渲染 5001 条岗位；正确说法是“线上 D1 挂 5001 条真实岗位，页面展示 Top 候选以保证稳定性”。
- 不要把 ApplyFlow 包装成全自动投递、自动提交、RAG、多 Agent 或已落地简历改写。
- 当前仓库仍有历史脏改和临时文件，提交时不要误提交 `data/applyflow.sqlite`、`.bak` 或旧 Word 副本。

最后更新时间：2026-06-03
