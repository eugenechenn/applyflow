"use strict";

const store = require("../../server/store");
const { createId, nowIso } = require("../utils/id");
const {
  createFeedbackContract,
  validateFeedbackContract
} = require("../contracts/agent-governance-contracts");

function pickDecisionSnapshot(jobDecision = null) {
  if (!jobDecision || typeof jobDecision !== "object") {
    return {
      recommendation: "",
      risks: [],
      nextAction: ""
    };
  }

  return {
    recommendation: String(jobDecision.recommendation || "").trim(),
    risks: Array.isArray(jobDecision.risks) ? jobDecision.risks : [],
    nextAction: String(jobDecision.nextAction || "").trim()
  };
}

function pickControlSnapshot(controlGateResult = null) {
  if (!controlGateResult || typeof controlGateResult !== "object") {
    return {
      status: "",
      blockingIssues: [],
      requiredActions: []
    };
  }

  return {
    status: String(controlGateResult.status || "").trim(),
    blockingIssues: Array.isArray(controlGateResult.blockingIssues) ? controlGateResult.blockingIssues : [],
    requiredActions: Array.isArray(controlGateResult.requiredActions) ? controlGateResult.requiredActions : []
  };
}

function sanitizeFailureReason(reason = "") {
  const text = String(reason || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/fallback|debug|stack|trace|console\./i.test(text)) {
    return "Execution failed with internal error.";
  }
  return text.slice(0, 400);
}

function recordFeedbackTrace({
  jobId,
  decisionId = "",
  controlId = "",
  eventType,
  outcome,
  actor = "system",
  jobDecision = null,
  controlGateResult = null,
  executionSnapshot = null,
  failureReason = "",
  userOverride = null,
  notes = "",
  metadata = {},
  runId = "",
  source = "workflow_controller"
} = {}) {
  const traceId = createId("trace");
  const feedback = createFeedbackContract({
    feedbackId: createId("feedback"),
    jobId,
    decisionId,
    controlId,
    eventType,
    outcome,
    decisionSnapshot: pickDecisionSnapshot(jobDecision),
    controlSnapshot: pickControlSnapshot(controlGateResult),
    executionSnapshot: executionSnapshot || { stage: "", status: "", details: "" },
    failureReason: sanitizeFailureReason(failureReason),
    userOverride: userOverride || { applied: false, action: "", reason: "" },
    actor,
    notes,
    metadata,
    trace: {
      source,
      runId,
      traceId
    },
    recordedAt: nowIso()
  });

  const validation = validateFeedbackContract(feedback);
  if (!validation.ok) {
    const error = new Error(`Invalid FeedbackTrace contract: ${validation.errors.join("; ")}`);
    error.code = "INVALID_FEEDBACK_TRACE_CONTRACT";
    error.details = { errors: validation.errors, feedback };
    throw error;
  }

  store.saveActivityLog({
    id: feedback.feedbackId,
    type: "feedback_trace",
    entityType: "feedback_trace",
    entityId: feedback.feedbackId,
    action: feedback.eventType,
    actor: feedback.actor,
    jobId: feedback.jobId,
    summary: `${feedback.eventType}:${feedback.outcome}`,
    metadata: {
      feedbackTrace: feedback
    },
    timestamp: feedback.recordedAt,
    createdAt: feedback.recordedAt
  });

  return feedback;
}

module.exports = {
  recordFeedbackTrace
};
