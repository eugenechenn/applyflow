"use strict";

/**
 * TopN 岗位的 LLM 精排派生层：
 * - 只读，不写回 canonical job
 * - 单条失败自动回退规则评分
 * - 默认关闭，通过环境变量显式开启
 */
const crypto = require("node:crypto");
const logger = require("../../server/platform/logger");
const { callGLMJson, getGlmConfig } = require("../llm/glm-client");
const jobScoringCache = new Map();
const llmScoringInFlight = new Map();
const backgroundTaskStateByCacheKey = new Map();

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function resolveCacheTtlMs(defaultValue = 600000) {
  const raw = Number(process.env.LLM_JOB_SCORING_CACHE_TTL_MS || defaultValue);
  if (!Number.isFinite(raw)) return defaultValue;
  return Math.max(60000, Math.min(3600000, Math.floor(raw)));
}

function buildProfileHash(profile = {}) {
  const normalized = {
    lightweightProfile: profile?.lightweightProfile || profile || {},
    autofillProfile: profile?.autofillProfile || {}
  };
  return crypto.createHash("sha1").update(stableStringify(normalized)).digest("hex");
}

function buildCacheKey(jobId = "", profileHash = "") {
  return `${String(jobId || "").trim()}::${String(profileHash || "").trim()}`;
}

function setBackgroundTaskState(jobId = "", profileHash = "", state = "not_started") {
  const key = buildCacheKey(jobId, profileHash);
  backgroundTaskStateByCacheKey.set(key, {
    state: String(state || "not_started").trim() || "not_started",
    updatedAt: Date.now()
  });
}

function getBackgroundTaskState(jobId = "", profileHash = "") {
  const key = buildCacheKey(jobId, profileHash);
  return backgroundTaskStateByCacheKey.get(key)?.state || "not_started";
}

function readCache(jobId = "", profileHash = "") {
  const key = buildCacheKey(jobId, profileHash);
  const cached = jobScoringCache.get(key);
  if (!cached) return { hit: false, cacheAgeMs: 0, data: null, cacheState: "miss" };
  const cacheAgeMs = Math.max(0, Date.now() - Number(cached.timestamp || 0));
  if (cacheAgeMs > resolveCacheTtlMs()) {
    jobScoringCache.delete(key);
    return { hit: false, cacheAgeMs, data: null, cacheState: "expired" };
  }
  const aiStatus = String(cached.aiStatus || "").trim().toLowerCase();
  const cacheState = aiStatus === "ready" ? "hit_ready" : aiStatus === "fallback" ? "hit_fallback" : "hit";
  return { hit: true, cacheAgeMs, data: cached, cacheState };
}

function writeCache(jobId = "", profileHash = "", aiData = {}, meta = {}) {
  const key = buildCacheKey(jobId, profileHash);
  const aiScore = clampScore(aiData.aiScore, 0);
  const aiRecommendation = normalizeRecommendation(aiData.aiRecommendation, aiScore);
  const aiGrade = normalizeGrade(aiData.aiGrade, aiScore);
  const aiRisks = normalizeList(aiData.aiRisks, 1);
  const aiStatus = String(aiData.aiStatus || "ready").trim().toLowerCase() === "fallback" ? "fallback" : "ready";
  jobScoringCache.set(key, {
    aiScore,
    aiRecommendation,
    aiExplanation: String(aiData.aiExplanation || "").trim(),
    aiMatchedSignals: normalizeMatchedSignals(aiData.aiMatchedSignals, 2),
    aiRisks,
    aiGrade,
    dimensions: normalizeDimensions(aiData.dimensions, buildDefaultDimensions({ aiScore, aiRisks })),
    nextAction: normalizeNextAction(aiData.nextAction, aiRecommendation, aiScore),
    aiStatus,
    fallbackCanBeOverwritten:
      aiStatus === "fallback"
        ? meta.fallbackCanBeOverwritten !== false
        : false,
    timestamp: Date.now()
  });
}

function isLlmJobScoringEnabled() {
  const value = String(process.env.ENABLE_LLM_JOB_SCORING || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function isLlmRankingModeEnabled() {
  const value = String(process.env.LLM_RANKING_MODE || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function resolveTopN(defaultValue = 30, maxValue = 100) {
  const raw = Number(process.env.LLM_JOB_SCORING_TOP_N || defaultValue);
  if (!Number.isFinite(raw)) return defaultValue;
  return Math.max(1, Math.min(maxValue, Math.floor(raw)));
}

function resolveTimeoutMs(defaultValue = 30000) {
  const raw = Number(process.env.LLM_JOB_SCORING_TIMEOUT_MS || defaultValue);
  if (!Number.isFinite(raw)) return defaultValue;
  return Math.max(1000, Math.min(120000, Math.floor(raw)));
}

function resolveRankingTimeoutMs(defaultValue = 20000) {
  const raw = Number(process.env.LLM_JOB_RANKING_TIMEOUT_MS || defaultValue);
  if (!Number.isFinite(raw)) return defaultValue;
  return Math.max(5000, Math.min(20000, Math.floor(raw)));
}

function clampScore(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeList(value, max = 6) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeMatchedSignals(value, max = 4) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const profileSignal = String(item.profileSignal || "").trim();
      const jobEvidence = String(item.jobEvidence || "").trim();
      const reason = String(item.reason || "").trim();
      if (!profileSignal || !jobEvidence || !reason) return null;
      return { profileSignal, jobEvidence, reason };
    })
    .filter(Boolean)
    .slice(0, max);
}

function normalizeRecommendation(value, fallbackScore = 0) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "apply" || raw === "consider" || raw === "skip") return raw;
  if (fallbackScore >= 75) return "apply";
  if (fallbackScore >= 45) return "consider";
  return "skip";
}

function deriveGradeFromScore(score = 0) {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  return "D";
}

function normalizeGrade(value, fallbackScore = 0) {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "A" || raw === "B" || raw === "C" || raw === "D") return raw;
  return deriveGradeFromScore(clampScore(fallbackScore, 0));
}

function normalizeNextAction(value, recommendation = "", score = 0) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "apply_now" || raw === "review_details" || raw === "skip") return raw;
  const rec = String(recommendation || "").trim().toLowerCase();
  if (rec === "apply" && score >= 75) return "apply_now";
  if (rec === "skip" || score < 45) return "skip";
  return "review_details";
}

