# Deprecation and Removal Plan

更新时间：2026-04-20（Phase 3 收尾封板）

本文件记录 partial_rebuild 下“旧路径退场机制”，目标是让新主链路成为唯一默认路径：
`canonical -> JobDecision -> ControlGateResult -> FeedbackTrace -> Workspace/ViewModel -> UI`。

## 1. 已完成降级（不再是主路径）

### 1.1 UI 输入面
- `public/app.js` 不再以 `resumeDocument.structuredProfile`、`cleanedText` 作为简历卡片主输入。
- `public/app.js` 不再以 `data.fitAssessment` 作为详情页主输入，改为 `jobWorkspaceViewModel` 派生展示状态。
- 默认时间线主来源已切到 `feedbackTimelineView`，不再以旧 `activityLogs` 作为主时间线。

### 1.2 详情接口边界
- `/api/jobs/:id` 已收紧为受控输出（`getJobDetailView`）：
  - `jobWorkspaceViewModel`
  - `resumeViewModel`
  - `feedbackTimelineView`
  - `executionActions`
  - `operationData`
  - `governanceView`
- `fitAssessment` / `resumeDocument` / `activityLogs` 不再作为详情主输出。

### 1.3 tailoring-workspace 边界
- `/api/jobs/:id/tailoring-workspace` 已收紧为：
  - Display VM：`jobWorkspaceViewModel`、`resumeViewModel`、`feedbackTimelineView`、`tailoringWorkspaceViewModel`
  - Edit DTO：`tailoringWorkspaceEditDto`
- 已移除该接口中的 `executionActions`、`operationData` 暴露，防止接口继续大杂烩化。

### 1.4 执行链前端入口
- `public/app.js` 已禁止通过 `/api/jobs/:id/status` 直推 `applied`。
- `applied` 提交动作仅允许走：
  - `/api/jobs/:id/execution/dry-run`
  - `/api/jobs/:id/execution/confirm`
  - `/api/jobs/:id/execution/submit`
- 详情页与准备页默认展示 `executionSessionView`，不再由 UI 自行拼接散落 trace 字段。

## 2. 已下线的旧分支/旧 helper（本轮）

- `public/app.js`：
  - 移除派生 `fitAssessment` 中的 `decisionBreakdown` 旧兼容字段。
  - `renderTailoringWorkspace` 不再读取 `data.executionActions`。
  - 详情页不再读取派生 `fitAssessment.policyInfluenceSummary/historyInfluenceSummary`，改为直接消费 `controlView` 与 `feedbackTimelineView`。
- `src/lib/orchestrator/workflow-controller.js`：
  - `buildTailoringWorkspace` 输出移除 `executionActions`、`operationData`。
- `public/app.js`：
  - `renderStatusButtons` 过滤 `applied`，停止显示“通过状态流转直接投递”入口。
  - `nextAction/status` 对 `applied` 的分支改为 execution submit 分支。
  - 阻止 `[data-next-status="applied"]` 触发 `/status`。

## 3. 临时保留（内部兼容，不得作为 UI 主路径）

- `workflow-controller` 内部仍保留旧 `fitAssessment` 生成逻辑作为过渡来源，但对外由 `JobDecision`/`JobWorkspaceViewModel` 收口。
- `fitAssessment` 仍在编排层内部用于生成 `JobDecision`，但不得重新暴露为 UI 主输入。
- `/api/jobs/:id` 的 `executionActions` 仍用于非投递类状态流转提示，不得替代 `executionSessionView` 成为执行主视图。
- `policyAuditLogs` 仍在治理视图中保留，用于治理审计，不得替代 `feedbackTimelineView` 成为默认时间线。

## 4. 下一轮可安全删除候选

满足 validate + fixture 后可删除：
1. 详情页中仅为旧叙事保留的 `fitAssessment.policyInfluenceSummary/historyInfluenceSummary` 显示分支（改为直接消费 `controlView/feedbackView`）。
2. 旧状态按钮中非必要的“手动状态推进文案 helper”分支（保留非执行状态推进即可）。
3. 旧策略文案 helper 中与 `strategyDecision` 历史枚举绑定但不再被新决策链路使用的映射函数。

## 5. Guardrails（防回潮）

已接入：`scripts/validation/validate-ui-boundary.js`

当前拦截规则：
- 前端禁读：`structuredProfile`、`cleanedText`、`fitAssessments`、`data.fitAssessment`、`decisionBreakdown`、`data.activityLogs`。
- 前端必须存在执行链主入口：`/execution/dry-run`、`/execution/confirm`、`/execution/submit`。
- 前端必须消费 `executionSessionView`（禁止回退到散落执行字段拼装）。
- Tailoring 页面禁读：`data.executionActions`、`data.operationData`。
- 接口边界（运行时）：
  - `/api/jobs/:id` 禁止返回 `fitAssessment`、`resumeDocument`、`activityLogs` 等旧字段。
  - `/api/jobs/:id/tailoring-workspace` 禁止返回 `executionActions`、`operationData`、`workspace`、`tailoringOutput` 等内部结构。
- 静态兜底（无样本或运行时失败时）：
  - 校验路由仍指向 `getJobDetailView`。
  - 校验 `buildTailoringWorkspace` 未重新暴露旧操作态字段。

## 6. 删除门禁

每次删除必须满足：
1. `npm run validate:ui-boundary` 通过。
2. `npm run validate:all` 通过（如本地环境可运行）。
3. 关键页面（列表/详情/工作区/准备页）无主路径回退。
4. 文档同步更新（本文件 + 架构/重构计划涉及章节）。
