# ApplyFlow Architecture (Partial Rebuild)

更新时间：2026-04-20

## 1. 新主链路（产品）

1. 用户输入求职意图
2. 批量岗位获取与导入
3. 岗位标准化 + 去重 + 评分 + 优先级
4. 岗位详情解释
5. 简历导入与定制材料生成
6. 申请执行（预填 / dry-run / 人工确认）

## 2. 模块关系（高层）

- Intent Service
- Job Ingestion Pipeline
- Job Scoring Service
- Resume Pipeline
- Tailoring Service
- Apply Execution Service
- Tracking Service

这些模块都通过 canonical contracts 交互，不直接互读内部实现字段。

## 2.1 Agent 三层（Decision / Control / Feedback）

### Decision Layer（决策层）
- 输入：canonical intent + canonical job + canonical profile/history
- 输出：Decision Contract（必须包含）
  - recommendation（apply / cautious / skip）
  - evidence[]
  - gaps[]
  - risks[]
  - nextAction
  - rationale / confidence / trace
- 约束：不能只输出分数；所有决策必须可解释、可追踪

### Control Layer（控制层）
- 输入：Decision Contract + policy rules + runtime safety signals
- 输出：Control Contract（必须包含）
  - gateStatus（allow / blocked / needs_human_review）
  - reasons[]
  - requiredActions[]
  - policyVersion / checkedAt
- 约束：必须支持“禁止执行”；高风险或信息不足时强制人工确认

### Feedback Layer（反馈层）
- 输入：execution outcome + user override + failure events
- 输出：Feedback Contract（必须包含）
  - eventType
  - outcome
  - notes
  - actor
  - metadata / trace
  - recordedAt
- 约束：反馈必须进入可回放 trace，用于下一轮决策优化

## 3. SSOT 设计

唯一可信业务数据源：canonical contracts。

层级要求：
1. Parser 输出进入 normalize
2. Normalize 产出 canonical
3. Workspace 只读 canonical
4. UI 只读 workspace view-model

禁止：
- UI 读取 raw text
- Workspace 读取 parser 原始输出
- fallback 文案进入业务字段

## 4. 核心数据模型

### UserProfile
- id
- targetRoles[]
- cityPreferences[]
- jobType（校招/社招）
- salaryPreference?
- industryPreference?
- constraints

### MasterResume
- id
- userId
- sourceType（pdf/docx/manual）
- canonicalResumeJson
- parseQuality
- version
- createdAt/updatedAt

### JobListing
- id
- sourceUrl
- sourceSite
- rawText
- normalizedJobJson
- dedupHash
- ingestionBatchId
- createdAt

### JobScore
- id
- jobId
- userId
- fitScore
- priorityLevel
- recommendAction
- reasons[]
- gaps[]
- riskFlags[]

### JobDecision（Decision Contract）
- decisionId
- jobId
- userId
- fitScore
- recommendation（apply/cautious/skip）
- evidence[]
- gaps[]
- risks[]
- nextAction
- rationale
- confidence
- trace
- decidedAt

### ControlGateResult（Control Contract）
- controlId
- decisionId
- jobId
- gateStatus（allow/blocked/needs_human_review）
- reasons[]
- requiredActions[]
- policyVersion
- checkedAt

### FeedbackTrace（Feedback Contract）
- feedbackId
- jobId
- decisionId
- controlId?
- eventType
- actor
- outcome
- notes
- metadata
- trace
- recordedAt

### TailoredResume
- id
- jobId
- masterResumeId
- tailoredResumeJson
- changeReasons[]
- exportStatus
- version

### ApplicationSession / ApplyRun
- id
- jobId
- mode（dry-run/live）
- targetUrl
- prefillData
- confirmationState
- submitState
- auditTrail[]

### DocumentPipeline
- id
- documentId
- stage（extract/structure/normalize/export）
- status
- qualityMetrics
- errors[]

## 5. PDF Pipeline 设计

阶段：
1. extract（文本提取）
2. structure（结构化）
3. normalize（清洗、分类修正、污染隔离）
4. validate（schema + contamination）
5. publish（写入 canonical）

为什么旧方法会污染：
- parser 结果直接被多个层消费
- 缺少单点 normalize
- fallback 信息与业务字段混放

新方法防污染：
- 只允许 normalize 后数据进入 canonical
- validation 在 publish 前强制执行
- fallback 只在状态字段，不进入核心内容字段

## 6. Workspace Model 设计

输入：
- canonical resume
- canonical job
- JobDecision
- ControlGateResult
- FeedbackTrace

输出：
- workspace view-model（UI 唯一输入）
- tailoring workspace display view-model
- tailoring workspace edit DTO（仅编辑载荷）

约束：
- 不再兼容多种散落历史字段
- 历史数据只能通过 legacy adapter 进入 canonical
- UI 禁止直接读取 raw/legacy 字段
- `/api/jobs/:id/tailoring-workspace` 禁止返回内部操作态大对象（如 `operationData` / `executionActions`）

## 6.1 工作区边界（Display vs Edit）

- Display VM：
  - `jobWorkspaceViewModel`
  - `resumeViewModel`
  - `feedbackTimelineView`
  - `tailoringWorkspaceViewModel`
- Edit DTO：
  - `tailoringWorkspaceEditDto`
- Internal-only：
  - `workspace`、`tailoringOutput`、旧 `fitAssessment` 中间态
  - 仅允许在 orchestrator 内部使用，不得作为 UI 通用输入面

## 7. Validation 放置位置

- V1: after structure（schema）
- V2: after normalize（contamination）
- V3: before response（view-model integrity）
- V4: ui-boundary guard（禁止前端直读 legacy 字段、禁止接口边界回潮）

## 8. 申请执行方案（Phase 3）

第一阶段只做：
- 进入网页
- 预填
- dry-run
- 人工确认提交

暂不做：
- 默认全自动提交
- 无确认批量海投

理由：
- 可控性高
- 风险可管理
- 更符合产品可信度与工程稳定性
