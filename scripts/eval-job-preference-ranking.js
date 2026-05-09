"use strict";

/**
 * 多维偏好评估脚本（小规模离线版）
 * - 读取 seed case
 * - 复用现有 orchestrator/jobs scoring 派生层
 * - 输出 precision、重复率、误判样例、分维度准确率、explanation 一致性
 */

process.env.ENABLE_LLM_JOB_SCORING = "false";

const fs = require("fs");
const path = require("path");
const orchestrator = require("../src/lib/orchestrator/workflow-controller");
const store = require("../src/server/store");
const { runWithRequestContext } = require("../src/server/request-context");

const DEFAULT_SEED_PATH = path.resolve(__dirname, "../docs/eval/jobs-preference-eval.seed.json");
const DEFAULT_CURATED_POOL_PATH = path.resolve(__dirname, "../data/curated_offline_v1.json");
const DEFAULT_TOPK = 10;
const legacyConsumerTracking = {
  legacyFieldReadMap: {},
  directLegacyConsumers: {},
  fallbackOnlyConsumers: {},
  zeroConsumerLegacyFields: [],
  riskyLegacyFields: {}
};
const LEGACY_FIELDS_TRACKED = [
  "jobFeaturesView.rolePurity",
  "jobFeaturesView.sourceFreshnessTier",
  "scoringView.recommendationReasonSummary",
  "scoringView.blockerReasonSummary",
  "scoringView.sourceRiskSummary",
  "scoringView.confidenceExplanation",
  "scoringView.preferenceDriftSummary",
  "scoringView.feedbackSignalType",
  "scoringView.feedbackConfidence",
  "scoringView.feedbackRecencyTier",
  "scoringView.feedbackConsistency",
  "scoringView.feedbackConflictRisk",
  "scoringView.preferenceEvolutionCandidate"
];

function isLegacyWarningEnabled() {
  const flag = String(process.env.APPLYFLOW_LEGACY_WARNINGS || "").trim().toLowerCase();
  const mode = String(process.env.NODE_ENV || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || mode === "development";
}

function trackLegacyRead({
  field = "",
  consumer = "",
  replacement = "",
  deprecationPhase = "phase8c",
  mode = "fallback_only"
} = {}) {
  if (!field || !consumer) return;
  legacyConsumerTracking.legacyFieldReadMap[field] = Number(legacyConsumerTracking.legacyFieldReadMap[field] || 0) + 1;
  const target = mode === "direct" ? legacyConsumerTracking.directLegacyConsumers : legacyConsumerTracking.fallbackOnlyConsumers;
  const key = `${field}::${consumer}`;
  target[key] = {
    field,
    consumer,
    replacement,
    deprecationPhase,
    reads: Number((target[key] && target[key].reads) || 0) + 1
  };
  if (isLegacyWarningEnabled()) {
    console.warn("[ApplyFlow][LegacyReadWarning]", {
      field,
      consumer,
      replacement,
      deprecationPhase,
      mode
    });
  }
}

function finalizeLegacyTracking() {
  legacyConsumerTracking.zeroConsumerLegacyFields = LEGACY_FIELDS_TRACKED.filter(
    (field) => Number(legacyConsumerTracking.legacyFieldReadMap[field] || 0) === 0
  );
  Object.keys(legacyConsumerTracking.legacyFieldReadMap).forEach((field) => {
    const reads = Number(legacyConsumerTracking.legacyFieldReadMap[field] || 0);
    if (reads >= 10 || field.includes("rolePurity") || field.includes("sourceFreshnessTier")) {
      legacyConsumerTracking.riskyLegacyFields[field] = { reads, risk: "high" };
    }
  });
}

function parseArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : [];
  const getArgValue = (flag, fallback) => {
    const inlineArg = args.find((item) => String(item || "").startsWith(`${flag}=`));
    if (inlineArg) {
      const [, value] = String(inlineArg).split(/=(.*)/s);
      return value !== undefined ? value : fallback;
    }
    const index = args.findIndex((item) => item === flag);
    if (index < 0 || index + 1 >= args.length) return fallback;
    return args[index + 1];
  };
  const seedPath = path.resolve(getArgValue("--seed", DEFAULT_SEED_PATH));
  const curatedPoolPath = path.resolve(getArgValue("--curated", DEFAULT_CURATED_POOL_PATH));
  const topK = Math.max(5, Number(getArgValue("--topk", DEFAULT_TOPK)) || DEFAULT_TOPK);
  const rawMode = String(getArgValue("--mode", "full") || "full").trim().toLowerCase();
  const mode = ["gate", "legacy-gate", "full", "diagnostic", "acceptance", "source-report"].includes(rawMode) ? rawMode : "full";
  const updateBaseline = args.includes("--update-baseline");
  // 压缩输出：仅保留关键指标与失败项，避免 full 模式打印过长 case 明细
  const compactOutput = args.includes("--compact-output");
  return { seedPath, curatedPoolPath, topK, updateBaseline, mode, compactOutput };
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function readSeed(seedPath) {
  const raw = fs.readFileSync(seedPath, "utf8");
  const parsed = JSON.parse(raw);
  const cases = Array.isArray(parsed?.cases) ? parsed.cases : [];
  assertTrue(cases.length > 0, "seed cases should not be empty");
  return { seed: parsed, cases };
}

function normalizeFeedbackStateForEval(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["none", "good_fit", "bad_fit", "misclassified"].includes(normalized) ? normalized : "none";
}

function normalizeTrackerStateForEval(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["none", "saved", "applied", "interview", "rejected", "offer"].includes(normalized) ? normalized : "none";
}

function buildEvalEnvironmentHealth() {
  const jobs = toArray(store.listJobs());
  let feedbackStateNonNoneCount = 0;
  let trackerStateNonNoneCount = 0;
  jobs.forEach((job) => {
    if (normalizeFeedbackStateForEval(job?.feedbackState) !== "none") feedbackStateNonNoneCount += 1;
    if (normalizeTrackerStateForEval(job?.trackerState) !== "none") trackerStateNonNoneCount += 1;
  });
  return {
    totalJobs: jobs.length,
    feedbackStateNonNoneCount,
    trackerStateNonNoneCount,
    feedbackInfluenceDisabledInEval: true
  };
}

async function withEvalFeedbackIsolation(run) {
  const originalListJobs = store.listJobs.bind(store);
  store.listJobs = () =>
    toArray(originalListJobs()).map((job) => ({
      ...job,
      feedbackState: "none",
      feedbackTimeline: [],
      trackerState: normalizeTrackerStateForEval(job?.trackerState),
      trackerTimeline: toArray(job?.trackerTimeline)
    }));
  try {
    return await run();
  } finally {
    store.listJobs = originalListJobs;
  }
}

function buildEvalProfile(evalCase = {}) {
  const preferencePayload = evalCase?.userPreference?.jobPreferenceProfile || {};
  const lightweightPayload = evalCase?.userPreference?.lightweightProfile || {};
  return {
    jobPreferenceProfile: preferencePayload,
    lightweightProfile:
      lightweightPayload && typeof lightweightPayload === "object"
        ? {
            targetRoles: toArray(lightweightPayload.targetRoles),
            skills: toArray(lightweightPayload.skills),
            preferredLocations: toArray(lightweightPayload.preferredLocations),
            degree: String(lightweightPayload.degree || ""),
            acceptsNonTech: Boolean(lightweightPayload.acceptsNonTech)
          }
        : {
            targetRoles: [],
            skills: [],
            preferredLocations: [],
            degree: "",
            acceptsNonTech: false
          }
  };
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCuratedRecord(record = {}) {
  return {
    title: String(record.title || "").trim(),
    company: String(record.company || "").trim(),
    location: String(record.location || "").trim(),
    description: String(record.description || "").trim(),
    applyUrl: String(record.applyUrl || "").trim(),
    sourceQualityTier: String(record.sourceQualityTier || "gold").trim().toLowerCase(),
    sourceTag: String(record.sourceTag || "curated_offline_v1").trim(),
    sourceVersion: String(record.sourceVersion || "v202604_batch5b").trim(),
    capturedAt: String(record.capturedAt || "").trim(),
    industryHint: String(record.industryHint || "").trim(),
    roleHint: String(record.roleHint || "").trim(),
    jobTypeHint: String(record.jobTypeHint || "").trim(),
    isMultiRole: Boolean(record.isMultiRole)
  };
}

function buildCuratedJobDrafts(curatedPoolPath = DEFAULT_CURATED_POOL_PATH) {
  if (!fs.existsSync(curatedPoolPath)) return [];
  const parsed = JSON.parse(fs.readFileSync(curatedPoolPath, "utf8"));
  const records = toArray(parsed?.records || parsed);
  return records.map((item, index) => {
    const record = normalizeCuratedRecord(item);
    const id = `job_eval_curated_${String(index + 1).padStart(4, "0")}`;
    return {
      id,
      sourceJobId: id,
      externalId: id,
      company: record.company,
      title: record.title,
      location: record.location,
      priority: "medium",
      status: "inbox",
      sourceLabel: record.sourceTag || "curated_offline_v1",
      sourcePlatform: "curated_offline",
      jobUrl: record.applyUrl,
      sourceUrl: record.applyUrl,
      applyUrl: record.applyUrl,
      jdRaw: record.description,
      metadata: {
        sourceTag: record.sourceTag || "curated_offline_v1",
        sourceVersion: record.sourceVersion || "v202604_batch5b",
        sourceQualityTier: record.sourceQualityTier || "gold",
        capturedAt: record.capturedAt || "",
        industryHint: record.industryHint || "",
        roleHint: record.roleHint || "",
        jobTypeHint: record.jobTypeHint || "",
        isMultiRole: Boolean(record.isMultiRole)
      },
      importMeta: {
        strategy: "curated_offline_pool_seed",
        sourceTag: record.sourceTag || "curated_offline_v1",
        sourceVersion: record.sourceVersion || "v202604_batch5b",
        sourceQualityTier: record.sourceQualityTier || "gold",
        inferredIndustry: record.industryHint || ""
      },
      discoveryContext: {
        source: "curated_offline_pool_seed",
        sourceTag: record.sourceTag || "curated_offline_v1",
        sourceVersion: record.sourceVersion || "v202604_batch5b"
      },
      createdAt: record.capturedAt || new Date().toISOString(),
      updatedAt: record.capturedAt || new Date().toISOString()
    };
  });
}

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeTitleCompanyKey(title = "", company = "") {
  return `${normalizeText(title)}|${normalizeText(company)}`;
}

function includesKeyword(text = "", keyword = "") {
  const source = normalizeText(text);
  const target = normalizeText(keyword);
  return Boolean(source && target && source.includes(target));
}

function includesAny(text = "", keywords = []) {
  return toArray(keywords).some((item) => includesKeyword(text, item));
}

const SOFT_MUST_NOT_KEYWORDS = ["培训", "培训生", "管培", "管培生", "管理培训生", "销售", "客服"];
const BROAD_SKILL_WARNING_KEYWORDS = ["产品", "运营", "测试", "前端", "算法", "数据分析"];

function parseCasePreference(evalCase = {}) {
  const preference =
    evalCase?.userPreference?.jobPreferenceProfile ||
    evalCase?.userPreference?.lightweightProfile ||
    {};
  return {
    preferredIndustries: toArray(preference.preferredIndustries),
    excludedIndustries: toArray(preference.excludedIndustries),
    targetRoles: toArray(preference.targetRoles),
    excludedRoles: toArray(preference.excludedRoles),
    skills: toArray(preference.skills),
    preferredLocations: toArray(preference.preferredLocations),
    companyTypes: toArray(preference.companyTypes),
    avoidCompanyTypes: toArray(preference.avoidCompanyTypes)
  };
}

function buildBaselineSnapshotFromSeed(seed = {}) {
  const baseline = seed?.baselineSnapshot && typeof seed.baselineSnapshot === "object" ? seed.baselineSnapshot : {};
  return {
    precisionAt5: Number(baseline.precisionAt5),
    precisionAt10: Number(baseline.precisionAt10),
    duplicateRate: Number(baseline.duplicateRate),
    explanationConsistency: Number(baseline.explanationConsistency),
    hardFailCount: Number(baseline.hardFailCount),
    warningCount: Number(baseline.warningCount),
    knownGapCount: Number(baseline.knownGapCount),
    cases: Number(baseline.cases)
  };
}

function hasValidBaselineSnapshot(snapshot = {}) {
  return ["precisionAt5", "precisionAt10", "duplicateRate", "explanationConsistency"].every((key) =>
    Number.isFinite(Number(snapshot?.[key]))
  );
}

function buildCurrentSnapshot({
  cases = 0,
  precisionAt5 = 0,
  precisionAt10 = 0,
  duplicateRate = 0,
  explanationConsistency = 0,
  hardFailCount = 0,
  warningCount = 0,
  knownGapCount = 0
} = {}) {
  return {
    cases: Number(cases || 0),
    precisionAt5: Number(precisionAt5 || 0),
    precisionAt10: Number(precisionAt10 || 0),
    duplicateRate: Number(duplicateRate || 0),
    explanationConsistency: Number(explanationConsistency || 0),
    hardFailCount: Number(hardFailCount || 0),
    warningCount: Number(warningCount || 0),
    knownGapCount: Number(knownGapCount || 0),
    updatedAt: new Date().toISOString()
  };
}

function formatDelta(current, baseline) {
  if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(baseline))) return "n/a";
  const delta = Number(current) - Number(baseline);
  const sign = delta > 0 ? "+" : "";
  return `${sign}${(delta * 100).toFixed(1)}pp`;
}

function writeBaselineSnapshotToSeed(seedPath, seed = {}, snapshot = {}) {
  const nextSeed = {
    ...seed,
    baselineSnapshot: {
      ...snapshot
    }
  };
  fs.writeFileSync(seedPath, `${JSON.stringify(nextSeed, null, 2)}\n`, "utf8");
}

function summarizePromotionGovernance(caseResults = []) {
  const summary = {
    gateReadyCandidates: [],
    stableCandidates: [],
    exploratoryCases: [],
    blockedCases: [],
    promotionBlockReasons: {},
    casesFailingStability: [],
    casesBlockedByDataCoverage: []
  };
  toArray(caseResults).forEach((item) => {
    const seedCase = item?.seedCase && typeof item.seedCase === "object" ? item.seedCase : {};
    const maturity = String(seedCase.caseMaturity || "").trim().toLowerCase() || "exploratory";
    const blockingReason = String(seedCase.blockingReason || "").trim();
    const promotionReason = String(seedCase.promotionReason || "").trim();
    const requiredStableRuns = Number(seedCase.requiredStableRuns || 0);
    const currentStableRuns = Number(seedCase.currentStableRuns || 0);
    const entry = {
      id: String(seedCase.id || item.id || ""),
      maturity,
      requiredStableRuns,
      currentStableRuns,
      promotionReason,
      blockingReason
    };
    if (maturity === "gate_ready") summary.gateReadyCandidates.push(entry);
    else if (maturity === "stable_candidate") summary.stableCandidates.push(entry);
    else summary.exploratoryCases.push(entry);

    if (blockingReason) {
      summary.blockedCases.push(entry);
      summary.promotionBlockReasons[blockingReason] = Number(summary.promotionBlockReasons[blockingReason] || 0) + 1;
      if (includesKeyword(blockingReason, "数据") || includesKeyword(blockingReason, "coverage")) {
        summary.casesBlockedByDataCoverage.push(entry.id);
      }
    }
    if (requiredStableRuns > 0 && currentStableRuns < requiredStableRuns) {
      summary.casesFailingStability.push(entry.id);
    }
  });
  return summary;
}

