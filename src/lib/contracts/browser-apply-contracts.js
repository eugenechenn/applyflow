"use strict";

const { cleanLine, uniqueLines, hasFallbackText } = require("./canonical-resume-contracts");

const BROWSER_SESSION_STATUSES = [
  "created",
  "page_loaded",
  "form_detected",
  "prefilled",
  "review_required",
  "ready_for_confirm",
  "confirmed",
  "submit_blocked",
  "submitted",
  "failed"
];

const BROWSER_CONFIRM_STATES = ["pending", "confirmed", "rejected"];
const BROWSER_GATE_STATUSES = ["allowed", "blocked", "needs_human_review", "unknown"];
const FIELD_FILL_OUTCOMES = ["filled", "missing", "unsupported", "error"];

const ALLOWED_STATUS_TRANSITIONS = {
  created: ["page_loaded", "failed"],
  page_loaded: ["form_detected", "review_required", "failed"],
  form_detected: ["prefilled", "review_required", "failed"],
  prefilled: ["ready_for_confirm", "review_required", "failed"],
  review_required: ["ready_for_confirm", "submit_blocked", "failed"],
  ready_for_confirm: ["confirmed", "submit_blocked", "failed"],
  confirmed: ["submitted", "submit_blocked", "failed"],
  submit_blocked: ["failed"],
  submitted: [],
  failed: []
};

function asText(value = "", max = 320) {
  const text = cleanLine(value, max);
  if (!text || hasFallbackText(text)) return "";
  return text;
}

function asEnum(value = "", allowed = [], fallback = "") {
  const normalized = String(value || "").trim();
  return allowed.includes(normalized) ? normalized : fallback;
}

function asTextList(items = [], max = 10, perItemMax = 320) {
  return uniqueLines(Array.isArray(items) ? items : [], max, perItemMax);
}

function normalizeFieldFillResults(results = []) {
  return (Array.isArray(results) ? results : []).map((entry) => ({
    fieldKey: asText(entry?.fieldKey || "", 120),
    outcome: asEnum(entry?.outcome || "missing", FIELD_FILL_OUTCOMES, "missing"),
    source: asText(entry?.source || "", 120),
    reason: asText(entry?.reason || "", 500)
  }));
}

function normalizeArtifacts(input = {}) {
  const artifacts = input && typeof input === "object" ? input : {};
  return {
    currentUrl: asText(artifacts.currentUrl || "", 500),
    pageTitle: asText(artifacts.pageTitle || "", 200),
    screenshotRefs: asTextList(artifacts.screenshotRefs || [], 8, 500),
    evidenceRefs: asTextList(artifacts.evidenceRefs || [], 10, 500),
    notes: asTextList(artifacts.notes || [], 10, 320)
  };
}

function createBrowserApplySessionContract(input = {}) {
  const status = asEnum(input.status || "created", BROWSER_SESSION_STATUSES, "created");
  const confirmState = asEnum(input.confirmState || "pending", BROWSER_CONFIRM_STATES, "pending");
  const gateStatus = asEnum(input.gateStatus || "unknown", BROWSER_GATE_STATUSES, "unknown");

  return {
    sessionId: asText(input.sessionId || "", 120),
    jobId: asText(input.jobId || "", 80),
    listingId: asText(input.listingId || "", 80),
    targetUrl: asText(input.targetUrl || "", 500),
    status,
    supportedAdapter: asText(input.supportedAdapter || "generic_html_form", 120),
    fieldFillResults: normalizeFieldFillResults(input.fieldFillResults || []),
    artifacts: normalizeArtifacts(input.artifacts),
    confirmState,
    gateStatus,
    failureReason: asText(input.failureReason || "", 500),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
    trace: {
      runId: asText(input.trace?.runId || "", 120),
      source: asText(input.trace?.source || "browser_apply_session.v1", 120),
      adapterVersion: asText(input.trace?.adapterVersion || "v1", 60),
      actor: asText(input.trace?.actor || "system", 80)
    }
  };
}

function validateBrowserApplySessionContract(contract = {}) {
  const errors = [];
  if (!contract || typeof contract !== "object") errors.push("browserApplySession must be an object");
  if (!contract.sessionId) errors.push("sessionId is required");
  if (!contract.jobId) errors.push("jobId is required");
  if (!contract.listingId) errors.push("listingId is required");
  if (!contract.targetUrl) errors.push("targetUrl is required");
  if (!BROWSER_SESSION_STATUSES.includes(contract.status)) errors.push("status is invalid");
  if (!BROWSER_CONFIRM_STATES.includes(contract.confirmState)) errors.push("confirmState is invalid");
  if (!BROWSER_GATE_STATUSES.includes(contract.gateStatus)) errors.push("gateStatus is invalid");
  if (!contract.supportedAdapter) errors.push("supportedAdapter is required");
  if (!Array.isArray(contract.fieldFillResults)) {
    errors.push("fieldFillResults must be an array");
  } else {
    contract.fieldFillResults.forEach((entry, index) => {
      if (!entry.fieldKey) errors.push(`fieldFillResults[${index}].fieldKey is required`);
      if (!FIELD_FILL_OUTCOMES.includes(entry.outcome)) {
        errors.push(`fieldFillResults[${index}].outcome is invalid`);
      }
    });
  }
  if (!contract.artifacts || typeof contract.artifacts !== "object") {
    errors.push("artifacts must be an object");
  }
  if (!contract.trace || typeof contract.trace !== "object") errors.push("trace must be an object");

  if (contract.status === "submitted" && contract.confirmState !== "confirmed") {
    errors.push("confirmState must be confirmed when status=submitted");
  }
  if (contract.status === "submitted" && contract.gateStatus !== "allowed") {
    errors.push("gateStatus must be allowed when status=submitted");
  }
  if (contract.status === "confirmed" && contract.confirmState !== "confirmed") {
    errors.push("confirmState must be confirmed when status=confirmed");
  }
  if (contract.status === "submit_blocked" && !contract.failureReason) {
    errors.push("failureReason is required when status=submit_blocked");
  }

  return { ok: errors.length === 0, errors };
}

function validateBrowserSessionStatusTransition(fromStatus, toStatus) {
  const from = asEnum(fromStatus, BROWSER_SESSION_STATUSES, "");
  const to = asEnum(toStatus, BROWSER_SESSION_STATUSES, "");
  if (!from || !to) {
    return { ok: false, errors: ["status transition contains invalid status"] };
  }
  const allowedTransitions = ALLOWED_STATUS_TRANSITIONS[from] || [];
  if (!allowedTransitions.includes(to)) {
    return { ok: false, errors: [`illegal status transition: ${from} -> ${to}`] };
  }
  return { ok: true, errors: [] };
}

module.exports = {
  BROWSER_SESSION_STATUSES,
  BROWSER_CONFIRM_STATES,
  BROWSER_GATE_STATUSES,
  FIELD_FILL_OUTCOMES,
  ALLOWED_STATUS_TRANSITIONS,
  createBrowserApplySessionContract,
  validateBrowserApplySessionContract,
  validateBrowserSessionStatusTransition
};

