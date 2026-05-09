# Job Preference 与多维评估计划

## 背景与问题

当前 `lightweightProfile` 仅包含 `targetRoles / skills / preferredLocations`，存在三类核心不足：
- 行业语义和岗位语义混用：例如“金融/游戏/教育”无法区分是行业偏好还是岗位关键词。
- skills 被隐性当作强约束：用户未填写时，排序易失真。
- 缺少公司类型、排除项、求职阶段、维度权重，无法支持 CareerOps 式多维判断。

## 新偏好模型（兼容旧字段）

新增 `jobPreferenceProfile`（仅用于 derived/scoring 输入）：

```json
{
  "preferredIndustries": [],
  "excludedIndustries": [],
  "targetRoles": [],
  "excludedRoles": [],
  "skills": [],
  "preferredLocations": [],
  "companyTypes": [],
  "avoidCompanyTypes": [],
  "jobType": "不限",
  "priorityWeights": {
    "industry": 35,
    "role": 30,
    "skill": 15,
    "location": 10,
    "company": 10
  }
}
```

字段约束：
- 行业、岗位、公司类型采用可扩展文本列表，先以标准选项为主，保留“其他”。
- `skills` 为可选增强信号；为空时不惩罚，不阻断排序。
- 排除项（`excludedIndustries/excludedRoles/avoidCompanyTypes`）用于硬性回避。

## 兼容策略

1. 输入优先级：`jobPreferenceProfile` > `lightweightProfile` > legacy 根字段。  
2. 新旧双写：
   - onboarding/profile 保存时保留 `lightweightProfile`；
   - 同时写入 `jobPreferenceProfile`（缺省字段自动补默认值）。
3. 旧流程不破坏：
   - 未提供 `jobPreferenceProfile` 时自动从旧字段推断；
   - discovery/offline_json/admission/canonical/plugin/LLM 主流程不变。

## 排序影响设计（维度独立）

排序分维度打分并加权融合：
- 主信号：`industry`、`role`
- 辅助信号：`skill`、`location`
- 扩展信号：`company`

关键规则：
- 地点不能压过行业/岗位：当主信号低匹配时，location 分值上限收紧。
- `skills` 为空不降分，仅在解释中提示“技能偏好未填写”。
- 排除项命中时直接进入低分/风险提示。
- 权重暂用默认值，后续可开放高级配置。

## 多维评估计划（非单一行业）

评估口径约束：
- 主指标只看用户真正能感知的排序质量：`precision@5`、`precision@10`、`duplicate rate`、`explanation consistency`。
- 诊断指标用于定位问题，不直接作为当前 hard gate：`industry / role / skill / location / company accuracy`。
- `skills` 为空属于合法输入，不因“最高分不够高”判失败。
- exclusion-only 场景不要求高分，只检查是否把排除项推到前排，以及 explanation 是否明确说明“仅应用排除规则”。
- `location` 是辅助信号，只检查“不能压过 industry/role 主信号”，不再按强准确率门禁。
- `companyTypes` 当前属于弱监督识别能力，先作为诊断项；`国企/事业单位`、`外企`保留为 known gap / stretch target 跟踪。
- companyTypes classifier 已补充最小增强：
  - 外企别名扩展（ABB/Apple/Microsoft/Google/Amazon/IBM/SAP/Oracle/Bosch/Siemens/Unilever）
  - URL/domain 作为中等强度信号
  - strong/medium/low 置信度分层
  - “创新创业/创业服务/就业创业/创业园”等误伤词拦截
- `mustNotAppearInTop3` 采用分级判定：明确排除项命中为 hard fail；“培训生/销售/客服”等弱词若出现在混合岗位标题中，先记为 warning，不直接判死。

### 1) Industry Classification Eval
- 目标：行业识别准确率与误判类型可解释。
- 数据字段：`job_id, title, company, jd_text, gold_industry, predicted_industry, confidence`
- 指标：
  - per-dimension accuracy（industry）
  - false positive examples（重点收集“弱词误判”）

### 2) Role Family Classification Eval
- 目标：岗位族识别准确率，区分相邻角色（产品/运营/数据/算法等）。
- 数据字段：`gold_role_family, predicted_role_family, evidence_span`
- 指标：
  - per-dimension accuracy（role）
  - false positive examples（跨角色误入）

