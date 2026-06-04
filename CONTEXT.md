# ApplyFlow Context

当前目标：整理 ApplyFlow GitHub 展示仓库，提交面试官可读的 README、作品集证据链、验证脚本与仓库清理结果。

当前进度：
- 已把 `interview/02_深挖问答与防守口径.md` 中“为什么分类任务不用微调”一段改成岗位数据源分类口径，明确先建标签体系，再用规则/元数据与 few-shot 处理冷启动和歧义样本，删除了地点类比。
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
- 已新增 `scripts/validation/capture-portfolio-evidence-screenshots.js`，截图前校验 Top10 全 A、Top50 全 A/B，并生成 4 张飞书可读短截图：
  - `docs/portfolio/screenshots/evidence-01-top-a-overview.png`
  - `docs/portfolio/screenshots/evidence-02-top-a-card-closeup.png`
  - `docs/portfolio/screenshots/evidence-03-five-dimension-explanation.png`
  - `docs/portfolio/screenshots/evidence-04-apply-boundary-modal.png`
- Evidence Log 第 3 节已改为优先推荐上述 4 张短截图；旧 `u1-jobs-ranking.png` 仅作为历史备份，不建议作为飞书正文主图。
- 面试文档已调整为“02 主复习文档，00/01 只当导航”：`interview/02_深挖问答与防守口径.md` 已按 9 个维度重构为题组作战手册，覆盖意图识别、上下文/RAG/Memory、工具调用、多 Agent、Agent 评测、AI Coding、产品上线复盘、项目深挖和异常排查；v9 已按用户新增视频总结升级两个高频大题：RAG 技术选型改为“传统重型 RAG vs Agentic 轻量检索”的口播，新增“工程级 Prompt 五层结构 + 三类真实工程痛点”；已导出 `02_深挖问答与防守口径_20260604-v9.docx`。
- 已新增 `npm run measure:ai-cost-latency`：本地 5355 岗位池测得规则模式模型调用 0、Top10 强模型预算、强模型调用比例约 0.19%、平均输入 token 估算 293.5、平均输出 token 估算 125.8；产物为 `tmp/ai-cost-latency-profile/summary.json`。
- 已将 README 改为面试官阅读版，明确 ApplyFlow 是“求职场景 AI Agent Workflow”，突出线上体验、排序/解释、投递闭环、Human-in-the-loop、评测与成本边界。
- 已从 Git 索引移除 `node_modules/`、`data/applyflow.sqlite`、根目录 Word 导出和 `interview/` 复习资料；文件仍保留本地，后续不会再误提交到 GitHub。
- `.gitignore` 已补充 `*.docx`、`~$*`、`interview/`、SQLite 备份等本地/隐私/生成文件规则。

下一步：
- 提交本轮 README、Evidence Log、作品集截图脚本、成本/延迟脚本、Git 索引清理和交接文档更新。
- 如要把 GitHub 链接大规模投递，建议下一步做历史清理或新建干净展示仓库，因为旧历史里曾跟踪过 `node_modules`、SQLite 和本地缓存文件。
- 如果继续微调面试文档，优先以本地 `interview/02_深挖问答与防守口径.md` 为唯一主复习文档；该目录已从 GitHub 展示仓库移除跟踪。
- 如继续完善作品集，可把 Evidence Log 内容复制到飞书，并配上 `evidence-01` 到 `evidence-04` 四张短截图；第 11 节只能按“预测/计划”口径引用，成本/延迟引用时要说明 token 是本地估算、不是供应商账单；被问数据来源时按“小样本漏斗 / 1000 样本评估 / 成本画像 / 线上 smoke”四类拆开讲。
- 后续如有时间，再基于正式域名线上账号做小规模抽样评估，对照本地 production-like 1000 样本结果。

注意事项：
- 不要说浏览器一次性渲染 5001 条岗位；正确说法是“线上 D1 挂 5001 条真实岗位，页面展示 Top 候选以保证稳定性”。
- 不要说“城市约束已经靠正式 demo 完全证明”；正式 demo 账号不设硬地点约束，城市约束治理仍引用 L2 地点专项复测。
- 不要把第 11 节 L3 预测值说成真实完成指标；真实 L3 尚未跑完。
- 不要把语义缓存、Kappa 校准、混沌工程、真实供应商 token 账单或 P95 provider latency 写成 ApplyFlow 已完成指标；当前 token 是本地估算，真实账单和 provider tracing 仍待线上补证。
- 不要把 ApplyFlow 包装成全自动投递、自动提交、RAG、多 Agent 或已落地简历改写。
- 简历深挖时不要说“我独立完成全部底层研发”；正确说法是独立负责产品定义、流程拆解、评估口径、证据链和边界治理，工程实现借助 AI Coding 并通过验证脚本与 Focused Review 控制质量。
- 面试复习时不要背英文框架名；先背中文逻辑。比如 Agent 评估样本就说“任务输入、中间轨迹、最终状态、评分方式”，英文只作为面试官提到时能听懂的提示。
- 不要把旧整页长截图 `u1-jobs-ranking.png` 放成飞书主图；优先用新生成的短截图，避免压缩后看不清。
- 当前 GitHub 最新提交会移除 `node_modules`、SQLite、Word 和 interview 复习资料，但历史提交仍可能被翻到；若面试官特别技术、或要长期公开，应继续做历史清理。

最后更新时间：2026-06-04