function includesKeyword(haystack = "", keyword = "") {
  const source = String(haystack || "").toLowerCase();
  const target = String(keyword || "").trim().toLowerCase();
  if (!source || !target) return false;
  return source.includes(target);
}

// 将常见地点做中英同义扩展，提升 LLM 对齐稳定性。
function buildLocationVariants(locations = []) {
  const aliasMap = {
    上海: ["上海", "Shanghai"],
    北京: ["北京", "Beijing"],
    shanghai: ["上海", "Shanghai"],
    beijing: ["北京", "Beijing"]
  };
  const variants = new Set();
  (Array.isArray(locations) ? locations : []).forEach((item) => {
    const raw = String(item || "").trim();
    if (!raw) return;
    variants.add(raw);
    const alias = aliasMap[raw] || aliasMap[raw.toLowerCase()];
    (alias || []).forEach((v) => variants.add(v));
  });
  return Array.from(variants);
}

// 从岗位标题/地点提取可验证证据片段，降低模板化输出。
function buildEvidenceHints({ jobSummary = {}, lightweightProfile = {} } = {}) {
  const title = String(jobSummary.title || "");
  const location = String(jobSummary.location || "");
  const lowerTitle = title.toLowerCase();
  const lowerLocation = location.toLowerCase();

  const roleSignals = Array.isArray(lightweightProfile.targetRoles) ? lightweightProfile.targetRoles : [];
  const skillSignals = Array.isArray(lightweightProfile.skills) ? lightweightProfile.skills : [];
  const locationSignals = buildLocationVariants(lightweightProfile.preferredLocations);

  const matchedRoleHints = roleSignals.filter((signal) => {
    const s = String(signal || "").trim().toLowerCase();
    return s && lowerTitle.includes(s);
  });
  const matchedSkillHints = skillSignals.filter((signal) => {
    const s = String(signal || "").trim().toLowerCase();
    return s && lowerTitle.includes(s);
  });
  const matchedLocationHints = locationSignals.filter((signal) => {
    const s = String(signal || "").trim().toLowerCase();
    return s && lowerLocation.includes(s);
  });

  return {
    title: title.slice(0, 120),
    location: location.slice(0, 60),
    matchedRoleHints,
    matchedSkillHints,
    matchedLocationHints,
    locationSynonyms: {
      上海: ["上海", "Shanghai"],
      北京: ["北京", "Beijing"]
    }
  };
}

function getRuleSnapshot(scoringView = {}) {
  const nullableScore = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" && value.trim() === "") return null;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  };
  return {
    score: clampScore(scoringView.score, 0),
    preferenceMatchScore: clampScore(scoringView.preferenceMatchScore ?? scoringView.score, 0),
    industryFit: Number(scoringView.industryFit || 0),
    roleFit: Number(scoringView.roleFit || 0),
    skillFit: nullableScore(scoringView.skillFit),
    locationFit: nullableScore(scoringView.locationFit),
    qualityBase: Number(scoringView.qualityBase || 0),
    explanation: String(scoringView.explanation || "").trim(),
    matchedSignals: normalizeList(scoringView.matchedSignals, 8),
    risks: normalizeList(scoringView.risks, 8),
    preferenceType: String(scoringView.preferenceType || "unknown").trim(),
    inferredIndustry: String(scoringView.inferredIndustry || "").trim(),
    inferredRoleFamily: String(scoringView.inferredRoleFamily || "").trim(),
    inferredSkills: normalizeList(scoringView.inferredSkills, 12),
    matchSignals: normalizeList(scoringView.matchSignals, 12),
    mismatchSignals: normalizeList(scoringView.mismatchSignals, 12),
    locationFitLevel: String(scoringView.locationFitLevel || "").trim()
  };
}

function buildJobDescription(jobWorkspaceViewModel = {}) {
  const decision = jobWorkspaceViewModel.decisionView || {};
  return [
    String(decision.summary || "").trim(),
    String(decision.rationale || "").trim(),
    normalizeList(decision.evidence, 4).join("；"),
    normalizeList(decision.gaps, 4).join("；")
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 180);
}

function buildDefaultDimensions({
  aiScore = 0,
  jobWorkspaceViewModel = {},
  lightweightProfile = {},
  aiRisks = []
} = {}) {
  const score = clampScore(aiScore, 0);
  const jobSummary = jobWorkspaceViewModel?.jobSummary || {};
  const title = String(jobSummary.title || "").toLowerCase();
  const description = buildJobDescription(jobWorkspaceViewModel).toLowerCase();
  const location = String(jobSummary.location || "").toLowerCase();
  const roleSignals = Array.isArray(lightweightProfile.targetRoles) ? lightweightProfile.targetRoles : [];
  const skillSignals = Array.isArray(lightweightProfile.skills) ? lightweightProfile.skills : [];
  const locationSignals = buildLocationVariants(lightweightProfile.preferredLocations);
  const locationLevel = String(jobWorkspaceViewModel?.scoringView?.locationFitLevel || "").trim().toLowerCase();
  const roleMatched = roleSignals.some((signal) => includesKeyword(title, signal));
  const skillMatched = skillSignals.some((signal) => includesKeyword(`${title} ${description}`, signal));
  const locationMatched =
    locationSignals.length === 0
      ? true
      : locationSignals.some((signal) => includesKeyword(location, signal));
  const hasApplyUrl = Boolean(String(jobSummary.applyUrl || jobSummary.noticeUrl || jobSummary.sourceUrl || "").trim());
  const riskPenalty = Array.isArray(aiRisks) && aiRisks.length > 0 ? 8 : 0;

  return {
    roleFit: clampScore(score + (roleMatched ? 10 : -10), score),
    skillFit: clampScore(score + (skillMatched ? 6 : -14), score),
    locationFit:
      locationLevel === "exact"
        ? 90
        : locationLevel === "same_city"
          ? 60
          : locationMatched
            ? 75
            : locationSignals.length > 0
              ? 20
              : 50,
    applicationFriction: hasApplyUrl ? 35 : 72,
    uncertainty: clampScore(100 - score + riskPenalty, 40)
  };
}

