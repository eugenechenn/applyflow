const { logActivity } = require("./activity-logger");

async function runAgentStage({
  stageKey,
  stageLabel,
  agentName,
  entityType = "job",
  entityId,
  jobId,
  inputSummary,
  decisionReason,
  activePolicyVersion,
  policyProposalId,
  overrideApplied,
  overrideSummary
}, executor) {
  try {
    const result = await executor();
    const fallbackUsed = Boolean(result?.llmMeta?.fallbackUsed || result?.importMeta?.fallbackUsed || result?.fallbackUsed);
    const stageStatus = fallbackUsed ? "fallback" : "completed";

    logActivity({
      type: "agent_stage_completed",
      entityType,
      entityId: entityId || jobId || stageKey,
      action: "agent_stage_completed",
      jobId,
      summary: `${stageLabel} ${fallbackUsed ? "completed with fallback" : "completed"}.`,
      metadata: {
        stageKey,
        stageLabel,
        stageStatus,
        fallbackUsed
      },
      agentName,
      inputSummary,
      outputSummary: result?.stageOutputSummary || result?.decisionSummary || result?.strategyReasoning || null,
      decisionReason: result?.stageDecisionReason || decisionReason || null,
      policyInfluenceSummary: result?.policyInfluenceSummary || null,
      decisionBreakdown: result?.decisionBreakdown || null,
      activePolicyVersion: activePolicyVersion || result?.activePolicyVersion || null,
      policyProposalId: policyProposalId || result?.policyProposalId || null,
      overrideApplied: overrideApplied ?? result?.overrideApplied ?? null,
      overrideSummary: overrideSummary || result?.overrideSummary || null
    });

    return {
      ok: true,
      status: stageStatus,
      result
    };
  } catch (error) {
    logActivity({
      type: "agent_stage_failed",
      entityType,
      entityId: entityId || jobId || stageKey,
      action: "agent_stage_failed",
      jobId,
      summary: `${stageLabel} failed: ${error.message}`,
      metadata: {
        stageKey,
        stageLabel,
        stageStatus: "failed",
        errorCode: error.code || "UNKNOWN_ERROR"
      },
      agentName,
      inputSummary,
      outputSummary: null,
      decisionReason: `The stage failed and can be retried. ${error.message}`,
      activePolicyVersion: activePolicyVersion || null,
      policyProposalId: policyProposalId || null,
      overrideApplied: overrideApplied ?? null,
      overrideSummary: overrideSummary || null
    });
    throw error;
  }
}

module.exports = {
  runAgentStage
};
