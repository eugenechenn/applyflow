"use strict";

const RECOMMEND_ACTIONS = ["apply", "cautious", "skip"];
const DECISION_NEXT_ACTIONS = ["apply", "collect_info", "hold", "skip"];
const CONTROL_GATE_STATUSES = ["allowed", "blocked", "needs_human_review"];
const FEEDBACK_EVENT_TYPES = [
  "decision_generated",
  "control_evaluated",
  "execution_prepared",
  "execution_dry_run",
  "execution_confirmed",
  "execution_blocked",
  "execution_submitted",
  "execution_failed",
  "user_override"
];
const FEEDBACK_OUTCOMES = ["succeeded", "blocked", "failed", "overridden", "observed"];
const FALLBACK_TEXT_PATTERN =
  /建议人工补充确认|建议人工确认|暂无可展示|fallback|回退结果|completed with fallback/i;

function nowIso() {
  return new Date().toISOString();
}

function asString(value, fallback = "") {
  return String(value || fallback).trim();
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function uniqueList(items = [], max = 8, itemMax = 220) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => asString(item).slice(0, itemMax))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

function assertEnum(value, enumValues, fallback) {
  const safe = asString(value);
  if (enumValues.includes(safe)) return safe;
  return fallback;
}

function createDecisionContract(input = {}) {
  const recommendation = assertEnum(input.recommendation, RECOMMEND_ACTIONS, "cautious");
  const nextAction = assertEnum(input.nextAction, DECISION_NEXT_ACTIONS, "hold");

  return {
    decisionId: asString(input.decisionId || input.id || ""),
    jobId: asString(input.jobId || ""),
    userId: asString(input.userId || ""),
    fitScore: Math.max(0, Math.min(100, asNumber(input.fitScore, 0))),
    recommendation,
    evidence: uniqueList(input.evidence || input.reasons || [], 8, 220),
    gaps: uniqueList(input.gaps || [], 8, 220),
    risks: uniqueList(input.risks || input.riskFlags || [], 8, 220),
    nextAction,
    rationale: asString(input.rationale || "").slice(0, 500),
    confidence: Math.max(0, Math.min(1, asNumber(input.confidence, 0.5))),
    trace: {
      source: asString(input.trace?.source || "decision_engine"),
      model: asString(input.trace?.model || ""),
      version: asString(input.trace?.version || "v1"),
      runId: asString(input.trace?.runId || "")
    },
    decidedAt: asString(input.decidedAt || nowIso())
  };
}

function createControlContract(input = {}) {
  const status = assertEnum(input.status || input.gateStatus, CONTROL_GATE_STATUSES, "needs_human_review");

  return {
    controlId: asString(input.controlId || input.id || ""),
    decisionId: asString(input.decisionId || ""),
    jobId: asString(input.jobId || ""),
    status,
    reasons: uniqueList(input.reasons || [], 8, 220),
    blockingIssues: uniqueList(input.blockingIssues || [], 8, 220),
    requiredActions: uniqueList(input.requiredActions || [], 8, 120),
    sourceDecision: {
      recommendation: asString(input.sourceDecision?.recommendation || input.recommendation || ""),
      nextAction: asString(input.sourceDecision?.nextAction || input.nextAction || ""),
      fitScore: Math.max(0, Math.min(100, asNumber(input.sourceDecision?.fitScore ?? input.fitScore, 0))),
      risks: uniqueList(input.sourceDecision?.risks || input.risks || [], 8, 220),
      gaps: uniqueList(input.sourceDecision?.gaps || input.gaps || [], 8, 220)
    },
    trace: {
      source: asString(input.trace?.source || "control_layer"),
      version: asString(input.trace?.version || "control-gate.v1"),
      runId: asString(input.trace?.runId || input.decisionId || "")
    },
    policyVersion: asString(input.policyVersion || "control.v1"),
    checkedAt: asString(input.checkedAt || input.timestamp || nowIso())
  };
}

