# ApplyFlow 交接文档

最后更新：2026-05-19

## 1. 这份文档是干什么的

这份文档用于新对话快速接手 ApplyFlow 当前现场，目标不是替代 [CONTEXT.md](E:/my-agent/applyflow/CONTEXT.md) 或 [TIMELINE.md](E:/my-agent/applyflow/TIMELINE.md)，而是提供一份更适合跨对话交接的“总览 + 时间线 + 目录方向 + 当前卡点”。

建议后续每次开新对话时先读：

1. [HANDOFF.md](E:/my-agent/applyflow/HANDOFF.md)
2. [CONTEXT.md](E:/my-agent/applyflow/CONTEXT.md)
3. [TIMELINE.md](E:/my-agent/applyflow/TIMELINE.md)
4. 当前任务直接相关目录和验证脚本

## 2. 一句话判断

ApplyFlow 现在已经不是一个“自动海投玩具”，而是一个以“先筛后投”为主线的半自动求职执行系统：

- 前半段主价值是岗位导入、去重、排序、解释、投递状态管理。
- 后半段执行链路保留为“浏览器辅助投递/插件预填/人工确认”，明确不做默认自动提交。
- 最近一段时间代码主线已经从排序收口、真实池验证、Internal Beta，推进到“网申插件交接体验”和“面试/作品集材料沉淀”。

## 3. 当前项目状态

### 3.1 当前稳定结论

- 本地/Worker 双运行面都在：本地 Node 服务入口是 [server.js](E:/my-agent/applyflow/server.js)，Cloudflare Worker 入口是 [cloudflare/worker-entry.js](E:/my-agent/applyflow/cloudflare/worker-entry.js)。
- 主前端仍是单文件页面应用：[public/app.js](E:/my-agent/applyflow/public/app.js) + [public/index.html](E:/my-agent/applyflow/public/index.html) + [public/styles.css](E:/my-agent/applyflow/public/styles.css)。
- 业务主链集中在 [src/lib](E:/my-agent/applyflow/src/lib) 和 [src/server](E:/my-agent/applyflow/src/server)。
- 验证体系很重，核心脚本集中在 [scripts/validation](E:/my-agent/applyflow/scripts/validation)。
- 当前仓库除了产品代码，还承载了大量面试、作品集、证据页和方法论材料，见 [interview](E:/my-agent/applyflow/interview) 与 [docs](E:/my-agent/applyflow/docs)。

### 3.2 当前最新工作重心

从工作区脏改动看，最新代码现场不在排序核心，而在“网申插件链路”：

- 前端增加了从 Jobs / Profile 引导到插件下载和网申辅助资料的交接文案。
- Edge 插件的 popup 与 content script 正在增强“从 ApplyFlow Profile 页面直接同步资料”和“DOM fallback 同步”。
- Cloudflare Worker 增加了插件 ZIP 下载路由保护，避免浏览器把 ZIP 当静态资源直接打开。
- 新增了几条验证脚本，专门盯住下载链路、popup 文案、资料同步 fallback 和 handoff 文案。

## 4. 时间顺序进展

这里只写适合交接的高层时间线；更细的一行一变更记录看 [TIMELINE.md](E:/my-agent/applyflow/TIMELINE.md)。

### 4.1 2026-04-14 ~ 2026-04-24：partial rebuild 定位期

这一段的核心不是补功能，而是重新定义项目边界：

- 项目从旧的混杂目标收口为“先筛后投”的半自动求职执行系统。
- 确认 `partial_rebuild` 路线，保留基础设施，重建主业务链。
- 关键基线文档是：
  - [PROJECT_CONTEXT.md](E:/my-agent/applyflow/PROJECT_CONTEXT.md)
  - [docs/APPLYFLOW_REBUILD_PLAN.md](E:/my-agent/applyflow/docs/APPLYFLOW_REBUILD_PLAN.md)
  - [docs/APPLYFLOW_ARCHITECTURE.md](E:/my-agent/applyflow/docs/APPLYFLOW_ARCHITECTURE.md)
  - [docs/DEPRECATION_AND_REMOVAL_PLAN.md](E:/my-agent/applyflow/docs/DEPRECATION_AND_REMOVAL_PLAN.md)

### 4.2 2026-04-28 ~ 2026-05-01：排序、偏好、评估、状态流大收口

这是主产品能力成形的阶段：

- `jobPreferenceProfile` 多维偏好模型接入排序。
- jobs 排序从“标题/行业/技能”粗分，发展成带 gate、derived view、反馈隔离的稳定合同。
- tracker、feedback、shortlist、materials prep、submission audit、follow-up 这些求职执行状态机逐步补齐。
- eval/gate 体系成形，并开始有 legacy removal / governance / acceptance gate 这套治理语言。