function normalizeDimensions(value, fallback = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const resolved = {
    roleFit: clampScore(source.roleFit, clampScore(fallback.roleFit, 0)),
    skillFit: clampScore(source.skillFit, clampScore(fallback.skillFit, 0)),
    locationFit: clampScore(source.locationFit, clampScore(fallback.locationFit, 0)),
    applicationFriction: clampScore(source.applicationFriction, clampScore(fallback.applicationFriction, 0)),
    uncertainty: clampScore(source.uncertainty, clampScore(fallback.uncertainty, 0))
  };
  const unique = new Set(Object.values(resolved)).size;
  if (unique >= 2) return resolved;
  return {
    roleFit: clampScore(resolved.roleFit + 8, resolved.roleFit),
    skillFit: clampScore(resolved.skillFit - 6, resolved.skillFit),
    locationFit: clampScore(resolved.locationFit + 2, resolved.locationFit),
    applicationFriction: clampScore(resolved.applicationFriction + 12, resolved.applicationFriction),
    uncertainty: clampScore(resolved.uncertainty + 10, resolved.uncertainty)
  };
}

function inferConcreteRisk(jobPayload = {}, lightweightProfile = {}) {
  const title = String(jobPayload?.title || "");
  const location = String(jobPayload?.location || "");
  const description = String(jobPayload?.description || "");
  const combined = `${title} ${location} ${description}`.toLowerCase();
  const skills = Array.isArray(lightweightProfile?.skills) ? lightweightProfile.skills : [];
  const missingSkill = skills.find((skill) => {
    const token = String(skill || "").trim();
    return token && !includesKeyword(combined, token);
  });
  if (missingSkill) return `岗位未明确提及${missingSkill}技能`;

  if (/[|／/、]/.test(title) || /类/.test(title)) {
    return "岗位方向较宽，实际职责不够明确";
  }

  const preferredLocations = buildLocationVariants(lightweightProfile?.preferredLocations);
  const locationMatched = preferredLocations.some((loc) => includesKeyword(location, loc));
  if (!locationMatched && preferredLocations.length > 0) {
    return "岗位地点匹配信息不足，需进一步确认";
  }

  return "岗位文本关键信息较少，需进一步确认职责边界";
}

function inferMatchedSignals(jobPayload = {}, lightweightProfile = {}) {
  const title = String(jobPayload?.title || "");
  const location = String(jobPayload?.location || "");
  const description = String(jobPayload?.description || "");
  const combined = `${title} ${description}`;
  const titleAndLocation = `${title} ${location}`;

  const roleSignals = Array.isArray(lightweightProfile?.targetRoles) ? lightweightProfile.targetRoles : [];
  const skillSignals = Array.isArray(lightweightProfile?.skills) ? lightweightProfile.skills : [];
  const locationSignals = buildLocationVariants(lightweightProfile?.preferredLocations);
  const signalCandidates = [...roleSignals, ...skillSignals, ...locationSignals];
  const matched = signalCandidates.find((signal) => includesKeyword(titleAndLocation, signal) || includesKeyword(combined, signal));
  if (matched) {
    const evidenceSource = includesKeyword(title, matched)
      ? title
      : includesKeyword(location, matched)
        ? location
        : combined;
    return [
      {
        profileSignal: String(matched).trim(),
        jobEvidence: String(evidenceSource || "").trim().slice(0, 30),
        reason: "岗位文本直接命中该偏好信号"
      }
    ];
  }
  return [
    {
      profileSignal: "低匹配信号",
      jobEvidence: String(title || location || "岗位信息").trim().slice(0, 30),
      reason: "岗位文本仅体现部分关键词，匹配度有限"
    }
  ];
}

