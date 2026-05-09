"use strict";

const crypto = require("crypto");
const { nowIso, createId } = require("../utils/id");
const { mapFeishuRawLeadToLeadRecord } = require("./feishu-lead-adapter");
const {
  processLeadRecordsToCandidateInputs,
  mapLeadRecordToCandidateInput,
  importCandidatesToCanonicalListings,
  saveLeadProcessingResult,
  getLeadProcessingResultByIntent
} = require("./job-discovery-pipeline");

const feishuSyncStateStore = new Map();

function asText(value = "", max = 500) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function getSyncState(syncKey = "") {
  if (!feishuSyncStateStore.has(syncKey)) {
    feishuSyncStateStore.set(syncKey, {
      snapshotId: "",
      recordsBySourceLeadId: new Map()
    });
  }
  return feishuSyncStateStore.get(syncKey);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function computeLeadDigest(rawLead = {}) {
  const stablePayload = {
    sourceLeadId: rawLead.sourceLeadId || "",
    title: rawLead.title || "",
    company: rawLead.company || "",
    location: rawLead.location || "",
    contentText: rawLead.contentText || "",
    links: Array.isArray(rawLead.links) ? rawLead.links : [],
    images: Array.isArray(rawLead.images) ? rawLead.images : [],
    attachments: Array.isArray(rawLead.attachments) ? rawLead.attachments : [],
    sourceUrl: rawLead.sourceUrl || ""
  };
  return crypto.createHash("sha1").update(stableStringify(stablePayload)).digest("hex");
}

function extractTextCandidates(value) {
  if (value == null) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextCandidates(item));
  }
  if (typeof value === "object") {
    return Object.values(value).flatMap((item) => extractTextCandidates(item));
  }
  return [];
}

function extractFirstTextField(fields = {}, names = []) {
  for (const name of names) {
    const value = fields?.[name];
    const candidate = extractTextCandidates(value).find((item) => String(item || "").trim());
    if (candidate) return asText(candidate, 4000);
  }
  return "";
}

function extractLinkItems(value) {
  if (!value) return [];
  if (typeof value === "string") {
    return value.trim() ? [{ url: asText(value, 500), label: "", type: "", isPrimary: true }] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      if (typeof item === "string") {
        return item.trim()
          ? [{ url: asText(item, 500), label: "", type: "", isPrimary: index === 0 }]
          : [];
      }
      if (!item || typeof item !== "object") return [];
      const url = asText(item.url || item.link || item.href || item.text || "", 500);
      if (!url) return [];
      return [
        {
          url,
          label: asText(item.label || item.name || "", 160),
          type: asText(item.type || "", 80),
          isPrimary: Boolean(item.isPrimary || item.primary || index === 0)
        }
      ];
    });
  }
  if (typeof value === "object") {
    const url = asText(value.url || value.link || value.href || value.text || "", 500);
    if (!url) return [];
    return [
      {
        url,
        label: asText(value.label || value.name || "", 160),
        type: asText(value.type || "", 80),
        isPrimary: true
      }
    ];
  }
  return [];
}

function extractAttachmentMeta(value, kind = "attachment") {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      id: asText(item.id || item.file_token || `${kind}_${index + 1}`, 120),
      name: asText(item.name || item.fileName || `${kind}_${index + 1}`, 160),
      url: asText(item.url || item.link || item.tmp_url || "", 500),
      mimeType: asText(item.mimeType || item.type || "", 80),
      note: asText(item.note || item.caption || item.description || "", 220)
    }));
}

