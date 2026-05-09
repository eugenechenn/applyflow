"use strict";

const { createId, nowIso } = require("../utils/id");
const {
  createBrowserApplySessionContract,
  validateBrowserApplySessionContract,
  validateBrowserSessionStatusTransition
} = require("../contracts/browser-apply-contracts");
const { genericHtmlFormAdapter } = require("./adapters/generic-html-form-adapter");
const { ensureSiteAdapterContract } = require("./site-adapter-interface");

function assertStatusTransition(fromStatus, toStatus) {
  const validation = validateBrowserSessionStatusTransition(fromStatus, toStatus);
  if (!validation.ok) {
    const error = new Error(validation.errors.join("; "));
    error.code = "INVALID_BROWSER_SESSION_TRANSITION";
    error.details = { fromStatus, toStatus, errors: validation.errors };
    throw error;
  }
}

function patchSession(session, patch = {}) {
  const previousStatus = session.status;
  const nextStatus = patch.status || previousStatus;
  if (nextStatus !== previousStatus) {
    assertStatusTransition(previousStatus, nextStatus);
  }
  const next = createBrowserApplySessionContract({
    ...session,
    ...patch,
    updatedAt: nowIso()
  });
  const validation = validateBrowserApplySessionContract(next);
  if (!validation.ok) {
    const error = new Error(`Invalid BrowserApplySession: ${validation.errors.join("; ")}`);
    error.code = "INVALID_BROWSER_SESSION_CONTRACT";
    error.details = { errors: validation.errors, session: next };
    throw error;
  }
  return next;
}

function normalizeFieldResults(entries = []) {
  return Array.isArray(entries) ? entries : [];
}

function buildReviewReason({ detectResult, fillResult }) {
  if (!detectResult.detected) {
    return detectResult.blockedReasons?.join("; ") || "No compatible form detected.";
  }
  if (fillResult.hasErrors) {
    return "Some mapped fields failed and require manual review.";
  }
  return "Manual review is required before confirm.";
}

function shouldEnterReviewRequired({ detectResult, fillResult, fieldFillResults }) {
  if (!detectResult.detected) return true;
  if (fillResult.hasErrors) return true;
  const missingOrUnsupportedCount = (fieldFillResults || []).filter(
    (entry) => entry.outcome === "missing" || entry.outcome === "unsupported"
  ).length;
  return missingOrUnsupportedCount > 0;
}

async function runGenericHtmlFormSession({
  bridgeInput = {},
  adapter = genericHtmlFormAdapter,
  page = null,
  sessionId = "",
  listingId = "",
  trace = {}
} = {}) {
  ensureSiteAdapterContract(adapter);

  let session = createBrowserApplySessionContract({
    sessionId: sessionId || createId("browser_session"),
    jobId: bridgeInput.jobId || "",
    listingId: listingId || bridgeInput.listingId || "",
    targetUrl: bridgeInput.targetUrl || "",
    status: "created",
    supportedAdapter: adapter.descriptor.adapterId,
    fieldFillResults: [],
    artifacts: {},
    confirmState: bridgeInput.confirmState || "pending",
    gateStatus: bridgeInput.gateStatus || "unknown",
    trace: {
      runId: bridgeInput.runId || "",
      source: trace.source || "browser_apply_session_runner.v1",
      adapterVersion: adapter.descriptor.version || "v1",
      actor: trace.actor || "system"
    }
  });

  const context = { bridgeInput, page, targetUrl: bridgeInput.targetUrl };

  session = patchSession(session, { status: "page_loaded" });
  const detectResult = await adapter.detect(context);

  if (!detectResult.detected) {
    const evidence = await adapter.collectEvidence({ ...context, detectResult });
    session = patchSession(session, {
      status: "review_required",
      failureReason: buildReviewReason({ detectResult, fillResult: { hasErrors: false } }),
      artifacts: evidence.artifacts || {}
    });
    return { session, detectResult, mapResult: null, fillResult: null, evidenceResult: evidence };
  }

  session = patchSession(session, { status: "form_detected" });
  const mapResult = await adapter.mapFields({ ...context, detectResult });
  const fillResult = await adapter.fill({ ...context, detectResult, mapResult });
  const fieldFillResults = normalizeFieldResults(fillResult.fieldFillResults);
  const evidenceResult = await adapter.collectEvidence({ ...context, detectResult, mapResult, fillResult });

  session = patchSession(session, {
    status: "prefilled",
    fieldFillResults,
    artifacts: evidenceResult.artifacts || {}
  });

  const reviewRequired = shouldEnterReviewRequired({
    detectResult,
    fillResult,
    fieldFillResults
  });

  session = patchSession(session, {
    status: reviewRequired ? "review_required" : "ready_for_confirm",
    failureReason: reviewRequired ? buildReviewReason({ detectResult, fillResult }) : ""
  });

  return { session, detectResult, mapResult, fillResult, evidenceResult };
}

module.exports = {
  runGenericHtmlFormSession
};

