# ApplyFlow 项目上下文总览

更新时间：2026-04-16

本文档用于沉淀 ApplyFlow 到当前为止的核心信息，避免后续随着实现推进、上下文变长而发生方向漂移。
后续凡是涉及产品定位、系统边界、关键架构、阶段成果、当前缺口和下一步优先级，都应优先以本文档为准，再补充到更细的技术或设计文档中。

## 1. 项目一句话

ApplyFlow = 面向真实求职执行闭环的半自动 Job Search Agent。

它不是一个“帮你聊聊简历”的单点 AI 工具，而是一个围绕共享状态、状态机、Agent 编排、人机边界、策略治理与反馈回流运行的执行系统。

## 2. 当前目标

当前项目目标已经从“本地 demo 骨架”演进为：

1. 做出一个可以完整演示真实求职闭环的 AI Agent 产品。
2. 做出一个具备工程能力的 Agent 系统，而不是一次性 prompt 拼装。
3. 在不破坏现有 UI 和主流程的前提下，逐步走向可上线、可多用户、可治理、可演化的部署候选架构。

## 3. 核心产品定位

ApplyFlow 的核心闭环为：

`New Job / Job Input -> Job Ingestion -> Fit Evaluation -> Prep Generation / Editing -> User Confirmation -> Status Progression -> Interview Reflection -> Feedback Loop -> Strategy / Policy Update`

面向用户的价值不是“全自动替你投递”，而是：

- 帮用户快速判断某岗位值不值得推进
- 帮用户更快完成申请材料准备
- 帮用户把岗位推进、投递状态、后续跟进和面试复盘串成一条线
- 帮用户将失败和成功经验沉淀为下一轮策略

## 4. 明确边界

当前边界已经明确，不应在没有重新对齐的情况下扩散：

- 不做全自动投递
- 不做复杂浏览器自动化
- 不做重型 RAG
- 不做多模型复杂编排
- 不做企业级权限系统
- 不做复杂数据库迁移框架
- 不做面向大规模生产的基础设施一次性重构

当前路线强调：

- 结构清晰
- 闭环完整
- 可 demo
- 可逐步上线
- 可保留 fallback

## 5. 系统定位：为什么它是 Agent

ApplyFlow 被定义为 Agent 系统，而不是普通 AI 工具，核心原因有五点：

1. 它围绕共享状态对象运行，而不是单次对话。
2. 它有明确的 Job 生命周期状态机。
3. 它有多步骤编排，而不是一次性生成结果。
4. 它有决策记录、审计、治理和回退机制。
5. 它有人机边界，关键动作必须由用户确认或 override。

## 6. 当前已确认的 Agent 结构

当前系统逻辑上仍以单主控 Orchestrator 驱动多个专职 Agent：

- `Workflow Controller / Orchestrator`
- `Job Ingestion Agent`
- `Fit Evaluation Agent`
- `Application Prep Agent`
- `Pipeline Manager Agent`
- `Interview Reflection Agent`

说明：

- Orchestrator 负责跨对象、跨步骤、跨策略的一致性编排
- Agent 输出必须尽量结构化
- 当前真实 LLM 已优先接入部分能力，但保留规则 fallback

## 7. 当前已实现的关键能力

截至目前，ApplyFlow 已经具备以下主能力。

### 7.1 产品闭环与主流程

- Profile 可编辑、可保存、可回显
- New Job 可提交
- Job Ingestion 可从 JD 文本和手填字段创建岗位
- New Job 已支持职位 URL draft import：先抓取并预填，再由用户确认创建
- Fit Evaluation 可生成结构化评估结果
- Job Detail 可作为主操作中枢展示岗位摘要、评估、政策影响、活动流和下一步动作
- Prep 页面可编辑并保存申请材料
- Job 状态可按合法状态机推进
- Dashboard / Jobs / Job Detail / Prep / Governance 已形成可演示的产品工作台

### 7.2 状态机

当前 Job 生命周期状态包括：

- `inbox`
- `evaluating`
- `to_prepare`
- `ready_to_apply`
- `applied`
- `follow_up`
- `interviewing`
- `rejected`
- `offer`
- `archived`

系统已经具备：

- 合法流转校验
- 非法流转拦截
- 状态变更日志记录
- UI 中推荐动作与状态联动

### 7.3 决策记录与可解释性

系统已从普通 ActivityLog 升级到包含决策含义的 Trace 能力，核心方向包括：

- Agent 输入摘要
- Agent 输出摘要
- decision reason
- history influence
- policy influence
- decision breakdown
- active policy version
- override 信息

