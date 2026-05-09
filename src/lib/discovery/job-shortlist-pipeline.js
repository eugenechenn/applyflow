"use strict";

const { createId, nowIso } = require("../utils/id");
const {
  createShortlistResultContract,
  validateShortlistResultContract
} = require("../contracts/job-shortlist-contracts");

const RECOMMENDATION_PRIORITY = {
  apply: 3,
  cautious: 2,
  skip: 1
};

function toText(value = "") {
  return String(value || "").trim();
}

function toList(value = []) {
  return Array.isArray(value) ? value : [];
}

function asNumber(value = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function classifyRankingItem(item = {}, strategy = {}) {
  const recommendation = toText(item.recommendation || "cautious");
  const risks = toList(item.risks);
  const gaps = toList(item.gaps);
  const nextAction = toText(item.nextAction || "hold");
  const rank = asNumber(item.rank);
  const priorityScore = asNumber(item.priorityScore);
  const riskCeiling = Math.max(0, asNumber(strategy.riskCeiling ?? 2));
  const maxShortlistRank = Math.max(1, asNumber(strategy.maxShortlistSize ?? 12));

  const isApply = recommendation === "apply";
  const isCautious = recommendation === "cautious";
  const isSkip = recommendation === "skip" || nextAction === "skip";
  const isHighRisk = risks.length > riskCeiling;
  const hasBlockingGap = gaps.length >= 3;
  const inShortlistBand = rank > 0 && rank <= maxShortlistRank;

  if (isSkip) {
    return {
      bucket: "skipped",
      reason: `Skipped because recommendation=${recommendation} and nextAction=${nextAction}.`
    };
  }

  if (isApply && !isHighRisk && !hasBlockingGap && inShortlistBand) {
    return {
      bucket: "shortlisted",
      reason: `Selected for shortlist: apply recommendation with rank=${rank}, priorityScore=${priorityScore}, risks=${risks.length}.`
    };
  }

  if (isApply && (isHighRisk || hasBlockingGap)) {
    return {
      bucket: "hold",
      reason: `Moved to hold: apply recommendation but risk/gap needs review (risks=${risks.length}, gaps=${gaps.length}).`
    };
  }

  if (isCautious || nextAction === "collect_info" || nextAction === "hold") {
    return {
      bucket: "hold",
      reason: `Moved to hold: recommendation=${recommendation}, nextAction=${nextAction}, requires additional review.`
    };
  }

  if (priorityScore >= 72 && inShortlistBand && !isHighRisk) {
    return {
      bucket: "shortlisted",
      reason: `Selected by score guardrail: priorityScore=${priorityScore}, risks=${risks.length}, rank=${rank}.`
    };
  }

  return {
    bucket: "hold",
    reason: `Moved to hold by conservative fallback: recommendation=${recommendation}, risks=${risks.length}, gaps=${gaps.length}.`
  };
}

function normalizeShortlistItem(item = {}, reason = "") {
  return {
    listingId: item.listingId,
    clusterId: item.clusterId,
    rank: asNumber(item.rank),
    recommendation: toText(item.recommendation || "cautious"),
    nextAction: toText(item.nextAction || "hold"),
    selectionReason: reason,
    sourceListingsSummary: toList(item.sourceListingsSummary)
  };
}

function buildSelectionStrategy(overrides = {}) {
  const maxShortlistSize = Math.max(1, Math.min(25, asNumber(overrides.maxShortlistSize || 12)));
  const riskCeiling = Math.max(0, Math.min(5, asNumber(overrides.riskCeiling || 2)));

  return {
    strategyId: "recommendation_risk_gate_v1",
    summary:
      "Apply recommendations with acceptable risk are shortlisted; cautious items are held; skip items are excluded.",
    maxShortlistSize,
    includeCautiousInHold: true,
    riskCeiling,
    notes: [
      "Ranking input comes from RankingResult.rankedItems only.",
      "Skip recommendation never enters shortlist.",
      "Hold bucket preserves items requiring manual review."
    ]
  };
}

function sortByRankThenRecommendation(items = []) {
  const list = [...toList(items)];
  list.sort((left, right) => {
    const rankDiff = asNumber(left.rank) - asNumber(right.rank);
    if (rankDiff !== 0) return rankDiff;
    const recDiff =
      (RECOMMENDATION_PRIORITY[toText(right.recommendation)] || 0) -
      (RECOMMENDATION_PRIORITY[toText(left.recommendation)] || 0);
    if (recDiff !== 0) return recDiff;
    return String(left.listingId || "").localeCompare(String(right.listingId || ""));
  });
  return list;
}

function runShortlistSelection(rankingResult = {}, options = {}) {
  if (!rankingResult || typeof rankingResult !== "object") {
    const error = new Error("RankingResult is required for shortlist selection.");
    error.code = "RANKING_RESULT_REQUIRED";
    throw error;
  }

  const rankedItems = toList(rankingResult.rankedItems);
  if (!rankedItems.length) {
    const error = new Error("RankingResult.rankedItems is empty.");
    error.code = "RANKING_ITEMS_REQUIRED";
    throw error;
  }

  const strategy = buildSelectionStrategy(options.selectionStrategy || {});
  const shortlistedItems = [];
  const holdItems = [];
  const skippedItems = [];

  rankedItems.forEach((item) => {
    const classification = classifyRankingItem(item, strategy);
    const normalized = normalizeShortlistItem(item, classification.reason);
    if (classification.bucket === "shortlisted") {
      shortlistedItems.push(normalized);
      return;
    }
    if (classification.bucket === "skipped") {
      skippedItems.push(normalized);
      return;
    }
    holdItems.push(normalized);
  });

  const sortedShortlisted = sortByRankThenRecommendation(shortlistedItems).slice(0, strategy.maxShortlistSize);
  const shortlistedIds = sortedShortlisted.map((item) => item.listingId);

  const shortlistContract = createShortlistResultContract({
    shortlistId: createId("shortlist"),
    intentId: rankingResult.intentId || "",
    selectedListingIds: shortlistedIds,
    shortlistedItems: sortedShortlisted,
    holdItems: sortByRankThenRecommendation(holdItems),
    skippedItems: sortByRankThenRecommendation(skippedItems),
    selectionStrategy: strategy,
    generatedAt: nowIso()
  });

  const validation = validateShortlistResultContract(shortlistContract);
  if (!validation.ok) {
    const error = new Error(`Invalid ShortlistResult contract: ${validation.errors.join("; ")}`);
    error.code = "INVALID_SHORTLIST_RESULT_CONTRACT";
    error.details = { errors: validation.errors, contract: shortlistContract };
    throw error;
  }

  return shortlistContract;
}

module.exports = {
  runShortlistSelection
};
