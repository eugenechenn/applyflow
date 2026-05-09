"use strict";

const fs = require("fs");
const path = require("path");
const { createDiscoveryIntent, getDiscoveryIntent, getRankingResultByIntent, getShortlistResultByIntent } = require("../../src/lib/discovery/job-discovery-pipeline");
const { syncFeishuBitableLeads } = require("../../src/lib/discovery/feishu-sync-layer");

function readFixture(fileName) {
  const filePath = path.resolve(process.cwd(), "scripts/fixtures", fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function createMockFetch(snapshotPayload) {
  return async () => ({
    ok: true,
    async json() {
      return snapshotPayload;
    }
  });
}

const fixture = readFixture("discovery-feishu-sync-fixture.json");
const intent = createDiscoveryIntent({
  userId: "user_a",
  keywords: ["ai product manager"],
  city: "Shanghai",
  jobType: "full_time"
});

assertTrue(Boolean(getDiscoveryIntent(intent.intentId)), "discovery intent should exist before sync");

(async () => {
  const initialSync = await syncFeishuBitableLeads({
    intentId: intent.intentId,
    userId: intent.userId,
    profile: {},
    ...fixture.config,
    fetchImpl: createMockFetch(fixture.snapshots.initial)
  });

  assertTrue(initialSync.newCount === 2, "initial sync should treat records as new");
  assertTrue(initialSync.updatedCount === 0, "initial sync should have no updated records");
  assertTrue(initialSync.unchangedCount === 0, "initial sync should have no unchanged records");
  assertTrue(initialSync.importedCandidateCount === 1, "initial sync should import only eligible direct_apply lead");
  assertTrue(initialSync.leadProcessingResult.summary.totalLeads === 2, "initial sync should process both fetched leads");

  const eligibleDecision = initialSync.leadProcessingResult.eligibilityDecisions.find(
    (item) => item.eligibleForCandidateInput === true
  );
  const qrDecision = initialSync.leadProcessingResult.eligibilityDecisions.find(
    (item) => item.leadType === "mini_program_apply"
  );
  assertTrue(eligibleDecision?.eligibleForCandidateInput === true, "eligible Feishu record should remain eligible in sync layer");
  assertTrue(qrDecision?.routing === "manual_followup_required", "mini program lead should remain blocked in sync layer");

  const unchangedSync = await syncFeishuBitableLeads({
    intentId: intent.intentId,
    userId: intent.userId,
    profile: {},
    ...fixture.config,
    fetchImpl: createMockFetch(fixture.snapshots.initial)
  });

  assertTrue(unchangedSync.newCount === 0, "same records should not be re-imported as new");
  assertTrue(unchangedSync.updatedCount === 0, "same records should not be flagged as updated");
  assertTrue(unchangedSync.unchangedCount === 2, "same records should be detected as unchanged");
  assertTrue(unchangedSync.importedCandidateCount === 0, "unchanged sync should not generate new candidate imports");

  const incrementalSync = await syncFeishuBitableLeads({
    intentId: intent.intentId,
    userId: intent.userId,
    profile: {},
    ...fixture.config,
    fetchImpl: createMockFetch(fixture.snapshots.incremental)
  });

  assertTrue(incrementalSync.newCount === 1, "incremental sync should import only new record");
  assertTrue(incrementalSync.updatedCount === 0, "incremental sync should not mark unchanged records as updated");
  assertTrue(incrementalSync.importedCandidateCount === 1, "incremental sync should import new eligible announcement");
  const announcementDecision = incrementalSync.leadProcessingResult.eligibilityDecisions.find(
    (item) => item.leadType === "announcement"
  );
  assertTrue(announcementDecision?.eligibleForCandidateInput === true, "sufficient announcement should enter candidate pipeline");

  const updatedSync = await syncFeishuBitableLeads({
    intentId: intent.intentId,
    userId: intent.userId,
    profile: {},
    ...fixture.config,
    fetchImpl: createMockFetch(fixture.snapshots.updated)
  });

  assertTrue(updatedSync.newCount === 0, "updated sync should not create extra new records");
  assertTrue(updatedSync.updatedCount === 1, "updated sync should detect changed record payload");
  assertTrue(updatedSync.importedCandidateCount === 0, "updated eligible record should not duplicate canonical import");
  const updatedDirectApply = updatedSync.leadProcessingResult.leadRecords.find(
    (item) => item.sourceLeadId === "rec_direct_001"
  );
  assertTrue(Boolean(updatedDirectApply?.leadId), "updated record should retain stable leadId");

  const rankingResult = getRankingResultByIntent(intent.intentId, { profile: {} });
  const shortlistResult = getShortlistResultByIntent(intent.intentId, { profile: {} });
  assertTrue(Boolean(rankingResult), "ranking should still be available after Feishu sync");
  assertTrue(Boolean(shortlistResult), "shortlist should still be available after Feishu sync");

  console.log(
    "validate-discovery-feishu-sync: Feishu bitable sync deduplicates by sourceLeadId, records updates without duplicate lead creation, and reuses existing lead gate plus discovery pipeline."
  );
})().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
