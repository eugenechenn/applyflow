# PHASE8C Legacy Consumer Audit

最后更新：2026-04-30
阶段：Phase 8C（Legacy Direct Read Warning & Consumer Tracking）

## 1. Legacy Inventory
| Legacy Field | Canonical Replacement | Layer |
| --- | --- | --- |
| scoringView.recommendationReasonSummary | scoringView.explainabilityFeatures.recommendationReasonSummary | Explainability |
| scoringView.blockerReasonSummary | scoringView.explainabilityFeatures.blockerReasonSummary | Explainability |
| scoringView.sourceRiskSummary | scoringView.explainabilityFeatures.sourceRiskSummary | Explainability |
| scoringView.confidenceExplanation | scoringView.explainabilityFeatures.confidenceExplanation | Explainability |
| scoringView.preferenceDriftSummary | scoringView.explainabilityFeatures.preferenceDriftSummary | Explainability |
| scoringView.feedbackSignalType | scoringView.feedbackGovernanceFeatures.feedbackSignalType | Feedback Governance |
| scoringView.feedbackConfidence | scoringView.feedbackGovernanceFeatures.feedbackConfidence | Feedback Governance |
| scoringView.feedbackRecencyTier | scoringView.feedbackGovernanceFeatures.feedbackRecencyTier | Feedback Governance |
| scoringView.feedbackConsistency | scoringView.feedbackGovernanceFeatures.feedbackConsistency | Feedback Governance |
| scoringView.feedbackConflictRisk | scoringView.feedbackGovernanceFeatures.feedbackConflictRisk | Feedback Governance |
| scoringView.preferenceEvolutionCandidate | scoringView.feedbackGovernanceFeatures.preferenceEvolutionCandidate | Feedback Governance |
| jobFeaturesView.sourceFreshnessTier | jobFeaturesView.featureLayerModules.sourceGovernanceFeatures.sourceFreshnessTierLegacy（过渡）/ dedupeFreshnessFeatures.freshnessTier（目标） | Source Governance / Freshness |
| jobFeaturesView.rolePurity | jobFeaturesView.featureLayerModules.semanticFeatures.rolePurityLegacy（过渡）/ roleSemanticPurity（目标） | Semantic |

## 2. Consumer Count（基于运行时追踪 + 代码扫描）
- 主路径消费者：`public/app.js`、`src/lib/jobs/job-scoring-view-model.js`、`scripts/eval-job-preference-ranking.js`
- 当前策略：容器优先读取，legacy 仅 fallback；若 fallback 被触发，写入 legacy consumer tracking。
- 运行时追踪结构：
  - `legacyFieldReadMap`
  - `directLegacyConsumers`
  - `fallbackOnlyConsumers`
  - `zeroConsumerLegacyFields`
  - `riskyLegacyFields`

## 3. Field Status
- Active Canonical：模块容器字段（`featureLayerModules.*`、`scoringView.explainabilityFeatures`、`scoringView.feedbackGovernanceFeatures`）
- Deprecated Compat Alias：上述 legacy 字段（保留只读兼容）
- Governance Hold：`jobFeaturesView.rolePurity`、`jobFeaturesView.sourceFreshnessTier`（历史覆盖面较大，删除需额外治理）

## 4. Replacement Path
- UI：`public/app.js` 通过 `resolveScoringGovernanceViews` 优先消费容器。
- API ViewModel：`attachScoringToJobWorkspaceViewModel` 优先消费容器并写回结构化对象。
- Eval：`parseJobSignals` 优先消费容器，fallback 触发 tracking + warning（dev/diagnostic）。

## 5. Deletion Eligibility（Phase 8D 准入）
字段仅在同时满足以下条件时可删除：
1. 连续多轮 `zero consumer`
2. `npm run eval:job-preference-ranking:gate` 持续 PASS
3. `npm run validate:ui-user-flow-smoke` 与 `npm run validate:jobs-apply-ui` 无回归
4. Governance Review PASS
5. Focused Review PASS

## 6. Blocked Deletions
- `jobFeaturesView.rolePurity`：历史链路与语义评估仍有兼容读取风险，暂不删除。
- `jobFeaturesView.sourceFreshnessTier`：source/report 与历史诊断脚本仍有兼容依赖，暂不删除。
- 所有 `scoringView.*` explainability/feedback 平铺字段：在旧 payload 或缓存场景仍可能被 fallback 读取，暂不删除。

## 7. Migration Roadmap
1. Phase 8C：开启 warning + tracking，完成消费者透明化。
2. Phase 8D 准备：按字段统计 zero-consumer 连续轮次，标注可删候选。
3. Phase 8D 执行：分批移除低风险 alias（先 eval / 非主链，再 UI/API 兼容层）。
4. Phase 8D 收口：保留长期兼容白名单，其余字段进入删除或强告警模式。

## 8. Boundary Freeze（持续有效）
- 禁止 comparator 改动
- 禁止 production ranking 改动
- 禁止 gate basis 改动
- 禁止 source governance / jobQualityFit 入 comparator
- 禁止新增字段膨胀、curated production、UI 功能扩张
