"use strict";

const { cleanLine, uniqueLines, hasFallbackText } = require("./canonical-resume-contracts");

const DEDUP_REASON_ENUM = ["url_exact_match", "semantic_match", "unique_listing"];

function asText(value = "", max = 220) {
  const text = cleanLine(value, max);
  if (!text || hasFallbackText(text)) return "";
  return text;
}

function asTextList(items = [], max = 8, perItemMax = 220) {
  return uniqueLines(Array.isArray(items) ? items : [], max, perItemMax);
}

function createDedupResultContract(input = {}) {
  const sourceListings = Array.isArray(input.sourceListings) ? input.sourceListings : [];
  const confidenceRaw = Number(input.confidence ?? 0);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, Number(confidenceRaw.toFixed(2))))
    : 0;

  const dedupReason = asText(input.dedupReason || "unique_listing", 60) || "unique_listing";
  return {
    clusterId: asText(input.clusterId || "", 80),
    primaryListingId: asText(input.primaryListingId || "", 80),
    duplicateListingIds: asTextList(input.duplicateListingIds || [], 80, 80),
    dedupReason,
    confidence,
    dedupKey: asText(input.dedupKey || "", 500),
    sourceListings: sourceListings.map((item, index) => ({
      listingId: asText(item?.listingId || "", 80),
      source: asText(item?.source || "manual_link", 60) || "manual_link",
      sourceUrl: asText(item?.sourceUrl || "", 500),
      normalizedUrl: asText(item?.normalizedUrl || "", 500),
      sourceJobId: asText(item?.sourceJobId || "", 120),
      title: asText(item?.title || "", 160),
      company: asText(item?.company || "", 160),
      location: asText(item?.location || "", 120),
      ingestedAt: item?.ingestedAt || null,
      isPrimary: Boolean(item?.isPrimary || (input.primaryListingId && item?.listingId === input.primaryListingId)),
      rankInCluster: Number.isFinite(Number(item?.rankInCluster))
        ? Number(item.rankInCluster)
        : index + 1
    }))
  };
}

function validateDedupResultContract(contract = {}) {
  const errors = [];
  if (!contract || typeof contract !== "object") errors.push("dedup result contract must be an object");
  if (!contract.clusterId) errors.push("clusterId is required");
  if (!contract.primaryListingId) errors.push("primaryListingId is required");
  if (!Array.isArray(contract.duplicateListingIds)) errors.push("duplicateListingIds must be an array");
  if (!DEDUP_REASON_ENUM.includes(contract.dedupReason)) errors.push("dedupReason is invalid");
  if (!Number.isFinite(Number(contract.confidence))) {
    errors.push("confidence must be a number");
  } else {
    const confidence = Number(contract.confidence);
    if (confidence < 0 || confidence > 1) errors.push("confidence must be between 0 and 1");
  }
  if (!contract.dedupKey) errors.push("dedupKey is required");
  if (!Array.isArray(contract.sourceListings) || contract.sourceListings.length === 0) {
    errors.push("sourceListings must be a non-empty array");
  } else {
    contract.sourceListings.forEach((listing, index) => {
      if (!listing || typeof listing !== "object") {
        errors.push(`sourceListings[${index}] must be an object`);
        return;
      }
      if (!listing.listingId) errors.push(`sourceListings[${index}].listingId is required`);
      if (!listing.source) errors.push(`sourceListings[${index}].source is required`);
      if (!listing.normalizedUrl) errors.push(`sourceListings[${index}].normalizedUrl is required`);
      if (!listing.title) errors.push(`sourceListings[${index}].title is required`);
      if (!listing.company) errors.push(`sourceListings[${index}].company is required`);
      if (!listing.location) errors.push(`sourceListings[${index}].location is required`);
    });
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  DEDUP_REASON_ENUM,
  createDedupResultContract,
  validateDedupResultContract
};