function buildDecisionExplanation(item = {}, jobPayload = {}, lightweightProfile = {}, maxScore = 0) {
  const matchedSignals = Array.isArray(item.aiMatchedSignals) ? item.aiMatchedSignals : [];
  const matchedSummary = matchedSignals
    .map((signal) => String(signal?.profileSignal || "").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("、");
  const matchedText = matchedSummary || "岗位关键词";
  const advantage =
    item.aiScore >= 88
      ? "核心方向匹配度高"
      : item.aiScore >= 75
        ? "关键方向具备匹配"
        : "仅部分条件匹配";
  const risk = (Array.isArray(item.aiRisks) ? item.aiRisks : []).find(Boolean) || inferConcreteRisk(jobPayload, lightweightProfile);
  const compareText = item.aiScore >= maxScore ? "相比其他岗位更优先" : "低于更高分岗位";
  return `匹配点：${matchedText}；优势：${advantage}；缺口：${risk}，${compareText}。`;
}

function buildRuleFallbackExplanation({
  ruleScoring = {},
  lightweightProfile = {},
  jobWorkspaceViewModel = {}
} = {}) {
  const targetRoles = Array.isArray(lightweightProfile.targetRoles) ? lightweightProfile.targetRoles : [];
  const skills = Array.isArray(lightweightProfile.skills) ? lightweightProfile.skills : [];
  const title = String(jobWorkspaceViewModel?.jobSummary?.title || "");
  const description = String(jobWorkspaceViewModel?.jobSummary?.description || "");
  const corpus = `${title} ${description}`.toLowerCase();
  const roleMatched = targetRoles.some((role) => includesKeyword(corpus, role));
  const skillMatched = skills.some((skill) => includesKeyword(corpus, skill));
  const locationLevel = String(ruleScoring.locationFitLevel || "").trim().toLowerCase();
  const locationText = locationLevel === "exact" ? "地点匹配" : locationLevel === "same_city" ? "地点同城匹配" : "地点不匹配";
  const lowReason = Number(ruleScoring.score || 0) <= 50 ? "与目标方向不符导致低分" : "匹配存在缺口";
  return `${roleMatched ? "匹配用户目标岗位" : "不匹配用户目标方向"}，${skillMatched ? "命中部分技能" : "技能命中较少"}，${locationText}，${lowReason}。`;
}

function enforceRankingItemQuality(items = [], jobPayloadById = new Map(), lightweightProfile = {}) {
  const maxScore = items.reduce((max, item) => Math.max(max, Number(item?.aiScore || 0)), 0);
  return items.map((item) => {
    const jobPayload = jobPayloadById.get(String(item.jobId || "")) || {};
    const aiRisks = normalizeList(item.aiRisks, 1);
    const riskLooksSpecific =
      aiRisks.length > 0 &&
      /未明确|未提及|不确定|较宽|不足|未说明|缺失/.test(String(aiRisks[0] || ""));
    const ensuredRisk = riskLooksSpecific ? aiRisks : [inferConcreteRisk(jobPayload, lightweightProfile)];
    const aiMatchedSignalsRaw = normalizeMatchedSignals(item.aiMatchedSignals, 2);
    const aiMatchedSignals = aiMatchedSignalsRaw.length > 0 ? aiMatchedSignalsRaw : inferMatchedSignals(jobPayload, lightweightProfile);
    const rawExplanation = String(item.aiExplanation || "").trim();
    const hasThreePart = rawExplanation.includes("匹配点") && rawExplanation.includes("优势") && rawExplanation.includes("缺口");
    const hasCompare = /相比其他岗位|高于|低于/.test(rawExplanation);
    const aiExplanation = hasThreePart && hasCompare
      ? rawExplanation.slice(0, 120)
      : buildDecisionExplanation(
          {
            ...item,
            aiMatchedSignals,
            aiRisks: ensuredRisk
          },
          jobPayload,
          lightweightProfile,
          maxScore
        ).slice(0, 120);
    const dimensions = normalizeDimensions(
      item.dimensions,
      buildDefaultDimensions({
        aiScore: item.aiScore,
        lightweightProfile,
        aiRisks: ensuredRisk
      })
    );
    return {
      ...item,
      aiMatchedSignals,
      aiRisks: ensuredRisk,
      aiExplanation,
      aiGrade: normalizeGrade(item.aiGrade, item.aiScore),
      dimensions,
      nextAction: normalizeNextAction(item.nextAction, item.aiRecommendation, item.aiScore)
    };
  });
}

function buildAiScoringViewData(parsed = {}, context = {}) {
  const aiScore = clampScore(parsed.aiScore, 0);
  const aiRecommendation = normalizeRecommendation(parsed.aiRecommendation, aiScore);
  const aiMatchedSignals = normalizeMatchedSignals(parsed.aiMatchedSignals, 4);
  const aiRisks = normalizeList(parsed.aiRisks, 6);
  const aiExplanation = String(parsed.aiExplanation || "").trim() || "AI 评分已完成，但未返回可解释文本。";
  const aiGrade = normalizeGrade(parsed.aiGrade, aiScore);
  const dimensions = normalizeDimensions(
    parsed.dimensions,
    buildDefaultDimensions({
      aiScore,
      jobWorkspaceViewModel: context.jobWorkspaceViewModel || {},
      lightweightProfile: context.lightweightProfile || {},
      aiRisks
    })
  );
  const nextAction = normalizeNextAction(parsed.nextAction, aiRecommendation, aiScore);
  return {
    aiScore,
    aiRecommendation,
    aiExplanation,
    aiMatchedSignals,
    aiRisks,
    aiGrade,
    dimensions,
    nextAction
  };
}

function buildLlmMeta(meta = {}) {
  const aiStatusRaw = String(meta.aiStatus || "").trim().toLowerCase();
  const aiStatus = aiStatusRaw === "ready" || aiStatusRaw === "fallback" || aiStatusRaw === "pending" ? aiStatusRaw : "pending";
  return {
    attempted: Boolean(meta.attempted),
    provider: meta.provider || "",
    model: meta.model || "",
    latencyMs: Number(meta.latencyMs || 0),
    errorCode: String(meta.errorCode || "").trim() || null,
    errorReason: String(meta.errorReason || "").trim() || null,
    rankingModeAttempted: Boolean(meta.rankingModeAttempted),
    rankingModeSucceeded: Boolean(meta.rankingModeSucceeded),
    rankingLatencyMs: Number(meta.rankingLatencyMs || 0),
    fallbackReason: String(meta.fallbackReason || "").trim() || null,
    cacheHit: Boolean(meta.cacheHit),
    cacheAgeMs: Number(meta.cacheAgeMs || 0),
    aiStatus,
    cacheState: String(meta.cacheState || "").trim() || (meta.cacheHit ? "hit" : "miss"),
    backgroundTaskState: String(meta.backgroundTaskState || "not_started").trim() || "not_started",
    fallbackCanBeOverwritten: Boolean(meta.fallbackCanBeOverwritten)
  };
}

function applyAiScoring(jobWorkspaceViewModel = {}, aiResult = {}, meta = {}) {
  const ruleScoring = getRuleSnapshot(jobWorkspaceViewModel?.scoringView || {});
  const aiData = buildAiScoringViewData(aiResult, {
    jobWorkspaceViewModel,
    lightweightProfile: meta.lightweightProfile || {}
  });
  return {
    ...jobWorkspaceViewModel,
    decisionView: {
      ...(jobWorkspaceViewModel.decisionView || {}),
      priorityScore: aiData.aiScore
    },
    scoringView: {
      ...ruleScoring,
      score: aiData.aiScore,
      explanation: aiData.aiExplanation,
      matchedSignals: aiData.aiMatchedSignals,
      risks: aiData.aiRisks,
      scoringType: "ai",
      sourceLabel: "AI评分",
      ruleScoring,
      aiScoring: aiData,
      llmMeta: buildLlmMeta({
        attempted: true,
        provider: meta.provider || "",
        model: meta.model || "",
        latencyMs: Number(meta.latencyMs || 0),
        errorReason: null,
        rankingModeAttempted: Boolean(meta.rankingModeAttempted),
        rankingModeSucceeded: Boolean(meta.rankingModeSucceeded),
        rankingLatencyMs: Number(meta.rankingLatencyMs || 0),
        fallbackReason: meta.fallbackReason || null,
        cacheHit: Boolean(meta.cacheHit),
        cacheAgeMs: Number(meta.cacheAgeMs || 0),
        aiStatus: meta.aiStatus || "ready",
        cacheState: meta.cacheState || (meta.cacheHit ? "hit_ready" : "miss"),
        backgroundTaskState: meta.backgroundTaskState || "not_started",
        fallbackCanBeOverwritten: Boolean(meta.fallbackCanBeOverwritten)
      })
    }
  };
}

function applyRuleFallback(jobWorkspaceViewModel = {}, errorReason = "", meta = {}) {
  const ruleScoring = getRuleSnapshot(jobWorkspaceViewModel?.scoringView || {});
  const aiStatus = String(meta.aiStatus || (String(errorReason || "").trim() ? "fallback" : "pending"))
    .trim()
    .toLowerCase();
  const pendingExplanation = "AI正在分析岗位与偏好匹配度";
  const fallbackExplanation = buildRuleFallbackExplanation({
    ruleScoring: jobWorkspaceViewModel?.scoringView || {},
    lightweightProfile: meta.lightweightProfile || {},
    jobWorkspaceViewModel
  });
  const aiData = buildAiScoringViewData(
    {
      aiScore: ruleScoring.score,
      aiRecommendation: normalizeRecommendation(null, ruleScoring.score),
      aiExplanation: aiStatus === "pending" ? pendingExplanation : fallbackExplanation,
      aiMatchedSignals: ruleScoring.matchedSignals,
      aiRisks: ruleScoring.risks
    },
    {
      jobWorkspaceViewModel,
      lightweightProfile: meta.lightweightProfile || {}
    }
  );
  return {
    ...jobWorkspaceViewModel,
    decisionView: {
      ...(jobWorkspaceViewModel.decisionView || {}),
      priorityScore: ruleScoring.score
    },
    scoringView: {
      ...ruleScoring,
      explanation: aiStatus === "pending" ? aiData.aiExplanation : ruleScoring.explanation || aiData.aiExplanation,
      scoringType: "rule",
      sourceLabel: "规则评分",
      ruleScoring,
      aiScoring: aiData,
      llmMeta: buildLlmMeta({
        attempted: Boolean(meta.attempted),
        provider: meta.provider || "",
        model: meta.model || "",
        latencyMs: Number(meta.latencyMs || 0),
        errorCode: String(meta.errorCode || "").trim() || null,
        errorReason: String(errorReason || "").trim() || null,
        rankingModeAttempted: Boolean(meta.rankingModeAttempted),
        rankingModeSucceeded: Boolean(meta.rankingModeSucceeded),
        rankingLatencyMs: Number(meta.rankingLatencyMs || 0),
        fallbackReason: meta.fallbackReason || null,
        cacheHit: Boolean(meta.cacheHit),
        cacheAgeMs: Number(meta.cacheAgeMs || 0),
        aiStatus,
        cacheState: meta.cacheState || (meta.cacheHit ? "hit_fallback" : "miss"),
        backgroundTaskState: meta.backgroundTaskState || "not_started",
        fallbackCanBeOverwritten: Boolean(meta.fallbackCanBeOverwritten)
      })
    }
  };
}

async function requestLlmJobScoring({ lightweightProfile = {}, jobWorkspaceViewModel = {} } = {}) {
  const startedAt = Date.now();
  const config = getGlmConfig();
  const timeoutMs = resolveTimeoutMs();
  const provider = "glm";
  const model = config.model || "";

  if (!config.apiKey) {
    return {
      ok: false,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      errorCode: "GLM_API_KEY_MISSING",
      errorReason: "GLM_API_KEY 未配置，已回退规则评分。"
    };
  }

  const ruleScoring = getRuleSnapshot(jobWorkspaceViewModel?.scoringView || {});
  const jobSummary = jobWorkspaceViewModel?.jobSummary || {};
  const evidenceHints = buildEvidenceHints({ jobSummary, lightweightProfile });
  const callPromise = callGLMJson({
    systemPrompt:
      [
        "你是 ApplyFlow 的岗位精排助手。",
        "基于岗位文本与用户偏好输出岗位优先级判断，禁止泛泛描述。",
        "必须只输出 JSON 对象，字段：aiScore、aiRecommendation、aiExplanation、aiMatchedSignals、aiRisks、aiGrade、dimensions、nextAction。",
        "打分必须按区间标尺执行：90-100 非常匹配（方向+技能+地点均强匹配）；75-89 值得投递但有1个明显缺口；60-74 可考虑但匹配不完整；40-59 弱匹配仅部分关键词命中；0-39 不建议优先投递。",
        "aiExplanation 必须说明：命中偏好、优先原因、缺口，以及为何不是更高分/更低分。",
        "aiMatchedSignals 必须是结构化对象数组，每条都要引用岗位 title/location 的真实证据。",
        "aiRisks 必须具体引用岗位文本缺失或不确定点，禁止泛化风险措辞。",
        "aiGrade 与 aiScore 对齐：A(85-100) B(70-84) C(55-69) D(0-54)。",
        "dimensions 必须完整返回5项且不能全部同值。nextAction 仅允许 apply_now/review_details/skip。"
      ].join(" "),
    userPrompt: JSON.stringify({
      task: "请给出独立 AI 评分，不要复述规则评分说明。",
      lightweightProfile: {
        targetRoles: Array.isArray(lightweightProfile.targetRoles) ? lightweightProfile.targetRoles : [],
        skills: Array.isArray(lightweightProfile.skills) ? lightweightProfile.skills : [],
        preferredLocations: Array.isArray(lightweightProfile.preferredLocations) ? lightweightProfile.preferredLocations : [],
        preferredLocationsExpanded: buildLocationVariants(lightweightProfile.preferredLocations),
        degree: String(lightweightProfile.degree || "").trim(),
        acceptsNonTech: Boolean(lightweightProfile.acceptsNonTech)
      },
      job: {
        id: String(jobWorkspaceViewModel.id || ""),
        title: String(jobSummary.title || "").slice(0, 160),
        company: String(jobSummary.company || "").slice(0, 80),
        location: String(jobSummary.location || "").slice(0, 60),
        sourceUrl: String(jobSummary.sourceUrl || ""),
        status: String(jobSummary.status || "")
      },
      evidenceHints,
      ruleScoring: {
        score: ruleScoring.score,
        explanation: String(ruleScoring.explanation || "").slice(0, 100)
      },
      outputSchema: {
        aiScore: "0-100 number",
        aiRecommendation: "apply|consider|skip",
        aiExplanation: "string，必须包含优先级理由+命中偏好+缺口+分数边界说明",
        aiMatchedSignals: [
          {
            profileSignal: "string，例如 机器学习",
            jobEvidence: "string，岗位 title/location 的真实原文片段",
            reason: "string，说明该证据如何对应偏好"
          }
        ],
        aiRisks: "string[]，必须具体，不允许泛化风险",
        aiGrade: "A|B|C|D",
        dimensions: {
          roleFit: "0-100 number",
          skillFit: "0-100 number",
          locationFit: "0-100 number",
          applicationFriction: "0-100 number",
          uncertainty: "0-100 number"
        },
        nextAction: "apply_now|review_details|skip"
      },
      outputRules: [
        "aiExplanation 建议 60-140 字，并包含“为什么不是更高分/更低分”",
        "aiMatchedSignals 至少 1 条，最多 4 条，且必须是对象数组",
        "aiMatchedSignals.jobEvidence 必须是 title/location 的短原文子串",
        "aiRisks 可为空；若非空，禁止出现：可能需要额外经验/竞争激烈/岗位要求较高",
        "地点判断必须执行同义归一：上海=Shanghai，北京=Beijing",
        "优先使用 evidenceHints.matchedRoleHints/matchedSkillHints/matchedLocationHints 作为可验证依据",
        "必须返回 aiGrade、dimensions、nextAction"
      ]
    }),
    schemaName: "applyflow_job_ai_scoring"
  });

  try {
    let timeoutHandle = null;
    const timeoutPromise = new Promise((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve({
          ok: false,
          errorCode: "TIME_BUDGET_EXCEEDED",
          rawText: "",
          model,
          latencyMs: Date.now() - startedAt
        });
      }, timeoutMs);
    });
    const glmResult = await Promise.race([callPromise, timeoutPromise]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (!glmResult?.ok) {
      const mappedError = mapLlmError(glmResult || {});
      return {
        ok: false,
        provider,
        model: glmResult?.model || model,
        latencyMs: Number(glmResult?.latencyMs || Date.now() - startedAt),
        errorCode: mappedError.errorCode,
        errorReason: mappedError.errorReason
      };
    }

    return {
      ok: true,
      provider,
      model: glmResult.model || model,
      latencyMs: Date.now() - startedAt,
      data: buildAiScoringViewData(glmResult.data, { jobWorkspaceViewModel, lightweightProfile })
    };
  } catch (error) {
    return {
      ok: false,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      errorCode: "UNKNOWN_ERROR",
      errorReason: String(error?.message || "GLM 评分失败，已回退规则评分。")
    };
  }
}