### 3) Skill Extraction Eval
- 目标：岗位文本技能提取覆盖率与噪声控制。
- 数据字段：`gold_skills[], predicted_skills[], missing_skills[], noisy_skills[]`
- 指标：
  - per-dimension accuracy（skill）
  - false positive examples（泛词、上下文误提取）

### 4) Ranking Quality Eval
- 目标：端到端排序质量。
- 数据字段：
  - `user_pref_snapshot`
  - `candidate_jobs[]`
  - `ranked_top_n[]`
  - `gold_relevant_job_ids[]`
- 指标：
  - 主指标：`precision@5`、`precision@10`、`duplicate rate`、`explanation consistency`
  - 诊断指标：`industry / role / skill / location / company accuracy`
  - `false positive examples`（区分 hard fail 与 warning）
  - `location override violations`（检查地点是否压过主信号）
  - exclusion-only consistency（检查是否错误把排除项推到前排，及 explanation 是否说明“仅应用排除规则”）

## 后续评估集字段建议

统一样本结构建议：
- `sample_id`
- `user_preference`（含 jobPreferenceProfile 快照）
- `job`（title/company/location/description）
- `labels`（industry/role/skills/relevance）
- `diagnostics`（误判原因、冲突维度、是否命中排除项）

## 第一版落地（评估系统 v1）

- 评估种子：`docs/eval/jobs-preference-eval.seed.json`
- 评估脚本：`scripts/eval-job-preference-ranking.js`
- 运行命令：`npm run eval:job-preference-ranking`

当前版本聚焦 40+ 条样本（当前 44 条），覆盖：
- 金融/教育与管培生、销售、财务等易混淆边界
- AI/算法与软件工程、数据分析相邻角色边界
- 游戏与泛互联网岗位边界
- skills 为空不惩罚
- location 不压过 industry/role
- 排除项与公司类型匹配
- Top10 重复岗位比率
- explanation 与 scoring 一致性
- companyTypes known gap / stretch target
- mustNot 软词 warning（培训生/销售/客服等混合标题场景）
- strict 与 legacy 并存输入
- jobType/companyTypes/排除项组合边界
- future placeholder（growth/stability/company size/salary）

## Eval v1 Baseline（历史 22-case 基线）

- precision@5 = 89.1%
- precision@10 = 86.4%
- duplicate rate(top10) = 0.0%
- explanation consistency = 100.0%
- hard failed cases = 0
- warnings = 2

## Eval v1 Current（扩展后 44-case）

- core22 / gate（门禁集合）：
  - precision@5 = 89.1%
  - precision@10 = 86.4%
  - duplicate rate(top10) = 0.0%
  - explanation consistency = 100.0%
  - hard failed cases = 0
- full44 / diagnostic（诊断集合）：
  - precision@5 = 53.6%
  - precision@10 = 52.3%
  - hard failed cases = 16
- warnings = 2
- known gaps = 4

说明：
- 当前 44 条包含诊断型与预留型样本，full44 指标用于暴露问题与追踪趋势，不直接用于 PASS/FAIL。
- Regression Gate 仅基于 `core22 + gate` 判定，因此当前门禁仍为 PASS。

## Regression Gate 规则

- 双轨评估：
  - `core22`：固定回归门禁子集（历史稳定样本）。
  - `full44`：扩展观察集（含 diagnostic/placeholder），仅用于趋势诊断。
  - `gate-basis`：`core22 + evalTier=gate` 的并集，是唯一 PASS/FAIL 判定集合。

- gate 触发 FAIL 条件（仅 gate-basis）：
  - `hard failed cases > 0`
  - `precision@5 < baseline precision@5`
  - `precision@10` 相比 baseline 下降超过阈值（默认 `1.0pp`）
  - `explanation consistency` 低于 baseline
- gate 输出：
  - baseline / current / delta
  - failed cases / warnings / known gaps
  - blocker severity（`none` / `P1` / `P0`）

## Known Gaps（当前阶段）

- companyTypes 识别能力仍偏弱，暂不作为 hard gate。
- `company_type_foreign_019`、`company_type_state_owned_018` 仍为 known gap。
- mixed title / soft mustNot 仍有 2 条 warning（边界保守口径）。
- skill/location/company accuracy 继续作为诊断项，不纳入 hard gate。
- full44 diagnostic 仍存在 hard fail，主要用于下一阶段问题收敛，不阻断当前门禁。

## Phase 2 收口状态

