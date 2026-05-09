"use strict";

const { cleanLine, uniqueLines, hasFallbackText } = require("./canonical-resume-contracts");

const JOB_TYPE_ENUM = ["full_time", "part_time", "contract", "intern", "unknown"];
const SENIORITY_ENUM = ["intern", "junior", "mid", "senior", "lead", "manager", "unknown"];
const RISK_TOLERANCE_ENUM = ["low", "medium", "high"];
const LEAD_TYPE_ENUM = [
  "direct_apply",
  "announcement",
  "email_apply",
  "gateway_link",
  "mini_program_apply",
  "incomplete"
];
const LEAD_ROUTING_ENUM = [
  "candidate_input",
  "manual_followup_required",
  "manual_enrich_queue",
  "email_apply_reserved"
];

function asText(value = "", max = 220) {
  const text = cleanLine(value, max);
  if (!text || hasFallbackText(text)) return "";
  return text;
}

function asTextList(items = [], max = 8, perItemMax = 120) {
  return uniqueLines(Array.isArray(items) ? items : [], max, perItemMax);
}

function asEnum(value = "", allowed = [], fallback = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeSalaryRange(range = {}) {
  const source = range && typeof range === "object" ? range : {};
  const min = Number(source.min ?? 0);
  const max = Number(source.max ?? 0);
  return {
    min: Number.isFinite(min) && min > 0 ? min : 0,
    max: Number.isFinite(max) && max > 0 ? max : 0,
    currency: asText(source.currency || "CNY", 16) || "CNY",
    period: asText(source.period || "monthly", 16) || "monthly"
  };
}

function normalizeCompensation(compensation = {}) {
  if (!compensation || typeof compensation !== "object") {
    return {
      min: 0,
      max: 0,
      currency: "CNY",
      period: "monthly",
      note: ""
    };
  }
  const min = Number(compensation.min ?? 0);
  const max = Number(compensation.max ?? 0);
  return {
    min: Number.isFinite(min) && min > 0 ? min : 0,
    max: Number.isFinite(max) && max > 0 ? max : 0,
    currency: asText(compensation.currency || "CNY", 16) || "CNY",
    period: asText(compensation.period || "monthly", 16) || "monthly",
    note: asText(compensation.note || "", 220)
  };
}

function normalizeConstraints(constraints = {}) {
  const source = constraints && typeof constraints === "object" ? constraints : {};
  return {
    remoteOnly: Boolean(source.remoteOnly),
    visaRequired: Boolean(source.visaRequired),
    mustHaveSkills: asTextList(source.mustHaveSkills || [], 20, 80),
    blockedCompanies: asTextList(source.blockedCompanies || [], 20, 80),
    notes: asText(source.notes || "", 220)
  };
}

function createDiscoveryIntentContract(input = {}) {
  return {
    intentId: asText(input.intentId || "", 80),
    userId: asText(input.userId || "", 80),
    keywords: asTextList(input.keywords || [], 20, 80),
    city: asText(input.city || "", 80),
    jobType: asEnum(input.jobType || "unknown", JOB_TYPE_ENUM, "unknown"),
    seniority: asEnum(input.seniority || "unknown", SENIORITY_ENUM, "unknown"),
    salaryRange: normalizeSalaryRange(input.salaryRange || {}),
    constraints: normalizeConstraints(input.constraints || {}),
    riskTolerance: asEnum(input.riskTolerance || "medium", RISK_TOLERANCE_ENUM, "medium"),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

function validateDiscoveryIntentContract(contract = {}) {
  const errors = [];
  if (!contract || typeof contract !== "object") errors.push("intent contract must be an object");
  if (!contract.intentId) errors.push("intentId is required");
  if (!contract.userId) errors.push("userId is required");
  if (!Array.isArray(contract.keywords) || contract.keywords.length === 0) {
    errors.push("keywords must be a non-empty array");
  }
  if (!JOB_TYPE_ENUM.includes(contract.jobType)) errors.push("jobType is invalid");
  if (!SENIORITY_ENUM.includes(contract.seniority)) errors.push("seniority is invalid");
  if (!RISK_TOLERANCE_ENUM.includes(contract.riskTolerance)) errors.push("riskTolerance is invalid");
  if (!contract.salaryRange || typeof contract.salaryRange !== "object") errors.push("salaryRange must be an object");
  if (!contract.constraints || typeof contract.constraints !== "object") errors.push("constraints must be an object");
  if (!Array.isArray(contract.constraints?.mustHaveSkills)) errors.push("constraints.mustHaveSkills must be an array");
  if (!Array.isArray(contract.constraints?.blockedCompanies)) errors.push("constraints.blockedCompanies must be an array");
  return { ok: errors.length === 0, errors };
}

function createJobListingContract(input = {}) {
  const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  return {
    listingId: asText(input.listingId || "", 80),
    source: asText(input.source || "manual_link", 60) || "manual_link",
    sourceJobId: asText(input.sourceJobId || "", 120),
    sourceUrl: asText(input.sourceUrl || "", 500),
    normalizedUrl: asText(input.normalizedUrl || "", 500),
    title: asText(input.title || "", 160),
    company: asText(input.company || "", 160),
    location: asText(input.location || "", 120),
    jobType: asEnum(input.jobType || "unknown", JOB_TYPE_ENUM, "unknown"),
    seniority: asEnum(input.seniority || "unknown", SENIORITY_ENUM, "unknown"),
    compensation: normalizeCompensation(input.compensation || {}),
    jdSummary: asText(input.jdSummary || "", 500),
    requirements: asTextList(input.requirements || [], 20, 220),
    metadata: {
      sourceLabel: asText(metadata.sourceLabel || "", 120),
      importedBy: asText(metadata.importedBy || "", 80),
      extractionStrategy: asText(metadata.extractionStrategy || "manual", 60) || "manual",
      importBatchId: asText(metadata.importBatchId || "", 80),
      rawPayloadDigest: asText(metadata.rawPayloadDigest || "", 120),
      applyUrl: asText(metadata.applyUrl || "", 500),
      noticeUrl: asText(metadata.noticeUrl || "", 500),
      routing: asText(metadata.routing || "", 80),
      linkResolutionStatus: asText(metadata.linkResolutionStatus || "", 80),
      isFallback: Boolean(metadata.isFallback)
    },
    ingestedAt: input.ingestedAt || new Date().toISOString()
  };
}

function validateJobListingContract(contract = {}) {
  const errors = [];
  if (!contract || typeof contract !== "object") errors.push("job listing contract must be an object");
  if (!contract.listingId) errors.push("listingId is required");
  if (!contract.source) errors.push("source is required");
  if (!contract.sourceUrl) errors.push("sourceUrl is required");
  if (!contract.normalizedUrl) errors.push("normalizedUrl is required");
  if (!contract.title) errors.push("title is required");
  if (!contract.company) errors.push("company is required");
  if (!contract.location) errors.push("location is required");
  if (!JOB_TYPE_ENUM.includes(contract.jobType)) errors.push("jobType is invalid");
  if (!SENIORITY_ENUM.includes(contract.seniority)) errors.push("seniority is invalid");
  if (!Array.isArray(contract.requirements)) errors.push("requirements must be an array");
  if (!contract.compensation || typeof contract.compensation !== "object") {
    errors.push("compensation must be an object");
  } else {
    if (!Number.isFinite(Number(contract.compensation.min))) errors.push("compensation.min must be a number");
    if (!Number.isFinite(Number(contract.compensation.max))) errors.push("compensation.max must be a number");
  }
  if (!contract.metadata || typeof contract.metadata !== "object") errors.push("metadata must be an object");
  return { ok: errors.length === 0, errors };
}

function normalizeMetaItems(items = [], max = 12) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item === "object")
    .slice(0, max)
    .map((item, index) => ({
      id: asText(item.id || item.imageId || item.attachmentId || `meta_${index + 1}`, 120),
      name: asText(item.name || item.fileName || item.label || "", 160),
      url: asText(item.url || item.sourceUrl || "", 500),
      mimeType: asText(item.mimeType || item.type || "", 80),
      note: asText(item.note || item.caption || "", 220)
    }));
}

function normalizeFetchMeta(fetchMeta = {}) {
  const source = fetchMeta && typeof fetchMeta === "object" ? fetchMeta : {};
  return {
    provider: asText(source.provider || "", 80),
    origin: asText(source.origin || "", 120),
    docName: asText(source.docName || "", 160),
    sourceUrl: asText(source.sourceUrl || "", 500),
    rowIndex: Number.isFinite(Number(source.rowIndex)) ? Number(source.rowIndex) : 0,
    importedAt: source.importedAt || new Date().toISOString(),
    rawStatus: asText(source.rawStatus || "ok", 40) || "ok"
  };
}

function createLeadRecordContract(input = {}) {
  return {
    leadId: asText(input.leadId || "", 80),
    source: asText(input.source || "feishu", 60) || "feishu",
    sourceUrl: asText(input.sourceUrl || "", 500),
    sourceLeadId: asText(input.sourceLeadId || "", 120),
    rawTitle: asText(input.rawTitle || input.title || "", 200),
    rawCompany: asText(input.rawCompany || input.company || "", 200),
    rawLocation: asText(input.rawLocation || input.location || "", 160),
    rawText: asText(input.rawText || input.description || input.summary || "", 5000),
    rawImagesMeta: normalizeMetaItems(input.rawImagesMeta || [], 12),
    rawAttachmentsMeta: normalizeMetaItems(input.rawAttachmentsMeta || [], 12),
    fetchMeta: normalizeFetchMeta(input.fetchMeta || {}),
    createdAt: input.createdAt || new Date().toISOString()
  };
}

function validateLeadRecordContract(contract = {}) {
  const errors = [];
  if (!contract || typeof contract !== "object") errors.push("lead record contract must be an object");
  if (!contract.leadId) errors.push("leadId is required");
  if (!contract.source) errors.push("source is required");
  if (!contract.sourceLeadId) errors.push("sourceLeadId is required");
  if (!Array.isArray(contract.rawImagesMeta)) errors.push("rawImagesMeta must be an array");
  if (!Array.isArray(contract.rawAttachmentsMeta)) errors.push("rawAttachmentsMeta must be an array");
  if (!contract.fetchMeta || typeof contract.fetchMeta !== "object") {
    errors.push("fetchMeta must be an object");
  } else {
    if (!contract.fetchMeta.provider) errors.push("fetchMeta.provider is required");
    if (!contract.fetchMeta.importedAt) errors.push("fetchMeta.importedAt is required");
    if (!Object.prototype.hasOwnProperty.call(contract.fetchMeta, "sourceUrl")) {
      errors.push("fetchMeta.sourceUrl is required");
    }
  }
  return { ok: errors.length === 0, errors };
}

function createLeadClassificationContract(input = {}) {
  return {
    leadId: asText(input.leadId || "", 80),
    leadType: asEnum(input.leadType || "incomplete", LEAD_TYPE_ENUM, "incomplete"),
    confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 0))),
    signals: asTextList(input.signals || [], 12, 220),
    classifiedAt: input.classifiedAt || new Date().toISOString()
  };
}

