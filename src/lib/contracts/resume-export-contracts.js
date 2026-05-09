"use strict";

const { cleanLine, uniqueLines, hasFallbackText } = require("./canonical-resume-contracts");

const EXPORT_FORMATS = ["docx", "pdf"];
const EXPORT_STATUSES = ["requested", "ready", "exporting", "exported", "failed"];
const EXPORT_DTO_ALLOWED_SOURCES = [
  "canonical_resume_contract",
  "tailored_resume_contract",
  "prep_dto",
  "export_options"
];

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

function normalizeSectionDiffs(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      diffId: asText(item?.diffId || `diff_${index + 1}`, 80),
      sectionKey: asText(item?.sectionKey || item?.key || "", 60),
      before: asText(item?.before || "", 320),
      after: asText(item?.after || "", 320),
      reason: asText(item?.reason || "", 220),
      status: asText(item?.status || "accepted", 40) || "accepted"
    }))
    .filter((item) => item.after);
}

function createResumeExportContract(input = {}) {
  return {
    exportId: asText(input.exportId || "", 120),
    jobId: asText(input.jobId || "", 80),
    masterResumeId: asText(input.masterResumeId || "", 80),
    tailoredResumeId: asText(input.tailoredResumeId || "", 80),
    exportFormat: asEnum(input.exportFormat, EXPORT_FORMATS, "docx"),
    exportStatus: asEnum(input.exportStatus, EXPORT_STATUSES, "requested"),
    artifactName: asText(input.artifactName || "", 180),
    artifactMeta: {
      mimeType: asText(input.artifactMeta?.mimeType || "", 120),
      extension: asText(input.artifactMeta?.extension || "", 12),
      storageKey: asText(input.artifactMeta?.storageKey || "", 220),
      sizeBytes: Number.isFinite(Number(input.artifactMeta?.sizeBytes))
        ? Math.max(0, Number(input.artifactMeta.sizeBytes))
        : 0,
      checksum: asText(input.artifactMeta?.checksum || "", 160)
    },
    trace: {
      source: asText(input.trace?.source || "resume_export_pipeline", 120),
      runId: asText(input.trace?.runId || "", 120)
    },
    warnings: asTextList(input.warnings || [], 10, 220),
    errors: asTextList(input.errors || [], 10, 220),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

function validateResumeExportContract(contract = {}) {
  const errors = [];
  if (!contract || typeof contract !== "object") errors.push("resumeExportContract must be an object");
  if (!contract.exportId) errors.push("exportId is required");
  if (!contract.jobId) errors.push("jobId is required");
  if (!contract.masterResumeId) errors.push("masterResumeId is required");
  if (!contract.tailoredResumeId) errors.push("tailoredResumeId is required");
  if (!EXPORT_FORMATS.includes(contract.exportFormat)) errors.push("exportFormat is invalid");
  if (!EXPORT_STATUSES.includes(contract.exportStatus)) errors.push("exportStatus is invalid");
  if (!contract.artifactName) errors.push("artifactName is required");
  if (!contract.artifactMeta || typeof contract.artifactMeta !== "object") {
    errors.push("artifactMeta must be an object");
  } else {
    if (!contract.artifactMeta.mimeType) errors.push("artifactMeta.mimeType is required");
    if (!contract.artifactMeta.extension) errors.push("artifactMeta.extension is required");
  }
  if (!Array.isArray(contract.warnings)) errors.push("warnings must be an array");
  if (!Array.isArray(contract.errors)) errors.push("errors must be an array");
  return { ok: errors.length === 0, errors };
}

function createExportDto(input = {}) {
  return {
    exportId: asText(input.exportId || "", 120),
    jobId: asText(input.jobId || "", 80),
    masterResumeId: asText(input.masterResumeId || "", 80),
    tailoredResumeId: asText(input.tailoredResumeId || "", 80),
    exportFormat: asEnum(input.exportFormat, EXPORT_FORMATS, "docx"),
    profile: {
      candidateName: asText(input.profile?.candidateName || "", 80),
      targetRole: asText(input.profile?.targetRole || "", 120),
      targetCompany: asText(input.profile?.targetCompany || "", 120),
      targetLocation: asText(input.profile?.targetLocation || "", 120)
    },
    sections: {
      summary: asText(input.sections?.summary || "", 320),
      whyFit: asText(input.sections?.whyFit || "", 320),
      workExperience: Array.isArray(input.sections?.workExperience) ? input.sections.workExperience : [],
      projectExperience: Array.isArray(input.sections?.projectExperience) ? input.sections.projectExperience : [],
      skills: asTextList(input.sections?.skills || [], 16, 80),
      keywords: asTextList(input.sections?.keywords || [], 16, 80),
      talkingPoints: asTextList(input.sections?.talkingPoints || [], 16, 220),
      coverNote: asText(input.sections?.coverNote || "", 420)
    },
    changeReasons: asTextList(input.changeReasons || [], 12, 220),
    sectionDiffs: normalizeSectionDiffs(input.sectionDiffs || []),
    sourceContracts: asTextList(input.sourceContracts || EXPORT_DTO_ALLOWED_SOURCES, 8, 80),
    artifactMeta: {
      suggestedFileName: asText(input.artifactMeta?.suggestedFileName || "", 180),
      mimeType: asText(input.artifactMeta?.mimeType || "", 120)
    },
    trace: {
      source: asText(input.trace?.source || "export_dto.v1", 120),
      runId: asText(input.trace?.runId || "", 120)
    }
  };
}

function validateExportDto(dto = {}) {
  const errors = [];
  if (!dto || typeof dto !== "object") errors.push("exportDto must be an object");
  if (!dto.exportId) errors.push("exportId is required");
  if (!dto.jobId) errors.push("jobId is required");
  if (!dto.masterResumeId) errors.push("masterResumeId is required");
  if (!dto.tailoredResumeId) errors.push("tailoredResumeId is required");
  if (!EXPORT_FORMATS.includes(dto.exportFormat)) errors.push("exportFormat is invalid");
  if (!dto.profile || typeof dto.profile !== "object") errors.push("profile must be an object");
  if (!dto.sections || typeof dto.sections !== "object") {
    errors.push("sections must be an object");
  } else {
    if (!Array.isArray(dto.sections.workExperience)) errors.push("sections.workExperience must be an array");
    if (!Array.isArray(dto.sections.projectExperience)) errors.push("sections.projectExperience must be an array");
    if (!Array.isArray(dto.sections.skills)) errors.push("sections.skills must be an array");
    if (!Array.isArray(dto.sections.keywords)) errors.push("sections.keywords must be an array");
    if (!Array.isArray(dto.sections.talkingPoints)) errors.push("sections.talkingPoints must be an array");
  }
  if (!Array.isArray(dto.changeReasons)) errors.push("changeReasons must be an array");
  if (!Array.isArray(dto.sectionDiffs)) errors.push("sectionDiffs must be an array");
  if (!Array.isArray(dto.sourceContracts)) {
    errors.push("sourceContracts must be an array");
  } else {
    dto.sourceContracts.forEach((source) => {
      if (!EXPORT_DTO_ALLOWED_SOURCES.includes(source)) {
        errors.push(`sourceContracts contains unsupported source: ${source}`);
      }
    });
  }
  if (dto.resumeDocument || dto.structuredProfile || dto.cleanedText || dto.rawText || dto.tailoringOutput || dto.operationData) {
    errors.push("exportDto contains forbidden raw/legacy fields");
  }
  if (!dto.artifactMeta || typeof dto.artifactMeta !== "object") errors.push("artifactMeta must be an object");
  return { ok: errors.length === 0, errors };
}

function completeResumeExportContractSuccess(contract = {}, artifact = {}) {
  return createResumeExportContract({
    ...contract,
    exportStatus: "exported",
    artifactName: artifact.fileName || contract.artifactName || "",
    artifactMeta: {
      ...(contract.artifactMeta || {}),
      mimeType: artifact.contentType || contract.artifactMeta?.mimeType || "",
      extension: (artifact.fileName && String(artifact.fileName).split(".").pop()) || contract.artifactMeta?.extension || "",
      sizeBytes: artifact.buffer && typeof artifact.buffer.length === "number" ? artifact.buffer.length : 0
    },
    warnings: Array.isArray(artifact.warnings) ? artifact.warnings : [],
    errors: [],
    updatedAt: new Date().toISOString()
  });
}

function completeResumeExportContractFailure(contract = {}, failure = {}) {
  const message = String(failure.message || "Export failed.");
  const warnings = Array.isArray(failure.warnings) ? failure.warnings : [];
  return createResumeExportContract({
    ...contract,
    exportStatus: "failed",
    warnings,
    errors: [message],
    updatedAt: new Date().toISOString()
  });
}

module.exports = {
  EXPORT_FORMATS,
  EXPORT_STATUSES,
  EXPORT_DTO_ALLOWED_SOURCES,
  createResumeExportContract,
  validateResumeExportContract,
  createExportDto,
  validateExportDto,
  completeResumeExportContractSuccess,
  completeResumeExportContractFailure
};
