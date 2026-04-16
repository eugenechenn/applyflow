# ApplyFlow

ApplyFlow 是一个半自动求职执行 Agent，帮助求职者完成从岗位输入、匹配评估、申请材料准备、用户确认投递、状态跟踪，到面试复盘和策略反馈回流的一整套闭环。

## 为什么做这个项目

很多求职工具停留在“信息收集”或“给建议”，但真实求职的痛点在于执行链路断裂：
- 岗位太多，难快速判断值不值得投
- 每次都要重复改简历、准备自我介绍和问答
- 投递状态分散，跟进容易漏
- 面试经验无法沉淀到下一轮策略

ApplyFlow 的目标不是替用户自动投递，而是把 AI 放进求职执行流程里，帮助用户更快、更稳地推进每一步。

## 为什么它是 Agent，而不是普通 AI 工具

ApplyFlow 不是单次问答式聊天工具，而是一个围绕共享状态和状态机运行的工作流系统：
- 有 `Orchestrator` 统一编排多个功能 Agent
- 有共享对象模型：`Job`、`UserProfile`、`FitAssessment`、`ApplicationPrep`、`InterviewReflection`
- 有岗位生命周期状态机与非法流转防护
- 有 `ActivityLog` 保留关键动作和系统输出
- 有明确人机边界：所有高风险对外动作都由用户确认

## 核心闭环

`岗位输入 -> 匹配评估 -> 申请材料准备 -> 用户确认投递 -> 状态跟踪 -> 面试复盘 -> 反馈回流`

## 系统架构

- `Workflow Controller / Orchestrator`
- `Job Ingestion Agent`
- `Fit Evaluation Agent`
- `Application Prep Agent`
- `Pipeline Manager Agent`
- `Interview Reflection Agent`

当前版本使用 mock/stub Agent 返回结构化结果，后续可替换为真实 LLM 调用。

## 页面结构

- `Dashboard`
- `Jobs`
- `Prep`
- `Interviews`
- `Profile`

页面以 `Job` 为核心对象串联，支持从列表进入详情，再进入准备、状态更新和复盘。

## 状态机说明

岗位状态：
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

非法流转会在 API 和 Orchestrator 层被拦截。

## 当前边界

ApplyFlow 当前明确坚持：
- 半自动，不自动投递
- 不做复杂浏览器自动化
- 不做重型 RAG
- 不编造用户经历
- 所有外部发送和正式提交动作都由用户确认

## 职位 URL Draft Import

ApplyFlow 现在支持在 `New Job` 页面输入职位 URL，先导入一个可编辑的岗位草稿，再确认创建：

- 开发环境下优先使用 Playwright 真浏览器抓取
- 可单独启动 `jd-fetcher` Node 服务，也可在本地 Node runtime 中直接调用 Playwright 模块
- 后端优先尝试读取页面中的 `JobPosting` JSON-LD
- 如果没有结构化 schema，则退回到通用 HTML 提取
- 如果网页抓取失败，仍会保留 URL 和手填字段，让用户继续人工补全

这条能力借鉴了“先抓职位，再进入求职系统”的思路，但保持了当前 Cloudflare Worker 友好的架构，不把 Playwright 或重浏览器依赖直接塞进主运行时。

本地可选运行方式：

```bash
npm run jd-fetcher:start
```

环境变量：

- `JD_FETCHER_URL`：若设置，`/api/jobs/import-url` 会优先调用独立抓取服务
- `JD_FETCHER_PORT`：独立抓取服务端口，默认 `4123`
- `JD_FETCHER_TIMEOUT_MS`：Playwright 页面抓取超时，默认 `20000`

## 多阶段 Agent Pipeline

当前 ApplyFlow 已把主链路进一步落成可感知的多阶段 pipeline，而不是只靠若干隐藏函数串起来：

- `URL Import Agent`
- `Job Ingestion Agent`
- `Fit Evaluation Agent`
- `Application Prep Agent`
- `Pipeline Manager Agent`

这些阶段现在会体现在：

- orchestrator 中的显式 stage runner
- Job Detail 的 pipeline stage 区块
- Activity / decision trace 中的分阶段记录
- URL-first intake 的 `pipelinePreview`

这使 ApplyFlow 更接近一个真实 agent system，也更适合在面试里讲清楚“输入、阶段、输出、fallback、状态推进”的工程结构。

## 运行方式

当前仓库是一个零依赖的 mock MVP 骨架，直接运行：

```bash
npm start
```

启动后访问：

```text
http://localhost:3000
```

## Demo 场景

仓库内置了 3 条适合展示的 demo case：
- 1 条建议投递的 AI Product Manager 岗位
- 1 条谨慎投递的 Product Strategy 岗位
- 1 条不建议投递的 Advertising Operations 岗位

