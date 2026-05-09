"use strict";

/**
 * 派生岗位评分视图：只读计算，不污染 canonical job。
 */
const { classifyJobPreference, includesKeyword } = require("./job-preference-classifier");
const {
  DEFAULT_PRIORITY_WEIGHTS,
  normalizeJobPreferenceProfile,
  hasExplicitJobPreferenceProfile
} = require("./job-preference-profile");
const USER_PRIORITY_DEFAULT_WEIGHTS = Object.freeze({
  role: 35,
  industry: 25,
  location: 20,
  company: 10,
  accessibility: 10
});
const CROSS_INDUSTRY_SAFE_ROLES = ["数据分析", "产品经理", "算法工程师", "研发工程师", "后端开发工程师", "前端开发工程师", "AI工程师"];
const MIXED_ROLE_SOFT_SCORE_PENALTY = 0.5;
const ROLE_FAMILY_ALIASES = [
  {
    standardRoleFamily: "研发工程师",
    aliases: ["研发工程师", "软件工程师", "算法工程师", "machine learning engineer", "ml engineer", "ai engineer", "software engineer"]
  },
  {
    standardRoleFamily: "后端开发工程师",
    aliases: [
      "后端开发工程师",
      "后端研发工程师",
      "后端开发",
      "后端工程师",
      "服务端开发",
      "服务端工程师",
      "backend engineer",
      "backend developer",
      "java开发工程师",
      "java开发",
      "golang开发工程师",
      "go开发工程师",
      "go开发",
      "c++开发工程师",
      "c/c++开发工程师",
      "python开发工程师",
      "node.js开发工程师",
      "nodejs开发工程师"
    ]
  },
  {
    standardRoleFamily: "前端开发工程师",
    aliases: [
      "前端开发工程师",
      "前端研发工程师",
      "前端开发",
      "前端工程师",
      "web前端开发工程师",
      "web前端",
      "大前端",
      "frontend engineer",
      "frontend developer",
      "web developer",
      "javascript开发工程师",
      "js开发工程师",
      "react开发工程师",
      "vue开发工程师"
    ]
  },
  {
    standardRoleFamily: "数据分析",
    aliases: ["数据分析", "data analyst", "business analyst", "商业分析", "bi", "商业智能", "strategy analyst", "growth analyst"]
  },
  {
    standardRoleFamily: "产品经理",
    aliases: ["产品经理", "product manager", "product analyst"]
  },
  {
    standardRoleFamily: "金融研究",
    aliases: ["金融研究", "金融研究员", "投研", "投资研究", "量化研究", "证券研究员", "行业研究员", "策略研究员", "financial research", "investment research", "quant"]
  }
];
const ROLE_ANCHOR_KEYWORDS = ["工程师", "产品经理", "分析师", "研究员", "运营", "销售", "教师", "策划", "开发", "测试", "顾问"];
const RESPONSIBILITY_ROLE_PATTERNS = [
  { role: "数据分析", keywords: ["数据分析", "data analyst", "bi analyst", "business analyst", "商业分析", "报表", "指标体系"] },
  { role: "产品经理", keywords: ["产品经理", "product manager", "产品规划", "需求分析", "路线图", "prd"] },
  { role: "算法工程师", keywords: ["算法工程师", "algorithm engineer", "machine learning", "ml engineer", "模型训练", "深度学习"] },
  { role: "AI工程师", keywords: ["ai engineer", "大模型", "llm", "aigc", "模型推理"] },
  { role: "金融研究", keywords: ["投研", "金融研究", "金融研究员", "投资研究", "量化研究", "证券研究员", "行业研究员", "策略研究员", "investment research", "quant"] },
  { role: "教育科研", keywords: ["教研", "教育研究", "academic research", "科研助理", "课程研究"] },
  { role: "运营", keywords: ["运营", "增长运营", "活动运营", "用户运营"] }
];
const MUST_HAVE_SKILL_KEYWORDS = [
  "python",
  "sql",
  "java",
  "c++",
  "javascript",
  "typescript",
  "react",
  "vue",
  "node",
  "tableau",
  "excel",
  "power bi",
  "figma",
  "axure",
  "pytorch",
  "tensorflow",
  "spark",
  "hadoop",
  "docker",
  "kubernetes"
];
const BUNDLED_ROLE_SEPARATORS = /[\/|、，,；;]+/;
const RESPONSIBILITY_HEADERS = ["岗位职责", "工作职责", "职责描述", "你将负责", "主要职责"];
const MUST_HAVE_HEADERS = ["任职要求", "岗位要求", "职位要求", "必须", "硬性要求", "必备"];
const BONUS_HEADERS = ["优先", "加分项", "bonus", "preferred", "nice to have"];
const HIGH_VALUE_COMPOSITE_ROLE_PATTERNS = [
  ["自动驾驶", "算法"],
  ["感知", "算法"],
  ["规划", "控制"],
  ["数据分析", "bi"],
  ["数据分析", "数据产品"],
  ["产品经理", "数据产品"],
  ["产品经理", "增长产品"],
  ["ai工程", "算法工程"],
  ["机器学习", "算法工程"],
  ["金融科技", "数据分析"]
];
const ROLE_ADJACENT_KEYWORD_MAP = {
  "数据分析": ["商业分析", "business analyst", "bi", "商业智能", "数据产品"],
  "产品经理": ["数据产品", "增长产品", "product analyst", "商业分析"],
  "算法工程师": ["机器学习", "ai工程师", "研发工程师", "模型工程师"],
  "研发工程师": ["软件工程师", "后端", "前端", "算法工程师"],
  "后端开发工程师": ["后端开发", "后端工程师", "服务端开发", "java开发", "golang", "go开发", "c++开发", "python开发", "软件工程师", "研发工程师"],
  "前端开发工程师": ["前端开发", "前端工程师", "web前端", "javascript", "react", "vue", "大前端", "软件工程师", "研发工程师"],
  "商业分析": ["数据分析", "bi", "产品分析"],
  "金融研究": ["金融研究员", "量化研究", "投资研究", "证券研究员", "行业研究员", "策略研究员", "数据分析"]
};
const STRONG_MIXED_ROLE_KEYWORDS = ["销售", "客服", "行政", "培训", "渠道", "门店", "电话销售"];
const HARD_MIXED_ROLE_CONFLICT_KEYWORDS = ["销售", "客服", "行政", "培训", "门店", "电话销售"];
const OPPORTUNITY_TYPE_LABELS = {
  single_role_job: "明确单岗",
  high_value_role_pool: "高价值方向入口",
  broad_recruitment_entry: "综合招聘入口",
  low_quality_mixed_posting: "混杂岗位",
};

function isPresentDimensionScore(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return Number.isFinite(Number(value));
}

function hasMissingDimensionScore(value) {
  return !isPresentDimensionScore(value);
}

function nullableNumberOr(value, fallback = null) {
  return isPresentDimensionScore(value) ? numberOr(value, 0) : fallback;
}
const OPPORTUNITY_TYPE_SUMMARIES = {
  single_role_job: "高度匹配，建议优先投递。",
  high_value_role_pool: "多方向招聘入口，与你目标方向高度相关，建议优先确认具体子岗位。",
  broad_recruitment_entry: "岗位入口较广，方向部分相关，建议确认职责后推进。",
  low_quality_mixed_posting: "岗位职责混杂且目标方向证据较弱，建议谨慎。",
};
const legacyDirectReadWarningCache = new Set();

function isLegacyWarningEnabled() {
  const flag = String(process.env.APPLYFLOW_LEGACY_WARNINGS || "").trim().toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || nodeEnv === "development";
}

function warnLegacyRead({ field = "", consumer = "", replacement = "", phase = "phase8c" } = {}) {
  if (!isLegacyWarningEnabled()) return;
  const key = [field, consumer, replacement, phase].join("|");
  if (!field || legacyDirectReadWarningCache.has(key)) return;
  legacyDirectReadWarningCache.add(key);
  console.warn("[ApplyFlow][LegacyReadWarning]", { field, consumer, replacement, deprecationPhase: phase });
}

const SOURCE_RELIABILITY_KEYWORDS = {
  official_ats: ["official_ats", "official ats", "campus", "校招官网", "校园招聘"],
  company_career_page: ["career", "careers", "jobs", "company", "公司官网", "官网招聘"],
  recruiter_repost: ["recruiter", "猎头", "内推", "转发", "repost"],
  aggregator: ["aggregator", "聚合", "抓取", "third_party", "third party"]
};

function includesAny(text = "", keywords = []) {
  return (Array.isArray(keywords) ? keywords : []).some((item) => includesKeyword(text, item));
}

function buildJobScoringViewModel({
  job = {},
  lightweightProfile = {},
  jobPreferenceProfile = {},
  preferenceSource = "",
  feedbackInfluenceSignal = null,
  baseScoringView = null,
  dedupeContext = null
} = {}) {
  const resolvedPreferenceSource =
    String(preferenceSource || "").trim() ||
    (hasExplicitJobPreferenceProfile(jobPreferenceProfile) ? "jobPreferenceProfile" : "legacy");
  const normalizedPreference = normalizeJobPreferenceProfile(
    {
    lightweightProfile,
    jobPreferenceProfile
    },
    { strict: resolvedPreferenceSource === "jobPreferenceProfile" }
  );
  const classification = classifyJobPreference({
    lightweightProfile,
    jobPreferenceProfile: normalizedPreference,
    preferenceSource: resolvedPreferenceSource,
    job
  });
  const cachedJobFeaturesView =
    baseScoringView?.jobFeaturesView && typeof baseScoringView.jobFeaturesView === "object"
      ? normalizeJobFeaturesView(baseScoringView.jobFeaturesView)
      : null;
  const jobFeaturesView = cachedJobFeaturesView || enrichJobFeatures(job, classification, dedupeContext);
  const preference = classification.preferenceProfile || {};
  const hasIndustryPreference = (preference.industryPreference || []).length > 0;
  const hasPreferences =
    hasIndustryPreference ||
    (preference.excludedIndustries || []).length > 0 ||
    (preference.rolePreference || []).length > 0 ||
    (preference.excludedRoles || []).length > 0 ||
    (preference.skillPreference || []).length > 0 ||
    (preference.locationPreference || []).length > 0 ||
    (preference.companyPreference || []).length > 0 ||
    (preference.avoidCompanyTypes || []).length > 0;

  if (!hasPreferences) {
    const skillGapView = buildSkillGapView({
      job,
      preference
    });
    const neutralOpportunityTypeInfo = resolveOpportunityType({ jobFeaturesView, classification });
    const neutralJobFeaturesView = {
      ...jobFeaturesView,
      opportunityType: neutralOpportunityTypeInfo.opportunityType,
      opportunityTypeConfidence: neutralOpportunityTypeInfo.opportunityTypeConfidence,
      opportunityTypeSummary: neutralOpportunityTypeInfo.opportunityTypeSummary,
    };
    const neutralDecisionVerdict = buildDecisionVerdict({
      score: 15,
      industryFit: null,
      roleFit: null,
      skillFit: null,
      locationFit: null,
      companyFit: null,
      classification,
      preference,
      resolvedPreferenceSource,
      opportunityTypeInfo: neutralOpportunityTypeInfo
    });
    return {
      score: 15,
      userPriorityScore: 15,
      preferenceMatchScore: 15,
      userPriorityDimensions: buildUserPriorityDimensions({}),
      explanation: "尚未设置求职偏好，当前按更新时间排序。",
      matchedSignals: [],
      risks: ["缺少求职偏好信息（jobPreferenceProfile/lightweightProfile）"],
      hasPreferences: false,
      skillGapView,
      decisionVerdict: neutralDecisionVerdict,
      opportunityType: neutralOpportunityTypeInfo.opportunityType,
      opportunityTypeConfidence: neutralOpportunityTypeInfo.opportunityTypeConfidence,
      opportunityTypeSummary: neutralOpportunityTypeInfo.opportunityTypeSummary,
      opportunityTypeLabel: neutralOpportunityTypeInfo.opportunityTypeLabel,
      jobFeaturesView: neutralJobFeaturesView,
      ...buildEmptyClassificationFields(classification)
    };
  }

  const industryFit = scoreIndustryFit(classification);
  const roleFitEvaluated = evaluateRoleFitEvidence(classification, job, jobFeaturesView);
  const roleFit = roleFitEvaluated?.score ?? null;
  classification.roleFit = {
    score: roleFit,
    evidenceType: String(roleFitEvaluated?.evidenceType || "").trim() || "adjacent_role_match"
  };
  const skillFit = scoreSkillFit(classification);
  const locationFit = scoreLocationFit(job.location, preference.locationPreference);
  const companyFit = scoreCompanyFit(classification, job);
  const jobQualityFit = scoreJobQualityFit(jobFeaturesView);
  const jobQualitySummary = buildJobQualitySummary(jobFeaturesView);
  const applicationAccessibilityFit = scoreApplicationAccessibilityFit({
    classification,
    preference,
    roleFit,
    skillFit,
    locationFit,
    companyFit
  });
  const qualityBase = scoreQualityBase(job);
  const feedbackSignal = normalizeFeedbackInfluenceSignal(feedbackInfluenceSignal);
  const industryConflictPenalty = resolveIndustryConflictPenalty({
    classification,
    preference,
    jobFeaturesView
  });
  const rawUserPriorityScore = resolveUserPriorityScore({
    classification,
    normalizedPreference,
    industryFit,
    roleFit,
    companyFit,
    locationFit,
    applicationAccessibilityFit
  });
  const userPriorityScore = applyUserPriorityCompletenessCap(
    applyExplicitRoleValueFloor(
      clampScore(Number(rawUserPriorityScore || 0) - Number(industryConflictPenalty.preferencePenalty || 0)),
      { classification, roleFit }
    ),
    { classification, jobFeaturesView, preference, locationFit }
  );
  const baseScore = userPriorityScore;
  // feedback 只作为深层 tie-break 信号，不再进入主分，防止跨域岗位被反馈抬升。
  const score = userPriorityScore;
  const matchedSignals = classification.matchSignals || [];
  const risks = [...(classification.mismatchSignals || [])];
  if (feedbackSignal.boost > 0) {
    matchedSignals.push("命中历史正反馈类型");
  }
  if (feedbackSignal.boost < 0) {
    risks.push("命中历史负反馈类型");
  }
  if (industryConflictPenalty.scorePenalty > 0) {
    risks.push(industryConflictPenalty.reason || "行业冲突风险，已降权");
  }
  if ((preference.skillPreference || []).length === 0) {
    risks.push("技能偏好未填写");
  }
  const opportunityTypeInfo = resolveOpportunityType({ jobFeaturesView, classification, roleFit, industryFit, companyFit, applicationAccessibilityFit });
  const jobFeaturesViewWithOpportunity = {
    ...jobFeaturesView,
    opportunityType: opportunityTypeInfo.opportunityType,
    opportunityTypeConfidence: opportunityTypeInfo.opportunityTypeConfidence,
    opportunityTypeSummary: opportunityTypeInfo.opportunityTypeSummary,
  };
  const decisionVerdict = buildDecisionVerdict({
    score,
    industryFit,
    roleFit,
    roleEvidenceType: String(classification?.roleFit?.evidenceType || "").trim() || "adjacent_role_match",
    skillFit,
    locationFit,
    companyFit,
    jobQualityFit,
    classification,
    preference,
    resolvedPreferenceSource,
    opportunityTypeInfo
  });
  const skillGapView = buildSkillGapView({
    job,
    preference,
      classification
  });
  const feedbackDiagnostic = buildFeedbackDiagnosticView({
    job,
    classification,
    jobFeaturesView,
    roleFit,
    industryFit,
    locationFit,
    companyFit,
    applicationAccessibilityFit
  });
  const explainabilityView = buildExplainabilityView({
    classification,
    preference,
    score,
    industryFit,
    roleFit,
    skillFit,
    locationFit,
    companyFit,
    applicationAccessibilityFit,
    decisionVerdict,
    jobFeaturesView: jobFeaturesViewWithOpportunity,
    opportunityTypeInfo,
    feedbackDiagnostic,
    industryConflictPenalty
  });

  return {
    score,
    userPriorityScore,
    preferenceMatchScore: userPriorityScore,
    userPriorityDimensions: buildUserPriorityDimensions({
      roleFit,
      industryFit,
      locationFit,
      companyFit,
      applicationAccessibilityFit
    }),
    industryFit,
    roleFit,
    roleFitEvidenceType: String(classification?.roleFit?.evidenceType || "").trim() || "adjacent_role_match",
    roleFitDetails: {
      score: roleFit,
      evidenceType: String(classification?.roleFit?.evidenceType || "").trim() || "adjacent_role_match"
    },
    skillFit,
    locationFit,
    companyFit,
    jobQualityFit,
    jobQualitySummary,
    applicationAccessibilityFit,
    qualityBase,
    explanation: buildExplanation({
      explainabilityView,
      feedbackReason: feedbackSignal.reason
    }),
    matchedSignals,
    risks: unique(risks),
    hasPreferences: true,
    feedbackInfluence: feedbackSignal,
    inferredPreferenceDelta: feedbackDiagnostic.inferredPreferenceDelta,
    explainabilityCategory: explainabilityView.explainabilityCategory,
    rankingPrimaryDrivers: explainabilityView.rankingPrimaryDrivers,
    rankingNegativeDrivers: explainabilityView.rankingNegativeDrivers,
    confidencePrimaryDrivers: explainabilityView.confidencePrimaryDrivers,
    roleMatchSummary: explainabilityView.roleMatchSummary,
    roleExplanation: explainabilityView.roleExplanation,
    industryExplanation: explainabilityView.industryExplanation,
    sourceExplanation: explainabilityView.sourceExplanation,
    sourceGovernanceSummary: jobFeaturesView.sourceGovernanceSummary,
    sourceStrengthSummary: jobFeaturesView.sourceStrengthSummary,
    sourcePromotionBlockReason: jobFeaturesView.sourcePromotionBlockReason,
    semanticPuritySummary: explainabilityView.semanticPuritySummary,
    bundledRiskSummary: explainabilityView.bundledRiskSummary,
    freshnessRiskSummary: explainabilityView.freshnessRiskSummary,
    reviewTriggerSummary: explainabilityView.reviewTriggerSummary,
    explainabilityFeatures: {
      recommendationReasonSummary: explainabilityView.recommendationReasonSummary,
      blockerReasonSummary: explainabilityView.blockerReasonSummary,
      reviewTriggerSummary: explainabilityView.reviewTriggerSummary,
      sourceRiskSummary: explainabilityView.sourceRiskSummary,
      preferenceDriftSummary: explainabilityView.preferenceDriftSummary,
      confidenceExplanation: explainabilityView.confidenceExplanation,
      roleExplanation: explainabilityView.roleExplanation,
      industryExplanation: explainabilityView.industryExplanation,
      sourceExplanation: explainabilityView.sourceExplanation
    },
    feedbackGovernanceFeatures: {
      feedbackSignalType: feedbackDiagnostic.feedbackSignalType,
      feedbackConfidence: feedbackDiagnostic.feedbackConfidence,
      feedbackRecencyTier: feedbackDiagnostic.feedbackRecencyTier,
      feedbackConsistency: feedbackDiagnostic.feedbackConsistency,
      feedbackConflictRisk: feedbackDiagnostic.feedbackConflictRisk,
      preferenceEvolutionCandidate: feedbackDiagnostic.preferenceEvolutionCandidate,
      inferredPreferenceDelta: feedbackDiagnostic.inferredPreferenceDelta
    },
    industryConflictPenalty,
    baseScore,
    opportunityType: opportunityTypeInfo.opportunityType,
    opportunityTypeConfidence: opportunityTypeInfo.opportunityTypeConfidence,
    opportunityTypeSummary: opportunityTypeInfo.opportunityTypeSummary,
    opportunityTypeLabel: opportunityTypeInfo.opportunityTypeLabel,
    jobFeaturesView: jobFeaturesViewWithOpportunity,
    skillGapView,
    decisionVerdict,
    ...buildEmptyClassificationFields(classification)
  };
}

/**
 * 在 jobs workspace view model 上附加 scoring 派生层字段。
 */