function normalizeRankingItems(value, validJobIds = []) {
  if (!Array.isArray(value)) return [];
  const validSet = new Set(validJobIds.map((id) => String(id || "").trim()).filter(Boolean));
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const jobId = String(item.jobId || "").trim();
      if (!jobId || !validSet.has(jobId)) return null;
      return {
        jobId,
        aiScore: clampScore(item.aiScore, 0),
        aiRecommendation: normalizeRecommendation(item.aiRecommendation, clampScore(item.aiScore, 0)),
        aiExplanation: String(item.aiExplanation || "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 120),
        aiMatchedSignals: normalizeMatchedSignals(item.aiMatchedSignals, 2),
        aiRisks: normalizeList(item.aiRisks, 1),
        aiGrade: normalizeGrade(item.aiGrade, clampScore(item.aiScore, 0)),
        dimensions: normalizeDimensions(
          item.dimensions,
          buildDefaultDimensions({
            aiScore: clampScore(item.aiScore, 0),
            aiRisks: normalizeList(item.aiRisks, 1)
          })
        ),
        nextAction: normalizeNextAction(
          item.nextAction,
          normalizeRecommendation(item.aiRecommendation, clampScore(item.aiScore, 0)),
          clampScore(item.aiScore, 0)
        )
      };
    })
    .filter(Boolean);
}

