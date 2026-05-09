# ApplyFlow

更新时间：2026-04-29

ApplyFlow 是一个“先筛后投”的半自动求职执行系统：
- 批量获取岗位并去重标准化
- 给出可解释的投递优先级判断
- 基于岗位生成定制申请材料
- 在人工确认下执行网页申请

ApplyFlow 不是自动海投机器人，也不是单点简历美化工具。

## 一句话定位

ApplyFlow = 求职意图输入 + 岗位筛选决策 + 定制材料生成 + 可控申请执行。

## 作品集能力快照（2026-04-29）

- 多维偏好决策系统：`jobPreferenceProfile`（行业/岗位/地点/技能/公司类型/排除项/求职类型）。
- CareerOps-like 决策输出：`go/review/no_go`、`A-F`、`confidence`、`hardBlockers`、`nextAction`。
- Human-in-the-loop：反馈状态（good_fit/bad_fit/misclassified）以低风险 derived 信号影响后续排序解释。
- 求职执行闭环：tracker + materials + submission audit + follow-up（均为 metadata-only，不污染 canonical job）。
- 工程化回归门禁：`core22 + gate` 固定门禁，`diagnostic/full44` 仅观察，不混入 PASS/FAIL。

当前稳定门禁基线：
- `core22/gate p@5=90.9%`
- `core22/gate p@10=90.0%`
- `hardFail=0`

已知透明缺口（非阻塞）：
- `phase45_game_pm_planning_045` 仍是 diagnostic known gap（英文 alias 映射 + 数据覆盖不足 + 多岗位打包 JD 稀释）。
- 中文对照样本 `phase45_game_pm_planning_zh_057` 已通过，当前策略是持续观察与数据侧改进优先。

## 目标用户

- 同时管理几十到数百个岗位的求职者
- 需要“效率 + 判断质量 + 可控执行”的用户
- 希望把求职从零散操作变成可追踪流程的人

## 为什么用 ApplyFlow

相比普通求职 SOP，ApplyFlow 的核心价值是：
1. 岗位批量处理：不是手工逐条看 JD，而是先统一解析、去重、排序。
2. 投递判断可解释：每条岗位都说明为什么该投/不该投、主要短板是什么。
3. 定制材料可追踪：从 master resume 到岗位定制版有结构化链路，不是黑盒改写。
4. 执行可控：先预填和 dry-run，再人工确认提交，避免脆弱全自动。

## 新主链路（Phase 1）

1. 用户输入求职意图
- 岗位关键词
- 城市偏好
- 校招 / 社招
- 可选：薪资 / 行业

2. 批量岗位导入与标准化
- URL 批量导入
- 解析结构化岗位信息
- 去重并生成统一岗位列表

3. 岗位评分与优先级
- 匹配度评分
- 投递建议（建议投递 / 谨慎投递 / 暂不投递）
- 解释与风险

4. 岗位详情解释
- 关键要求
- 匹配证据
- 主要短板
- 下一步建议

5. PDF 简历链路
- 导入 -> 结构化 -> 清洗 -> canonical resume
- 生成岗位定制版材料
- 导出（优先 PDF / DOCX）

6. 申请执行
- 一键进入岗位网页
- 预填 / dry-run
- 人工确认后提交

## 功能边界

### 必做
- 批量岗位导入、去重、评分、排序
- 岗位详情解释
- master resume + tailored resume
- 申请执行页（预填 / dry-run / 人工确认）

### 可选
- 批量任务调度与重试
- 多站点采集扩展
- 申请后复盘增强

### 暂不做
- 默认全自动海投
- 复杂企业权限系统
- 重型 RAG 平台
- 复杂模板编辑器

## 架构原则（partial_rebuild）

1. 单一数据源（SSOT）
- UI 只读 workspace view-model
- workspace 只读 canonical contracts
- parser 原始输出不直接进入 UI

2. 分层边界清晰
- document extraction
- resume structuring
- normalization / contamination cleanup
- workspace model
- render

3. 失败信息隔离
- fallback / warning 只进入系统日志或状态字段
- 不进入用户核心内容字段

4. 受控迁移
- 保留基础设施（CI、guardrails、deploy、skills）
- 删除旧路径，不长期并存

## 参考项目吸收点

- career-ops：批处理与执行系统思维
- ApplyPilot：岗位聚合、评分、执行流程
- claude-code-job-tailor：master resume 到 job-tailored 的结构化路径
- Job-Application-Automator：网页申请自动化边界与可控执行

ApplyFlow 不照搬任何一个项目，而是吸收其主链路价值。

## 当前阶段

当前仓库进入 partial_rebuild 的 Phase 0：
- 文档重写
- 边界冻结
- 删除计划

代码重构从 Phase 1 开始，按 docs 中的计划分阶段执行。

补充（2026-04-28）：
- Phase 1/2 已完成并形成稳定 baseline（`core22/gate: p@5=89.1%, p@10=86.4%, hardFail=0`）。
- Phase 3 Step 1（Decision Verdict Layer）已完成：
  - 在 jobs derived/view 层新增 `go/review/no_go`、`A-F`、`confidence`、`hardBlockers`、`weightedSummary`、`nextAction`。
  - Jobs 页面已最小展示 verdict 信息。
  - `no_go` 已收窄为仅明确硬阻断来源。