function attachScoringToJobWorkspaceViewModel(jobWorkspaceViewModel = {}, scoringView = {}) {
  const nextDecisionView = {
    ...(jobWorkspaceViewModel.decisionView || {}),
    priorityScore: Number.isFinite(Number(scoringView.userPriorityScore ?? scoringView.score)) ? Number(scoringView.userPriorityScore ?? scoringView.score) : null
  };

  const explainabilityContainer =
    scoringView?.explainabilityFeatures && typeof scoringView.explainabilityFeatures === "object"
      ? scoringView.explainabilityFeatures
      : null;
  const feedbackGovernanceContainer =
    scoringView?.feedbackGovernanceFeatures && typeof scoringView.feedbackGovernanceFeatures === "object"
      ? scoringView.feedbackGovernanceFeatures
      : null;
  const isLikelyLegacyCompatibilityPayload =
    !scoringView?.jobFeaturesView?.featureLayerModules ||
    typeof scoringView?.jobFeaturesView?.featureLayerModules !== "object";
  if (!explainabilityContainer && !isLikelyLegacyCompatibilityPayload && (scoringView.recommendationReasonSummary || scoringView.blockerReasonSummary || scoringView.sourceRiskSummary || scoringView.confidenceExplanation || scoringView.preferenceDriftSummary)) {
    warnLegacyRead({
      field: "scoringView.recommendationReasonSummary",
      consumer: "attachScoringToJobWorkspaceViewModel",
      replacement: "scoringView.explainabilityFeatures.recommendationReasonSummary",
      phase: "phase8c"
    });
  }
  if (!feedbackGovernanceContainer && !isLikelyLegacyCompatibilityPayload && (scoringView.feedbackSignalType || scoringView.feedbackConfidence || scoringView.feedbackRecencyTier || scoringView.feedbackConsistency || scoringView.feedbackConflictRisk || scoringView.preferenceEvolutionCandidate)) {
    warnLegacyRead({
      field: "scoringView.feedbackSignalType",
      consumer: "attachScoringToJobWorkspaceViewModel",
      replacement: "scoringView.feedbackGovernanceFeatures.feedbackSignalType",
      phase: "phase8c"
    });
  }

  const normalizedOpportunityTypeInfo = normalizeOpportunityTypeInfo({
    opportunityType: scoringView.opportunityType || scoringView.decisionVerdict?.opportunityType,
    opportunityTypeConfidence: scoringView.opportunityTypeConfidence || scoringView.decisionVerdict?.opportunityTypeConfidence,
    opportunityTypeSummary: scoringView.opportunityTypeSummary || scoringView.decisionVerdict?.opportunityTypeSummary,
  });
  const userPriorityDimensions = normalizeUserPriorityDimensions(scoringView.userPriorityDimensions);
  const displayedLocation = String(jobWorkspaceViewModel?.jobSummary?.location || "").trim();
  const locationFitForView =
    numberOr(scoringView.locationFit, 0) === 0 &&
    numberOr(userPriorityDimensions.location, 0) === 60 &&
    /^(地点未说明|未说明|暂无|无|不限|待定|-|—|--)$/.test(displayedLocation)
      ? null
      : nullableNumberOr(scoringView.locationFit, null);

  return {
    ...jobWorkspaceViewModel,
    decisionView: nextDecisionView,
    scoringView: {
      score: numberOr(scoringView.score, 0),
      userPriorityScore: numberOr(scoringView.userPriorityScore, numberOr(scoringView.preferenceMatchScore, numberOr(scoringView.score, 0))),
      preferenceMatchScore: numberOr(scoringView.preferenceMatchScore, numberOr(scoringView.score, 0)),
      userPriorityDimensions,
      industryFit: numberOr(scoringView.industryFit, 0),
      roleFit: numberOr(scoringView.roleFit, 0),
      roleFitEvidenceType: String(scoringView.roleFitEvidenceType || scoringView.roleEvidenceType || "").trim().toLowerCase() || "adjacent_role_match",
      roleFitDetails:
        scoringView.roleFitDetails && typeof scoringView.roleFitDetails === "object"
          ? {
              score: numberOr(scoringView.roleFitDetails.score, numberOr(scoringView.roleFit, 0)),
              evidenceType:
                String(scoringView.roleFitDetails.evidenceType || scoringView.roleFitEvidenceType || scoringView.roleEvidenceType || "")
                  .trim()
                  .toLowerCase() || "adjacent_role_match"
            }
          : {
              score: numberOr(scoringView.roleFit, 0),
              evidenceType: String(scoringView.roleFitEvidenceType || scoringView.roleEvidenceType || "").trim().toLowerCase() || "adjacent_role_match"
            },
      skillFit: nullableNumberOr(scoringView.skillFit, null),
      locationFit: locationFitForView,
      companyFit: nullableNumberOr(scoringView.companyFit, null),
      jobQualityFit: numberOr(scoringView.jobQualityFit, 0),
      jobQualitySummary: String(scoringView.jobQualitySummary || "").trim(),
      applicationAccessibilityFit: numberOr(scoringView.applicationAccessibilityFit, 0),
      opportunityType: normalizedOpportunityTypeInfo.opportunityType,
      opportunityTypeConfidence: normalizedOpportunityTypeInfo.opportunityTypeConfidence,
      opportunityTypeSummary: normalizedOpportunityTypeInfo.opportunityTypeSummary,
      opportunityTypeLabel: normalizedOpportunityTypeInfo.opportunityTypeLabel,
      qualityBase: numberOr(scoringView.qualityBase, 0),
      explanation: String(scoringView.explanation || "").trim(),
      matchedSignals: Array.isArray(scoringView.matchedSignals) ? scoringView.matchedSignals : [],
      risks: Array.isArray(scoringView.risks) ? scoringView.risks : [],
      preferenceType: String(scoringView.preferenceType || "unknown").trim(),
      inferredIndustry: String(scoringView.inferredIndustry || "").trim(),
      inferredIndustryConfidence: String(scoringView.inferredIndustryConfidence || "low").trim(),
      inferredRoleFamily: String(scoringView.inferredRoleFamily || "").trim(),
      inferredRoleConfidence: String(scoringView.inferredRoleConfidence || "low").trim(),
      inferredSkills: Array.isArray(scoringView.inferredSkills) ? scoringView.inferredSkills : [],
      inferredCompanyTypes: Array.isArray(scoringView.inferredCompanyTypes) ? scoringView.inferredCompanyTypes : [],
      dominantRoleSegment: String(scoringView.dominantRoleSegment || "").trim(),
      secondaryRoleSegments: Array.isArray(scoringView.secondaryRoleSegments) ? scoringView.secondaryRoleSegments : [],
      mixedRoleTitle: Boolean(scoringView.mixedRoleTitle),
      dominantNegativeRoleSignals: Array.isArray(scoringView.dominantNegativeRoleSignals) ? scoringView.dominantNegativeRoleSignals : [],
      secondaryNegativeRoleSignals: Array.isArray(scoringView.secondaryNegativeRoleSignals) ? scoringView.secondaryNegativeRoleSignals : [],
      matchSignals: Array.isArray(scoringView.matchSignals) ? scoringView.matchSignals : [],
      mismatchSignals: Array.isArray(scoringView.mismatchSignals) ? scoringView.mismatchSignals : [],
      locationFitLevel: String(scoringView.locationFitLevel || "").trim(),
      skillGapView: normalizeSkillGapView(scoringView.skillGapView),
      decisionVerdict: normalizeDecisionVerdict(scoringView.decisionVerdict),
      jobFeaturesView: normalizeJobFeaturesView(scoringView.jobFeaturesView),
      feedbackInfluence: normalizeFeedbackInfluenceSignal(scoringView.feedbackInfluence),
      inferredPreferenceDelta: normalizeFeedbackPreferenceDelta((scoringView.feedbackGovernanceFeatures || {}).inferredPreferenceDelta || scoringView.inferredPreferenceDelta),
      explainabilityCategory: String(scoringView.explainabilityCategory || "").trim().toLowerCase() || "low_confidence_review",
      rankingPrimaryDrivers: normalizeExplainabilityList(scoringView.rankingPrimaryDrivers, 4),
      rankingNegativeDrivers: normalizeExplainabilityList(scoringView.rankingNegativeDrivers, 4),
      confidencePrimaryDrivers: normalizeExplainabilityList(scoringView.confidencePrimaryDrivers, 4),
      roleMatchSummary: String(scoringView.roleMatchSummary || "").trim(),
      roleExplanation: String((scoringView.explainabilityFeatures || {}).roleExplanation || scoringView.roleExplanation || "").trim(),
      industryExplanation: String((scoringView.explainabilityFeatures || {}).industryExplanation || scoringView.industryExplanation || "").trim(),
      sourceExplanation: String((scoringView.explainabilityFeatures || {}).sourceExplanation || scoringView.sourceExplanation || "").trim(),
      sourceGovernanceSummary: String(scoringView.sourceGovernanceSummary || "").trim(),
      sourceStrengthSummary: String(scoringView.sourceStrengthSummary || "").trim(),
      sourcePromotionBlockReason: String(scoringView.sourcePromotionBlockReason || "").trim(),
      semanticPuritySummary: String(scoringView.semanticPuritySummary || "").trim(),
      bundledRiskSummary: String(scoringView.bundledRiskSummary || "").trim(),
      freshnessRiskSummary: String(scoringView.freshnessRiskSummary || "").trim(),
      reviewTriggerSummary: String((scoringView.explainabilityFeatures || {}).reviewTriggerSummary || scoringView.reviewTriggerSummary || "").trim(),
      explainabilityFeatures: {
        recommendationReasonSummary: String((scoringView.explainabilityFeatures || {}).recommendationReasonSummary || scoringView.recommendationReasonSummary || "").trim(),
        blockerReasonSummary: String((scoringView.explainabilityFeatures || {}).blockerReasonSummary || scoringView.blockerReasonSummary || "").trim(),
        reviewTriggerSummary: String((scoringView.explainabilityFeatures || {}).reviewTriggerSummary || scoringView.reviewTriggerSummary || "").trim(),
        sourceRiskSummary: String((scoringView.explainabilityFeatures || {}).sourceRiskSummary || scoringView.sourceRiskSummary || "").trim(),
        preferenceDriftSummary: String((scoringView.explainabilityFeatures || {}).preferenceDriftSummary || scoringView.preferenceDriftSummary || "").trim(),
        confidenceExplanation: String((scoringView.explainabilityFeatures || {}).confidenceExplanation || scoringView.confidenceExplanation || "").trim(),
        roleExplanation: String((scoringView.explainabilityFeatures || {}).roleExplanation || scoringView.roleExplanation || "").trim(),
        industryExplanation: String((scoringView.explainabilityFeatures || {}).industryExplanation || scoringView.industryExplanation || "").trim(),
        sourceExplanation: String((scoringView.explainabilityFeatures || {}).sourceExplanation || scoringView.sourceExplanation || "").trim(),
        opportunityTypeSummary: String((scoringView.explainabilityFeatures || {}).opportunityTypeSummary || scoringView.opportunityTypeSummary || normalizedOpportunityTypeInfo.opportunityTypeSummary || "").trim()
      },
      feedbackGovernanceFeatures: {
        feedbackSignalType: String((scoringView.feedbackGovernanceFeatures || {}).feedbackSignalType || scoringView.feedbackSignalType || "").trim().toLowerCase() || "none",
        feedbackConfidence: String((scoringView.feedbackGovernanceFeatures || {}).feedbackConfidence || scoringView.feedbackConfidence || "").trim().toLowerCase() || "low",
        feedbackRecencyTier: String((scoringView.feedbackGovernanceFeatures || {}).feedbackRecencyTier || scoringView.feedbackRecencyTier || "").trim().toLowerCase() || "none",
        feedbackConsistency: String((scoringView.feedbackGovernanceFeatures || {}).feedbackConsistency || scoringView.feedbackConsistency || "").trim().toLowerCase() || "unknown",
        feedbackConflictRisk: String((scoringView.feedbackGovernanceFeatures || {}).feedbackConflictRisk || scoringView.feedbackConflictRisk || "").trim().toLowerCase() || "low",
        preferenceEvolutionCandidate: Boolean((scoringView.feedbackGovernanceFeatures || {}).preferenceEvolutionCandidate ?? scoringView.preferenceEvolutionCandidate),
        inferredPreferenceDelta: normalizeFeedbackPreferenceDelta((scoringView.feedbackGovernanceFeatures || {}).inferredPreferenceDelta || scoringView.inferredPreferenceDelta)
      },
      industryConflictPenalty: normalizeIndustryConflictPenalty(scoringView.industryConflictPenalty),
      baseScore: numberOr(scoringView.baseScore, numberOr(scoringView.score, 0))
    }
  };
}

function buildEmptyClassificationFields(classification = {}) {
  return {
    preferenceType: classification.preferenceType || "unknown",
    inferredIndustry: classification.inferredIndustry || "其他",
    inferredIndustryConfidence: classification.inferredIndustryConfidence || "low",
    inferredRoleFamily: classification.inferredRoleFamily || null,
    inferredRoleConfidence: classification.inferredRoleConfidence || "low",
    inferredSkills: Array.isArray(classification.inferredSkills) ? classification.inferredSkills : [],
    inferredCompanyTypes: Array.isArray(classification.inferredCompanyTypes) ? classification.inferredCompanyTypes : [],
    dominantRoleSegment: String(classification.dominantRoleSegment || "").trim(),
    secondaryRoleSegments: Array.isArray(classification.secondaryRoleSegments) ? classification.secondaryRoleSegments : [],
    mixedRoleTitle: Boolean(classification.mixedRoleTitle),
    dominantNegativeRoleSignals: Array.isArray(classification.dominantNegativeRoleSignals) ? classification.dominantNegativeRoleSignals : [],
    secondaryNegativeRoleSignals: Array.isArray(classification.secondaryNegativeRoleSignals) ? classification.secondaryNegativeRoleSignals : [],
    matchSignals: Array.isArray(classification.matchSignals) ? classification.matchSignals : [],
    mismatchSignals: Array.isArray(classification.mismatchSignals) ? classification.mismatchSignals : []
  };
}

function enrichJobFeatures(job = {}, classification = {}, dedupeContext = null) {
  const metadata = job.metadata && typeof job.metadata === "object" ? job.metadata : {};
  const title = String(job.title || "");
  const description = String(
    job.jdRaw ||
      job.jd_raw ||
      job.description ||
      job.rawText ||
      job.raw_text ||
      metadata.rawText ||
      metadata.raw_text ||
      ""
  );
  const roleCorpus = [
    title,
    description,
    classification.dominantRoleSegment,
    classification.inferredRoleFamily,
    classification.inferredRole
  ].join(" ");
  const standardRoleFamily = resolveStandardRoleFamily(roleCorpus, classification);
  const isCrossIndustrySafe = CROSS_INDUSTRY_SAFE_ROLES.some((role) => includesKeyword(standardRoleFamily, role) || includesKeyword(roleCorpus, role));
  const highValueCompositeRole = detectHighValueCompositeRole({ title, description, roleCorpus });
  const isMixedRoleJD = detectMixedRoleJD({ title, description, classification });
  const jdInformationDensity = calculateInformationDensity({ title, description, classification });
  const titleClarity = resolveTitleClarity({ title, classification, isMixedRoleJD, highValueCompositeRole });
  const rolePurity = resolveRolePurity({ title, description, classification, isMixedRoleJD, highValueCompositeRole });
  const likelyBundledJD = resolveLikelyBundledJD({ title, description, isMixedRoleJD, rolePurity, highValueCompositeRole });
  const likelySingleRoleJD = !likelyBundledJD && !isMixedRoleJD && rolePurity === "high";
  // sourceQuality 只描述“岗位文本和结构质量”，不评价来源可信度。
  const sourceQualityTier = resolveSourceQualityTier({
    titleClarity,
    rolePurity,
    jdInformationDensity,
    likelyBundledJD,
    highValueCompositeRole
  });
  // confidenceTier 只描述“当前解析判断的置信度”，用于表达系统把握，不等同于来源质量或文本质量。
  const confidenceTier = resolveConfidenceTier({
    titleClarity,
    rolePurity,
    jdInformationDensity,
    sourceQualityTier
  });
  // sourceReliability 只描述“来源本身是否可信”，例如官网/ATS/聚合站，不评价 JD 结构是否清晰。
  const sourceReliabilityTier = resolveSourceReliabilityTier(job);
  const sourceReliabilityScore = resolveSourceReliabilityScore(sourceReliabilityTier);
  const sourceFreshnessTier = resolveSourceFreshnessTier(job);
  const sourceCompletenessTier = resolveSourceCompletenessTier(job);
  const sourceRiskFlags = resolveSourceRiskFlags({
    job,
    sourceReliabilityTier,
    sourceFreshnessTier,
    sourceCompletenessTier,
    likelyBundledJD
  });
  const sourceAuthorityTier = resolveSourceAuthorityTier({
    sourceReliabilityTier,
    sourceRiskFlags,
    job
  });
  const sourceFreshnessDecay = resolveSourceFreshnessDecay({
    sourceFreshnessTier,
    updatedAt: job.updatedAt || job.createdAt || job.postedAt || job.publishTime || job.publishAt
  });
  const sourceCompletenessScore = resolveSourceCompletenessScore({
    sourceCompletenessTier,
    job
  });
  const sourceDuplicationRisk = resolveSourceDuplicationRisk({ title, job });
  const sourceCommercialNoiseRisk = resolveSourceCommercialNoiseRisk({ title, description, job });
  const sourceRecruitmentAuthenticity = resolveSourceRecruitmentAuthenticity({
    job,
    sourceAuthorityTier,
    sourceCommercialNoiseRisk
  });
  const sourceTrustScore = resolveSourceTrustScore({
    sourceAuthorityTier,
    sourceFreshnessDecay,
    sourceDuplicationRisk,
    sourceCompletenessScore,
    sourceCommercialNoiseRisk,
    sourceRecruitmentAuthenticity,
    sourceRiskFlags
  });
  const productionSourceConfidence = resolveProductionSourceConfidence({
    sourceTrustScore,
    sourceAuthorityTier,
    sourceCommercialNoiseRisk,
    sourceRiskFlags
  });
  const semanticJd = parseSemanticJDBlocks({
    title,
    description,
    classification
  });
  const normalizedTitle = normalizePostingTitle(title);
  const normalizedCompany = normalizeCompanyName(job.company || metadata.company || "");
  const normalizedLocation = normalizePostingLocation(job.location || metadata.location || "");
  const normalizedSourceDomain = normalizeSourceDomain(job);
  const dedupeFeatures = resolveDedupeFeatures({
    job,
    normalizedTitle,
    normalizedCompany,
    normalizedLocation,
    normalizedSourceDomain,
    titleClarity,
    rolePurity,
    likelyBundledJD,
    sourceAuthorityTier,
    sourceCompletenessScore,
    dedupeContext
  });
  const freshnessFeatures = resolveFreshnessFeatures({
    job,
    sourceFreshnessTier,
    sourceFreshnessDecay
  });
  const sourceFraudRisk = resolveSourceFraudRisk({
    sourceAuthorityTier,
    sourceCommercialNoiseRisk,
    sourceRiskFlags,
    sourceRecruitmentAuthenticity
  });
  const sourceGovernanceTier = resolveSourceGovernanceTier({
    sourceAuthorityTier,
    productionSourceConfidence,
    sourceFraudRisk
  });
  const sourceHistoricalReliability = resolveSourceHistoricalReliability({
    sourceTrustScore,
    sourceAuthorityTier,
    sourceRiskFlags
  });
  const sourceCoverageDensity = resolveSourceCoverageDensity({
    sourceCompletenessScore,
    duplicateSourceCountHint: dedupeFeatures.duplicateSourceCount,
    normalizedSourceDomain
  });
  const sourceVerticalStrength = resolveSourceVerticalStrength({
    classification,
    sourceAuthorityTier,
    normalizedSourceDomain,
    sourceTrustScore,
    sourceQualityTier
  });
  const sourceDecayRisk = resolveSourceDecayRisk({
    sourceFreshnessDecay,
    staleRisk: freshnessFeatures.staleRisk
  });
  const sourceMaturityLevel = resolveSourceMaturityLevel({
    sourceGovernanceTier,
    sourceHistoricalReliability,
    sourceVerticalStrength,
    sourceFraudRisk,
    sourceDecayRisk
  });
  const sourcePromotionEligibility = resolveSourcePromotionEligibility({
    sourceGovernanceTier,
    sourceMaturityLevel,
    sourceFraudRisk,
    sourceDecayRisk,
    sourceVerticalStrength
  });
  const sourcePromotionBlockReason = buildSourcePromotionBlockReason({
    sourcePromotionEligibility,
    sourceFraudRisk,
    sourceDecayRisk,
    sourceVerticalStrength
  });
  const sourceStrengthSummary = buildSourceStrengthSummary({
    sourceVerticalStrength,
    classification,
    sourceAuthorityTier
  });
  const sourceGovernanceSummary = buildSourceGovernanceSummary({
    sourceGovernanceTier,
    sourceMaturityLevel,
    sourceHistoricalReliability,
    sourceVerticalStrength,
    sourcePromotionEligibility,
    sourcePromotionBlockReason
  });
  const semanticFeatures = buildSemanticFeaturesModule({
    standardRoleFamily,
    isCrossIndustrySafe,
    highValueCompositeRole,
    isMixedRoleJD,
    titleClarity,
    rolePurity,
    sourceQualityTier,
    confidenceTier,
    jdInformationDensity,
    likelyBundledJD,
    likelySingleRoleJD,
    semanticJd
  });
  const sourceGovernanceFeatures = buildSourceGovernanceFeaturesModule({
    sourceReliabilityTier,
    sourceReliabilityScore,
    freshnessTier: freshnessFeatures.freshnessTier,
    sourceFreshnessTier,
    sourceCompletenessTier,
    sourceRiskFlags,
    sourceTrustScore,
    sourceAuthorityTier,
    sourceFreshnessDecay,
    sourceDuplicationRisk,
    sourceCompletenessScore,
    sourceCommercialNoiseRisk,
    sourceRecruitmentAuthenticity,
    productionSourceConfidence,
    sourceGovernanceTier,
    sourceMaturityLevel,
    sourceHistoricalReliability,
    sourceCoverageDensity,
    sourceVerticalStrength,
    sourceDecayRisk,
    sourceFraudRisk,
    sourcePromotionEligibility,
    sourceGovernanceSummary,
    sourceStrengthSummary,
    sourcePromotionBlockReason
  });
  const dedupeFreshnessFeatures = buildDedupeFreshnessFeaturesModule({
    normalizedTitle,
    normalizedCompany,
    normalizedLocation,
    normalizedSourceDomain,
    dedupeFeatures,
    freshnessFeatures,
    sourceFreshnessTier,
    sourceDecayRisk
  });
  const deprecatedFieldAliases = buildDeprecatedFeatureAliases({
    rolePurity,
    sourceFreshnessTier,
    freshnessTier: freshnessFeatures.freshnessTier,
    sourceDecayRisk
  });
  return {
    standardRoleFamily,
    isCrossIndustrySafe,
    highValueCompositeRole,
    isMixedRoleJD,
    // 兼容旧字段名，避免已有消费方断裂。
    informationDensity: jdInformationDensity,
    sourceQualityTier,
    titleClarity,
    jdInformationDensity,
    likelyBundledJD,
    likelySingleRoleJD,
    confidenceTier,
    sourceReliabilityTier,
    sourceReliabilityScore,
    sourceCompletenessTier,
    sourceRiskFlags,
    sourceTrustScore,
    sourceAuthorityTier,
    sourceFreshnessDecay,
    sourceDuplicationRisk,
    sourceCompletenessScore,
    sourceCommercialNoiseRisk,
    sourceRecruitmentAuthenticity,
    productionSourceConfidence,
    sourceGovernanceTier,
    sourceMaturityLevel,
    sourceHistoricalReliability,
    sourceCoverageDensity,
    sourceVerticalStrength,
    sourceDecayRisk,
    sourceFraudRisk,
    sourcePromotionEligibility,
    sourceGovernanceSummary,
    sourceStrengthSummary,
    sourcePromotionBlockReason,
    normalizedTitle,
    normalizedCompany,
    normalizedLocation,
    normalizedSourceDomain,
    duplicateClusterId: dedupeFeatures.duplicateClusterId,
    duplicateConfidence: dedupeFeatures.duplicateConfidence,
    likelyDuplicate: dedupeFeatures.likelyDuplicate,
    canonicalPrimaryPosting: dedupeFeatures.canonicalPrimaryPosting,
    duplicateSourceCount: dedupeFeatures.duplicateSourceCount,
    postingAgeDays: freshnessFeatures.postingAgeDays,
    freshnessScore: freshnessFeatures.freshnessScore,
    freshnessTier: freshnessFeatures.freshnessTier,
    staleRisk: freshnessFeatures.staleRisk,
    likelyExpired: freshnessFeatures.likelyExpired,
    primaryResponsibilityRole: semanticJd.primaryResponsibilityRole,
    roleSemanticPurity: semanticJd.roleSemanticPurity,
    mustHaveSignals: semanticJd.mustHaveSignals,
    bonusSignals: semanticJd.bonusSignals,
    likelyBundledResponsibilities: semanticJd.likelyBundledResponsibilities,
    seniorityTier: semanticJd.seniorityTier,
    semanticConfidenceTier: semanticJd.semanticConfidenceTier,
    jdBlockStructureType: semanticJd.jdBlockStructureType,
    featureLayerModules: {
      semanticFeatures,
      sourceGovernanceFeatures,
      dedupeFreshnessFeatures
    },
    deprecatedFieldAliases,
    governanceContractVersion: "phase8a5"
  };
}

// 基于同一批岗位构造派生去重上下文：只用于诊断聚类，不删除 canonical job。
function buildJobDeduplicationContext(jobs = []) {
  const clusterMap = new Map();
  (Array.isArray(jobs) ? jobs : []).forEach((job) => {
    const metadata = job?.metadata && typeof job.metadata === "object" ? job.metadata : {};
    const normalizedTitle = normalizePostingTitle(job?.title || metadata?.title || "");
    const normalizedCompany = normalizeCompanyName(job?.company || metadata?.company || "");
    const normalizedLocation = normalizePostingLocation(job?.location || metadata?.location || "");
    const normalizedSourceDomain = normalizeSourceDomain(job);
    const clusterKey = buildDuplicateClusterKey({
      normalizedTitle,
      normalizedCompany,
      normalizedLocation
    });
    if (!clusterKey) return;
    if (!clusterMap.has(clusterKey)) {
      clusterMap.set(clusterKey, {
        clusterKey,
        items: [],
        sourceDomains: new Set()
      });
    }
    const cluster = clusterMap.get(clusterKey);
    cluster.items.push({
      jobId: String(job?.id || ""),
      normalizedTitle,
      normalizedCompany,
      normalizedLocation,
      normalizedSourceDomain,
      authorityRank: resolveSourceAuthorityRank(resolveSourceAuthorityTier({
        sourceReliabilityTier: resolveSourceReliabilityTier(job),
        sourceRiskFlags: [],
        job
      })),
      completenessScore: resolveSourceCompletenessScore({
        sourceCompletenessTier: resolveSourceCompletenessTier(job),
        job
      }),
      freshnessScore: resolveFreshnessFeatures({
        job,
        sourceFreshnessTier: resolveSourceFreshnessTier(job),
        sourceFreshnessDecay: resolveSourceFreshnessDecay({
          sourceFreshnessTier: resolveSourceFreshnessTier(job),
          updatedAt: job?.updatedAt || job?.createdAt || job?.postedAt || job?.publishTime || job?.publishAt
        })
      }).freshnessScore,
      updatedAt: resolvePostingTimestamp(job)
    });
    if (normalizedSourceDomain) {
      cluster.sourceDomains.add(normalizedSourceDomain);
    }
  });

  clusterMap.forEach((cluster) => {
    const sorted = cluster.items
      .slice()
      .sort((left, right) => {
        const primaryScoreLeft = left.authorityRank * 1000 + left.freshnessScore * 10 + left.completenessScore;
        const primaryScoreRight = right.authorityRank * 1000 + right.freshnessScore * 10 + right.completenessScore;
        if (primaryScoreRight !== primaryScoreLeft) return primaryScoreRight - primaryScoreLeft;
        return right.updatedAt - left.updatedAt;
      });
    cluster.primaryJobId = sorted[0]?.jobId || "";
    cluster.duplicateSourceCount = Math.max(1, cluster.sourceDomains.size || 0);
  });
  return { clusterMap };
}

// 标准化岗位标题：仅用于派生去重聚类，不回写 canonical。
function normalizePostingTitle(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[【】\[\]()（）]/g, " ")
    .replace(/\b(急招|诚聘|校招|社招|实习|全职)\b/g, " ")
    .replace(/[\/|、，,；;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 标准化公司名：去掉常见法务后缀，避免同公司多写法导致聚类失败。
function normalizeCompanyName(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s()（）]/g, "")
    .replace(/(股份有限公司|有限责任公司|有限公司|集团|控股|科技|技术|信息技术|软件|公司)$/g, "")
    .trim();
}

// 标准化地点：压缩常见后缀，仅保留城市级信号。
function normalizePostingLocation(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s/|、，,；;]+/g, " ")
    .replace(/(市|省|自治区|特别行政区)$/g, "")
    .trim();
}