async function requestLlmRankingScoring({
  lightweightProfile = {},
  topJobs = []
} = {}) {
  const startedAt = Date.now();
  const config = getGlmConfig();
  const timeoutMs = resolveRankingTimeoutMs(20000);
  const provider = "glm";
  const model = config.model || "";

  if (!config.apiKey) {
    return {
      ok: false,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      errorCode: "GLM_API_KEY_MISSING",
      errorReason: "GLM_API_KEY 未配置，已回退单条评分。"
    };
  }

  const jobsPayload = (Array.isArray(topJobs) ? topJobs : []).map((jobVm) => {
    const jobSummary = jobVm.jobSummary || {};
    return {
      id: String(jobVm.id || "").trim(),
      title: String(jobSummary.title || "").trim().slice(0, 180),
      company: String(jobSummary.company || "").trim().slice(0, 80),
      location: String(jobSummary.location || "").trim().slice(0, 80),
      description: buildJobDescription(jobVm)
    };
  });
  const jobPayloadById = new Map(jobsPayload.map((job) => [String(job.id || ""), job]));

  const callPromise = callGLMJson({
    systemPrompt:
      [
        "你是 ApplyFlow 岗位排序助手。",
        "仅输出中文 JSON 数组，不要英文，不要代码块。",
        "基于 userProfile 比较同一批 jobs，给出相对优先级。",
        "字段固定：jobId, aiScore, aiRecommendation, aiExplanation, aiMatchedSignals, aiRisks, aiGrade, dimensions, nextAction。",
        "aiExplanation 必须包含三部分：匹配点、优势、缺口，并体现比较关系（相比其他岗位/高于/低于）。",
        "aiMatchedSignals 最多2条，aiRisks 至少1条且最多1条。",
        "分数必须拉开，3个岗位至少落在3个不同分档。",
        "aiGrade 必须与 aiScore 对齐：A(85-100) B(70-84) C(55-69) D(0-54)。",
        "dimensions 必须含 roleFit/skillFit/locationFit/applicationFriction/uncertainty 且不能全部相同。",
        "nextAction 仅允许 apply_now/review_details/skip。"
      ].join(" "),
    userPrompt: JSON.stringify({
      task: "对 jobs 做排序评分，只输出中文 JSON 数组。",
      userProfile: {
        targetRoles: Array.isArray(lightweightProfile.targetRoles) ? lightweightProfile.targetRoles : [],
        skills: Array.isArray(lightweightProfile.skills) ? lightweightProfile.skills : [],
        preferredLocations: Array.isArray(lightweightProfile.preferredLocations) ? lightweightProfile.preferredLocations : [],
        degree: String(lightweightProfile.degree || "").trim(),
        acceptsNonTech: Boolean(lightweightProfile.acceptsNonTech)
      },
      jobs: jobsPayload,
      rules: [
        "覆盖所有 jobId 且每个 jobId 仅一次",
        "aiExplanation 30-90 字，必须包含“匹配点：…；优势：…；缺口：…”和比较依据，且只用中文",
        "aiMatchedSignals 1-2 条，jobEvidence 必须来自 title/company/location/description 原文",
        "aiRisks 必须1条，且必须指向岗位文本中的具体缺口，禁止“竞争激烈/需要经验”",
        "当 jobs 数量为 3 时，3 个岗位必须落在 3 个不同分档",
        "每个条目必须返回 aiGrade、dimensions、nextAction"
      ]
    }),
    schemaName: "applyflow_job_ai_ranking_scoring",
    expectedRoot: "array",
    responseFormatType: null
  });

  try {
    let timeoutHandle = null;
    const timeoutPromise = new Promise((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve({
          ok: false,
          errorCode: "TIME_BUDGET_EXCEEDED",
          rawText: "",
          model,
          latencyMs: Date.now() - startedAt
        });
      }, timeoutMs);
    });
    const glmResult = await Promise.race([callPromise, timeoutPromise]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (!glmResult?.ok) {
      const mappedError = mapLlmError(glmResult || {});
      return {
        ok: false,
        provider,
        model: glmResult?.model || model,
        latencyMs: Number(glmResult?.latencyMs || Date.now() - startedAt),
        errorCode: mappedError.errorCode,
        errorReason: mappedError.errorReason
      };
    }

    const normalizedItems = normalizeRankingItems(
      glmResult.data,
      jobsPayload.map((job) => job.id)
    );
    if (normalizedItems.length === 0) {
      return {
        ok: false,
        provider,
        model: glmResult.model || model,
        latencyMs: Date.now() - startedAt,
        errorCode: "RANKING_EMPTY",
        errorReason: "LLM ranking 返回为空，已回退单条评分。"
      };
    }

    return {
      ok: true,
      provider,
      model: glmResult.model || model,
      latencyMs: Date.now() - startedAt,
      items: enforceRankingItemQuality(normalizedItems, jobPayloadById, lightweightProfile)
    };
  } catch (error) {
    return {
      ok: false,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      errorCode: "UNKNOWN_ERROR",
      errorReason: String(error?.message || "GLM ranking 失败，已回退单条评分。")
    };
  }
}

