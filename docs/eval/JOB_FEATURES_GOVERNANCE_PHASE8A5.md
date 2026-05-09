# ApplyFlow Phase 8A.5 Governance Consolidation

更新时间：2026-04-30

## 目标
- 对 Phase 7A~8A 累积字段做职责收口，停止 jobFeaturesView 单体膨胀。
- 保持 derived-only，不改 comparator / production ranking / gate basis。

## 模块化结果
- `jobFeaturesView.featureLayerModules.semanticFeatures`
- `jobFeaturesView.featureLayerModules.sourceGovernanceFeatures`
- `jobFeaturesView.featureLayerModules.dedupeFreshnessFeatures`
- `jobFeaturesView.deprecatedFieldAliases`
- `jobFeaturesView.governanceContractVersion = phase8a5`

## 字段职责冻结（核心）
- `sourceQualityTier`：仅 JD/标题/结构质量，不表示来源可信度。
- `sourceReliabilityTier`：仅来源类型可信层级，不表示 JD 语义质量。
- `productionSourceConfidence`：来源治理综合置信层级（diagnostic-only）。
- `confidenceTier`：解析置信层级，不表示来源可信度。
- `rolePurity`：legacy 兼容字段（deprecated alias），新口径以 `roleSemanticPurity` 为准。
- `roleSemanticPurity`：语义职责纯度主字段。
- `freshnessTier`：统一时效主字段。
- `sourceFreshnessTier`：legacy source metadata 字段（deprecated alias），不再扩展新语义。
- `sourceDecayRisk`：来源时效衰减风险（治理字段，保留）。

## Deprecated 策略
- `rolePurity` -> `featureLayerModules.semanticFeatures.rolePurityLegacy`（deprecated_compat_alias）
- `sourceFreshnessTier` -> `featureLayerModules.sourceGovernanceFeatures.sourceFreshnessTierLegacy`（deprecated_compat_alias）

## Eval Governance Template（冻结）
评估输出段落固定为：
1. Gate
2. Full
3. Diagnostic
4. Source Governance
5. Explainability
6. Promotion Governance

新增散点指标默认禁止直接加入输出，需先通过 governance review。

## Governance Freeze Policy
未来新增字段默认禁止直接进入：
- comparator
- production ranking
- gate basis

必须满足以下条件后才允许升级：
- focused review 通过
- boundary/governance review 通过
- regression proof（gate-only 稳定）
- promotion approval 明确记录

## Post-Phase 8 状态注记（2026-05-01）
- Phase 8D 三批次完成后，legacy 输出字段已退出运行时输出。
- 本文冻结策略保持不变：仅保留 old payload 输入兼容 adapter，不允许反向恢复 legacy 输出平铺字段。
