"use strict";

const fs = require("fs");
const path = require("path");
const { runShortlistSelection } = require("../../src/lib/discovery/job-shortlist-pipeline");
const {
  createDiscoveryIntent,
  importCandidatesToCanonicalListings,
  getShortlistResultByIntent,
  getDedupCandidatePoolByIntent
} = require("../../src/lib/discovery/job-discovery-pipeline");
const { createRankingResultContract, validateRankingResultContract } = require("../../src/lib/contracts/job-ranking-contracts");
const { validateShortlistResultContract } = require("../../src/lib/contracts/job-shortlist-contracts");

function readFixture(fileName) {
  const filePath = path.resolve(process.cwd(), "scripts/fixtures", fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function expectErrorCode(label, expectedCode, fn) {
  try {
    fn();
  } catch (error) {
    if (error?.code === expectedCode) return;
    throw new Error(`${label} expected ${expectedCode}, got ${error?.code || "unknown"}`);
  }
  throw new Error(`${label} expected ${expectedCode}, but no error was thrown.`);
}

const fixture = readFixture("discovery-shortlist-fixture.json");
const batchFixture = readFixture("discovery-batch-decision-fixture.json");
const rankingInput = createRankingResultContract(fixture.rankingResult || {});
const rankingValidation = validateRankingResultContract(rankingInput);
assertTrue(rankingValidation.ok, `fixture rankingResult invalid: ${(rankingValidation.errors || []).join("; ")}`);

const shortlist = runShortlistSelection(rankingInput);
const shortlistValidation = validateShortlistResultContract(shortlist);
assertTrue(shortlistValidation.ok, `shortlist contract invalid: ${(shortlistValidation.errors || []).join("; ")}`);

const expected = fixture.expected || {};
const shortlistedIds = (shortlist.shortlistedItems || []).map((item) => item.listingId);
const holdIds = (shortlist.holdItems || []).map((item) => item.listingId);
const skippedIds = (shortlist.skippedItems || []).map((item) => item.listingId);

(expected.shortlistedMustContain || []).forEach((listingId) => {
  assertTrue(shortlistedIds.includes(listingId), `shortlisted must contain ${listingId}`);
});
(expected.holdMustContain || []).forEach((listingId) => {
  assertTrue(holdIds.includes(listingId), `hold must contain ${listingId}`);
});
(expected.skippedMustContain || []).forEach((listingId) => {
  assertTrue(skippedIds.includes(listingId), `skipped must contain ${listingId}`);
});

assertTrue(
  JSON.stringify([...new Set(shortlist.selectedListingIds || [])].sort()) ===
    JSON.stringify([...new Set(shortlistedIds)].sort()),
  "selectedListingIds must match shortlistedItems listing ids"
);

[...(shortlist.shortlistedItems || []), ...(shortlist.holdItems || []), ...(shortlist.skippedItems || [])].forEach(
  (item, index) => {
    assertTrue(Boolean(item.selectionReason), `item[${index}] missing selectionReason`);
    assertTrue(
      Array.isArray(item.sourceListingsSummary) && item.sourceListingsSummary.length > 0,
      `item[${index}] missing sourceListingsSummary`
    );
  }
);

expectErrorCode("shortlist.missingRanking", "RANKING_RESULT_REQUIRED", () => {
  runShortlistSelection(null);
});
expectErrorCode("shortlist.emptyItems", "RANKING_ITEMS_REQUIRED", () => {
  runShortlistSelection({
    rankingId: "ranking_empty",
    intentId: "intent_empty",
    rankedItems: []
  });
});

const intent = createDiscoveryIntent(batchFixture.intentInput || {});
const imported = importCandidatesToCanonicalListings({
  intentId: intent.intentId,
  userId: intent.userId,
  candidates: batchFixture.candidates || [],
  profile: { id: intent.userId }
});
assertTrue(imported.shortlistResult && typeof imported.shortlistResult === "object", "import should return shortlistResult");

const chainShortlist = getShortlistResultByIntent(intent.intentId, { profile: { id: intent.userId } });
const chainValidation = validateShortlistResultContract(chainShortlist);
assertTrue(chainValidation.ok, `chain shortlist invalid: ${(chainValidation.errors || []).join("; ")}`);

const dedupPool = getDedupCandidatePoolByIntent(intent.intentId);
const primaryIds = new Set((dedupPool.primaryListings || []).map((item) => item.listingId));
const decidedIds = new Set([
  ...(chainShortlist.shortlistedItems || []).map((item) => item.listingId),
  ...(chainShortlist.holdItems || []).map((item) => item.listingId),
  ...(chainShortlist.skippedItems || []).map((item) => item.listingId)
]);
decidedIds.forEach((id) => {
  assertTrue(primaryIds.has(id), `shortlist bucket contains non-primary listing: ${id}`);
});

console.log("validate-discovery-shortlist: explainable shortlist buckets and guards passed.");