function mapLlmError(glmResult = {}) {
  const code = String(glmResult?.errorCode || "UNKNOWN_ERROR").trim();
  if (code === "TIME_BUDGET_EXCEEDED") {
    return {
      errorCode: code,
      errorReason: "LLM 总预算超时（LLM_JOB_SCORING_TIMEOUT_MS），已回退规则评分。"
    };
  }
  if (code === "TIMEOUT") {
    return {
      errorCode: code,
      errorReason: "LLM 请求超时（GLM_TIMEOUT_MS），已回退规则评分。"
    };
  }
  if (code === "JSON_PARSE_ERROR" || code === "JSON_NOT_OBJECT" || code === "JSON_NOT_ARRAY" || code === "EMPTY_CONTENT") {
    return {
      errorCode: code,
      errorReason: `LLM JSON 解析失败（${code}），已回退规则评分。`
    };
  }
  if (code === "HTTP_ERROR") {
    const status = Number(glmResult?.status || 0);
    return {
      errorCode: code,
      errorReason: status > 0 ? `LLM Provider 错误（HTTP ${status}），已回退规则评分。` : "LLM Provider 错误，已回退规则评分。"
    };
  }
  if (code === "NETWORK_ERROR" || code === "FETCH_UNAVAILABLE") {
    return {
      errorCode: code,
      errorReason: `LLM 网络/运行时错误（${code}），已回退规则评分。`
    };
  }
  if (code === "GLM_API_KEY_MISSING") {
    return {
      errorCode: code,
      errorReason: "GLM_API_KEY 未配置，已回退规则评分。"
    };
  }
  return {
    errorCode: code,
    errorReason: `GLM 调用失败（${code}），已回退规则评分。`
  };
}

function buildInFlightKey({ profileHash = "", rankingMode = false, jobIds = [] } = {}) {
  return `${rankingMode ? "ranking" : "single"}::${String(profileHash || "")}::${jobIds.join(",")}`;
}

function scheduleBackgroundTopJobsScoring({
  lightweightProfile = {},
  topJobs = [],
  rankingMode = false,
  profileHash = ""
} = {}) {
  const jobIds = (Array.isArray(topJobs) ? topJobs : []).map((jobVm) => String(jobVm?.id || "").trim()).filter(Boolean);
  if (jobIds.length === 0) return;
  const inFlightKey = buildInFlightKey({ profileHash, rankingMode, jobIds });
  if (llmScoringInFlight.has(inFlightKey)) return;
  topJobs.forEach((jobVm) => setBackgroundTaskState(jobVm?.id, profileHash, "queued"));

  const taskPromise = (async () => {
    const runSingleScoringSequential = async (jobsForSingle = []) => {
      for (const jobVm of Array.isArray(jobsForSingle) ? jobsForSingle : []) {
        const singleResult = await requestLlmJobScoring({
          lightweightProfile,
          jobWorkspaceViewModel: jobVm
        });
        if (!singleResult.ok) {
          logger.warn("jobs.llm_scoring.background.single_failed", {
            jobId: jobVm?.id || "",
            errorCode: singleResult.errorCode || "",
            errorReason: singleResult.errorReason || ""
          });
          setBackgroundTaskState(jobVm?.id, profileHash, "completed_fallback");
          continue;
        }
        writeCache(jobVm.id, profileHash, singleResult.data, { fallbackCanBeOverwritten: false });
        setBackgroundTaskState(jobVm?.id, profileHash, "completed_ready");
      }
    };

    try {
      topJobs.forEach((jobVm) => setBackgroundTaskState(jobVm?.id, profileHash, "running"));
      // 先写入规则分兜底缓存，保证后续请求可快速返回可用分数；LLM 成功后会覆盖。
      topJobs.forEach((jobVm) => {
        const ruleScoring = getRuleSnapshot(jobVm?.scoringView || {});
        writeCache(jobVm.id, profileHash, {
          aiScore: ruleScoring.score,
          aiRecommendation: normalizeRecommendation(null, ruleScoring.score),
          aiExplanation: buildRuleFallbackExplanation({
            ruleScoring: jobVm?.scoringView || {},
            lightweightProfile,
            jobWorkspaceViewModel: jobVm
          }),
          aiMatchedSignals: ruleScoring.matchedSignals,
          aiRisks: ruleScoring.risks,
          dimensions: buildDefaultDimensions({
            aiScore: ruleScoring.score,
            jobWorkspaceViewModel: jobVm,
            lightweightProfile,
            aiRisks: ruleScoring.risks
          }),
          aiStatus: "fallback"
        }, { fallbackCanBeOverwritten: true });
      });

      if (rankingMode) {
        const singleWarmupTask = runSingleScoringSequential(topJobs);

        const rankingResult = await requestLlmRankingScoring({
          lightweightProfile,
          topJobs
        });
        if (rankingResult.ok) {
          const itemMap = new Map((rankingResult.items || []).map((item) => [String(item.jobId || ""), item]));
          topJobs.forEach((jobVm) => {
            const item = itemMap.get(String(jobVm?.id || ""));
            if (item) {
              writeCache(jobVm.id, profileHash, item, { fallbackCanBeOverwritten: false });
              setBackgroundTaskState(jobVm?.id, profileHash, "completed_ready");
            } else {
              setBackgroundTaskState(jobVm?.id, profileHash, "completed_fallback");
            }
          });
          await singleWarmupTask;
          return;
        }

        logger.warn("jobs.llm_scoring.background.ranking_fallback_to_single", {
          errorCode: rankingResult.errorCode || "",
          errorReason: rankingResult.errorReason || "",
          provider: rankingResult.provider || "",
          model: rankingResult.model || "",
          latencyMs: rankingResult.latencyMs || 0
        });
        await singleWarmupTask;
      }

      await runSingleScoringSequential(topJobs);
    } catch (error) {
      logger.warn("jobs.llm_scoring.background.unexpected_error", {
        errorMessage: String(error?.message || error || "unknown_error")
      });
      topJobs.forEach((jobVm) => setBackgroundTaskState(jobVm?.id, profileHash, "completed_fallback"));
    } finally {
      llmScoringInFlight.delete(inFlightKey);
    }
  })();

  llmScoringInFlight.set(inFlightKey, taskPromise);
}