function evaluateExplainabilityQuality(top10Signals = []) {
  const total = toArray(top10Signals).length;
  if (total === 0) {
    return {
      explainabilityContractCoverage: 0,
      recommendationReasonCoverage: 0,
      blockerReasonCoverage: 1,
      reviewReasonCoverage: 1,
      sourceRiskCoverage: 1,
      driftReasonCoverage: 1,
      structuredExplanationConsistency: 0,
      bundledRiskReviewRate: 0,
      sourceRiskReviewRate: 0,
      driftReviewRate: 0,
      blockerExplainabilityCoverage: 1,
      recommendationSummaryQuality: 0
    };
  }
  let explainabilityContractCoverageCount = 0;
  let recommendationReasonCount = 0;
  let blockerReasonCount = 0;
  let reviewReasonCount = 0;
  let sourceRiskCoverageCount = 0;
  let driftReasonCoverageCount = 0;
  let structuredExplanationConsistencyCount = 0;
  let bundledRiskReviewCount = 0;
  let sourceRiskReviewCount = 0;
  let driftReviewCount = 0;
  let blockerCount = 0;
  let blockerCoveredCount = 0;
  let recommendationSummaryQualityCount = 0;

  toArray(top10Signals).forEach((item) => {
    const baseContractCovered =
      Boolean(item.confidenceExplanation) &&
      Boolean(item.roleExplanation) &&
      Boolean(item.industryExplanation) &&
      Boolean(item.sourceExplanation);
    if (baseContractCovered) explainabilityContractCoverageCount += 1;
    if (Boolean(item.recommendationReasonSummary)) recommendationReasonCount += 1;
    if (Boolean(item.blockerReasonSummary)) blockerReasonCount += 1;
    if (Boolean(item.reviewTriggerSummary)) reviewReasonCount += 1;
    if (Boolean(item.sourceRiskSummary)) sourceRiskCoverageCount += 1;
    if (Boolean(item.preferenceDriftSummary)) driftReasonCoverageCount += 1;
    if (item.explainabilityCategory === "bundled_jd_review") bundledRiskReviewCount += 1;
    if (Boolean(item.sourceRiskSummary)) sourceRiskReviewCount += 1;
    if (item.explainabilityCategory === "preference_drift_review") driftReviewCount += 1;
    const hasBlocker = toArray(item.hardBlockers).length > 0 || item.verdict === "no_go";
    if (hasBlocker) {
      blockerCount += 1;
      if (Boolean(item.blockerReasonSummary)) blockerCoveredCount += 1;
    }
    const structuredChecks = evaluateExplanationConsistency(item, {});
    if (structuredChecks.applicable > 0 && structuredChecks.passed === structuredChecks.applicable) {
      structuredExplanationConsistencyCount += 1;
    }
    const summaryText = `${item.recommendationReasonSummary} ${item.reviewTriggerSummary} ${item.blockerReasonSummary}`.trim();
    const usesLegacyMarker = /命中|未命中|技能不足|部分匹配|排除命中/.test(summaryText);
    if (summaryText && !usesLegacyMarker) {
      recommendationSummaryQualityCount += 1;
    }
  });

  return {
    explainabilityContractCoverage: explainabilityContractCoverageCount / total,
    recommendationReasonCoverage: recommendationReasonCount / total,
    blockerReasonCoverage: blockerReasonCount / total,
    reviewReasonCoverage: reviewReasonCount / total,
    sourceRiskCoverage: sourceRiskCoverageCount / total,
    driftReasonCoverage: driftReasonCoverageCount / total,
    structuredExplanationConsistency: structuredExplanationConsistencyCount / total,
    bundledRiskReviewRate: bundledRiskReviewCount / total,
    sourceRiskReviewRate: sourceRiskReviewCount / total,
    driftReviewRate: driftReviewCount / total,
    blockerExplainabilityCoverage: blockerCount > 0 ? blockerCoveredCount / blockerCount : 1,
    recommendationSummaryQuality: recommendationSummaryQualityCount / total
  };
}

function evaluateSourceGovernanceQuality(top10Signals = []) {
  const total = toArray(top10Signals).length;
  if (total === 0) {
    return {
      sourceGovernanceCoverage: 0,
      sourceMaturityDistribution: {},
      sourceVerticalStrengthCoverage: 0,
      productionEligibleSourceRatio: 0,
      sourceFraudRiskRate: 0,
      sourceDecayRiskRate: 0,
      sourcePromotionCandidates: 0,
      blockedSources: 0
    };
  }
  let governanceCoverageCount = 0;
  let verticalStrengthCoverageCount = 0;
  let productionEligibleCount = 0;
  let fraudRiskCount = 0;
  let decayRiskCount = 0;
  let blockedCount = 0;
  const sourceMaturityDistribution = {};
  toArray(top10Signals).forEach((item) => {
    const maturity = String(item.sourceMaturityLevel || "exploratory").trim().toLowerCase() || "exploratory";
    sourceMaturityDistribution[maturity] = Number(sourceMaturityDistribution[maturity] || 0) + 1;
    if (Boolean(item.sourceGovernanceSummary) && Boolean(item.sourceStrengthSummary)) governanceCoverageCount += 1;
    if (String(item.sourceVerticalStrength || "").trim()) verticalStrengthCoverageCount += 1;
    if (item.sourcePromotionEligibility === "production_candidate") productionEligibleCount += 1;
    if (item.sourcePromotionEligibility === "blocked") blockedCount += 1;
    if (item.sourceFraudRisk === "high") fraudRiskCount += 1;
    if (item.sourceDecayRisk === "high") decayRiskCount += 1;
  });
  return {
    sourceGovernanceCoverage: governanceCoverageCount / total,
    sourceMaturityDistribution,
    sourceVerticalStrengthCoverage: verticalStrengthCoverageCount / total,
    productionEligibleSourceRatio: productionEligibleCount / total,
    sourceFraudRiskRate: fraudRiskCount / total,
    sourceDecayRiskRate: decayRiskCount / total,
    sourcePromotionCandidates: productionEligibleCount,
    blockedSources: blockedCount
  };
}

function parseJobSignals(jobVm = {}) {
  const summary = jobVm?.jobSummary || {};
  const scoring = jobVm?.scoringView || {};
  const jobFeaturesView = scoring?.jobFeaturesView && typeof scoring.jobFeaturesView === "object" ? scoring.jobFeaturesView : {};
  const featureModules =
    jobFeaturesView?.featureLayerModules && typeof jobFeaturesView.featureLayerModules === "object"
      ? jobFeaturesView.featureLayerModules
      : {};
  const semanticFeatures = featureModules.semanticFeatures && typeof featureModules.semanticFeatures === "object" ? featureModules.semanticFeatures : {};
  const sourceGovernanceFeatures =
    featureModules.sourceGovernanceFeatures && typeof featureModules.sourceGovernanceFeatures === "object"
      ? featureModules.sourceGovernanceFeatures
      : {};
  const dedupeFreshnessFeatures =
    featureModules.dedupeFreshnessFeatures && typeof featureModules.dedupeFreshnessFeatures === "object"
      ? featureModules.dedupeFreshnessFeatures
      : {};
  const explainabilityFeatures =
    scoring?.explainabilityFeatures && typeof scoring.explainabilityFeatures === "object"
      ? scoring.explainabilityFeatures
      : {};
  const feedbackGovernanceFeatures =
    scoring?.feedbackGovernanceFeatures && typeof scoring.feedbackGovernanceFeatures === "object"
      ? scoring.feedbackGovernanceFeatures
      : {};
  const hasExplainabilityContainer =
    Boolean(scoring?.explainabilityFeatures) && typeof scoring.explainabilityFeatures === "object";
  const hasFeedbackGovernanceContainer =
    Boolean(scoring?.feedbackGovernanceFeatures) && typeof scoring.feedbackGovernanceFeatures === "object";
  const hasSourceGovernanceContainer =
    Boolean(featureModules?.sourceGovernanceFeatures) && typeof featureModules.sourceGovernanceFeatures === "object";
  const consumerPath = "scripts/eval-job-preference-ranking.js:parseJobSignals";
  const resolveExplainabilityField = (fieldName = "", options = {}) => {
    const allowLegacyFallback = options.allowLegacyFallback !== false;
    const value = String(
      explainabilityFeatures?.[fieldName] || (allowLegacyFallback ? scoring?.[fieldName] : "") || ""
    ).trim();
    if (!hasExplainabilityContainer && String(scoring?.[fieldName] || "").trim()) {
      trackLegacyRead({
        field: `scoringView.${fieldName}`,
        consumer: consumerPath,
        replacement: `scoringView.explainabilityFeatures.${fieldName}`,
        deprecationPhase: "phase8d_candidate",
        mode: "fallback_only"
      });
    }
    return value;
  };
  const resolveFeedbackField = (fieldName = "", fallback = "", options = {}) => {
    const allowLegacyFallback = options.allowLegacyFallback !== false;
    const value = String(
      feedbackGovernanceFeatures?.[fieldName] || (allowLegacyFallback ? scoring?.[fieldName] : "") || ""
    )
      .trim()
      .toLowerCase();
    if (!hasFeedbackGovernanceContainer && String(scoring?.[fieldName] || "").trim()) {
      trackLegacyRead({
        field: `scoringView.${fieldName}`,
        consumer: consumerPath,
        replacement: `scoringView.feedbackGovernanceFeatures.${fieldName}`,
        deprecationPhase: "phase8d_candidate",
        mode: "fallback_only"
      });
    }
    return value || fallback;
  };
  const resolveFeedbackBooleanField = (fieldName = "", fallback = false, options = {}) => {
    const allowLegacyFallback = options.allowLegacyFallback !== false;
    const containerValue = feedbackGovernanceFeatures?.[fieldName];
    const legacyValue = allowLegacyFallback ? scoring?.[fieldName] : undefined;
    const value = containerValue ?? legacyValue;
    if (!hasFeedbackGovernanceContainer && legacyValue !== undefined && legacyValue !== null) {
      trackLegacyRead({
        field: `scoringView.${fieldName}`,
        consumer: consumerPath,
        replacement: `scoringView.feedbackGovernanceFeatures.${fieldName}`,
        deprecationPhase: "phase8d_candidate",
        mode: "fallback_only"
      });
    }
    return value === undefined ? Boolean(fallback) : Boolean(value);
  };
  const resolveSourceGovernanceField = (fieldName = "", fallback = "", legacyFieldName = "", options = {}) => {
    const allowLegacyFallback = options.allowLegacyFallback !== false;
    const value = String(sourceGovernanceFeatures?.[fieldName] || (allowLegacyFallback ? jobFeaturesView?.[fieldName] : "") || "")
      .trim()
      .toLowerCase();
    if (!hasSourceGovernanceContainer && allowLegacyFallback && String(jobFeaturesView?.[fieldName] || "").trim()) {
      trackLegacyRead({
        field: `jobFeaturesView.${legacyFieldName || fieldName}`,
        consumer: consumerPath,
        replacement: `jobFeaturesView.featureLayerModules.sourceGovernanceFeatures.${fieldName}`,
        deprecationPhase: "phase8d_candidate",
        mode: "fallback_only"
      });
    }
    return value || fallback;
  };
  const decisionVerdict = scoring?.decisionVerdict && typeof scoring.decisionVerdict === "object" ? scoring.decisionVerdict : {};
  const skillGapView = scoring?.skillGapView && typeof scoring.skillGapView === "object" ? scoring.skillGapView : {};
  const title = String(summary.title || "");
  const company = String(summary.company || "");
  const location = String(summary.location || "");
  const roleFamily = String(scoring.inferredRoleFamily || "");
  const industry = String(scoring.inferredIndustry || "");
  const explanation = String(scoring.explanation || "");
  const explainabilityCorpus = [
    explanation,
    String(scoring.roleMatchSummary || ""),
    String(scoring.semanticPuritySummary || ""),
    String(resolveExplainabilityField("recommendationReasonSummary", { allowLegacyFallback: false })),
    String(scoring.opportunityType || decisionVerdict.opportunityType || ""),
    String(scoring.opportunityTypeSummary || decisionVerdict.opportunityTypeSummary || explainabilityFeatures.opportunityTypeSummary || ""),
    String(resolveExplainabilityField("reviewTriggerSummary")),
    String(resolveExplainabilityField("blockerReasonSummary", { allowLegacyFallback: false })),
    ...toArray(scoring.rankingPrimaryDrivers),
    ...toArray(scoring.rankingNegativeDrivers),
    ...toArray(scoring.matchSignals),
    ...toArray(scoring.mismatchSignals)
  ].join(" ");
  const combined = [title, company, location, roleFamily, industry, explainabilityCorpus].join(" ");
  return {
    title,
    company,
    location,
    roleFamily,
    roleEvidenceType: String(scoring.roleEvidenceType || scoring.roleFitEvidenceType || "").trim().toLowerCase(),
    industry,
    inferredSkills: toArray(scoring.inferredSkills),
    inferredCompanyTypes: toArray(scoring.inferredCompanyTypes),
    explanation,
    mismatchSignals: toArray(scoring.mismatchSignals),
    risks: toArray(scoring.risks),
    score: Number(scoring.score || 0),
    userPriorityScore: Number(scoring.userPriorityScore ?? scoring.preferenceMatchScore ?? scoring.score ?? 0),
    userPriorityDimensions: scoring.userPriorityDimensions && typeof scoring.userPriorityDimensions === "object" ? scoring.userPriorityDimensions : {},
    industryFit: scoring.industryFit,
    roleFit: scoring.roleFit,
    locationFit: scoring.locationFit,
    companyFit: scoring.companyFit,
    applicationAccessibilityFit: scoring.applicationAccessibilityFit,
    dominantRoleSegment: String(scoring.dominantRoleSegment || title || ""),
    secondaryRoleSegments: toArray(scoring.secondaryRoleSegments),
    verdict: String(decisionVerdict.verdict || "").trim().toLowerCase() || "review",
    grade: String(decisionVerdict.grade || "").trim(),
    confidence: String(decisionVerdict.confidence || "").trim().toLowerCase() || "medium",
    opportunityType: String(scoring.opportunityType || decisionVerdict.opportunityType || "single_role_job").trim(),
    opportunityTypeConfidence: String(scoring.opportunityTypeConfidence || decisionVerdict.opportunityTypeConfidence || "medium").trim().toLowerCase(),
    opportunityTypeSummary: String(scoring.opportunityTypeSummary || decisionVerdict.opportunityTypeSummary || explainabilityFeatures.opportunityTypeSummary || "").trim(),
    hardBlockers: toArray(decisionVerdict.hardBlockers),
    jobQualityTier: String(semanticFeatures.sourceQualityTier || jobFeaturesView.sourceQualityTier || "").trim().toLowerCase() || "unknown",
    jobConfidenceTier: String(semanticFeatures.confidenceTier || jobFeaturesView.confidenceTier || "").trim().toLowerCase() || "unknown",
    sourceReliabilityTier: resolveSourceGovernanceField("sourceReliabilityTier", "unknown"),
    sourceFreshnessTier: resolveSourceGovernanceField("freshnessTier", "unknown", "sourceFreshnessTier", { allowLegacyFallback: false }),
    sourceCompletenessTier: resolveSourceGovernanceField("sourceCompletenessTier", "medium"),
    sourceGovernanceTier: resolveSourceGovernanceField("sourceGovernanceTier", "exploratory_source"),
    sourceMaturityLevel: resolveSourceGovernanceField("sourceMaturityLevel", "exploratory"),
    sourceHistoricalReliability: resolveSourceGovernanceField("sourceHistoricalReliability", "medium"),
    sourceCoverageDensity: resolveSourceGovernanceField("sourceCoverageDensity", "medium"),
    sourceVerticalStrength: resolveSourceGovernanceField("sourceVerticalStrength", "general"),
    sourceDecayRisk: resolveSourceGovernanceField("sourceDecayRisk", "medium"),
    sourceFraudRisk: resolveSourceGovernanceField("sourceFraudRisk", "medium"),
    sourcePromotionEligibility: resolveSourceGovernanceField("sourcePromotionEligibility", "diagnostic_only"),
    sourceRiskFlags: toArray(sourceGovernanceFeatures.sourceRiskFlags || jobFeaturesView.sourceRiskFlags),
    likelyBundledJD: Boolean(semanticFeatures.likelyBundledJD ?? jobFeaturesView.likelyBundledJD),
    feedbackSignalType: resolveFeedbackField("feedbackSignalType", "none", { allowLegacyFallback: false }),
    feedbackConfidence: resolveFeedbackField("feedbackConfidence", "low", { allowLegacyFallback: false }),
    feedbackRecencyTier: resolveFeedbackField("feedbackRecencyTier", "none", { allowLegacyFallback: false }),
    feedbackConsistency: resolveFeedbackField("feedbackConsistency", "unknown", { allowLegacyFallback: false }),
    feedbackConflictRisk: resolveFeedbackField("feedbackConflictRisk", "low", { allowLegacyFallback: false }),
    preferenceEvolutionCandidate: resolveFeedbackBooleanField("preferenceEvolutionCandidate", false, { allowLegacyFallback: false }),
    inferredPreferenceDelta:
      (feedbackGovernanceFeatures.inferredPreferenceDelta && typeof feedbackGovernanceFeatures.inferredPreferenceDelta === "object") ||
      (scoring.inferredPreferenceDelta && typeof scoring.inferredPreferenceDelta === "object")
        ? {
            direction: String((feedbackGovernanceFeatures.inferredPreferenceDelta || scoring.inferredPreferenceDelta).direction || "").trim().toLowerCase() || "none",
            roleFamily: String((feedbackGovernanceFeatures.inferredPreferenceDelta || scoring.inferredPreferenceDelta).roleFamily || "").trim(),
            industry: String((feedbackGovernanceFeatures.inferredPreferenceDelta || scoring.inferredPreferenceDelta).industry || "").trim(),
            reason: String((feedbackGovernanceFeatures.inferredPreferenceDelta || scoring.inferredPreferenceDelta).reason || "").trim()
          }
        : { direction: "none", roleFamily: "", industry: "", reason: "" },
    feedbackSignalTypeRaw: String(feedbackGovernanceFeatures.feedbackSignalType || "").trim(),
    explainabilityCategory: String(scoring.explainabilityCategory || "").trim().toLowerCase() || "low_confidence_review",
    rankingPrimaryDrivers: toArray(scoring.rankingPrimaryDrivers),
    rankingNegativeDrivers: toArray(scoring.rankingNegativeDrivers),
    confidencePrimaryDrivers: toArray(scoring.confidencePrimaryDrivers),
    sourceRiskSummary: resolveExplainabilityField("sourceRiskSummary", { allowLegacyFallback: false }),
    sourceGovernanceSummary: String(sourceGovernanceFeatures.sourceGovernanceSummary || scoring.sourceGovernanceSummary || jobFeaturesView.sourceGovernanceSummary || "").trim(),
    sourceStrengthSummary: String(sourceGovernanceFeatures.sourceStrengthSummary || scoring.sourceStrengthSummary || jobFeaturesView.sourceStrengthSummary || "").trim(),
    sourcePromotionBlockReason: String(sourceGovernanceFeatures.sourcePromotionBlockReason || scoring.sourcePromotionBlockReason || jobFeaturesView.sourcePromotionBlockReason || "").trim(),
    roleMatchSummary: String(scoring.roleMatchSummary || "").trim(),
    confidenceExplanation: resolveExplainabilityField("confidenceExplanation", { allowLegacyFallback: false }),
    roleExplanation: String(explainabilityFeatures.roleExplanation || scoring.roleExplanation || "").trim(),
    industryExplanation: String(explainabilityFeatures.industryExplanation || scoring.industryExplanation || "").trim(),
    sourceExplanation: String(explainabilityFeatures.sourceExplanation || scoring.sourceExplanation || "").trim(),
    semanticPuritySummary: String(scoring.semanticPuritySummary || "").trim(),
    bundledRiskSummary: String(scoring.bundledRiskSummary || "").trim(),
    freshnessRiskSummary: String(scoring.freshnessRiskSummary || "").trim(),
    recommendationReasonSummary: resolveExplainabilityField("recommendationReasonSummary", { allowLegacyFallback: false }),
    reviewTriggerSummary: resolveExplainabilityField("reviewTriggerSummary"),
    blockerReasonSummary: resolveExplainabilityField("blockerReasonSummary", { allowLegacyFallback: false }),
    preferenceDriftSummary: resolveExplainabilityField("preferenceDriftSummary", { allowLegacyFallback: false }),
    skillGapOverallFit: String(skillGapView.overallFit || "").trim().toLowerCase() || "unknown",
    skillGapHasUserSkills: Boolean(skillGapView.hasUserSkills),
    skillGapMatchedSkills: toArray(skillGapView.matchedSkills),
    skillGapMissingSkills: toArray(skillGapView.missingSkills),
    combined
  };
}