当前重点不是“把所有内部字段都暴露给用户”，而是把系统为什么这么判断，用用户可理解的方式呈现出来。

### 7.4 策略与治理

系统已经从“per-job heuristics”升级为“policy-driven agent system”，当前包括：

- `strategyDecision`
- `globalStrategyPolicy`
- `policy influence`
- policy explainability
- policy proposal / approval / reject / revert
- policy audit history
- user override

也就是说，系统不只是“打分”，而是已经开始根据历史结果和策略控制 pipeline 行为路径。

### 7.5 反馈回流

系统已具备最小可用 feedback loop：

- Interview Reflection 可回流到 Job / Profile / Strategy 层
- Bad case 可记录失败案例
- Bad case 会影响后续评估
- Score bias / strategy profile 已接入历史结果
- Strategy insight 能从全局角度给出建议

### 7.6 前端产品化

前端已经完成三阶段产品化重构，并遵循根目录 `DESIGN.md` 的 Apple 风格设计语言：

- Dashboard：工作台化
- Jobs：高效扫描与优先级识别
- Job Detail：决策与行动中枢
- Prep：申请材料工作区
- Governance / Debug View：治理工作台

此外还已补齐：

- 页面 loading / empty / error / success 状态
- 动作反馈闭环
- view-model 层
- raw API -> mapper -> UI 稳定链路

### 7.7 真实 LLM 接入与 fallback

当前以下能力已接入真实 LLM 优先调用，并保留 fallback：

- Job Ingestion
- Fit Evaluation
- Prep Generation

原则：

- 模型输出必须归一化
- 不允许 UI 直接消费自由文本原始输出
- 模型失败时必须 fallback 到规则逻辑
- 不破坏现有页面和展示层

### 7.8 多用户

当前系统已经从单用户本地系统升级为最小多用户系统：

- User / Session 基础模型
- per-user data isolation
- AsyncLocalStorage request context
- 主要对象已按 `userId` 隔离
- 前端支持最小登录与用户切换

### 7.9 数据层升级

当前系统已经从 `data/store.json` 升级为 SQLite-backed repository：

- 底层数据存储：`data/applyflow.sqlite`
- 兼容原有 `store` facade
- 自动从 `data/store.json` 迁移
- 通过 repository 层隔离数据访问
- 为未来 D1 / serverless 迁移保留接口边界

### 7.10 Cloudflare 部署前适配

当前系统已经开始为 Cloudflare Pages + Workers + D1 做结构准备：

- 已区分本地 Node runtime 与未来 Cloudflare runtime
- 已补充 DB adapter 分层，明确 SQLite adapter 与未来 D1 adapter 的衔接方式
- 已导出 D1-ready schema
- 已补齐 Wrangler 配置草稿、Cloudflare 运行说明和 seed 导出脚本
- 已补基础安全位与结构化日志，方便后续线上调试

### 7.11 Cloudflare 首次部署链路

当前系统已经具备真实 Cloudflare 部署路径：

- Worker `fetch()` 入口已接入现有 API
- Cloudflare 静态资源与 API 已整合到统一部署入口
- D1 schema 与 seed SQL 已导出
- Wrangler 正式配置已落地
- 当前真正剩余的外部阻塞项主要是 Cloudflare 账号认证与远端资源创建

## 8. 当前技术架构理解

当前更准确的描述应该是：

### 前端

- 原生静态前端
- `public/app.js` 承担路由、状态、view-model 映射与 UI 渲染
- `public/styles.css` 承担统一设计系统和产品风格

### 后端

- Node HTTP server
- API routes 负责会话、对象读写和 orchestrator 调用
- AsyncLocalStorage 提供 request-scoped user context

### 业务中台

- `workflow-controller` 负责跨 Agent 编排
- shared helpers 管理状态对象的一致性
- activity logger / policy trace / audit 构成系统过程记录

### 数据层

- `store.js` 作为兼容 facade
- repository 层负责面向对象的数据访问
- SQLite 作为当前稳定持久化方案

### 智能层

- 真实 LLM + fallback 规则
- 结构化 schema 输出
- policy / strategy / feedback 参与最终决策

## 9. 当前关键数据对象

当前系统围绕以下核心对象运行：

- `User`
- `Session`
- `UserProfile`
- `Job`
- `FitAssessment`
- `ApplicationPrep`
- `ApplicationTask`
- `InterviewReflection`
- `ActivityLog / DecisionTrace`
- `BadCase`
- `StrategyProfile`
- `GlobalStrategyPolicy`
- `PolicyChangeProposal`
- `PolicyAuditEvent`

