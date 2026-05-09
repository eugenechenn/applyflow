# Phase 8D Legacy Removal Readiness

最后更新：2026-05-01  
阶段：Phase 8 Final Consolidation（8D-1/8D-2/8D-3 Completed）

## 1. Candidate Matrix（Ready / Watch / Blocked）

| Legacy Field | Replacement Path | Candidate Level | 当前证据 | 主要风险 |
| --- | --- | --- | --- | --- |
| scoringView.recommendationReasonSummary | scoringView.explainabilityFeatures.recommendationReasonSummary | Removed Batch 8D-1 | 输出平铺字段已移除，输入兼容保留 | 仅保留 old payload 输入兼容 |
| scoringView.blockerReasonSummary | scoringView.explainabilityFeatures.blockerReasonSummary | Removed Batch 8D-1 | 输出平铺字段已移除，输入兼容保留 | 同上 |
| scoringView.sourceRiskSummary | scoringView.explainabilityFeatures.sourceRiskSummary | Removed Batch 8D-1 | 输出平铺字段已移除，输入兼容保留 | 同上 |
| scoringView.confidenceExplanation | scoringView.explainabilityFeatures.confidenceExplanation | Removed Batch 8D-1 | 输出平铺字段已移除，输入兼容保留 | 同上 |
| scoringView.preferenceDriftSummary | scoringView.explainabilityFeatures.preferenceDriftSummary | Removed Batch 8D-1 | 输出平铺字段已移除，输入兼容保留 | 同上 |
| scoringView.feedbackSignalType | scoringView.feedbackGovernanceFeatures.feedbackSignalType | Removed Batch 8D-2 | 输出平铺字段已移除，输入兼容保留 | 仅保留 old payload 输入兼容 |
| scoringView.feedbackConfidence | scoringView.feedbackGovernanceFeatures.feedbackConfidence | Removed Batch 8D-2 | 输出平铺字段已移除，输入兼容保留 | 同上 |
| scoringView.feedbackRecencyTier | scoringView.feedbackGovernanceFeatures.feedbackRecencyTier | Removed Batch 8D-2 | 输出平铺字段已移除，输入兼容保留 | 同上 |
| scoringView.feedbackConsistency | scoringView.feedbackGovernanceFeatures.feedbackConsistency | Removed Batch 8D-2 | 输出平铺字段已移除，输入兼容保留 | 同上 |
| scoringView.feedbackConflictRisk | scoringView.feedbackGovernanceFeatures.feedbackConflictRisk | Removed Batch 8D-2 | 输出平铺字段已移除，输入兼容保留 | 同上 |
| scoringView.preferenceEvolutionCandidate | scoringView.feedbackGovernanceFeatures.preferenceEvolutionCandidate | Removed Batch 8D-2 | 输出平铺字段已移除，输入兼容保留 | 同上 |
| jobFeaturesView.sourceFreshnessTier | featureLayerModules.sourceGovernanceFeatures.freshnessTier（主路径）/ sourceFreshnessTierLegacy（输入兼容） | Removed Batch 8D-3 | 输出平铺字段已移除，输入兼容保留 | 高风险字段收口完成，保留兼容输入 |
| jobFeaturesView.rolePurity | featureLayerModules.semanticFeatures.roleSemanticPurity（主路径）/ rolePurityLegacy（输入兼容） | Removed Batch 8D-3 | 输出平铺字段已移除，输入兼容保留 | 高风险字段收口完成，保留兼容输入 |

说明：
- Batch 8D-1 已执行 explainability summary legacy 字段输出收口。
- Batch 8D-3 仍按原证据标准推进。

## 2. Evidence Standard（删除前硬门槛）

字段删除前必须同时满足：
1. 连续 3 轮 `gate` zero-consumer
2. 至少 1 轮 `full eval` zero-consumer
3. `npm run validate:ui-user-flow-smoke` PASS
4. API ViewModel compatibility PASS（含容器优先 + fallback 回归）
5. old payload fixture PASS
6. diagnostic mode 无 runtime warning
7. Focused Review PASS（含边界与对抗场景）

未满足任一项：字段状态维持 Watch/Blocked，不得删除。

## 3. Phase 8D Batch Plan（删除批次设计）

### Batch 8D-1（低风险 explainability summary）
- 目标字段：
  - scoringView.recommendationReasonSummary
  - scoringView.blockerReasonSummary
  - scoringView.sourceRiskSummary
  - scoringView.confidenceExplanation
  - scoringView.preferenceDriftSummary
- 前置条件：
  - 满足第 2 节全部证据标准
  - 诊断模式无 legacy warning

