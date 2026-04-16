const store = require("../../server/store");
const { createId, nowIso } = require("../utils/id");

function logActivity({
  entityType,
  entityId,
  action,
  type,
  actor = "system",
  jobId,
  summary,
  metadata,
  agentName,
  inputSummary,
  outputSummary,
  decisionReason,
  policyInfluenceSummary,
  decisionBreakdown,
  activePolicyVersion,
  policyProposalId,
  overrideApplied,
  overrideSummary
}) {
  const timestamp = nowIso();
  return store.saveActivityLog({
    id: createId("log"),
    type: type || action,
    entityType,
    entityId,
    action,
    actor,
    jobId: jobId || metadata?.jobId || (entityType === "job" ? entityId : null),
    summary,
    agentName: agentName || null,
    inputSummary: inputSummary || null,
    outputSummary: outputSummary || null,
    decisionReason: decisionReason || null,
    policyInfluenceSummary: policyInfluenceSummary || null,
    decisionBreakdown: decisionBreakdown || null,
    activePolicyVersion: activePolicyVersion || null,
    policyProposalId: policyProposalId || null,
    overrideApplied: overrideApplied ?? null,
    overrideSummary: overrideSummary || null,
    metadata,
    createdAt: timestamp,
    timestamp
  });
}

module.exports = { logActivity };