这些对象都已经不再是“文档里的概念”，而是项目当前实现中的核心状态载体。

## 10. 关键设计原则

后续继续推进时，必须保持以下原则不变。

### 10.1 共享状态优先

系统不是围绕 prompt 运行，而是围绕共享对象运行。

### 10.2 状态机优先

Job 的生命周期必须显式可控，不能隐式跳步。

### 10.3 结构化输出优先

Agent、LLM、API 都要尽量输出稳定 schema，而不是无边界自由文本。

### 10.4 人机边界明确

系统可以建议、排序、解释、提醒、生成材料，但最终高风险动作由用户确认。

### 10.5 fallback 必须保留

即使真实 LLM 失败，也不能让产品主链路崩掉。

### 10.6 可解释与可治理

系统不仅要能做判断，还要能解释为什么这样判断，并允许用户在关键层面参与控制。

### 10.7 尽量避免过度工程化

当前目标是“小而稳地走向上线候选”，不是一开始就做企业级平台。

## 11. 至今为止的阶段性演进

为了后续不丢上下文，可以把项目演进概括为以下阶段。

### 阶段 1：产品与闭环定义

- 明确 ApplyFlow 不是 Hiring Decision OS
- 明确求职执行闭环
- 明确 5 个 Agent + 1 个 Orchestrator 架构

### 阶段 2：MVP 骨架

- 技术设计文档
- 类型定义
- API 骨架
- mock 数据
- 路由和页面框架

### 阶段 3：第一个真实可演示闭环

- Profile 可编辑保存
- Prep 可编辑保存
- Job 状态推进
- Dashboard / Jobs 联动

### 阶段 4：New Job 主线

- 从 0 新建岗位
- Job Ingestion
- Fit Evaluation
- Job Detail 自动展示结果

### 阶段 5：Demo 主线打磨

- Job Detail 成为主操作中枢
- Next Action 明确可执行
- Timeline / Activity 更适合演示
- 整体形成 3 分钟 demo 流程

### 阶段 6：工程能力

- 持久化
- metrics
- decision trace
- bad case

### 阶段 7：反馈与策略层

- interview reflection 回流
- bad case 影响未来判断
- score bias
- strategy insight

### 阶段 8：policy-driven 升级

- global strategy policy
- policy 控制 pipeline 行为
- explainability
- override
- governance
- 审计与回滚

### 阶段 9：前端产品化

- 统一 DESIGN.md 风格
- 工作台化 Dashboard
- 决策中心化 Job Detail
- 工作列表化 Jobs
- 工作区化 Prep
- 治理工作台化 Governance

### 阶段 10：可上线候选架构

- view-model 层
- 真实 LLM 接入与 fallback
- 多用户隔离
- SQLite 数据层

### 阶段 11：Cloudflare-compatible architecture prep

- runtime target 区分
- D1 adapter 预留
- schema / seed / wrangler 准备
- 基础安全项与结构化日志

### 阶段 12：Cloudflare deployment execution

- Worker fetch adapter 落地
- D1 import/export 路径落地
- wrangler 正式配置完成
- 待完成真实远端 deploy 与 online verification

## 12. 当前最重要的现实定位

如果今天要对外描述项目当前状态，最准确的说法是：

ApplyFlow 已经不是一个单机演示脚本，而是一个具备以下特征的 AI Agent 系统候选版本：

- 有真实产品主流程
- 有状态机
- 有决策链
- 有策略层和治理层
- 有多用户边界
- 有持久化数据层
- 有真实 LLM 接入和 fallback
- 有相对稳定的前后端展示链路

但它还不是严格意义上的 production-grade SaaS。

## 13. 当前最关键缺口

这是后续必须保持清醒的部分。

### P0 缺口

- 认证与 session 安全仍是最小版
- 缺少生产级日志、监控、告警
- 缺少更稳的错误追踪和 LLM 调用观测
- 缺少数据库备份、恢复和迁移策略
- 缺少更严格的 schema validation 和输入边界控制

### P1 缺口

- 还没有完成 Cloudflare 账号认证后的真实远端 deploy
- 还没有完成线上 URL 级联调验证
- 还没有外部通知、提醒、邮件或日历联动
- 还没有面向真实用户的 onboarding / account lifecycle

### P2 缺口

- 还没有更强的 agent memory / retrieval 机制
- 还没有更强的 experiment / evaluation 框架
- 还没有形成可持续的运营分析与用户增长闭环

