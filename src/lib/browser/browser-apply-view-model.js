"use strict";

function toText(value = "", max = 500) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function summarizeFieldFillResults(fieldFillResults = []) {
  const safe = Array.isArray(fieldFillResults) ? fieldFillResults : [];
  const fillableFields = [];
  const filledFields = [];
  const unfilledFields = [];
  const unsupportedFields = [];

  safe.forEach((entry) => {
    const fieldKey = toText(entry?.fieldKey || "", 120);
    const outcome = toText(entry?.outcome || "", 40);
    if (!fieldKey) return;
    fillableFields.push(fieldKey);
    if (outcome === "filled") filledFields.push(fieldKey);
    if (outcome === "missing" || outcome === "error") unfilledFields.push(fieldKey);
    if (outcome === "unsupported") unsupportedFields.push(fieldKey);
  });

  return {
    fillableFields: [...new Set(fillableFields)],
    filledFields: [...new Set(filledFields)],
    unfilledFields: [...new Set(unfilledFields)],
    unsupportedFields: [...new Set(unsupportedFields)]
  };
}

function buildBrowserApplyViewModel(input = {}) {
  const session = input.session && typeof input.session === "object" ? input.session : {};
  const bridgeResult = input.bridgeResult && typeof input.bridgeResult === "object" ? input.bridgeResult : {};
  const summary = summarizeFieldFillResults(session.fieldFillResults || []);

  return {
    sessionId: toText(session.sessionId || "", 120),
    jobId: toText(session.jobId || "", 80),
    listingId: toText(session.listingId || "", 80),
    targetUrl: toText(session.targetUrl || "", 500),
    status: toText(session.status || "created", 40),
    supportedAdapter: toText(session.supportedAdapter || "", 120),
    fieldSummary: summary,
    gateStatus: toText(session.gateStatus || bridgeResult.gateStatus || "unknown", 40),
    confirmState: toText(session.confirmState || bridgeResult.confirmState || "pending", 40),
    blockingReason: toText(session.failureReason || bridgeResult.failureReason || "", 500),
    requiredActions: Array.isArray(bridgeResult.requiredActions) ? bridgeResult.requiredActions : [],
    nextAction: toText(bridgeResult.nextAction || "continue_browser", 40),
    submitEligible: Boolean(bridgeResult.submitEligible),
    warnings: Array.isArray(session.artifacts?.notes) ? session.artifacts.notes : [],
    updatedAt: session.updatedAt || bridgeResult.createdAt || ""
  };
}

module.exports = {
  buildBrowserApplyViewModel
};