function matchesIndustry(jobSignals, expectedIndustries = []) {
  const expected = toArray(expectedIndustries);
  if (expected.length === 0) return null;
  return expected.some((term) => includesKeyword(jobSignals.industry, term));
}

function matchesRole(jobSignals, expectedRoles = []) {
  const expected = toArray(expectedRoles);
  if (expected.length === 0) return null;
  return expected.some((term) => {
    return (
      includesKeyword(jobSignals.roleFamily, term) ||
      includesKeyword(jobSignals.title, term) ||
      includesKeyword(jobSignals.combined, term)
    );
  });
}

function matchesSkill(jobSignals, expectedSkills = []) {
  const expected = toArray(expectedSkills);
  if (expected.length === 0) return null;
  return expected.some((term) => {
    if (jobSignals.inferredSkills.some((skill) => includesKeyword(skill, term) || includesKeyword(term, skill))) return true;
    return includesKeyword(jobSignals.combined, term);
  });
}

function matchesLocation(jobSignals, preferredLocations = []) {
  const expected = toArray(preferredLocations);
  if (expected.length === 0) return null;
  return expected.some((term) => includesKeyword(jobSignals.location, term) || includesKeyword(jobSignals.combined, term));
}

function matchesCompanyType(jobSignals, expectedCompanyTypes = []) {
  const expected = toArray(expectedCompanyTypes);
  if (expected.length === 0) return null;
  return expected.some((term) => {
    if (jobSignals.inferredCompanyTypes.some((item) => includesKeyword(item, term))) return true;
    return includesKeyword(jobSignals.combined, term);
  });
}

function hasExcludedIndustryHit(jobSignals, preference) {
  return toArray(preference.excludedIndustries).some((item) => includesKeyword(jobSignals.industry, item));
}

function hasExcludedRoleHit(jobSignals, preference) {
  return toArray(preference.excludedRoles).some((item) => includesKeyword(jobSignals.combined, item));
}

function hasAvoidCompanyHit(jobSignals, preference) {
  return toArray(preference.avoidCompanyTypes).some((item) => {
    if (jobSignals.inferredCompanyTypes.some((type) => includesKeyword(type, item))) return true;
    return includesKeyword(jobSignals.combined, item);
  });
}