## 14. 下一步优先级建议

在当前节点，后续建议优先级如下：

1. 安全与可观测性
2. 完成 Cloudflare 远端资源创建与正式部署
3. 线上联调与可观测性补强
4. 生产级输入校验与错误恢复
5. 更稳的 session / auth

不建议当前立刻继续扩新业务模块。

## 15. 后续更新规则

后续每次有重要变化，建议同步更新本文档中的以下部分：

- 项目一句话
- 当前目标
- 当前已实现的关键能力
- 当前技术架构理解
- 当前最关键缺口
- 下一步优先级建议

如果某次改动会影响产品方向、系统边界、Agent 定义或部署路线，必须优先更新本文档，再继续开发。

## 16. 2026-04-16 LLM provider compatibility update

本轮已把 LLM 接入从“写死 OpenAI”升级为“可配置的 OpenAI-compatible provider”。

当前统一环境变量为：

- `LLM_PROVIDER`
- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_TIMEOUT_MS`

兼容策略：

- 默认支持 `openai`
- 默认支持 `openai-compatible`
- 代码层仍临时兼容旧 `OPENAI_*` 变量作为过渡 fallback，但后续应以 `LLM_*` 为准

当前优先接入目标：

- GLM
- 配置方式：
  - `LLM_PROVIDER=openai-compatible`
  - `LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4/`
  - `LLM_API_KEY=<glm key>`
  - `LLM_MODEL=<glm model name>`

稳定性原则保持不变：

- Job Ingestion / Fit Evaluation / Prep Generation 的模型调用失败时，不允许页面崩溃
- 必须记录 LLM 错误与 fallback trace
- 必须回退到现有 heuristic / rule-based 路径

## 17. 2026-04-16 minimal demo login for Cloudflare

本轮新增了最小可用的 demo 登录机制，目标不是完整认证系统，而是保证 Cloudflare 线上首次访问时可以自动拿到一个可工作的 user/session 边界。

关键行为：

- 新增 `POST /api/login`
- 前端在无 session 时会自动以 `eugene@example.com` 发起 demo 登录
- 如果用户不存在，后端会自动创建用户
- 登录成功后写入 `applyflow_session` cookie
- 所有依赖用户的 API 在无 user 情况下统一返回 401 JSON，而不是把页面直接打崩

本轮主要目的：

- 解决 Dashboard 因无 session 导致的线上首屏失败
- 保持 per-user 隔离前提下，提供单用户 / demo 友好的首次进入路径

## 18. 2026-04-16 benchmark follow-up: URL import draft flow

本轮围绕 `career-ops-system` 的对标，已经确认并落地一个最值得马上做的增强点：

- 借鉴它“职位链接进入系统”的入口设计
- 但不照搬其 CLI + Playwright-first 架构
- 当前先在 ApplyFlow 中落成 Worker-friendly importer abstraction

当前实现方式：

- 新增 `POST /api/jobs/import-url`
- 服务端优先读取职位页中的 `JobPosting` JSON-LD
- 若无结构化 schema，再退回 HTML 文本提取
- 若抓取失败，仍返回一个保留 URL 和手填字段的 fallback draft
- 前端 `New Job` 页面支持“从 URL 导入草稿 -> 用户确认 -> 创建并评估岗位”

这条能力的价值在于：

- 明显提升第一用户真实使用体验
- 不破坏当前 Cloudflare Worker + D1 主链路
- 为未来把浏览器级抓取独立成 Playwright/Node importer service 预留清晰接口边界

## 19. 2026-04-16 second benchmark upgrade: agent pipeline + richer prep

本轮在继续对标 `career-ops-system` 后，没有继续堆单点功能，而是把 ApplyFlow 往“更像真实可用系统，也更像可讲清楚的 agent 工程项目”推进了一步。

本轮实际升级重点：

- 把 URL-first intake 真正纳入多阶段 agent pipeline
- 增加显式 `URL Import Agent`
- 在 orchestrator 中加入 stage runner
- 在 `Job Detail` 中加入 pipeline stage 展示
- 在 URL import API 中返回 `pipelinePreview`
- 把 `Prep` 从基础字段升级为更完整的 prep pack：
  - tailored summary
  - why me
  - talking points
  - outreach note

这意味着当前 ApplyFlow 已经不只是：

- “有一个 import 功能”
- “有几个 agent 名称”

而是开始具备：

- 更清晰的阶段边界
- 更明确的输入 / 输出
- 更强的 trace / fallback 语义
- 更贴近真实求职执行的申请材料包
