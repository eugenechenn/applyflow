"use strict";

const { cleanLine, uniqueLines, hasFallbackText } = require("./canonical-resume-contracts");

const ADMISSION_STATUSES = ["admitted", "blocked", "override_required", "overridden"];
const ADMISSION_BUCKETS = ["shortlisted", "hold", "skipped", "unlisted"];
const ADMISSION_ACTORS = ["system", "user"];
const RECOMMENDATIONS = ["apply", "cautious", "skip"];
const NEXT_ACTIONS = ["apply", "collect_info", "hold", "skip"];

function asText(value = "", max = 220) {
  const text = cleanLine(value, max);
  if (!text || hasFallbackText(text)) return "";
  return text;
}

function asEnum(value = "", allowed = [], fallback = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function asTextList(list = [], max = 8, perItemMax = 220) {
  return uniqueLines(Array.isArray(list) ? list : [], max, perItemMax);
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

function createShortlistAdmissionContract(input = {}) {
  const override = input.override && typeof input.override === "object" ? input.override : {};

  return {
    admissionId: asText(input.admissionId || "", 120),
    intentId: asText(input.intentId || "", 80),
    shortlistId: asText(input.shortlistId || "", 80),
    listingId: asText(input.listingId || "", 80),
    clusterId: asText(input.clusterId || "", 80),
    recommendation: asEnum(input.recommendation || "cautious", RECOMMENDATIONS, "cautious"),
    nextAction: asEnum(input.nextAction || "hold", NEXT_ACTIONS, "hold"),
    selectionReason: asText(input.selectionReason || "", 500),
    sourceListingsSummary: normalizeSourceSummary(input.sourceListingsSummary || []),
    admissionBucket: asEnum(input.admissionBucket || "unlisted", ADMISSION_BUCKETS, "unlisted"),
    admissionStatus: asEnum(input.admissionStatus || "blocked", ADMISSION_STATUSES, "blocked"),
    actor: asEnum(input.actor || "system", ADMISSION_ACTORS, "system"),
    confirmedBy: asText(input.confirmedBy || "", 80),
    override: {
      applied: Boolean(override.applied),
      originalBucket: asEnum(override.originalBucket || "", ADMISSION_BUCKETS, "unlisted"),
      overrideReason: asText(override.overrideReason || "", 500),
      actor: asEnum(override.actor || input.actor || "system", ADMISSION_ACTORS, "system"),
      timestamp: override.timestamp || null
    },
    requiredActions: asTextList(input.requiredActions || [], 6, 220),
    createdAt: input.createdAt || new Date().toISOString()
  };
}

function validateShortlistAdmissionContract(contract = {}) {
  const errors = [];
  if (!contract || typeof contract !== "object") errors.push("shortlist admission contract must be an object");
  if (!contract.admissionId) errors.push("admissionId is required");
  if (!contract.intentId) errors.push("intentId is required");
  if (!contract.shortlistId) errors.push("shortlistId is required");
  if (!contract.listingId) errors.push("listingId is required");
  if (!contract.clusterId) errors.push("clusterId is required");
  if (!RECOMMENDATIONS.includes(contract.recommendation)) errors.push("recommendation is invalid");
  if (!NEXT_ACTIONS.includes(contract.nextAction)) errors.push("nextAction is invalid");
  if (!contract.selectionReason) errors.push("selectionReason is required");
  if (!ADMISSION_BUCKETS.includes(contract.admissionBucket)) errors.push("admissionBucket is invalid");
  if (!ADMISSION_STATUSES.includes(contract.admissionStatus)) errors.push("admissionStatus is invalid");
  if (!ADMISSION_ACTORS.includes(contract.actor)) errors.push("actor is invalid");
  if (!Array.isArray(contract.sourceListingsSummary) || contract.sourceListingsSummary.length === 0) {
    errors.push("sourceListingsSummary must be a non-empty array");
  }
  if (!contract.override || typeof contract.override !== "object") {
    errors.push("override must be an object");
  } else {
    if (typeof contract.override.applied !== "boolean") errors.push("override.applied must be a boolean");
    if (!ADMISSION_BUCKETS.includes(contract.override.originalBucket)) {
      errors.push("override.originalBucket is invalid");
    }
    if (!ADMISSION_ACTORS.includes(contract.override.actor)) {
      errors.push("override.actor is invalid");
    }
  }
  if (!Array.isArray(contract.requiredActions)) {
    errors.push("requiredActions must be an array");
  }

  if (contract.admissionStatus === "overridden") {
    if (!contract.override?.applied) errors.push("override.applied must be true when admissionStatus=overridden");
    if (!contract.override?.overrideReason) {
      errors.push("override.overrideReason is required when admissionStatus=overridden");
    }
  }
  if (contract.admissionStatus === "admitted" && contract.admissionBucket !== "shortlisted" && !contract.override?.applied) {
    errors.push("non-shortlisted admission must be overridden");
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  ADMISSION_STATUSES,
  ADMISSION_BUCKETS,
  createShortlistAdmissionContract,
  validateShortlistAdmissionContract
};