function normalizeBucketLabel(value = "", fallback = "unknown") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function buildCountMap(entries = []) {
  return entries.reduce((acc, item) => {
    const key = normalizeBucketLabel(item, "unknown");
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
}

function filterRepeatedSignals(countMap = {}, minCount = 2) {
  return Object.entries(countMap)
    .filter(([, count]) => Number(count || 0) >= minCount)
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
    .map(([value, count]) => ({ value, count: Number(count || 0) }));
}

function isPositiveFeedbackSignalType(signalType = "") {
  return ["applied", "good_fit", "shortlist", "saved"].includes(String(signalType || "").trim().toLowerCase());
}

function aggregatePreferenceEvolutionCandidates(top10Signals = [], preference = {}) {
  const eligibleSignals = toArray(top10Signals).filter((item) => {
    if (!item || typeof item !== "object") return false;
    if (!item.preferenceEvolutionCandidate) return false;
    if (!isPositiveFeedbackSignalType(item.feedbackSignalType)) return false;
    if (item.feedbackConfidence === "low") return false;
    if (item.feedbackConflictRisk === "high") return false;
    if (item.jobQualityTier === "low") return false;
    if (item.likelyBundledJD) return false;
    if (toArray(item.hardBlockers).length > 0) return false;
    return true;
  });

  const roleSignals = [];
  const industrySignals = [];
  const locationSignals = [];
  const companyTypeSignals = [];
  const exclusionSignals = [];

  eligibleSignals.forEach((item) => {
    const delta = item.inferredPreferenceDelta || {};
    const roleFamily = normalizeBucketLabel(delta.roleFamily || item.roleFamily, "");
    const industry = normalizeBucketLabel(delta.industry || item.industry, "");
    const locationMatched = matchesLocation(item, preference.preferredLocations);
    const companyMatched = matchesCompanyType(item, preference.companyTypes);
    const excludedHit =
      hasExcludedIndustryHit(item, preference) ||
      hasExcludedRoleHit(item, preference) ||
      hasAvoidCompanyHit(item, preference);

    if (roleFamily && !matchesRole(item, preference.targetRoles)) {
      roleSignals.push(roleFamily);
    }
    if (industry && !matchesIndustry(item, preference.preferredIndustries)) {
      industrySignals.push(industry);
    }
    if (preference.preferredLocations.length > 0 && locationMatched === false) {
      locationSignals.push(normalizeBucketLabel(item.location, "地点未说明"));
    }
    if (preference.companyTypes.length > 0 && companyMatched === false) {
      const preferredCompanyType =
        toArray(item.inferredCompanyTypes)
          .map((value) => String(value || "").trim())
          .find(Boolean) || "公司类型未说明";
      companyTypeSignals.push(preferredCompanyType);
    }
    if (excludedHit) {
      if (hasExcludedRoleHit(item, preference) && roleFamily) {
        exclusionSignals.push(`role:${roleFamily}`);
      }
      if (hasExcludedIndustryHit(item, preference) && industry) {
        exclusionSignals.push(`industry:${industry}`);
      }
      if (hasAvoidCompanyHit(item, preference)) {
        const companyType =
          toArray(item.inferredCompanyTypes)
            .map((value) => String(value || "").trim())
            .find(Boolean) || "company:unknown";
        exclusionSignals.push(`company:${companyType}`);
      }
    }
  });

  const repeatedRoleSignal = filterRepeatedSignals(buildCountMap(roleSignals));
  const repeatedIndustrySignal = filterRepeatedSignals(buildCountMap(industrySignals));
  const repeatedLocationSignal = filterRepeatedSignals(buildCountMap(locationSignals));
  const repeatedCompanyTypeSignal = filterRepeatedSignals(buildCountMap(companyTypeSignals));
  const repeatedExclusionSignal = filterRepeatedSignals(buildCountMap(exclusionSignals));
  const candidateTypeCount = [
    repeatedRoleSignal,
    repeatedIndustrySignal,
    repeatedLocationSignal,
    repeatedCompanyTypeSignal,
    repeatedExclusionSignal
  ].filter((items) => items.length > 0).length;
  const preferenceDriftRisk =
    repeatedExclusionSignal.length > 0 || candidateTypeCount >= 3
      ? "high"
      : candidateTypeCount >= 1
        ? "medium"
        : "low";

  return {
    repeatedRoleSignal,
    repeatedIndustrySignal,
    repeatedLocationSignal,
    repeatedCompanyTypeSignal,
    repeatedExclusionSignal,
    preferenceDriftRisk,
    preferenceEvolutionReviewNeeded: candidateTypeCount > 0
  };
}

function isRelevantJob(jobSignals, expected = {}) {
  const industryCheck = matchesIndustry(jobSignals, expected.expectedIndustries);
  const roleCheck = matchesRole(jobSignals, expected.expectedRoles);
  const companyCheck = matchesCompanyType(jobSignals, expected.expectedCompanyTypes);
  const checks = [industryCheck, roleCheck, companyCheck].filter((item) => item !== null);
  if (checks.length === 0) return true;
  return checks.every(Boolean);
}

function hasPositivePreference(preference = {}) {
  return (
    toArray(preference.preferredIndustries).length > 0 ||
    toArray(preference.targetRoles).length > 0 ||
    toArray(preference.skills).length > 0 ||
    toArray(preference.companyTypes).length > 0
  );
}

function isExcludeOnlyCase(preference = {}) {
  const hasExclusion =
    toArray(preference.excludedIndustries).length > 0 ||
    toArray(preference.excludedRoles).length > 0 ||
    toArray(preference.avoidCompanyTypes).length > 0;
  return hasExclusion && !hasPositivePreference(preference);
}

function evaluateExplanationConsistency(jobSignals) {
  const checks = [];
  const category = String(jobSignals.explainabilityCategory || "").trim().toLowerCase();
  const verdict = String(jobSignals.verdict || "").trim().toLowerCase();
  const hasBlocker = toArray(jobSignals.hardBlockers).length > 0 || verdict === "no_go" || category === "blocker_conflict";
  const needsReview =
    !hasBlocker &&
    (
      verdict === "review" ||
      ["low_confidence_review", "low_source_quality_review", "bundled_jd_review", "preference_drift_review"].includes(category)
    );
  const needsSourceRisk =
    category === "low_source_quality_review" ||
    String(jobSignals.sourceReliabilityTier || "").trim().toLowerCase() === "low_confidence" ||
    String(jobSignals.jobConfidenceTier || "").trim().toLowerCase() === "low";
  const needsDriftReason = category === "preference_drift_review" || Boolean(jobSignals.preferenceEvolutionCandidate);
  const needsRecommendation = !hasBlocker;

  checks.push({
    type: "roleExplanation",
    ok: Boolean(jobSignals.roleExplanation)
  });
  checks.push({
    type: "industryExplanation",
    ok: Boolean(jobSignals.industryExplanation)
  });
  checks.push({
    type: "sourceExplanation",
    ok: Boolean(jobSignals.sourceExplanation)
  });
  checks.push({
    type: "confidenceExplanation",
    ok: Boolean(jobSignals.confidenceExplanation)
  });
  if (needsRecommendation) {
    checks.push({
      type: "recommendationReasonSummary",
      ok: Boolean(jobSignals.recommendationReasonSummary)
    });
  }
  if (hasBlocker) {
    checks.push({
      type: "blockerReasonSummary",
      ok: Boolean(jobSignals.blockerReasonSummary)
    });
  }
  if (needsReview) {
    checks.push({
      type: "reviewTriggerSummary",
      ok: Boolean(jobSignals.reviewTriggerSummary)
    });
  }
  if (needsSourceRisk) {
    checks.push({
      type: "sourceRiskSummary",
      ok: Boolean(jobSignals.sourceRiskSummary)
    });
  }
  if (needsDriftReason) {
    checks.push({
      type: "preferenceDriftSummary",
      ok: Boolean(jobSignals.preferenceDriftSummary)
    });
  }
  const applicable = checks.length;
  const passed = checks.filter((item) => item.ok).length;
  return {
    checks,
    applicable,
    passed
  };
}

function classifyMustNotSeverity(matchedKeywords = [], signals = {}, expected = {}) {
  const normalizedKeywords = toArray(matchedKeywords);
  if (normalizedKeywords.length === 0) return "hard";
  const allSoft = normalizedKeywords.every((item) =>
    SOFT_MUST_NOT_KEYWORDS.some((keyword) => includesKeyword(item, keyword))
  );
  const hasExpectedRole = toArray(expected.expectedRoles).some((item) => includesKeyword(signals.combined, item));
  const hasExpectedIndustry = toArray(expected.expectedIndustries).some((item) => includesKeyword(signals.industry, item));
  const dominantRoleSegment = String(signals.dominantRoleSegment || signals.title || "");
  const dominantHit = normalizedKeywords.some((item) => includesKeyword(dominantRoleSegment, item));
  if (allSoft && !dominantHit && (hasExpectedRole || hasExpectedIndustry)) return "ignore";
  if (allSoft && (hasExpectedRole || hasExpectedIndustry)) return "warning";
  return allSoft ? "warning" : "hard";
}

function collectFalsePositiveExamples(topJobs = [], expected = {}, preference = {}) {
  const hardExamples = [];
  const warningExamples = [];
  const top3 = topJobs.slice(0, 3);
  const mustNotKeywords = toArray(expected.mustNotAppearInTop3);
  top3.forEach((job, index) => {
    const signals = parseJobSignals(job);
    if (mustNotKeywords.length > 0 && includesAny(signals.combined, mustNotKeywords)) {
      const matchedKeywords = mustNotKeywords.filter((item) => includesKeyword(signals.combined, item));
      const severity = classifyMustNotSeverity(matchedKeywords, signals, expected);
      if (severity === "ignore") {
        return;
      }
      const target = severity === "hard" ? hardExamples : warningExamples;
      target.push({
        rank: index + 1,
        reason: "mustNotAppearInTop3",
        title: signals.title,
        company: signals.company,
        matchedKeywords
      });
    }
    if (hasExcludedIndustryHit(signals, preference) || hasExcludedRoleHit(signals, preference) || hasAvoidCompanyHit(signals, preference)) {
      hardExamples.push({
        rank: index + 1,
        reason: "excluded-hit-in-top3",
        title: signals.title,
        company: signals.company
      });
    }
  });
  return {
    hard: hardExamples,
    warnings: warningExamples
  };
}

function computeDuplicateRate(topJobs = []) {
  if (topJobs.length === 0) return 0;
  const seen = new Set();
  let duplicateCount = 0;
  topJobs.forEach((job) => {
    const summary = job?.jobSummary || {};
    const key = normalizeTitleCompanyKey(summary.title, summary.company);
    if (!key.trim()) return;
    if (seen.has(key)) duplicateCount += 1;
    else seen.add(key);
  });
  return duplicateCount / topJobs.length;
}

function computeDimensionAccuracy(topJobs = [], evalCase = {}) {
  const expected = evalCase.expected || {};
  const preference = parseCasePreference(evalCase);
  const dimensions = {
    industry: { applicable: toArray(expected.expectedIndustries).length > 0, pass: 0, total: 0 },
    role: { applicable: toArray(expected.expectedRoles).length > 0, pass: 0, total: 0 },
    skill: { applicable: preference.skills.length > 0, pass: 0, total: 0 },
    location: { applicable: preference.preferredLocations.length > 0, pass: 0, total: 0 },
    company: {
      applicable: toArray(expected.expectedCompanyTypes).length > 0 || preference.companyTypes.length > 0,
      pass: 0,
      total: 0
    }
  };

  topJobs.forEach((job) => {
    const signals = parseJobSignals(job);
    if (dimensions.industry.applicable) {
      dimensions.industry.total += 1;
      if (matchesIndustry(signals, expected.expectedIndustries)) dimensions.industry.pass += 1;
    }
    if (dimensions.role.applicable) {
      dimensions.role.total += 1;
      if (matchesRole(signals, expected.expectedRoles)) dimensions.role.pass += 1;
    }
    if (dimensions.skill.applicable) {
      dimensions.skill.total += 1;
      if (matchesSkill(signals, preference.skills)) dimensions.skill.pass += 1;
    }
    if (dimensions.location.applicable) {
      dimensions.location.total += 1;
      if (matchesLocation(signals, preference.preferredLocations)) dimensions.location.pass += 1;
    }
    if (dimensions.company.applicable) {
      dimensions.company.total += 1;
      const companyExpected = toArray(expected.expectedCompanyTypes).length > 0 ? expected.expectedCompanyTypes : preference.companyTypes;
      if (matchesCompanyType(signals, companyExpected)) dimensions.company.pass += 1;
    }
  });

  const result = {};
  Object.keys(dimensions).forEach((key) => {
    const item = dimensions[key];
    result[key] = item.total > 0 ? item.pass / item.total : null;
  });
  return result;
}

function evaluateLocationOverride(topJobs = [], evalCase = {}) {
  const expected = evalCase.expected || {};
  if (!expected.locationShouldNotOverridePrimary) {
    return { applicable: false, violations: 0 };
  }
  const preference = parseCasePreference(evalCase);
  const preferredIndustries = toArray(expected.expectedIndustries);
  const preferredRoles = toArray(expected.expectedRoles);
  const top3 = topJobs.slice(0, 3);
  let violations = 0;
  top3.forEach((job) => {
    const signals = parseJobSignals(job);
    const locationMatched = matchesLocation(signals, preference.preferredLocations);
    const primaryIndustryMatched = preferredIndustries.length === 0 ? true : matchesIndustry(signals, preferredIndustries);
    const primaryRoleMatched = preferredRoles.length === 0 ? true : matchesRole(signals, preferredRoles);
    const primaryMatched = Boolean(primaryIndustryMatched && primaryRoleMatched);
    if (locationMatched && !primaryMatched) {
      violations += 1;
    }
  });
  return { applicable: true, violations };
}

function evaluateExcludeOnlyBehavior(topJobs = [], preference = {}) {
  if (!isExcludeOnlyCase(preference)) {
    return {
      applicable: false,
      top3ExcludedHits: 0,
      top3StructuredExcludeHints: 0,
      top3ExplicitExcludeContracts: 0
    };
  }
  const top3 = topJobs.slice(0, 3).map((job) => parseJobSignals(job));
  const top3ExcludedHits = top3.filter((signals) => {
    return hasExcludedIndustryHit(signals, preference) || hasExcludedRoleHit(signals, preference) || hasAvoidCompanyHit(signals, preference);
  }).length;
  const top3StructuredExcludeHints = top3.filter((signals) => {
    return (
      Boolean(signals.blockerReasonSummary) ||
      Boolean(signals.reviewTriggerSummary) ||
      toArray(signals.hardBlockers).length > 0
    );
  }).length;
  const top3ExplicitExcludeContracts = top3.filter((signals) => {
    return (
      Boolean(signals.blockerReasonSummary) ||
      toArray(signals.hardBlockers).some((item) => includesKeyword(item, "排除")) ||
      toArray(signals.mismatchSignals).some((item) => includesKeyword(item, "排除"))
    );
  }).length;
  return {
    applicable: true,
    top3ExcludedHits,
    top3StructuredExcludeHints,
    top3ExplicitExcludeContracts
  };
}

function isKnownGapCase(evalCase = {}) {
  return toArray(evalCase.coverageTags).some((item) => item === "known_gap" || item === "stretch_target");
}

function summarizeTopJobs(topJobs = []) {
  return topJobs.map((job, index) => {
    const signals = parseJobSignals(job);
    return {
      rank: index + 1,
      score: signals.score,
      userPriorityScore: signals.userPriorityScore,
      title: signals.title,
      company: signals.company,
      industry: signals.industry || "其他",
      role: signals.roleFamily || "未知",
      explanation: signals.explanation,
      opportunityType: signals.opportunityType,
      opportunityTypeConfidence: signals.opportunityTypeConfidence,
      opportunityTypeSummary: signals.opportunityTypeSummary,
      roleFit: Number(signals.roleFit || 0),
      industryFit: Number(signals.industryFit || 0),
      locationFit: Number(signals.locationFit || 0),
      companyFit: Number(signals.companyFit || 0),
      accessibilityFit: Number(signals.applicationAccessibilityFit || 0),
      userPriorityDimensions: signals.userPriorityDimensions,
      roleFitEvidenceType: String(signals.roleFitEvidenceType || ""),
      grade: signals.grade,
      verdict: signals.verdict
    };
  });
}

async function evaluateCase(evalCase = {}, topK = DEFAULT_TOPK, poolJobs = []) {
  const evalProfile = buildEvalProfile(evalCase);
  const response = await runWithRequestContext(
    {
      overrideStore: {
        listJobs: () => poolJobs,
        getProfile: () => evalProfile,
        saveProfile: () => evalProfile
      }
    },
    () => withEvalFeedbackIsolation(() => orchestrator.getJobWorkspaceList())
  );
  const jobs = toArray(response?.jobWorkspaceViewModels);
  const top10 = jobs.slice(0, 10);
  const top5 = jobs.slice(0, 5);
  const expected = evalCase.expected || {};
  const preference = parseCasePreference(evalCase);

  const top5Relevant = top5.filter((job) => isRelevantJob(parseJobSignals(job), expected)).length;
  const top10Relevant = top10.filter((job) => isRelevantJob(parseJobSignals(job), expected)).length;
  const precisionAt5 = top5Relevant / Math.max(1, top5.length);
  const precisionAt10 = top10Relevant / Math.max(1, top10.length);
  const duplicateRate = computeDuplicateRate(top10);
  const falsePositives = collectFalsePositiveExamples(top10, expected, preference);
  const perDimensionAccuracy = computeDimensionAccuracy(top10, evalCase);
  const locationOverride = evaluateLocationOverride(top10, evalCase);
  const excludeOnlyBehavior = evaluateExcludeOnlyBehavior(top10, preference);
  const verdictDiagnostics = {
    noGoInTop3RelevantCount: 0,
    excludedDominantNotNoGoCount: 0,
    skillsEmptyNoGoCount: 0,
    mixedSecondaryNoGoCount: 0,
    locationOnlyNoGoCount: 0,
    skillsProvidedButNoExtractionCount: 0,
    skillsProvidedTop10Count: 0,
    skillsEmptyUnknownCount: 0,
    skillsEmptyTop10Count: 0,
    partialMatchWithMissingCount: 0,
    falseMissingSkillWarningsCount: 0,
    falseMissingSkillWarningSamples: []
  };
  const top3Signals = top10.slice(0, 3).map((job) => parseJobSignals(job));
  top3Signals.forEach((signals) => {
    const isRelevant = isRelevantJob(signals, expected);
    const dominantExcluded = toArray(signals.mismatchSignals).some((item) =>
      includesKeyword(item, "命中排除岗位（主语义）")
    );
    const secondaryExcluded = toArray(signals.mismatchSignals).some((item) =>
      includesKeyword(item, "命中排除岗位（附带语义）")
    );
    const hasHardBlocker = toArray(signals.hardBlockers).length > 0;
    const locationOnlyBlocker =
      hasHardBlocker &&
      toArray(signals.hardBlockers).every((item) => includesKeyword(item, "地点"));
    if (isRelevant && signals.verdict === "no_go") verdictDiagnostics.noGoInTop3RelevantCount += 1;
    if (dominantExcluded && signals.verdict !== "no_go") verdictDiagnostics.excludedDominantNotNoGoCount += 1;
    if (preference.skills.length === 0 && signals.verdict === "no_go" && !dominantExcluded) {
      verdictDiagnostics.skillsEmptyNoGoCount += 1;
    }
    if (secondaryExcluded && !dominantExcluded && signals.verdict === "no_go") {
      verdictDiagnostics.mixedSecondaryNoGoCount += 1;
    }
    if (signals.verdict === "no_go" && locationOnlyBlocker) {
      verdictDiagnostics.locationOnlyNoGoCount += 1;
    }
  });
  top10.forEach((job) => {
    const signals = parseJobSignals(job);
    if (preference.skills.length > 0) {
      verdictDiagnostics.skillsProvidedTop10Count += 1;
      if (signals.skillGapHasUserSkills && signals.skillGapMatchedSkills.length === 0 && signals.skillGapMissingSkills.length === 0) {
        verdictDiagnostics.skillsProvidedButNoExtractionCount += 1;
      }
      const inferredSkillText = toArray(signals.inferredSkills).join(" ").toLowerCase();
      const likelyMatched = preference.skills.some((item) => includesKeyword(inferredSkillText, item) || includesKeyword(signals.combined, item));
      if (likelyMatched && signals.skillGapMissingSkills.length > 0) {
        verdictDiagnostics.partialMatchWithMissingCount += 1;
        const suspiciousMissingSkills = signals.skillGapMissingSkills.filter((item) =>
          BROAD_SKILL_WARNING_KEYWORDS.some((keyword) => includesKeyword(item, keyword))
        );
        if (suspiciousMissingSkills.length > 0) {
          verdictDiagnostics.falseMissingSkillWarningsCount += 1;
          if (verdictDiagnostics.falseMissingSkillWarningSamples.length < 10) {
            verdictDiagnostics.falseMissingSkillWarningSamples.push({
              caseId: String(evalCase.id || ""),
              title: String(signals.title || ""),
              matchedSkills: toArray(signals.skillGapMatchedSkills).slice(0, 5),
              missingSkills: toArray(signals.skillGapMissingSkills).slice(0, 8),
              suspiciousMissingSkills: suspiciousMissingSkills.slice(0, 5),
              reason: "missingSkills 包含宽泛角色/能力词，可能不应作为强技能缺口"
            });
          }
        }
      }
    } else {
      verdictDiagnostics.skillsEmptyTop10Count += 1;
      if (signals.skillGapOverallFit === "unknown") {
        verdictDiagnostics.skillsEmptyUnknownCount += 1;
      }
    }
  });
  const top10SignalsForSourceStats = top10.map((job) => parseJobSignals(job));
  const bundledCountTop10 = top10SignalsForSourceStats.filter((item) => item.likelyBundledJD).length;
  const lowConfidenceCountTop10 = top10SignalsForSourceStats.filter((item) => item.jobConfidenceTier === "low").length;
  const sourceQualityTierDistributionTop10 = top10SignalsForSourceStats.reduce((acc, item) => {
    const key = item.jobQualityTier || "unknown";
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
  const sourceReliabilityTierDistributionTop10 = top10SignalsForSourceStats.reduce((acc, item) => {
    const key = item.sourceReliabilityTier || "unknown";
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
  const bundledBySourceReliabilityTop10 = top10SignalsForSourceStats.reduce((acc, item) => {
    if (!item.likelyBundledJD) return acc;
    const key = item.sourceReliabilityTier || "unknown";
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
  const roleFamilyDistributionTop10 = top10SignalsForSourceStats.reduce((acc, item) => {
    const key = String(item.roleFamily || "未知");
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
  const industryDistributionTop10 = top10SignalsForSourceStats.reduce((acc, item) => {
    const key = String(item.industry || "其他");
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
  const feedbackDiagnostics = top10SignalsForSourceStats.reduce(
    (acc, item) => {
      if (["applied", "rejected", "good_fit", "bad_fit", "misclassified", "shortlist"].includes(item.feedbackSignalType)) {
        acc.strongFeedbackCount += 1;
      } else if (["saved"].includes(item.feedbackSignalType) || item.feedbackConfidence === "low") {
        acc.weakFeedbackCount += 1;
      }
      if (item.feedbackConflictRisk === "high" || item.feedbackConsistency === "conflicting") {
        acc.conflictFeedbackCount += 1;
      }
      if (item.preferenceEvolutionCandidate) {
        acc.preferenceEvolutionCandidates += 1;
      }
      acc.feedbackByRoleFamily[item.roleFamily || "未知"] = Number(acc.feedbackByRoleFamily[item.roleFamily || "未知"] || 0) + (item.feedbackSignalType !== "none" ? 1 : 0);
      acc.feedbackByIndustry[item.industry || "其他"] = Number(acc.feedbackByIndustry[item.industry || "其他"] || 0) + (item.feedbackSignalType !== "none" ? 1 : 0);
      return acc;
    },
    {
      strongFeedbackCount: 0,
      weakFeedbackCount: 0,
      conflictFeedbackCount: 0,
      preferenceEvolutionCandidates: 0,
      feedbackByRoleFamily: {},
      feedbackByIndustry: {}
    }
  );
  feedbackDiagnostics.feedbackPollutionRisk =
    feedbackDiagnostics.conflictFeedbackCount >= 3
      ? "high"
      : feedbackDiagnostics.conflictFeedbackCount >= 1 || feedbackDiagnostics.weakFeedbackCount >= 4
        ? "medium"
        : "low";
  const preferenceEvolutionSummary = aggregatePreferenceEvolutionCandidates(top10SignalsForSourceStats, preference);
  const explainabilityDiagnostics = evaluateExplainabilityQuality(top10SignalsForSourceStats);
  const sourceGovernanceDiagnostics = evaluateSourceGovernanceQuality(top10SignalsForSourceStats);

  const consistencyChecks = top10.reduce(
    (acc, job) => {
      const consistency = evaluateExplanationConsistency(parseJobSignals(job));
      acc.applicable += consistency.applicable;
      acc.passed += consistency.passed;
      consistency.checks
        .filter((item) => !item.ok)
        .forEach((item) => acc.failures.push(item.type));
      return acc;
    },
    { applicable: 0, passed: 0, failures: [] }
  );
  const explanationConsistency =
    consistencyChecks.applicable > 0 ? consistencyChecks.passed / consistencyChecks.applicable : 1;

  const hardFailedReasons = [];
  const warningReasons = [];
  const knownGapReasons = [];
  const knownGapCase = isKnownGapCase(evalCase);

  const pushReason = (severity, reason) => {
    if (!reason) return;
    if (severity === "known_gap") knownGapReasons.push(reason);
    else if (severity === "warning") warningReasons.push(reason);
    else hardFailedReasons.push(reason);
  };

  if (!excludeOnlyBehavior.applicable) {
    const top5Severity = knownGapCase ? "known_gap" : "hard";
    const top10Severity = knownGapCase ? "known_gap" : "hard";
    if (Number(expected.top5MinRelevant || 0) > top5Relevant) {
      pushReason(top5Severity, `top5Relevant ${top5Relevant} < expected ${expected.top5MinRelevant}`);
    }
    if (Number(expected.top10MinRelevant || 0) > top10Relevant) {
      pushReason(top10Severity, `top10Relevant ${top10Relevant} < expected ${expected.top10MinRelevant}`);
    }
  } else {
    if (excludeOnlyBehavior.top3ExcludedHits > 0) {
      pushReason("hard", `excludedHitsInTop3 ${excludeOnlyBehavior.top3ExcludedHits}`);
    }
    if (excludeOnlyBehavior.top3StructuredExcludeHints === 0) {
      pushReason("hard", "excludeOnlyStructuredHintMissingInTop3");
    }
  }

  if (falsePositives.hard.length > 0) {
    pushReason("hard", `hardFalsePositivesInTop3 ${falsePositives.hard.length}`);
  }
  if (falsePositives.warnings.length > 0) {
    pushReason("warning", `softMustNotWarningsInTop3 ${falsePositives.warnings.length}`);
  }
  if (typeof expected.maxDuplicateRateTop10 === "number" && duplicateRate > expected.maxDuplicateRateTop10) {
    pushReason("hard", `duplicateRate ${duplicateRate.toFixed(2)} > ${expected.maxDuplicateRateTop10}`);
  }
  if (locationOverride.applicable && locationOverride.violations > 0) {
    pushReason("hard", `locationOverrideViolations ${locationOverride.violations}`);
  }
  if (explanationConsistency < 1) {
    pushReason("hard", `explanationConsistency ${explanationConsistency.toFixed(2)} < 1.00`);
  }

  return {
    id: String(evalCase.id || ""),
    description: String(evalCase.description || ""),
    coverageTags: toArray(evalCase.coverageTags),
    precisionAt5,
    precisionAt10,
    top5Relevant,
    top10Relevant,
    duplicateRate,
    falsePositives,
    perDimensionAccuracy,
    explanationConsistency,
    consistencyFailures: consistencyChecks.failures,
    locationOverride,
    excludeOnlyBehavior,
    verdictDiagnostics,
    feedbackDiagnostics,
    preferenceEvolutionSummary,
    explainabilityDiagnostics,
    sourceGovernanceDiagnostics,
    sourceStats: {
      top10Count: top10SignalsForSourceStats.length,
      bundledCountTop10,
      lowConfidenceCountTop10,
      sourceQualityTierDistributionTop10,
      sourceReliabilityTierDistributionTop10,
      bundledBySourceReliabilityTop10,
      roleFamilyDistributionTop10,
      industryDistributionTop10
    },
    hardFailedReasons,
    warningReasons,
    knownGapReasons,
    isKnownGapCase: knownGapCase,
    top5: summarizeTopJobs(top5),
    top10: summarizeTopJobs(top10),
    top10Count: top10.length
  };
}

function getOpportunityPriority(type = "") {
  const normalized = String(type || "").trim();
  if (normalized === "single_role_job") return 4;
  if (normalized === "high_value_role_pool") return 3;
  if (normalized === "broad_recruitment_entry") return 2;
  if (normalized === "low_quality_mixed_posting") return 1;
  return 0;
}

function summarizeOpportunityDistribution(items = []) {
  return toArray(items).reduce((acc, item) => {
    const key = String(item?.opportunityType || "unknown").trim() || "unknown";
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
}

function findFirstRankByOpportunityType(items = [], type = "") {
  const found = toArray(items).find((item) => String(item?.opportunityType || "") === type);
  return found ? Number(found.rank || 0) : null;
}

function getGradeRank(grade = "") {
  const normalized = String(grade || "").trim().toUpperCase();
  if (normalized === "A") return 5;
  if (normalized === "B") return 4;
  if (normalized === "C") return 3;
  if (normalized === "D") return 2;
  if (normalized === "F") return 1;
  return 0;
}

function isTrueUserValueOpportunity(item = {}) {
  const opportunityType = String(item?.opportunityType || "").trim();
  const roleEvidenceType = String(item?.roleFitEvidenceType || item?.roleEvidenceType || "").trim();
  const roleFit = Number(item?.roleFit || 0);
  const gradeRank = getGradeRank(item?.grade);
  const verdict = String(item?.verdict || "").trim().toLowerCase();
  if (opportunityType === "single_role_job") return gradeRank >= 3 && verdict !== "no_go";
  if (opportunityType !== "high_value_role_pool") return false;
  if (verdict === "no_go" || gradeRank < 3) return false;
  if (roleEvidenceType === "incidental_keyword_match" || roleEvidenceType === "conflicting_mixed_role") return false;
  return roleFit >= 55;
}

function shouldDemoteOpportunityForAcceptance(item = {}) {
  const opportunityType = String(item?.opportunityType || "").trim();
  const roleEvidenceType = String(item?.roleFitEvidenceType || item?.roleEvidenceType || "").trim();
  const gradeRank = getGradeRank(item?.grade);
  const verdict = String(item?.verdict || "").trim().toLowerCase();
  if (opportunityType === "low_quality_mixed_posting") return true;
  if (verdict === "no_go" || gradeRank < 3) return true;
  if (roleEvidenceType === "incidental_keyword_match" || roleEvidenceType === "conflicting_mixed_role") return true;
  if (opportunityType === "broad_recruitment_entry") return true;
  return false;
}

function evaluateAcceptanceCaseResult(caseResult = {}) {
  const caseId = String(caseResult.id || "").trim();
  const isTrueSingleCase = /^acceptance_true_single_/.test(caseId);
  const top10 = toArray(caseResult.top10);
  const top5 = top10.slice(0, 5);
  const top3 = top10.slice(0, 3);
  const firstTrueUserValueRank = (() => {
    const found = top10.find((item) => isTrueUserValueOpportunity(item));
    return found ? Number(found.rank || 0) : null;
  })();
  const firstShouldDemoteRank = (() => {
    const found = top10.find((item) => shouldDemoteOpportunityForAcceptance(item));
    return found ? Number(found.rank || 0) : null;
  })();
  const firstDemotingPoolRank = (() => {
    const found = top10.find((item) => item.opportunityType === "high_value_role_pool" && shouldDemoteOpportunityForAcceptance(item));
    return found ? Number(found.rank || 0) : null;
  })();
  const singleRank = findFirstRankByOpportunityType(top10, "single_role_job");
  const highValueRank = findFirstRankByOpportunityType(top10, "high_value_role_pool");
  const broadRank = findFirstRankByOpportunityType(top10, "broad_recruitment_entry");
  const mixedRank = findFirstRankByOpportunityType(top10, "low_quality_mixed_posting");
  const lowQualityInTop5 = top5.some((item) => item.opportunityType === "low_quality_mixed_posting");
  const top10HasUsableGrade = top10.some((item) => getGradeRank(item.grade) >= 3);
  const top3LowGradeBeforeUsable =
    top10HasUsableGrade && top3.some((item) => getGradeRank(item.grade) > 0 && getGradeRank(item.grade) < 3);
  const top5GradeAverage =
    top5.reduce((sum, item) => sum + getGradeRank(item.grade), 0) / Math.max(1, top5.length);
  const top5LacksUsableGrade = !top5.some((item) => getGradeRank(item.grade) >= 3);
  const gradeOrderViolation = top10.some((item, index) => {
    const currentRank = getGradeRank(item.grade);
    if (currentRank <= 0) return false;
    return top10.slice(index + 1).some((next) => getGradeRank(next.grade) > currentRank);
  });
  const radarGradeMismatch = top10.some((item) => {
    const dimensions = item.userPriorityDimensions && typeof item.userPriorityDimensions === "object" ? item.userPriorityDimensions : {};
    const values = ["role", "industry", "location", "company", "accessibility"]
      .map((key) => Number(dimensions[key]))
      .filter((value) => Number.isFinite(value));
    if (values.length < 5) return false;
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    const gradeRank = getGradeRank(item.grade);
    return (avg >= 75 && gradeRank < 3) || (gradeRank >= 4 && avg < 60);
  });
  const falseHighRank = top3.some((item) => item.opportunityType === "low_quality_mixed_posting") || (broadRank === 1 && singleRank !== null);
  const trueSinglePriority = firstTrueUserValueRank === null ? false : firstShouldDemoteRank === null || firstTrueUserValueRank < firstShouldDemoteRank;
  const poolVsSingleDisplacement =
    singleRank !== null &&
    firstDemotingPoolRank !== null &&
    firstDemotingPoolRank < singleRank;
  const broadEntryDisplacement = singleRank !== null && broadRank !== null && broadRank < singleRank;
  const orderedOpportunityTypes = top10.map((item) => item.opportunityType).filter(Boolean);
  const maxRoleFit = top10.reduce((max, item) => Math.max(max, Number(item.roleFit || 0)), 0);
  const dataPoolGapLikely =
    isTrueSingleCase
    && singleRank === null
    && highValueRank === null
    && maxRoleFit < 40;
  const orderingViolations = [];
  const diagnosticFlags = [];
  top10.forEach((item, index) => {
    if (item.opportunityType === "low_quality_mixed_posting" && index < 5) orderingViolations.push("low_quality_mixed_in_top5");
  });
  if (top3LowGradeBeforeUsable) orderingViolations.push("low_grade_in_top3_before_available_usable_grade");
  if (top5LacksUsableGrade && !dataPoolGapLikely) orderingViolations.push("top5_lacks_abc_grade");
  if (top5GradeAverage < 3 && !dataPoolGapLikely) orderingViolations.push("top5_average_grade_below_c");
  if (gradeOrderViolation) orderingViolations.push("top10_grade_not_descending");
  if (radarGradeMismatch) orderingViolations.push("five_dimension_grade_mismatch");
  // Phase 9Z 用户优先级合同：单岗/合集不再按身份天然分高低。
  // broad entry 早于 single role 继续作为观察指标，但不再单独判失败。
  if (isTrueSingleCase && singleRank === null && !dataPoolGapLikely) {
    orderingViolations.push("true_single_case_missing_single_role_in_top10");
  }
  if (isTrueSingleCase && singleRank === null && dataPoolGapLikely) {
    diagnosticFlags.push("true_single_data_pool_quality_gap");
  }
  const pass = !falseHighRank && !lowQualityInTop5 && orderingViolations.length === 0;
  return {
    pass, falseHighRank, trueSinglePriority, poolVsSingleDisplacement, broadEntryDisplacement, mixedPostingLeakage: lowQualityInTop5,
    firstTrueUserValueRank,
    firstShouldDemoteRank,
    firstDemotingPoolRank,
    top3LowGradeBeforeUsable,
    top5GradeAverage,
    top5LacksUsableGrade,
    gradeOrderViolation,
    radarGradeMismatch,
    opportunityTypeDistributionTop10: summarizeOpportunityDistribution(top10),
    orderedOpportunityTypes,
    firstRanks: { single_role_job: singleRank, high_value_role_pool: highValueRank, broad_recruitment_entry: broadRank, low_quality_mixed_posting: mixedRank },
    orderingViolations: [...new Set(orderingViolations)],
    diagnosticFlags: [...new Set(diagnosticFlags)],
    dataPoolGapLikely
  };
}

function buildAcceptanceGateReport(caseResults = []) {
  const acceptanceResults = toArray(caseResults).map((item) => ({ id: item.id, description: item.description, ...evaluateAcceptanceCaseResult(item) }));
  const total = acceptanceResults.length;
  const count = (predicate) => acceptanceResults.filter(predicate).length;
  const report = {
    cases: total,
    acceptancePassRate: total > 0 ? count((item) => item.pass) / total : 1,
    falseHighRankRate: total > 0 ? count((item) => item.falseHighRank) / total : 0,
    trueSinglePriorityRate: total > 0 ? count((item) => item.trueSinglePriority) / total : 0,
    poolVsSingleDisplacementRate: total > 0 ? count((item) => item.poolVsSingleDisplacement) / total : 0,
    mixedPostingLeakageRate: total > 0 ? count((item) => item.mixedPostingLeakage) / total : 0,
    opportunityTypeDistributionTop10: acceptanceResults.reduce((acc, item) => {
      Object.entries(item.opportunityTypeDistributionTop10 || {}).forEach(([key, value]) => { acc[key] = Number(acc[key] || 0) + Number(value || 0); });
      return acc;
    }, {}),
    blockedCases: acceptanceResults.filter((item) => !item.pass).map((item) => ({ id: item.id, firstRanks: item.firstRanks, orderingViolations: item.orderingViolations, orderedOpportunityTypes: item.orderedOpportunityTypes.slice(0, 10) }))
  };
  report.passed = report.acceptancePassRate === 1 && report.falseHighRankRate === 0 && report.mixedPostingLeakageRate === 0;
  return report;
}

function buildUserPriorityGateReport(caseResults = []) {
  const results = toArray(caseResults).map((item) => ({ id: item.id, description: item.description, ...evaluateAcceptanceCaseResult(item) }));
  const total = results.length;
  const count = (predicate) => results.filter(predicate).length;
  const top5GradeAverage =
    results.reduce((sum, item) => sum + Number(item.top5GradeAverage || 0), 0) / Math.max(1, total);
  const distribution = results.reduce((acc, item) => {
    Object.entries(item.opportunityTypeDistributionTop10 || {}).forEach(([key, value]) => {
      acc[key] = Number(acc[key] || 0) + Number(value || 0);
    });
    return acc;
  }, {});
  const blockedCases = results
    .filter((item) => !item.pass)
    .map((item) => ({
      id: item.id,
      firstRanks: item.firstRanks,
      orderingViolations: item.orderingViolations,
      diagnosticFlags: item.diagnosticFlags,
      orderedOpportunityTypes: item.orderedOpportunityTypes.slice(0, 10)
    }));
  const report = {
    cases: total,
    top5GradeQuality: top5GradeAverage,
    top10GradeDistribution: summarizeGradeDistribution(caseResults),
    falseHighRankRate: total > 0 ? count((item) => item.falseHighRank) / total : 0,
    mixedPostingLeakageRate: total > 0 ? count((item) => item.mixedPostingLeakage) / total : 0,
    userPriorityOrderingIntegrity: total > 0 ? count((item) => !item.gradeOrderViolation && !item.top3LowGradeBeforeUsable) / total : 1,
    radarGradeConsistency: total > 0 ? count((item) => !item.radarGradeMismatch) / total : 1,
    candidatePoolQualityGapRecognition: count((item) => item.dataPoolGapLikely || toArray(item.diagnosticFlags).includes("true_single_data_pool_quality_gap")),
    opportunityTypeDistributionTop10: distribution,
    blockedCases
  };
  report.passed =
    total > 0 &&
    report.falseHighRankRate === 0 &&
    report.mixedPostingLeakageRate === 0 &&
    report.userPriorityOrderingIntegrity === 1 &&
    report.radarGradeConsistency === 1 &&
    blockedCases.length === 0;
  return report;
}

function summarizeGradeDistribution(results = []) {
  return toArray(results).reduce((acc, item) => {
    const top10 = toArray(item?.top10);
    top10.forEach((row) => {
      const grade = String(row?.grade || "unknown").trim().toUpperCase() || "unknown";
      acc[grade] = Number(acc[grade] || 0) + 1;
    });
    return acc;
  }, {});
}

function printUserPriorityGateReport(report = {}) {
  console.log("## User Priority Gate（新五维用户价值合同）");
  console.log("- section: User Priority Gate");
  console.log(`- cases=${Number(report.cases || 0)}`);
  console.log(`- top5GradeQuality=${Number(report.top5GradeQuality || 0).toFixed(2)} (C=3, B=4, A=5)`);
  console.log(`- top10GradeDistribution=${JSON.stringify(report.top10GradeDistribution || {})}`);
  console.log(`- falseHighRankRate=${formatPct(report.falseHighRankRate)}`);
  console.log(`- mixedPostingLeakageRate=${formatPct(report.mixedPostingLeakageRate)}`);
  console.log(`- userPriorityOrderingIntegrity=${formatPct(report.userPriorityOrderingIntegrity)}`);
  console.log(`- radarGradeConsistency=${formatPct(report.radarGradeConsistency)}`);
  console.log(`- candidatePoolQualityGapRecognition=${Number(report.candidatePoolQualityGapRecognition || 0)}`);
  console.log(`- opportunityTypeDistributionTop10=${JSON.stringify(report.opportunityTypeDistributionTop10 || {})}`);
  console.log(`- status=${report.passed ? "PASS" : "FAIL"}`);
  if (toArray(report.blockedCases).length > 0) {
    console.log(`- blockedCases=${JSON.stringify(report.blockedCases)}`);
  }
  console.log("");
}

function printAcceptanceGateReport(report = {}) {
  console.log("## Acceptance Gate（用户真实投递优先级）");
  console.log("- section: Acceptance Gate");
  console.log(`- acceptancePassRate=${formatPct(report.acceptancePassRate)}`);
  console.log(`- falseHighRankRate=${formatPct(report.falseHighRankRate)}`);
  console.log(`- trueSinglePriorityRate=${formatPct(report.trueSinglePriorityRate)}`);
  console.log(`- poolVsSingleDisplacementRate=${formatPct(report.poolVsSingleDisplacementRate)}`);
  console.log(`- mixedPostingLeakageRate=${formatPct(report.mixedPostingLeakageRate)}`);
  console.log(`- opportunityTypeDistributionTop10=${JSON.stringify(report.opportunityTypeDistributionTop10 || {})}`);
  console.log(`- status=${report.passed ? "PASS" : "REVIEW"}`);
  if (toArray(report.blockedCases).length > 0) console.log(`- blockedCases=${JSON.stringify(report.blockedCases.slice(0, 8))}`);
  console.log("");
}
function summarizePoolSourceMetadata(jobs = []) {
  const sourceQualityTierDistribution = {};
  const sourceReliabilityTierDistribution = {};
  const sourceFreshnessTierDistribution = {};
  const sourceCompletenessTierDistribution = {};
  const sourceGovernanceTierDistribution = {};
  const sourceMaturityDistribution = {};
  const sourceVerticalStrengthDistribution = {};
  const roleHintDistribution = {};
  const industryHintDistribution = {};
  let total = 0;
  let lowConfidenceSourceCount = 0;
  let unknownSourceCount = 0;
  toArray(jobs).forEach((job) => {
    total += 1;
    const tier =
      String(job?.metadata?.sourceQualityTier || job?.importMeta?.sourceQualityTier || "unknown").trim().toLowerCase() || "unknown";
    sourceQualityTierDistribution[tier] = Number(sourceQualityTierDistribution[tier] || 0) + 1;
    const features = job?.scoringView?.jobFeaturesView || {};
    const reliabilityTier =
      String(features?.sourceReliabilityTier || inferSourceReliabilityTierFromJob(job) || "unknown").trim().toLowerCase() || "unknown";
    sourceReliabilityTierDistribution[reliabilityTier] = Number(sourceReliabilityTierDistribution[reliabilityTier] || 0) + 1;
    if (reliabilityTier === "low_confidence") lowConfidenceSourceCount += 1;
    if (reliabilityTier === "unknown") unknownSourceCount += 1;
    const freshnessTier = String(features?.sourceFreshnessTier || inferSourceFreshnessTierFromJob(job) || "unknown").trim().toLowerCase() || "unknown";
    sourceFreshnessTierDistribution[freshnessTier] = Number(sourceFreshnessTierDistribution[freshnessTier] || 0) + 1;
    const completenessTier =
      String(features?.sourceCompletenessTier || inferSourceCompletenessTierFromJob(job) || "medium").trim().toLowerCase() || "medium";
    sourceCompletenessTierDistribution[completenessTier] = Number(sourceCompletenessTierDistribution[completenessTier] || 0) + 1;
    const governanceTier = String(features?.sourceGovernanceTier || "exploratory_source").trim().toLowerCase() || "exploratory_source";
    sourceGovernanceTierDistribution[governanceTier] = Number(sourceGovernanceTierDistribution[governanceTier] || 0) + 1;
    const maturityTier = String(features?.sourceMaturityLevel || "exploratory").trim().toLowerCase() || "exploratory";
    sourceMaturityDistribution[maturityTier] = Number(sourceMaturityDistribution[maturityTier] || 0) + 1;
    const verticalStrength = String(features?.sourceVerticalStrength || "general").trim().toLowerCase() || "general";
    sourceVerticalStrengthDistribution[verticalStrength] = Number(sourceVerticalStrengthDistribution[verticalStrength] || 0) + 1;
    const roleHint = String(job?.metadata?.roleHint || "").trim() || "unknown";
    roleHintDistribution[roleHint] = Number(roleHintDistribution[roleHint] || 0) + 1;
    const industryHint = String(job?.metadata?.industryHint || job?.importMeta?.inferredIndustry || "").trim() || "unknown";
    industryHintDistribution[industryHint] = Number(industryHintDistribution[industryHint] || 0) + 1;
  });
  return {
    sourceQualityTierDistribution,
    sourceReliabilityTierDistribution,
    sourceFreshnessTierDistribution,
    sourceCompletenessTierDistribution,
    sourceGovernanceTierDistribution,
    sourceMaturityDistribution,
    sourceVerticalStrengthDistribution,
    lowConfidenceSourceRatio: total > 0 ? lowConfidenceSourceCount / total : 0,
    unknownSourceRatio: total > 0 ? unknownSourceCount / total : 0,
    roleHintDistribution,
    industryHintDistribution
  };
}

function inferSourceReliabilityTierFromJob(job = {}) {
  const metadata = job?.metadata && typeof job.metadata === "object" ? job.metadata : {};
  const sourceText = [
    job?.sourcePlatform,
    job?.sourceLabel,
    metadata?.source,
    metadata?.sourceType,
    metadata?.sourceTag,
    job?.sourceUrl,
    job?.jobUrl,
    job?.applyUrl
  ]
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (!sourceText) return "unknown";
  if (includesAny(sourceText, ["official_ats", "official ats", "campus", "校招官网", "校园招聘"])) return "official_ats";
  if (includesAny(sourceText, ["career", "careers", "jobs", "公司官网", "官网招聘"])) return "company_career_page";
  if (includesAny(sourceText, ["recruiter", "猎头", "内推", "转发", "repost"])) return "recruiter_repost";
  if (includesAny(sourceText, ["aggregator", "聚合", "抓取", "third_party", "third party"])) return "aggregator";
  if (includesKeyword(sourceText, "curated")) return "low_confidence";
  return "unknown";
}

function inferSourceFreshnessTierFromJob(job = {}) {
  const candidates = [job?.updatedAt, job?.createdAt, job?.postedAt, job?.publishTime, job?.publishAt];
  const timestamp = candidates
    .map((item) => Date.parse(String(item || "")))
    .find((value) => Number.isFinite(value));
  if (!Number.isFinite(timestamp)) return "unknown";
  const ageDays = Math.max(0, (Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  if (ageDays <= 14) return "fresh";
  if (ageDays <= 45) return "recent";
  return "stale";
}

function inferSourceCompletenessTierFromJob(job = {}) {
  const title = String(job?.title || "").trim();
  const company = String(job?.company || "").trim();
  const location = String(job?.location || "").trim();
  const description = String(job?.jdRaw || job?.description || "").trim();
  const applyUrl = String(job?.applyUrl || job?.jobUrl || "").trim();
  const fulfilled = [title, company, location, description.length >= 120 ? "description" : "", applyUrl].filter(Boolean).length;
  if (fulfilled >= 5) return "high";
  if (fulfilled >= 3) return "medium";
  return "low";
}

function mergeDimensionStats(cases = []) {
  const buckets = {
    industry: [],
    role: [],
    skill: [],
    location: [],
    company: []
  };
  cases.forEach((item) => {
    const metrics = item.perDimensionAccuracy || {};
    Object.keys(buckets).forEach((key) => {
      const value = metrics[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        buckets[key].push(value);
      }
    });
  });
  const result = {};
  Object.keys(buckets).forEach((key) => {
    const list = buckets[key];
    if (list.length === 0) result[key] = null;
    else result[key] = list.reduce((sum, value) => sum + value, 0) / list.length;
  });
  return result;
}

function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "n/a";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function printLegacyConsumerTrackingReport() {
  console.log("## Legacy Consumer Tracking (Frozen Section)");
  console.log("- section: Legacy Consumer Tracking");
  console.log(`- legacyFieldReadMap: ${JSON.stringify(legacyConsumerTracking.legacyFieldReadMap)}`);
  console.log(`- directLegacyConsumers: ${JSON.stringify(legacyConsumerTracking.directLegacyConsumers)}`);
  console.log(`- fallbackOnlyConsumers: ${JSON.stringify(legacyConsumerTracking.fallbackOnlyConsumers)}`);
  console.log(`- zeroConsumerLegacyFields: ${JSON.stringify(legacyConsumerTracking.zeroConsumerLegacyFields)}`);
  console.log(`- riskyLegacyFields: ${JSON.stringify(legacyConsumerTracking.riskyLegacyFields)}`);
  console.log("");
}

function printReport({
  seedPath = "",
  totalCases = 0,
  caseResults = [],
  hardFailedCases = [],
  warningCases = [],
  knownGapCases = [],
  overall = {},
  segmented = {},
  baseline = null,
  gate = null,
  evalEnvironmentHealth = null,
  compactOutput = false,
  userPriorityGateReport = null,
  legacyGate = null
} = {}) {
  console.log("");
  if (overall?.sourceLayerReport) {
  console.log("## Source 分层评估（diagnostic-only）");
  console.log("- 说明：curated 数据仅用于诊断/基准评估，不参与 production gate 与线上排序。");
    Object.entries(overall.sourceLayerReport).forEach(([mode, report]) => {
      if (!report) return;
      console.log(
        `- ${mode}: jobs=${report.jobCount}, p@5=${formatPct(report.precisionAt5)}, p@10=${formatPct(report.precisionAt10)}, hardFail=${report.hardFailCount}, bundledRatio(top10)=${formatPct(report.bundledRatioTop10)}, lowConfidenceRatio(top10)=${formatPct(report.lowConfidenceRatioTop10)}`
      );
      console.log(`  sourceQualityTier: ${JSON.stringify(report.sourceQualityTierDistribution || {})}`);
      console.log(`  sourceReliabilityTier: ${JSON.stringify(report.sourceReliabilityTierDistribution || {})}`);
      console.log(`  sourceFreshnessTier: ${JSON.stringify(report.sourceFreshnessTierDistribution || {})}`);
      console.log(`  sourceCompletenessTier: ${JSON.stringify(report.sourceCompletenessTierDistribution || {})}`);
      console.log(`  sourceGovernanceTier: ${JSON.stringify(report.sourceGovernanceTierDistribution || {})}`);
      console.log(`  sourceMaturityLevel: ${JSON.stringify(report.sourceMaturityDistribution || {})}`);
      console.log(`  sourceVerticalStrength: ${JSON.stringify(report.sourceVerticalStrengthDistribution || {})}`);
      console.log(`  lowConfidenceSourceRatio(pool): ${formatPct(report.lowConfidenceSourceRatio)}`);
      console.log(`  unknownSourceRatio(pool): ${formatPct(report.unknownSourceRatio)}`);
      console.log(`  sourceReliabilityTier(top10): ${JSON.stringify(report.sourceReliabilityTierDistributionTop10 || {})}`);
      console.log(`  bundledBySourceReliability(top10): ${JSON.stringify(report.bundledBySourceReliabilityTop10 || {})}`);
      console.log(`  roleFamily(top10): ${JSON.stringify(report.roleFamilyDistributionTop10 || {})}`);
      console.log(`  industry(top10): ${JSON.stringify(report.industryDistributionTop10 || {})}`);
    });
    console.log("");
  }
  console.log("==== Job Preference Eval Report ====");
  console.log("## Eval Governance Template (Frozen)");
  console.log("- sections: Gate | Full | Diagnostic | Source Governance | Explainability | Promotion Governance | Acceptance Gate");
  console.log("- policy: ???????????????? governance review?????????");
  console.log(`Seed: ${seedPath}`);
  console.log(`Cases: ${totalCases}`);
  console.log("");
  console.log("## 验收主口径（固定并排）");
  const gateP5 = segmented?.gate?.cases ? formatPct(segmented.gate.precisionAt5) : "n/a";
  const gateP10 = segmented?.gate?.cases ? formatPct(segmented.gate.precisionAt10) : "n/a";
  const fullP5 = segmented?.full44?.cases ? formatPct(segmented.full44.precisionAt5) : "n/a";
  const fullP10 = segmented?.full44?.cases ? formatPct(segmented.full44.precisionAt10) : "n/a";
  console.log(`- Gate Precision(core22/gate): p@5=${gateP5}, p@10=${gateP10}`);
  console.log(`- Full Precision(full44): p@5=${fullP5}, p@10=${fullP10}`);
  console.log("");
  console.log("## 总体指标");
  console.log(`- precision@5: ${formatPct(overall.precisionAt5)}`);
  console.log(`- precision@10: ${formatPct(overall.precisionAt10)}`);
  console.log(`- duplicate rate(top10): ${formatPct(overall.duplicateRate)}`);
  console.log(`- explanation consistency: ${formatPct(overall.explanationConsistency)}`);
  console.log(`- diagnostic per-dimension accuracy: industry=${formatPct(overall.perDimension?.industry)}, role=${formatPct(overall.perDimension?.role)}, skill=${formatPct(overall.perDimension?.skill)}, location=${formatPct(overall.perDimension?.location)}, company=${formatPct(overall.perDimension?.company)}`);
  console.log("");

  console.log("## 分轨指标");
  const segRows = [
    ["core22", segmented.core22],
    ["gate", segmented.gate],
    ["full44", segmented.full44],
    ["diagnostic", segmented.diagnostic]
  ];
  segRows.forEach(([name, stat]) => {
    if (!stat || stat.cases === 0) {
      console.log(`- ${name}: n/a`);
      return;
    }
    console.log(
      `- ${name}: cases=${stat.cases}, p@5=${formatPct(stat.precisionAt5)}, p@10=${formatPct(stat.precisionAt10)}, dup=${formatPct(stat.duplicateRate)}, consistency=${formatPct(stat.explanationConsistency)}, hardFail=${stat.hardFailCount}`
    );
  });
  console.log("");

  console.log("## Baseline vs Current");
  if (!baseline || !hasValidBaselineSnapshot(baseline)) {
    console.log("- baseline: 未配置（可运行 `npm run eval:job-preference-ranking:baseline` 生成）");
  } else {
    console.log(`- baseline precision@5: ${formatPct(baseline.precisionAt5)} | current: ${formatPct(overall.precisionAt5)} | delta: ${formatDelta(overall.precisionAt5, baseline.precisionAt5)}`);
    console.log(`- baseline precision@10: ${formatPct(baseline.precisionAt10)} | current: ${formatPct(overall.precisionAt10)} | delta: ${formatDelta(overall.precisionAt10, baseline.precisionAt10)}`);
    console.log(`- baseline duplicate rate: ${formatPct(baseline.duplicateRate)} | current: ${formatPct(overall.duplicateRate)} | delta: ${formatDelta(overall.duplicateRate, baseline.duplicateRate)}`);
    console.log(`- baseline explanation consistency: ${formatPct(baseline.explanationConsistency)} | current: ${formatPct(overall.explanationConsistency)} | delta: ${formatDelta(overall.explanationConsistency, baseline.explanationConsistency)}`);
    console.log(`- baseline hard fail: ${Number(baseline.hardFailCount || 0)} | current: ${Number(overall.hardFailCount || 0)}`);
    console.log(`- baseline warnings: ${Number(baseline.warningCount || 0)} | current: ${Number(overall.warningCount || 0)}`);
    console.log(`- baseline known gaps: ${Number(baseline.knownGapCount || 0)} | current: ${Number(overall.knownGapCount || 0)}`);
  }
  console.log("");

  console.log("## Regression Gate（新 userPriorityScore 合同）");
  if (!gate) {
    console.log("- 状态: SKIP（未配置 baseline gate）");
  } else {
    console.log(`- 状态: ${gate.passed ? "PASS" : "FAIL"}`);
    if (gate.reasons.length === 0) {
      console.log("- blocker severity: none");
    } else {
      gate.reasons.forEach((reason) => console.log(`- ${reason}`));
      console.log(`- blocker severity: ${gate.blockerSeverity}`);
    }
  }
  console.log("");
  if (userPriorityGateReport) {
    printUserPriorityGateReport(userPriorityGateReport);
  }
  if (legacyGate) {
    console.log("## Legacy Label Gate Reference（旧标签口径，仅参考）");
    console.log(`- status=${legacyGate.passed ? "PASS" : "FAIL"}`);
    if (toArray(legacyGate.reasons).length > 0) {
      legacyGate.reasons.forEach((reason) => console.log(`- ${reason}`));
    } else {
      console.log("- blocker severity: none");
    }
    console.log("");
  }
  console.log("## Eval 环境卫生");
  if (!evalEnvironmentHealth) {
    console.log("- n/a");
  } else {
    console.log(`- total jobs: ${Number(evalEnvironmentHealth.totalJobs || 0)}`);
    console.log(`- feedbackState != none count: ${Number(evalEnvironmentHealth.feedbackStateNonNoneCount || 0)}`);
    console.log(`- trackerState != none count: ${Number(evalEnvironmentHealth.trackerStateNonNoneCount || 0)}`);
    console.log(`- feedback influence disabled in eval: ${evalEnvironmentHealth.feedbackInfluenceDisabledInEval ? "yes" : "no"}`);
    if (
      Number(evalEnvironmentHealth.feedbackStateNonNoneCount || 0) > 0 ||
      Number(evalEnvironmentHealth.trackerStateNonNoneCount || 0) > 0
    ) {
      console.log("- Eval running with feedback influence disabled");
    }
  }
  console.log("");

  if (compactOutput) {
    console.log("## 每个 Case 明细");
    console.log("- 已启用 --compact-output，跳过 Top5 展开明细（仅保留关键指标与失败项）。");
    console.log("");
  } else {
    console.log("## 每个 Case Top5");
    caseResults.forEach((item) => {
      const statusParts = [];
      if (item.hardFailedReasons.length > 0) statusParts.push("hard-fail");
      else if (item.knownGapReasons.length > 0) statusParts.push("known-gap");
      else if (item.warningReasons.length > 0) statusParts.push("warning");
      else statusParts.push("pass");
      console.log(`- [${item.id}] ${statusParts.join("/")} p@5=${formatPct(item.precisionAt5)} p@10=${formatPct(item.precisionAt10)} dup=${formatPct(item.duplicateRate)} consistency=${formatPct(item.explanationConsistency)}`);
      item.top5.forEach((row) => {
        console.log(`  ${row.rank}. (${row.score}) ${row.title} | ${row.company} | ${row.industry}/${row.role}`);
      });
    });
    console.log("");
  }

  const legacyLabelPrefix = userPriorityGateReport ? "Legacy Label " : "";
  console.log(`## ${legacyLabelPrefix}Hard Failed Cases${userPriorityGateReport ? "（旧标签口径，仅参考）" : ""}`);
  if (hardFailedCases.length === 0) {
    console.log("- 无");
  } else {
    hardFailedCases.forEach((item) => {
      console.log(`- ${item.id}: ${item.hardFailedReasons.join("; ")}`);
    });
  }
  console.log("");

  console.log(`## ${legacyLabelPrefix}Warnings${userPriorityGateReport ? "（旧标签口径，仅参考）" : ""}`);
  if (warningCases.length === 0) {
    console.log("- 无");
  } else {
    warningCases.forEach((item) => {
      console.log(`- ${item.id}: ${item.warningReasons.join("; ")}`);
    });
  }
  console.log("");

  console.log(`## ${legacyLabelPrefix}Known Gaps / Stretch Targets${userPriorityGateReport ? "（旧标签口径，仅参考）" : ""}`);
  if (knownGapCases.length === 0) {
    console.log("- 无");
  } else {
    knownGapCases.forEach((item) => {
      console.log(`- ${item.id}: ${item.knownGapReasons.join("; ")}`);
    });
  }
  console.log("");

  if (!compactOutput) {
    console.log("## False Positive Examples");
    const examples = caseResults.flatMap((item) => {
      return [
        ...toArray(item.falsePositives?.hard).map((example) => ({ caseId: item.id, severity: "hard", ...example })),
        ...toArray(item.falsePositives?.warnings).map((example) => ({ caseId: item.id, severity: "warning", ...example }))
      ];
    });
    if (examples.length === 0) {
      console.log("- 无");
    } else {
      examples.slice(0, 20).forEach((example) => {
        console.log(`- [${example.caseId}] (${example.severity}) rank${example.rank} ${example.reason}: ${example.title} | ${example.company}`);
      });
    }
    console.log("");
  }

  console.log("## 下一轮建议");
  if (userPriorityGateReport?.passed) {
    console.log("- 新 userPriorityScore gate 已通过；旧标签 hard fail 仅作为 reference，不建议因此继续调生产排序。");
    console.log("- 若要继续治理，应优先补充数据池质量与重标旧 diagnostic expected，而不是回退五维排序合同。");
  } else if (hardFailedCases.length === 0) {
    console.log("- 当前小样本可作为 baseline，建议扩充到更高频岗位并增加人工标注对照。");
  } else {
    console.log("- 先处理 hard failed cases，再决定是否需要动生产 classifier/scoring。");
  }
  if (warningCases.length > 0) {
    console.log("- warning 类 case 说明 eval 口径或样本语义仍偏硬，可继续收敛 mustNot 规则。");
  }
  if (knownGapCases.length > 0) {
    console.log("- companyTypes 当前更适合作为 known gap / stretch target，先观察趋势，不作为当前硬门禁。");
  }
  if (hardFailedCases.length > 0 || warningCases.length > 0 || knownGapCases.length > 0) {
    console.log("- explanation consistency 若低于 100%，优先修复文案与分数不一致项。");
    console.log("- duplicate rate 偏高的 case 建议增加去重特征（公司、标题、URL 归一化）评估。");
  }
  console.log("");
  console.log("## Verdict Consistency（诊断项）");
  const verdictSummary = caseResults.reduce(
    (acc, item) => {
      const diag = item.verdictDiagnostics || {};
      acc.noGoInTop3RelevantCount += Number(diag.noGoInTop3RelevantCount || 0);
      acc.excludedDominantNotNoGoCount += Number(diag.excludedDominantNotNoGoCount || 0);
      acc.skillsEmptyNoGoCount += Number(diag.skillsEmptyNoGoCount || 0);
      acc.mixedSecondaryNoGoCount += Number(diag.mixedSecondaryNoGoCount || 0);
      acc.locationOnlyNoGoCount += Number(diag.locationOnlyNoGoCount || 0);
      acc.skillsProvidedButNoExtractionCount += Number(diag.skillsProvidedButNoExtractionCount || 0);
      acc.skillsProvidedTop10Count += Number(diag.skillsProvidedTop10Count || 0);
      acc.skillsEmptyUnknownCount += Number(diag.skillsEmptyUnknownCount || 0);
      acc.skillsEmptyTop10Count += Number(diag.skillsEmptyTop10Count || 0);
      acc.partialMatchWithMissingCount += Number(diag.partialMatchWithMissingCount || 0);
      acc.falseMissingSkillWarningsCount += Number(diag.falseMissingSkillWarningsCount || 0);
      const samples = toArray(diag.falseMissingSkillWarningSamples);
      if (samples.length > 0 && acc.falseMissingSkillWarningSamples.length < 10) {
        const needed = 10 - acc.falseMissingSkillWarningSamples.length;
        acc.falseMissingSkillWarningSamples.push(...samples.slice(0, needed));
      }
      return acc;
    },
    {
      noGoInTop3RelevantCount: 0,
      excludedDominantNotNoGoCount: 0,
      skillsEmptyNoGoCount: 0,
      mixedSecondaryNoGoCount: 0,
      locationOnlyNoGoCount: 0,
      skillsProvidedButNoExtractionCount: 0,
      skillsProvidedTop10Count: 0,
      skillsEmptyUnknownCount: 0,
      skillsEmptyTop10Count: 0,
      partialMatchWithMissingCount: 0,
      falseMissingSkillWarningsCount: 0,
      falseMissingSkillWarningSamples: []
    }
  );
  const skillsProvidedButNoExtractionRate =
    verdictSummary.skillsProvidedTop10Count > 0
      ? verdictSummary.skillsProvidedButNoExtractionCount / verdictSummary.skillsProvidedTop10Count
      : 0;
  const skillsEmptyUnknownRate =
    verdictSummary.skillsEmptyTop10Count > 0
      ? verdictSummary.skillsEmptyUnknownCount / verdictSummary.skillsEmptyTop10Count
      : 0;
  console.log(`- no_go 出现在明显相关 Top3（诊断计数）: ${verdictSummary.noGoInTop3RelevantCount}`);
  console.log(`- 主语义命中排除岗位但未 no_go（诊断计数）: ${verdictSummary.excludedDominantNotNoGoCount}`);
  console.log(`- skills 为空导致 no_go（诊断计数）: ${verdictSummary.skillsEmptyNoGoCount}`);
  console.log(`- 混合标题附带排除词导致 no_go（诊断计数）: ${verdictSummary.mixedSecondaryNoGoCount}`);
  console.log(`- 仅地点冲突导致 no_go（诊断计数）: ${verdictSummary.locationOnlyNoGoCount}`);
  console.log(`- skillsProvidedButNoExtractionRate（诊断）: ${formatPct(skillsProvidedButNoExtractionRate)}`);
  console.log(`- skillsEmptyUnknownRate（诊断）: ${formatPct(skillsEmptyUnknownRate)}`);
  console.log(`- partialMatchWithMissingCount（诊断计数）: ${verdictSummary.partialMatchWithMissingCount}`);
  console.log(`- falseMissingSkillWarnings（诊断计数）: ${verdictSummary.falseMissingSkillWarningsCount}`);
  if (verdictSummary.falseMissingSkillWarningSamples.length > 0) {
    console.log("- falseMissingSkillWarnings samples（前10）:");
    verdictSummary.falseMissingSkillWarningSamples.forEach((item, index) => {
      const matched = toArray(item.matchedSkills).join(", ") || "—";
      const missing = toArray(item.missingSkills).join(", ") || "—";
      const suspicious = toArray(item.suspiciousMissingSkills).join(", ") || "—";
      console.log(
        `  ${index + 1}. [${item.caseId || "unknown"}] ${item.title || "未知岗位"} | matched=[${matched}] | missing=[${missing}] | suspicious=[${suspicious}] | reason=${item.reason || "n/a"}`
      );
    });
  }
  console.log("");
  console.log("## Feedback Evolution（诊断项）");
  const feedbackSummary = caseResults.reduce(
    (acc, item) => {
      const diag = item.feedbackDiagnostics || {};
      acc.strongFeedbackCount += Number(diag.strongFeedbackCount || 0);
      acc.weakFeedbackCount += Number(diag.weakFeedbackCount || 0);
      acc.conflictFeedbackCount += Number(diag.conflictFeedbackCount || 0);
      acc.preferenceEvolutionCandidates += Number(diag.preferenceEvolutionCandidates || 0);
      toArray(Object.keys(diag.feedbackByRoleFamily || {})).forEach((key) => {
        acc.feedbackByRoleFamily[key] = Number(acc.feedbackByRoleFamily[key] || 0) + Number(diag.feedbackByRoleFamily[key] || 0);
      });
      toArray(Object.keys(diag.feedbackByIndustry || {})).forEach((key) => {
        acc.feedbackByIndustry[key] = Number(acc.feedbackByIndustry[key] || 0) + Number(diag.feedbackByIndustry[key] || 0);
      });
      return acc;
    },
    {
      strongFeedbackCount: 0,
      weakFeedbackCount: 0,
      conflictFeedbackCount: 0,
      preferenceEvolutionCandidates: 0,
      feedbackByRoleFamily: {},
      feedbackByIndustry: {}
    }
  );
  const feedbackPollutionRisk =
    feedbackSummary.conflictFeedbackCount >= 8
      ? "high"
      : feedbackSummary.conflictFeedbackCount >= 3 || feedbackSummary.weakFeedbackCount >= 8
        ? "medium"
        : "low";
  console.log(`- strongFeedbackCount: ${feedbackSummary.strongFeedbackCount}`);
  console.log(`- weakFeedbackCount: ${feedbackSummary.weakFeedbackCount}`);
  console.log(`- conflictFeedbackCount: ${feedbackSummary.conflictFeedbackCount}`);
  console.log(`- preferenceEvolutionCandidates: ${feedbackSummary.preferenceEvolutionCandidates}`);
  console.log(`- feedbackPollutionRisk: ${feedbackPollutionRisk}`);
  console.log(`- feedbackByRoleFamily: ${JSON.stringify(feedbackSummary.feedbackByRoleFamily)}`);
  console.log(`- feedbackByIndustry: ${JSON.stringify(feedbackSummary.feedbackByIndustry)}`);
  console.log("");
  console.log("## Preference Evolution Review（诊断项）");
  const evolutionSummary = caseResults.reduce(
    (acc, item) => {
      const summary = item.preferenceEvolutionSummary || {};
      if (summary.preferenceEvolutionReviewNeeded) {
        acc.evolutionCandidateCount += 1;
      }
      acc.roleExpansionCandidates += toArray(summary.repeatedRoleSignal).length;
      acc.industryExpansionCandidates += toArray(summary.repeatedIndustrySignal).length;
      acc.locationFlexibilityCandidates += toArray(summary.repeatedLocationSignal).length;
      acc.companyTypeShiftCandidates += toArray(summary.repeatedCompanyTypeSignal).length;
      acc.exclusionConflictCandidates += toArray(summary.repeatedExclusionSignal).length;
      const driftKey = String(summary.preferenceDriftRisk || "low");
      acc.preferenceDriftRiskDistribution[driftKey] = Number(acc.preferenceDriftRiskDistribution[driftKey] || 0) + 1;
      return acc;
    },
    {
      evolutionCandidateCount: 0,
      roleExpansionCandidates: 0,
      industryExpansionCandidates: 0,
      locationFlexibilityCandidates: 0,
      companyTypeShiftCandidates: 0,
      exclusionConflictCandidates: 0,
      preferenceDriftRiskDistribution: {}
    }
  );
  console.log(`- evolutionCandidateCount: ${evolutionSummary.evolutionCandidateCount}`);
  console.log(`- roleExpansionCandidates: ${evolutionSummary.roleExpansionCandidates}`);
  console.log(`- industryExpansionCandidates: ${evolutionSummary.industryExpansionCandidates}`);
  console.log(`- locationFlexibilityCandidates: ${evolutionSummary.locationFlexibilityCandidates}`);
  console.log(`- companyTypeShiftCandidates: ${evolutionSummary.companyTypeShiftCandidates}`);
  console.log(`- exclusionConflictCandidates: ${evolutionSummary.exclusionConflictCandidates}`);
  console.log(`- preferenceDriftRiskDistribution: ${JSON.stringify(evolutionSummary.preferenceDriftRiskDistribution)}`);
  console.log("");
  console.log("## Explainability Quality（诊断项）");
  const explainabilitySummary = caseResults.reduce(
    (acc, item) => {
      const diag = item.explainabilityDiagnostics || {};
      acc.explainabilityContractCoverage += Number(diag.explainabilityContractCoverage || 0);
      acc.recommendationReasonCoverage += Number(diag.recommendationReasonCoverage || 0);
      acc.blockerReasonCoverage += Number(diag.blockerReasonCoverage || 0);
      acc.reviewReasonCoverage += Number(diag.reviewReasonCoverage || 0);
      acc.sourceRiskCoverage += Number(diag.sourceRiskCoverage || 0);
      acc.driftReasonCoverage += Number(diag.driftReasonCoverage || 0);
      acc.structuredExplanationConsistency += Number(diag.structuredExplanationConsistency || 0);
      acc.bundledRiskReviewRate += Number(diag.bundledRiskReviewRate || 0);
      acc.sourceRiskReviewRate += Number(diag.sourceRiskReviewRate || 0);
      acc.driftReviewRate += Number(diag.driftReviewRate || 0);
      acc.blockerExplainabilityCoverage += Number(diag.blockerExplainabilityCoverage || 0);
      acc.recommendationSummaryQuality += Number(diag.recommendationSummaryQuality || 0);
      acc.count += 1;
      return acc;
    },
    {
      explainabilityContractCoverage: 0,
      recommendationReasonCoverage: 0,
      blockerReasonCoverage: 0,
      reviewReasonCoverage: 0,
      sourceRiskCoverage: 0,
      driftReasonCoverage: 0,
      structuredExplanationConsistency: 0,
      bundledRiskReviewRate: 0,
      sourceRiskReviewRate: 0,
      driftReviewRate: 0,
      blockerExplainabilityCoverage: 0,
      recommendationSummaryQuality: 0,
      count: 0
    }
  );
  const explainabilityDivisor = Math.max(1, explainabilitySummary.count);
  console.log(`- explainabilityContractCoverage: ${formatPct(explainabilitySummary.explainabilityContractCoverage / explainabilityDivisor)}`);
  console.log(`- recommendationReasonCoverage: ${formatPct(explainabilitySummary.recommendationReasonCoverage / explainabilityDivisor)}`);
  console.log(`- blockerReasonCoverage: ${formatPct(explainabilitySummary.blockerReasonCoverage / explainabilityDivisor)}`);
  console.log(`- reviewReasonCoverage: ${formatPct(explainabilitySummary.reviewReasonCoverage / explainabilityDivisor)}`);
  console.log(`- sourceRiskCoverage: ${formatPct(explainabilitySummary.sourceRiskCoverage / explainabilityDivisor)}`);
  console.log(`- driftReasonCoverage: ${formatPct(explainabilitySummary.driftReasonCoverage / explainabilityDivisor)}`);
  console.log(`- structuredExplanationConsistency: ${formatPct(explainabilitySummary.structuredExplanationConsistency / explainabilityDivisor)}`);
  console.log(`- bundledRiskReviewRate: ${formatPct(explainabilitySummary.bundledRiskReviewRate / explainabilityDivisor)}`);
  console.log(`- sourceRiskReviewRate: ${formatPct(explainabilitySummary.sourceRiskReviewRate / explainabilityDivisor)}`);
  console.log(`- driftReviewRate: ${formatPct(explainabilitySummary.driftReviewRate / explainabilityDivisor)}`);
  console.log(`- blockerExplainabilityCoverage: ${formatPct(explainabilitySummary.blockerExplainabilityCoverage / explainabilityDivisor)}`);
  console.log(`- recommendationSummaryQuality: ${formatPct(explainabilitySummary.recommendationSummaryQuality / explainabilityDivisor)}`);
  console.log("");
  console.log("## Source Governance（诊断项）");
  const sourceGovernanceSummary = caseResults.reduce(
    (acc, item) => {
      const diag = item.sourceGovernanceDiagnostics || {};
      acc.sourceGovernanceCoverage += Number(diag.sourceGovernanceCoverage || 0);
      acc.sourceVerticalStrengthCoverage += Number(diag.sourceVerticalStrengthCoverage || 0);
      acc.productionEligibleSourceRatio += Number(diag.productionEligibleSourceRatio || 0);
      acc.sourceFraudRiskRate += Number(diag.sourceFraudRiskRate || 0);
      acc.sourceDecayRiskRate += Number(diag.sourceDecayRiskRate || 0);
      acc.sourcePromotionCandidates += Number(diag.sourcePromotionCandidates || 0);
      acc.blockedSources += Number(diag.blockedSources || 0);
      Object.keys(diag.sourceMaturityDistribution || {}).forEach((key) => {
        acc.sourceMaturityDistribution[key] = Number(acc.sourceMaturityDistribution[key] || 0) + Number(diag.sourceMaturityDistribution[key] || 0);
      });
      acc.count += 1;
      return acc;
    },
    {
      sourceGovernanceCoverage: 0,
      sourceMaturityDistribution: {},
      sourceVerticalStrengthCoverage: 0,
      productionEligibleSourceRatio: 0,
      sourceFraudRiskRate: 0,
      sourceDecayRiskRate: 0,
      sourcePromotionCandidates: 0,
      blockedSources: 0,
      count: 0
    }
  );
  const governanceDivisor = Math.max(1, sourceGovernanceSummary.count);
  console.log(`- sourceGovernanceCoverage: ${formatPct(sourceGovernanceSummary.sourceGovernanceCoverage / governanceDivisor)}`);
  console.log(`- sourceMaturityDistribution: ${JSON.stringify(sourceGovernanceSummary.sourceMaturityDistribution)}`);
  console.log(`- sourceVerticalStrengthCoverage: ${formatPct(sourceGovernanceSummary.sourceVerticalStrengthCoverage / governanceDivisor)}`);
  console.log(`- productionEligibleSourceRatio: ${formatPct(sourceGovernanceSummary.productionEligibleSourceRatio / governanceDivisor)}`);
  console.log(`- sourceFraudRiskRate: ${formatPct(sourceGovernanceSummary.sourceFraudRiskRate / governanceDivisor)}`);
  console.log(`- sourceDecayRiskRate: ${formatPct(sourceGovernanceSummary.sourceDecayRiskRate / governanceDivisor)}`);
  console.log(`- sourcePromotionCandidates: ${sourceGovernanceSummary.sourcePromotionCandidates}`);
  console.log(`- blockedSources: ${sourceGovernanceSummary.blockedSources}`);
  console.log("");
  printLegacyConsumerTrackingReport();
  printPromotionGovernanceReport(caseResults);
}

function printGateOnlyReport({
  seedPath = "",
  totalCases = 0,
  caseResults = [],
  segmented = {},
  gate = null,
  baseline = null,
  acceptanceReport = null,
  userPriorityGateReport = null,
  legacyGate = null
} = {}) {
  console.log("");
  console.log("==== Job Preference Eval Gate Report ====");
  console.log(`Seed: ${seedPath}`);
  console.log(`Cases: ${totalCases}`);
  console.log("");
  console.log("## Gate (Frozen Section)");
  console.log("- section: Gate");
  console.log("## Gate Precision");
  console.log(`- p@5=${segmented?.gate?.cases ? formatPct(segmented.gate.precisionAt5) : "n/a"}`);
  console.log(`- p@10=${segmented?.gate?.cases ? formatPct(segmented.gate.precisionAt10) : "n/a"}`);
  console.log(`- hardFail=${Number(segmented?.gate?.hardFailCount || 0)}`);
  console.log("");
  const driftCases = toArray(caseResults)
    .filter((item) => item.precisionAt5 < 1 || item.precisionAt10 < 1 || toArray(item.hardFailedReasons).length > 0)
    .map((item) => ({
      id: item.id,
      p5: formatPct(item.precisionAt5),
      p10: formatPct(item.precisionAt10),
      top5: toArray(item.top5).map((row) => `${row.rank}:${row.grade || "-"}:${row.userPriorityScore || row.score}:${row.industry}/${row.role}`)
    }));
  if (driftCases.length > 0) {
    console.log("## Gate Case Drift（诊断）");
    driftCases.forEach((item) => {
      console.log(`- ${item.id}: p@5=${item.p5}, p@10=${item.p10}, top5=${JSON.stringify(item.top5)}`);
    });
    console.log("");
  }
  if (segmented?.gate?.cases && baseline && hasValidBaselineSnapshot(baseline)) {
    console.log("## Baseline vs Gate");
    console.log(`- baseline p@5=${formatPct(baseline.precisionAt5)} | current=${formatPct(segmented?.gate?.precisionAt5)}`);
    console.log(`- baseline p@10=${formatPct(baseline.precisionAt10)} | current=${formatPct(segmented?.gate?.precisionAt10)}`);
    console.log("");
  }
  console.log("## Regression Gate");
  console.log(`- 状态: ${gate?.passed ? "PASS" : "FAIL"}`);
  if (gate?.reasons?.length) {
    gate.reasons.forEach((reason) => console.log(`- ${reason}`));
  } else {
    console.log("- blocker severity: none");
  }
  console.log("");
  if (acceptanceReport) {
    printAcceptanceGateReport(acceptanceReport);
  }
  if (userPriorityGateReport) {
    printUserPriorityGateReport(userPriorityGateReport);
  }
  if (legacyGate) {
    console.log("## Legacy Label Gate Reference（旧标签口径，仅参考）");
    console.log(`- status=${legacyGate.passed ? "PASS" : "FAIL"}`);
    if (toArray(legacyGate.reasons).length > 0) {
      legacyGate.reasons.forEach((reason) => console.log(`- ${reason}`));
    } else {
      console.log("- blocker severity: none");
    }
    console.log("");
  }
  printLegacyConsumerTrackingReport();
}

function selectCasesByMode(cases = [], mode = "full") {
  if (mode === "gate") {
    return cases.filter((evalCase) => String(evalCase?.acceptanceGateTier || "") === "acceptance_gate");
  }
  if (mode === "legacy-gate") {
    return cases.filter((evalCase) => String(evalCase?.coreSet || "") === "core22" || String(evalCase?.evalTier || "") === "gate");
  }
  if (mode === "diagnostic") {
    return cases.filter((evalCase) => ["diagnostic", "placeholder"].includes(String(evalCase?.evalTier || "")));
  }
  if (mode === "acceptance") {
    return cases.filter((evalCase) => String(evalCase?.acceptanceGateTier || "") === "acceptance_gate");
  }
  return cases;
}

function buildSourceReportFromPools({ productionJobs = [], curatedJobs = [], mixedJobs = [] } = {}) {
  const summarize = (jobs = [], mode = "") => {
    const meta = summarizePoolSourceMetadata(jobs);
    return {
      mode,
      jobCount: jobs.length,
      sourceQualityTierDistribution: meta.sourceQualityTierDistribution,
      sourceReliabilityTierDistribution: meta.sourceReliabilityTierDistribution,
      sourceFreshnessTierDistribution: meta.sourceFreshnessTierDistribution,
      sourceCompletenessTierDistribution: meta.sourceCompletenessTierDistribution,
      sourceGovernanceTierDistribution: meta.sourceGovernanceTierDistribution,
      sourceMaturityDistribution: meta.sourceMaturityDistribution,
      sourceVerticalStrengthDistribution: meta.sourceVerticalStrengthDistribution,
      lowConfidenceSourceRatio: meta.lowConfidenceSourceRatio,
      unknownSourceRatio: meta.unknownSourceRatio
    };
  };
  return {
    production_only: summarize(productionJobs, "production_only"),
    curated_only: summarize(curatedJobs, "curated_only"),
    production_plus_curated: summarize(mixedJobs, "production_plus_curated")
  };
}

function printSourceReportOnly(report = {}) {
  console.log("");
  console.log("==== Job Preference Source Report ====");
  console.log("- 说明：source-report 只输出来源分层，不执行完整排名评估。");
  Object.entries(report).forEach(([mode, item]) => {
    console.log(`- ${mode}: jobs=${Number(item?.jobCount || 0)}`);
    console.log(`  sourceQualityTier: ${JSON.stringify(item?.sourceQualityTierDistribution || {})}`);
    console.log(`  sourceReliabilityTier: ${JSON.stringify(item?.sourceReliabilityTierDistribution || {})}`);
    console.log(`  sourceFreshnessTier: ${JSON.stringify(item?.sourceFreshnessTierDistribution || {})}`);
    console.log(`  sourceCompletenessTier: ${JSON.stringify(item?.sourceCompletenessTierDistribution || {})}`);
    console.log(`  sourceGovernanceTier: ${JSON.stringify(item?.sourceGovernanceTierDistribution || {})}`);
    console.log(`  sourceMaturityLevel: ${JSON.stringify(item?.sourceMaturityDistribution || {})}`);
    console.log(`  sourceVerticalStrength: ${JSON.stringify(item?.sourceVerticalStrengthDistribution || {})}`);
    console.log(`  lowConfidenceSourceRatio(pool): ${formatPct(item?.lowConfidenceSourceRatio)}`);
    console.log(`  unknownSourceRatio(pool): ${formatPct(item?.unknownSourceRatio)}`);
  });
  console.log("");
}

async function main() {
  const { seedPath, curatedPoolPath, topK, updateBaseline, mode, compactOutput } = parseArgs(process.argv.slice(2));
  const { seed, cases } = readSeed(seedPath);
  const evalEnvironmentHealth = buildEvalEnvironmentHealth();
  const productionJobs = toArray(store.listJobs());
  const curatedJobs = buildCuratedJobDrafts(curatedPoolPath);
  const mixedJobs = [...productionJobs, ...curatedJobs];
  const sourceReportOnly = buildSourceReportFromPools({ productionJobs, curatedJobs, mixedJobs });

  if (mode === "source-report") {
    printSourceReportOnly(sourceReportOnly);
    return;
  }

  const selectedCases = selectCasesByMode(cases, mode);

  async function runMode(mode = "production_only", poolJobs = []) {
    const caseResults = [];
    for (const evalCase of selectedCases) {
      const result = await evaluateCase(evalCase, topK, poolJobs);
      caseResults.push(result);
    }
    const hardFailCount = caseResults.filter((item) => toArray(item.hardFailedReasons).length > 0).length;
    const precisionAt5 = caseResults.reduce((sum, item) => sum + item.precisionAt5, 0) / Math.max(1, caseResults.length);
    const precisionAt10 = caseResults.reduce((sum, item) => sum + item.precisionAt10, 0) / Math.max(1, caseResults.length);
    const bundledCount = caseResults.reduce((sum, item) => sum + Number(item?.sourceStats?.bundledCountTop10 || 0), 0);
    const lowConfidenceCount = caseResults.reduce((sum, item) => sum + Number(item?.sourceStats?.lowConfidenceCountTop10 || 0), 0);
    const totalTop10 = caseResults.reduce((sum, item) => sum + Number(item?.sourceStats?.top10Count || 0), 0);
    const roleFamilyDistributionTop10 = caseResults.reduce((acc, item) => {
      const dist = item?.sourceStats?.roleFamilyDistributionTop10 || {};
      Object.entries(dist).forEach(([key, value]) => {
        acc[key] = Number(acc[key] || 0) + Number(value || 0);
      });
      return acc;
    }, {});
    const industryDistributionTop10 = caseResults.reduce((acc, item) => {
      const dist = item?.sourceStats?.industryDistributionTop10 || {};
      Object.entries(dist).forEach(([key, value]) => {
        acc[key] = Number(acc[key] || 0) + Number(value || 0);
      });
      return acc;
    }, {});
    const sourceQualityTierDistributionTop10 = caseResults.reduce((acc, item) => {
      const dist = item?.sourceStats?.sourceQualityTierDistributionTop10 || {};
      Object.entries(dist).forEach(([key, value]) => {
        acc[key] = Number(acc[key] || 0) + Number(value || 0);
      });
      return acc;
    }, {});
    const sourceReliabilityTierDistributionTop10 = caseResults.reduce((acc, item) => {
      const dist = item?.sourceStats?.sourceReliabilityTierDistributionTop10 || {};
      Object.entries(dist).forEach(([key, value]) => {
        acc[key] = Number(acc[key] || 0) + Number(value || 0);
      });
      return acc;
    }, {});
    const bundledBySourceReliabilityTop10 = caseResults.reduce((acc, item) => {
      const dist = item?.sourceStats?.bundledBySourceReliabilityTop10 || {};
      Object.entries(dist).forEach(([key, value]) => {
        acc[key] = Number(acc[key] || 0) + Number(value || 0);
      });
      return acc;
    }, {});
    return {
      mode,
      caseResults,
      precisionAt5,
      precisionAt10,
      hardFailCount,
      bundledRatioTop10: totalTop10 > 0 ? bundledCount / totalTop10 : 0,
      lowConfidenceRatioTop10: totalTop10 > 0 ? lowConfidenceCount / totalTop10 : 0,
      roleFamilyDistributionTop10,
      industryDistributionTop10,
      sourceQualityTierDistributionTop10,
      sourceReliabilityTierDistributionTop10,
      bundledBySourceReliabilityTop10,
      poolSourceMeta: summarizePoolSourceMetadata(poolJobs),
      jobCount: poolJobs.length
    };
  }

  const productionMode = await runMode("production_only", productionJobs);
  // full 模式默认只评估生产池，避免将 curated 诊断池混入常规回归耗时与口径。
  // curated_only / production_plus_curated 仅用于显式 source-report 或专项诊断时查看。
  const curatedMode = null;
  const mixedMode = null;
  const caseResults = productionMode.caseResults;

  const precisionAt5 = caseResults.reduce((sum, item) => sum + item.precisionAt5, 0) / caseResults.length;
  const precisionAt10 = caseResults.reduce((sum, item) => sum + item.precisionAt10, 0) / caseResults.length;
  const duplicateRate = caseResults.reduce((sum, item) => sum + item.duplicateRate, 0) / caseResults.length;
  const explanationConsistency =
    caseResults.reduce((sum, item) => sum + item.explanationConsistency, 0) / caseResults.length;
  const hardFailedCases = caseResults.filter((item) => toArray(item.hardFailedReasons).length > 0);
  const warningCases = caseResults.filter((item) => toArray(item.warningReasons).length > 0);
  const knownGapCases = caseResults.filter((item) => toArray(item.knownGapReasons).length > 0);
  const perDimension = mergeDimensionStats(caseResults);
  const baseline = buildBaselineSnapshotFromSeed(seed);
  const currentSnapshot = buildCurrentSnapshot({
    cases: caseResults.length,
    precisionAt5,
    precisionAt10,
    duplicateRate,
    explanationConsistency,
    hardFailCount: hardFailedCases.length,
    warningCount: warningCases.length,
    knownGapCount: knownGapCases.length
  });

  const subsetStats = (items = []) => {
    if (!items.length) return { cases: 0 };
    const hardFailCount = items.filter((item) => toArray(item.hardFailedReasons).length > 0).length;
    return {
      cases: items.length,
      precisionAt5: items.reduce((sum, item) => sum + item.precisionAt5, 0) / items.length,
      precisionAt10: items.reduce((sum, item) => sum + item.precisionAt10, 0) / items.length,
      duplicateRate: items.reduce((sum, item) => sum + item.duplicateRate, 0) / items.length,
      explanationConsistency: items.reduce((sum, item) => sum + item.explanationConsistency, 0) / items.length,
      hardFailCount
    };
  };

  const caseIndex = new Map(selectedCases.map((item) => [String(item.id), item]));
  const core22Cases = caseResults.filter((item) => {
    const seedCase = caseIndex.get(String(item.id));
    return String(seedCase?.coreSet || "") === "core22";
  });
  const gateTierCases = caseResults.filter((item) => {
    const seedCase = caseIndex.get(String(item.id));
    return String(seedCase?.evalTier || "") === "gate";
  });
  const diagnosticCases = caseResults.filter((item) => {
    const seedCase = caseIndex.get(String(item.id));
    return ["diagnostic", "placeholder"].includes(String(seedCase?.evalTier || ""));
  });
  const gateBasisMap = new Map();
  [...core22Cases, ...gateTierCases].forEach((item) => gateBasisMap.set(item.id, item));
  const gateBasisCases = Array.from(gateBasisMap.values());
  const userPriorityGateCases = caseResults.filter((item) => {
    const seedCase = caseIndex.get(String(item.id));
    return String(seedCase?.acceptanceGateTier || "") === "acceptance_gate";
  });

  const acceptanceReport = mode === "acceptance" ? buildAcceptanceGateReport(caseResults) : null;
  const userPriorityGateReport = buildUserPriorityGateReport(
    userPriorityGateCases.length > 0 ? userPriorityGateCases : caseResults
  );

  const segmented = {
    core22: subsetStats(core22Cases),
    gate: subsetStats(gateBasisCases),
    full44: subsetStats(caseResults),
    diagnostic: subsetStats(diagnosticCases)
  };

  const gateConfig = {
    maxPrecisionAt10Drop:
      Number(seed?.regressionGate?.maxPrecisionAt10Drop ?? 0.01),
    requireNoHardFail:
      seed?.regressionGate?.requireNoHardFail !== false
  };
  const gateReasons = [];
  if (gateConfig.requireNoHardFail && segmented.gate.hardFailCount > 0) {
    gateReasons.push(`hard fail cases(gate-basis) = ${segmented.gate.hardFailCount} (>0)`);
  }
  if (hasValidBaselineSnapshot(baseline)) {
    const gatePrecisionTolerance = 0.001;
    if (segmented.gate.precisionAt5 + gatePrecisionTolerance < baseline.precisionAt5) {
      gateReasons.push(
        `precision@5 下降(gate-basis): ${formatPct(segmented.gate.precisionAt5)} < baseline ${formatPct(baseline.precisionAt5)}`
      );
    }
    const p10Drop = baseline.precisionAt10 - segmented.gate.precisionAt10;
    if (p10Drop > Math.max(0, Number(gateConfig.maxPrecisionAt10Drop || 0.01))) {
      gateReasons.push(
        `precision@10 明显下降(gate-basis): drop=${(p10Drop * 100).toFixed(1)}pp > ${(Number(gateConfig.maxPrecisionAt10Drop || 0.01) * 100).toFixed(1)}pp`
      );
    }
    if (segmented.gate.explanationConsistency < baseline.explanationConsistency) {
      gateReasons.push(
        `explanation consistency 下降(gate-basis): ${formatPct(segmented.gate.explanationConsistency)} < baseline ${formatPct(baseline.explanationConsistency)}`
      );
    }
  }
  const legacyGate = {
    passed: gateReasons.length === 0,
    reasons: gateReasons,
    blockerSeverity:
      gateReasons.some((item) => item.includes("hard fail")) ? "P0" : gateReasons.length > 0 ? "P1" : "none"
  };
  const gate =
    mode === "legacy-gate"
      ? legacyGate
      : {
          passed: userPriorityGateReport.passed,
          reasons: userPriorityGateReport.passed
            ? []
            : toArray(userPriorityGateReport.blockedCases).map((item) => `userPriorityGate blocked: ${item.id} ${toArray(item.orderingViolations).join("|")}`),
          blockerSeverity: userPriorityGateReport.passed ? "none" : "P0"
        };
  finalizeLegacyTracking();

  if (mode === "gate" || mode === "legacy-gate") {
    printGateOnlyReport({
      seedPath,
      totalCases: caseResults.length,
      caseResults,
      segmented,
      gate,
      baseline,
      acceptanceReport,
      userPriorityGateReport: mode === "legacy-gate" ? null : userPriorityGateReport,
      legacyGate: mode === "legacy-gate" ? legacyGate : null
    });
  } else {
    printReport({
      seedPath,
      totalCases: caseResults.length,
      caseResults,
      hardFailedCases,
      warningCases,
      knownGapCases,
      overall: {
        precisionAt5,
        precisionAt10,
        duplicateRate,
        explanationConsistency,
        hardFailCount: hardFailedCases.length,
        warningCount: warningCases.length,
        knownGapCount: knownGapCases.length,
        perDimension,
        sourceLayerReport:
          mode === "full"
            ? {
                production_only: {
                  jobCount: productionMode.jobCount,
                  precisionAt5: productionMode.precisionAt5,
                  precisionAt10: productionMode.precisionAt10,
                  hardFailCount: productionMode.hardFailCount,
                  bundledRatioTop10: productionMode.bundledRatioTop10,
                  lowConfidenceRatioTop10: productionMode.lowConfidenceRatioTop10,
                  sourceQualityTierDistribution: productionMode.poolSourceMeta.sourceQualityTierDistribution,
                  sourceReliabilityTierDistribution: productionMode.poolSourceMeta.sourceReliabilityTierDistribution,
                  sourceFreshnessTierDistribution: productionMode.poolSourceMeta.sourceFreshnessTierDistribution,
                  sourceCompletenessTierDistribution: productionMode.poolSourceMeta.sourceCompletenessTierDistribution,
                  sourceGovernanceTierDistribution: productionMode.poolSourceMeta.sourceGovernanceTierDistribution,
                  sourceMaturityDistribution: productionMode.poolSourceMeta.sourceMaturityDistribution,
                  sourceVerticalStrengthDistribution: productionMode.poolSourceMeta.sourceVerticalStrengthDistribution,
                  lowConfidenceSourceRatio: productionMode.poolSourceMeta.lowConfidenceSourceRatio,
                  unknownSourceRatio: productionMode.poolSourceMeta.unknownSourceRatio,
                  sourceReliabilityTierDistributionTop10: productionMode.sourceReliabilityTierDistributionTop10,
                  bundledBySourceReliabilityTop10: productionMode.bundledBySourceReliabilityTop10,
                  roleFamilyDistributionTop10: productionMode.roleFamilyDistributionTop10,
                  industryDistributionTop10: productionMode.industryDistributionTop10
                }
              }
            : null
      },
      segmented,
      baseline,
      gate,
      evalEnvironmentHealth,
      compactOutput,
      userPriorityGateReport,
      legacyGate: mode === "full" ? legacyGate : null
    });
    if (acceptanceReport) {
      printAcceptanceGateReport(acceptanceReport);
    }
  }

  if (updateBaseline && mode !== "full") {
    throw new Error("baseline snapshot 仅允许在 --mode=full 下更新，避免 gate/diagnostic 覆盖主基线。");
  }

  if (updateBaseline) {
    writeBaselineSnapshotToSeed(seedPath, seed, currentSnapshot);
    console.log(`baseline snapshot 已更新到 seed: ${seedPath}`);
  }

  if (!gate.passed && mode !== "legacy-gate") {
    process.exitCode = 2;
  }
}

function printPromotionGovernanceReport(caseResults = []) {
  const summary = summarizePromotionGovernance(caseResults);
  console.log("## Promotion Governance (Frozen Section)");
  console.log("- section: Promotion Governance");
  console.log("## Diagnostic Promotion Governance");
  console.log(`- gateReadyCandidates: ${summary.gateReadyCandidates.length}`);
  console.log(`- stableCandidates: ${summary.stableCandidates.length}`);
  console.log(`- exploratoryCases: ${summary.exploratoryCases.length}`);
  console.log(`- blockedCases: ${summary.blockedCases.length}`);
  console.log(`- casesFailingStability: ${JSON.stringify(summary.casesFailingStability.slice(0, 20))}`);
  console.log(`- casesBlockedByDataCoverage: ${JSON.stringify(summary.casesBlockedByDataCoverage.slice(0, 20))}`);
  console.log(`- promotionBlockReasons: ${JSON.stringify(summary.promotionBlockReasons)}`);
  console.log("");
}

main().catch((error) => {
  console.error("eval-job-preference-ranking failed:", error?.message || error);
  process.exitCode = 1;
});