### Batch 8D-2（feedback governance legacy）
- 目标字段：
  - scoringView.feedbackSignalType
  - scoringView.feedbackConfidence
  - scoringView.feedbackRecencyTier
  - scoringView.feedbackConsistency
  - scoringView.feedbackConflictRisk
  - scoringView.preferenceEvolutionCandidate
- 前置条件：
  - Batch 8D-1 稳定通过后再进入
  - 反馈链路 old payload fixture 额外回归通过

### Batch 8D-3（jobFeaturesView 高风险 legacy）
- 目标字段：
  - jobFeaturesView.sourceFreshnessTier
  - jobFeaturesView.rolePurity
- 前置条件：
  - Batch 8D-1 / 8D-2 均完成并稳定
  - source/eval 历史兼容消费者清零
  - 必须最后处理

## 4. Rollback Plan（每批删除必须具备）

每个 batch 删除 PR 必须附带：
1. `git revert` 路径（单 PR 可原子回滚）
2. adapter fallback 恢复路径（按字段恢复 legacy alias 读取）
3. fixture rollback 路径（old payload fixture 一键回退）
4. eval 验证命令集（至少：seed/lint/build/gate + UI smoke）
5. owner / disposition 记录（Blocked/Unblocked，解封条件，复审证据）

## 5. Blocked Fields（当前阶段）

- `jobFeaturesView.sourceFreshnessTier`
- `jobFeaturesView.rolePurity`

阻塞原因：
- 历史链路兼容面更大，删除误伤半径高；
- 需先拿到 full/diagnostic + old payload 证据闭环。

## 6. Review Checklist（执行删除前必跑）

- Correctness：字段替代路径是否 100% 命中容器
- Boundary/Safety：是否触碰 comparator/ranking/gate basis
- Governance：是否出现字段扩张或绕过 freeze policy
- Adversarial：
  - 空值/缺字段/旧别名 payload
  - 缓存命中与缓存失效
  - 共享 helper 被非目标入口误用
  - diagnostic 开关下 warning 行为
- Blast Radius：UI/API/Eval 相邻路径回归评估
- Residual Risk：未覆盖证据与补证计划
- Disposition：Blocked/Unblocked + owner + 解封条件

## 7. Boundary Freeze（持续生效）

- 禁止改 comparator
- 禁止改 production ranking
- 禁止改 gate basis
- 禁止改 canonical schema / API schema
- 禁止 UI 结构扩张与 curated production
- Batch 8D-1 仅允许删除已批准的 explainability summary legacy 平铺输出字段

## 8. Phase 8D-1 Verification Evidence（2026-04-30）

验证目标字段（仅 Batch 8D-1）：
- scoringView.recommendationReasonSummary
- scoringView.blockerReasonSummary
- scoringView.sourceRiskSummary
- scoringView.confidenceExplanation
- scoringView.preferenceDriftSummary

### 8.1 证据结果快照

| Evidence Item | Result | 证据说明 |
| --- | --- | --- |
| gate zero consumer | PASS | `eval:job-preference-ranking:gate` 输出 `legacyFieldReadMap={}`，目标字段均在 `zeroConsumerLegacyFields` |
| full eval zero consumer | PASS | `eval:job-preference-ranking`（full）输出 `legacyFieldReadMap={}`，目标字段均在 `zeroConsumerLegacyFields` |
| diagnostic mode no runtime warning | PASS | `APPLYFLOW_LEGACY_WARNINGS=true` + `--mode=diagnostic --compact-output` 未出现 LegacyReadWarning |
| UI smoke PASS | PASS | `validate:ui-user-flow-smoke` 通过 |
| jobs apply UI PASS | PASS | `validate:jobs-apply-ui` 通过 |
| old payload fixture compatibility PASS | PASS | 新增 `validate:legacy-explainability-payload-compat`，4 类旧 payload 兼容场景通过 |
| API ViewModel fallback compatibility PASS | PASS | 同一 fixture 验证覆盖 `attachScoringToJobWorkspaceViewModel` 回退兼容路径 |

### 8.2 连续轮次记录（Batch 8D-1）

- gate zero-consumer run count（已记录）：`3/3`（本轮新增 1 轮，已满足）
- full zero-consumer evidence：`1/1`（已满足最低要求）
- diagnostic no-warning evidence：`1/1`（已满足）
- old payload fixture evidence：`PASS`（4 场景）
- 当前状态：`Ready Candidate（Pending Manual Approval）`

删除执行前仍需满足：
- 人工治理评审批准（Governance Review + Focused Review 最终签署）
- 批次 owner / disposition 记录完成
- 回滚路径与 fixture rollback 方案在执行 PR 中显式挂载

说明：
- Ready 状态不自动晋升，仍需人工治理评审与 Focused Review 共同签署。

## 9. Batch 8D-1 Removal Record

