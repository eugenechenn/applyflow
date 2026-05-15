# ApplyFlow Context

当前目标：将 ApplyFlow 整理为 AI 岗位面试作品集叙事，生成可复习的面试手册，帮助用项目争取 offer。

当前进度：
- 已阅读项目核心文档与 `interview/` 下全部面试资料。
- 已梳理 ApplyFlow 的面试主线：求职执行闭环、五维排序合同、用户确认与反馈复盘、demo/beta/real-pool 隔离、安全边界与验证脚本。
- 已新增并补充 `interview/ApplyFlow_AI面试作品集复习手册.md`，包含 30 秒开场、3 分钟叙事、优势、不足、深挖问答、演示路径、简历 bullet、N=1 线上 dogfooding 证据采集、RAG/eval harness/benchmark 回答、场景题框架、下一阶段路线与 Focused Review 自审；已移除不符合当前功能现状的“简历改写已落地”表述。
- 已阅读用户简历 PDF，确认当前简历缺少 ApplyFlow 核心项目呈现；新增 `interview/ApplyFlow_简历修改与作品集材料方案.md` 与 `docs/APPLYFLOW_PORTFOLIO_ONE_PAGER.md`。
- 已新增 `docs/portfolio/` 作品集材料：one-pager Markdown/HTML、Internal Beta Evidence Log 模板、飞书作品集结构。
- 已将 Internal Beta Evidence Log 的任务记录改为按用户体验全流程填写，覆盖岗位导入、偏好设置、推荐排序、推荐理由、重点岗位清单、多岗位对比、投递状态、反馈记录和后续跟进。
- 已按 U1-U5 五个画像代测草稿预填 Evidence Log，明确标注为代测/模拟走查口径，待朋友真实试用后替换截图、耗时与访谈原话。
- 已用 Playwright 生成本地 demo_user 页面截图并补入 Evidence Log，截图覆盖工作台、个人资料/高级偏好、岗位排序与发现页空态边界。
- 已根据线上真实体验反馈收敛岗位卡片主路径：隐藏材料/高级记录干扰，主动作改为打开投递链接、加入投递清单、标记已投递和反馈误判/不匹配，并写入 Evidence Log 迭代记录。
- 已完成投递主路径 Focused Review，修复隐藏 shortlist localStorage 筛选导致旧用户无法看到全部岗位的缓存状态错位问题，并重新部署 staging。
- 当前可讲证据：`demo_user=38`、`staging_real_pool_user=5001`、四画像 Top100 A/B 覆盖、`highRoleFitButLowGrade=0`、A/B 白名单隔离、forged `payload.userId` 拒绝。

下一步：
- 按方案修改简历与作品集：作品集主线聚焦岗位筛选、可解释排序、状态管理、反馈闭环和内测证据，不写未落地的简历改写功能。
- 按手册执行 7 天线上 dogfooding：用本人真实求职目标跑完整流程，记录 Bad Case、耗时、采纳/拒绝/修正、改进与复测证据。
- 面试前按手册演示路径做一次 staging 人工 smoke。
- 若项目状态、数据量、URL 或 Production Auth 进度变化，及时同步更新手册。
- 后续可基于手册再生成简历版项目描述与口播提纲。

注意事项：
- 当前仍不是 Production Auth Ready，也不是 50-user beta ready。
- 面试中不要承诺默认全自动海投或公开 SaaS 已上线。
- N=1 dogfooding 只能作为真实流程与迭代证据，不可包装成大规模用户数据。
- 严禁提交 `data/applyflow.sqlite`、`data/*.bak` 与 `tmp/` 产物。
- 严禁部署 production。
- 不允许改排序核心、`userPriorityScore`、`comparator`、`acceptance/gate` 口径。

最后更新时间：2026-05-15