- 已完成 Profile / Onboarding 多维偏好 UI。
- 已完成 `jobPreferenceProfile > lightweightProfile` 回显优先级收口。
- 已完成 Onboarding 本地缓存双层结构（`lightweightProfile + jobPreferenceProfile`）。
- 已完成 Jobs“当前偏好卡片”与“去 Profile 修改偏好”入口。
- 已完成 seed quality gate 与 core/gate/diagnostic/placeholder 双轨评估体系。

## Phase 3 Step 1 收口状态（Decision Verdict Layer）

- 已在 jobs derived/view 层完成 `decisionVerdict`：
  - `verdict`: `go | review | no_go`
  - `grade`: `A | B | C | D | F`
  - `confidence`: `high | medium | low`
  - `hardBlockers`: 强阻断列表
  - `weightedSummary`: 行业/岗位/技能/地点/公司维度贡献
  - `nextAction`: 决策动作建议
- Jobs 页面已最小展示：`verdict / grade / confidence / blocker / nextAction`。
- eval 已新增 `Verdict Consistency` 诊断项（仅诊断，不纳入 regression gate）：
  - `no_go 出现在明显相关 Top3`
  - `主语义命中排除岗位但未 no_go`
  - `skills 为空导致 no_go`
  - `混合标题附带排除词导致 no_go`
  - `仅地点冲突导致 no_go`
- 当前 no_go 语义已收窄：仅来自明确硬阻断。
  - 命中 `excludedIndustries`
  - 命中 `excludedRoles`（主语义）
  - 命中 `avoidCompanyTypes`
  - 明确 `jobType` 冲突
- 以下场景默认 `review`（不直接 no_go）：
  - 低分
  - 主信号弱（industry/role 双低）
  - skills 未填写
  - location 冲突

## Phase 3 Step 2 收口状态（Profile-driven Skill Gap Layer）

- 已完成 `skillGapView`（derived-only）：
  - `overallFit: high | medium | low | unknown`
  - `matchedSkills`
  - `missingSkills`
  - `skillEvidence`
  - `hasUserSkills`
  - `gapHint`
- 数据源约束：
  - 仅使用 `jobPreferenceProfile.skills`（含 `lightweightProfile.skills` fallback）+ job title/JD/现有 derived 字段
  - 明确不接入 PDF / resume parser / OCR / LLM 简历解析
- 行为约束：
  - `skills` 为空：`overallFit=unknown`，不惩罚排序，不影响 decisionVerdict
  - `missingSkills` 使用 conservative 高置信技能白名单
  - 宽泛词（如 产品/运营/测试/前端/算法/数据分析 等）不进入 `missingSkills`
- Jobs 页面文案：
  - 展示“技能偏好匹配”（而非完整简历匹配）

### Skill Gap 诊断状态（当前）

- `falseMissingSkillWarnings = 0`
- `skillsEmptyUnknownRate = 100.0%`
- `skillsProvidedButNoExtractionRate ≈ 53.4%`
- Regression Gate（core22+gate）= PASS（skill gap 诊断不入 gate）

## 当前阶段基线（保持不变）

- `core22/gate`：`precision@5 = 89.1%`、`precision@10 = 86.4%`、`hardFail = 0`
- `full44/diagnostic`：仍有 hardFail（诊断用途）

## Phase 3 Step 3 收口状态（Application Tracker Core）

- 已完成最小 tracker 状态管理闭环（derived/view + metadata 持久化）：
  - `trackerState`: `none | saved | applied | interview | rejected | offer`
  - `trackerTimeline`: 记录状态变更时间线（最新在前，最多 20 条）
  - Jobs 页面：状态 badge、状态切换、状态过滤
- 安全边界：
  - 写入接口对 `nextState` 做严格枚举校验
  - 非法状态（例如 `hacked`）后端 `400` 拒绝，不修改 job，不追加 timeline
  - 读取旧数据保持兼容：缺失/异常状态统一安全 fallback 为 `none`
- 与评估体系关系：
  - 不改变现有 `core22+gate` regression gate 口径
  - `eval:job-preference-ranking` 与 tracker 逻辑解耦，门禁保持 PASS

### Tracker 已知缺口（当前保留）

- 并发快速点击仍采用最后写入覆盖（Last-Write-Wins）。
- 当前未接入复杂 reminder/calendar。
- `none` 状态是否需要 UI 显式“恢复为 none”按钮，后续再定。
- tracker 尚未与 plugin autofill 提交结果做深度联动。