并配套：
- 示例用户画像
- FitAssessment
- ApplicationPrep
- InterviewReflection
- ActivityLog

## 文档

- 产品设计：`applyflow-project-notes/ApplyFlow_正式设计_v1_2026-04-14.md`
- 技术设计：`docs/ApplyFlow_Technical_Design_v1.md`
- 迁移说明：`docs/ApplyFlow_Refactor_Migration_Note.md`

## 后续 Roadmap

### P0

- 完善前端页面交互
- 用真实后端持久化替代内存 store
- 接入真实 LLM 评估与生成
- 增强 Job Detail 和 Prep 的编辑能力

### P1

- 增加面试复盘回写画像
- 增加 Dashboard 统计与待办逻辑
- 引入多版本申请材料
- 增加真实评估与 bad case logging

### P2

- 对接外部待办系统
- 增加轻量提醒机制
- 进一步增强演示与面试叙事材料
## Multi-User Dev Login

ApplyFlow now includes a minimal multi-user session boundary for local validation.

- `alex@example.com` or `alex`: seeded demo workspace with the full sample pipeline
- `taylor@example.com` or `taylor`: isolated second workspace for data-boundary testing

Quick verification flow:

1. Start the app with `npm start`
2. Open `http://localhost:3000`
3. Sign in as `alex@example.com`
4. Review profile, jobs, governance, prep, and audit history
5. Log out and sign in as `taylor@example.com`
6. Confirm the second user cannot see Alex's data

## SQLite Data Layer

ApplyFlow now uses a SQLite-backed repository layer for runtime persistence instead of writing the full workspace back to `data/store.json` on every update.

- Runtime database: `data/applyflow.sqlite`
- Legacy import source: `data/store.json`
- Migration behavior: on first boot, if the SQLite database is empty and `store.json` exists, ApplyFlow automatically imports the JSON data into SQLite
- Repository boundary: API routes and orchestrator logic still go through `src/server/store.js`, which now delegates to the SQLite repository layer

Useful commands:

```bash
npm start
npm run migrate:json-store
```

Environment:

- `APPLYFLOW_DB_FILE`: overrides the SQLite file name under `data/`

## Cloudflare Deployment

ApplyFlow now includes a real Cloudflare deployment path:

- Worker entry: `cloudflare/worker-entry.js`
- Static assets: `public/`
- D1 schema: `cloudflare/d1/schema.sql`
- D1 seed export: `cloudflare/d1/seed.sql`
- Main config: `wrangler.jsonc`

Recommended command flow:

```bash
wrangler login
wrangler d1 create applyflow
npm run cf:d1:execute:schema
npm run export:d1-seed
npm run cf:d1:execute:seed
wrangler secret put LLM_API_KEY
wrangler secret put SESSION_SECRET
npm run cf:deploy
```

Helpful local commands:

```bash
npm run cf:dev
npm run export:d1-seed
```

Secrets and config notes:

- Public / non-secret config: runtime target, database provider, public origin
- Secrets: `LLM_API_KEY`, `SESSION_SECRET`
- Cookie hardening is controlled with `SESSION_COOKIE_SAMESITE` and `SESSION_COOKIE_SECURE`
- Full deployment notes live in `cloudflare/README.md`

## LLM Provider Configuration

ApplyFlow no longer hardcodes OpenAI. The LLM layer now supports:

- `LLM_PROVIDER=openai`
- `LLM_PROVIDER=openai-compatible`

Shared variables:

- `LLM_PROVIDER`
- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_TIMEOUT_MS`

OpenAI example:

```bash
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

GLM example:

```bash
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4/
LLM_MODEL=glm-4.5-air
```

All three core AI capabilities keep their existing fallback path:

- Job Ingestion
- Fit Evaluation
- Prep Generation

If the provider call fails, ApplyFlow logs the error, records the fallback, and continues with the rule-based path instead of breaking the UI.

## 工程含金量下一步

当前版本已经具备面向真实使用的工程骨架：

- Worker + D1 + 多用户边界
- repository / facade 数据隔离层
- policy / governance / audit / override
- LLM-first + fallback 的稳定输出链路
- URL import abstraction，为未来 Playwright/Node importer 服务预留接口边界

如果继续提升工程含金量，最值得做的 3 个方向是：

1. 异步任务队列：把 ingestion / evaluation / prep 从同步请求中拆出来，适合 Cloudflare Queues 或独立 worker。
2. 独立 importer service：把浏览器级抓取能力从 Worker 中剥离，专做职位 URL 导入和反爬处理。
3. 更强 workflow engine：把当前 orchestrator 进一步升级为更清晰的任务状态、重试和回放系统。