function buildFeishuRecordsUrl({ appToken = "", tableId = "", pageToken = "", pageSize = 100, viewId = "" } = {}) {
  const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`);
  url.searchParams.set("page_size", String(pageSize));
  if (pageToken) url.searchParams.set("page_token", pageToken);
  if (viewId) url.searchParams.set("view_id", viewId);
  return url.toString();
}

function normalizeRawLeadFromFeishuRecord(record = {}, options = {}) {
  const fields = record.fields || {};
  const fieldMap = options.fieldMap || {};
  const title = extractFirstTextField(fields, fieldMap.title || ["title", "Title", "岗位", "岗位名称"]);
  const company = extractFirstTextField(fields, fieldMap.company || ["company", "Company", "公司", "企业"]);
  const location = extractFirstTextField(fields, fieldMap.location || ["location", "Location", "地点", "城市"]);
  const contentText = extractFirstTextField(
    fields,
    fieldMap.contentText || ["contentText", "content", "description", "正文", "描述", "招聘信息", "公告内容"]
  );
  const sourceUrl =
    extractFirstTextField(fields, fieldMap.sourceUrl || ["sourceUrl", "jobUrl", "url", "链接", "岗位链接", "来源链接"]) ||
    "";
  const links = (fieldMap.links || ["links", "链接", "岗位链接", "来源链接"]).flatMap((key) => extractLinkItems(fields?.[key]));
  const images = (fieldMap.images || ["images", "图片", "海报"]).flatMap((key) =>
    extractAttachmentMeta(fields?.[key], "image")
  );
  const attachments = (fieldMap.attachments || ["attachments", "附件"]).flatMap((key) =>
    extractAttachmentMeta(fields?.[key], "attachment")
  );
  const sourceLeadId =
    asText(record.record_id || record.recordId || "", 160) ||
    asText(extractFirstTextField(fields, fieldMap.stableRowId || ["rowId", "RowID", "记录ID"]), 160) ||
    `${options.tableId || "feishu_table"}:${asText(record._row_id || record.rowId || record.id || createId("row"), 160)}`;

  return {
    leadId: options.existingLeadId || "",
    sourceLeadId,
    title,
    company,
    location,
    contentText,
    links,
    images,
    attachments,
    sourceUrl,
    createdAt: options.importedAt || nowIso()
  };
}

async function fetchFeishuBitablePage({
  appToken = "",
  tableId = "",
  tenantAccessToken = "",
  pageToken = "",
  pageSize = 100,
  viewId = "",
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== "function") {
    const error = new Error("Feishu sync requires fetch implementation.");
    error.code = "FEISHU_FETCH_UNAVAILABLE";
    throw error;
  }
  const response = await fetchImpl(buildFeishuRecordsUrl({ appToken, tableId, pageToken, pageSize, viewId }), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${tenantAccessToken}`,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
  const payload = await response.json();
  if (!response.ok || Number(payload.code || 0) !== 0) {
    const error = new Error(payload.msg || "Feishu bitable sync failed.");
    error.code = "FEISHU_SYNC_FAILED";
    error.details = { status: response.status, payload };
    throw error;
  }

  return {
    items: Array.isArray(payload.data?.items) ? payload.data.items : [],
    hasMore: Boolean(payload.data?.has_more),
    pageToken: payload.data?.page_token || ""
  };
}