// 统一来源域名：用于诊断来源重复，不参与 production 排序。
function normalizeSourceDomain(job = {}) {
  const candidates = [job.applyUrl, job.jobUrl, job.sourceUrl];
  for (const rawValue of candidates) {
    const raw = String(rawValue || "").trim();
    if (!raw) continue;
    try {
      const url = new URL(raw);
      return String(url.hostname || "").toLowerCase().replace(/^www\./, "").trim();
    } catch (error) {
      const matched = raw.match(/([a-z0-9-]+\.)+[a-z]{2,}/i);
      if (matched) {
        return String(matched[0] || "").toLowerCase().replace(/^www\./, "").trim();
      }
    }
  }
  return "";
}

function buildDuplicateClusterKey({
  normalizedTitle = "",
  normalizedCompany = "",
  normalizedLocation = ""
} = {}) {
  if (!normalizedTitle || !normalizedCompany) return "";
  return `${normalizedCompany}::${normalizedTitle}::${normalizedLocation || "unknown_location"}`;
}

function resolveSourceAuthorityRank(tier = "unknown") {
  const normalized = String(tier || "").trim().toLowerCase();
  if (normalized === "official_company") return 6;
  if (normalized === "verified_ats") return 5;
  if (normalized === "direct_recruiter") return 4;
  if (normalized === "quality_repost") return 3;
  if (normalized === "aggregator") return 2;
  if (normalized === "unknown") return 1;
  return 0;
}

function resolveDedupeFeatures({
  job = {},
  normalizedTitle = "",
  normalizedCompany = "",
  normalizedLocation = "",
  normalizedSourceDomain = "",
  titleClarity = "medium",
  rolePurity = "medium",
  likelyBundledJD = false,
  sourceAuthorityTier = "unknown",
  sourceCompletenessScore = 60,
  dedupeContext = null
} = {}) {
  const clusterKey = buildDuplicateClusterKey({
    normalizedTitle,
    normalizedCompany,
    normalizedLocation
  });
  const cluster =
    clusterKey && dedupeContext?.clusterMap instanceof Map ? dedupeContext.clusterMap.get(clusterKey) : null;
  const items = Array.isArray(cluster?.items) ? cluster.items : [];
  const duplicateSourceCount = Number(cluster?.duplicateSourceCount || 0);
  const clusterSize = items.length;
  const currentJobId = String(job?.id || "");
  const primaryJobId = String(cluster?.primaryJobId || currentJobId);
  const canonicalPrimaryPosting = primaryJobId ? primaryJobId === currentJobId : true;
  let duplicateConfidence = 0;
  if (clusterSize >= 2) {
    duplicateConfidence += 0.45;
    if (duplicateSourceCount >= 2) duplicateConfidence += 0.2;
    if (normalizedLocation) duplicateConfidence += 0.08;
    if (titleClarity === "high") duplicateConfidence += 0.07;
    if (rolePurity === "high") duplicateConfidence += 0.07;
    if (sourceCompletenessScore >= 80) duplicateConfidence += 0.05;
    if (normalizedSourceDomain) duplicateConfidence += 0.03;
    if (likelyBundledJD) duplicateConfidence -= 0.08;
    if (["official_company", "verified_ats"].includes(String(sourceAuthorityTier || "").trim().toLowerCase())) {
      duplicateConfidence += 0.03;
    }
  }
  duplicateConfidence = Math.max(0, Math.min(1, Number(duplicateConfidence.toFixed(2))));
  return {
    duplicateClusterId: clusterKey || null,
    duplicateConfidence,
    likelyDuplicate: clusterSize >= 2 && duplicateConfidence >= 0.55,
    canonicalPrimaryPosting,
    duplicateSourceCount: clusterSize >= 2 ? Math.max(duplicateSourceCount, 1) : 1
  };
}

function resolvePostingTimestamp(job = {}) {
  const candidates = [job.updatedAt, job.createdAt, job.postedAt, job.publishTime, job.publishAt];
  for (const candidate of candidates) {
    const parsed = Date.parse(String(candidate || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return NaN;
}

function resolveFreshnessFeatures({ job = {}, sourceFreshnessTier = "unknown", sourceFreshnessDecay = 0.28 } = {}) {
  const timestamp = resolvePostingTimestamp(job);
  const hasTimestamp = Number.isFinite(timestamp);
  const postingAgeDays = hasTimestamp ? Math.max(0, Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000))) : null;
  const tier = String(sourceFreshnessTier || "").trim().toLowerCase();
  let freshnessTier = "unknown";
  if (hasTimestamp) {
    if (postingAgeDays <= 7) freshnessTier = "fresh";
    else if (postingAgeDays <= 30) freshnessTier = "recent";
    else if (postingAgeDays <= 90) freshnessTier = "aging";
    else freshnessTier = "stale";
  } else if (tier === "fresh" || tier === "recent" || tier === "stale") {
    freshnessTier = tier;
  }
  const freshnessScore = Math.max(1, Math.min(100, Math.round(100 - Number(sourceFreshnessDecay || 0.28) * 100)));
  const staleRisk = freshnessTier === "stale" ? "high" : freshnessTier === "aging" ? "medium" : freshnessTier === "unknown" ? "unknown" : "low";
  const likelyExpired = Boolean((postingAgeDays !== null && postingAgeDays > 120) || freshnessTier === "stale");
  return {
    postingAgeDays,
    freshnessScore,
    freshnessTier,
    staleRisk,
    likelyExpired
  };
}

// 推断来源可靠性分层：仅 derived，不回写 canonical。
function resolveSourceReliabilityTier(job = {}) {
  const metadata = job.metadata && typeof job.metadata === "object" ? job.metadata : {};
  const sourceTexts = [
    job.sourcePlatform,
    job.sourceLabel,
    metadata.source,
    metadata.sourceType,
    metadata.sourceTag,
    job.sourceUrl,
    job.jobUrl,
    job.applyUrl
  ]
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);
  const sourceJoined = sourceTexts.join(" ");
  if (!sourceJoined) return "unknown";

  if (SOURCE_RELIABILITY_KEYWORDS.official_ats.some((item) => includesKeyword(sourceJoined, item))) {
    return "official_ats";
  }
  if (SOURCE_RELIABILITY_KEYWORDS.company_career_page.some((item) => includesKeyword(sourceJoined, item))) {
    return "company_career_page";
  }
  if (SOURCE_RELIABILITY_KEYWORDS.recruiter_repost.some((item) => includesKeyword(sourceJoined, item))) {
    return "recruiter_repost";
  }
  if (SOURCE_RELIABILITY_KEYWORDS.aggregator.some((item) => includesKeyword(sourceJoined, item))) {
    return "aggregator";
  }
  if (includesKeyword(sourceJoined, "curated")) {
    return "low_confidence";
  }
  return "unknown";
}

function resolveSourceReliabilityScore(tier = "") {
  const normalized = String(tier || "").trim().toLowerCase();
  if (normalized === "official_ats") return 90;
  if (normalized === "company_career_page") return 82;
  if (normalized === "recruiter_repost") return 65;
  if (normalized === "aggregator") return 50;
  if (normalized === "low_confidence") return 30;
  return 45;
}