关键文档和代码：

- [docs/JOB_PREFERENCE_AND_EVAL_PLAN.md](E:/my-agent/applyflow/docs/JOB_PREFERENCE_AND_EVAL_PLAN.md)
- [docs/eval](E:/my-agent/applyflow/docs/eval)
- [src/lib/jobs](E:/my-agent/applyflow/src/lib/jobs)
- [src/lib/discovery](E:/my-agent/applyflow/src/lib/discovery)
- [src/lib/decision](E:/my-agent/applyflow/src/lib/decision)
- [src/lib/control](E:/my-agent/applyflow/src/lib/control)

### 4.3 2026-05-06 ~ 2026-05-12：执行可靠性、真实池、Internal Beta

这一段从“策略正确”转向“真实可用”：

- 修复 UI 执行链路稳定性，尤其是 Dashboard / Jobs / Profile 的加载和回显问题。
- 恢复真实池后重新校准 PM 与多岗位画像排序。
- 引入 Top100、A/B 覆盖、highRoleFitButLowGrade 等验证口径。
- Internal Beta 和 demo 入口开始分离，白名单、demo 用户、伪造 `payload.userId` 的安全边界开始收紧。

关键文档和脚本：

- [docs/INTERNAL_BETA_ACCESS_GATE_DESIGN.md](E:/my-agent/applyflow/docs/INTERNAL_BETA_ACCESS_GATE_DESIGN.md)
- [docs/INTERVIEW_DEMO_MODE_DESIGN.md](E:/my-agent/applyflow/docs/INTERVIEW_DEMO_MODE_DESIGN.md)
- [scripts/validation/validate-beta-whitelist-gate.js](E:/my-agent/applyflow/scripts/validation/validate-beta-whitelist-gate.js)
- [scripts/validation/validate-auth-forged-userid-rejected.js](E:/my-agent/applyflow/scripts/validation/validate-auth-forged-userid-rejected.js)
- [scripts/validation/validate-phase10a-workflow-playwright.js](E:/my-agent/applyflow/scripts/validation/validate-phase10a-workflow-playwright.js)

### 4.4 2026-05-15 ~ 2026-05-19：面试材料沉淀 + 插件交接链路

最近的两条线是并行的：

第一条线是面试/作品集材料：

- [interview/ApplyFlow_AI面试作品集复习手册.md](E:/my-agent/applyflow/interview/ApplyFlow_AI面试作品集复习手册.md)
- [interview/ApplyFlow_简历修改与作品集材料方案.md](E:/my-agent/applyflow/interview/ApplyFlow_简历修改与作品集材料方案.md)
- [docs/APPLYFLOW_PORTFOLIO_ONE_PAGER.md](E:/my-agent/applyflow/docs/APPLYFLOW_PORTFOLIO_ONE_PAGER.md)
- [docs/portfolio](E:/my-agent/applyflow/docs/portfolio)

第二条线是网申插件链路：

- [public/extensions/applyflow-edge-mvp](E:/my-agent/applyflow/public/extensions/applyflow-edge-mvp)
- [public/downloads](E:/my-agent/applyflow/public/downloads)
- [cloudflare/worker-entry.js](E:/my-agent/applyflow/cloudflare/worker-entry.js)
- [scripts/validation/validate-edge-extension-mvp.js](E:/my-agent/applyflow/scripts/validation/validate-edge-extension-mvp.js)
- [scripts/validation/validate-apply-plugin-handoff-flow.js](E:/my-agent/applyflow/scripts/validation/validate-apply-plugin-handoff-flow.js)
- [scripts/validation/validate-edge-profile-sync-fallback.js](E:/my-agent/applyflow/scripts/validation/validate-edge-profile-sync-fallback.js)
- [scripts/validation/validate-extension-download-route.js](E:/my-agent/applyflow/scripts/validation/validate-extension-download-route.js)

## 5. 按方向浏览目录

下面不是逐文件解释实现，而是按“方向”说明每块目录在系统中的角色。

### 5.1 运行入口与服务层

- [server.js](E:/my-agent/applyflow/server.js)：本地 Node 入口，直接起 HTTP server。
- [src/server/app.js](E:/my-agent/applyflow/src/server/app.js)：本地 runtime 的请求分发与静态资源服务。
- [src/server/routes/api.js](E:/my-agent/applyflow/src/server/routes/api.js)：API 主入口，路由很多，包含认证、profile、jobs、discovery、browser-apply、状态流和导出。
- [cloudflare/worker-entry.js](E:/my-agent/applyflow/cloudflare/worker-entry.js)：Cloudflare Worker 入口，负责 API、静态资源和下载路由。

