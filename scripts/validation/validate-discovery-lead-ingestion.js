"use strict";

const fs = require("fs");
const path = require("path");
const {
  createLeadRecordContract,
  validateLeadRecordContract,
  createLeadClassificationContract,
  validateLeadClassificationContract,
  createCandidateEligibilityContract,
  validateCandidateEligibilityContract
} = require("../../src/lib/contracts/job-discovery-contracts");
const {
  ingestLeadRecordsToCandidateInputs,
  createDiscoveryIntent,
  importCandidatesToCanonicalListings
} = require("../../src/lib/discovery/job-discovery-pipeline");

function readFixture(fileName) {
  const filePath = path.resolve(process.cwd(), "scripts/fixtures", fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function assertValid(label, validation) {
  if (!validation.ok) {
    throw new Error(`${label} failed: ${validation.errors.join("; ")}`);
  }
}

const fixture = readFixture("discovery-lead-ingestion-fixture.json");

const validLead = createLeadRecordContract({
  leadId: "lead_1",
  source: "feishu",
  sourceUrl: "https://jobs.example.com/1",
  sourceLeadId: "row_1",
  rawTitle: "AI Product Manager",
  rawCompany: "Example",
  rawLocation: "Shanghai",
  rawText: "Apply now for AI PM role with agent workflow responsibilities.",
  fetchMeta: {
    provider: "feishu",
    origin: "fixture",
    docName: "fixture",
    sourceUrl: "https://jobs.example.com/1",
    rowIndex: 1,
    importedAt: new Date().toISOString(),
    rawStatus: "ok"
  }
});
assertValid("leadRecord.valid", validateLeadRecordContract(validLead));

const validClassification = createLeadClassificationContract({
  leadId: "lead_1",
  leadType: "direct_apply",
  confidence: 0.95,
  signals: ["direct_apply_signal"],
  classifiedAt: new Date().toISOString()
});
assertValid("leadClassification.valid", validateLeadClassificationContract(validClassification));

const validEligibility = createCandidateEligibilityContract({
  leadId: "lead_1",
  leadType: "direct_apply",
  eligibleForCandidateInput: true,
  routing: "candidate_input",
  reason: "Lead has minimum fields.",
  warnings: [],
  decidedAt: new Date().toISOString()
});
assertValid("candidateEligibility.valid", validateCandidateEligibilityContract(validEligibility));

const ingested = ingestLeadRecordsToCandidateInputs({
  leads: fixture.leads || [],
  source: "feishu",
  fetchMeta: fixture.fetchMeta || {}
});

assertTrue(
  Array.isArray(ingested.candidateInputs) &&
    ingested.candidateInputs.length === Number(fixture.expected?.candidateInputCount || 0),
  "candidateInputs count mismatch"
);

const eligibleRows = new Set(
  ingested.eligibilityDecisions
    .filter((item) => item.eligibleForCandidateInput)
    .map((item) => item.leadId)
);
assertTrue(eligibleRows.size === 2, "direct_apply and sufficient announcement should be eligible");

const blockedRouting = fixture.expected?.blockedRouting || {};
Object.entries(blockedRouting).forEach(([sourceLeadId, expectedRouting]) => {
  const lead = ingested.leadRecords.find((item) => item.sourceLeadId === sourceLeadId);
  assertTrue(Boolean(lead), `missing lead record for ${sourceLeadId}`);
  const decision = ingested.eligibilityDecisions.find((item) => item.leadId === lead.leadId);
  assertTrue(Boolean(decision), `missing eligibility decision for ${sourceLeadId}`);
  assertTrue(decision.routing === expectedRouting, `${sourceLeadId} routing mismatch`);
  assertTrue(Boolean(decision.reason), `${sourceLeadId} reason must not be empty`);
});

const directLead = ingested.leadRecords.find((item) => item.sourceLeadId === "row_1");
const directDecision = ingested.eligibilityDecisions.find((item) => item.leadId === directLead.leadId);
assertTrue(directDecision.eligibleForCandidateInput === true, "direct_apply should be eligible");

const announcementLead = ingested.leadRecords.find((item) => item.sourceLeadId === "row_2");
const announcementDecision = ingested.eligibilityDecisions.find((item) => item.leadId === announcementLead.leadId);
assertTrue(announcementDecision.eligibleForCandidateInput === true, "sufficient announcement should be eligible");

const intent = createDiscoveryIntent({
  userId: "user_a",
  keywords: ["ai product manager"],
  city: "Shanghai",
  jobType: "full_time"
});
const imported = importCandidatesToCanonicalListings({
  intentId: intent.intentId,
  userId: intent.userId,
  candidates: ingested.candidateInputs
});

assertTrue((imported.listings || []).length === 2, "eligible leads should import into canonical listings");
assertTrue(Boolean(imported.rankingResult), "rankingResult should exist for eligible leads");
assertTrue(Boolean(imported.shortlistResult), "shortlistResult should exist for eligible leads");

console.log(
  "validate-discovery-lead-ingestion: direct_apply and sufficient announcement enter candidate inputs; gateway, mini_program, and incomplete leads are correctly routed away from the canonical chain."
);
