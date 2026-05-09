"use strict";

const { cleanLine, uniqueLines } = require("../contracts/canonical-resume-contracts");
const {
  createBrowserApplySessionContract,
  validateBrowserApplySessionContract
} = require("../contracts/browser-apply-contracts");

const BRIDGE_NEXT_ACTIONS = ["continue_browser", "request_human_confirm", "submit_blocked", "ready_for_submit"];

function asText(value = "", max = 320) {
  return cleanLine(value, max);
}

function asTextList(values = [], max = 10, perItemMax = 220) {
  return uniqueLines(Array.isArray(values) ? values : [], max, perItemMax);
}

function createBrowserExecutionBridgeInput(input = {}) {
  const executionDto = input.executionDto && typeof input.executionDto === "object" ? input.executionDto : {};
  const controlGateResult = input.controlGateResult && typeof input.controlGateResult === "object" ? input.controlGateResult : {};

  return {
    runId: asText(executionDto.runId || "", 120),
    jobId: asText(executionDto.jobId || "", 80),
    listingId: asText(input.listingId || executionDto.admissionContext?.listingId || "", 80),
    targetUrl: asText(executionDto.targetUrl || "", 500),
    executionMode: asText(executionDto.executionMode || "dry-run", 40),
    gateStatus: asText(
      controlGateResult.status || executionDto.gateSnapshot?.status || "unknown",
      40
    ),
    confirmState: asText(executionDto.confirmState?.state || "pending", 40),
    prefillPayload:
      executionDto.prefillPayload && typeof executionDto.prefillPayload === "object" ? executionDto.prefillPayload : {},
    formPayload: executionDto.formPayload && typeof executionDto.formPayload === "object" ? executionDto.formPayload : {},
    requiredActions: asTextList(
      controlGateResult.requiredActions || executionDto.gateSnapshot?.requiredActions || [],
      10,
      220
    ),
    blockingIssues: asTextList(
      controlGateResult.blockingIssues || executionDto.gateSnapshot?.blockingIssues || [],
      10,
      220
    ),
    trace: {
      source: asText(input.trace?.source || "browser_execution_bridge.v1", 120),
      actor: asText(input.trace?.actor || "system", 80)
    },
    createdAt: input.createdAt || new Date().toISOString()
  };
}

function validateBrowserExecutionBridgeInput(bridgeInput = {}) {
  const errors = [];
  if (!bridgeInput || typeof bridgeInput !== "object") errors.push("bridgeInput must be an object");
  if (!bridgeInput.runId) errors.push("runId is required");
  if (!bridgeInput.jobId) errors.push("jobId is required");
  if (!bridgeInput.listingId) errors.push("listingId is required");
  if (!bridgeInput.targetUrl) errors.push("targetUrl is required");
  if (!bridgeInput.gateStatus) errors.push("gateStatus is required");
  if (!bridgeInput.confirmState) errors.push("confirmState is required");
  if (!Array.isArray(bridgeInput.requiredActions)) errors.push("requiredActions must be an array");
  if (!Array.isArray(bridgeInput.blockingIssues)) errors.push("blockingIssues must be an array");
  return { ok: errors.length === 0, errors };
}

