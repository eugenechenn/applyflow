"use strict";

const { cleanLine, uniqueLines, hasFallbackText } = require("./canonical-resume-contracts");

const EXECUTION_MODES = ["dry-run", "live"];
const CONFIRM_STATES = ["pending", "confirmed", "rejected"];
const SUBMIT_MODES = ["manual_confirmed", "live_submit"];
const SUBMIT_OUTCOMES = ["submitted", "failed", "blocked"];
const GATE_STATUSES = ["allowed", "blocked", "needs_human_review"];

function asText(value = "", max = 220) {
  const text = cleanLine(value, max);
  if (!text || hasFallbackText(text)) return "";
  return text;
}

function asTextList(items = [], max = 8, perItemMax = 220) {
  return uniqueLines(Array.isArray(items) ? items : [], max, perItemMax);
}

function asEnum(value, allowed = [], fallback) {
  const text = String(value || "").trim();
  return allowed.includes(text) ? text : fallback;
}

function createExecutionDto(input = {}) {
  const executionMode = asEnum(input.executionMode, EXECUTION_MODES, "dry-run");
  const confirmStateValue = asEnum(input.confirmState?.state || input.confirmState, CONFIRM_STATES, "pending");
  const gate = input.gateSnapshot && typeof input.gateSnapshot === "object" ? input.gateSnapshot : {};

  return {
    runId: asText(input.runId || "", 120),
    jobId: asText(input.jobId || "", 80),
    tailoredResumeId: asText(input.tailoredResumeId || "", 80),
    prepDtoId: asText(input.prepDtoId || "", 80),
    prepVersion: Math.max(1, Number(input.prepVersion || 1)),
    gateSnapshot: {
      controlId: asText(gate.controlId || "", 120),
      status: asText(gate.status || "", 40),
      reasons: asTextList(gate.reasons || [], 8, 220),
      blockingIssues: asTextList(gate.blockingIssues || [], 8, 220),
      requiredActions: asTextList(gate.requiredActions || [], 8, 220),
      checkedAt: gate.checkedAt || null
    },
    executionMode,
    confirmState: {
      state: confirmStateValue,
      required: Boolean(input.confirmState?.required),
      confirmToken: asText(input.confirmState?.confirmToken || "", 120),
      confirmedBy: asText(input.confirmState?.confirmedBy || "", 80),
      confirmedAt: input.confirmState?.confirmedAt || null
    },
    targetUrl: asText(input.targetUrl || "", 500),
    prefillPayload: input.prefillPayload && typeof input.prefillPayload === "object" ? input.prefillPayload : {},
    formPayload: input.formPayload && typeof input.formPayload === "object" ? input.formPayload : {},
    auditContext: {
      actor: asText(input.auditContext?.actor || "system", 40),
      source: asText(input.auditContext?.source || "execution_pipeline", 80),
      note: asText(input.auditContext?.note || "", 240)
    },
    admissionContext: {
      admissionId: asText(input.admissionContext?.admissionId || "", 120),
      intentId: asText(input.admissionContext?.intentId || "", 80),
      shortlistId: asText(input.admissionContext?.shortlistId || "", 80),
      listingId: asText(input.admissionContext?.listingId || "", 80),
      admissionStatus: asText(input.admissionContext?.admissionStatus || "", 40),
      admissionBucket: asText(input.admissionContext?.admissionBucket || "", 40),
      selectionReason: asText(input.admissionContext?.selectionReason || "", 320)
    },
    trace: {
      runId: asText(input.trace?.runId || input.runId || "", 120),
      source: asText(input.trace?.source || "execution_dto.v1", 120),
      createdBy: asText(input.trace?.createdBy || "system", 80)
    },
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

function validateExecutionDto(dto = {}) {
  const errors = [];
  if (!dto || typeof dto !== "object") errors.push("executionDto must be an object");
  if (!dto.runId) errors.push("runId is required");
  if (!dto.jobId) errors.push("jobId is required");
  if (!dto.tailoredResumeId) errors.push("tailoredResumeId is required");
  if (!dto.prepDtoId) errors.push("prepDtoId is required");
  if (!EXECUTION_MODES.includes(dto.executionMode)) errors.push("executionMode is invalid");
  if (!dto.gateSnapshot || typeof dto.gateSnapshot !== "object") {
    errors.push("gateSnapshot must be an object");
  } else {
    if (!dto.gateSnapshot.controlId) errors.push("gateSnapshot.controlId is required");
    if (!GATE_STATUSES.includes(dto.gateSnapshot.status)) {
      errors.push("gateSnapshot.status is invalid");
    }
    if (!Array.isArray(dto.gateSnapshot.reasons)) errors.push("gateSnapshot.reasons must be an array");
    if (!Array.isArray(dto.gateSnapshot.blockingIssues)) errors.push("gateSnapshot.blockingIssues must be an array");
    if (!Array.isArray(dto.gateSnapshot.requiredActions)) errors.push("gateSnapshot.requiredActions must be an array");
  }
  if (!dto.confirmState || typeof dto.confirmState !== "object") {
    errors.push("confirmState must be an object");
  } else if (!CONFIRM_STATES.includes(dto.confirmState.state)) {
    errors.push("confirmState.state is invalid");
  }
  if (!dto.auditContext || typeof dto.auditContext !== "object") errors.push("auditContext must be an object");
  if (!dto.admissionContext || typeof dto.admissionContext !== "object") {
    errors.push("admissionContext must be an object");
  }
  return { ok: errors.length === 0, errors };
}

function createSubmitContract(input = {}) {
  const submitMode = asEnum(input.submitMode, SUBMIT_MODES, "manual_confirmed");
  const outcome = asEnum(input.outcome, SUBMIT_OUTCOMES, "submitted");
  const gate = input.gateSnapshot && typeof input.gateSnapshot === "object" ? input.gateSnapshot : {};

  return {
    submitId: asText(input.submitId || "", 120),
    runId: asText(input.runId || "", 120),
    jobId: asText(input.jobId || "", 80),
    tailoredResumeId: asText(input.tailoredResumeId || "", 80),
    prepVersion: Math.max(1, Number(input.prepVersion || 1)),
    gateSnapshot: {
      controlId: asText(gate.controlId || "", 120),
      status: asText(gate.status || "", 40),
      blockingIssues: asTextList(gate.blockingIssues || [], 8, 220),
      requiredActions: asTextList(gate.requiredActions || [], 8, 220),
      checkedAt: gate.checkedAt || null
    },
    confirmToken: asText(input.confirmToken || "", 120),
    confirmState: asEnum(input.confirmState, CONFIRM_STATES, "pending"),
    submitMode,
    outcome,
    failureReason: asText(input.failureReason || "", 300),
    submittedAt: input.submittedAt || new Date().toISOString(),
    trace: {
      runId: asText(input.trace?.runId || input.runId || "", 120),
      source: asText(input.trace?.source || "submit_contract.v1", 120)
    }
  };
}

function validateSubmitContract(contract = {}) {
  const errors = [];
  if (!contract || typeof contract !== "object") errors.push("submitContract must be an object");
  if (!contract.submitId) errors.push("submitId is required");
  if (!contract.runId) errors.push("runId is required");
  if (!contract.jobId) errors.push("jobId is required");
  if (!contract.tailoredResumeId) errors.push("tailoredResumeId is required");
  if (!SUBMIT_MODES.includes(contract.submitMode)) errors.push("submitMode is invalid");
  if (!SUBMIT_OUTCOMES.includes(contract.outcome)) errors.push("outcome is invalid");
  if (!CONFIRM_STATES.includes(contract.confirmState)) errors.push("confirmState is invalid");
  if (!contract.gateSnapshot || typeof contract.gateSnapshot !== "object") {
    errors.push("gateSnapshot must be an object");
  } else {
    if (!contract.gateSnapshot.controlId) errors.push("gateSnapshot.controlId is required");
    if (!GATE_STATUSES.includes(contract.gateSnapshot.status)) {
      errors.push("gateSnapshot.status is invalid");
    }
    if (!Array.isArray(contract.gateSnapshot.blockingIssues)) errors.push("gateSnapshot.blockingIssues must be an array");
    if (!Array.isArray(contract.gateSnapshot.requiredActions)) errors.push("gateSnapshot.requiredActions must be an array");
  }
  if (contract.outcome === "submitted" && contract.confirmState !== "confirmed") {
    errors.push("confirmState must be confirmed when outcome is submitted");
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  EXECUTION_MODES,
  CONFIRM_STATES,
  SUBMIT_MODES,
  SUBMIT_OUTCOMES,
  createExecutionDto,
  validateExecutionDto,
  createSubmitContract,
  validateSubmitContract
};
