# Phase 8B Legacy Reduction Plan

更新时间：2026-04-30

## 范围
仅限 runtime consumption 路径治理，不改 comparator / production ranking / gate basis。

## 当前 Legacy Fields 清单
- `jobFeaturesView.rolePurity`（deprecated_compat_alias）
- `jobFeaturesView.sourceFreshnessTier`（deprecated_compat_alias）
- `scoringView.recommendationReasonSummary`（legacy flat）
- `scoringView.blockerReasonSummary`（legacy flat）
- `scoringView.sourceRiskSummary`（legacy flat）
- `scoringView.confidenceExplanation`（legacy flat）
- `scoringView.preferenceDriftSummary`（legacy flat）
- `scoringView.feedbackSignalType/feedbackConfidence/...`（legacy flat）

## 运行时消费状态
- 新路径优先：
  - `jobFeaturesView.featureLayerModules.semanticFeatures`
  - `jobFeaturesView.featureLayerModules.sourceGovernanceFeatures`
  - `jobFeaturesView.featureLayerModules.dedupeFreshnessFeatures`
  - `scoringView.explainabilityFeatures`
  - `scoringView.feedbackGovernanceFeatures`
- 兼容回退：保留 legacy flat 字段 fallback，防止旧调用断裂。

## 未来可移除项（候选）
- `scoringView` explainability flat 字段：当连续 2 个阶段确认无直接消费者后移除。
- `scoringView` feedback flat 字段：同上，先灰度只读告警，再移除。

## 必须长期兼容项（当前阶段）
- `jobFeaturesView.rolePurity`：外部脚本/历史报表潜在依赖，短期保留。
- `jobFeaturesView.sourceFreshnessTier`：历史 source-report 与数据治理对照仍依赖，短期保留。

## Deprecated 生命周期策略
1. Phase 8B：容器优先消费 + legacy fallback（已执行）
2. Phase 8C：对 legacy 直读路径加运行时告警（只读告警，不改排序）
3. Phase 8D：清理无消费者的 legacy flat 字段
4. 任何删除动作都需：focused review + gate-only PASS + promotion approval