function createBrowserExecutionBridgeResult(input = {}) {
  const session = createBrowserApplySessionContract(input.session || {});
  const bridgeInput = input.bridgeInput && typeof input.bridgeInput === "object" ? input.bridgeInput : {};
  const submitEligible =
    session.status === "confirmed" &&
    session.confirmState === "confirmed" &&
    session.gateStatus === "allowed" &&
    bridgeInput.gateStatus === "allowed" &&
    bridgeInput.confirmState === "confirmed";

  const nextAction = submitEligible
    ? "ready_for_submit"
    : session.status === "submit_blocked" || bridgeInput.gateStatus === "blocked"
      ? "submit_blocked"
      : session.status === "ready_for_confirm" || bridgeInput.confirmState !== "confirmed"
        ? "request_human_confirm"
        : "continue_browser";

  return {
    runId: asText(bridgeInput.runId || session.trace?.runId || "", 120),
    jobId: asText(bridgeInput.jobId || session.jobId || "", 80),
    listingId: asText(bridgeInput.listingId || session.listingId || "", 80),
    sessionId: asText(session.sessionId || "", 120),
    sessionStatus: asText(session.status || "", 40),
    gateStatus: asText(session.gateStatus || bridgeInput.gateStatus || "unknown", 40),
    confirmState: asText(session.confirmState || bridgeInput.confirmState || "pending", 40),
    nextAction,
    submitEligible,
    blockingIssues: asTextList(bridgeInput.blockingIssues || [], 10, 220),
    requiredActions: asTextList(bridgeInput.requiredActions || [], 10, 220),
    failureReason: asText(session.failureReason || "", 500),
    trace: {
      source: asText(input.trace?.source || "browser_execution_bridge.v1", 120),
      sessionSource: asText(session.trace?.source || "", 120)
    },
    createdAt: input.createdAt || new Date().toISOString()
  };
}

function validateBrowserExecutionBridgeResult(result = {}) {
  const errors = [];
  if (!result || typeof result !== "object") errors.push("bridgeResult must be an object");
  if (!result.runId) errors.push("runId is required");
  if (!result.jobId) errors.push("jobId is required");
  if (!result.listingId) errors.push("listingId is required");
  if (!result.sessionId) errors.push("sessionId is required");
  if (!BRIDGE_NEXT_ACTIONS.includes(result.nextAction)) errors.push("nextAction is invalid");
  if (typeof result.submitEligible !== "boolean") errors.push("submitEligible must be a boolean");
  if (!Array.isArray(result.blockingIssues)) errors.push("blockingIssues must be an array");
  if (!Array.isArray(result.requiredActions)) errors.push("requiredActions must be an array");
  if (result.submitEligible && result.nextAction !== "ready_for_submit") {
    errors.push("nextAction must be ready_for_submit when submitEligible=true");
  }
  if (result.nextAction === "ready_for_submit" && result.submitEligible !== true) {
    errors.push("submitEligible must be true when nextAction=ready_for_submit");
  }
  return { ok: errors.length === 0, errors };
}

function assertBrowserSubmitEligibility(bridgeResult = {}) {
  const validation = validateBrowserExecutionBridgeResult(bridgeResult);
  if (!validation.ok) {
    const error = new Error(`Invalid browser bridge result: ${validation.errors.join("; ")}`);
    error.code = "INVALID_BROWSER_BRIDGE_RESULT";
    error.details = { errors: validation.errors };
    throw error;
  }
  if (!bridgeResult.submitEligible) {
    const error = new Error("Submit is blocked: browser session has not met confirm/gate requirements.");
    error.code = "BROWSER_SUBMIT_NOT_ELIGIBLE";
    error.details = { bridgeResult };
    throw error;
  }
}

function validateBrowserBridgeBoundary({ bridgeInput, session, bridgeResult } = {}) {
  const errors = [];
  const bridgeInputValidation = validateBrowserExecutionBridgeInput(bridgeInput || {});
  if (!bridgeInputValidation.ok) {
    errors.push(...bridgeInputValidation.errors.map((error) => `bridgeInput.${error}`));
  }

  const sessionValidation = validateBrowserApplySessionContract(session || {});
  if (!sessionValidation.ok) {
    errors.push(...sessionValidation.errors.map((error) => `session.${error}`));
  }

  const bridgeResultValidation = validateBrowserExecutionBridgeResult(bridgeResult || {});
  if (!bridgeResultValidation.ok) {
    errors.push(...bridgeResultValidation.errors.map((error) => `bridgeResult.${error}`));
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  BRIDGE_NEXT_ACTIONS,
  createBrowserExecutionBridgeInput,
  validateBrowserExecutionBridgeInput,
  createBrowserExecutionBridgeResult,
  validateBrowserExecutionBridgeResult,
  assertBrowserSubmitEligibility,
  validateBrowserBridgeBoundary
};