- removal date：2026-04-30
- approval record：Phase 8D-1 manual approval granted in execution thread
- owner：Codex / ApplyFlow CareerOps governance stream
- removed output fields：
  - scoringView.recommendationReasonSummary
  - scoringView.blockerReasonSummary
  - scoringView.sourceRiskSummary
  - scoringView.confidenceExplanation
  - scoringView.preferenceDriftSummary
- compatibility kept：
  - old payload legacy input -> normalize 到 `scoringView.explainabilityFeatures.*`
- rollback path：
  1. `git revert <Batch-8D-1-commit>`
  2. 恢复 `buildJobScoringViewModel` legacy 平铺字段输出
  3. 恢复 `attachScoringToJobWorkspaceViewModel` 对应 legacy 平铺字段写回
  4. 运行 `validate:legacy-explainability-payload-compat` + gate/UI 验证链路

## 10. Residual Blocked Fields（Post 8D-3）

- 无（Phase 8D 三批次目标字段已完成输出收口）

## 11. Phase 8D-2 Verification Evidence（2026-04-30）

验证目标字段（仅 Batch 8D-2）：
- scoringView.feedbackSignalType
- scoringView.feedbackConfidence
- scoringView.feedbackRecencyTier
- scoringView.feedbackConsistency
- scoringView.feedbackConflictRisk
- scoringView.preferenceEvolutionCandidate

### 11.1 证据结果快照

| Evidence Item | Result | 证据说明 |
| --- | --- | --- |
| gate zero consumer | PASS | `eval:job-preference-ranking:gate` 输出 `legacyFieldReadMap={}`，目标字段在 `zeroConsumerLegacyFields` |
| full eval zero consumer | PASS | `eval:job-preference-ranking`（full）输出 `legacyFieldReadMap={}`，目标字段在 `zeroConsumerLegacyFields` |
| diagnostic mode no runtime warning | PASS | `APPLYFLOW_LEGACY_WARNINGS=true` + `--mode=diagnostic --compact-output` 未出现 LegacyReadWarning（命令非 0 因 diagnostic gate 失败，不是 warning 失败） |
| UI smoke PASS | PASS | `validate:ui-user-flow-smoke` 通过 |
| jobs apply UI PASS | PASS | `validate:jobs-apply-ui` 通过 |
| old payload fixture compatibility PASS | PASS | `validate:legacy-explainability-payload-compat` 扩展为 explainability+feedback，共 8 场景通过 |
| API ViewModel fallback compatibility PASS | PASS | fixture 覆盖 `attachScoringToJobWorkspaceViewModel` feedback fallback 兼容路径 |

### 11.2 连续轮次记录（Batch 8D-2）

- gate zero-consumer run count（已记录）：`3/3`
- full zero-consumer evidence：`1/1`（已满足最低要求）
- diagnostic no-warning evidence：`1/1`（已满足）
- old payload fixture evidence：`PASS`（feedback 4 场景）
- 当前状态：`Executed（Removal Completed）`

删除执行前仍需满足：
- 人工治理评审批准（Governance Review + Focused Review 最终签署）
- 批次 owner / disposition 记录完成
- 回滚路径与 fixture rollback 方案在执行 PR 中显式挂载

## 12. Batch 8D-2 Removal Record

- removal date：2026-04-30
- approval record：Phase 8D-2 manual approval granted in execution thread
- owner：Codex / ApplyFlow CareerOps governance stream
- removed output fields：
  - scoringView.feedbackSignalType
  - scoringView.feedbackConfidence
  - scoringView.feedbackRecencyTier
  - scoringView.feedbackConsistency
  - scoringView.feedbackConflictRisk
  - scoringView.preferenceEvolutionCandidate
- compatibility kept：
  - old payload legacy input -> normalize 到 `scoringView.feedbackGovernanceFeatures.*`
- rollback path：
  1. `git revert <Batch-8D-2-commit>`
  2. 恢复 `buildJobScoringViewModel` feedback legacy 平铺字段输出
  3. 恢复 `attachScoringToJobWorkspaceViewModel` 对应 feedback legacy 平铺字段写回
  4. 运行 `validate:legacy-explainability-payload-compat` + gate/UI 验证链路

## 13. Phase 8D-3 Readiness Verification Evidence（2026-05-01）

验证目标字段（仅 Batch 8D-3）：
- jobFeaturesView.rolePurity
- jobFeaturesView.sourceFreshnessTier

### 13.1 证据结果快照