async function applyLlmScoringToTopJobs({
  lightweightProfile = {},
  ruleScoredJobWorkspaceViewModels = []
} = {}) {
  const jobs = Array.isArray(ruleScoredJobWorkspaceViewModels) ? ruleScoredJobWorkspaceViewModels : [];
  if (jobs.length === 0) return [];

  const enabled = isLlmJobScoringEnabled();
  if (!enabled) {
    return jobs.map((jobVm) =>
      applyRuleFallback(jobVm, "", {
        attempted: false,
        aiStatus: "fallback",
        lightweightProfile
      })
    );
  }
  const profileHash = buildProfileHash(lightweightProfile);

  const rankingMode = isLlmRankingModeEnabled();
  const topN = rankingMode ? Math.min(3, jobs.length) : Math.min(resolveTopN(), jobs.length);
  const topJobs = jobs.slice(0, topN);
  const restJobs = jobs.slice(topN).map((jobVm) =>
    applyRuleFallback(jobVm, "", {
      attempted: false,
      aiStatus: "fallback",
      cacheHit: false,
      cacheAgeMs: 0,
      cacheState: "not_applicable",
      backgroundTaskState: "not_started",
      fallbackCanBeOverwritten: false,
      lightweightProfile
    })
  );

  const applyRerank = (scoredEntries = []) =>
    scoredEntries
    .sort((left, right) => {
      const leftScore = clampScore(left?.job?.scoringView?.score, 0);
      const rightScore = clampScore(right?.job?.scoringView?.score, 0);
      if (rightScore !== leftScore) return rightScore - leftScore;
      return left.originalIndex - right.originalIndex;
    })
    .map((entry) => entry.job);

  const immediateEntries = [];
  const missingTopJobs = [];
  const retryFallbackJobs = [];
  topJobs.forEach((jobVm, index) => {
    const cached = readCache(jobVm.id, profileHash);
    const backgroundTaskState = getBackgroundTaskState(jobVm.id, profileHash);
    if (cached.hit) {
      const cachedAiStatus = String(cached.data?.aiStatus || "").trim().toLowerCase();
      const canOverwriteFallback = cachedAiStatus === "fallback" && cached.data?.fallbackCanBeOverwritten !== false;
      if (canOverwriteFallback && backgroundTaskState !== "running" && backgroundTaskState !== "queued") {
        retryFallbackJobs.push(jobVm);
      }
      immediateEntries.push({
        originalIndex: index,
        job: applyAiScoring(jobVm, cached.data, {
          attempted: false,
          rankingModeAttempted: rankingMode,
          rankingModeSucceeded: cachedAiStatus === "ready" && rankingMode,
          rankingLatencyMs: 0,
          fallbackReason: null,
          cacheHit: true,
          cacheAgeMs: cached.cacheAgeMs,
          aiStatus: cached.data?.aiStatus || "ready",
          cacheState: cached.cacheState,
          backgroundTaskState,
          fallbackCanBeOverwritten: Boolean(cached.data?.fallbackCanBeOverwritten),
          lightweightProfile
        })
      });
      return;
    }
    missingTopJobs.push(jobVm);
    immediateEntries.push({
      originalIndex: index,
      job: applyRuleFallback(jobVm, "", {
        attempted: false,
        rankingModeAttempted: rankingMode,
        rankingModeSucceeded: false,
        rankingLatencyMs: 0,
        fallbackReason: null,
        cacheHit: false,
        cacheAgeMs: 0,
        aiStatus: "pending",
        cacheState: cached.cacheState || "miss",
        backgroundTaskState,
        fallbackCanBeOverwritten: true,
        lightweightProfile
      })
    });
  });

  if (missingTopJobs.length > 0) {
    scheduleBackgroundTopJobsScoring({
      lightweightProfile,
      topJobs: missingTopJobs,
      rankingMode,
      profileHash
    });
  }
  if (retryFallbackJobs.length > 0) {
    scheduleBackgroundTopJobsScoring({
      lightweightProfile,
      topJobs: retryFallbackJobs,
      rankingMode,
      profileHash
    });
  }

  return [...applyRerank(immediateEntries), ...restJobs];
}

module.exports = {
  applyLlmScoringToTopJobs,
  isLlmJobScoringEnabled,
  isLlmRankingModeEnabled
};