- Phase 3 Step 2（Profile-driven Skill Gap Layer）已完成：
  - 新增 `skillGapView`（derived-only，不写 canonical job）。
  - 仅基于 profile 技能与岗位文本做 deterministic 技能偏好匹配。
  - 不接入 PDF / resume parser / OCR / LLM 简历解析。
  - `skills` 为空时返回 `overallFit=unknown`，不影响排序和 decisionVerdict。
- Phase 3 Step 3（Application Tracker Core）已完成：
  - 新增 tracker 状态机：`none / saved / applied / interview / rejected / offer`。
  - Jobs 页面支持状态 badge、状态切换、状态过滤、timeline 展示。
  - 状态可持久化回显。
  - 非法 tracker state 在后端写入接口会返回 `400` 拒绝。
  - 旧数据读取保持安全 fallback（缺失/异常状态按 `none` 展示）。
- Phase 3 Step 4（Human Feedback Loop）已完成：
  - 新增反馈状态：`none / good_fit / bad_fit / misclassified`。
  - Jobs 页面支持反馈按钮与反馈时间线。
  - 反馈以 deterministic 低权重方式影响同类岗位排序（derived signal，小幅加减分）。
  - explanation 会提示反馈影响来源。
  - role 为空时不参与同类反馈聚合，避免空桶扩散。
  - 非法 feedback state 后端 `400` 拒绝，重复同状态不重复追加时间线。
  - Jobs 页面增加提示：“反馈会轻微影响后续同类岗位排序”。
  - eval 运行路径已禁用 feedback influence（仅评估隔离，不影响生产 `/api/jobs`）。
  - 不改 canonical job、不改硬阻断、不自动改写用户原始偏好。
- Phase 3 Step 5（Batch Compare + Shortlist Workflow）已完成：
  - 新增 shortlist 状态：`none / shortlisted` 与 `shortlistTimeline`。
  - Jobs 页面支持 `Add to Shortlist / Remove`、Shortlist filter。
  - 新增 Compare panel（仅展示 shortlisted jobs）用于并排决策对比。
  - 新增 `applyPriority`（`high / medium / low`）用于投递优先级提示。
  - 非法 shortlist state 后端 `400` 拒绝；重复点击 shortlisted 不重复追加 timeline。
  - compare 面板对缺失字段具备安全兜底，不影响页面渲染。
- Phase 4 Step 1（Application Workflow Expansion）已完成：
  - tracker 状态扩展为 `none / saved / prep / tailored / applied / interview / rejected / offer`。
  - `prep / tailored` 已支持写入、回显、过滤与 timeline 记录。
  - 非法 tracker state 后端 `400` 拒绝，重复同状态不重复追加 timeline。
  - tracker 状态过滤仅影响 view，不影响岗位排序主链。
- Phase 4 Step 2（Materials Prep Record）已完成：
  - 新增 `materialsPrepView`（metadata-only）：
    - `resumeStatus: none / draft / tailored / finalized`
    - `coverLetterStatus: none / draft / tailored / finalized`
    - `interviewPrepStatus: none / draft / ready`
    - `notes`
    - `lastUpdatedAt`
  - 新增材料记录保存接口并启用严格枚举校验，非法状态后端 `400` 拒绝。
  - `notes` 支持保存、清空、回显。
  - `lastUpdatedAt` 仅在材料内容实际变化时刷新（no-op 保存不刷新）。
  - materials 仅作为 metadata，不自动改 trackerState，不接入 PDF/parser/OCR/LLM。
- Phase 4 Step 3（Submission Audit / Plugin Linkage 最小版）已完成：
  - 新增 `submissionAuditView`（metadata-only）：
    - `status: none / ready / submitted / failed / needs_review`
    - `source: manual / plugin / system`
    - `submittedAt / lastAttemptAt / attemptCount / lastError / notes`
  - 新增投递审计更新接口并启用严格枚举校验，非法 `status/source` 后端 `400` 拒绝。
  - `submittedAt` 首次进入 `submitted` 时写入，重复 `submitted` 不覆盖。
  - no-op 保存不递增 `attemptCount`、不刷新 `lastAttemptAt`。
  - `notes` 支持保存、清空、回显。
  - 不自动修改 `trackerState`，不改 plugin 主流程。
- Phase 4 Step 4（Follow-up / Reminder 最小版）已完成：
  - 新增 `followUpView`（metadata-only）：
    - `status: none / planned / done / skipped`
    - `channel: email / phone / linkedin / other`
    - `dueAt / notes / lastUpdatedAt`
  - 新增 follow-up 更新接口并启用严格校验：
    - 非法 `status/channel/dueAt` 后端 `400` 拒绝。
  - `dueAt` 支持清空，`notes` 支持保存/清空/回显。
  - no-op 保存不刷新 `lastUpdatedAt`。
  - 不接入日历、自动提醒、后台任务；不改 `tracker/submission/scoring/decisionVerdict`。

## 相关文档

- [PROJECT_CONTEXT.md](E:\my-agent\applyflow\PROJECT_CONTEXT.md)
- [docs/APPLYFLOW_REBUILD_PLAN.md](E:\my-agent\applyflow\docs\APPLYFLOW_REBUILD_PLAN.md)
- [docs/APPLYFLOW_ARCHITECTURE.md](E:\my-agent\applyflow\docs\APPLYFLOW_ARCHITECTURE.md)
- [docs/DEPRECATION_AND_REMOVAL_PLAN.md](E:\my-agent\applyflow\docs\DEPRECATION_AND_REMOVAL_PLAN.md)
- [docs/ENGINEERING_GUARDRAILS.md](E:\my-agent\applyflow\docs\ENGINEERING_GUARDRAILS.md)
