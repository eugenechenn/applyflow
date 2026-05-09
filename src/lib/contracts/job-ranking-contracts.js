"use strict";

const { cleanLine, uniqueLines, hasFallbackText } = require("./canonical-resume-contracts");

const RANKING_RECOMMENDATIONS = ["apply", "cautious", "skip"];
const RANKING_NEXT_ACTIONS = ["apply", "collect_info", "hold", "skip"];

function asText(value = "", max = 220) {
  const text = cleanLine(value, max);
  if (!text || hasFallbackText(text)) return "";
  return text;
}

function asTextList(items = [], max = 8, perItemMax = 220) {
  return uniqueLines(Array.isArray(items) ? items : [], max, perItemMax);
}

function asEnum(value = "", allowed = [], fallback = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function createRankingResultContract(input = {}) {
  const rankedItems = Array.isArray(input.rankedItems) ? input.rankedItems : [];
  return {
    rankingId: asText(input.rankingId || "", 80),
    intentId: asText(input.intentId || "", 80),
    rankedItems: rankedItems.map((item, index) => ({
      listingId: asText(item?.listingId || "", 80),
      clusterId: asText(item?.clusterId || "", 80),
      rank: Number.isFinite(Number(item?.rank)) ? Number(item.rank) : index + 1,
      priorityScore: Math.max(0, Math.min(100, Number(item?.priorityScore ?? 0))),
      recommendation: asEnum(item?.recommendation || "cautious", RANKING_RECOMMENDATIONS, "cautious"),
      evidence: asTextList(item?.evidence || [], 10, 220),
      risks: asTextList(item?.risks || [], 10, 220),
      gaps: asTextList(item?.gaps || [], 10, 220),
      whyRanked: asText(item?.whyRanked || "", 500),
      riskAdjustments: {
        riskPenalty: Number.isFinite(Number(item?.riskAdjustments?.riskPenalty))
          ? Number(item.riskAdjustments.riskPenalty)
          : 0,
        gapPenalty: Number.isFinite(Number(item?.riskAdjustments?.gapPenalty))
          ? Number(item.riskAdjustments.gapPenalty)
          : 0,
        cautionPenalty: Number.isFinite(Number(item?.riskAdjustments?.cautionPenalty))
          ? Number(item.riskAdjustments.cautionPenalty)
          : 0,
        adjustments: asTextList(item?.riskAdjustments?.adjustments || [], 8, 220)
      },
      nextAction: asEnum(item?.nextAction || "hold", RANKING_NEXT_ACTIONS, "hold"),
      sourceListingsSummary: (Array.isArray(item?.sourceListingsSummary) ? item.sourceListingsSummary : []).map(
        (entry) => ({
          listingId: asText(entry?.listingId || "", 80),
          source: asText(entry?.source || "", 60),
          normalizedUrl: asText(entry?.normalizedUrl || "", 500),
          title: asText(entry?.title || "", 160),
          company: asText(entry?.company || "", 160),
          location: asText(entry?.location || "", 120),
          isPrimary: Boolean(entry?.isPrimary)
        })
      )
    })),
    generatedAt: input.generatedAt || new Date().toISOString()
  };
}

function validateRankingResultContract(contract = {}) {
  const errors = [];
  if (!contract || typeof contract !== "object") errors.push("ranking result contract must be an object");
  if (!contract.rankingId) errors.push("rankingId is required");
  if (!contract.intentId) errors.push("intentId is required");
  if (!Array.isArray(contract.rankedItems) || contract.rankedItems.length === 0) {
    errors.push("rankedItems must be a non-empty array");
  } else {
    contract.rankedItems.forEach((item, index) => {
      if (!item.listingId) errors.push(`rankedItems[${index}].listingId is required`);
      if (!item.clusterId) errors.push(`rankedItems[${index}].clusterId is required`);
      if (!Number.isFinite(Number(item.rank))) errors.push(`rankedItems[${index}].rank must be a number`);
      if (!Number.isFinite(Number(item.priorityScore))) errors.push(`rankedItems[${index}].priorityScore must be a number`);
      if (!RANKING_RECOMMENDATIONS.includes(item.recommendation)) {
        errors.push(`rankedItems[${index}].recommendation is invalid`);
      }
      if (!Array.isArray(item.evidence)) errors.push(`rankedItems[${index}].evidence must be an array`);
      if (!Array.isArray(item.risks)) errors.push(`rankedItems[${index}].risks must be an array`);
      if (!Array.isArray(item.gaps)) errors.push(`rankedItems[${index}].gaps must be an array`);
      if (!item.whyRanked) errors.push(`rankedItems[${index}].whyRanked is required`);
      if (!item.riskAdjustments || typeof item.riskAdjustments !== "object") {
        errors.push(`rankedItems[${index}].riskAdjustments must be an object`);
      } else if (!Array.isArray(item.riskAdjustments.adjustments)) {
        errors.push(`rankedItems[${index}].riskAdjustments.adjustments must be an array`);
      }
      if (!RANKING_NEXT_ACTIONS.includes(item.nextAction)) {
        errors.push(`rankedItems[${index}].nextAction is invalid`);
      }
      if (!Array.isArray(item.sourceListingsSummary) || item.sourceListingsSummary.length === 0) {
        errors.push(`rankedItems[${index}].sourceListingsSummary must be a non-empty array`);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  createRankingResultContract,
  validateRankingResultContract
};
