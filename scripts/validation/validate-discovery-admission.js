"use strict";

const fs = require("fs");
const path = require("path");
const store = require("../../src/server/store");
const orchestrator = require("../../src/lib/orchestrator/workflow-controller");
const { nowIso } = require("../../src/lib/utils/id");
const {
  createShortlistAdmissionContract,
  validateShortlistAdmissionContract
} = require("../../src/lib/contracts/job-shortlist-admission-contracts");

function readFixture(fileName) {
  const filePath = path.resolve(process.cwd(), "scripts/fixtures", fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function expectErrorCode(label, expectedCode, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      throw new Error(`${label} expected ${expectedCode}, but no error was thrown.`);
    })
    .catch((error) => {
      if (error?.code === expectedCode) return;
      throw new Error(`${label} expected ${expectedCode}, got ${error?.code || "unknown"}`);
    });
}

function pickOne(list = []) {
  return Array.isArray(list) && list.length > 0 ? list[0] : null;
}

async function main() {
  const fixture = readFixture("discovery-admission-fixture.json");
  const intent = orchestrator.createDiscoveryIntentWorkflow(fixture.intentInput || {}).intent;
  const imported = orchestrator.importDiscoveryCandidatesWorkflow(intent.intentId, {
    candidates: fixture.candidates || []
  });
  const shortlist = imported.shortlistResult || orchestrator.getDiscoveryIntentView(intent.intentId).shortlistResult;
  assertTrue(shortlist && typeof shortlist === "object", "shortlistResult is required");

  const shortlistedItem = pickOne(shortlist.shortlistedItems || []);
  const holdItem = pickOne(shortlist.holdItems || []);
  const skippedItem = pickOne(shortlist.skippedItems || []);
  assertTrue(Boolean(shortlistedItem), "fixture must produce at least one shortlisted item");
  assertTrue(Boolean(holdItem), "fixture must produce at least one hold item");
  assertTrue(Boolean(skippedItem), "fixture must produce at least one skipped item");

  const admitted = await orchestrator.admitDiscoveryListingWorkflow(intent.intentId, shortlistedItem.listingId, {
    actor: "user"
  });
  assertTrue(admitted?.admission?.admissionStatus === "admitted", "shortlisted listing should be admitted");

  await expectErrorCode("hold.default", "SHORTLIST_OVERRIDE_REQUIRED", async () => {
    await orchestrator.admitDiscoveryListingWorkflow(intent.intentId, holdItem.listingId, { actor: "user" });
  });

  await expectErrorCode("skip.default", "SHORTLIST_ADMISSION_BLOCKED", async () => {
    await orchestrator.admitDiscoveryListingWorkflow(intent.intentId, skippedItem.listingId, { actor: "user" });
  });

  const holdOverride = await orchestrator.admitDiscoveryListingWorkflow(intent.intentId, holdItem.listingId, {
    actor: "user",
    overrideReason: "Candidate has strong portfolio evidence."
  });
  assertTrue(holdOverride.admission.admissionStatus === "overridden", "hold override should be overridden");

  const skipOverride = await orchestrator.admitDiscoveryListingWorkflow(intent.intentId, skippedItem.listingId, {
    actor: "user",
    overrideReason: "Strategic exploration for market signal.",
    allowSkipOverride: true
  });
  assertTrue(skipOverride.admission.admissionStatus === "overridden", "skipped override should be overridden");

  const invalidAdmission = createShortlistAdmissionContract({
    admissionId: "admission_invalid",
    intentId: intent.intentId,
    shortlistId: shortlist.shortlistId,
    listingId: shortlistedItem.listingId,
    clusterId: shortlistedItem.clusterId,
    recommendation: "apply",
    nextAction: "apply",
    selectionReason: "invalid",
    sourceListingsSummary: shortlistedItem.sourceListingsSummary || [],
    admissionBucket: "hold",
    admissionStatus: "overridden",
    actor: "user",
    override: {
      applied: false,
      originalBucket: "hold",
      overrideReason: "",
      actor: "user",
      timestamp: nowIso()
    },
    createdAt: nowIso()
  });
  const invalidValidation = validateShortlistAdmissionContract(invalidAdmission);
  assertTrue(!invalidValidation.ok, "invalid overridden admission must fail contract validation");

  const nonShortlistJob = store.saveJob({
    id: `job_non_shortlist_${Date.now()}`,
    company: "Non Shortlist Co",
    title: "PM",
    location: "Shanghai",
    priority: "medium",
    status: "inbox",
    sourceLabel: "discovery",
    sourcePlatform: "discovery",
    jobUrl: "https://example.com/non-shortlist",
    jdRaw: "non shortlist",
    discoveryContext: {
      intentId: intent.intentId,
      listingId: "listing_non_shortlist",
      source: "discovery_shortlist"
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  await expectErrorCode("prepare.non_shortlist", "SHORTLIST_ADMISSION_REQUIRED", async () => {
    await orchestrator.prepareJobApplication(nonShortlistJob.id, {});
  });

  const allowedCodes = new Set(["PROFILE_REQUIRED", "RESUME_REQUIRED", "DECISION_REQUIRED", "CONTROL_GATE_REVIEW_REQUIRED", "CONTROL_GATE_BLOCKED"]);
  try {
    await orchestrator.prepareJobApplication(admitted.job.id, {});
  } catch (error) {
    assertTrue(
      !["SHORTLIST_ADMISSION_REQUIRED", "SHORTLIST_OVERRIDE_REQUIRED", "SHORTLIST_ADMISSION_BLOCKED"].includes(error?.code),
      `shortlisted admission should pass guard, but got ${error?.code || "unknown"}`
    );
    assertTrue(allowedCodes.has(error?.code) || error?.code === undefined, `unexpected prepare error after guard: ${error?.code || "unknown"}`);
  }

  console.log("validate-discovery-admission: shortlist admission guard and override scenarios passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
