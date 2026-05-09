"use strict";

const fs = require("fs");
const path = require("path");
const orchestrator = require("../../src/lib/orchestrator/workflow-controller");

function readFixture(fileName) {
  const filePath = path.resolve(process.cwd(), "scripts", "fixtures", fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const fixture = readFixture("discovery-offline-json-adapter-fixture.json");
  const created = await orchestrator.createDiscoveryIntentWorkflow(fixture.intent || {});
  const intentId = created?.intent?.intentId;
  assertTrue(Boolean(intentId), "intentId should be created");

  const imported = await orchestrator.importDiscoveryOfflineJsonWorkflow(intentId, fixture.import || {});
  const leadResult = imported?.leadProcessingResult || {};
  const summary = leadResult?.summary || {};
  const listings = Array.isArray(imported?.listings) ? imported.listings : [];
  const fallbackListings = listings.filter((listing) => {
    const company = String(listing?.company || "");
    const title = String(listing?.title || "");
    const url = String(listing?.sourceUrl || listing?.normalizedUrl || "");
    return (
      listing?.metadata?.isFallback === true ||
      /^fallback_/i.test(String(listing?.sourceJobId || "")) ||
      /applyflow\.local\/fallback/i.test(url) ||
      company === "工程师 团队" ||
      title === "工程师 相关岗位"
    );
  });

  assertTrue(summary.totalLeads === 80, "offline_json small batch should ingest 80 lead records");
  assertTrue(summary.eligibleLeads === 50, "eligible leads should equal candidate limit (50)");
  assertTrue(summary.blockedLeads === 30, "blocked leads should equal resolution limit (30)");
  assertTrue(imported?.batchSummary?.fallbackUsed !== true, "offline_json import must not use fallback records");
  assertTrue(listings.length === 50, "50 candidate inputs should become canonical listings");
  assertTrue(fallbackListings.length === 0, "fallback records must not become canonical listings");
  assertTrue(
    listings.some((listing) => /^https?:\/\//i.test(String(listing?.sourceUrl || ""))),
    "at least one canonical listing should keep a real source URL"
  );
  assertTrue(Boolean(imported?.rankingResult), "ranking result should be generated");
  assertTrue(Boolean(imported?.shortlistResult), "shortlist result should be generated");
  assertTrue(Boolean(imported?.batchDecisionResult), "batch decision result should be generated");
  assertTrue(imported?.source === "offline_json", "source marker should be offline_json");

  console.log(
    "validate-discovery-offline-json-adapter: offline_json source imports 50 candidate + 30 resolution records and reuses canonical->dedup->batch decision->ranking->shortlist pipeline."
  );
}

main().catch((error) => {
  console.error("validate-discovery-offline-json-adapter failed:", error?.message || error);
  process.exitCode = 1;
});
