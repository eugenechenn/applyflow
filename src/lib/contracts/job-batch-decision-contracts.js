"use strict";

const { cleanLine, uniqueLines, hasFallbackText } = require("./canonical-resume-contracts");
const { validateDecisionContract } = require("./agent-governance-contracts");

function asText(value = "", max = 220) {
  const text = cleanLine(value, max);
  if (!text || hasFallbackText(text)) return "";
  return text;
}

function asTextList(items = [], max = 8, perItemMax = 220) {
  return uniqueLines(Array.isArray(items) ? items : [], max, perItemMax);
}

function createBatchDecisionResultContract(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  return {
    batchId: asText(input.batchId || "", 80),
    intentId: asText(input.intentId || "", 80),
    items: items.map((item) => ({
      listingId: asText(item?.listingId || "", 80),
      clusterId: asText(item?.clusterId || "", 80),
      jobDecision: item?.jobDecision && typeof item.jobDecision === "object" ? item.jobDecision : null,
      decisionTrace: {
        source: asText(item?.decisionTrace?.source || "discovery_batch_decision", 80) || "discovery_batch_decision",
        runId: asText(item?.decisionTrace?.runId || "", 120),
        version: asText(item?.decisionTrace?.version || "v1", 40) || "v1"
      },
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
      ),
      notes: asTextList(item?.notes || [], 6, 220)
    })),
    generatedAt: input.generatedAt || new Date().toISOString()
  };
}

function validateBatchDecisionResultContract(contract = {}) {
  const errors = [];
  if (!contract || typeof contract !== "object") errors.push("batch decision result must be an object");
  if (!contract.batchId) errors.push("batchId is required");
  if (!contract.intentId) errors.push("intentId is required");
  if (!Array.isArray(contract.items) || contract.items.length === 0) {
    errors.push("items must be a non-empty array");
  } else {
    contract.items.forEach((item, index) => {
      if (!item.listingId) errors.push(`items[${index}].listingId is required`);
      if (!item.clusterId) errors.push(`items[${index}].clusterId is required`);
      if (!item.jobDecision || typeof item.jobDecision !== "object") {
        errors.push(`items[${index}].jobDecision is required`);
      } else {
        const decisionValidation = validateDecisionContract(item.jobDecision);
        if (!decisionValidation.ok) {
          errors.push(`items[${index}].jobDecision invalid: ${decisionValidation.errors.join(", ")}`);
        }
      }
      if (!Array.isArray(item.sourceListingsSummary) || item.sourceListingsSummary.length === 0) {
        errors.push(`items[${index}].sourceListingsSummary must be a non-empty array`);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  createBatchDecisionResultContract,
  validateBatchDecisionResultContract
};
