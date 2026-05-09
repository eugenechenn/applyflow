"use strict";

const { createId, nowIso } = require("../utils/id");
const {
  createBatchDecisionResultContract,
  validateBatchDecisionResultContract
} = require("../contracts/job-batch-decision-contracts");
const { buildJobDecisionFromFitAssessment } = require("../decision/job-decision-mapper");

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeList(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

const KEYWORD_ALIASES = {
  ai: ["人工智能", "算法", "机器学习", "深度学习", "大模型", "aigc", "llm"],
  pm: ["产品", "产品经理", "product manager"]
};

function escapeRegex(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordTerms(keyword = "") {
  const base = normalizeText(keyword);
  if (!base) return [];
  const alias = KEYWORD_ALIASES[base] || [];
  return [base, ...alias.map((item) => normalizeText(item))].filter(Boolean);
}

function containsTermByBoundary(text = "", term = "") {
  const source = normalizeText(text);
  const normalizedTerm = normalizeText(term);
  if (!source || !normalizedTerm) return false;

  const isAsciiToken = /^[a-z0-9_\-]{2,}$/i.test(normalizedTerm);
  if (!isAsciiToken) {
    return source.includes(normalizedTerm);
  }

  const regex = new RegExp(`(?:^|\\s)${escapeRegex(normalizedTerm)}(?:$|\\s)`, "i");
  return regex.test(source);
}

function extractListingText(listing = {}) {
  const requirements = Array.isArray(listing.requirements) ? listing.requirements.join(" ") : "";
  // NOTE: Location is intentionally excluded to avoid keyword pollution
  // like "ai" matching "Shang-hai".
  return normalizeText(
    [listing.company, listing.jdSummary, requirements].join(" ")
  );
}

function buildLightweightProfile(profile = {}) {
  const lightweight = profile?.lightweightProfile && typeof profile.lightweightProfile === "object"
    ? profile.lightweightProfile
    : {};

  const targetRoles = normalizeList(
    lightweight.targetRoles || profile.targetRoles || []
  );
  const skills = normalizeList(
    lightweight.skills || profile.skills || profile.strengths || []
  );
  const preferredLocations = normalizeList(
    lightweight.preferredLocations || profile.preferredLocations || profile.targetLocations || []
  );

  return {
    targetRoles,
    skills,
    preferredLocations,
    degree: normalizeText(lightweight.degree || profile.degree || ""),
    acceptsNonTech:
      typeof lightweight.acceptsNonTech === "boolean"
        ? lightweight.acceptsNonTech
        : typeof profile.acceptsNonTech === "boolean"
          ? profile.acceptsNonTech
          : true
  };
}

function computeKeywordEvidence(listing = {}, intent = {}) {
  const listingText = extractListingText(listing);
  const titleText = normalizeText(listing.title || "");
  const keywords = Array.isArray(intent.keywords) ? intent.keywords : [];
  const matched = [];
  const matchedInTitle = [];
  keywords.forEach((keyword) => {
    const terms = keywordTerms(keyword);
    if (!terms.length) return;
    if (terms.some((term) => containsTermByBoundary(listingText, term))) {
      matched.push(keyword);
    }
    if (terms.some((term) => containsTermByBoundary(titleText, term))) {
      matchedInTitle.push(keyword);
    }
  });
  return {
    matched,
    matchedInTitle
  };
}

function computeUserProfileSignals(listing = {}, profile = {}) {
  const lightweight = buildLightweightProfile(profile);
  const titleText = normalizeText(listing.title || "");
  const bodyText = normalizeText(
    [listing.title, listing.jdSummary, Array.isArray(listing.requirements) ? listing.requirements.join(" ") : ""].join(" ")
  );
  const locationText = normalizeText(listing.location || "");

  const matchedRoles = lightweight.targetRoles.filter((role) => containsTermByBoundary(titleText, role));
  const matchedSkills = lightweight.skills.filter((skill) => containsTermByBoundary(bodyText, skill));
  const locationMatched = Boolean(
    lightweight.preferredLocations.length &&
      lightweight.preferredLocations.some((loc) => containsTermByBoundary(locationText, loc))
  );

  const nonTechSignals = [
    "销售",
    "营销",
    "商务",
    "运营",
    "客服",
    "行政",
    "人力",
    "财务",
    "法务",
    "媒介",
    "渠道"
  ];
  const techSignals = [
    "ai",
    "算法",
    "开发",
    "engineer",
    "研发",
    "机器学习",
    "llm",
    "python",
    "数据"
  ];
  const hasNonTechSignal = nonTechSignals.some((term) => containsTermByBoundary(titleText, term));
  const hasTechSignal = techSignals.some((term) => containsTermByBoundary(bodyText, term));
  const nonTechPenalty = !lightweight.acceptsNonTech && hasNonTechSignal && !hasTechSignal ? 8 : 0;

  const roleBoost = Math.min(12, matchedRoles.length * 6);
  const skillBoost = Math.min(10, matchedSkills.length * 3);
  const locationBoost = locationMatched ? 2 : 0;
  const totalSignalScore = Math.max(0, roleBoost + skillBoost + locationBoost - nonTechPenalty);

  return {
    lightweightProfile: lightweight,
    matchedRoles,
    matchedSkills,
    locationMatched,
    nonTechPenalty,
    totalSignalScore
  };
}

function computeGapsAndRisks(listing = {}, intent = {}) {
  const mustHaveSkills = Array.isArray(intent?.constraints?.mustHaveSkills)
    ? intent.constraints.mustHaveSkills
    : [];
  const blockedCompanies = Array.isArray(intent?.constraints?.blockedCompanies)
    ? intent.constraints.blockedCompanies.map((item) => normalizeText(item))
    : [];
  const listingText = extractListingText(listing);

  const gaps = mustHaveSkills
    .filter((skill) => !listingText.includes(normalizeText(skill)))
    .map((skill) => `Missing must-have signal: ${skill}`);
  const risks = [];
  const companySignature = normalizeText(listing.company || "");
  if (companySignature && blockedCompanies.includes(companySignature)) {
    risks.push("Company is in blockedCompanies constraints.");
  }
  if (!listing.jdSummary) {
    risks.push("JD summary is missing; decision confidence is reduced.");
  }
  return { gaps, risks };
}

function buildSyntheticFitAssessment({
  listing = {},
  intent = {},
  profile = {},
  matchedKeywords = [],
  matchedTitleKeywords = [],
  userProfileSignals = {},
  gaps = [],
  risks = []
} = {}) {
  const keywordCoverage = Math.min(1, matchedKeywords.length / Math.max(1, (intent.keywords || []).length));
  const titleCoverage = Math.min(1, matchedTitleKeywords.length / Math.max(1, (intent.keywords || []).length));
  const requirementsCount = Array.isArray(listing.requirements) ? listing.requirements.length : 0;
  const requirementSignal = Math.min(requirementsCount / 8, 1);
  const profileSignal = Number(userProfileSignals.totalSignalScore || 0);
  const baseScore = Math.round(
    keywordCoverage * 35 +
      titleCoverage * 40 +
      requirementSignal * 20 +
      (listing.jdSummary ? 10 : 0) +
      profileSignal
  );
  const penalty = gaps.length * 6 + risks.length * 12;
  const fitScore = Math.max(0, Math.min(100, baseScore - penalty));

  const hasBlockingRisk = risks.some((item) => /blockedcompanies|blocked/i.test(item));
  const recommendation = hasBlockingRisk ? "skip" : fitScore >= 70 ? "apply" : fitScore >= 45 ? "cautious" : "skip";
  const strategyDecision = recommendation === "apply" ? "proceed" : recommendation === "cautious" ? "cautious_proceed" : "avoid";

  const whyApply = [];
  if (matchedKeywords.length) {
    whyApply.push(`Matched intent keywords: ${matchedKeywords.slice(0, 4).join(", ")}`);
  }
  if (matchedTitleKeywords.length) {
    whyApply.push(`Title keyword signal: ${matchedTitleKeywords.slice(0, 4).join(", ")}`);
  }
  if (Array.isArray(userProfileSignals.matchedRoles) && userProfileSignals.matchedRoles.length) {
    whyApply.push(`Profile target-role match: ${userProfileSignals.matchedRoles.slice(0, 4).join(", ")}`);
  }
  if (Array.isArray(userProfileSignals.matchedSkills) && userProfileSignals.matchedSkills.length) {
    whyApply.push(`Profile skill match: ${userProfileSignals.matchedSkills.slice(0, 4).join(", ")}`);
  }
  if (userProfileSignals.locationMatched) {
    whyApply.push("Profile preferred location matched.");
  }
  if (listing.jdSummary) {
    whyApply.push("JD summary available for explainable evaluation.");
  }
  if (requirementsCount > 0) {
    whyApply.push(`Structured requirements captured: ${requirementsCount} items.`);
  }
  if (!whyApply.length) {
    whyApply.push("Limited listing evidence, decision remains cautious.");
  }

  return {
    id: `fit_${listing.listingId}`,
    jobId: listing.listingId,
    profileId: profile.id || intent.userId || "",
    fitScore,
    recommendation,
    strategyDecision,
    strategyReasoning: `Discovery batch decision with keywordCoverage=${keywordCoverage.toFixed(2)}, titleCoverage=${titleCoverage.toFixed(2)}, requirementSignal=${requirementSignal.toFixed(2)}, userProfileSignal=${profileSignal.toFixed(2)}.`,
    decisionSummary: `Recommendation=${recommendation}, nextAction derived from strategy=${strategyDecision}.`,
    whyApply,
    keyGaps: gaps,
    riskFlags: risks,
    confidence: Math.max(0.3, Math.min(0.95, 0.9 - gaps.length * 0.08 - risks.length * 0.12)),
    llmMeta: {
      model: "rule_based_discovery_batch",
      fallbackUsed: false
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function buildClusterIndex(dedupCandidatePool = {}) {
  const index = new Map();
  const clusters = Array.isArray(dedupCandidatePool?.dedupClusters) ? dedupCandidatePool.dedupClusters : [];
  clusters.forEach((cluster) => {
    const primaryId = cluster.primaryListingId;
    if (!primaryId) return;
    index.set(primaryId, cluster);
  });
  return index;
}

function runBatchDecision({
  intent = null,
  dedupCandidatePool = {},
  profile = {}
} = {}) {
  if (!intent || typeof intent !== "object") {
    const error = new Error("Discovery intent is required for batch decision.");
    error.code = "DISCOVERY_INTENT_REQUIRED";
    throw error;
  }

  const primaryListings = Array.isArray(dedupCandidatePool?.primaryListings)
    ? dedupCandidatePool.primaryListings
    : [];
  if (!primaryListings.length) {
    const error = new Error("No primary listings found for batch decision.");
    error.code = "PRIMARY_LISTINGS_REQUIRED";
    throw error;
  }

  const clusterIndex = buildClusterIndex(dedupCandidatePool);
  const batchId = createId("batch_decision");

  const items = primaryListings.map((listing) => {
    const cluster = clusterIndex.get(listing.listingId);
    const keywordSignals = computeKeywordEvidence(listing, intent);
    const matchedKeywords = keywordSignals.matched;
    const { gaps, risks } = computeGapsAndRisks(listing, intent);
    const userProfileSignals = computeUserProfileSignals(listing, profile);
    const syntheticFit = buildSyntheticFitAssessment({
      listing,
      intent,
      profile,
      matchedKeywords,
      matchedTitleKeywords: keywordSignals.matchedInTitle,
      userProfileSignals,
      gaps,
      risks
    });
    const syntheticJob = {
      id: listing.listingId,
      title: listing.title,
      company: listing.company,
      location: listing.location,
      sourceLabel: listing.source,
      jobUrl: listing.normalizedUrl || listing.sourceUrl,
      status: "inbox"
    };

    const jobDecision = buildJobDecisionFromFitAssessment({
      job: syntheticJob,
      fitAssessment: syntheticFit,
      userId: intent.userId || profile.id || ""
    });

    return {
      listingId: listing.listingId,
      clusterId: cluster?.clusterId || `cluster_${listing.listingId}`,
      jobDecision,
      decisionTrace: {
        source: "discovery_batch_decision_pipeline",
        runId: batchId,
        version: "v1"
      },
      sourceListingsSummary: (Array.isArray(cluster?.sourceListings) ? cluster.sourceListings : [
        {
          listingId: listing.listingId,
          source: listing.source,
          normalizedUrl: listing.normalizedUrl,
          title: listing.title,
          company: listing.company,
          location: listing.location,
          isPrimary: true
        }
      ]).map((item) => ({
        listingId: item.listingId,
        source: item.source,
        normalizedUrl: item.normalizedUrl,
        title: item.title,
        company: item.company,
        location: item.location,
        isPrimary: Boolean(item.isPrimary || item.listingId === listing.listingId)
      })),
      notes: [
        `matched_keywords=${matchedKeywords.length}`,
        `matched_title_keywords=${keywordSignals.matchedInTitle.length}`,
        `profile_role_matches=${userProfileSignals.matchedRoles.length}`,
        `profile_skill_matches=${userProfileSignals.matchedSkills.length}`,
        `profile_location_match=${userProfileSignals.locationMatched ? 1 : 0}`,
        `gap_count=${gaps.length}`,
        `risk_count=${risks.length}`
      ]
    };
  });

  const contract = createBatchDecisionResultContract({
    batchId,
    intentId: intent.intentId,
    items,
    generatedAt: nowIso()
  });
  const validation = validateBatchDecisionResultContract(contract);
  if (!validation.ok) {
    const error = new Error(`Invalid BatchDecisionResult contract: ${validation.errors.join("; ")}`);
    error.code = "INVALID_BATCH_DECISION_RESULT_CONTRACT";
    error.details = { errors: validation.errors, contract };
    throw error;
  }

  return contract;
}

module.exports = {
  runBatchDecision
};