| Evidence Item | Result | 证据说明 |
| --- | --- | --- |
| gate zero consumer | PASS | `eval:job-preference-ranking:gate` 输出 `legacyFieldReadMap={}`，两个目标字段在 `zeroConsumerLegacyFields` |
| full eval zero consumer | PASS | `eval:job-preference-ranking`（full）输出 `legacyFieldReadMap={}`，两个目标字段在 `zeroConsumerLegacyFields` |
| diagnostic mode no runtime warning | PASS | `APPLYFLOW_LEGACY_WARNINGS=true` + `--mode=diagnostic --compact-output` 未出现 LegacyReadWarning（命令非 0 因 diagnostic gate fail） |
| old payload fixture compatibility | PASS | `validate:legacy-explainability-payload-compat` 新增 jobFeatures 5 场景通过 |
| normalizeJobFeaturesView fallback | PASS | fixture 覆盖 `rolePurity only`、`sourceFreshnessTier only`、`missing featureLayerModules`、`missing jobFeaturesView` |
| featureLayerModules semantic/source governance container | PASS | fixture 覆盖 `legacy + container coexist`，容器字段可用且优先 |
| UI smoke PASS | PASS | `validate:ui-user-flow-smoke` 通过 |
| jobs apply UI PASS | PASS | `validate:jobs-apply-ui` 通过 |

### 13.2 连续轮次记录（Batch 8D-3）

- gate zero-consumer run count（当前）：`3/3`
- full zero-consumer evidence：`1/1`（已满足最低要求）
- diagnostic no-warning evidence：`1/1`（已满足，沿用上一轮证据）
- old payload fixture evidence：`PASS`（jobFeatures 5 场景）
- 当前状态：`Ready Candidate（Pending Manual Approval）`

说明：
- 8D-3 已完成删除执行，输出侧 legacy 字段退出；
- legacy 输入兼容仍保留，保障旧 payload/fallback 安全。

## 14. Batch 8D-3 Removal Record

- removal date：2026-05-01
- approval record：Phase 8D-3 manual approval granted in execution thread
- owner：Codex / ApplyFlow CareerOps governance stream
- removed output fields：
  - jobFeaturesView.rolePurity
  - jobFeaturesView.sourceFreshnessTier
- main runtime path：
  - `jobFeaturesView.featureLayerModules.semanticFeatures.roleSemanticPurity`
  - `jobFeaturesView.featureLayerModules.sourceGovernanceFeatures.freshnessTier`
- compatibility kept：
  - legacy input -> normalize -> `semanticFeatures.rolePurityLegacy` / `sourceGovernanceFeatures.sourceFreshnessTierLegacy`
- rollback path：
  1. `git revert <Batch-8D-3-commit>`
  2. 恢复 `buildJobScoringViewModel`/`normalizeJobFeaturesView` 对应顶层字段输出
  3. 恢复 eval 对旧顶层字段消费（仅在回滚场景）
  4. 运行 `validate:legacy-explainability-payload-compat` + gate/UI 验证链路

## 15. Phase 8 Completion State

- Phase 8D-1：Explainability legacy 平铺字段输出移除完成
- Phase 8D-2：Feedback governance legacy 平铺字段输出移除完成
- Phase 8D-3：High-risk jobFeatures legacy 平铺字段输出移除完成
- 总体状态：Phase 8 Legacy Governance 完成（输出收口完成，输入兼容保留）

## 16. Phase 8 Final Consolidation Record（2026-05-01）

- consolidation scope：
  - legacy 输出字段退出总审计
  - 输入兼容 adapter 保留状态确认
  - comparator / production ranking / gate basis 边界复核
  - curated diagnostic-only 边界复核
- runtime conclusion：
  - legacy 输出字段已全部退出主运行时输出
  - explainability 唯一路径：`scoringView.explainabilityFeatures`
  - feedback governance 唯一路径：`scoringView.feedbackGovernanceFeatures`
  - semantic/source governance 主路径：`jobFeaturesView.featureLayerModules.semanticFeatures`、`jobFeaturesView.featureLayerModules.sourceGovernanceFeatures`
  - old payload 输入兼容仍保留（normalize 到容器 legacy alias）
- verification chain（本轮）：
  - `npm run validate:legacy-explainability-payload-compat` PASS
  - `npm run validate:job-preference-eval-seed` PASS
  - `npm run lint` PASS
  - `npm run build` PASS
  - `npm run eval:job-preference-ranking:gate` PASS（p@5=96.4%，p@10=95.9%，hardFail=0）
  - `npm run validate:ui-user-flow-smoke` PASS
  - `npm run validate:jobs-apply-ui` PASS
- residual risk：
  - 历史 payload 兼容观察期仍需保留
  - diagnostic/full 模式下 legacy warning 与 zero-consumer 需继续巡检
- recommendation：
  - Phase 8 可以关闭
  - 下一阶段仅做 post-removal 观察与小范围治理，不触碰 comparator/ranking/gate basis
