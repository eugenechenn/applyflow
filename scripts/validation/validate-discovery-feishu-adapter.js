"use strict";

const fs = require("fs");
const path = require("path");
const {
  mapFeishuRawLeadToLeadRecord,
  ingestFeishuRawLeads
} = require("../../src/lib/discovery/feishu-lead-adapter");
const { createDiscoveryIntent, importCandidatesToCanonicalListings } = require("../../src/lib/discovery/job-discovery-pipeline");

function readFixture(fileName) {
  const filePath = path.resolve(process.cwd(), "scripts/fixtures", fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

const fixture = readFixture("discovery-feishu-adapter-fixture.json");

const mappedLead = mapFeishuRawLeadToLeadRecord(fixture.leads[0], {
  ...fixture.fetchMeta,
  rowIndex: 1
});
assertTrue(mappedLead.source === "feishu", "mapped lead source must be feishu");
assertTrue(mappedLead.fetchMeta.provider === "feishu", "fetchMeta.provider must be feishu");
assertTrue(Boolean(mappedLead.fetchMeta.importedAt), "fetchMeta.importedAt is required");
assertTrue(Boolean(mappedLead.fetchMeta.sourceUrl), "fetchMeta.sourceUrl is required");
assertTrue(Array.isArray(mappedLead.rawImagesMeta), "rawImagesMeta must be structured array");
assertTrue(Array.isArray(mappedLead.rawAttachmentsMeta), "rawAttachmentsMeta must be structured array");

const ingested = ingestFeishuRawLeads({
  leads: fixture.leads || [],
  fetchMeta: fixture.fetchMeta || {}
});

assertTrue(Array.isArray(ingested.leadRecords) && ingested.leadRecords.length === 6, "all feishu leads should become lead records");
assertTrue(Array.isArray(ingested.classifications) && ingested.classifications.length === 6, "all feishu leads should be classified");
assertTrue(Array.isArray(ingested.eligibilityDecisions) && ingested.eligibilityDecisions.length === 6, "all feishu leads should have eligibility decisions");

const bySourceLeadId = (sourceLeadId) => {
  const lead = ingested.leadRecords.find((item) => item.sourceLeadId === sourceLeadId);
  const classification = ingested.classifications.find((item) => item.leadId === lead?.leadId);
  const decision = ingested.eligibilityDecisions.find((item) => item.leadId === lead?.leadId);
  return { lead, classification, decision };
};

const directApply = bySourceLeadId("feishu_row_1");
assertTrue(directApply.classification?.leadType === "direct_apply", "direct_apply link should classify as direct_apply");
assertTrue(directApply.decision?.eligibleForCandidateInput === true, "direct_apply should be eligible");

const announcement = bySourceLeadId("feishu_row_2");
assertTrue(announcement.classification?.leadType === "announcement", "announcement should classify as announcement");
assertTrue(announcement.decision?.eligibleForCandidateInput === true, "sufficient announcement should be eligible");

const miniProgram = bySourceLeadId("feishu_row_3");
assertTrue(miniProgram.classification?.leadType === "mini_program_apply", "qr description should classify as mini_program_apply");
assertTrue(miniProgram.decision?.routing === "manual_followup_required", "mini program lead should be blocked to manual followup");

const emailApply = bySourceLeadId("feishu_row_4");
assertTrue(emailApply.classification?.leadType === "email_apply", "email lead should classify as email_apply");
assertTrue(emailApply.decision?.routing === "email_apply_reserved", "email lead should be reserved");

const imageHeavy = bySourceLeadId("feishu_row_5");
assertTrue(imageHeavy.classification?.leadType === "incomplete", "image-heavy lead without text should stay incomplete");
assertTrue(imageHeavy.decision?.routing === "manual_enrich_queue", "image-heavy lead should route to manual enrich queue");

const gateway = bySourceLeadId("feishu_row_6");
assertTrue(gateway.classification?.leadType === "gateway_link", "gateway lead should classify as gateway_link");
assertTrue(gateway.decision?.routing === "manual_followup_required", "gateway lead should route to manual followup");

assertTrue(ingested.candidateInputs.length === 2, "only direct_apply and sufficient announcement should become candidate inputs");

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

assertTrue((imported.listings || []).length === 2, "eligible feishu leads should import into canonical listings");
assertTrue(Boolean(imported.rankingResult), "ranking result should exist");
assertTrue(Boolean(imported.shortlistResult), "shortlist result should exist");

console.log(
  "validate-discovery-feishu-adapter: feishu raw leads map into lead records, reuse classification + eligibility, and only eligible leads enter the canonical discovery chain."
);