## Phase 3 Step 4 收口状态（Human Feedback Loop）

- 已完成最小 human-in-the-loop 闭环：
  - 用户可对岗位标记：`good_fit / bad_fit / misclassified`（默认 `none`）
  - 反馈状态与 `feedbackTimeline` 持久化
  - Jobs 列表可直接触发反馈并回显
- 反馈影响策略（deterministic / 低风险）：
  - 仅作为 derived preference signal
  - 对同类岗位做小幅影响（正向 `+3~+4`，负向 `-3~-4`）
  - 不改 canonical job，不改硬阻断，不自动改写 `jobPreferenceProfile`
  - explanation 增加反馈影响提示文案
- 当前保留边界：
  - 并发快速点击下仍为最后写入覆盖（Last-Write-Wins）
  - 未接入复杂学习/强化机制（保持可解释和可回滚）

### Eval 环境隔离（已完成）

- 问题：eval 直接读取真实 jobs store 时，历史 `feedbackState/trackerState` 可能污染排序，导致 gate 指标波动。
- 处理：仅在 `scripts/eval-job-preference-ranking.js` 运行路径禁用 feedback influence，不改生产逻辑。
  - eval 取数阶段会对 job 视图做只读隔离：`feedbackState=none`、`feedbackTimeline=[]`。
  - 生产 `/api/jobs` 默认行为保持不变。
- 报告新增环境卫生输出：
  - `total jobs`
  - `feedbackState != none count`
  - `trackerState != none count`
  - `feedback influence disabled in eval`
  - 若发现非 none 状态，报告显示：`Eval running with feedback influence disabled`
- 结果：Regression Gate 恢复并稳定 PASS（连续两次运行通过）。

## Phase 3 Step 5 收口状态（Batch Compare + Shortlist Workflow）

- 已完成 shortlist 最小闭环（metadata-only）：
  - `shortlistState`: `none | shortlisted`
  - `shortlistTimeline`: 最新在前，最多 20 条
  - 非法 shortlist state 后端 `400` 拒绝
  - 重复点击 `shortlisted` 不重复追加 timeline
- Jobs 页面已完成最小产品化展示：
  - `Add to Shortlist / Remove`
  - `Shortlist` filter（仅影响 view，不改后端排序）
  - `Compare panel`（仅展示 shortlisted jobs）
- Compare panel 已接入关键决策字段并排对比：
  - `title/company/score`
  - `decisionVerdict.verdict/grade/confidence/hardBlockers`
  - `skillGapView.overallFit`
  - `trackerState` / `feedbackState`
  - `nextAction`
- 新增 `applyPriority`（derived 提示，不改主排序）：
  - `go + A/B + no blockers => high`
  - `review + B/C => medium`
  - `no_go 或 blocker => low`

### Step 5 已知缺口（当前保留）

- Remove 不记录 `none` 到 shortlist timeline。
- compare panel 窄屏信息密度较高，后续需要轻量响应式收敛。
- tracker/feedback/shortlist 尚未与 plugin 提交结果深度打通。

## Phase 4 Step 1 收口状态（Application Workflow Expansion）

- tracker 状态机已扩展为：
  - `none | saved | prep | tailored | applied | interview | rejected | offer`
- `prep/tailored` 已完成：
  - 后端写入校验
  - Jobs 页回显
  - 状态过滤
  - timeline 记录（最新在前，最多 20）
- 非法 tracker state 继续后端 `400` 拒绝。
- 重复同状态点击不重复追加 timeline。
- 该阶段不改变 scoring/classifier/eval gate/decisionVerdict 主逻辑。

## Phase 4 Step 2 收口状态（Materials Prep Record）

- 已新增 `materialsPrepView`（metadata-only）：
  - `resumeStatus: none|draft|tailored|finalized`
  - `coverLetterStatus: none|draft|tailored|finalized`
  - `interviewPrepStatus: none|draft|ready`
  - `notes`
  - `lastUpdatedAt`
- 后端新增材料记录接口并启用严格枚举校验：
  - 非法材料状态返回 `400`
- `notes` 支持保存、清空、回显。
- `lastUpdatedAt` 仅在材料字段实际变化时更新；无变化保存（no-op）不刷新时间戳。
- 该能力不改 scoring、不改 decisionVerdict、不改 tracker 主状态机，仅补执行侧 metadata。

