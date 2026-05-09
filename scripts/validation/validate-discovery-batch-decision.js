"use strict";

const fs = require("fs");
const path = require("path");
const {
  createDiscoveryIntent,
  importCandidatesToCanonicalListings,
  getDedupCandidatePoolByIntent,
  getBatchDecisionResultByIntent
} = require("../../src/lib/discovery/job-discovery-pipeline");
const { runBatchDecision } = require("../../src/lib/discovery/job-batch-decision-pipeline");
const {
  validateBatchDecisionResultContract
} = require("../../src/lib/contracts/job-batch-decision-contracts");

function readFixture(fileName) {
  const filePath = path.resolve(process.cwd(), "scripts/fixtures", fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function expectErrorCode(label, code, fn) {
  try {
    fn();
  } catch (error) {
    if (error?.code === code) return;
    throw new Error(`${label} expected ${code}, got ${error?.code || "unknown"}`);
  }
  throw new Error(`${label} expected ${code}, but no error thrown.`);
}

const fixture = readFixture("discovery-batch-decision-fixture.json");

const intent = createDiscoveryIntent(fixture.intentInput || {});
const imported = importCandidatesToCanonicalListings({
  intentId: intent.intentId,
  userId: intent.userId,
  candidates: fixture.candidates || [],
  profile: { id: intent.userId }
});

const dedupPool = getDedupCandidatePoolByIntent(intent.intentId);
const batchDecisionResult =
  imported.batchDecisionResult ||
  getBatchDecisionResultByIntent(intent.intentId, { profile: { id: intent.userId } });
assertTrue(imported.rankingResult && typeof imported.rankingResult === "object", "rankingResult should be returned after batch decision.");

const validation = validateBatchDecisionResultContract(batchDecisionResult);
assertTrue(validation.ok, `batch decision contract invalid: ${(validation.errors || []).join("; ")}`);

const primaryCount = (dedupPool.primaryListings || []).length;
assertTrue(
  primaryCount >= Number(fixture.expected?.minPrimaryListings || 1),
  "primary listing count is lower than expected"
);
assertTrue(
  batchDecisionResult.items.length === primaryCount,
  "batch decision should only be generated for primary listings"
);

if (fixture.expected?.duplicatesShouldNotBeDecidedTwice) {
  const listingIds = batchDecisionResult.items.map((item) => item.listingId);
  const dedupUnique = new Set(listingIds);
  assertTrue(dedupUnique.size === listingIds.length, "duplicate listings were decided more than once");
}

const requiredDecisionFields = fixture.expected?.requiredDecisionFields || [];
batchDecisionResult.items.forEach((item, index) => {
  requiredDecisionFields.forEach((field) => {
    assertTrue(
      Object.prototype.hasOwnProperty.call(item.jobDecision || {}, field),
      `items[${index}].jobDecision missing field: ${field}`
    );
  });
  assertTrue(Array.isArray(item.sourceListingsSummary) && item.sourceListingsSummary.length > 0, "source listing summary missing");
});

if (fixture.expected?.blockedCompanyShouldProduceSkip) {
  const blockedItem = batchDecisionResult.items.find((item) =>
    (item.sourceListingsSummary || []).some((source) => String(source.company || "").toLowerCase() === "blocked corp")
  );
  assertTrue(Boolean(blockedItem), "blocked company listing not found in batch items");
  assertTrue(blockedItem.jobDecision.recommendation === "skip", "blocked company listing should be recommended as skip");
}

expectErrorCode("batchDecision.missingIntent", "DISCOVERY_INTENT_REQUIRED", () => {
  runBatchDecision({
    intent: null,
    dedupCandidatePool: dedupPool,
    profile: { id: intent.userId }
  });
});

expectErrorCode("batchDecision.missingPrimaryPool", "PRIMARY_LISTINGS_REQUIRED", () => {
  runBatchDecision({
    intent,
    dedupCandidatePool: { primaryListings: [], dedupClusters: [] },
    profile: { id: intent.userId }
  });
});

console.log("validate-discovery-batch-decision: primary-only batch decisions and cluster mapping passed.");