判断：

- 本地与 Cloudflare 共用一套业务逻辑，但入口层有各自的适配。
- 当前插件下载链路问题已经进入 Worker 入口层，不只是前端文案问题。

### 5.2 业务核心层

- [src/lib/orchestrator](E:/my-agent/applyflow/src/lib/orchestrator)：工作流总控，很多 API 最终都落到这里。
- [src/lib/discovery](E:/my-agent/applyflow/src/lib/discovery)：岗位发现、导入、去重、同步。
- [src/lib/jobs](E:/my-agent/applyflow/src/lib/jobs)：岗位评分、derived view、解释层。
- [src/lib/browser](E:/my-agent/applyflow/src/lib/browser)：浏览器辅助投递的 bridge、session、adapter 合同。
- [src/lib/contracts](E:/my-agent/applyflow/src/lib/contracts)：多层 contract，是系统边界的重要锚点。
- [src/lib/workspace](E:/my-agent/applyflow/src/lib/workspace)：UI 所消费的工作台视图模型。
- [src/lib/resume](E:/my-agent/applyflow/src/lib/resume)：主简历、解析、导出。

判断：

- 项目现在是典型“contract + orchestrator + view-model”结构。
- 如果新对话要改功能，通常应该先定位 contract / orchestrator / public/app.js 三层，而不是直接改 UI 文案。

### 5.3 前端与用户体验层

- [public/app.js](E:/my-agent/applyflow/public/app.js)：目前前端绝大多数逻辑都在这里，体量很大。
- [public/styles.css](E:/my-agent/applyflow/public/styles.css)：全局样式。
- [public/index.html](E:/my-agent/applyflow/public/index.html)：单页入口。

当前重点：

- Jobs 页已经改成“排序 -> 打开投递链接 -> 加入投递清单 / 标记已投递”的主路径。
- Profile 页现在同时承载“高级偏好”和“网申辅助资料与插件同步”。
- 这说明插件不是独立玩具，而是被正式接到了主产品路径里。

### 5.4 Edge 插件与下载产物

- 源码目录：[public/extensions/applyflow-edge-mvp](E:/my-agent/applyflow/public/extensions/applyflow-edge-mvp)
- 分发目录：[public/downloads](E:/my-agent/applyflow/public/downloads)
- 当前 ZIP：
  - [public/downloads/applyflow-edge-mvp-v11-semantic-slots.zip](E:/my-agent/applyflow/public/downloads/applyflow-edge-mvp-v11-semantic-slots.zip)
  - [public/downloads/applyflow-edge-mvp-latest-v11.zip](E:/my-agent/applyflow/public/downloads/applyflow-edge-mvp-latest-v11.zip)

当前插件方向：

- popup 负责支持度检测、资料状态、字段级结果和“一键填写”入口。
- content script 负责页面分析、字段识别、预填、同步 ApplyFlow 资料。
- 最新改动明显在做两件事：
  - 从 ApplyFlow Profile 页面直接同步网申资料，而不是完全依赖 API 成功返回。
  - 当 API 不通或环境不标准时，允许 DOM fallback 读 `profile-form`。

### 5.5 验证体系

- 核心目录：[scripts/validation](E:/my-agent/applyflow/scripts/validation)
- fixture 目录：[scripts/fixtures](E:/my-agent/applyflow/scripts/fixtures)
- 排序评估脚本：[scripts/eval-job-preference-ranking.js](E:/my-agent/applyflow/scripts/eval-job-preference-ranking.js)

判断：

- 这个仓库不是“有几个测试脚本”，而是已经长成了一套工程门禁系统。
- 新对话如果要改共享层，必须先想好是跑 L1、L2 还是 L3，而不是无脑 `validate:all`。

### 5.6 文档、面试与作品集材料

- 产品/架构/治理文档集中在 [docs](E:/my-agent/applyflow/docs)
- 面试口径材料集中在 [interview](E:/my-agent/applyflow/interview)
- 早期重构设计沉淀在 [applyflow-project-notes](E:/my-agent/applyflow/applyflow-project-notes)

判断：

- 当前仓库已经兼具“产品代码仓 + 面试作品集仓”双重角色。
- 交接时要区分“代码真实现状”和“面试叙事现状”，两者相关，但不完全等价。

### 5.7 数据与环境噪音

需要知道但默认不要乱动的目录：