## Phase 4 Step 3 收口状态（Submission Audit / Plugin Linkage 最小版）

- 已新增 `submissionAuditView`（metadata-only）：
  - `status: none | ready | submitted | failed | needs_review`
  - `source: manual | plugin | system`
  - `submittedAt`
  - `lastAttemptAt`
  - `attemptCount`
  - `lastError`
  - `notes`
- 后端新增投递审计更新接口并启用严格枚举校验：
  - 非法 `status/source` 返回 `400`
- 审计时间与计数规则：
  - `status=submitted` 且 `submittedAt` 缺失时设置 `submittedAt`
  - `submitted` 重复保存不覆盖既有 `submittedAt`
  - 仅当 `status/source/lastError/notes` 任一字段发生变化时：
    - `attemptCount +1`
    - 刷新 `lastAttemptAt`
  - no-op 保存不递增 `attemptCount`、不刷新 `lastAttemptAt`
- `notes` 支持保存、清空与回显。
- 该能力仅作为 metadata，不自动修改 `trackerState`，不改 plugin 主流程。

## Phase 4 Step 4 收口状态（Follow-up / Reminder 最小版）

- 已新增 `followUpView`（metadata-only）：
  - `status: none | planned | done | skipped`
  - `dueAt`
  - `channel: email | phone | linkedin | other`
  - `notes`
  - `lastUpdatedAt`
- 后端新增 follow-up 更新接口并启用严格校验：
  - 非法 `status/channel/dueAt` 返回 `400`
  - `dueAt` 可为空；非空必须为合法 ISO 时间
- `notes` 支持保存、清空与回显。
- `lastUpdatedAt` 仅在字段实际变化时刷新；no-op 保存不刷新。
- 该能力仅作为 metadata，不改 `tracker/submission/scoring/decisionVerdict`，不接日历/自动提醒/后台任务。

## Seed 设计原则

- 主目标：先确保“可回归、可解释、可扩展”，再逐步提高评估难度。
- case 分层：
  - hard gate case：直接影响产品排序质量与风险兜底；
  - diagnostic case：用于观察边界行为与已知短板；
  - placeholder case：为 Phase 2/3 新维度预留接口，不要求当前逻辑完全命中。
- tier 约束：
  - `core`：固定历史基线集合，仅用于基线对齐与趋势对比。
  - `gate`：参与门禁，必须可重复、可解释、可施压。
  - `diagnostic`：参与诊断报告，不直接决定 PASS/FAIL。
  - `placeholder`：未来能力预留，仅做可追踪占位，不计入主指标。

## Seed Quality Gate

- 新增命令：`npm run validate:job-preference-eval-seed`
- 强制校验：
  - case 不能包含 `??` / `TBD` / `TODO` / `placeholder text`
  - 每条 case 必须有：`id / description / userPreference / expected / evalTier / notes`
  - `evalTier` 只能是：`core / gate / diagnostic / placeholder`
  - `gate/core` 必须有可执行约束：
    - `top5MinRelevant` 或 `top10MinRelevant` 至少一个 `> 0`
    - 或存在明确 hard constraint（例如 `mustNotAppearInTop3`）
  - 产出统一摘要：`total cases / tier distribution / invalid cases / warning cases`

## 为什么 full44 不能直接对比旧 baseline

- 旧 baseline 来源于 `core22`，而扩容后的 `full44` 包含诊断样本与占位样本，难度分布不同。
- 若直接用 `full44` 与旧 `core22` 比较，会出现“分母变化 + 样本强度变化”导致的虚高或虚低。
- 因此当前策略是：
  - 回归门禁只看 `core22 + gate`；
  - `full44` 只做诊断趋势与已知缺口观察。

## 如何新增未来样本

1. 优先补充“真实误判”与“用户高频偏好冲突”case。  
2. 新 case 先进入 `diagnostic`，验证稳定后再升级为 `gate`。  
3. 每次新增后运行：
   - `npm run validate:job-preference-eval-seed`
   - `npm run eval:job-preference-ranking`
   - `npm run lint`
   - `npm run build`
4. 若需刷新基线快照，使用：
   - `npm run eval:job-preference-ranking:baseline`

## 什么 case 可以进 gate

