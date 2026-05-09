# PHASE9A Source Quality Master Plan

更新时间：2026-05-01  
阶段：Phase 9A Architecture Audit + Strategic Build Plan（只读规划）

## 1. 当前状态（As-Is）

当前 source layer 已具备基础派生能力，核心落点在 `src/lib/jobs/job-scoring-view-model.js`：

- 已有字段：
  - `sourceReliabilityTier` / `sourceReliabilityScore`
  - `sourceAuthorityTier`
  - `sourceTrustScore`
  - `sourceFreshnessTier` / `freshnessScore` / `sourceFreshnessDecay` / `sourceDecayRisk`
  - `sourceCompletenessTier` / `sourceCompletenessScore`
  - `sourceDuplicationRisk` / `duplicateClusterId` / `duplicateConfidence` / `likelyDuplicate`
  - `sourceCommercialNoiseRisk` / `sourceFraudRisk`
  - `productionSourceConfidence`
  - `sourceGovernanceTier` / `sourceMaturityLevel` / `sourcePromotionEligibility`
- 已模块化输出：
  - `jobFeaturesView.featureLayerModules.sourceGovernanceFeatures`
  - `jobFeaturesView.featureLayerModules.dedupeFreshnessFeatures`
- 边界状态：
  - comparator/ranking/gate basis 未引入 source quality 强信号（符合 freeze policy）
  - curated 仍为 diagnostic/benchmark-only

结论：字段“有了”，但还不是 production-grade ingestion core；当前更接近“可观测诊断层”。

## 2. Source Layer Gap Analysis（差距审计）

### A. 已完成能力
- 基础 source 分层：`reliability -> authority -> trust -> confidence -> governance`
- freshness 衰减模型：`sourceFreshnessDecay + freshnessScore + staleRisk`
- 去重基础：cluster key、重复置信、主 posting 选择
- 噪声与欺诈风险基础：`sourceCommercialNoiseRisk`、`sourceFraudRisk`
- promotion 诊断：`sourceMaturityLevel`、`sourcePromotionEligibility`

### B. 缺失能力
- 缺少“跨来源归一化词典”与可版本化 normalization registry（当前主要靠关键词规则）
- 缺少“source authority 证据链”字段（域名白名单命中、来源签名、URL 模式证据）
- 缺少“role-first ingestion quality”专用评分（当前 role 信号与 source 信号耦合在同层函数）
- 缺少“生产去重策略分层”（同公司同岗重发、跨平台同岗、多岗位打包重投）的分轨治理
- 缺少“source-level 历史表现记账”机制（现有 `sourceHistoricalReliability` 仍为单次派生近似）

### C. 字段重叠
- freshness 双轨：
  - `sourceFreshnessTier`（source metadata 口径）
  - `freshnessTier`（dedupe/freshness 统一口径）
- 可信度多层并行：
  - `sourceReliabilityTier`（来源类型）
  - `sourceAuthorityTier`（来源权威）
  - `productionSourceConfidence`（综合置信）
  - `sourceGovernanceTier`（治理层）
- 风险多点：
  - `sourceRiskFlags` / `sourceCommercialNoiseRisk` / `sourceFraudRisk` / `sourceDecayRisk`

### D. 应合并项（责任收口）
- 保留“tier + score + risk”三层，但需明确唯一主责：
  - Tier：分类（是什么）
  - Score：连续强度（多大）
  - Risk：阻断/降级原因（为什么）
- freshness 口径收口：
  - `freshnessTier` 作为统一展示与治理主字段
  - `sourceFreshnessTierLegacy` 仅兼容输入，不再参与主判断

### E. Production-grade 缺口（关键）
- 缺少“可治理的数据证据主线”：
  - source normalization registry
  - authority evidence contract
  - source performance ledger
  - role-first ingestion quality contract

## 3. Production-grade Target Architecture（To-Be）

目标主线（不改 comparator/ranking/gate basis 前提）：

Raw Production Sources  
-> Canonical Listing  
-> Source Normalization Registry  
-> Source Reliability & Authority  
-> Deduplication & Freshness Governance  
-> Source Quality Core（Trust/Completeness/Noise/Fraud）  
-> Production Source Confidence  
-> Ranking Input Gate（仅允许已批准字段进入）

说明：
- Phase 9A 不直接改 ranking。
- 先把 Source Quality Core 从“规则集合”升级为“可审计 contract”。

## 4. Field Responsibility Matrix（字段职责矩阵）

- `sourceReliabilityTier`：来源类型识别（ATS/官网/转载/聚合/未知）
- `sourceAuthorityTier`：来源权威层级（verified/official/repost/aggregator/spam_risk）
- `sourceTrustScore`：综合可信分（authority + completeness - decay - noise - duplicate - riskFlags）
- `sourceCompletenessScore`：结构完整度分（标题/公司/地点/JD/链接）
- `sourceDuplicationRisk`：重复风险分（标题分段、聚合信号、合集信号）
- `sourceCommercialNoiseRisk`：商业噪声分（夸张招聘词、诱导词、短文本）
- `freshnessScore`：时效分（posting age/decay）
- `productionSourceConfidence`：生产侧可用置信分层（high/medium/low）
- `sourceGovernanceTier`：治理层级（trusted/verified/aggregated/repost/exploratory/low_maturity）

原则：
- 任何新字段必须先归入上述职责，不允许新增“语义重复字段”。

## 5. Build Roadmap（9A / 9B / 9C）

### 9A（本阶段，核心收口）
- 建立 Source Quality Contract 文档与字段责任冻结表
- 增加 normalization registry 设计（先文档化、后实现）
- 定义 authority evidence schema（domain/signature/url pattern/sourceTag）
- 定义 role-first ingestion quality 指标（不接入排序）

### 9B（实现阶段，低风险接入）
- 落地 source normalization registry（配置化，不改 canonical schema）
- source authority evidence 计算链路化
- source performance ledger（诊断层，记录来源历史稳定性）
- dedupe/freshness 分轨策略收口（跨源重复与时效治理）

### 9C（治理成熟阶段）
- 形成 promotion governance for source quality（diagnostic -> candidate -> approved）
- 在 gate 之外增加 source quality 专项报表与回归基线
- 仅在审批通过后考虑“极弱 tie-break 试点”，且必须可回滚

## 6. Governance Boundaries（治理边界）

- 禁止改 comparator
- 禁止改 production ranking
- 禁止改 gate basis
- 禁止改 canonical schema
- 禁止 curated 进入 production
- 禁止 UI 先行 patch 驱动 source core 设计
- 任何新增 source 字段需先过：
  - focused review
  - boundary review
  - gate-only regression proof

## 7. 禁止事项（Hard Freeze）

- 禁止“为了单 case 过关”新增临时规则
- 禁止把 source quality 直接抬入主排序
- 禁止将 legacy 兼容字段重新作为主路径
- 禁止将 benchmark/diagnostic 池混入 production eval 口径

## 8. Phase 9A 启动结论

- Phase 8 Legacy Governance：可正式关闭（输出 legacy 收口完成，输入兼容保留观察期）。
- Phase 9A：可启动，且应以“架构收口 + 责任冻结 + 证据化治理”为先，不做 ranking 改写。