function validateLeadClassificationContract(contract = {}) {
  const errors = [];
  if (!contract || typeof contract !== "object") errors.push("lead classification contract must be an object");
  if (!contract.leadId) errors.push("leadId is required");
  if (!LEAD_TYPE_ENUM.includes(contract.leadType)) errors.push("leadType is invalid");
  if (!Array.isArray(contract.signals)) errors.push("signals must be an array");
  return { ok: errors.length === 0, errors };
}

function createCandidateEligibilityContract(input = {}) {
  return {
    leadId: asText(input.leadId || "", 80),
    leadType: asEnum(input.leadType || "incomplete", LEAD_TYPE_ENUM, "incomplete"),
    eligibleForCandidateInput: Boolean(input.eligibleForCandidateInput),
    routing: asEnum(input.routing || "manual_enrich_queue", LEAD_ROUTING_ENUM, "manual_enrich_queue"),
    reason: asText(input.reason || "", 280),
    warnings: asTextList(input.warnings || [], 8, 220),
    decidedAt: input.decidedAt || new Date().toISOString()
  };
}

function validateCandidateEligibilityContract(contract = {}) {
  const errors = [];
  if (!contract || typeof contract !== "object") errors.push("candidate eligibility contract must be an object");
  if (!contract.leadId) errors.push("leadId is required");
  if (!LEAD_TYPE_ENUM.includes(contract.leadType)) errors.push("leadType is invalid");
  if (!LEAD_ROUTING_ENUM.includes(contract.routing)) errors.push("routing is invalid");
  if (typeof contract.eligibleForCandidateInput !== "boolean") {
    errors.push("eligibleForCandidateInput must be a boolean");
  }
  if (!contract.reason) errors.push("reason is required");
  if (!Array.isArray(contract.warnings)) errors.push("warnings must be an array");
  return { ok: errors.length === 0, errors };
}

module.exports = {
  JOB_TYPE_ENUM,
  SENIORITY_ENUM,
  RISK_TOLERANCE_ENUM,
  LEAD_TYPE_ENUM,
  LEAD_ROUTING_ENUM,
  createDiscoveryIntentContract,
  validateDiscoveryIntentContract,
  createJobListingContract,
  validateJobListingContract,
  createLeadRecordContract,
  validateLeadRecordContract,
  createLeadClassificationContract,
  validateLeadClassificationContract,
  createCandidateEligibilityContract,
  validateCandidateEligibilityContract
};
