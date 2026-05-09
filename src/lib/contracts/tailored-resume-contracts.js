"use strict";

const { cleanLine, uniqueLines, hasFallbackText } = require("./canonical-resume-contracts");

const EXPORT_STATUSES = ["not_ready", "ready", "exported", "failed"];
const SECTION_KEYS = ["work_experience", "project_experience", "self_summary"];

function asText(value = "", max = 220) {
  const text = cleanLine(value, max);
  if (!text || hasFallbackText(text)) return "";
  return text;
}

function asTextList(items = [], max = 8, perItemMax = 220) {
  return uniqueLines(Array.isArray(items) ? items : [], max, perItemMax);
}

function normalizeSectionDiffs(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const sectionKey = SECTION_KEYS.includes(String(item.sectionKey || item.key || "").trim())
        ? String(item.sectionKey || item.key).trim()
        : "work_experience";
      return {
        diffId: asText(item.diffId || `diff_${index + 1}`, 80),
        sectionKey,
        before: asText(item.before || item.source || "", 320),
        after: asText(item.after || item.target || "", 320),
        reason: asText(item.reason || "", 220),
        status: asText(item.status || "accepted", 40) || "accepted"
      };
    })
    .filter((item) => item.after);
}

function createTailoredResumeContract(input = {}) {
  const status = EXPORT_STATUSES.includes(String(input.exportStatus || "").trim())
    ? String(input.exportStatus).trim()
    : "not_ready";

  return {
    tailoredResumeId: asText(input.tailoredResumeId || input.id || "", 80),
    jobId: asText(input.jobId || "", 80),
    masterResumeId: asText(input.masterResumeId || input.resumeDocumentId || "", 80),
    version: Math.max(1, Number(input.version || 1)),
    canonicalTailoredResume: {
      workExperience: Array.isArray(input.canonicalTailoredResume?.workExperience)
        ? input.canonicalTailoredResume.workExperience
        : [],
      projectExperience: Array.isArray(input.canonicalTailoredResume?.projectExperience)
        ? input.canonicalTailoredResume.projectExperience
        : [],
      selfEvaluation: asText(input.canonicalTailoredResume?.selfEvaluation || "", 220),
      skills: asTextList(input.canonicalTailoredResume?.skills || [], 12, 80),
      lengthBudget:
        input.canonicalTailoredResume?.lengthBudget && typeof input.canonicalTailoredResume.lengthBudget === "object"
          ? input.canonicalTailoredResume.lengthBudget
          : { status: "within_budget", totalChars: 0, totalBullets: 0, notes: [] }
    },
    changeReasons: asTextList(input.changeReasons || [], 10, 220),
    generatedSections: asTextList(input.generatedSections || [], 6, 60),
    sectionDiffs: normalizeSectionDiffs(input.sectionDiffs || []),
    exportStatus: {
      status,
      docxReady: Boolean(input.exportStatus?.docxReady ?? (status === "ready" || status === "exported")),
      lastExportedAt: input.exportStatus?.lastExportedAt || null
    },
    trace: {
      source: asText(input.trace?.source || "tailoring_pipeline", 80),
      model: asText(input.trace?.model || "", 120),
      runId: asText(input.trace?.runId || input.tailoredResumeId || "", 120)
    },
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

function validateTailoredResumeContract(contract = {}) {
  const errors = [];
  if (!contract || typeof contract !== "object") errors.push("contract must be an object");
  if (!contract.tailoredResumeId) errors.push("tailoredResumeId is required");
  if (!contract.jobId) errors.push("jobId is required");
  if (!contract.masterResumeId) errors.push("masterResumeId is required");
  if (!contract.canonicalTailoredResume || typeof contract.canonicalTailoredResume !== "object") {
    errors.push("canonicalTailoredResume is required");
  } else {
    if (!Array.isArray(contract.canonicalTailoredResume.workExperience)) {
      errors.push("canonicalTailoredResume.workExperience must be an array");
    }
    if (!Array.isArray(contract.canonicalTailoredResume.projectExperience)) {
      errors.push("canonicalTailoredResume.projectExperience must be an array");
    }
  }
  if (!Array.isArray(contract.changeReasons)) errors.push("changeReasons must be an array");
  if (!Array.isArray(contract.generatedSections)) errors.push("generatedSections must be an array");
  if (!Array.isArray(contract.sectionDiffs)) errors.push("sectionDiffs must be an array");
  if (!contract.exportStatus || typeof contract.exportStatus !== "object") {
    errors.push("exportStatus must be an object");
  } else if (!EXPORT_STATUSES.includes(String(contract.exportStatus.status || "").trim())) {
    errors.push("exportStatus.status is invalid");
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  EXPORT_STATUSES,
  createTailoredResumeContract,
  validateTailoredResumeContract
};