async function syncFeishuBitableLeads({
  intentId = "",
  userId = "user_a",
  profile = {},
  appToken = "",
  tableId = "",
  tenantAccessToken = "",
  viewId = "",
  pageSize = 100,
  maxPages = 10,
  docName = "",
  origin = "feishu_bitable_sync",
  fieldMap = {},
  fetchImpl = globalThis.fetch
} = {}) {
  if (!intentId) {
    const error = new Error("intentId is required for Feishu sync.");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  if (!appToken || !tableId || !tenantAccessToken) {
    const error = new Error("appToken, tableId, and tenantAccessToken are required for Feishu sync.");
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  const importedAt = nowIso();
  const batchId = createId("feishu_sync");
  const snapshotId = `${tableId}:${batchId}`;
  const syncKey = `${intentId}:${tableId}`;
  const syncState = getSyncState(syncKey);

  const fetchedRecords = [];
  let pageToken = "";
  let pageCount = 0;
  do {
    pageCount += 1;
    const page = await fetchFeishuBitablePage({
      appToken,
      tableId,
      tenantAccessToken,
      pageToken,
      pageSize,
      viewId,
      fetchImpl
    });
    fetchedRecords.push(...page.items);
    pageToken = page.hasMore ? page.pageToken : "";
  } while (pageToken && pageCount < maxPages);

  const syncEntries = fetchedRecords.map((record) => {
    const stateEntry = syncState.recordsBySourceLeadId.get(
      asText(record.record_id || record.recordId || "", 160) ||
        asText(extractFirstTextField(record.fields || {}, fieldMap.stableRowId || ["rowId", "RowID", "记录ID"]), 160) ||
        ""
    );
    const rawLead = normalizeRawLeadFromFeishuRecord(record, {
      tableId,
      fieldMap,
      importedAt,
      existingLeadId: stateEntry?.leadId || ""
    });
    const digest = computeLeadDigest(rawLead);
    const existing = syncState.recordsBySourceLeadId.get(rawLead.sourceLeadId) || null;
    const syncStatus = !existing ? "new" : existing.digest === digest ? "unchanged" : "updated";
    return {
      record,
      rawLead,
      digest,
      existing,
      syncStatus
    };
  });

  const changedEntries = syncEntries.filter((entry) => entry.syncStatus !== "unchanged");
  const changedLeadRecords = changedEntries.map((entry, index) =>
    mapFeishuRawLeadToLeadRecord(entry.rawLead, {
      origin,
      docName: docName || tableId,
      importedAt,
      rawStatus: "ok",
      rowIndex: index + 1
    })
  );
  const leadProcessingResult = processLeadRecordsToCandidateInputs({ leadRecords: changedLeadRecords });
  const storedLeadProcessingResult = changedEntries.length
    ? saveLeadProcessingResult(intentId, leadProcessingResult)
    : getLeadProcessingResultByIntent(intentId);

  const candidateInputsToImport = changedEntries.flatMap((entry, index) => {
    const decision = leadProcessingResult.eligibilityDecisions[index];
    const leadRecord = leadProcessingResult.leadRecords[index];
    const previouslyImported = Boolean(entry.existing?.canonicalImported);
    if (!decision?.eligibleForCandidateInput || previouslyImported) return [];
    return [mapLeadRecordToCandidateInput(leadRecord)];
  });

  const importResult = candidateInputsToImport.length
    ? importCandidatesToCanonicalListings({
        intentId,
        userId,
        candidates: candidateInputsToImport,
        profile
      })
    : {
        intent: null,
        listings: [],
        totalListings: 0,
        dedupCandidatePool: null,
        batchDecisionResult: null,
        rankingResult: null,
        shortlistResult: null
      };

  syncEntries.forEach((entry, index) => {
    const changedIndex = changedEntries.findIndex((item) => item.rawLead.sourceLeadId === entry.rawLead.sourceLeadId);
    const processedLeadRecord = changedIndex >= 0 ? leadProcessingResult.leadRecords[changedIndex] : null;
    const processedDecision = changedIndex >= 0 ? leadProcessingResult.eligibilityDecisions[changedIndex] : null;
    const previouslyImported = Boolean(entry.existing?.canonicalImported);
    const importedThisRun =
      changedIndex >= 0 &&
      Boolean(processedDecision?.eligibleForCandidateInput) &&
      !previouslyImported;

    syncState.recordsBySourceLeadId.set(entry.rawLead.sourceLeadId, {
      sourceLeadId: entry.rawLead.sourceLeadId,
      leadId: processedLeadRecord?.leadId || entry.existing?.leadId || "",
      digest: entry.digest,
      syncStatus: entry.syncStatus,
      lastSeenAt: importedAt,
      sourceUrl: entry.rawLead.sourceUrl || "",
      canonicalImported: previouslyImported || importedThisRun,
      lastRouting: processedDecision?.routing || entry.existing?.lastRouting || "",
      lastLeadType:
        (changedIndex >= 0 ? leadProcessingResult.classifications[changedIndex]?.leadType : "") ||
        entry.existing?.lastLeadType ||
        ""
    });
  });

  syncState.snapshotId = snapshotId;

  return {
    batchId,
    snapshotId,
    intentId,
    source: "feishu_bitable",
    fetchedCount: fetchedRecords.length,
    newCount: syncEntries.filter((entry) => entry.syncStatus === "new").length,
    updatedCount: syncEntries.filter((entry) => entry.syncStatus === "updated").length,
    unchangedCount: syncEntries.filter((entry) => entry.syncStatus === "unchanged").length,
    importedCandidateCount: candidateInputsToImport.length,
    leadProcessingResult: storedLeadProcessingResult,
    importResult
  };
}

module.exports = {
  buildFeishuRecordsUrl,
  normalizeRawLeadFromFeishuRecord,
  syncFeishuBitableLeads,
  fetchFeishuBitablePage,
  computeLeadDigest
};
