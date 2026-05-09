"use strict";

const { createId, nowIso } = require("../utils/id");
const {
  createRankingResultContract,
  validateRankingResultContract
} = require("../contracts/job-ranking-contracts");

const RECOMMENDATION_BASE_SCORE = {
  apply: 72,
  cautious: 48,
  skip: 16
};

function toText(value = "") {
  return String(value || "").trim();
}

function toList(value = []) {
  return Array.isArray(value) ? value : [];
}

function clamp01(value = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function parseRationaleSignals(rationale = "") {
  const source = String(rationale || "");
  const read = (name) => {
    const match = source.match(new RegExp(`${name}=([0-9]+(?:\\.[0-9]+)?)`, "i"));
    return match ? Number(match[1]) : 0;
  };
  return {
    keywordCoverage: clamp01(read("keywordCoverage")),
    titleCoverage: clamp01(read("titleCoverage")),
    requirementSignal: clamp01(read("requirementSignal")),
    userProfileSignal: Math.max(0, Number(read("userProfileSignal")) || 0)
  };
}

function buildExplainableScoring(item = {}) {
  const decision = item.jobDecision || {};
  const evidence = toList(decision.evidence).map((line) => String(line || ""));
  const risks = toList(decision.risks);
  const gaps = toList(decision.gaps);
  const rationaleSignals = parseRationaleSignals(decision.rationale || "");

  const roleEvidence = evidence.find((line) => /Profile target-role match:/i.test(line)) || "";
  const skillEvidence = evidence.find((line) => /Profile skill match:/i.test(line)) || "";
  const locationMatched = evidence.some((line) => /Profile preferred location matched/i.test(line));

  const roleBoost = roleEvidence ? 0.25 : 0;
  const skillBoost = skillEvidence ? 0.25 : 0;

  const roleMatchScore = clamp01(rationaleSignals.titleCoverage * 0.75 + rationaleSignals.keywordCoverage * 0.2 + roleBoost);
  const skillMatchScore = clamp01(rationaleSignals.requirementSignal * 0.5 + rationaleSignals.keywordCoverage * 0.2 + skillBoost);
  const locationMatchScore = clamp01(locationMatched ? 1 : 0);
  const requirementSignalScore = clamp01(rationaleSignals.requirementSignal);

  const highlights = []
    .concat(roleEvidence ? [roleEvidence] : [])
    .concat(skillEvidence ? [skillEvidence] : [])
    .concat(locationMatched ? ["Profile preferred location matched."] : [])
    .concat(evidence.filter((line) => /Matched intent keywords:/i.test(line)).slice(0, 1))
    .slice(0, 4);

  return {
    totalScore: Math.max(0, Math.min(100, Number(decision.fitScore ?? 0))),
    breakdown: {
      roleMatchScore,
      skillMatchScore,
      locationMatchScore,
      requirementSignal: requirementSignalScore
    },
    highlights,
    gaps: [...gaps.slice(0, 3), ...risks.slice(0, 2)].slice(0, 4)
  };
}

function computeRiskAdjustments(item = {}) {
  const decision = item.jobDecision || {};
  const recommendation = toText(decision.recommendation || "cautious");
  const risks = toList(decision.risks);
  const gaps = toList(decision.gaps);
  const evidence = toList(decision.evidence);
  const sourceCount = toList(item.sourceListingsSummary).length;
  const adjustments = [];

  let score = RECOMMENDATION_BASE_SCORE[recommendation] ?? RECOMMENDATION_BASE_SCORE.cautious;
  const evidenceBoost = Math.min(18, evidence.length * 3);
  score += evidenceBoost;
  if (evidenceBoost > 0) {
    adjustments.push(`Evidence boost +${evidenceBoost}`);
  }

  const confidenceBoost = Math.round(Math.max(0, Math.min(1, Number(decision.confidence ?? 0))) * 10);
  score += confidenceBoost;
  adjustments.push(`Decision confidence boost +${confidenceBoost}`);

  const sourceCredibilityBoost = Math.min(4, Math.max(0, sourceCount - 1) * 2);
  score += sourceCredibilityBoost;
  if (sourceCredibilityBoost > 0) {
    adjustments.push(`Source consistency boost +${sourceCredibilityBoost}`);
  }

  const riskPenalty = Math.min(28, risks.length * 7);
  score -= riskPenalty;
  if (riskPenalty > 0) {
    adjustments.push(`Risk penalty -${riskPenalty}`);
  }

  const gapPenalty = Math.min(18, gaps.length * 4);
  score -= gapPenalty;
  if (gapPenalty > 0) {
    adjustments.push(`Gap penalty -${gapPenalty}`);
  }

  const cautionPenalty = recommendation === "cautious" ? 6 : recommendation === "skip" ? 10 : 0;
  score -= cautionPenalty;
  if (cautionPenalty > 0) {
    adjustments.push(`Recommendation caution penalty -${cautionPenalty}`);
  }

  if (recommendation === "skip") {
    adjustments.push("Recommendation is skip, kept at tail priority.");
  }

  const explainableScoring = buildExplainableScoring(item);
  const breakdown = explainableScoring.breakdown || {};
  adjustments.push(`xs_total=${Math.round(Number(explainableScoring.totalScore || 0))}`);
  adjustments.push(
    `xs_breakdown=role:${clamp01(breakdown.roleMatchScore).toFixed(2)}|skill:${clamp01(breakdown.skillMatchScore).toFixed(2)}|location:${clamp01(breakdown.locationMatchScore).toFixed(2)}|requirement:${clamp01(breakdown.requirementSignal).toFixed(2)}`
  );
  adjustments.push(`xs_highlights=${toList(explainableScoring.highlights).slice(0, 3).join(" || ")}`);
  adjustments.push(`xs_gaps=${toList(explainableScoring.gaps).slice(0, 3).join(" || ")}`);

  return {
    priorityScore: Math.max(0, Math.min(100, Math.round(score))),
    riskAdjustments: {
      riskPenalty,
      gapPenalty,
      cautionPenalty,
      adjustments
    }
  };
}

function buildWhyRanked(item = {}, computed = {}) {
  const decision = item.jobDecision || {};
  const recommendation = toText(decision.recommendation || "cautious");
  const evidence = toList(decision.evidence);
  const risks = toList(decision.risks);
  const gaps = toList(decision.gaps);
  const parts = [
    `recommendation=${recommendation}`,
    `evidence=${evidence.length}`,
    `risks=${risks.length}`,
    `gaps=${gaps.length}`,
    `priorityScore=${computed.priorityScore}`
  ];
  if (evidence.length) parts.push(`top evidence: ${evidence[0]}`);
  if (risks.length) parts.push(`top risk: ${risks[0]}`);
  if (gaps.length) parts.push(`top gap: ${gaps[0]}`);
  return parts.join("; ");
}

function runExplainableRanking(batchDecisionResult = {}) {
  if (!batchDecisionResult || typeof batchDecisionResult !== "object") {
    const error = new Error("BatchDecisionResult is required for ranking.");
    error.code = "BATCH_DECISION_REQUIRED";
    throw error;
  }
  const items = toList(batchDecisionResult.items);
  if (!items.length) {
    const error = new Error("BatchDecisionResult.items is empty.");
    error.code = "BATCH_DECISION_ITEMS_REQUIRED";
    throw error;
  }

  const scored = items.map((item) => {
    const computed = computeRiskAdjustments(item);
    return {
      ...item,
      priorityScore: computed.priorityScore,
      riskAdjustments: computed.riskAdjustments,
      whyRanked: buildWhyRanked(item, computed),
      recommendation: toText(item.jobDecision?.recommendation || "cautious"),
      evidence: toList(item.jobDecision?.evidence),
      risks: toList(item.jobDecision?.risks),
      gaps: toList(item.jobDecision?.gaps),
      nextAction: toText(item.jobDecision?.nextAction || "hold")
    };
  });

  scored.sort((left, right) => {
    if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore;
    const leftRec = toText(left.recommendation);
    const rightRec = toText(right.recommendation);
    const recOrder = { apply: 3, cautious: 2, skip: 1 };
    if ((recOrder[rightRec] || 0) !== (recOrder[leftRec] || 0)) {
      return (recOrder[rightRec] || 0) - (recOrder[leftRec] || 0);
    }
    return String(left.listingId || "").localeCompare(String(right.listingId || ""));
  });

  const rankedItems = scored.map((item, index) => ({
    listingId: item.listingId,
    clusterId: item.clusterId,
    rank: index + 1,
    priorityScore: item.priorityScore,
    recommendation: item.recommendation,
    evidence: item.evidence,
    risks: item.risks,
    gaps: item.gaps,
    whyRanked: item.whyRanked,
    riskAdjustments: item.riskAdjustments,
    nextAction: item.nextAction,
    sourceListingsSummary: toList(item.sourceListingsSummary)
  }));

  const contract = createRankingResultContract({
    rankingId: createId("ranking"),
    intentId: batchDecisionResult.intentId || "",
    rankedItems,
    generatedAt: nowIso()
  });
  const validation = validateRankingResultContract(contract);
  if (!validation.ok) {
    const error = new Error(`Invalid RankingResult contract: ${validation.errors.join("; ")}`);
    error.code = "INVALID_RANKING_RESULT_CONTRACT";
    error.details = { errors: validation.errors, contract };
    throw error;
  }

  return contract;
}

module.exports = {
  runExplainableRanking
};
