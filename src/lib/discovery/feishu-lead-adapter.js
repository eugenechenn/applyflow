"use strict";

const { createId, nowIso } = require("../utils/id");
const {
  createLeadRecordContract,
  validateLeadRecordContract
} = require("../contracts/job-discovery-contracts");
const { processLeadRecordsToCandidateInputs } = require("./job-discovery-pipeline");

function asText(value = "", max = 500) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function normalizeLinkItems(links = []) {
  return (Array.isArray(links) ? links : [])
    .map((item, index) => {
      if (typeof item === "string") {
        return {
          url: asText(item, 500),
          label: "",
          type: "",
          isPrimary: index === 0
        };
      }
      if (!item || typeof item !== "object") return null;
      return {
        url: asText(item.url || item.link || item.href || "", 500),
        label: asText(item.label || item.name || "", 160),
        type: asText(item.type || "", 80),
        isPrimary: Boolean(item.isPrimary || item.primary)
      };
    })
    .filter((item) => item && item.url);
}

function normalizeImageItems(images = []) {
  return (Array.isArray(images) ? images : [])
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      id: asText(item.id || item.imageId || `image_${index + 1}`, 120),
      name: asText(item.name || item.fileName || `image_${index + 1}`, 160),
      url: asText(item.url || item.sourceUrl || "", 500),
      mimeType: asText(item.mimeType || item.type || "", 80),
      note: asText(item.note || item.caption || item.description || "", 220)
    }));
}

function normalizeAttachmentItems(attachments = []) {
  return (Array.isArray(attachments) ? attachments : [])
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      id: asText(item.id || item.attachmentId || `attachment_${index + 1}`, 120),
      name: asText(item.name || item.fileName || `attachment_${index + 1}`, 160),
      url: asText(item.url || item.sourceUrl || "", 500),
      mimeType: asText(item.mimeType || item.type || "", 80),
      note: asText(item.note || item.description || "", 220)
    }));
}

function pickSourceUrl({ sourceUrl = "", links = [] } = {}) {
  const explicit = asText(sourceUrl, 500);
  if (explicit) return explicit;

  const linkItems = normalizeLinkItems(links);
  const primary = linkItems.find((item) => item.isPrimary) || null;
  if (primary?.url) return primary.url;
  return linkItems[0]?.url || "";
}

function buildRawText({ contentText = "", links = [] } = {}) {
  const text = asText(contentText, 4000);
  const linkText = normalizeLinkItems(links)
    .map((item) => [item.label, item.url].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("\n");
  return [text, linkText].filter(Boolean).join("\n").trim();
}

function mapFeishuRawLeadToLeadRecord(rawLead = {}, options = {}) {
  const linkItems = normalizeLinkItems(rawLead.links || []);
  const sourceUrl = pickSourceUrl({
    sourceUrl: rawLead.sourceUrl || "",
    links: linkItems
  });

  const contract = createLeadRecordContract({
    leadId: rawLead.leadId || createId("lead"),
    source: "feishu",
    sourceUrl,
    sourceLeadId:
      rawLead.sourceLeadId ||
      rawLead.recordId ||
      rawLead.rowId ||
      `${options.docName || "feishu"}_${rawLead.rowIndex || options.rowIndex || 1}`,
    rawTitle: rawLead.title || "",
    rawCompany: rawLead.company || "",
    rawLocation: rawLead.location || "",
    rawText: buildRawText({
      contentText: rawLead.contentText || rawLead.rawText || "",
      links: linkItems
    }),
    rawImagesMeta: normalizeImageItems(rawLead.images || []),
    rawAttachmentsMeta: normalizeAttachmentItems(rawLead.attachments || []),
    fetchMeta: {
      provider: "feishu",
      origin: options.origin || "feishu_raw_input",
      docName: options.docName || "",
      sourceUrl,
      rowIndex: Number(rawLead.rowIndex || options.rowIndex || 0),
      importedAt: options.importedAt || nowIso(),
      rawStatus: options.rawStatus || "ok"
    },
    createdAt: rawLead.createdAt || nowIso()
  });

  const validation = validateLeadRecordContract(contract);
  if (!validation.ok) {
    const error = new Error(`Invalid Feishu lead record contract: ${validation.errors.join("; ")}`);
    error.code = "INVALID_FEISHU_LEAD_RECORD_CONTRACT";
    error.details = { errors: validation.errors, contract };
    throw error;
  }

  return contract;
}

function ingestFeishuRawLeads({ leads = [], fetchMeta = {} } = {}) {
  const leadRecords = (Array.isArray(leads) ? leads : []).map((lead, index) =>
    mapFeishuRawLeadToLeadRecord(lead, {
      origin: fetchMeta.origin || "feishu_raw_input",
      docName: fetchMeta.docName || "",
      importedAt: fetchMeta.importedAt || nowIso(),
      rawStatus: fetchMeta.rawStatus || "ok",
      rowIndex: index + 1
    })
  );

  return processLeadRecordsToCandidateInputs({ leadRecords });
}

module.exports = {
  mapFeishuRawLeadToLeadRecord,
  ingestFeishuRawLeads,
  normalizeLinkItems,
  normalizeImageItems,
  normalizeAttachmentItems,
  pickSourceUrl
};