- 对当前生产逻辑有明确产品价值，且可重复复现。
- 有清晰、非空、非占位的偏好输入与 expected 约束。
- 能反映“排序正确性/排除项安全边界/解释一致性”中的至少一项核心风险。

## 什么 case 只能作为 diagnostic / placeholder

- 数据池覆盖不足、暂不稳定、或仅用于趋势观察的 case：放 `diagnostic`。
- 未来功能（如 growth/stability/salary/company size）未落地：放 `placeholder`。
- `diagnostic/placeholder` 不参与 regression PASS/FAIL。

## Phase 4.5 Diagnostic Seed Philosophy

- `phase45_*` 的定位是“高频真实偏好观察集”，不是当前门禁集。
- 目的：把问题拆解为五类来源，避免误导修复方向：
  - 真实排序/分类问题
  - 数据池覆盖不足
  - 中英文 alias 映射问题
  - 标签口径过宽/过严
  - 已知 known gap（如 companyTypes）
- 因此 `phase45_*` 当前统一保留 `evalTier=diagnostic`，即使部分 case 标注了 `phase45Tier=gate_worthy`，也仅表示“未来候选”，不进入当前 gate。

### 为什么 phase45 暂不进 gate

- 当前 jobs 池存在明显分布偏差（部分行业/岗位密度不足、中文长标题为主）。
- `phase45_*` 中若干 case 使用英文 alias（如 `algorithm engineer`、`research assistant`），与中文岗位文本存在映射损耗。
- 若直接入 gate，会把“覆盖/映射问题”误判为“核心排序回归”，降低门禁信号可信度。

### 如何判断 Data Coverage Gap vs Ranking Bug

优先顺序：
1. 先看是否命中明显别名映射缺口（zh/en term mismatch）。
2. 再看目标行业/角色在当前 jobs 池是否有足够样本密度。
3. 若样本密度足够且别名对齐后仍失败，再判定为 ranking/classifier 真实问题。

辅助判据：
- 失败 TopN 是否持续落在“无关行业/无关角色”；
- 相同 case 连续运行是否稳定失败；
- 同类 gate case 是否同步退化（若否，多为 coverage/label 问题）。

### Phase45 Future Gate Candidates（当前建议）

- 优先候选：
  - `phase45_excluded_roles_sales_hard_055`
  - `phase45_exclude_education_050`
- 条件候选（需先完成标签收敛或覆盖增强）：
  - `phase45_data_sql_python_047`
  - `phase45_job_type_internship_054`
- 长期 diagnostic（暂不建议 gate）：
  - `phase45_location_tier1_preference_051`
  - `phase45_company_type_preference_052`
  - `phase45_non_tech_business_consulting_053`

### Phase45 游戏场景口径收口（2026-04-29）

- `phase45_game_pm_planning_045` 明确标记为 `Data Coverage Gap + Alias Mapping Gap` 诊断样本：
  - 当前 jobs pool 虽有游戏相关候选，但大量为“多岗位打包 JD”；
  - 纯“游戏产品经理/游戏策划”单岗样本不足；
  - 英文 alias 到中文岗位语义存在映射损耗；
  - 因此该 case 失败不直接驱动 taxonomy/scoring 生产改动，保持 `diagnostic`。
- 新增中文 canonical 对照样本：`phase45_game_pm_planning_zh_057`（diagnostic）：
  - 用于区分“英文 alias 映射问题”与“数据池覆盖问题”；
  - 若中文对照显著优于 045，优先归因为 alias；
  - 若中文对照同样失败，优先归因为数据覆盖/岗位打包结构问题。

## Known Gaps 管理方式

- 保留在 eval 报告中单列输出，不计入当前 hard fail。
- 每个 known gap 需具备：
  - 明确 case id
  - 失败表现
  - 数据问题/规则问题归因
  - 进入 hard gate 的前置条件

当前重点透明样本：
- `phase45_game_pm_planning_045`：英文 alias gap + 数据覆盖不足 + mixed JD 稀释，维持 diagnostic-only。
- `phase45_game_pm_planning_zh_057`：中文 canonical path 对照样本已通过，用于区分“映射问题”与“真实排序问题”。

## 迭代建议

建议下一轮开始生成“多维评估集最小版本（small but representative）”，优先覆盖：
- 行业高频 + 易混淆边界样本
- 角色相邻混淆样本
- skills 缺失与弱信号样本
- location/company 偏好冲突样本

先做小规模高质量集，再扩全量。