function createFeedbackContract(input = {}) {
  const fallbackFreeFailureReason = asString(input.failureReason || "").slice(0, 400);
  const userOverrideInput = input.userOverride && typeof input.userOverride === "object" ? input.userOverride : {};

  return {
    feedbackId: asString(input.feedbackId || input.id || ""),
    jobId: asString(input.jobId || ""),
    decisionId: asString(input.decisionId || ""),
    controlId: asString(input.controlId || ""),
    eventType: assertEnum(input.eventType, FEEDBACK_EVENT_TYPES, "execution_failed"),
    outcome: assertEnum(input.outcome, FEEDBACK_OUTCOMES, "observed"),
    decisionSnapshot:
      input.decisionSnapshot && typeof input.decisionSnapshot === "object"
        ? {
            recommendation: asString(input.decisionSnapshot.recommendation || ""),
            risks: uniqueList(input.decisionSnapshot.risks || [], 8, 220),
            nextAction: asString(input.decisionSnapshot.nextAction || "")
          }
        : {
            recommendation: "",
            risks: [],
            nextAction: ""
          },
    controlSnapshot:
      input.controlSnapshot && typeof input.controlSnapshot === "object"
        ? {
            status: asString(input.controlSnapshot.status || ""),
            blockingIssues: uniqueList(input.controlSnapshot.blockingIssues || [], 8, 220),
            requiredActions: uniqueList(input.controlSnapshot.requiredActions || [], 8, 220)
          }
        : {
            status: "",
            blockingIssues: [],
            requiredActions: []
          },
    executionSnapshot:
      input.executionSnapshot && typeof input.executionSnapshot === "object"
        ? {
            stage: asString(input.executionSnapshot.stage || ""),
            status: asString(input.executionSnapshot.status || ""),
            details: asString(input.executionSnapshot.details || "").slice(0, 500)
          }
        : {
            stage: "",
            status: "",
            details: ""
          },
    failureReason: FALLBACK_TEXT_PATTERN.test(fallbackFreeFailureReason) ? "" : fallbackFreeFailureReason,
    userOverride: {
      applied: Boolean(userOverrideInput.applied),
      action: asString(userOverrideInput.action || ""),
      reason: asString(userOverrideInput.reason || "").slice(0, 240)
    },
    actor: asString(input.actor || "system"),
    notes: asString(input.notes || "").slice(0, 1000),
    metadata: typeof input.metadata === "object" && input.metadata ? input.metadata : {},
    trace: {
      source: asString(input.trace?.source || "feedback_layer"),
      runId: asString(input.trace?.runId || ""),
      traceId: asString(input.trace?.traceId || input.feedbackId || "")
    },
    recordedAt: asString(input.recordedAt || nowIso())
  };
}

function validateDecisionContract(contract = {}) {
  const errors = [];
  if (!contract.jobId) errors.push("jobId is required");
  if (!RECOMMEND_ACTIONS.includes(contract.recommendation)) errors.push("recommendation is invalid");
  if (!DECISION_NEXT_ACTIONS.includes(contract.nextAction)) errors.push("nextAction is invalid");
  if (!Array.isArray(contract.evidence)) errors.push("evidence must be an array");
  if (!Array.isArray(contract.gaps)) errors.push("gaps must be an array");
  if (!Array.isArray(contract.risks)) errors.push("risks must be an array");
  if (Array.isArray(contract.evidence) && contract.evidence.some((item) => FALLBACK_TEXT_PATTERN.test(String(item || "")))) {
    errors.push("evidence contains fallback text");
  }
  if (Array.isArray(contract.gaps) && contract.gaps.some((item) => FALLBACK_TEXT_PATTERN.test(String(item || "")))) {
    errors.push("gaps contains fallback text");
  }
  if (Array.isArray(contract.risks) && contract.risks.some((item) => FALLBACK_TEXT_PATTERN.test(String(item || "")))) {
    errors.push("risks contains fallback text");
  }
  if (FALLBACK_TEXT_PATTERN.test(String(contract.rationale || ""))) {
    errors.push("rationale contains fallback text");
  }
  return { ok: errors.length === 0, errors };
}