function resolveSourceFreshnessTier(job = {}) {
  const candidates = [job.updatedAt, job.createdAt, job.postedAt, job.publishTime, job.publishAt];
  const timestamp = candidates
    .map((item) => Date.parse(String(item || "")))
    .find((value) => Number.isFinite(value));
  if (!Number.isFinite(timestamp)) return "unknown";
  const ageDays = Math.max(0, (Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  if (ageDays <= 14) return "fresh";
  if (ageDays <= 45) return "recent";
  return "stale";
}

function resolveSourceCompletenessTier(job = {}) {
  const title = String(job.title || "").trim();
  const company = String(job.company || "").trim();
  const location = String(job.location || "").trim();
  const description = String(job.jdRaw || job.description || "").trim();
  const applyUrl = String(job.applyUrl || job.jobUrl || "").trim();
  const fulfilled = [title, company, location, description.length >= 120 ? "description" : "", applyUrl].filter(Boolean)
    .length;
  if (fulfilled >= 5) return "high";
  if (fulfilled >= 3) return "medium";
  return "low";
}

function resolveSourceRiskFlags({
  job = {},
  sourceReliabilityTier = "unknown",
  sourceFreshnessTier = "unknown",
  sourceCompletenessTier = "medium",
  likelyBundledJD = false
} = {}) {
  const flags = [];
  if (sourceReliabilityTier === "unknown") flags.push("unknown_source");
  if (sourceReliabilityTier === "low_confidence") flags.push("low_confidence_source");
  if (sourceReliabilityTier === "aggregator") flags.push("aggregator_source");
  if (sourceFreshnessTier === "stale") flags.push("stale_source");
  if (sourceFreshnessTier === "unknown") flags.push("unknown_freshness");
  if (sourceCompletenessTier === "low") flags.push("incomplete_source_fields");
  if (likelyBundledJD) flags.push("bundled_jd");
  if (!String(job.applyUrl || job.jobUrl || "").trim()) flags.push("missing_apply_url");
  return unique(flags);
}

function resolveSourceAuthorityTier({ sourceReliabilityTier = "unknown", sourceRiskFlags = [], job = {} } = {}) {
  const tier = String(sourceReliabilityTier || "").trim().toLowerCase();
  const flags = Array.isArray(sourceRiskFlags) ? sourceRiskFlags : [];
  const urlCorpus = `${String(job.applyUrl || "")} ${String(job.jobUrl || "")} ${String(job.sourceUrl || "")}`.toLowerCase();
  if (flags.includes("low_confidence_source")) return "spam_risk";
  if (tier === "official_ats") return "verified_ats";
  if (tier === "company_career_page") return "official_company";
  if (tier === "recruiter_repost") return "direct_recruiter";
  if (tier === "aggregator") return "aggregator";
  if (includesKeyword(urlCorpus, "linkedin.com") || includesKeyword(urlCorpus, "zhipin.com")) return "quality_repost";
  return "unknown";
}

function resolveSourceFreshnessDecay({ sourceFreshnessTier = "unknown", updatedAt = "" } = {}) {
  const tier = String(sourceFreshnessTier || "").trim().toLowerCase();
  const parsed = Date.parse(String(updatedAt || ""));
  if (!Number.isFinite(parsed)) {
    if (tier === "fresh") return 0.05;
    if (tier === "recent") return 0.18;
    if (tier === "stale") return 0.45;
    return 0.28;
  }
  const ageDays = Math.max(0, (Date.now() - parsed) / (24 * 60 * 60 * 1000));
  if (ageDays <= 7) return 0.03;
  if (ageDays <= 21) return 0.1;
  if (ageDays <= 45) return 0.22;
  if (ageDays <= 90) return 0.35;
  return 0.5;
}

function resolveSourceCompletenessScore({ sourceCompletenessTier = "medium", job = {} } = {}) {
  const tier = String(sourceCompletenessTier || "").trim().toLowerCase();
  const title = String(job.title || "").trim();
  const company = String(job.company || "").trim();
  const location = String(job.location || "").trim();
  const description = String(job.jdRaw || job.description || "").trim();
  const applyUrl = String(job.applyUrl || job.jobUrl || "").trim();
  const base = tier === "high" ? 88 : tier === "medium" ? 65 : 38;
  let bonus = 0;
  if (title.length >= 4) bonus += 2;
  if (company.length >= 2) bonus += 2;
  if (location.length >= 2) bonus += 2;
  if (description.length >= 180) bonus += 3;
  if (applyUrl) bonus += 3;
  return Math.max(10, Math.min(100, base + bonus));
}

function resolveSourceDuplicationRisk({ title = "", job = {} } = {}) {
  const titleText = String(title || "").toLowerCase();
  const sourceText = `${String(job.sourceLabel || "")} ${String(job.sourcePlatform || "")} ${String(job.company || "")}`.toLowerCase();
  const titlePieces = titleText.split(/[\/|、，,；;]+/).map((item) => item.trim()).filter(Boolean);
  let risk = 0.08;
  if (titlePieces.length >= 4) risk += 0.22;
  if (/管培生|综合岗|多个岗位|岗位合集|方向类/.test(titleText)) risk += 0.24;
  if (/聚合|转载|转发|repost/.test(sourceText)) risk += 0.18;
  return Math.max(0, Math.min(1, risk));
}

function resolveSourceCommercialNoiseRisk({ title = "", description = "", job = {} } = {}) {
  const text = `${String(title || "")} ${String(description || "").slice(0, 1200)} ${String(job.company || "")}`.toLowerCase();
  let risk = 0.05;
  if (/高薪|日结|轻松|不限经验|包过|速投|急招|内推保过|培训后上岗/.test(text)) risk += 0.35;
  if (/销售|地推|拉新/.test(text) && /数据分析|算法|产品经理/.test(text)) risk += 0.2;
  if (String(description || "").trim().length < 120) risk += 0.18;
  return Math.max(0, Math.min(1, risk));
}

function resolveSourceRecruitmentAuthenticity({ job = {}, sourceAuthorityTier = "unknown", sourceCommercialNoiseRisk = 0 } = {}) {
  const applyUrl = String(job.applyUrl || job.jobUrl || "").trim();
  const desc = String(job.jdRaw || job.description || "").trim();
  const hasApplyPath = Boolean(applyUrl);
  if (!hasApplyPath) return "low";
  if (sourceCommercialNoiseRisk >= 0.45) return "low";
  if (["official_company", "verified_ats"].includes(String(sourceAuthorityTier || "").trim().toLowerCase()) && desc.length >= 160) {
    return "high";
  }
  if (desc.length >= 100) return "medium";
  return "low";
}

function resolveSourceTrustScore({
  sourceAuthorityTier = "unknown",
  sourceFreshnessDecay = 0.2,
  sourceDuplicationRisk = 0.1,
  sourceCompletenessScore = 60,
  sourceCommercialNoiseRisk = 0.1,
  sourceRecruitmentAuthenticity = "medium",
  sourceRiskFlags = []
} = {}) {
  const authorityBaseMap = {
    official_company: 90,
    verified_ats: 88,
    direct_recruiter: 72,
    quality_repost: 66,
    aggregator: 52,
    spam_risk: 25,
    unknown: 50
  };
  const authKey = String(sourceAuthorityTier || "").trim().toLowerCase();
  const base = Number(authorityBaseMap[authKey] || 50);
  const completenessLift = (Number(sourceCompletenessScore || 60) - 60) * 0.35;
  const freshnessPenalty = Number(sourceFreshnessDecay || 0) * 28;
  const duplicatePenalty = Number(sourceDuplicationRisk || 0) * 24;
  const noisePenalty = Number(sourceCommercialNoiseRisk || 0) * 26;
  const authenticityBonus =
    sourceRecruitmentAuthenticity === "high" ? 6 : sourceRecruitmentAuthenticity === "medium" ? 2 : -8;
  const riskPenalty = (Array.isArray(sourceRiskFlags) ? sourceRiskFlags.length : 0) * 1.8;
  const score = base + completenessLift + authenticityBonus - freshnessPenalty - duplicatePenalty - noisePenalty - riskPenalty;
  return Math.max(1, Math.min(100, Math.round(score)));
}

function resolveProductionSourceConfidence({
  sourceTrustScore = 50,
  sourceAuthorityTier = "unknown",
  sourceCommercialNoiseRisk = 0,
  sourceRiskFlags = []
} = {}) {
  const score = Number(sourceTrustScore || 0);
  const authority = String(sourceAuthorityTier || "").trim().toLowerCase();
  const noise = Number(sourceCommercialNoiseRisk || 0);
  const flags = Array.isArray(sourceRiskFlags) ? sourceRiskFlags : [];
  if (score >= 78 && ["official_company", "verified_ats", "direct_recruiter"].includes(authority) && noise < 0.28) return "high";
  if (score >= 56 && !flags.includes("low_confidence_source")) return "medium";
  return "low";
}

function resolveSourceGovernanceTier({
  sourceAuthorityTier = "unknown",
  productionSourceConfidence = "medium",
  sourceFraudRisk = "low"
} = {}) {
  const authority = String(sourceAuthorityTier || "").trim().toLowerCase();
  const confidence = String(productionSourceConfidence || "").trim().toLowerCase();
  const fraudRisk = String(sourceFraudRisk || "").trim().toLowerCase();
  if (fraudRisk === "high" || authority === "spam_risk") return "low_maturity_source";
  if (["official_company", "verified_ats"].includes(authority) && confidence === "high") return "trusted_official_source";
  if (authority === "direct_recruiter" && confidence !== "low") return "verified_recruiting_source";
  if (authority === "aggregator") return "aggregated_source";
  if (authority === "quality_repost") return "repost_source";
  return "exploratory_source";
}

function resolveSourceHistoricalReliability({
  sourceTrustScore = 50,
  sourceAuthorityTier = "unknown",
  sourceRiskFlags = []
} = {}) {
  const authority = String(sourceAuthorityTier || "").trim().toLowerCase();
  const flags = Array.isArray(sourceRiskFlags) ? sourceRiskFlags : [];
  const score = Number(sourceTrustScore || 0);
  if (["official_company", "verified_ats"].includes(authority) && score >= 80 && flags.length <= 1) return "high";
  if (score >= 58 && !flags.includes("low_confidence_source")) return "medium";
  return "low";
}

function resolveSourceCoverageDensity({
  sourceCompletenessScore = 60,
  duplicateSourceCountHint = 1,
  normalizedSourceDomain = ""
} = {}) {
  const completeness = Number(sourceCompletenessScore || 0);
  const duplicateCount = Number(duplicateSourceCountHint || 1);
  const hasDomain = Boolean(String(normalizedSourceDomain || "").trim());
  if (completeness >= 82 && duplicateCount >= 2 && hasDomain) return "dense";
  if (completeness >= 58 && hasDomain) return "medium";
  return "sparse";
}

function resolveSourceVerticalStrength({
  classification = {},
  sourceAuthorityTier = "unknown",
  normalizedSourceDomain = "",
  sourceTrustScore = 50,
  sourceQualityTier = "medium"
} = {}) {
  const roleFamily = String(classification.inferredRoleFamily || classification.primaryRole || "").trim();
  const industry = String(classification.inferredIndustry || "").trim();
  const domain = String(normalizedSourceDomain || "").trim().toLowerCase();
  const authority = String(sourceAuthorityTier || "").trim().toLowerCase();
  const score = Number(sourceTrustScore || 0);
  const roleCorpus = `${roleFamily} ${industry}`.toLowerCase();
  const isPriorityVertical =
    includesAny(roleCorpus, ["数据分析", "商业分析", "bi", "产品经理", "算法工程师", "ai工程师", "自动驾驶", "金融研究", "教育科研"]);
  if (!isPriorityVertical) return "general";
  const hasVerticalSignal =
    includesAny(domain, ["campus", "career", "jobs", "zhipin", "linkedin", "lagou", "liepin"]) ||
    ["official_company", "verified_ats", "direct_recruiter"].includes(authority);
  if (hasVerticalSignal && score >= 76 && sourceQualityTier !== "low") return "high";
  if (hasVerticalSignal && score >= 56) return "medium";
  return "low";
}

function resolveSourceDecayRisk({ sourceFreshnessDecay = 0.28, staleRisk = "unknown" } = {}) {
  const decay = Number(sourceFreshnessDecay || 0);
  const stale = String(staleRisk || "").trim().toLowerCase();
  if (stale === "high" || decay >= 0.42) return "high";
  if (stale === "medium" || decay >= 0.22) return "medium";
  return "low";
}

function resolveSourceFraudRisk({
  sourceAuthorityTier = "unknown",
  sourceCommercialNoiseRisk = 0,
  sourceRiskFlags = [],
  sourceRecruitmentAuthenticity = "medium"
} = {}) {
  const authority = String(sourceAuthorityTier || "").trim().toLowerCase();
  const noise = Number(sourceCommercialNoiseRisk || 0);
  const authenticity = String(sourceRecruitmentAuthenticity || "").trim().toLowerCase();
  const flags = Array.isArray(sourceRiskFlags) ? sourceRiskFlags : [];
  if (authority === "spam_risk" || noise >= 0.45 || authenticity === "low") return "high";
  if (authority === "aggregator" || noise >= 0.22 || flags.includes("missing_apply_url")) return "medium";
  return "low";
}

function resolveSourceMaturityLevel({
  sourceGovernanceTier = "exploratory_source",
  sourceHistoricalReliability = "medium",
  sourceVerticalStrength = "general",
  sourceFraudRisk = "low",
  sourceDecayRisk = "low"
} = {}) {
  const governanceTier = String(sourceGovernanceTier || "").trim().toLowerCase();
  const historical = String(sourceHistoricalReliability || "").trim().toLowerCase();
  const vertical = String(sourceVerticalStrength || "").trim().toLowerCase();
  const fraud = String(sourceFraudRisk || "").trim().toLowerCase();
  const decay = String(sourceDecayRisk || "").trim().toLowerCase();
  if (fraud === "high") return "exploratory";
  if (governanceTier === "trusted_official_source" && historical === "high" && decay === "low") return "production_grade";
  if (["trusted_official_source", "verified_recruiting_source"].includes(governanceTier) && historical !== "low" && vertical !== "low") {
    return "trusted";
  }
  if (["aggregated_source", "repost_source"].includes(governanceTier) || historical === "medium") return "stable";
  return "exploratory";
}

function resolveSourcePromotionEligibility({
  sourceGovernanceTier = "exploratory_source",
  sourceMaturityLevel = "exploratory",
  sourceFraudRisk = "low",
  sourceDecayRisk = "low",
  sourceVerticalStrength = "general"
} = {}) {
  const governanceTier = String(sourceGovernanceTier || "").trim().toLowerCase();
  const maturity = String(sourceMaturityLevel || "").trim().toLowerCase();
  const fraud = String(sourceFraudRisk || "").trim().toLowerCase();
  const decay = String(sourceDecayRisk || "").trim().toLowerCase();
  const vertical = String(sourceVerticalStrength || "").trim().toLowerCase();
  if (fraud === "high" || governanceTier === "low_maturity_source") return "blocked";
  if (maturity === "production_grade" && vertical !== "low" && decay !== "high") return "production_candidate";
  if (["trusted", "stable"].includes(maturity)) return "review_candidate";
  return "diagnostic_only";
}

function buildSourcePromotionBlockReason({
  sourcePromotionEligibility = "diagnostic_only",
  sourceFraudRisk = "low",
  sourceDecayRisk = "low",
  sourceVerticalStrength = "general"
} = {}) {
  const eligibility = String(sourcePromotionEligibility || "").trim().toLowerCase();
  if (eligibility === "production_candidate") return "";
  if (eligibility === "blocked") {
    if (String(sourceFraudRisk || "").trim().toLowerCase() === "high") return "来源欺诈或商业导流风险过高，禁止进入更高成熟层。";
    return "来源成熟度不足，当前仅适合作为诊断层信号。";
  }
  if (String(sourceDecayRisk || "").trim().toLowerCase() === "high") return "来源时效衰减明显，暂不建议提升治理等级。";
  if (String(sourceVerticalStrength || "").trim().toLowerCase() === "low") return "该来源在目标赛道的长期质量支撑不足，暂不建议提升。";
  return "当前来源仍需继续观察，暂不自动提升治理等级。";
}

function buildSourceStrengthSummary({
  sourceVerticalStrength = "general",
  classification = {},
  sourceAuthorityTier = "unknown"
} = {}) {
  const vertical = String(sourceVerticalStrength || "").trim().toLowerCase();
  const roleFamily = String(classification.inferredRoleFamily || classification.primaryRole || "当前方向").trim() || "当前方向";
  const authority = String(sourceAuthorityTier || "").trim().toLowerCase();
  if (vertical === "high") {
    return `该来源在${roleFamily}相关赛道具有较强长期质量支撑。`;
  }
  if (vertical === "medium") {
    return `该来源可为${roleFamily}方向提供中等可信度参考。`;
  }
  if (vertical === "low") {
    return `该来源在${roleFamily}方向的长期质量支撑偏弱。`;
  }
  if (["official_company", "verified_ats"].includes(authority)) {
    return "该来源整体可信，但赛道强度仍以通用质量为主。";
  }
  return "该来源更适合作为通用参考，赛道级质量仍需继续观察。";
}

function buildSourceGovernanceSummary({
  sourceGovernanceTier = "exploratory_source",
  sourceMaturityLevel = "exploratory",
  sourceHistoricalReliability = "medium",
  sourceVerticalStrength = "general",
  sourcePromotionEligibility = "diagnostic_only",
  sourcePromotionBlockReason = ""
} = {}) {
  const tier = String(sourceGovernanceTier || "").trim().toLowerCase();
  const maturity = String(sourceMaturityLevel || "").trim().toLowerCase();
  const historical = String(sourceHistoricalReliability || "").trim().toLowerCase();
  const vertical = String(sourceVerticalStrength || "").trim().toLowerCase();
  if (sourcePromotionEligibility === "production_candidate") {
    return "该来源已具备较高成熟度，可作为未来生产级治理候选。";
  }
  if (tier === "trusted_official_source" && maturity === "trusted") {
    return "该来源具备较强官方可信度，但仍处于治理观察期。";
  }
  if (historical === "low" || vertical === "low") {
    return sourcePromotionBlockReason || "该来源成熟度有限，当前更适合作为诊断层参考。";
  }
  return "该来源治理信息已可用，但当前仍保持诊断优先，不直接进入生产治理主线。";
}

function parseSemanticJDBlocks({ title = "", description = "", classification = {} } = {}) {
  const titleText = String(title || "");
  const jdText = String(description || "");
  const text = `${titleText}\n${jdText}`;
  const normalized = normalizeText(text);
  const responsibilityBlock = extractBlockByHeaders(jdText, RESPONSIBILITY_HEADERS);
  const mustHaveBlock = extractBlockByHeaders(jdText, MUST_HAVE_HEADERS);
  const bonusBlock = extractBlockByHeaders(jdText, BONUS_HEADERS);
  const primaryResponsibilityRole = resolvePrimaryResponsibilityRole({
    titleText,
    responsibilityBlock,
    fallbackRole: classification.primaryRole || classification.inferredRoleFamily || ""
  });
  const mustHaveSignals = extractRequirementSignals(mustHaveBlock || jdText, MUST_HAVE_SKILL_KEYWORDS, 6);
  const bonusSignals = extractRequirementSignals(bonusBlock, MUST_HAVE_SKILL_KEYWORDS, 6);
  const likelyBundledResponsibilities = detectBundledResponsibilities({
    titleText,
    responsibilityBlock: responsibilityBlock || jdText
  });
  const seniorityTier = resolveSeniorityTier(`${titleText}\n${mustHaveBlock}\n${jdText}`);
  const roleSemanticPurity = resolveRoleSemanticPurity({
    primaryResponsibilityRole,
    titleText,
    responsibilityBlock: responsibilityBlock || jdText,
    likelyBundledResponsibilities
  });
  const jdBlockStructureType = resolveJdBlockStructureType({
    titleText,
    roleSemanticPurity,
    likelyBundledResponsibilities,
    seniorityTier,
    mustHaveSignals,
    bonusSignals,
    fullText: text
  });
  const semanticConfidenceTier = resolveSemanticConfidenceTier({
    jdBlockStructureType,
    roleSemanticPurity,
    mustHaveSignals,
    hasResponsibilityBlock: Boolean(responsibilityBlock),
    jdLength: jdText.length
  });
  return {
    primaryResponsibilityRole,
    roleSemanticPurity,
    mustHaveSignals,
    bonusSignals,
    likelyBundledResponsibilities,
    seniorityTier,
    semanticConfidenceTier,
    jdBlockStructureType
  };
}

function extractBlockByHeaders(text = "", headers = []) {
  const source = String(text || "");
  if (!source) return "";
  for (const header of headers) {
    if (!header) continue;
    const index = source.toLowerCase().indexOf(String(header).toLowerCase());
    if (index < 0) continue;
    const tail = source.slice(index, Math.min(source.length, index + 320));
    return tail.trim();
  }
  return "";
}

function resolvePrimaryResponsibilityRole({ titleText = "", responsibilityBlock = "", fallbackRole = "" } = {}) {
  const corpus = `${titleText}\n${responsibilityBlock}`;
  const scored = RESPONSIBILITY_ROLE_PATTERNS.map((entry) => {
    const hit = entry.keywords.reduce((acc, keyword) => (includesKeyword(corpus, keyword) ? acc + 1 : acc), 0);
    return { role: entry.role, score: hit };
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.role || String(fallbackRole || "").trim() || "未知";
}

function extractRequirementSignals(text = "", skillKeywords = [], limit = 6) {
  const source = normalizeText(text);
  if (!source) return [];
  const hits = [];
  for (const keyword of skillKeywords) {
    if (includesKeyword(source, keyword)) {
      hits.push(normalizeSkillToken(keyword));
    }
    if (hits.length >= limit) break;
  }
  return unique(hits).slice(0, limit);
}

function detectBundledResponsibilities({ titleText = "", responsibilityBlock = "" } = {}) {
  const title = String(titleText || "");
  const block = String(responsibilityBlock || "");
  const titlePieces = title.split(BUNDLED_ROLE_SEPARATORS).map((item) => String(item || "").trim()).filter(Boolean);
  const roleAnchorHits = ROLE_ANCHOR_KEYWORDS.reduce(
    (acc, keyword) => acc + (includesKeyword(title, keyword) ? 1 : 0),
    0
  );
  const crossDomainPattern = /(产品|运营|市场|销售).*(算法|研发|工程)|((算法|研发|工程).*(产品|运营|市场|销售))/i.test(`${title} ${block}`);
  return titlePieces.length >= 4 || roleAnchorHits >= 3 || crossDomainPattern;
}

function resolveSeniorityTier(text = "") {
  const source = normalizeText(text);
  if (!source) return "unknown";
  if (includesKeyword(source, "实习") || includesKeyword(source, "intern") || includesKeyword(source, "校招")) return "intern";
  if (includesKeyword(source, "应届") || includesKeyword(source, "junior") || includesKeyword(source, "初级")) return "entry";
  if (includesKeyword(source, "高级") || includesKeyword(source, "senior") || includesKeyword(source, "资深")) return "senior";
  if (includesKeyword(source, "负责人") || includesKeyword(source, "leader") || includesKeyword(source, "主管")) return "lead";
  return "mid";
}

function resolveRoleSemanticPurity({
  primaryResponsibilityRole = "",
  titleText = "",
  responsibilityBlock = "",
  likelyBundledResponsibilities = false
} = {}) {
  if (likelyBundledResponsibilities) return "low";
  const corpus = `${titleText}\n${responsibilityBlock}`;
  const roleHits = RESPONSIBILITY_ROLE_PATTERNS.filter((entry) =>
    entry.keywords.some((keyword) => includesKeyword(corpus, keyword))
  ).length;
  if (roleHits <= 1 && primaryResponsibilityRole && primaryResponsibilityRole !== "未知") return "high";
  if (roleHits <= 2) return "medium";
  return "low";
}

function resolveJdBlockStructureType({
  titleText = "",
  roleSemanticPurity = "medium",
  likelyBundledResponsibilities = false,
  seniorityTier = "mid",
  mustHaveSignals = [],
  bonusSignals = [],
  fullText = ""
} = {}) {
  const source = normalizeText(`${titleText}\n${fullText}`);
  if (!source || source.length < 120) return "unclear_low_signal";
  if (seniorityTier === "intern") return "internship_rotation";
  if (likelyBundledResponsibilities) return "bundled_multi_role";
  if (/综合|方向|岗位合集|人才池|管培生/.test(source)) return "broad_recruitment";
  const hasComposite = detectHighValueCompositeRole({
    title: titleText,
    description: fullText,
    roleCorpus: `${mustHaveSignals.join(" ")} ${bonusSignals.join(" ")}`
  });
  if (hasComposite && roleSemanticPurity !== "low") return "composite_high_value";
  if (roleSemanticPurity === "high") return "clean_single_role";
  return "unclear_low_signal";
}

function resolveSemanticConfidenceTier({
  jdBlockStructureType = "unclear_low_signal",
  roleSemanticPurity = "medium",
  mustHaveSignals = [],
  hasResponsibilityBlock = false,
  jdLength = 0
} = {}) {
  if (jdBlockStructureType === "clean_single_role" && roleSemanticPurity === "high" && mustHaveSignals.length >= 2) return "high";
  if (jdBlockStructureType === "composite_high_value" && roleSemanticPurity !== "low") return "high";
  if (jdBlockStructureType === "bundled_multi_role" || jdBlockStructureType === "unclear_low_signal") return "low";
  if (hasResponsibilityBlock && jdLength >= 180) return "medium";
  return "low";
}

function detectHighValueCompositeRole({ title = "", description = "", roleCorpus = "" } = {}) {
  const text = `${String(title || "")} ${String(description || "").slice(0, 800)} ${String(roleCorpus || "")}`.toLowerCase();
  return HIGH_VALUE_COMPOSITE_ROLE_PATTERNS.some((pair) => {
    const [left, right] = pair;
    return includesKeyword(text, left) && includesKeyword(text, right);
  });
}

function resolveTitleClarity({ title = "", classification = {}, isMixedRoleJD = false, highValueCompositeRole = false } = {}) {
  const text = String(title || "").trim();
  if (!text) return "low";
  if (highValueCompositeRole) return "high";
  if (isMixedRoleJD) return "low";
  if (/综合|方向类|支持类|岗位合集|岗位汇总|多岗位/.test(text)) return "low";
  const roleSignals = ROLE_ANCHOR_KEYWORDS.filter((keyword) => includesKeyword(text, keyword)).length;
  if (roleSignals >= 2) return "medium";
  if (roleSignals === 1 && String(classification.dominantRoleSegment || "").trim().length > 0) return "high";
  return "medium";
}

function resolveRolePurity({ title = "", description = "", classification = {}, isMixedRoleJD = false, highValueCompositeRole = false } = {}) {
  if (highValueCompositeRole) return "medium";
  if (isMixedRoleJD) return "low";
  const segmentCount = Array.isArray(classification.titleSegments) ? classification.titleSegments.length : 0;
  if (segmentCount >= 3) return "low";
  if (segmentCount === 2) return "medium";
  const text = `${String(title || "")} ${String(description || "").slice(0, 300)}`;
  const roleSignalCount = ROLE_ANCHOR_KEYWORDS.filter((keyword) => includesKeyword(text, keyword)).length;
  if (roleSignalCount >= 3) return "medium";
  return "high";
}

function resolveLikelyBundledJD({
  title = "",
  description = "",
  isMixedRoleJD = false,
  rolePurity = "medium",
  highValueCompositeRole = false
} = {}) {
  if (highValueCompositeRole) return false;
  const titleText = String(title || "");
  const text = `${titleText} ${String(description || "").slice(0, 400)}`;
  if (/研发类|设计类|业务支持类|综合支持类/.test(text)) return true;
  if (isMixedRoleJD && rolePurity === "low") return true;
  const delimiterHits = (text.match(/[\/|｜、，,；;]/g) || []).length;
  const titleDelimiterHits = (titleText.match(/[\/|｜、，,；;]/g) || []).length;
  const roleSignalCount = ROLE_ANCHOR_KEYWORDS.filter((keyword) => includesKeyword(text, keyword)).length;
  const hasCrossFamilyBundleHint =
    /(客户端|前端|后端|服务端)/.test(text) &&
    /(测试|产品|运营|美术|设计|销售)/.test(text);
  if (hasCrossFamilyBundleHint) return true;
  const hasExplicitBundleHint = /岗位合集|多岗位|多方向|轮岗|方向任选|方向分配|校招/.test(text);
  return delimiterHits >= 5 && roleSignalCount >= 4 && (titleDelimiterHits >= 2 || hasExplicitBundleHint);
}

function resolveSourceQualityTier({
  titleClarity = "medium",
  rolePurity = "medium",
  jdInformationDensity = 50,
  likelyBundledJD = false,
  highValueCompositeRole = false
} = {}) {
  // 岗位文本/结构质量：标题清晰度、角色纯度、信息密度、是否打包岗。
  if (highValueCompositeRole && jdInformationDensity >= 35) return "medium";
  if (likelyBundledJD || titleClarity === "low" || rolePurity === "low") return "low";
  if (jdInformationDensity >= 70 && titleClarity === "high" && rolePurity === "high") return "high";
  return "medium";
}

function resolveConfidenceTier({
  titleClarity = "medium",
  rolePurity = "medium",
  jdInformationDensity = 50,
  sourceQualityTier = "medium"
} = {}) {
  // 解析置信度：系统对当前角色/语义判断的把握程度，综合依赖质量特征但不等同于它们。
  if (sourceQualityTier === "low") return "low";
  if (titleClarity === "high" && rolePurity === "high" && jdInformationDensity >= 65) return "high";
  return "medium";
}

function resolveStandardRoleFamily(roleCorpus = "", classification = {}) {
  const corpus = String(roleCorpus || "");
  const matched = ROLE_FAMILY_ALIASES.find((group) => {
    return group.aliases.some((alias) => includesKeyword(corpus, alias));
  });
  if (matched) return matched.standardRoleFamily;
  return String(classification.inferredRoleFamily || "").trim() || null;
}

function isSingleRoleSpecializationTitle(title = "") {
  const text = String(title || "").trim();
  if (!text) return false;
  if (/[\/|｜、,，；;]/.test(text)) return false;
  const roleAnchorHits = ROLE_ANCHOR_KEYWORDS.filter((keyword) => includesKeyword(text, keyword)).length;
  if (roleAnchorHits === 0) return false;
  const hasSpecializationHint = /（[^）]*(方向|领域|平台|系统|业务|行业|专题)[^）]*）|\([^)]*(方向|领域|平台|系统|业务|行业|专题)[^)]*\)/.test(text);
  return hasSpecializationHint && !/岗位合集|多岗位|轮岗|校招合集|管培生/.test(text);
}

function detectMixedRoleJD({ title = "", description = "", classification = {} } = {}) {
  if (isSingleRoleSpecializationTitle(title)) return false;
  if (classification.mixedRoleTitle) return true;
  const segments = Array.isArray(classification.titleSegments) ? classification.titleSegments : [];
  if (segments.length >= 3) return true;
  const titleText = String(title || "");
  const titleAnchorHits = ROLE_ANCHOR_KEYWORDS.filter((keyword) => includesKeyword(titleText, keyword)).length;
  if (/[\/|｜、,，]/.test(titleText) && titleAnchorHits >= 2) return true;
  const shortDescription = String(description || "").slice(0, 800);
  const jdAnchorHits = ROLE_ANCHOR_KEYWORDS.filter((keyword) => includesKeyword(shortDescription, keyword)).length;
  return /(岗位|职位).{0,12}[\/|｜、,，]/.test(shortDescription) && jdAnchorHits >= 3;
}

function calculateInformationDensity({ title = "", description = "", classification = {} } = {}) {
  const text = `${String(title || "")} ${String(description || "")}`.trim();
  const lengthScore = Math.min(45, text.length / 35);
  const signalKeywords = [
    classification.inferredIndustry,
    classification.inferredRoleFamily,
    ...(Array.isArray(classification.inferredSkills) ? classification.inferredSkills : []),
    ...(Array.isArray(classification.inferredCompanyTypes) ? classification.inferredCompanyTypes : [])
  ].filter(Boolean);
  const signalHits = signalKeywords.filter((keyword) => includesKeyword(text, keyword)).length;
  const densityScore = Math.min(55, signalHits * 11);
  return Math.max(1, Math.min(100, Math.round(lengthScore + densityScore)));
}

function scoreJobQualityFit(jobFeaturesView = {}) {
  const features = normalizeJobFeaturesView(jobFeaturesView);
  const semanticRolePurity = String(
    features?.featureLayerModules?.semanticFeatures?.roleSemanticPurity ||
      features?.featureLayerModules?.semanticFeatures?.rolePurityLegacy ||
      "medium"
  ).trim().toLowerCase();
  let score = 55;
  if (features.highValueCompositeRole) score = Math.max(score, 60);
  if (features.likelySingleRoleJD) score += 16;
  if (features.likelyBundledJD) score -= features.highValueCompositeRole ? 0 : 12;
  if (features.titleClarity === "high") score += 10;
  else if (features.titleClarity === "low") score -= 10;
  if (semanticRolePurity === "high") score += 10;
  else if (semanticRolePurity === "low") score -= 10;
  if (features.jdInformationDensity >= 70) score += 9;
  else if (features.jdInformationDensity <= 35) score -= 9;
  if (features.sourceQualityTier === "high") score += 6;
  else if (features.sourceQualityTier === "low") score -= 8;
  if (features.confidenceTier === "high") score += 4;
  else if (features.confidenceTier === "low") score -= 4;
  if (features.highValueCompositeRole) score = Math.max(score, 58);
  return clampScore(score);
}

function buildJobQualitySummary(jobFeaturesView = {}) {
  const features = normalizeJobFeaturesView(jobFeaturesView);
  const semanticRolePurity = String(
    features?.featureLayerModules?.semanticFeatures?.roleSemanticPurity ||
      features?.featureLayerModules?.semanticFeatures?.rolePurityLegacy ||
      "medium"
  ).trim().toLowerCase();
  if (features.highValueCompositeRole) return "复合能力岗位，建议确认具体职责后推进。";
  if (features.likelyBundledJD) return "岗位信息结构较复合，建议确认主职责后再推进。";
  if (features.likelySingleRoleJD && features.sourceQualityTier === "high") return "单岗描述清晰，岗位可信度较高";
  if (features.jdInformationDensity <= 35) return "岗位信息密度偏低，建议人工复核";
  if (semanticRolePurity === "low") return "岗位角色混合度较高，建议谨慎判断";
  return "岗位信息完整度中等，可结合详情评估";
}

function scoreIndustryFit(classification = {}) {
  const prefs = classification.preferenceProfile?.industryPreference || [];
  const excluded = classification.preferenceProfile?.excludedIndustries || [];
  if (excluded.includes(classification.inferredIndustry)) return 0;
  if (prefs.length === 0) return excluded.length > 0 ? 52 : null;
  const exactMatchedPreference = prefs.some((item) =>
    normalizeIndustryAlias(item) === normalizeIndustryAlias(classification.inferredIndustry) ||
    includesKeyword(item, classification.inferredIndustry) ||
    includesKeyword(classification.inferredIndustry, item)
  );
  const relatedMatchedPreference = !exactMatchedPreference && prefs.some((item) =>
    isRelatedIndustry(item, classification.inferredIndustry)
  );
  if (!exactMatchedPreference && !relatedMatchedPreference) return 20;
  if (relatedMatchedPreference) return 20;
  const confidence = String(classification.inferredIndustryConfidence || "low").trim();
  if (confidence === "high") return 95;
  if (confidence === "medium") return 80;
  return 72;
}

function includesRoleConflictKeyword(text = "", keyword = "") {
  const normalizedKeyword = String(keyword || "").trim();
  if (!normalizedKeyword) return false;
  if (normalizedKeyword === "培训") {
    const conflictScope = String(text || "")
      .replace(/(?<!管理)培训生计划/g, "")
      .replace(/(?<!管理)培训生/g, "")
      .replace(/培训项目/g, "");
    return includesKeyword(conflictScope, normalizedKeyword);
  }
  return includesKeyword(text, normalizedKeyword);
}

function evaluateRoleFitEvidence(classification = {}, job = {}, jobFeaturesView = null) {
  const prefs = classification.preferenceProfile?.rolePreference || [];
  const excluded = classification.preferenceProfile?.excludedRoles || [];
  const metadata = job.metadata && typeof job.metadata === "object" ? job.metadata : {};
  const title = String(job.title || "");
  const corpus = [job.title,job.jdRaw,job.jd_raw,job.description,job.rawText,job.raw_text,metadata.rawText,metadata.raw_text].join(" ");
  const dominantSegment = String(classification.dominantRoleSegment || title || "");
  const dominantExcludedHit = excluded.some((item) => includesRoleConflictKeyword(dominantSegment, item));
  const secondaryExcludedHit = !dominantExcludedHit && excluded.some((item) => includesRoleConflictKeyword(corpus, item));
  if (dominantExcludedHit) return { score: 0, evidenceType: "conflicting_mixed_role" };
  if (prefs.length === 0) return { score: excluded.length > 0 ? 52 : null, evidenceType: "adjacent_role_match" };
  const normalizedFeatures = normalizeJobFeaturesView(jobFeaturesView || job.jobFeaturesView || {});
  const primaryResponsibilityRole = String(normalizedFeatures.primaryResponsibilityRole || "").trim();
  const matchedPrefs = prefs.filter((item) => item === classification.inferredRoleFamily || includesKeyword(corpus, item));
  const matched = matchedPrefs.length > 0;
  const titleMatched = prefs.some((item) => includesKeyword(title, item));
  const dominantMatched = prefs.some((item) => includesKeyword(dominantSegment, item));
  const responsibilityMatched = prefs.some((item) => includesKeyword(primaryResponsibilityRole, item));
  const roleConfidence = String(classification.inferredRoleConfidence || "low").trim().toLowerCase();
  const segmentCount = Array.isArray(classification.titleSegments) ? classification.titleSegments.length : 0;
  const normalizedJdStructureType = String(normalizedFeatures.jdBlockStructureType || "").trim().toLowerCase();
  const isBundledStructure =
    Boolean(normalizedFeatures.likelyBundledJD) ||
    ["bundled_multi_role", "broad_recruitment", "internship_rotation", "composite_high_value"].includes(normalizedJdStructureType);
  const explicitSubroleMatch =
    matched &&
    !titleMatched &&
    !dominantMatched &&
    (responsibilityMatched || (isBundledStructure && segmentCount >= 2 && roleConfidence !== "low"));
  const hasStrongMixedSignals = STRONG_MIXED_ROLE_KEYWORDS.some((keyword) => includesRoleConflictKeyword(corpus, keyword));
  const hasHardMixedConflictSignals = HARD_MIXED_ROLE_CONFLICT_KEYWORDS.some((keyword) => includesRoleConflictKeyword(corpus, keyword));
  const incidentalKeywordMatch = matched && !titleMatched && !dominantMatched && !responsibilityMatched && (isBundledStructure || roleConfidence === "low");
  const conflictingMixedRole = matched && !titleMatched && !dominantMatched && hasStrongMixedSignals && Boolean(classification.mixedRoleTitle);
  const adjacentRoleMatch = !matched && prefs.some((item) => {
    const adjacent = ROLE_ADJACENT_KEYWORD_MAP[item] || [];
    return adjacent.some((alias) => includesKeyword(String(classification.inferredRoleFamily || ""), alias) || includesKeyword(corpus, alias));
  });
  if (!matched && !adjacentRoleMatch) {
    return {
      score: secondaryExcludedHit ? 18 : 20,
      evidenceType: hasStrongMixedSignals ? "conflicting_mixed_role" : "incidental_keyword_match"
    };
  }
  let baseScore = 80;
  let evidenceType = "adjacent_role_match";
  if (dominantMatched || responsibilityMatched) baseScore = 96;
  else if (titleMatched && (isBundledStructure || segmentCount >= 4)) baseScore = 96;
  else if (titleMatched) baseScore = 96;
  else if (explicitSubroleMatch) baseScore = 96;
  else if (adjacentRoleMatch) baseScore = 62;
  else if (conflictingMixedRole) baseScore = 40;
  else if (incidentalKeywordMatch) baseScore = 48;
  if ((dominantMatched || responsibilityMatched) && !isBundledStructure) evidenceType = "primary_role_match";
  else if (titleMatched && !isBundledStructure && segmentCount < 4) evidenceType = "primary_role_match";
  else if ((titleMatched && (isBundledStructure || segmentCount >= 4)) || explicitSubroleMatch || responsibilityMatched) evidenceType = "explicit_subrole_match";
  else if (adjacentRoleMatch) evidenceType = "adjacent_role_match";
  else if (conflictingMixedRole) evidenceType = "conflicting_mixed_role";
  else if (incidentalKeywordMatch) evidenceType = "incidental_keyword_match";
  const preferredIndustries = Array.isArray(classification.preferenceProfile?.industryPreference) ? classification.preferenceProfile.industryPreference : [];
  const inferredIndustry = String(classification.inferredIndustry || "").trim();
  const industryKnown = inferredIndustry && inferredIndustry !== "其他";
  const hasStrictIndustryMismatch =
    industryKnown &&
    preferredIndustries.length > 0 &&
    !preferredIndustries.includes(inferredIndustry) &&
    !preferredIndustries.some((preferred) => isRelatedIndustry(preferred, inferredIndustry));
  const protectedExplicitRoleMatch =
    matched &&
    (titleMatched || dominantMatched || responsibilityMatched || explicitSubroleMatch) &&
    !incidentalKeywordMatch &&
    !conflictingMixedRole;
  if (hasStrictIndustryMismatch && !protectedExplicitRoleMatch) baseScore = Math.min(baseScore, 58);
  if (classification.mixedRoleTitle && (roleConfidence === "low" || segmentCount >= 4) && !protectedExplicitRoleMatch) {
    baseScore = Math.min(baseScore, 62);
  }
  if (hasHardMixedConflictSignals && !responsibilityMatched && !protectedExplicitRoleMatch) baseScore = Math.min(baseScore, 58);
  if (incidentalKeywordMatch) baseScore = Math.min(baseScore, 52);
  if (conflictingMixedRole) baseScore = Math.min(baseScore, 45);
  if (explicitSubroleMatch && normalizedFeatures.highValueCompositeRole) baseScore = Math.max(baseScore, 86);
  return {
    score: secondaryExcludedHit ? Math.max(55, baseScore - 18) : baseScore,
    evidenceType
  };
}

function scoreRoleFit(classification = {}, job = {}, jobFeaturesView = null) {
  const evaluated = evaluateRoleFitEvidence(classification, job, jobFeaturesView);
  return evaluated?.score ?? null;
}

function scoreSkillFit(classification = {}) {
  const prefs = classification.preferenceProfile?.skillPreference || [];
  if (prefs.length === 0) return null;
  const inferredSkills = Array.isArray(classification.inferredSkills) ? classification.inferredSkills : [];
  const matchedCount = prefs.filter((item) =>
    inferredSkills.some((skill) => includesKeyword(skill, item) || includesKeyword(item, skill))
  ).length;
  if (matchedCount === 0) {
    // 技能是辅助信号：未命中时保持中性偏弱，避免单独把主信号匹配岗位打到过低等级。
    return inferredSkills.length === 0 ? 52 : 48;
  }
  return Math.min(95, 50 + matchedCount * 20);
}

function scoreLocationFit(jobLocation = "", preferredLocations = []) {
  const prefs = Array.isArray(preferredLocations) ? preferredLocations : [];
  if (prefs.length === 0) return null;
  const rawLocation = String(jobLocation || "").trim();
  if (!rawLocation || /^(地点未说明|未说明|暂无|无|不限|待定|-|—|--)$/.test(rawLocation)) return null;
  const jobCity = normalizeLocation(jobLocation);
  if (!jobCity) return null;
  const exact = prefs.some((item) => String(item || "").trim().toLowerCase() === String(jobLocation || "").trim().toLowerCase());
  if (exact) return 88;
  const sameCity = prefs.some((item) => normalizeLocation(item) === jobCity);
  return sameCity ? 70 : 30;
}

function scoreCompanyFit(classification = {}, job = {}) {
  const preference = classification.preferenceProfile || {};
  const preferredTypes = Array.isArray(preference.companyPreference) ? preference.companyPreference : [];
  const avoidTypes = Array.isArray(preference.avoidCompanyTypes) ? preference.avoidCompanyTypes : [];
  const inferredTypes = Array.isArray(classification.inferredCompanyTypes) ? classification.inferredCompanyTypes : [];
  if (preferredTypes.length === 0 && avoidTypes.length === 0) return null;
  if (avoidTypes.some((item) => inferredTypes.includes(item))) return 0;
  if (preferredTypes.length === 0) return 52;
  if (preferredTypes.some((item) => inferredTypes.includes(item))) return 86;

  // 兜底：公司名/描述可能有弱信号但 taxonomy 未命中。
  const corpus = `${String(job.company || "")} ${String(job.title || "")} ${String(job.description || "")}`;
  if (preferredTypes.some((item) => includesKeyword(corpus, item))) return 72;
  return 35;
}

function scoreQualityBase(job = {}) {
  let score = 8;
  if (String(job.jobUrl || job.sourceUrl || "").trim()) score += 4;
  if (String(job.company || "").trim()) score += 2;
  if (String(job.title || "").trim().length >= 8) score += 1;
  return Math.min(15, score);
}

function buildExplanation({
  explainabilityView = {},
  feedbackReason = ""
} = {}) {
  const recommendation = String(explainabilityView.recommendationReasonSummary || "").trim();
  const blockerReason = String(explainabilityView.blockerReasonSummary || "").trim();
  const reviewTrigger = String(explainabilityView.reviewTriggerSummary || "").trim();
  const driftReason = String(explainabilityView.preferenceDriftSummary || "").trim();
  const sourceRisk = String(explainabilityView.sourceRiskSummary || "").trim();
  const positiveDrivers = normalizeExplainabilityList(explainabilityView.rankingPrimaryDrivers, 2);
  const negativeDrivers = normalizeExplainabilityList(explainabilityView.rankingNegativeDrivers, 2);
  const fragments = [
    recommendation,
    blockerReason,
    reviewTrigger,
    driftReason,
    sourceRisk,
    ...positiveDrivers,
    ...negativeDrivers
  ];
  if (String(feedbackReason || "").trim()) {
    fragments.push(String(feedbackReason || "").trim());
  }
  const merged = unique(fragments.filter(Boolean)).slice(0, 3).join("；");
  return merged || "当前岗位仍需结合更多上下文进行人工复核。";
}

function normalizeOpportunityType(value) {
  const normalized = String(value || "").trim();
  if (Object.prototype.hasOwnProperty.call(OPPORTUNITY_TYPE_LABELS, normalized)) return normalized;
  return "single_role_job";
}

function normalizeOpportunityTypeConfidence(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["high", "medium", "low"].includes(normalized)) return normalized;
  return "medium";
}

function normalizeOpportunityTypeInfo(input = {}) {
  if (typeof input === "string") {
    const opportunityType = normalizeOpportunityType(input);
    return { opportunityType, opportunityTypeConfidence: "medium", opportunityTypeLabel: OPPORTUNITY_TYPE_LABELS[opportunityType], opportunityTypeSummary: OPPORTUNITY_TYPE_SUMMARIES[opportunityType] };
  }
  const opportunityType = normalizeOpportunityType(input.opportunityType || input.type);
  const opportunityTypeConfidence = normalizeOpportunityTypeConfidence(input.opportunityTypeConfidence || input.confidence);
  return {
    opportunityType,
    opportunityTypeConfidence,
    opportunityTypeLabel: OPPORTUNITY_TYPE_LABELS[opportunityType],
    opportunityTypeSummary: String(input.opportunityTypeSummary || input.summary || OPPORTUNITY_TYPE_SUMMARIES[opportunityType]).trim(),
  };
}

function buildOpportunityTypeSummary(info = {}) {
  const normalized = normalizeOpportunityTypeInfo(info);
  return normalized.opportunityTypeSummary || OPPORTUNITY_TYPE_SUMMARIES[normalized.opportunityType];
}

function resolveOpportunityNextAction({ nextAction = "review", opportunityType = "single_role_job" } = {}) {
  const normalizedType = normalizeOpportunityType(opportunityType);
  if (normalizedType === "high_value_role_pool") return "confirm_subrole";
  if (normalizedType === "broad_recruitment_entry") return "confirm_responsibility";
  if (normalizedType === "low_quality_mixed_posting") return "manual_review";
  return nextAction;
}

function resolveOpportunityType({ jobFeaturesView = {}, classification = {}, roleFit, industryFit, companyFit, applicationAccessibilityFit } = {}) {
  const features = normalizeJobFeaturesView(jobFeaturesView);
  const jdStructureType = String(features.jdBlockStructureType || "").trim().toLowerCase();
  const roleScore = Number.isFinite(roleFit) ? roleFit : Number(classification?.roleFit?.score || 0);
  const industryScore = Number.isFinite(industryFit) ? industryFit : 0;
  const companyScore = Number.isFinite(companyFit) ? companyFit : 0;
  const accessibilityScore = Number.isFinite(applicationAccessibilityFit) ? applicationAccessibilityFit : 0;
  const roleEvidenceType = String(classification?.roleFit?.evidenceType || "").trim();
  const secondaryRoleSegments = Array.isArray(classification?.secondaryRoleSegments) ? classification.secondaryRoleSegments : [];
  const titleSegments = Array.isArray(classification?.titleSegments) ? classification.titleSegments : [];
  const multiSegmentComposite = secondaryRoleSegments.length >= 2;
  const primaryRoleClarity = roleEvidenceType === "primary_role_match";
  const explicitSubroleEvidence = roleEvidenceType === "explicit_subrole_match" || roleEvidenceType === "adjacent_role_match";
  const titleForStructure = String(features.normalizedTitle || classification?.dominantRoleSegment || "").trim();
  const titleSegmentsText = titleSegments.join(" ");
  const titleRoleAnchorHits = ROLE_ANCHOR_KEYWORDS.filter((keyword) => includesKeyword(titleForStructure, keyword)).length;
  const titleSegmentAnchorHits = ROLE_ANCHOR_KEYWORDS.filter((keyword) => includesKeyword(titleSegmentsText, keyword)).length;
  const titleMultiRoleSignal =
    titleRoleAnchorHits >= 3 ||
    titleSegments.length >= 3 ||
    titleSegmentAnchorHits >= 3 ||
    (/[\/|｜、，,；;\s]+/.test(titleForStructure) && titleRoleAnchorHits >= 2) ||
    /岗位合集|多岗位|多方向|轮岗|校招合集|管培生/.test(titleForStructure);
  const internshipRotationBundledLike =
    jdStructureType === "internship_rotation" &&
    roleScore >= 70 &&
    (multiSegmentComposite ||
      titleMultiRoleSignal ||
      Boolean(features.likelyBundledResponsibilities) ||
      ["bundled", "broad"].includes(String(features.roleStructureType || "").trim().toLowerCase()));

  const bundledLikeByStructure =
    Boolean(features.likelyBundledJD)
    || ["bundled_multi_role", "broad_recruitment", "composite_high_value"].includes(String(features.jdBlockStructureType || ""))
    || internshipRotationBundledLike
    || ["bundled", "broad"].includes(String(features.roleStructureType || "").trim().toLowerCase());
  const bundledLike =
    bundledLikeByStructure ||
    (multiSegmentComposite && jdStructureType !== "internship_rotation" && !primaryRoleClarity && roleScore < 85);

  const responsibilityAligned =
    Boolean(features.primaryResponsibilityRole)
    && features.primaryResponsibilityRole !== "??"
    && features.primaryResponsibilityRole !== "unknown"
    && roleScore >= 66;
  const dominantRoleSegment = String(classification?.dominantRoleSegment || "").trim();
  const hasDominantRoleSegment = dominantRoleSegment.length > 0 && dominantRoleSegment !== "unknown" && dominantRoleSegment !== "??";

  const targetDirectionPresent = primaryRoleClarity || explicitSubroleEvidence || responsibilityAligned || roleScore >= 72;
  const weakRoleEvidence =
    roleEvidenceType === "incidental_keyword_match"
    || roleScore <= 52
    || (!primaryRoleClarity && !explicitSubroleEvidence && !responsibilityAligned && roleScore < 66);

  const sourceCommercialNoise = Number(features.sourceCommercialNoiseRisk || 0);
  const commercialNoiseHigh = sourceCommercialNoise >= 0.7;
  const sourceLowConfidence =
    String(features.productionSourceConfidence || "").trim().toLowerCase() === "low"
    || String(features.sourceFraudRisk || "").trim().toLowerCase() === "high";
  const strongMixedConflictStrict =
    roleEvidenceType === "conflicting_mixed_role"
    || (Boolean(features.isMixedRoleJD) && sourceCommercialNoise >= 0.7);
  const lowClarityStrict =
    String(features.semanticConfidenceTier || "").trim().toLowerCase() === "low"
    && String(features.roleSemanticPurity || "").trim().toLowerCase() === "low";

  if (bundledLike && weakRoleEvidence && strongMixedConflictStrict && commercialNoiseHigh && sourceLowConfidence && lowClarityStrict) {
    return normalizeOpportunityTypeInfo({ opportunityType: "low_quality_mixed_posting", opportunityTypeConfidence: "high" });
  }

  const sourceHealthyForPool =
    String(features.productionSourceConfidence || "").trim().toLowerCase() !== "low"
    && String(features.sourceFraudRisk || "").trim().toLowerCase() !== "high"
    && sourceCommercialNoise < 0.8;
  const notStrongMixed = !strongMixedConflictStrict;
  const highValuePoolSignal =
    Boolean(features.highValueCompositeRole)
    || roleEvidenceType === "explicit_subrole_match"
    || roleEvidenceType === "adjacent_role_match"
    || roleScore >= 74;
  const bundledPrimaryRoleBridge =
    bundledLike
    && primaryRoleClarity
    && roleScore >= 56
    && !strongMixedConflictStrict
    && sourceCommercialNoise < 0.35
    && String(features.productionSourceConfidence || "").trim().toLowerCase() !== "low";
  const bundledExplicitRoleBridge =
    bundledLike
    && !primaryRoleClarity
    && explicitSubroleEvidence
    && roleScore >= 84
    && !strongMixedConflictStrict
    && sourceCommercialNoise < 0.7
    && String(features.productionSourceConfidence || "").trim().toLowerCase() !== "low";

  if (
    (bundledLike && targetDirectionPresent && sourceHealthyForPool && notStrongMixed && highValuePoolSignal)
    || bundledPrimaryRoleBridge
    || bundledExplicitRoleBridge
  ) {
    return normalizeOpportunityTypeInfo({
      opportunityType: "high_value_role_pool",
      opportunityTypeConfidence: roleScore >= 78 || primaryRoleClarity ? "high" : "medium"
    });
  }

  if (bundledLike) {
    return normalizeOpportunityTypeInfo({
      opportunityType: "broad_recruitment_entry",
      opportunityTypeConfidence: targetDirectionPresent ? "medium" : "low"
    });
  }

  if (primaryRoleClarity || explicitSubroleEvidence || responsibilityAligned || (hasDominantRoleSegment && roleScore >= 62 && !strongMixedConflictStrict)) {
    return normalizeOpportunityTypeInfo({
      opportunityType: "single_role_job",
      opportunityTypeConfidence: roleScore >= 75 || primaryRoleClarity ? "high" : "medium"
    });
  }

  if (sourceLowConfidence && weakRoleEvidence && strongMixedConflictStrict) {
    return normalizeOpportunityTypeInfo({ opportunityType: "low_quality_mixed_posting", opportunityTypeConfidence: "medium" });
  }

  const fiveDimensionHealthy = roleScore >= 70 && industryScore >= 45 && companyScore >= 35 && accessibilityScore >= 45;
  if (fiveDimensionHealthy) {
    return normalizeOpportunityTypeInfo({ opportunityType: "single_role_job", opportunityTypeConfidence: "medium" });
  }

  return normalizeOpportunityTypeInfo({ opportunityType: "broad_recruitment_entry", opportunityTypeConfidence: "low" });
}


function normalizeFeedbackInfluenceSignal(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const boost = Number(source.boost);
  return {
    boost: Number.isFinite(boost) ? Math.max(-5, Math.min(5, Math.round(boost))) : 0,
    reason: String(source.reason || "").trim()
  };
}

// 可解释性合约层：统一输出推荐/谨慎/阻断/低置信的结构化解释，不改变排序。
function buildExplainabilityView({
  classification = {},
  preference = {},
  score = 0,
  industryFit = 0,
  roleFit = 0,
  skillFit = null,
  locationFit = null,
  companyFit = null,
  applicationAccessibilityFit = null,
  decisionVerdict = {},
  jobFeaturesView = {},
  opportunityTypeInfo = {},
  feedbackDiagnostic = {},
  industryConflictPenalty = null
} = {}) {
  const features = normalizeJobFeaturesView(jobFeaturesView);
  const verdict = normalizeDecisionVerdict(decisionVerdict);
  const normalizedOpportunityTypeInfo = normalizeOpportunityTypeInfo(opportunityTypeInfo?.opportunityType ? opportunityTypeInfo : {
    opportunityType: features.opportunityType || verdict.opportunityType,
    opportunityTypeConfidence: features.opportunityTypeConfidence || verdict.opportunityTypeConfidence,
    opportunityTypeSummary: features.opportunityTypeSummary || verdict.opportunityTypeSummary,
  });
  const rankingPrimaryDrivers = [];
  const rankingNegativeDrivers = [];
  const confidencePrimaryDrivers = [];

  const roleMatchSummary = buildRoleMatchSummary({ classification, roleFit });
  const industryExplanation = buildIndustryExplanation({ preference, classification, industryFit });
  const semanticPuritySummary = buildSemanticPuritySummary(features);
  const sourceRiskSummary = buildSourceRiskSummary(features);
  const sourceExplanation = buildSourceExplanation(features);
  const bundledRiskSummary = buildBundledRiskSummary(features);
  const freshnessRiskSummary = buildFreshnessRiskSummary(features);
  const blockerReasonSummary = buildBlockerReasonSummary({
    verdict,
    classification,
    preference
  });
  const preferenceDriftSummary = buildPreferenceDriftSummary(feedbackDiagnostic);

  if (Number(roleFit || 0) >= 70) rankingPrimaryDrivers.push("岗位核心职责与目标方向高度一致");
  else if (Number(roleFit || 0) >= 50) rankingPrimaryDrivers.push("岗位方向与目标角色存在较强迁移性");
  else rankingNegativeDrivers.push("岗位主职责与当前目标方向存在明显偏差");

  if (Number(industryFit || 0) >= 70) rankingPrimaryDrivers.push("行业背景与你当前偏好高度一致");
  else if (Number(industryFit || 0) >= 45) rankingPrimaryDrivers.push("行业存在一定关联，能力迁移空间尚可");
  else if ((preference.industryPreference || []).length > 0) rankingNegativeDrivers.push("行业背景与当前偏好存在偏差");

  if (isPresentDimensionScore(locationFit) && Number(locationFit) >= 65) rankingPrimaryDrivers.push("地点与当前求职范围基本一致");
  else if (isPresentDimensionScore(locationFit) && Number(locationFit) < 40 && (preference.locationPreference || []).length > 0) {
    rankingNegativeDrivers.push("地点不在当前优先考虑范围内");
  }

  if (isPresentDimensionScore(companyFit) && Number(companyFit) >= 70) rankingPrimaryDrivers.push("公司环境与当前偏好较为贴合");
  else if (isPresentDimensionScore(companyFit) && Number(companyFit) < 35 && (preference.companyPreference || []).length > 0) {
    rankingNegativeDrivers.push("公司环境与当前偏好存在落差");
  }

  if (Number(applicationAccessibilityFit) >= 65) {
    confidencePrimaryDrivers.push("申请门槛整体可达，推进阻力较低");
  } else if (Number(applicationAccessibilityFit) >= 45) {
    confidencePrimaryDrivers.push("申请门槛可达性中等，建议结合具体要求评估");
  } else {
    confidencePrimaryDrivers.push("申请门槛存在不确定性，建议复核后推进");
  }

  if (features.productionSourceConfidence === "high") {
    confidencePrimaryDrivers.push("来源可信度较高，判断稳定性更强");
  } else if (features.productionSourceConfidence === "medium") {
    confidencePrimaryDrivers.push("来源可信度中等，建议结合岗位详情复核");
  } else {
    rankingNegativeDrivers.push("来源可信度有限，推荐稳定性偏弱");
  }

  if (features.semanticConfidenceTier === "high") {
    confidencePrimaryDrivers.push("JD 结构较清晰，主职责判断较稳定");
  } else if (features.semanticConfidenceTier === "low") {
    rankingNegativeDrivers.push("JD 主职责信号较弱，推荐置信度受限");
  }

  if (isPresentDimensionScore(skillFit) && Number(skillFit) >= 60) {
    rankingPrimaryDrivers.push("关键技能证据对主职责形成正向支撑");
  } else if ((classification.preferenceProfile?.skillPreference || []).length > 0 && Number(skillFit) < 55) {
    rankingNegativeDrivers.push("技能证据不足，建议结合岗位详情人工判断");
  }

  if (Number(industryConflictPenalty?.scorePenalty || 0) > 0) {
    rankingNegativeDrivers.push(String(industryConflictPenalty?.reason || "行业信号存在冲突，已做保守降权"));
  }

  const explainabilityCategory = resolveExplainabilityCategory({
    verdict,
    features,
    feedbackDiagnostic
  });
  const recommendationReasonSummary = buildRecommendationReasonSummary({
    verdict,
    explainabilityCategory,
    roleMatchSummary,
    sourceRiskSummary,
    score,
    opportunityTypeInfo: normalizedOpportunityTypeInfo
  });
  const reviewTriggerSummary = buildReviewTriggerSummary({
    explainabilityCategory,
    rankingNegativeDrivers,
    sourceRiskSummary,
    bundledRiskSummary,
    freshnessRiskSummary,
    preferenceDriftSummary,
    opportunityTypeInfo: normalizedOpportunityTypeInfo
  });
  const confidenceExplanation = buildConfidenceExplanation({
    explainabilityCategory,
    confidencePrimaryDrivers,
    sourceRiskSummary,
    semanticPuritySummary,
    verdict,
    features,
    opportunityTypeInfo: normalizedOpportunityTypeInfo
  });

  return {
    explainabilityCategory,
    rankingPrimaryDrivers: normalizeExplainabilityList(rankingPrimaryDrivers, 4),
    rankingNegativeDrivers: normalizeExplainabilityList(rankingNegativeDrivers, 4),
    confidencePrimaryDrivers: normalizeExplainabilityList(confidencePrimaryDrivers, 4),
    sourceRiskSummary,
    roleMatchSummary,
    confidenceExplanation,
    opportunityTypeSummary: buildOpportunityTypeSummary(normalizedOpportunityTypeInfo),
    roleExplanation: roleMatchSummary,
    industryExplanation,
    sourceExplanation,
    semanticPuritySummary,
    bundledRiskSummary,
    freshnessRiskSummary,
    recommendationReasonSummary,
    reviewTriggerSummary,
    blockerReasonSummary,
    preferenceDriftSummary
  };
}

function resolveExplainabilityCategory({ verdict = {}, features = {}, feedbackDiagnostic = {} } = {}) {
  if (Array.isArray(verdict.hardBlockers) && verdict.hardBlockers.length > 0) return "blocker_conflict";
  if (verdict.verdict === "no_go") return "blocker_conflict";
  if (feedbackDiagnostic?.preferenceEvolutionCandidate) return "preference_drift_review";
  if (features.likelyBundledJD || features.jdBlockStructureType === "bundled_multi_role") return "bundled_jd_review";
  if (features.sourceQualityTier === "low" || features.productionSourceConfidence === "low") return "low_source_quality_review";
  if (verdict.verdict === "review") return "low_confidence_review";
  if (verdict.verdict === "go" && verdict.confidence === "high") return "high_confidence_recommend";
  if (verdict.verdict === "go") return "medium_confidence_recommend";
  return "low_confidence_review";
}

function buildRoleMatchSummary({ classification = {}, roleFit = 0 } = {}) {
  const roleFamily = String(classification.inferredRoleFamily || "目标岗位").trim();
  if (Number(roleFit || 0) >= 80) return `岗位核心职责与${roleFamily}方向高度一致。`;
  if (Number(roleFit || 0) >= 60) return `岗位方向整体贴近${roleFamily}，具备较强能力迁移空间。`;
  if (Number(roleFit || 0) >= 45) return `岗位方向与${roleFamily}存在部分重合，建议结合职责细看。`;
  return `岗位主职责与${roleFamily}方向存在明显偏差。`;
}

function buildIndustryExplanation({ preference = {}, classification = {}, industryFit = 0 } = {}) {
  const preferredIndustries = Array.isArray(preference.industryPreference) ? preference.industryPreference : [];
  const industry = String(classification.inferredIndustry || "当前行业").trim() || "当前行业";
  if (preferredIndustries.length === 0) {
    return "当前未设置强行业偏好，行业信号主要用于辅助判断。";
  }
  if (Number(industryFit || 0) >= 75) {
    return `${industry}与当前偏好行业基本一致，行业背景支撑较强。`;
  }
  if (Number(industryFit || 0) >= 45) {
    return `${industry}与当前偏好存在一定关联，岗位能力具备迁移空间。`;
  }
  return `${industry}与当前偏好行业存在偏差，建议结合岗位职责谨慎评估。`;
}

function buildSemanticPuritySummary(features = {}) {
  if (features.roleSemanticPurity === "high" && features.semanticConfidenceTier === "high") {
    return "JD 主职责结构清晰，岗位语义较纯，判断稳定性较强。";
  }
  if (features.roleSemanticPurity === "medium") {
    return "JD 语义存在一定复合性，但主职责仍可辨识。";
  }
  return "JD 主职责边界较模糊，建议结合原文人工确认。";
}

function buildSourceRiskSummary(features = {}) {
  if (features.productionSourceConfidence === "high") {
    return "来源可信度较高，可作为较稳定的决策参考。";
  }
  if (features.productionSourceConfidence === "medium") {
    return "来源质量中等，建议在推进前补充核验岗位细节。";
  }
  return "来源可信度有限，建议人工复核后再推进。";
}

function buildSourceExplanation(features = {}) {
  if (features.productionSourceConfidence === "high") {
    return "岗位来自较高可信来源，来源风险整体可控。";
  }
  if (features.productionSourceConfidence === "medium") {
    return "岗位来源可作为参考，但仍建议核验投递入口与岗位细节。";
  }
  return "岗位来源稳定性偏弱，建议在推进前优先核验来源真实性。";
}

function buildBundledRiskSummary(features = {}) {
  const bundledLike = features.likelyBundledJD || ["bundled_multi_role", "broad_recruitment"].includes(String(features.jdBlockStructureType || "").trim().toLowerCase());
  const explicitSubroleSignal = String(features.primaryResponsibilityRole || "").trim() !== "" && String(features.primaryResponsibilityRole || "").trim() !== "未知";
  const highValueBundled = bundledLike && features.highValueCompositeRole && features.productionSourceConfidence !== "low" && Number(features.sourceCommercialNoiseRisk || 0) <= 0.35 && explicitSubroleSignal;
  const lowQualityBundled = bundledLike && (features.productionSourceConfidence === "low" || Number(features.sourceCommercialNoiseRisk || 0) >= 0.55) && (features.roleSemanticPurity === "low" || features.isMixedRoleJD);
  if (highValueBundled) return "该岗位为多方向招聘入口，与你目标方向相关，建议进入后确认具体子岗位。";
  if (lowQualityBundled) return "岗位职责混杂且目标方向证据较弱，建议谨慎。";
  if (bundledLike) return "岗位信息结构较复杂，建议确认职责后推进。";
  if (features.jdBlockStructureType === "composite_high_value") return "该岗位为多方向招聘入口，与你目标方向相关，建议进入后确认具体子岗位。";
  return "岗位结构相对单一，职责边界较清楚。";
}

function buildFreshnessRiskSummary(features = {}) {
  if (features.likelyExpired || features.staleRisk === "high") {
    return "岗位时效性偏弱，建议优先核实是否仍在招聘。";
  }
  if (features.staleRisk === "medium" || features.freshnessTier === "aging") {
    return "岗位发布时间偏早，建议在推进前确认最新状态。";
  }
  return "岗位时效性总体健康。";
}

function buildConfidenceExplanation({
  explainabilityCategory = "",
  confidencePrimaryDrivers = [],
  sourceRiskSummary = "",
  semanticPuritySummary = "",
  verdict = {},
  features = {},
  opportunityTypeInfo = {}
} = {}) {
  if (explainabilityCategory === "blocker_conflict") {
    return "当前结论主要由明确阻断条件触发，属于高确定性阻断判断。";
  }
  const primaryDrivers = normalizeExplainabilityList(confidencePrimaryDrivers, 2);
  if (explainabilityCategory === "high_confidence_recommend" && primaryDrivers.length > 0) {
    return primaryDrivers.join("；");
  }
  if (explainabilityCategory === "low_source_quality_review") {
    return sourceRiskSummary || "来源与文本质量共同拉低了当前推荐置信度。";
  }
  if (explainabilityCategory === "bundled_jd_review") {
    return buildOpportunityTypeSummary(opportunityTypeInfo);
  }
  if (features.semanticConfidenceTier === "low" || verdict.confidence === "low") {
    return "当前结论存在一定不确定性，建议结合原始 JD 与来源信息复核。";
  }
  if (primaryDrivers.length > 0) {
    return primaryDrivers.join("；");
  }
  return "当前结论建立在多维信号综合判断之上，建议结合岗位详情进一步确认。";
}

function buildBlockerReasonSummary({ verdict = {}, classification = {}, preference = {} } = {}) {
  if (!(Array.isArray(verdict.hardBlockers) && verdict.hardBlockers.length > 0) && verdict.verdict !== "no_go") {
    return "";
  }
  const primaryBlocker = String((verdict.hardBlockers || [])[0] || "").trim();
  if (primaryBlocker) {
    return `当前岗位与既定策略存在明确冲突：${primaryBlocker}。`;
  }
  if ((preference.excludedRoles || []).length > 0 && (classification.mismatchSignals || []).some((item) => includesKeyword(item, "命中排除岗位"))) {
    return "岗位触发了已明确排除的方向，不建议继续推进。";
  }
  return "当前岗位与既定求职策略存在冲突，不建议优先推进。";
}

function buildPreferenceDriftSummary(feedbackDiagnostic = {}) {
  if (!feedbackDiagnostic?.preferenceEvolutionCandidate) return "";
  return "近期反馈显示你可能正在向相邻岗位或新方向扩展，建议复核当前偏好设置。";
}

function buildRecommendationReasonSummary({
  verdict = {},
  explainabilityCategory = "",
  roleMatchSummary = "",
  sourceRiskSummary = "",
  score = 0,
  opportunityTypeInfo = {}
} = {}) {
  if (explainabilityCategory === "blocker_conflict") {
    return "当前岗位与既定求职策略冲突，暂不建议推进。";
  }
  if (explainabilityCategory === "high_confidence_recommend") {
    return buildOpportunityTypeSummary(opportunityTypeInfo);
  }
  if (explainabilityCategory === "medium_confidence_recommend") {
    return "整体契合度较高，建议重点关注并尽快查看岗位细节。";
  }
  if (explainabilityCategory === "preference_drift_review") {
    return "岗位本身具备吸引力，但你的近期反馈显示偏好可能正在变化，建议先复核再推进。";
  }
  if (explainabilityCategory === "low_source_quality_review") {
    return "岗位方向具备一定相关性，但来源与文本质量限制了推荐置信度。";
  }
  if (explainabilityCategory === "bundled_jd_review") {
    return buildOpportunityTypeSummary(opportunityTypeInfo);
  }
  if (Number(score || 0) >= 60) {
    return "岗位与当前策略存在一定契合度，但仍需结合上下文谨慎判断。";
  }
  return "当前岗位需要结合更多岗位细节进行人工复核。";
}

function buildReviewTriggerSummary({
  explainabilityCategory = "",
  rankingNegativeDrivers = [],
  sourceRiskSummary = "",
  bundledRiskSummary = "",
  freshnessRiskSummary = "",
  preferenceDriftSummary = "",
  opportunityTypeInfo = {}
} = {}) {
  if (explainabilityCategory === "blocker_conflict") return "";
  const candidates = [];
  if (["low_confidence_review", "low_source_quality_review", "bundled_jd_review", "preference_drift_review"].includes(explainabilityCategory)) {
    candidates.push(...normalizeExplainabilityList(rankingNegativeDrivers, 2));
    if (explainabilityCategory === "low_source_quality_review") candidates.push(sourceRiskSummary);
    if (explainabilityCategory === "bundled_jd_review") candidates.push(buildOpportunityTypeSummary(opportunityTypeInfo) || bundledRiskSummary);
    if (explainabilityCategory === "preference_drift_review") candidates.push(preferenceDriftSummary);
    if (explainabilityCategory === "low_confidence_review") candidates.push(freshnessRiskSummary);
  }
  return unique(candidates.filter(Boolean)).slice(0, 2).join("；");
}

function normalizeExplainabilityList(value = [], max = 4) {
  return unique(
    (Array.isArray(value) ? value : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  ).slice(0, max);
}

// 反馈诊断层：只分析用户行为信号，不参与 production comparator。
function buildFeedbackDiagnosticView({
  job = {},
  classification = {},
  jobFeaturesView = {},
  roleFit = 0,
  industryFit = 0,
  locationFit = 0,
  companyFit = 0,
  applicationAccessibilityFit = 0
} = {}) {
  const shortlistState = String(job?.shortlistState || "").trim().toLowerCase();
  const feedbackState = String(job?.feedbackState || "").trim().toLowerCase();
  const trackerState = String(job?.trackerState || "").trim().toLowerCase();
  const shortlistTimeline = Array.isArray(job?.shortlistTimeline) ? job.shortlistTimeline : [];
  const feedbackTimeline = Array.isArray(job?.feedbackTimeline) ? job.feedbackTimeline : [];
  const trackerTimeline = Array.isArray(job?.trackerTimeline) ? job.trackerTimeline : [];
  const latestTimestamp = resolveLatestFeedbackTimestamp([shortlistTimeline, feedbackTimeline, trackerTimeline]);
  const feedbackRecencyTier = resolveFeedbackRecencyTier(latestTimestamp);
  const qualityLow = String(jobFeaturesView?.sourceQualityTier || "").trim().toLowerCase() === "low";
  const bundledRisk = Boolean(jobFeaturesView?.likelyBundledJD);
  const lowConfidence = String(jobFeaturesView?.confidenceTier || "").trim().toLowerCase() === "low";
  const primaryAlignmentStrong =
    Number(roleFit || 0) >= 70 &&
    Number(industryFit || 0) >= 45 &&
    Number(locationFit || 0) >= 45;
  const primaryAlignmentWeak =
    Number(roleFit || 0) < 45 ||
    Number(industryFit || 0) < 35 ||
    Number(applicationAccessibilityFit || 0) < 35;
  let feedbackSignalType = "none";
  if (trackerState === "applied") feedbackSignalType = "applied";
  else if (trackerState === "rejected") feedbackSignalType = "rejected";
  else if (feedbackState === "good_fit") feedbackSignalType = "good_fit";
  else if (feedbackState === "bad_fit") feedbackSignalType = "bad_fit";
  else if (feedbackState === "misclassified") feedbackSignalType = "misclassified";
  else if (shortlistState === "shortlisted") feedbackSignalType = "shortlist";
  else if (trackerState === "saved") feedbackSignalType = "saved";

  const repeatedActionCount =
    countFeedbackRepeats(shortlistTimeline, shortlistState) +
    countFeedbackRepeats(feedbackTimeline, feedbackState) +
    countFeedbackRepeats(trackerTimeline, trackerState);
  let feedbackConfidence = "low";
  if (["applied", "rejected", "good_fit", "bad_fit", "misclassified"].includes(feedbackSignalType)) {
    feedbackConfidence = repeatedActionCount >= 2 ? "high" : "medium";
  } else if (["shortlist", "saved"].includes(feedbackSignalType)) {
    feedbackConfidence = repeatedActionCount >= 2 ? "medium" : "low";
  }

  let feedbackConsistency = "unknown";
  if (feedbackSignalType === "none") {
    feedbackConsistency = "unknown";
  } else if (["applied", "good_fit", "shortlist", "saved"].includes(feedbackSignalType)) {
    feedbackConsistency = primaryAlignmentStrong ? "aligned" : primaryAlignmentWeak ? "conflicting" : "mixed";
  } else if (["rejected", "bad_fit", "misclassified"].includes(feedbackSignalType)) {
    feedbackConsistency = primaryAlignmentStrong ? "conflicting" : primaryAlignmentWeak ? "aligned" : "mixed";
  }

  let feedbackConflictRisk = "low";
  if (feedbackConsistency === "conflicting" || qualityLow || bundledRisk || lowConfidence) {
    feedbackConflictRisk = "high";
  } else if (feedbackConsistency === "mixed" || feedbackConfidence === "low" || Number(companyFit || 0) < 40) {
    feedbackConflictRisk = "medium";
  }

  const preferenceEvolutionCandidate =
    feedbackSignalType !== "none" &&
    feedbackConfidence !== "low" &&
    feedbackConsistency === "conflicting" &&
    feedbackConflictRisk !== "high";

  return {
    feedbackSignalType,
    feedbackConfidence,
    feedbackRecencyTier,
    feedbackConsistency,
    feedbackConflictRisk,
    preferenceEvolutionCandidate,
    inferredPreferenceDelta: buildInferredPreferenceDelta({
      preferenceEvolutionCandidate,
      feedbackSignalType,
      classification,
      consistency: feedbackConsistency
    })
  };
}

function resolveLatestFeedbackTimestamp(timelineGroups = []) {
  const candidates = [];
  (Array.isArray(timelineGroups) ? timelineGroups : []).forEach((items) => {
    (Array.isArray(items) ? items : []).forEach((entry) => {
      const parsed = Date.parse(String(entry?.timestamp || ""));
      if (Number.isFinite(parsed)) candidates.push(parsed);
    });
  });
  if (candidates.length === 0) return NaN;
  return Math.max(...candidates);
}

function resolveFeedbackRecencyTier(timestamp = NaN) {
  if (!Number.isFinite(timestamp)) return "none";
  const ageDays = Math.max(0, (Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  if (ageDays <= 14) return "recent";
  if (ageDays <= 60) return "aging";
  return "stale";
}

function countFeedbackRepeats(items = [], state = "") {
  const target = String(state || "").trim().toLowerCase();
  if (!target || target === "none") return 0;
  return (Array.isArray(items) ? items : []).filter((entry) => String(entry?.state || "").trim().toLowerCase() === target).length;
}

function buildInferredPreferenceDelta({
  preferenceEvolutionCandidate = false,
  feedbackSignalType = "none",
  classification = {},
  consistency = "unknown"
} = {}) {
  if (!preferenceEvolutionCandidate) {
    return {
      direction: "none",
      roleFamily: "",
      industry: "",
      reason: ""
    };
  }
  const positiveSignal = ["applied", "good_fit", "shortlist", "saved"].includes(String(feedbackSignalType || "").trim().toLowerCase());
  return {
    direction: positiveSignal ? "toward" : "away",
    roleFamily: String(classification?.inferredRoleFamily || "").trim(),
    industry: String(classification?.inferredIndustry || "").trim(),
    reason:
      consistency === "conflicting"
        ? "用户行为与当前显式偏好出现偏移，可作为后续偏好演化候选"
        : "用户行为与当前偏好大体一致，无需演化"
  };
}

function normalizeFeedbackPreferenceDelta(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const direction = String(source.direction || "").trim().toLowerCase();
  return {
    direction: ["toward", "away", "none"].includes(direction) ? direction : "none",
    roleFamily: String(source.roleFamily || "").trim(),
    industry: String(source.industry || "").trim(),
    reason: String(source.reason || "").trim()
  };
}

function normalizeIndustryConflictPenalty(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const preferencePenalty = Number(source.preferencePenalty);
  const scorePenalty = Number(source.scorePenalty);
  const severity = String(source.severity || "").trim().toLowerCase();
  return {
    preferencePenalty: Number.isFinite(preferencePenalty) ? Math.max(0, Math.min(20, preferencePenalty)) : 0,
    scorePenalty: Number.isFinite(scorePenalty) ? Math.max(0, Math.min(12, scorePenalty)) : 0,
    severity: ["none", "weak", "medium", "strong"].includes(severity) ? severity : "none",
    reason: String(source.reason || "").trim()
  };
}

function resolveIndustryConflictPenalty({ classification = {}, preference = {}, jobFeaturesView = {} } = {}) {
  const preferredIndustries = normalizeIndustryPreferenceList(preference.industryPreference || []);
  if (preferredIndustries.length === 0) {
    return { preferencePenalty: 0, scorePenalty: 0, severity: "none", reason: "" };
  }
  const excludedIndustries = normalizeIndustryPreferenceList(preference.excludedIndustries || []);
  const inferredIndustry = normalizeIndustryAlias(classification.inferredIndustry || "");
  if (!inferredIndustry) {
    return { preferencePenalty: 0, scorePenalty: 0, severity: "none", reason: "" };
  }
  if (preferredIndustries.includes(inferredIndustry)) {
    return { preferencePenalty: 0, scorePenalty: 0, severity: "none", reason: "" };
  }
  const confidence = String(classification.inferredIndustryConfidence || "low").trim().toLowerCase();
  if (confidence === "low") {
    return { preferencePenalty: 0, scorePenalty: 0, severity: "none", reason: "" };
  }
  const features = normalizeJobFeaturesView(jobFeaturesView);
  const isCrossIndustrySafeRole = Boolean(features.isCrossIndustrySafe);
  const related = preferredIndustries.some((item) => isRelatedIndustry(item, inferredIndustry));
  const excludedHit = excludedIndustries.includes(inferredIndustry);
  if (related) {
    if (isCrossIndustrySafeRole && !excludedHit) {
      return withMixedRoleSoftPenalty({
        preferencePenalty: 3,
        scorePenalty: 1,
        severity: "weak",
        reason: "跨行业通用角色，已保守降权"
      }, features);
    }
    return withMixedRoleSoftPenalty({
      preferencePenalty: 4,
      scorePenalty: 2,
      severity: "weak",
      reason: `行业偏好存在冲突（偏好 ${preferredIndustries.join("/")}，当前 ${inferredIndustry}），已轻度降权`
    }, features);
  }
  if (confidence === "high") {
    if (isCrossIndustrySafeRole && !excludedHit) {
      return withMixedRoleSoftPenalty({
        preferencePenalty: 3,
        scorePenalty: 1,
        severity: "weak",
        reason: "跨行业通用角色，已保守降权"
      }, features);
    }
    return withMixedRoleSoftPenalty({
      preferencePenalty: 14,
      scorePenalty: 8,
      severity: "strong",
      reason: `行业偏好强冲突（偏好 ${preferredIndustries.join("/")}，当前 ${inferredIndustry}），已降权`
    }, features);
  }
  if (isCrossIndustrySafeRole && !excludedHit) {
    return withMixedRoleSoftPenalty({
      preferencePenalty: 3,
      scorePenalty: 1,
      severity: "weak",
      reason: "跨行业通用角色，已保守降权"
    }, features);
  }
  return withMixedRoleSoftPenalty({
    preferencePenalty: 8,
    scorePenalty: 4,
    severity: "medium",
    reason: `行业偏好冲突（偏好 ${preferredIndustries.join("/")}，当前 ${inferredIndustry}），已降权`
  }, features);
}

function withMixedRoleSoftPenalty(penalty = {}, jobFeaturesView = {}) {
  const normalized = normalizeIndustryConflictPenalty(penalty);
  if (!jobFeaturesView.isMixedRoleJD || jobFeaturesView.isCrossIndustrySafe) return normalized;
  return normalizeIndustryConflictPenalty({
    ...normalized,
    scorePenalty: Number(normalized.scorePenalty || 0) + MIXED_ROLE_SOFT_SCORE_PENALTY,
    reason: normalized.reason ? `${normalized.reason}；混合岗位JD，已轻度降权` : "混合岗位JD，已轻度降权"
  });
}

function normalizeIndustryPreferenceList(items = []) {
  return unique(
    (Array.isArray(items) ? items : [])
      .map((item) => normalizeIndustryAlias(item))
      .filter(Boolean)
  ).slice(0, 6);
}

function normalizeIndustryAlias(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  const aliasMap = {
    gaming: "游戏",
    game: "游戏",
    "ai/algorithm": "AI/算法",
    ai_algorithm: "AI/算法",
    ai: "AI/算法",
    "人工智能": "AI/算法",
    "internet/software": "互联网/软件",
    internet_software: "互联网/软件",
    "互联网": "互联网/软件",
    "consulting/business": "咨询/商业",
    consulting_business: "咨询/商业",
    "public/institution": "政企/事业单位",
    public_institution: "政企/事业单位",
    "medical/bio": "医疗/生物",
    medical_bio: "医疗/生物",
    "manufacturing/hardware": "制造/硬件",
    manufacturing_hardware: "制造/硬件",
    finance: "金融",
    education: "教育"
  };
  if (aliasMap[text]) return aliasMap[text];
  if (text === "游戏" || text === "ai/算法" || text === "互联网/软件" || text === "教育" || text === "金融") return value;
  if (text === "咨询/商业" || text === "政企/事业单位" || text === "医疗/生物" || text === "制造/硬件") return value;
  return String(value || "").trim();
}

function isRelatedIndustry(preferredIndustry = "", inferredIndustry = "") {
  const left = normalizeIndustryAlias(preferredIndustry);
  const right = normalizeIndustryAlias(inferredIndustry);
  if (!left || !right || left === right) return true;
  const relations = {
    "游戏": new Set(["互联网/软件", "AI/算法"]),
    "AI/算法": new Set(["互联网/软件", "制造/硬件", "游戏"]),
    "互联网/软件": new Set(["AI/算法", "游戏"]),
    "教育": new Set(["政企/事业单位", "咨询/商业", "互联网/软件", "AI/算法"]),
    "金融": new Set(["咨询/商业", "互联网/软件", "AI/算法"]),
    "政企/事业单位": new Set(["教育"])
  };
  return relations[left]?.has(right) || false;
}

function normalizeLocation(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.includes("上海") || raw.includes("shanghai")) return "上海";
  if (raw.includes("北京") || raw.includes("beijing")) return "北京";
  if (raw.includes("广州") || raw.includes("guangzhou")) return "广州";
  if (raw.includes("深圳") || raw.includes("shenzhen")) return "深圳";
  return raw;
}

function normalizeUserPriorityWeights(normalizedPreference = {}) {
  const source = normalizedPreference?.priorityWeights && typeof normalizedPreference.priorityWeights === "object"
    ? normalizedPreference.priorityWeights
    : {};
  return {
    role: toPositiveWeight(source.role || USER_PRIORITY_DEFAULT_WEIGHTS.role),
    industry: toPositiveWeight(source.industry || USER_PRIORITY_DEFAULT_WEIGHTS.industry),
    location: toPositiveWeight(source.location || USER_PRIORITY_DEFAULT_WEIGHTS.location),
    company: toPositiveWeight(source.company || USER_PRIORITY_DEFAULT_WEIGHTS.company),
    accessibility: toPositiveWeight(source.accessibility || source.skill || USER_PRIORITY_DEFAULT_WEIGHTS.accessibility)
  };
}

function buildUserPriorityDimensions({
  roleFit = null,
  industryFit = null,
  locationFit = null,
  companyFit = null,
  applicationAccessibilityFit = null
} = {}) {
  const neutralIfMissing = (value) => isPresentDimensionScore(value) ? numberOr(value, 0) : 60;
  return {
    role: neutralIfMissing(roleFit),
    industry: neutralIfMissing(industryFit),
    location: neutralIfMissing(locationFit),
    company: neutralIfMissing(companyFit),
    accessibility: neutralIfMissing(applicationAccessibilityFit)
  };
}

function resolveUserPriorityScore({
  normalizedPreference = {},
  industryFit = null,
  roleFit = 0,
  locationFit = null,
  companyFit = null,
  applicationAccessibilityFit = null
} = {}) {
  const resolvedWeights = normalizeUserPriorityWeights(normalizedPreference);
  const dimensions = [
    { key: "role", score: roleFit, enabled: isPresentDimensionScore(roleFit) },
    { key: "industry", score: industryFit, enabled: isPresentDimensionScore(industryFit) },
    { key: "location", score: locationFit, enabled: isPresentDimensionScore(locationFit) },
    { key: "company", score: companyFit, enabled: isPresentDimensionScore(companyFit) },
    { key: "accessibility", score: applicationAccessibilityFit, enabled: isPresentDimensionScore(applicationAccessibilityFit) }
  ].filter((item) => item.enabled);
  if (dimensions.length === 0) return 15;
  const totalWeight = dimensions.reduce((sum, item) => sum + toPositiveWeight(resolvedWeights[item.key]), 0);
  if (totalWeight <= 0) return 15;
  const weightedScore = dimensions.reduce((sum, item) => {
    return sum + Number(item.score || 0) * (toPositiveWeight(resolvedWeights[item.key]) / totalWeight);
  }, 0);
  const roleAnchor = isPresentDimensionScore(roleFit) ? Number(roleFit) : 0;
  const industryAnchor = isPresentDimensionScore(industryFit) ? Number(industryFit) : 0;
  const locationAnchor = isPresentDimensionScore(locationFit) ? Number(locationFit) : 0;
  const companyAnchor = isPresentDimensionScore(companyFit) ? Number(companyFit) : 0;
  const accessibilityAnchor = isPresentDimensionScore(applicationAccessibilityFit) ? Number(applicationAccessibilityFit) : 0;
  // 用户价值排序锚点：同分时优先 role > industry > location > company > accessibility。
  const tieBreaker =
    roleAnchor * 0.01 +
    industryAnchor * 0.0001 +
    locationAnchor * 0.000001 +
    companyAnchor * 0.00000001 +
    accessibilityAnchor * 0.0000000001;
  return Number((Math.max(1, Math.min(100, weightedScore)) + tieBreaker).toFixed(6));
}

function resolvePreferenceMatchScore(input = {}) {
  return resolveUserPriorityScore(input);
}

function applyExplicitRoleValueFloor(score = 0, { classification = {}, roleFit = null } = {}) {
  const evidenceType = String(classification?.roleFit?.evidenceType || "").trim().toLowerCase();
  const numericRoleFit = Number(roleFit || 0);
  const highConfidenceRoleMatch =
    (numericRoleFit >= 90 && evidenceType === "primary_role_match") ||
    (numericRoleFit >= 75 && evidenceType === "explicit_subrole_match");
  if (!highConfidenceRoleMatch) return clampScore(score);
  const mismatchSignals = Array.isArray(classification.mismatchSignals) ? classification.mismatchSignals : [];
  const hasDominantRoleConflict = mismatchSignals.some((item) =>
    String(item || "").includes("命中排除岗位（主语义）")
  );
  if (hasDominantRoleConflict) return clampScore(score);
  return clampScore(Math.max(Number(score || 0), 80));
}

function applyUserPriorityCompletenessCap(score = 0, {
  classification = {},
  jobFeaturesView = {},
  preference = {},
  locationFit = null
} = {}) {
  const hasLocationPreference = (preference.locationPreference || []).length > 0;
  const missingLocation = hasMissingDimensionScore(locationFit);
  if (!hasLocationPreference || !missingLocation) return clampScore(score);
  const segmentCount = Array.isArray(classification.titleSegments) ? classification.titleSegments.length : 0;
  const structureType = String(jobFeaturesView.jdBlockStructureType || "").trim().toLowerCase();
  const nonSingleOpportunity =
    Boolean(classification.mixedRoleTitle) ||
    Boolean(jobFeaturesView.likelyBundledJD) ||
    Boolean(jobFeaturesView.highValueCompositeRole) ||
    segmentCount >= 2 ||
    ["bundled_multi_role", "broad_recruitment", "internship_rotation", "composite_high_value"].includes(structureType);
  if (!nonSingleOpportunity) return clampScore(score);
  return clampScore(Math.min(Number(score || 0), 84));
}

function scoreApplicationAccessibilityFit({
  classification = {},
  preference = {},
  roleFit = null,
  skillFit = null,
  locationFit = null,
  companyFit = null
} = {}) {
  let score = 72;
  const mismatchSignals = Array.isArray(classification.mismatchSignals) ? classification.mismatchSignals : [];
  const excludedIndustryHit = (preference.excludedIndustries || []).includes(classification.inferredIndustry);
  const avoidCompanyHit = (preference.avoidCompanyTypes || []).some((item) =>
    (classification.inferredCompanyTypes || []).includes(item)
  );
  const dominantExcludedRoleHit = mismatchSignals.some((item) => String(item || "").includes("命中排除岗位（主语义）"));
  if (excludedIndustryHit || avoidCompanyHit || dominantExcludedRoleHit) return 20;
  if (isPresentDimensionScore(roleFit) && Number(roleFit) < 40) score -= 18;
  if (isPresentDimensionScore(companyFit) && Number(companyFit) < 40) score -= 8;
  if (isPresentDimensionScore(locationFit) && Number(locationFit) <= 30) score -= 6;
  if (isPresentDimensionScore(skillFit) && Number(skillFit) < 50) score -= 6;
  if (classification.mixedRoleTitle && String(classification.inferredRoleConfidence || "low") === "low") score -= 10;
  return clampScore(score);
}

function buildSkillGapView({
  job = {},
  preference = {},
  classification = {}
} = {}) {
  const userSkills = Array.isArray(preference.skillPreference)
    ? unique(preference.skillPreference.map((item) => String(item || "").trim()).filter(Boolean))
    : [];
  const hasUserSkills = userSkills.length > 0;
  if (!hasUserSkills) {
    return {
      overallFit: "unknown",
      matchedSkills: [],
      missingSkills: [],
      skillEvidence: [],
      hasUserSkills: false,
      gapHint: "补充技能偏好后可获得技能差距分析"
    };
  }

  const metadata = job.metadata && typeof job.metadata === "object" ? job.metadata : {};
  const titleText = String(job.title || "");
  const jdText = String(job.jdRaw || job.jd_raw || job.description || job.rawText || job.raw_text || metadata.rawText || metadata.raw_text || "");
  const jobText = [
    titleText,
    jdText
  ]
    .map((item) => String(item || ""))
    .join(" ");
  const extractedSkills = extractJobSkillsFromText(jobText);
  const inferredSkills = Array.isArray(classification.inferredSkills) ? classification.inferredSkills : [];
  const normalizedInferredSkills = inferredSkills
    .map((item) => normalizeSkillToken(item))
    .filter(Boolean);
  const highConfidenceJobSkills = unique(
    extractedSkills
      .filter((item) => item.confidence === "high")
      .map((item) => item.skill)
      .concat(
        normalizedInferredSkills.filter((skill) => {
          const inTitle = includesKeyword(titleText, skill);
          const inJd = includesKeyword(jdText, skill);
          return inTitle || inJd;
        })
      )
  ).slice(0, 10);
  const broadJobSkills = unique(
    extractedSkills.map((item) => item.skill).concat(normalizedInferredSkills)
  );
  if (highConfidenceJobSkills.length === 0) {
    return {
      overallFit: "unknown",
      matchedSkills: [],
      missingSkills: [],
      skillEvidence: [],
      hasUserSkills: true,
      gapHint: "岗位技能信号不足，暂不判断技能差距"
    };
  }

  const matchedSkills = unique(
    userSkills.filter((userSkill) =>
      broadJobSkills.some((jobSkill) => includesKeyword(jobSkill, userSkill) || includesKeyword(userSkill, jobSkill))
    )
  );
  const strictMissingSkillCandidates = highConfidenceJobSkills.filter((skill) => isStrictMissingSkillCandidate(skill));
  const missingSkills = unique(
    strictMissingSkillCandidates.filter(
      (jobSkill) =>
        !userSkills.some((userSkill) => includesKeyword(userSkill, jobSkill) || includesKeyword(jobSkill, userSkill))
    )
  ).slice(0, 5);
  const skillEvidence = matchedSkills.slice(0, 4).map((skill) => ({
    skill,
    evidenceText: `岗位描述含 ${skill}`
  }));
  const ratio = matchedSkills.length / Math.max(1, userSkills.length);
  const overallFit = ratio >= 0.67 ? "high" : ratio >= 0.34 ? "medium" : "low";
  const gapHint =
    missingSkills.length > 0
      ? `存在技能差距：${missingSkills.slice(0, 3).join(" / ")}`
      : "关键技能匹配度较高";

  return {
    overallFit,
    matchedSkills,
    missingSkills,
    skillEvidence,
    hasUserSkills: true,
    gapHint
  };
}

function extractJobSkillsFromText(text = "") {
  const corpus = String(text || "").toLowerCase();
  const catalog = [
    { skill: "Python", aliases: ["python"], confidence: "high" },
    { skill: "SQL", aliases: ["sql"], confidence: "high" },
    { skill: "Java", aliases: ["java"], confidence: "high" },
    { skill: "C++", aliases: ["c++"], confidence: "high" },
    { skill: "JavaScript", aliases: ["javascript", "js"], confidence: "high" },
    { skill: "TypeScript", aliases: ["typescript", "ts"], confidence: "high" },
    { skill: "Node.js", aliases: ["node.js", "nodejs"], confidence: "high" },
    { skill: "React", aliases: ["react"], confidence: "high" },
    { skill: "Vue", aliases: ["vue"], confidence: "high" },
    { skill: "Excel", aliases: ["excel"], confidence: "high" },
    { skill: "Power BI", aliases: ["power bi", "powerbi"], confidence: "high" },
    { skill: "Tableau", aliases: ["tableau"], confidence: "high" },
    { skill: "商业分析", aliases: ["商业分析", "business analysis", "business analyst"], confidence: "high" },
    { skill: "产品设计", aliases: ["产品设计", "product design"], confidence: "high" },
    { skill: "机器学习", aliases: ["机器学习"], confidence: "high" },
    { skill: "深度学习", aliases: ["深度学习"], confidence: "high" },
    { skill: "LLM", aliases: ["llm", "大模型"], confidence: "high" },
    { skill: "NLP", aliases: ["nlp"], confidence: "high" },
    { skill: "数据分析", aliases: ["数据分析"], confidence: "high" },
    { skill: "Golang", aliases: ["golang", "go语言", "go language"], confidence: "high" },
    { skill: "Docker", aliases: ["docker"], confidence: "high" },
    { skill: "Kubernetes", aliases: ["kubernetes", "k8s"], confidence: "high" },
    { skill: "Git", aliases: ["git"], confidence: "high" },
    { skill: "R", aliases: ["r语言", "r language"], confidence: "high" },
    { skill: "Spark", aliases: ["spark"], confidence: "high" },
    { skill: "Hadoop", aliases: ["hadoop"], confidence: "high" },
    { skill: "TensorFlow", aliases: ["tensorflow"], confidence: "high" },
    { skill: "PyTorch", aliases: ["pytorch"], confidence: "high" },
    { skill: "Scikit-learn", aliases: ["scikit-learn", "sklearn"], confidence: "high" },
    { skill: "Linux", aliases: ["linux"], confidence: "high" },
    { skill: "Figma", aliases: ["figma"], confidence: "high" },
    { skill: "Axure", aliases: ["axure"], confidence: "high" },
    { skill: "Photoshop", aliases: ["photoshop", "ps"], confidence: "high" },
    { skill: "Unity", aliases: ["unity"], confidence: "high" },
    { skill: "Unreal", aliases: ["unreal", "ue5", "ue4"], confidence: "high" }
  ];
  return catalog.filter((item) => item.aliases.some((alias) => includesKeyword(corpus, alias)));
}

function normalizeSkillToken(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  const mapping = {
    python: "Python",
    sql: "SQL",
    java: "Java",
    "c++": "C++",
    javascript: "JavaScript",
    js: "JavaScript",
    typescript: "TypeScript",
    ts: "TypeScript",
    "node.js": "Node.js",
    nodejs: "Node.js",
    react: "React",
    vue: "Vue",
    excel: "Excel",
    powerbi: "Power BI",
    "power bi": "Power BI",
    tableau: "Tableau",
    golang: "Golang",
    docker: "Docker",
    kubernetes: "Kubernetes",
    k8s: "Kubernetes",
    git: "Git",
    llm: "LLM",
    nlp: "NLP",
    spark: "Spark",
    hadoop: "Hadoop",
    tensorflow: "TensorFlow",
    pytorch: "PyTorch",
    "scikit-learn": "Scikit-learn",
    sklearn: "Scikit-learn",
    linux: "Linux",
    figma: "Figma",
    axure: "Axure",
    photoshop: "Photoshop",
    unity: "Unity",
    unreal: "Unreal",
    ue5: "Unreal",
    ue4: "Unreal"
  };
  return mapping[lower] || text;
}

function isStrictMissingSkillCandidate(skill = "") {
  const normalized = normalizeSkillToken(skill);
  if (!normalized) return false;
  const strictSkillSet = new Set([
    "Python",
    "SQL",
    "Java",
    "C++",
    "JavaScript",
    "TypeScript",
    "React",
    "Vue",
    "Node.js",
    "Excel",
    "Power BI",
    "Tableau",
    "机器学习",
    "深度学习",
    "NLP",
    "LLM",
    "大模型",
    "Golang",
    "Docker",
    "Kubernetes",
    "Git",
    "R",
    "Spark",
    "Hadoop",
    "PyTorch",
    "TensorFlow",
    "Scikit-learn",
    "Linux",
    "Figma",
    "Axure",
    "Photoshop",
    "Unity",
    "Unreal"
  ]);
  const blockedBroadTerms = [
    "产品",
    "运营",
    "测试",
    "前端",
    "算法",
    "数据分析",
    "管理",
    "研究",
    "市场",
    "销售"
  ];
  if (blockedBroadTerms.some((term) => includesKeyword(normalized, term))) return false;
  return strictSkillSet.has(normalized);
}

function buildDecisionVerdict({
  score = 0,
  industryFit = null,
  roleFit = null,
  skillFit = null,
  locationFit = null,
  companyFit = null,
  applicationAccessibilityFit = null,
  classification = {},
  preference = {},
  resolvedPreferenceSource = "legacy",
  opportunityTypeInfo = {}
} = {}) {
  const hardBlockers = [];
  const riskSignals = [];
  const mismatchSignals = Array.isArray(classification.mismatchSignals) ? classification.mismatchSignals : [];
  const inferredIndustry = String(classification.inferredIndustry || "").trim();
  const inferredCompanyTypes = Array.isArray(classification.inferredCompanyTypes) ? classification.inferredCompanyTypes : [];
  const dominantExcludedRoleHit = mismatchSignals.some((item) =>
    String(item || "").includes("命中排除岗位（主语义）")
  );

  if ((preference.excludedIndustries || []).includes(inferredIndustry)) {
    hardBlockers.push(`命中排除行业：${inferredIndustry}`);
  }
  if (dominantExcludedRoleHit) {
    hardBlockers.push("命中排除岗位（主语义）");
  }
  if ((preference.avoidCompanyTypes || []).some((item) => inferredCompanyTypes.includes(item))) {
    hardBlockers.push("命中排除公司类型");
  }
  if ((preference.jobType || "").trim() && preference.jobType !== "不限") {
    const titleCorpus = `${String(classification.dominantRoleSegment || "")} ${String(classification.inferredRoleFamily || "")}`;
    if (preference.jobType === "实习") {
      if (includesKeyword(titleCorpus, "社招")) {
        hardBlockers.push("求职类型冲突：偏好实习，岗位更偏社招");
      } else if (!includesKeyword(titleCorpus, "实习")) {
        riskSignals.push("求职类型信号不足（偏好实习）");
      }
    }
    if (preference.jobType === "校招") {
      if (includesKeyword(titleCorpus, "社招")) {
        hardBlockers.push("求职类型冲突：偏好校招，岗位更偏社招");
      } else if (!includesKeyword(titleCorpus, "校招")) {
        riskSignals.push("求职类型信号不足（偏好校招）");
      }
    }
    if (preference.jobType === "社招") {
      if (includesKeyword(titleCorpus, "实习") || includesKeyword(titleCorpus, "校招")) {
        hardBlockers.push("求职类型冲突：偏好社招，岗位更偏实习/校招");
      } else if (!includesKeyword(titleCorpus, "社招")) {
        riskSignals.push("求职类型信号不足（偏好社招）");
      }
    }
  }
  if ((preference.locationPreference || []).length > 0 && isPresentDimensionScore(locationFit) && Number(locationFit) > 0 && Number(locationFit) <= 30) {
    riskSignals.push("地点偏好冲突");
  }

  const normalizedScore = numberOr(score, 0);
  const supportivePrimarySignals =
    Number(industryFit ?? 50) >= 60 &&
    Number(roleFit ?? 50) >= 75 &&
    Number(locationFit ?? 50) >= 65;
  const skillEvidenceWeak = Number(skillFit ?? 50) < 55;
  const hasIndustryConflict = mismatchSignals.some((item) => String(item || "").includes("未命中") && String(item || "").includes("行业"));
  let grade = resolveDecisionGrade(normalizedScore);
  let verdict = "review";
  const primaryClearlyWeak = Number(industryFit ?? 50) < 30 && Number(roleFit ?? 50) < 30;
  if (hardBlockers.length > 0) {
    verdict = "no_go";
    grade = "F";
  } else if (grade === "A" || grade === "B") {
    verdict = "go";
  } else if (grade === "F") {
    verdict = "no_go";
  }
  // 当主信号强且无硬阻断时，技能弱证据不应单独把岗位降到 D/F。
  if (hardBlockers.length === 0 && supportivePrimarySignals && skillEvidenceWeak && !hasIndustryConflict) {
    if (grade === "D" || grade === "F") {
      grade = "C";
    }
    if (verdict === "no_go") {
      verdict = "review";
    }
    if (!riskSignals.includes("技能证据不足，建议人工复核")) {
      riskSignals.push("技能证据不足，建议人工复核");
    }
  }

  const weightedSummary = buildWeightedSummary({
    industryFit,
    roleFit,
    locationFit,
    companyFit,
    applicationAccessibilityFit,
    preference,
    classification
  });
  const confidence = resolveDecisionConfidence({
    classification,
    preference,
    resolvedPreferenceSource,
    weightedSummary
  });
  const nextAction = resolveNextAction({
    verdict,
    hardBlockers,
    preference,
    skillFit,
    primaryClearlyWeak,
    riskSignals
  });
  const normalizedOpportunityTypeInfo = normalizeOpportunityTypeInfo(opportunityTypeInfo);
  const opportunityNextAction = resolveOpportunityNextAction({ nextAction, opportunityType: normalizedOpportunityTypeInfo.opportunityType });

  return {
    verdict,
    grade,
    confidence,
    hardBlockers: unique(hardBlockers).slice(0, 3),
    weightedSummary,
    nextAction: opportunityNextAction,
    opportunityType: normalizedOpportunityTypeInfo.opportunityType,
    opportunityTypeConfidence: normalizedOpportunityTypeInfo.opportunityTypeConfidence,
    opportunityTypeLabel: normalizedOpportunityTypeInfo.opportunityTypeLabel,
    opportunityTypeSummary: buildOpportunityTypeSummary(normalizedOpportunityTypeInfo)
  };
}

function resolveDecisionGrade(score = 0) {
  const value = numberOr(score, 0);
  if (value >= 85) return "A";
  if (value >= 75) return "B";
  if (value >= 60) return "C";
  if (value >= 40) return "D";
  return "F";
}

function buildWeightedSummary({
  industryFit = null,
  roleFit = null,
  locationFit = null,
  companyFit = null,
  applicationAccessibilityFit = null,
  preference = {},
  classification = {}
} = {}) {
  const weights = [
    { key: "role", label: "岗位契合度", score: roleFit, weight: USER_PRIORITY_DEFAULT_WEIGHTS.role },
    { key: "industry", label: "行业契合度", score: industryFit, weight: USER_PRIORITY_DEFAULT_WEIGHTS.industry },
    { key: "location", label: "地点与工作方式契合度", score: locationFit, weight: USER_PRIORITY_DEFAULT_WEIGHTS.location },
    { key: "company", label: "公司环境契合度", score: companyFit, weight: USER_PRIORITY_DEFAULT_WEIGHTS.company },
    { key: "accessibility", label: "申请门槛可达性", score: applicationAccessibilityFit, weight: USER_PRIORITY_DEFAULT_WEIGHTS.accessibility }
  ];
  return weights
    .filter((item) => isPresentDimensionScore(item.score))
    .map((item) => ({
      dimension: item.key,
      label: item.label,
      status: resolveDimensionStatus(item.score),
      score: clampScore(item.score),
      weight: numberOr(item.weight, 0),
      reason: resolveDimensionReason(item.key, item.score, preference, classification)
    }));
}

function resolveDimensionStatus(score = 0) {
  const value = numberOr(score, 0);
  if (value >= 75) return "strong";
  if (value >= 50) return "neutral";
  return "weak";
}

function resolveDimensionReason(dimension = "", score = 0, preference = {}, classification = {}) {
  const value = numberOr(score, 0);
  if (dimension === "industry") {
    if ((preference.industryPreference || []).length === 0) return "未设置正向行业偏好";
    return value >= 75 ? `命中行业：${classification.inferredIndustry || "未知"}` : "行业偏好命中较弱";
  }
  if (dimension === "role") {
    if ((preference.rolePreference || []).length === 0) return "未设置正向岗位偏好";
    return value >= 75 ? `命中岗位方向：${classification.inferredRoleFamily || "未知"}` : "岗位方向命中较弱";
  }
  if (dimension === "location") {
    if ((preference.locationPreference || []).length === 0) return "未设置地点偏好";
    return value >= 65 ? "地点匹配" : "地点不匹配";
  }
  if (dimension === "company") {
    if ((preference.companyPreference || []).length === 0 && (preference.avoidCompanyTypes || []).length === 0) return "未设置公司类型偏好";
    return value >= 70 ? "公司类型命中偏好" : "公司类型匹配弱";
  }
  if (dimension === "accessibility") {
    return value >= 70 ? "申请门槛可达性较好" : value >= 50 ? "申请门槛需要确认" : "申请门槛阻力较高";
  }
  return "匹配信号一般";
}

function resolveDecisionConfidence({
  classification = {},
  preference = {},
  resolvedPreferenceSource = "legacy",
  weightedSummary = []
} = {}) {
  let penalties = 0;
  const strongSignals = weightedSummary.filter((item) => item.status === "strong").length;
  if (strongSignals <= 1) penalties += 1;
  if (classification.mixedRoleTitle) penalties += 1;
  if (String(classification.inferredIndustryConfidence || "low").trim() === "low") penalties += 1;
  if ((preference.skillPreference || []).length === 0) penalties += 1;
  if (resolvedPreferenceSource !== "jobPreferenceProfile") penalties += 1;
  if (penalties >= 4) return "low";
  if (penalties >= 2) return "medium";
  return "high";
}

function resolveNextAction({
  verdict = "review",
  hardBlockers = [],
  preference = {},
  skillFit = null,
  primaryClearlyWeak = false,
  riskSignals = []
} = {}) {
  if (hardBlockers.length > 0) return "命中排除项，建议跳过";
  if (verdict === "go") return "优先投递";
  if (verdict === "no_go") return "不建议投递";
  if ((preference.skillPreference || []).length === 0) return "补充技能偏好后再判断";
  if (primaryClearlyWeak) return "主信号较弱，建议人工复核";
  if (riskSignals.length > 0) return "建议人工复核";
  if (Number(skillFit) < 50) return "建议人工复核";
  return "建议人工复核";
}

function normalizeDecisionVerdict(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const verdict = String(source.verdict || "").trim();
  const grade = String(source.grade || "").trim();
  const confidence = String(source.confidence || "").trim();
  const hardBlockers = Array.isArray(source.hardBlockers) ? source.hardBlockers.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const weightedSummary = Array.isArray(source.weightedSummary)
    ? source.weightedSummary
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          return {
            dimension: String(item.dimension || "").trim(),
            label: String(item.label || "").trim(),
            status: String(item.status || "").trim(),
            score: numberOr(item.score, 0),
            weight: numberOr(item.weight, 0),
            reason: String(item.reason || "").trim()
          };
        })
        .filter(Boolean)
    : [];
  const nextAction = String(source.nextAction || "").trim();
  return {
    verdict: verdict || "review",
    grade: ["A", "B", "C", "D", "F"].includes(grade) ? grade : "C",
    confidence: ["high", "medium", "low"].includes(confidence) ? confidence : "medium",
    hardBlockers: hardBlockers.slice(0, 3),
    weightedSummary,
    nextAction: nextAction || "建议人工复核",
    opportunityType: normalizeOpportunityType(source.opportunityType),
    opportunityTypeConfidence: normalizeOpportunityTypeConfidence(source.opportunityTypeConfidence),
    opportunityTypeLabel: String(source.opportunityTypeLabel || OPPORTUNITY_TYPE_LABELS[normalizeOpportunityType(source.opportunityType)]).trim(),
    opportunityTypeSummary: String(source.opportunityTypeSummary || OPPORTUNITY_TYPE_SUMMARIES[normalizeOpportunityType(source.opportunityType)]).trim()
  };
}

function normalizeUserPriorityDimensions(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const neutralIfMissing = (value) => Number.isFinite(Number(value)) ? numberOr(value, 0) : 60;
  return {
    role: neutralIfMissing(source.role),
    industry: neutralIfMissing(source.industry),
    location: neutralIfMissing(source.location),
    company: neutralIfMissing(source.company),
    accessibility: neutralIfMissing(source.accessibility)
  };
}

function normalizeSkillGapView(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const normalizeList = (value = [], max = 8) =>
    (Array.isArray(value) ? value : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, max);
  const skillEvidence = Array.isArray(source.skillEvidence)
    ? source.skillEvidence
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const skill = String(item.skill || "").trim();
          const evidenceText = String(item.evidenceText || "").trim();
          if (!skill && !evidenceText) return null;
          return { skill, evidenceText };
        })
        .filter(Boolean)
        .slice(0, 6)
    : [];
  const overallFit = String(source.overallFit || "").trim().toLowerCase();
  return {
    overallFit: ["high", "medium", "low", "unknown"].includes(overallFit) ? overallFit : "unknown",
    matchedSkills: normalizeList(source.matchedSkills, 8),
    missingSkills: normalizeList(source.missingSkills, 8),
    skillEvidence,
    hasUserSkills: Boolean(source.hasUserSkills),
    gapHint: String(source.gapHint || "").trim()
  };
}