- [data](E:/my-agent/applyflow/data)：SQLite、JSON、备份、恢复检查库。
- `.venv`、`node_modules`、`.tmp`、`tmp`、`chrome_user_data`：运行和验证副产物很多。

注意：

- [AGENTS.md](E:/my-agent/applyflow/AGENTS.md) 已明确：严禁随意提交 `data/applyflow.sqlite`、`data/*.bak` 和 `tmp/` 产物。

## 6. 当前正在处理中的问题：网申插件

### 6.1 从脏改动看，当前意图是什么

工作区当前未提交改动，最明显的是这几类文件：

- 前端引导：
  - [public/app.js](E:/my-agent/applyflow/public/app.js)
  - [public/styles.css](E:/my-agent/applyflow/public/styles.css)
- 插件源码：
  - [public/extensions/applyflow-edge-mvp/popup.html](E:/my-agent/applyflow/public/extensions/applyflow-edge-mvp/popup.html)
  - [public/extensions/applyflow-edge-mvp/popup.js](E:/my-agent/applyflow/public/extensions/applyflow-edge-mvp/popup.js)
  - [public/extensions/applyflow-edge-mvp/content.js](E:/my-agent/applyflow/public/extensions/applyflow-edge-mvp/content.js)
- 下载分发副本：
  - [public/downloads/popup.html](E:/my-agent/applyflow/public/downloads/popup.html)
  - [public/downloads/popup.js](E:/my-agent/applyflow/public/downloads/popup.js)
  - [public/downloads/content.js](E:/my-agent/applyflow/public/downloads/content.js)
- 下载路由：
  - [cloudflare/worker-entry.js](E:/my-agent/applyflow/cloudflare/worker-entry.js)
- 验证：
  - [scripts/validation/validate-edge-extension-mvp.js](E:/my-agent/applyflow/scripts/validation/validate-edge-extension-mvp.js)
  - [scripts/validation/validate-apply-plugin-handoff-flow.js](E:/my-agent/applyflow/scripts/validation/validate-apply-plugin-handoff-flow.js)
  - [scripts/validation/validate-edge-profile-sync-fallback.js](E:/my-agent/applyflow/scripts/validation/validate-edge-profile-sync-fallback.js)
  - [scripts/validation/validate-extension-download-route.js](E:/my-agent/applyflow/scripts/validation/validate-extension-download-route.js)

综合这些 diff，可以推断当前插件问题不是“字段识别单点 bug”，而是整条 handoff 链路在补齐：

1. Jobs 页提示用户先下载插件、先补齐网申资料。
2. Profile 页给出“网申辅助资料与插件同步”专区。
3. 插件 popup 增加从 ApplyFlow 当前 tab 直接读 `profile-form` 的能力。
4. content script 增加 DOM fallback，同步失败时仍可从页面读出材料。
5. Worker 给 ZIP 下载补 `Content-Disposition` 等 header，避免下载体验异常。

### 6.2 当前改动的关键结论

- 插件边界被进一步明确为“辅助填写可识别字段”，不做自动提交。
- 时间类字段已经被主动降级处理，Profile 端不再强调让插件自动填出生日期和各类起止时间。
- popup 与 content script 现在都显式识别 `autofill-materials-section` 这条深链接。
- 分发目录 [public/downloads](E:/my-agent/applyflow/public/downloads) 与源码目录 [public/extensions/applyflow-edge-mvp](E:/my-agent/applyflow/public/extensions/applyflow-edge-mvp) 需要保持同步。

### 6.3 下一位对话最该先确认什么

如果下一位对话继续处理插件，优先确认：

1. ZIP 下载是否真的走了 Worker 下载路由，而不是静态资源直开。
2. popup 从 ApplyFlow Profile 页同步资料时，`chrome.storage.local` 里的 bundle 是否成功更新。
3. API 失败时，DOM fallback 是否还能从 `#profile-form` 正确读到基础信息和重复区块。
4. `public/extensions` 与 `public/downloads` 的 popup/content 是否保持同版本。
5. 新增验证脚本是否都能通过，尤其是：
   - `node scripts/validation/validate-edge-extension-mvp.js`
   - `node scripts/validation/validate-apply-plugin-handoff-flow.js`
   - `node scripts/validation/validate-edge-profile-sync-fallback.js`
   - `node scripts/validation/validate-extension-download-route.js`

## 7. 仓库地图：下一次开新对话该怎么读

### 7.1 只想快速恢复现场

先读：

1. [HANDOFF.md](E:/my-agent/applyflow/HANDOFF.md)
2. [CONTEXT.md](E:/my-agent/applyflow/CONTEXT.md)
3. [TIMELINE.md](E:/my-agent/applyflow/TIMELINE.md)
4. 当前脏改动 `git status`

