# ApplyFlow Context

当前目标：正式域名 `https://www.apply-flow-use.com` 已上线，当前重点是保证面试官能稳定访问真实岗位池驱动的产品页面，并把 Playwright 截图补进 Evidence Log。

当前进度：
- `www.apply-flow-use.com` 是唯一正式对外入口；根域名 `apply-flow-use.com` 和旧 `app.apply-flow-use.com` 均 301 到 `www`。
- Cloudflare Worker 当前线上版本 ID：`68afc646-da8a-42e9-b655-845119144cb7`。
- Auth 保持 internal beta：`eugenec7012@126.com` 是白名单账号，demo 自动登录和 dev bypass 均关闭。
- production D1 中 `eugenec7012@126.com` 对应用户 `user_1191pcx1` 已挂 5001 条真实岗位。
- 发现并修复正式账号画像编码污染：原画像出现 `????`；当前正式展示画像为产品经理 / AI 产品经理 / 数据产品经理，行业偏金融科技、互联网、人工智能，不设置硬地点约束。
- 发现并修复线上 5001 岗位重排触发 Worker 资源超限风险：线上 `/api/jobs` 改为 D1 真实池保留 5001，Worker 每次取 Top 候选进入评分与页面展示；当前页面展示 116 条候选。
- 已新增并运行 `npm run validate:production-real-pool-flow`，Playwright 验证登录、Dashboard、Jobs、投递辅助弹窗、Profile、插件下载入口均通过，无 console/page error；当前等级分布 A=86、B=30，Top10 全 A，Top50 全 A/B。
- 已给正式线上 D1 粗排增加行业偏好信号，减少非目标行业岗位抢占 Top 候选。
- 已生成正式线上截图：
  - `docs/portfolio/screenshots/production-www-dashboard.png`
  - `docs/portfolio/screenshots/production-real-pool-jobs-top-candidates.png`
  - `docs/portfolio/screenshots/production-apply-plugin-flow.png`
  - `docs/portfolio/screenshots/production-profile-autofill.png`
- 已将正式线上截图、D1 5001 / 页面 Top 116 口径和隐患修复记录写入 `docs/portfolio/APPLYFLOW_FEISHU_EVIDENCE_LOG_READY.md`。
- 已在 Evidence Log 第 11 节补充 L3 全量回归预测结果与正式输出格式；明确这不是已完成数据，后续真实跑完后替换。

下一步：
- 提交并推送本轮正式入口全流程验证、性能护栏、Evidence Log 与截图。
- 如继续完善作品集，可把 Evidence Log 内容复制到飞书，并配上上述 4 张截图；第 11 节只能按“预测/计划”口径引用。
- 后续如有时间，再基于正式域名线上账号做小规模抽样评估，对照本地 production-like 1000 样本结果。

注意事项：
- 不要说浏览器一次性渲染 5001 条岗位；正确说法是“线上 D1 挂 5001 条真实岗位，页面展示 Top 候选以保证稳定性”。
- 不要说“城市约束已经靠正式 demo 完全证明”；正式 demo 账号不设硬地点约束，城市约束治理仍引用 L2 地点专项复测。
- 不要把第 11 节 L3 预测值说成真实完成指标；真实 L3 尚未跑完。
- 不要把 ApplyFlow 包装成全自动投递、自动提交、RAG、多 Agent 或已落地简历改写。
- 当前仓库仍有历史脏改和临时文件，提交时不要误提交 `data/applyflow.sqlite`、`.bak` 或旧 Word 副本。

最后更新时间：2026-06-03