function normalizeJobFeaturesView(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const titleClarity = String(source.titleClarity || "").trim().toLowerCase();
  const rolePurity = String(source.rolePurity || "").trim().toLowerCase();
  const sourceQualityTier = String(source.sourceQualityTier || "").trim().toLowerCase();
  const confidenceTier = String(source.confidenceTier || "").trim().toLowerCase();
  const sourceReliabilityTier = String(source.sourceReliabilityTier || "").trim().toLowerCase();
  const sourceFreshnessTier = String(source.sourceFreshnessTier || "").trim().toLowerCase();
  const sourceCompletenessTier = String(source.sourceCompletenessTier || "").trim().toLowerCase();
  const roleSemanticPurity = String(source.roleSemanticPurity || "").trim().toLowerCase();
  const seniorityTier = String(source.seniorityTier || "").trim().toLowerCase();
  const semanticConfidenceTier = String(source.semanticConfidenceTier || "").trim().toLowerCase();
  const jdBlockStructureType = String(source.jdBlockStructureType || "").trim().toLowerCase();
  const sourceAuthorityTier = String(source.sourceAuthorityTier || "").trim().toLowerCase();
  const sourceRecruitmentAuthenticity = String(source.sourceRecruitmentAuthenticity || "").trim().toLowerCase();
  const productionSourceConfidence = String(source.productionSourceConfidence || "").trim().toLowerCase();
  const sourceGovernanceTier = String(source.sourceGovernanceTier || "").trim().toLowerCase();
  const sourceMaturityLevel = String(source.sourceMaturityLevel || "").trim().toLowerCase();
  const sourceHistoricalReliability = String(source.sourceHistoricalReliability || "").trim().toLowerCase();
  const sourceCoverageDensity = String(source.sourceCoverageDensity || "").trim().toLowerCase();
  const sourceVerticalStrength = String(source.sourceVerticalStrength || "").trim().toLowerCase();
  const sourceDecayRisk = String(source.sourceDecayRisk || "").trim().toLowerCase();
  const sourceFraudRisk = String(source.sourceFraudRisk || "").trim().toLowerCase();
  const sourcePromotionEligibility = String(source.sourcePromotionEligibility || "").trim().toLowerCase();
  const freshnessTier = String(source.freshnessTier || "").trim().toLowerCase();
  const staleRisk = String(source.staleRisk || "").trim().toLowerCase();
  const normalized = {
    standardRoleFamily: String(source.standardRoleFamily || "").trim() || null,
    isCrossIndustrySafe: Boolean(source.isCrossIndustrySafe),
    highValueCompositeRole: Boolean(source.highValueCompositeRole),
    isMixedRoleJD: Boolean(source.isMixedRoleJD),
    informationDensity: numberOr(source.informationDensity, numberOr(source.jdInformationDensity, 0)),
    sourceQualityTier: ["high", "medium", "low"].includes(sourceQualityTier) ? sourceQualityTier : "medium",
    titleClarity: ["high", "medium", "low"].includes(titleClarity) ? titleClarity : "medium",
    rolePurity: ["high", "medium", "low"].includes(rolePurity) ? rolePurity : "medium",
    jdInformationDensity: numberOr(source.jdInformationDensity, numberOr(source.informationDensity, 0)),
    likelyBundledJD: Boolean(source.likelyBundledJD),
    likelySingleRoleJD: Boolean(source.likelySingleRoleJD),
    confidenceTier: ["high", "medium", "low"].includes(confidenceTier) ? confidenceTier : "medium",
    sourceReliabilityTier: ["official_ats", "company_career_page", "recruiter_repost", "aggregator", "unknown", "low_confidence"].includes(sourceReliabilityTier)
      ? sourceReliabilityTier
      : "unknown",
    sourceReliabilityScore: numberOr(source.sourceReliabilityScore, 45),
    sourceFreshnessTier: ["fresh", "recent", "stale", "unknown"].includes(sourceFreshnessTier) ? sourceFreshnessTier : "unknown",
    sourceCompletenessTier: ["high", "medium", "low"].includes(sourceCompletenessTier) ? sourceCompletenessTier : "medium",
    sourceRiskFlags: Array.isArray(source.sourceRiskFlags)
      ? source.sourceRiskFlags.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    sourceTrustScore: numberOr(source.sourceTrustScore, 50),
    sourceAuthorityTier: [
      "official_company",
      "verified_ats",
      "direct_recruiter",
      "quality_repost",
      "aggregator",
      "spam_risk",
      "unknown"
    ].includes(sourceAuthorityTier)
      ? sourceAuthorityTier
      : "unknown",
    sourceFreshnessDecay: numberOr(source.sourceFreshnessDecay, 0.28),
    sourceDuplicationRisk: numberOr(source.sourceDuplicationRisk, 0.1),
    sourceCompletenessScore: numberOr(source.sourceCompletenessScore, 60),
    sourceCommercialNoiseRisk: numberOr(source.sourceCommercialNoiseRisk, 0.1),
    sourceRecruitmentAuthenticity: ["high", "medium", "low"].includes(sourceRecruitmentAuthenticity)
      ? sourceRecruitmentAuthenticity
      : "medium",
    productionSourceConfidence: ["high", "medium", "low"].includes(productionSourceConfidence)
      ? productionSourceConfidence
      : "medium",
    sourceGovernanceTier: ["trusted_official_source", "verified_recruiting_source", "aggregated_source", "repost_source", "exploratory_source", "low_maturity_source"].includes(sourceGovernanceTier)
      ? sourceGovernanceTier
      : "exploratory_source",
    sourceMaturityLevel: ["exploratory", "stable", "trusted", "production_grade"].includes(sourceMaturityLevel)
      ? sourceMaturityLevel
      : "exploratory",
    sourceHistoricalReliability: ["high", "medium", "low"].includes(sourceHistoricalReliability)
      ? sourceHistoricalReliability
      : "medium",
    sourceCoverageDensity: ["dense", "medium", "sparse"].includes(sourceCoverageDensity)
      ? sourceCoverageDensity
      : "medium",
    sourceVerticalStrength: ["high", "medium", "low", "general"].includes(sourceVerticalStrength)
      ? sourceVerticalStrength
      : "general",
    sourceDecayRisk: ["low", "medium", "high"].includes(sourceDecayRisk)
      ? sourceDecayRisk
      : "medium",
    sourceFraudRisk: ["low", "medium", "high"].includes(sourceFraudRisk)
      ? sourceFraudRisk
      : "medium",
    sourcePromotionEligibility: ["blocked", "diagnostic_only", "review_candidate", "production_candidate"].includes(sourcePromotionEligibility)
      ? sourcePromotionEligibility
      : "diagnostic_only",
    sourceGovernanceSummary: String(source.sourceGovernanceSummary || "").trim(),
    sourceStrengthSummary: String(source.sourceStrengthSummary || "").trim(),
    sourcePromotionBlockReason: String(source.sourcePromotionBlockReason || "").trim(),
    normalizedTitle: String(source.normalizedTitle || "").trim(),
    normalizedCompany: String(source.normalizedCompany || "").trim(),
    normalizedLocation: String(source.normalizedLocation || "").trim(),
    normalizedSourceDomain: String(source.normalizedSourceDomain || "").trim(),
    duplicateClusterId: String(source.duplicateClusterId || "").trim() || null,
    duplicateConfidence: numberOr(source.duplicateConfidence, 0),
    likelyDuplicate: Boolean(source.likelyDuplicate),
    canonicalPrimaryPosting: source.canonicalPrimaryPosting !== false,
    duplicateSourceCount: Math.max(1, numberOr(source.duplicateSourceCount, 1)),
    postingAgeDays:
      source.postingAgeDays === null || source.postingAgeDays === undefined
        ? null
        : Math.max(0, Math.round(numberOr(source.postingAgeDays, 0))),
    freshnessScore: numberOr(source.freshnessScore, 50),
    freshnessTier: ["fresh", "recent", "aging", "stale", "unknown"].includes(freshnessTier) ? freshnessTier : "unknown",
    staleRisk: ["low", "medium", "high", "unknown"].includes(staleRisk) ? staleRisk : "unknown",
    likelyExpired: Boolean(source.likelyExpired),
    opportunityType: normalizeOpportunityType(source.opportunityType),
    opportunityTypeConfidence: normalizeOpportunityTypeConfidence(source.opportunityTypeConfidence),
    opportunityTypeSummary: String(source.opportunityTypeSummary || "").trim(),
    primaryResponsibilityRole: String(source.primaryResponsibilityRole || "").trim() || "未知",
    roleSemanticPurity: ["high", "medium", "low"].includes(roleSemanticPurity) ? roleSemanticPurity : "medium",
    mustHaveSignals: Array.isArray(source.mustHaveSignals)
      ? source.mustHaveSignals.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8)
      : [],
    bonusSignals: Array.isArray(source.bonusSignals)
      ? source.bonusSignals.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8)
      : [],
    likelyBundledResponsibilities: Boolean(source.likelyBundledResponsibilities),
    seniorityTier: ["intern", "entry", "mid", "senior", "lead", "unknown"].includes(seniorityTier) ? seniorityTier : "unknown",
    semanticConfidenceTier: ["high", "medium", "low"].includes(semanticConfidenceTier) ? semanticConfidenceTier : "medium",
    jdBlockStructureType: [
      "clean_single_role",
      "bundled_multi_role",
      "broad_recruitment",
      "internship_rotation",
      "composite_high_value",
      "unclear_low_signal"
    ].includes(jdBlockStructureType)
      ? jdBlockStructureType
      : "unclear_low_signal"
  };
  const semanticFeatures = normalizeSemanticFeaturesModule(source.featureLayerModules?.semanticFeatures, normalized);
  const sourceGovernanceFeatures = normalizeSourceGovernanceFeaturesModule(source.featureLayerModules?.sourceGovernanceFeatures, normalized);
  const dedupeFreshnessFeatures = normalizeDedupeFreshnessFeaturesModule(source.featureLayerModules?.dedupeFreshnessFeatures, normalized);
  const { rolePurity: _legacyRolePurity, sourceFreshnessTier: _legacySourceFreshnessTier, ...normalizedWithoutLegacyOutput } = normalized;
  return {
    ...normalizedWithoutLegacyOutput,
    featureLayerModules: { semanticFeatures, sourceGovernanceFeatures, dedupeFreshnessFeatures },
    deprecatedFieldAliases: source.deprecatedFieldAliases && typeof source.deprecatedFieldAliases === "object"
      ? source.deprecatedFieldAliases
      : buildDeprecatedFeatureAliases({ rolePurity: normalized.rolePurity, sourceFreshnessTier: normalized.sourceFreshnessTier, freshnessTier: normalized.freshnessTier, sourceDecayRisk: normalized.sourceDecayRisk }),
    governanceContractVersion: String(source.governanceContractVersion || "").trim() || "phase8a5"
  };
}

