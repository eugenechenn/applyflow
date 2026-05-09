"use strict";

const fs = require("fs");
const path = require("path");
const { getRequestContext } = require("../../server/request-context");
const { nowIso, createId } = require("../utils/id");
const {
  createLeadRecordContract,
  validateLeadRecordContract,
  createLeadClassificationContract,
  validateLeadClassificationContract,
  createCandidateEligibilityContract,
  validateCandidateEligibilityContract
} = require("../contracts/job-discovery-contracts");
const { mapLeadRecordToCandidateInput } = require("./job-discovery-pipeline");

function asText(value = "", max = 5000) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function normalizeLinkMeta(rawLinks = []) {
  return (Array.isArray(rawLinks) ? rawLinks : [])
    .map((item, index) => {
      const url = asText(item, 600);
      if (!url) return null;
      return {
        id: `link_${index + 1}`,
        name: `link_${index + 1}`,
        url,
        mimeType: "text/url",
        note: "offline_json_link_evidence"
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function parseJson(filePath = "") {
  const absolutePath = path.resolve(filePath);
  const content = fs.readFileSync(absolutePath, "utf8");
  return {
    absolutePath,
    payload: JSON.parse(content)
  };
}

async function loadJsonFromWorkerAsset(assetPath = "/data/standardized_feishu_records.json") {
  const env = getRequestContext().env || {};
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
    const error = new Error("Worker assets binding is not available for offline_json source.");
    error.code = "OFFLINE_JSON_SOURCE_NOT_AVAILABLE";
    throw error;
  }

  const response = await env.ASSETS.fetch(new Request(new URL(assetPath, "https://applyflow.local")));
  if (!response || response.status === 404) {
    const error = new Error(`OFFLINE_JSON_SOURCE_NOT_AVAILABLE: ${assetPath} was not found in worker assets.`);
    error.code = "OFFLINE_JSON_SOURCE_NOT_AVAILABLE";
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`OFFLINE_JSON_SOURCE_NOT_AVAILABLE: ${assetPath} returned ${response.status}.`);
    error.code = "OFFLINE_JSON_SOURCE_NOT_AVAILABLE";
    error.details = { status: response.status };
    throw error;
  }

  return {
    absolutePath: `worker-asset:${assetPath}`,
    payload: await response.json()
  };
}

function createOfflineJsonUnavailableError(filePath = "", originalError = null) {
  const error = new Error("OFFLINE_JSON_SOURCE_NOT_AVAILABLE: standardized_feishu_records.json is not available in this runtime.");
  error.code = "OFFLINE_JSON_SOURCE_NOT_AVAILABLE";
  error.details = {
    filePath,
    originalCode: originalError?.code || null,
    originalMessage: originalError?.message || null
  };
  return error;
}

function createFallbackRecords({ keywords = [], city = "", count = 12 } = {}) {
  const safeKeywords = (Array.isArray(keywords) ? keywords : [])
    .map((item) => asText(item, 80))
    .filter(Boolean);
  const keywordPool = safeKeywords.length ? safeKeywords : ["generic_job"];
  const safeCity = asText(city, 120);
  const total = Math.max(1, Math.min(24, Number(count) || 12));

  return Array.from({ length: total }).map((_, index) => {
    const keyword = keywordPool[index % keywordPool.length];
    const id = `fallback_${index + 1}`;
    return {
      source: "feishu_offline_json",
      sourceJobId: id,
      company: `${keyword} fallback`,
      title: `${keyword} unavailable`,
      location: safeCity || "",
      apply_url: "",
      notice_url: null,
      raw_text: `${keyword} fallback record; source data unavailable.`,
      fetchMeta: {
        rawLinks: [],
        fallback: true
      },
      link_resolution_status: "no_link",
      routing: "severe_missing",
      isFallback: true
    };
  });
}

function pickRecordSourceUrl(record = {}) {
  return asText(
    record.apply_url ||
      record.notice_url ||
      record.fetchMeta?.rawLinks?.[0] ||
      "",
    600
  );
}

function leadTypeFromRecord(record = {}) {
  const routing = asText(record.routing, 60);
  const status = asText(record.link_resolution_status, 60);

  if (routing === "candidate_input") {
    return "direct_apply";
  }
  if (status === "notice_only") {
    return "announcement";
  }
  if (status === "both_kept") {
    return "gateway_link";
  }
  return "incomplete";
}

function decisionFromRouting(record = {}) {
  if (record?.isFallback === true || record?.fetchMeta?.fallback === true) {
    return {
      leadType: "incomplete",
      eligibleForCandidateInput: false,
      routing: "manual_enrich_queue",
      reason: "Offline fallback record is isolated and cannot enter candidate input.",
      warnings: ["offline_json_fallback_blocked"]
    };
  }

  const routing = asText(record.routing, 60);
  const status = asText(record.link_resolution_status, 60);
  const leadType = leadTypeFromRecord(record);

  if (routing === "candidate_input") {
    return {
      leadType,
      eligibleForCandidateInput: true,
      routing: "candidate_input",
      reason: "Offline standardized record marked as candidate_input and admitted to candidate import.",
      warnings: []
    };
  }

  if (routing === "resolution") {
    if (status === "notice_only") {
      return {
        leadType: "announcement",
        eligibleForCandidateInput: false,
        routing: "manual_enrich_queue",
        reason: "Record currently contains notice link only and is routed to resolution queue.",
        warnings: ["notice_only_requires_manual_resolution"]
      };
    }
    return {
      leadType,
      eligibleForCandidateInput: false,
      routing: "manual_followup_required",
      reason: "Record requires manual follow-up before candidate admission.",
      warnings: ["resolution_bucket_blocked_from_candidate_input"]
    };
  }

  return {
    leadType: "incomplete",
    eligibleForCandidateInput: false,
    routing: "manual_enrich_queue",
    reason: "Record is severe_missing and requires manual enrichment.",
    warnings: ["severe_missing_record"]
  };
}

function validateContractResult(result = {}, code = "INVALID_OFFLINE_JSON_CONTRACT") {
  if (result.ok) return;
  const error = new Error(result.errors.join("; "));
  error.code = code;
  error.details = { errors: result.errors };
  throw error;
}

function mapStandardizedRecordToLeadRecord(record = {}, options = {}) {
  const sourceLeadId = asText(record.sourceJobId, 160) || createId("offline_lead");
  const sourceUrl = pickRecordSourceUrl(record);
  const rawLinks = Array.isArray(record.fetchMeta?.rawLinks) ? record.fetchMeta.rawLinks : [];
  const fetchMeta = record.fetchMeta && typeof record.fetchMeta === "object" ? record.fetchMeta : {};

  const leadRecord = createLeadRecordContract({
    leadId: createId("lead"),
    source: "feishu_offline_json",
    sourceUrl,
    sourceLeadId,
    rawTitle: asText(record.title, 240),
    rawCompany: asText(record.company, 240),
    rawLocation: asText(record.location, 180),
    rawText: asText(record.raw_text, 5000),
    rawImagesMeta: [],
    rawAttachmentsMeta: normalizeLinkMeta(rawLinks),
    fetchMeta: {
      provider: "feishu_offline_json",
      origin: asText(options.origin || "offline_json_import", 120),
      docName: asText(options.docName || path.basename(options.filePath || ""), 200),
      sourceUrl,
      rowIndex: Number(options.rowIndex || 0),
      importedAt: asText(options.importedAt || nowIso(), 120),
      rawStatus: "ok"
    },
    createdAt: asText(record.createdAt || options.importedAt || nowIso(), 120)
  });

  leadRecord.fetchMeta = {
    ...leadRecord.fetchMeta,
    applyUrl: asText(record.apply_url || "", 600),
    noticeUrl: asText(record.notice_url || "", 600),
    routing: asText(record.routing || "", 80),
    linkResolutionStatus: asText(record.link_resolution_status || "", 80),
    rawLinks,
    isFallback: Boolean(record.isFallback || fetchMeta.fallback)
  };

  validateContractResult(validateLeadRecordContract(leadRecord), "INVALID_OFFLINE_JSON_LEAD_RECORD_CONTRACT");
  return leadRecord;
}

function buildLeadProcessingResultFromOfflineJson(records = [], options = {}) {
  const importedAt = options.importedAt || nowIso();
  const leadRecords = [];
  const classifications = [];
  const eligibilityDecisions = [];
  const candidateInputs = [];
  const blockedLeads = [];

  records.forEach((record, index) => {
    const leadRecord = mapStandardizedRecordToLeadRecord(record, {
      ...options,
      importedAt,
      rowIndex: index + 1
    });

    const decisionSeed = decisionFromRouting(record);
    const classification = createLeadClassificationContract({
      leadId: leadRecord.leadId,
      leadType: decisionSeed.leadType,
      confidence: record.routing === "candidate_input" ? 0.95 : 0.82,
      signals: [
        `offline_routing:${asText(record.routing, 80) || "unknown"}`,
        `link_resolution:${asText(record.link_resolution_status, 80) || "unknown"}`
      ],
      classifiedAt: importedAt
    });
    validateContractResult(
      validateLeadClassificationContract(classification),
      "INVALID_OFFLINE_JSON_LEAD_CLASSIFICATION_CONTRACT"
    );

    const decision = createCandidateEligibilityContract({
      leadId: leadRecord.leadId,
      leadType: decisionSeed.leadType,
      eligibleForCandidateInput: decisionSeed.eligibleForCandidateInput,
      routing: decisionSeed.routing,
      reason: decisionSeed.reason,
      warnings: decisionSeed.warnings,
      decidedAt: importedAt
    });
    validateContractResult(
      validateCandidateEligibilityContract(decision),
      "INVALID_OFFLINE_JSON_ELIGIBILITY_CONTRACT"
    );

    leadRecords.push(leadRecord);
    classifications.push(classification);
    eligibilityDecisions.push(decision);
    if (decision.eligibleForCandidateInput) {
      candidateInputs.push(
        mapLeadRecordToCandidateInput(leadRecord)
      );
    } else {
      blockedLeads.push(leadRecord);
    }
  });

  return {
    leadRecords,
    classifications,
    eligibilityDecisions,
    candidateInputs,
    blockedLeads
  };
}

async function loadOfflineJsonBatch({
  filePath = "",
  records: providedRecords = null,
  candidateLimit = 50,
  resolutionLimit = 30,
  fallbackKeywords = [],
  fallbackCity = "",
  fallbackCount = 12
} = {}) {
  if (!filePath && !Array.isArray(providedRecords)) {
    const error = new Error("filePath is required for offline_json source.");
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  let absolutePath = filePath ? path.resolve(filePath) : "payload.records";
  let records = [];
  let fallbackUsed = false;
  if (Array.isArray(providedRecords)) {
    records = providedRecords;
  } else try {
    const parsed = parseJson(filePath);
    absolutePath = parsed.absolutePath;
    records = Array.isArray(parsed.payload?.records) ? parsed.payload.records : [];
  } catch (error) {
    const message = String(error?.message || "");
    const isFileMissing =
      error?.code === "ENOENT" ||
      /no such file or directory|readall/i.test(message);
    if (!isFileMissing) {
      throw error;
    }
    try {
      const parsed = await loadJsonFromWorkerAsset("/data/standardized_feishu_records.json");
      absolutePath = parsed.absolutePath;
      records = Array.isArray(parsed.payload?.records) ? parsed.payload.records : [];
    } catch (assetError) {
      throw createOfflineJsonUnavailableError(filePath, assetError?.code ? assetError : error);
    }
  }

  const candidateRecords = records.filter((item) => item?.routing === "candidate_input").slice(0, candidateLimit);
  const resolutionRecords = records.filter((item) => item?.routing === "resolution").slice(0, resolutionLimit);
  const selected = [...candidateRecords, ...resolutionRecords];

  return {
    source: "offline_json",
    filePath: absolutePath,
    fallbackUsed,
    totalRecords: records.length,
    selectedRecords: selected,
    selectedSummary: {
      candidate_input: candidateRecords.length,
      resolution: resolutionRecords.length,
      severe_missing: 0
    }
  };
}

module.exports = {
  loadOfflineJsonBatch,
  buildLeadProcessingResultFromOfflineJson
};
