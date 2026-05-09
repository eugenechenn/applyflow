"use strict";

const fs = require("fs");
const path = require("path");
const { runExplainableRanking } = require("../../src/lib/discovery/job-ranking-pipeline");
const {
  createBatchDecisionResultContract,
  validateBatchDecisionResultContract
} = require("../../src/lib/contracts/job-batch-decision-contracts");
const {
  validateRankingResultContract
} = require("../../src/lib/contracts/job-ranking-contracts");

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

const fixture = readFixture("discovery-ranking-fixture.json");
const batchInput = createBatchDecisionResultContract(fixture.batchDecisionResult || {});
const batchValidation = validateBatchDecisionResultContract(batchInput);
assertTrue(batchValidation.ok, `fixture batchDecisionResult invalid: ${(batchValidation.errors || []).join("; ")}`);

const ranking = runExplainableRanking(batchInput);
const rankingValidation = validateRankingResultContract(ranking);
assertTrue(rankingValidation.ok, `ranking contract invalid: ${(rankingValidation.errors || []).join("; ")}`);

const rankedItems = Array.isArray(ranking.rankedItems) ? ranking.rankedItems : [];
assertTrue(rankedItems.length > 0, "ranking result should contain rankedItems");

const expected = fixture.expected || {};
if (expected.firstListingId) {
  assertTrue(
    rankedItems[0]?.listingId === expected.firstListingId,
    `expected first listing ${expected.firstListingId}, got ${rankedItems[0]?.listingId || "none"}`
  );
}
if (expected.lastListingId) {
  assertTrue(
    rankedItems[rankedItems.length - 1]?.listingId === expected.lastListingId,
    `expected last listing ${expected.lastListingId}, got ${rankedItems[rankedItems.length - 1]?.listingId || "none"}`
  );
}

const mustContainFields = Array.isArray(expected.mustContainFields) ? expected.mustContainFields : [];
rankedItems.forEach((item, index) => {
  mustContainFields.forEach((field) => {
    assertTrue(
      Object.prototype.hasOwnProperty.call(item, field),
      `rankedItems[${index}] missing required field: ${field}`
    );
  });
  assertTrue(Array.isArray(item.riskAdjustments?.adjustments), `rankedItems[${index}] missing riskAdjustments.adjustments`);
  assertTrue(Boolean(item.whyRanked), `rankedItems[${index}] missing whyRanked`);
});

const applyIndex = rankedItems.findIndex((item) => item.recommendation === "apply");
const cautiousIndex = rankedItems.findIndex((item) => item.recommendation === "cautious");
const skipIndex = rankedItems.findIndex((item) => item.recommendation === "skip");
if (expected.cautiousShouldBeBelowApply) {
  assertTrue(applyIndex >= 0 && cautiousIndex >= 0 && applyIndex < cautiousIndex, "cautious item should be below apply item");
}
if (expected.skipShouldBeTail) {
  assertTrue(skipIndex >= 0 && skipIndex === rankedItems.length - 1, "skip item should be ranked at tail");
}

expectErrorCode("ranking.missingBatch", "BATCH_DECISION_REQUIRED", () => {
  runExplainableRanking(null);
});
expectErrorCode("ranking.emptyItems", "BATCH_DECISION_ITEMS_REQUIRED", () => {
  runExplainableRanking({ batchId: "b1", intentId: "i1", items: [] });
});

console.log("validate-discovery-ranking: explainable ranking ordering and fields passed.");