function buildSemanticFeaturesModule({ standardRoleFamily = null, isCrossIndustrySafe = false, highValueCompositeRole = false, isMixedRoleJD = false, titleClarity = "medium", rolePurity = "medium", sourceQualityTier = "medium", confidenceTier = "medium", jdInformationDensity = 0, likelyBundledJD = false, likelySingleRoleJD = false, semanticJd = {} } = {}) {
  return {
    standardRoleFamily, isCrossIndustrySafe, highValueCompositeRole, isMixedRoleJD, titleClarity,
    rolePurityLegacy: rolePurity, sourceQualityTier, confidenceTier, jdInformationDensity, likelyBundledJD, likelySingleRoleJD,
    primaryResponsibilityRole: String(semanticJd.primaryResponsibilityRole || "").trim() || "??",
    roleSemanticPurity: String(semanticJd.roleSemanticPurity || "medium").trim().toLowerCase(),
    mustHaveSignals: Array.isArray(semanticJd.mustHaveSignals) ? semanticJd.mustHaveSignals : [],
    bonusSignals: Array.isArray(semanticJd.bonusSignals) ? semanticJd.bonusSignals : [],
    likelyBundledResponsibilities: Boolean(semanticJd.likelyBundledResponsibilities),
    seniorityTier: String(semanticJd.seniorityTier || "unknown").trim().toLowerCase(),
    semanticConfidenceTier: String(semanticJd.semanticConfidenceTier || "medium").trim().toLowerCase(),
    jdBlockStructureType: String(semanticJd.jdBlockStructureType || "unclear_low_signal").trim().toLowerCase()
  };
}

