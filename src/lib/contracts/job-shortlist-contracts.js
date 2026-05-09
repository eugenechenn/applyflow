"use strict";

const { cleanLine, uniqueLines, hasFallbackText } = require("./canonical-resume-contracts");

const SHORTLIST_RECOMMENDATIONS = ["apply", "cautious", "skip"];
const SHORTLIST_NEXT_ACTIONS = ["apply", "collect_info", "hold", "skip"];

function asText(value = "", max = 220) {
  const text = cleanLine(value, max);
  if (!text || hasFallbackText(text)) return "";
  return text;
}

function asEnum(value = "", allowed = [], fallback = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeSourceSummary(list = []) {
  return (Array.isArray(list) ? list : []).map((entry) => ({
    listingId: asText(entry?.listingId || "", 80),
    source: asText(entry?.source || "", 60),
    normalizedUrl: asText(entry?.normalizedUrl || "", 500),
    title: asText(entry?.title || "", 160),
    company: asText(entry?.company || "", 160),
    location: asText(entry?.location || "", 120),
    isPrimary: Boolean(entry?.isPrimary)
  }));
}

function normalizeShortlistItem(item = {}) {
  return {
    listingId: asText(item?.listingId || "", 80),
    clusterId: asText(item?.clusterId || "", 80),
    rank: Number.isFinite(Number(item?.rank)) ? Number(item.rank) : 0,
    recommendation: asEnum(item?.recommendation || "cautious", SHORTLIST_RECOMMENDATIONS, "cautious"),
    nextAction: asEnum(item?.nextAction || "hold", SHORTLIST_NEXT_ACTIONS, "hold"),
    selectionReason: asText(item?.selectionReason || "", 500),
    sourceListingsSummary: normalizeSourceSummary(item?.sourceListingsSummary || [])
  };
}

function createShortlistResultContract(input = {}) {
  const shortlistedItems = Array.isArray(input.shortlistedItems) ? input.shortlistedItems : [];
  const holdItems = Array.isArray(input.holdItems) ? input.holdItems : [];
  const skippedItems = Array.isArray(input.skippedItems) ? input.skippedItems : [];

  return {
    shortlistId: asText(input.shortlistId || "", 80),
    intentId: asText(input.intentId || "", 80),
    selectedListingIds: uniqueLines(
      Array.isArray(input.selectedListingIds)
        ? input.selectedListingIds
        : shortlistedItems.map((item) => item?.listingId || ""),
      100,
      80
    ),
    shortlistedItems: shortlistedItems.map(normalizeShortlistItem),
    holdItems: holdItems.map(normalizeShortlistItem),
    skippedItems: skippedItems.map(normalizeShortlistItem),
    selectionStrategy: {
      strategyId: asText(input?.selectionStrategy?.strategyId || "recommendation_risk_gate_v1", 80) || "recommendation_risk_gate_v1",
      summary: asText(
        input?.selectionStrategy?.summary ||
          "Apply recommendations with acceptable risk enter shortlist; cautious items move to hold; skip remains excluded.",
        400
      ),
      maxShortlistSize: Number.isFinite(Number(input?.selectionStrategy?.maxShortlistSize))
        ? Number(input.selectionStrategy.maxShortlistSize)
        : 12,
      includeCautiousInHold: Boolean(input?.selectionStrategy?.includeCautiousInHold ?? true),
      riskCeiling: Number.isFinite(Number(input?.selectionStrategy?.riskCeiling))
        ? Number(input.selectionStrategy.riskCeiling)
        : 2,
      notes: uniqueLines(input?.selectionStrategy?.notes || [], 6, 220)
    },
    generatedAt: input.generatedAt || new Date().toISOString()
  };
}

function validateSelectionBucketItems(items = [], label = "items", errors = []) {
  if (!Array.isArray(items)) {
    errors.push(`${label} must be an array`);
    return;
  }
  items.forEach((item, index) => {
    if (!item.listingId) errors.push(`${label}[${index}].listingId is required`);
    if (!item.clusterId) errors.push(`${label}[${index}].clusterId is required`);
    if (!Number.isFinite(Number(item.rank))) errors.push(`${label}[${index}].rank must be a number`);
    if (!SHORTLIST_RECOMMENDATIONS.includes(item.recommendation)) {
      errors.push(`${label}[${index}].recommendation is invalid`);
    }
    if (!SHORTLIST_NEXT_ACTIONS.includes(item.nextAction)) {
      errors.push(`${label}[${index}].nextAction is invalid`);
    }
    if (!item.selectionReason) errors.push(`${label}[${index}].selectionReason is required`);
    if (!Array.isArray(item.sourceListingsSummary) || item.sourceListingsSummary.length === 0) {
      errors.push(`${label}[${index}].sourceListingsSummary must be a non-empty array`);
    }
  });
}

function validateShortlistResultContract(contract = {}) {
  const errors = [];
  if (!contract || typeof contract !== "object") errors.push("shortlist result contract must be an object");
  if (!contract.shortlistId) errors.push("shortlistId is required");
  if (!contract.intentId) errors.push("intentId is required");
  if (!Array.isArray(contract.selectedListingIds)) errors.push("selectedListingIds must be an array");

  validateSelectionBucketItems(contract.shortlistedItems, "shortlistedItems", errors);
  validateSelectionBucketItems(contract.holdItems, "holdItems", errors);
  validateSelectionBucketItems(contract.skippedItems, "skippedItems", errors);

  const totalBucketSize =
    (Array.isArray(contract.shortlistedItems) ? contract.shortlistedItems.length : 0) +
    (Array.isArray(contract.holdItems) ? contract.holdItems.length : 0) +
    (Array.isArray(contract.skippedItems) ? contract.skippedItems.length : 0);
  if (totalBucketSize === 0) {
    errors.push("at least one shortlist bucket item is required");
  }

  const selectedSet = new Set((contract.selectedListingIds || []).map((id) => String(id)));
  const shortlistedSet = new Set((contract.shortlistedItems || []).map((item) => String(item.listingId || "")));
  if (selectedSet.size !== shortlistedSet.size) {
    errors.push("selectedListingIds and shortlistedItems listingId set size mismatch");
  } else {
    shortlistedSet.forEach((id) => {
      if (!selectedSet.has(id)) {
        errors.push(`selectedListingIds missing shortlisted listingId: ${id}`);
      }
    });
  }

  if (!contract.selectionStrategy || typeof contract.selectionStrategy !== "object") {
    errors.push("selectionStrategy must be an object");
  } else {
    if (!contract.selectionStrategy.strategyId) errors.push("selectionStrategy.strategyId is required");
    if (!contract.selectionStrategy.summary) errors.push("selectionStrategy.summary is required");
    if (!Number.isFinite(Number(contract.selectionStrategy.maxShortlistSize))) {
      errors.push("selectionStrategy.maxShortlistSize must be a number");
    }
    if (!Array.isArray(contract.selectionStrategy.notes)) {
      errors.push("selectionStrategy.notes must be an array");
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  createShortlistResultContract,
  validateShortlistResultContract
};