function validateControlContract(contract = {}) {
  const errors = [];
  if (!contract.jobId) errors.push("jobId is required");
  if (!CONTROL_GATE_STATUSES.includes(contract.status)) errors.push("status is invalid");
  if (!Array.isArray(contract.reasons)) errors.push("reasons must be an array");
  if (!Array.isArray(contract.blockingIssues)) errors.push("blockingIssues must be an array");
  if (!Array.isArray(contract.requiredActions)) errors.push("requiredActions must be an array");

  if (Array.isArray(contract.reasons) && contract.reasons.some((item) => FALLBACK_TEXT_PATTERN.test(String(item || "")))) {
    errors.push("reasons contains fallback text");
  }
  if (
    Array.isArray(contract.blockingIssues) &&
    contract.blockingIssues.some((item) => FALLBACK_TEXT_PATTERN.test(String(item || "")))
  ) {
    errors.push("blockingIssues contains fallback text");
  }
  if (
    Array.isArray(contract.requiredActions) &&
    contract.requiredActions.some((item) => FALLBACK_TEXT_PATTERN.test(String(item || "")))
  ) {
    errors.push("requiredActions contains fallback text");
  }

  if (typeof contract.sourceDecision !== "object" || !contract.sourceDecision) {
    errors.push("sourceDecision must be an object");
  } else {
    if (!Array.isArray(contract.sourceDecision.risks)) errors.push("sourceDecision.risks must be an array");
    if (!Array.isArray(contract.sourceDecision.gaps)) errors.push("sourceDecision.gaps must be an array");
  }

  return { ok: errors.length === 0, errors };
}

function validateFeedbackContract(contract = {}) {
  const errors = [];
  if (!contract.jobId) errors.push("jobId is required");
  if (!FEEDBACK_EVENT_TYPES.includes(contract.eventType)) errors.push("eventType is invalid");
  if (!FEEDBACK_OUTCOMES.includes(contract.outcome)) errors.push("outcome is invalid");
  if (!contract.actor) errors.push("actor is required");
  if (typeof contract.decisionSnapshot !== "object" || !contract.decisionSnapshot) {
    errors.push("decisionSnapshot must be an object");
  } else {
    if (!Array.isArray(contract.decisionSnapshot.risks)) errors.push("decisionSnapshot.risks must be an array");
  }
  if (typeof contract.controlSnapshot !== "object" || !contract.controlSnapshot) {
    errors.push("controlSnapshot must be an object");
  } else {
    if (!Array.isArray(contract.controlSnapshot.blockingIssues)) errors.push("controlSnapshot.blockingIssues must be an array");
    if (!Array.isArray(contract.controlSnapshot.requiredActions)) errors.push("controlSnapshot.requiredActions must be an array");
  }
  if (typeof contract.executionSnapshot !== "object" || !contract.executionSnapshot) {
    errors.push("executionSnapshot must be an object");
  }
  if (typeof contract.userOverride !== "object" || !contract.userOverride) {
    errors.push("userOverride must be an object");
  } else if (typeof contract.userOverride.applied !== "boolean") {
    errors.push("userOverride.applied must be a boolean");
  }
  if (FALLBACK_TEXT_PATTERN.test(String(contract.failureReason || ""))) {
    errors.push("failureReason contains fallback text");
  }
  if (/debug|stack trace|console\./i.test(String(contract.failureReason || ""))) {
    errors.push("failureReason contains debug text");
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  RECOMMEND_ACTIONS,
  DECISION_NEXT_ACTIONS,
  CONTROL_GATE_STATUSES,
  FEEDBACK_EVENT_TYPES,
  FEEDBACK_OUTCOMES,
  createDecisionContract,
  createControlContract,
  createFeedbackContract,
  validateDecisionContract,
  validateControlContract,
  validateFeedbackContract
};