function buildSourceGovernanceFeaturesModule(fields = {}) {
  return {
    freshnessTier: String(fields.freshnessTier || "unknown").trim().toLowerCase(),
    sourceReliabilityTier: fields.sourceReliabilityTier, sourceReliabilityScore: fields.sourceReliabilityScore,
    sourceFreshnessTierLegacy: fields.sourceFreshnessTier, sourceCompletenessTier: fields.sourceCompletenessTier,
    sourceRiskFlags: Array.isArray(fields.sourceRiskFlags) ? fields.sourceRiskFlags : [], sourceTrustScore: fields.sourceTrustScore,
    sourceAuthorityTier: fields.sourceAuthorityTier, sourceFreshnessDecay: fields.sourceFreshnessDecay, sourceDuplicationRisk: fields.sourceDuplicationRisk,
    sourceCompletenessScore: fields.sourceCompletenessScore, sourceCommercialNoiseRisk: fields.sourceCommercialNoiseRisk,
    sourceRecruitmentAuthenticity: fields.sourceRecruitmentAuthenticity, productionSourceConfidence: fields.productionSourceConfidence,
    sourceGovernanceTier: fields.sourceGovernanceTier, sourceMaturityLevel: fields.sourceMaturityLevel, sourceHistoricalReliability: fields.sourceHistoricalReliability,
    sourceCoverageDensity: fields.sourceCoverageDensity, sourceVerticalStrength: fields.sourceVerticalStrength, sourceDecayRisk: fields.sourceDecayRisk,
    sourceFraudRisk: fields.sourceFraudRisk, sourcePromotionEligibility: fields.sourcePromotionEligibility,
    sourceGovernanceSummary: fields.sourceGovernanceSummary, sourceStrengthSummary: fields.sourceStrengthSummary, sourcePromotionBlockReason: fields.sourcePromotionBlockReason
  };
}