### 7.2 要改投递插件

先读：

1. [public/app.js](E:/my-agent/applyflow/public/app.js)
2. [public/extensions/applyflow-edge-mvp/popup.js](E:/my-agent/applyflow/public/extensions/applyflow-edge-mvp/popup.js)
3. [public/extensions/applyflow-edge-mvp/content.js](E:/my-agent/applyflow/public/extensions/applyflow-edge-mvp/content.js)
4. [cloudflare/worker-entry.js](E:/my-agent/applyflow/cloudflare/worker-entry.js)
5. 对应 validation 脚本

### 7.3 要改排序/评估/真实池

先读：

1. [src/lib/jobs](E:/my-agent/applyflow/src/lib/jobs)
2. [src/lib/discovery](E:/my-agent/applyflow/src/lib/discovery)
3. [src/lib/contracts](E:/my-agent/applyflow/src/lib/contracts)
4. [docs/eval](E:/my-agent/applyflow/docs/eval)
5. [scripts/eval-job-preference-ranking.js](E:/my-agent/applyflow/scripts/eval-job-preference-ranking.js)

### 7.4 要改认证 / demo / beta 边界

先读：

1. [src/server/routes/api.js](E:/my-agent/applyflow/src/server/routes/api.js)
2. [src/server/auth.js](E:/my-agent/applyflow/src/server/auth.js)
3. [cloudflare/worker-entry.js](E:/my-agent/applyflow/cloudflare/worker-entry.js)
4. [docs/INTERNAL_BETA_ACCESS_GATE_DESIGN.md](E:/my-agent/applyflow/docs/INTERNAL_BETA_ACCESS_GATE_DESIGN.md)

## 8. 当前工作区状态

### 8.1 已看到的未提交修改

- `CONTEXT.md`、`TIMELINE.md` 已有本地修改。
- 插件链路相关文件有大量本地修改。
- [data/applyflow.sqlite](E:/my-agent/applyflow/data/applyflow.sqlite) 也有本地改动。
- 有未跟踪文件：
  - [RESEARCH.md](E:/my-agent/applyflow/RESEARCH.md)
  - [scripts/validation/validate-apply-plugin-handoff-flow.js](E:/my-agent/applyflow/scripts/validation/validate-apply-plugin-handoff-flow.js)
  - [scripts/validation/validate-edge-profile-sync-fallback.js](E:/my-agent/applyflow/scripts/validation/validate-edge-profile-sync-fallback.js)
  - [scripts/validation/validate-extension-download-route.js](E:/my-agent/applyflow/scripts/validation/validate-extension-download-route.js)
  - 两个插件 ZIP

### 8.2 交接时的操作建议

- 不要先碰排序核心，因为当前工作区最新焦点明显不是那里。
- 不要随手清理 `data/`、`tmp/`、ZIP 或截图，先确认哪些是用户正在保留的证据。
- 如果要继续插件工作，先保住现有 dirty diff，再做定向验证。

## 9. 常用命令

本仓库最常用的不是构建命令，而是验证命令。

常用入口：

```bash
npm run dev
npm run validate:production-online-smoke
npm run validate:edge-extension-mvp
node scripts/validation/validate-apply-plugin-handoff-flow.js
node scripts/validation/validate-edge-profile-sync-fallback.js
node scripts/validation/validate-extension-download-route.js
```

完整脚本清单看 [package.json](E:/my-agent/applyflow/package.json)。

## 10. 不该丢的约束

这些是下一位对话最容易踩到的边界：

- 不要把 ApplyFlow 说成默认自动海投产品。
- 不要把插件说成自动提交工具。
- 不要随意改排序核心、`userPriorityScore`、`comparator`、gate/acceptance 口径。
- 不要把面试材料里未落地的“简历改写/材料定制”包装成已上线功能。
- 不要直接把数据文件、备份库、临时产物提交进仓库。

这些约束的原始来源主要在：

- [AGENTS.md](E:/my-agent/applyflow/AGENTS.md)
- [CONTEXT.md](E:/my-agent/applyflow/CONTEXT.md)
- [DECISIONS.md](E:/my-agent/applyflow/DECISIONS.md)

## 11. 给下一位对话的一句话提示

如果新对话是继续当前工作，最可能的正确起手式是：

“先看 [HANDOFF.md](E:/my-agent/applyflow/HANDOFF.md)，然后检查插件链路 dirty diff，先跑插件 handoff 相关脚本，再决定是修下载路由、资料同步 fallback，还是修 popup/content 同步版本问题。”