function buildDedupeFreshnessFeaturesModule({ normalizedTitle = "", normalizedCompany = "", normalizedLocation = "", normalizedSourceDomain = "", dedupeFeatures = {}, freshnessFeatures = {}, sourceFreshnessTier = "unknown", sourceDecayRisk = "medium" } = {}) {
  return {
    normalizedTitle, normalizedCompany, normalizedLocation, normalizedSourceDomain,
    duplicateClusterId: String(dedupeFeatures.duplicateClusterId || "").trim() || null, duplicateConfidence: numberOr(dedupeFeatures.duplicateConfidence, 0),
    likelyDuplicate: Boolean(dedupeFeatures.likelyDuplicate), canonicalPrimaryPosting: dedupeFeatures.canonicalPrimaryPosting !== false,
    duplicateSourceCount: Math.max(1, numberOr(dedupeFeatures.duplicateSourceCount, 1)),
    postingAgeDays: freshnessFeatures.postingAgeDays == null ? null : Math.max(0, Math.round(numberOr(freshnessFeatures.postingAgeDays, 0))),
    freshnessScore: numberOr(freshnessFeatures.freshnessScore, 50), freshnessTier: String(freshnessFeatures.freshnessTier || "unknown").trim().toLowerCase(),
    staleRisk: String(freshnessFeatures.staleRisk || "unknown").trim().toLowerCase(), likelyExpired: Boolean(freshnessFeatures.likelyExpired),
    sourceFreshnessTierLegacy: String(sourceFreshnessTier || "unknown").trim().toLowerCase(), sourceDecayRisk
  };
}

function buildDeprecatedFeatureAliases({ rolePurity = "medium", sourceFreshnessTier = "unknown", freshnessTier = "unknown", sourceDecayRisk = "medium" } = {}) {
  return {
    rolePurity: { path: "featureLayerModules.semanticFeatures.rolePurityLegacy", status: "deprecated_compat_alias", replacement: "roleSemanticPurity", reason: "rolePurity ? roleSemanticPurity ???????????????????", value: rolePurity },
    sourceFreshnessTier: { path: "featureLayerModules.sourceGovernanceFeatures.sourceFreshnessTierLegacy", status: "deprecated_compat_alias", replacement: "freshnessTier", reason: "sourceFreshnessTier ??? source metadata?freshnessTier ????????", value: sourceFreshnessTier },
    sourceDecayRisk: { path: "featureLayerModules.sourceGovernanceFeatures.sourceDecayRisk", status: "legacy_retained", replacement: "sourceDecayRisk", reason: "????????????????????? decay ???", value: sourceDecayRisk },
    freshnessTier: { path: "featureLayerModules.dedupeFreshnessFeatures.freshnessTier", status: "active_canonical", replacement: "freshnessTier", reason: "?? dedupe/freshness ???????", value: freshnessTier }
  };
}

function normalizeSemanticFeaturesModule(input = {}, fallback = {}) {
  const source = input && typeof input === "object" ? input : {};
  const rolePurityLegacy = String(source.rolePurityLegacy || fallback.rolePurity || "medium").trim().toLowerCase();
  return {
    standardRoleFamily: String(source.standardRoleFamily || fallback.standardRoleFamily || "").trim() || null,
    isCrossIndustrySafe: source.isCrossIndustrySafe !== undefined ? Boolean(source.isCrossIndustrySafe) : Boolean(fallback.isCrossIndustrySafe),
    highValueCompositeRole: source.highValueCompositeRole !== undefined ? Boolean(source.highValueCompositeRole) : Boolean(fallback.highValueCompositeRole),
    isMixedRoleJD: source.isMixedRoleJD !== undefined ? Boolean(source.isMixedRoleJD) : Boolean(fallback.isMixedRoleJD),
    titleClarity: String(source.titleClarity || fallback.titleClarity || "medium").trim().toLowerCase(),
    rolePurityLegacy,
    sourceQualityTier: String(source.sourceQualityTier || fallback.sourceQualityTier || "medium").trim().toLowerCase(),
    confidenceTier: String(source.confidenceTier || fallback.confidenceTier || "medium").trim().toLowerCase(),
    jdInformationDensity: numberOr(source.jdInformationDensity, numberOr(fallback.jdInformationDensity, 0)),
    likelyBundledJD: source.likelyBundledJD !== undefined ? Boolean(source.likelyBundledJD) : Boolean(fallback.likelyBundledJD),
    likelySingleRoleJD: source.likelySingleRoleJD !== undefined ? Boolean(source.likelySingleRoleJD) : Boolean(fallback.likelySingleRoleJD),
    primaryResponsibilityRole: String(source.primaryResponsibilityRole || fallback.primaryResponsibilityRole || "??").trim() || "??",
    roleSemanticPurity: String(source.roleSemanticPurity || rolePurityLegacy || fallback.roleSemanticPurity || "medium").trim().toLowerCase(),
    mustHaveSignals: Array.isArray(source.mustHaveSignals) ? source.mustHaveSignals : Array.isArray(fallback.mustHaveSignals) ? fallback.mustHaveSignals : [],
    bonusSignals: Array.isArray(source.bonusSignals) ? source.bonusSignals : Array.isArray(fallback.bonusSignals) ? fallback.bonusSignals : [],
    likelyBundledResponsibilities: source.likelyBundledResponsibilities !== undefined ? Boolean(source.likelyBundledResponsibilities) : Boolean(fallback.likelyBundledResponsibilities),
    seniorityTier: String(source.seniorityTier || fallback.seniorityTier || "unknown").trim().toLowerCase(),
    semanticConfidenceTier: String(source.semanticConfidenceTier || fallback.semanticConfidenceTier || "medium").trim().toLowerCase(),
    jdBlockStructureType: String(source.jdBlockStructureType || fallback.jdBlockStructureType || "unclear_low_signal").trim().toLowerCase()
  };
}

function normalizeSourceGovernanceFeaturesModule(input = {}, fallback = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    freshnessTier: String(source.freshnessTier || fallback.freshnessTier || fallback.sourceFreshnessTier || "unknown").trim().toLowerCase(),
    sourceReliabilityTier: String(source.sourceReliabilityTier || fallback.sourceReliabilityTier || "unknown").trim().toLowerCase(),
    sourceReliabilityScore: numberOr(source.sourceReliabilityScore, numberOr(fallback.sourceReliabilityScore, 45)),
    sourceFreshnessTierLegacy: String(source.sourceFreshnessTierLegacy || fallback.sourceFreshnessTier || "unknown").trim().toLowerCase(),
    sourceCompletenessTier: String(source.sourceCompletenessTier || fallback.sourceCompletenessTier || "medium").trim().toLowerCase(),
    sourceRiskFlags: Array.isArray(source.sourceRiskFlags) ? source.sourceRiskFlags : Array.isArray(fallback.sourceRiskFlags) ? fallback.sourceRiskFlags : [],
    sourceTrustScore: numberOr(source.sourceTrustScore, numberOr(fallback.sourceTrustScore, 50)),
    sourceAuthorityTier: String(source.sourceAuthorityTier || fallback.sourceAuthorityTier || "unknown").trim().toLowerCase(),
    sourceFreshnessDecay: numberOr(source.sourceFreshnessDecay, numberOr(fallback.sourceFreshnessDecay, 0.28)),
    sourceDuplicationRisk: numberOr(source.sourceDuplicationRisk, numberOr(fallback.sourceDuplicationRisk, 0.1)),
    sourceCompletenessScore: numberOr(source.sourceCompletenessScore, numberOr(fallback.sourceCompletenessScore, 60)),
    sourceCommercialNoiseRisk: numberOr(source.sourceCommercialNoiseRisk, numberOr(fallback.sourceCommercialNoiseRisk, 0.1)),
    sourceRecruitmentAuthenticity: String(source.sourceRecruitmentAuthenticity || fallback.sourceRecruitmentAuthenticity || "medium").trim().toLowerCase(),
    productionSourceConfidence: String(source.productionSourceConfidence || fallback.productionSourceConfidence || "medium").trim().toLowerCase(),
    sourceGovernanceTier: String(source.sourceGovernanceTier || fallback.sourceGovernanceTier || "exploratory_source").trim().toLowerCase(),
    sourceMaturityLevel: String(source.sourceMaturityLevel || fallback.sourceMaturityLevel || "exploratory").trim().toLowerCase(),
    sourceHistoricalReliability: String(source.sourceHistoricalReliability || fallback.sourceHistoricalReliability || "medium").trim().toLowerCase(),
    sourceCoverageDensity: String(source.sourceCoverageDensity || fallback.sourceCoverageDensity || "medium").trim().toLowerCase(),
    sourceVerticalStrength: String(source.sourceVerticalStrength || fallback.sourceVerticalStrength || "general").trim().toLowerCase(),
    sourceDecayRisk: String(source.sourceDecayRisk || fallback.sourceDecayRisk || "medium").trim().toLowerCase(),
    sourceFraudRisk: String(source.sourceFraudRisk || fallback.sourceFraudRisk || "medium").trim().toLowerCase(),
    sourcePromotionEligibility: String(source.sourcePromotionEligibility || fallback.sourcePromotionEligibility || "diagnostic_only").trim().toLowerCase(),
    sourceGovernanceSummary: String(source.sourceGovernanceSummary || fallback.sourceGovernanceSummary || "").trim(),
    sourceStrengthSummary: String(source.sourceStrengthSummary || fallback.sourceStrengthSummary || "").trim(),
    sourcePromotionBlockReason: String(source.sourcePromotionBlockReason || fallback.sourcePromotionBlockReason || "").trim()
  };
}

function normalizeDedupeFreshnessFeaturesModule(input = {}, fallback = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    normalizedTitle: String(source.normalizedTitle || fallback.normalizedTitle || "").trim(),
    normalizedCompany: String(source.normalizedCompany || fallback.normalizedCompany || "").trim(),
    normalizedLocation: String(source.normalizedLocation || fallback.normalizedLocation || "").trim(),
    normalizedSourceDomain: String(source.normalizedSourceDomain || fallback.normalizedSourceDomain || "").trim(),
    duplicateClusterId: String(source.duplicateClusterId || fallback.duplicateClusterId || "").trim() || null,
    duplicateConfidence: numberOr(source.duplicateConfidence, numberOr(fallback.duplicateConfidence, 0)),
    likelyDuplicate: source.likelyDuplicate !== undefined ? Boolean(source.likelyDuplicate) : Boolean(fallback.likelyDuplicate),
    canonicalPrimaryPosting: source.canonicalPrimaryPosting !== undefined ? Boolean(source.canonicalPrimaryPosting) : fallback.canonicalPrimaryPosting !== false,
    duplicateSourceCount: Math.max(1, numberOr(source.duplicateSourceCount, numberOr(fallback.duplicateSourceCount, 1))),
    postingAgeDays: source.postingAgeDays == null ? (fallback.postingAgeDays == null ? null : Math.max(0, Math.round(numberOr(fallback.postingAgeDays, 0)))) : Math.max(0, Math.round(numberOr(source.postingAgeDays, 0))),
    freshnessScore: numberOr(source.freshnessScore, numberOr(fallback.freshnessScore, 50)),
    freshnessTier: String(source.freshnessTier || fallback.freshnessTier || "unknown").trim().toLowerCase(),
    staleRisk: String(source.staleRisk || fallback.staleRisk || "unknown").trim().toLowerCase(),
    likelyExpired: source.likelyExpired !== undefined ? Boolean(source.likelyExpired) : Boolean(fallback.likelyExpired),
    sourceFreshnessTierLegacy: String(source.sourceFreshnessTierLegacy || fallback.sourceFreshnessTier || "unknown").trim().toLowerCase(),
    sourceDecayRisk: String(source.sourceDecayRisk || fallback.sourceDecayRisk || "medium").trim().toLowerCase()
  };
}


function numberOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function clampScore(score) {
  const normalized = Number(score);
  if (!Number.isFinite(normalized)) return 1;
  return Math.max(1, Math.min(100, Math.round(normalized)));
}

function toPositiveWeight(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw;
}

function unique(items = []) {
  return Array.from(new Set((Array.isArray(items) ? items : []).filter(Boolean)));
}

module.exports = {
  buildJobScoringViewModel,
  attachScoringToJobWorkspaceViewModel,
  buildJobDeduplicationContext
};
