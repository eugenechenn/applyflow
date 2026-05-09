"use strict";

const { cleanLine, uniqueLines, hasFallbackText } = require("./canonical-resume-contracts");

function asText(value = "", max = 220) {
  const text = cleanLine(value, max);
  if (!text || hasFallbackText(text)) return "";
  return text;
}

function asTextList(items = [], max = 8, perItemMax = 220) {
  return uniqueLines(Array.isArray(items) ? items : [], max, perItemMax);
}

function normalizeChecklist(items = []) {
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    key: asText(item?.key || `check_${index + 1}`, 60),
    label: asText(item?.label || `检查项 ${index + 1}`, 120),
    completed: Boolean(item?.completed)
  }));
}

function createPrepDto(input = {}) {
  const sectionDiffs = Array.isArray(input.sectionDiffs) ? input.sectionDiffs : [];
  const rewriteBullets = sectionDiffs
    .map((item) => asText(item.after || "", 280))
    .filter(Boolean);

  return {
    prepDtoId: asText(input.prepDtoId || "", 80),
    jobId: asText(input.jobId || "", 80),
    tailoredResumeId: asText(input.tailoredResumeId || "", 80),
    masterResumeId: asText(input.masterResumeId || "", 80),
    prepVersion: Math.max(1, Number(input.prepVersion || 1)),
    resumeDocumentId: asText(input.resumeDocumentId || "", 80),
    targetKeywords: asTextList(input.targetKeywords || [], 12, 80),
    tailoredSummary: asText(input.tailoredSummary || "", 220),
    rewriteBullets,
    changeReasons: asTextList(input.changeReasons || [], 10, 220),
    selfIntro: {
      short: asText(input.selfIntro?.short || "", 220),
      medium: asText(input.selfIntro?.medium || "", 400)
    },
    qaDraft: (Array.isArray(input.qaDraft) ? input.qaDraft : []).map((item, index) => ({
      question: asText(item?.question || `问题 ${index + 1}`, 220),
      draftAnswer: asText(item?.draftAnswer || "", 500)
    })),
    talkingPoints: asTextList(input.talkingPoints || [], 12, 220),
    coverNote: asText(input.coverNote || "", 300),
    outreachNote: asText(input.outreachNote || "", 300),
    checklist: normalizeChecklist(input.checklist || []),
    admissionContext: {
      admissionId: asText(input.admissionContext?.admissionId || "", 120),
      intentId: asText(input.admissionContext?.intentId || "", 80),
      shortlistId: asText(input.admissionContext?.shortlistId || "", 80),
      listingId: asText(input.admissionContext?.listingId || "", 80),
      admissionStatus: asText(input.admissionContext?.admissionStatus || "", 40),
      admissionBucket: asText(input.admissionContext?.admissionBucket || "", 40),
      selectionReason: asText(input.admissionContext?.selectionReason || "", 320)
    },
    prepStatus: asText(input.prepStatus || "draft", 40) || "draft",
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

function validatePrepDto(dto = {}) {
  const errors = [];
  if (!dto || typeof dto !== "object") errors.push("prepDto must be an object");
  if (!dto.jobId) errors.push("jobId is required");
  if (!dto.prepDtoId) errors.push("prepDtoId is required");
  if (!dto.tailoredResumeId) errors.push("tailoredResumeId is required");
  if (!dto.masterResumeId) errors.push("masterResumeId is required");
  if (!Array.isArray(dto.targetKeywords)) errors.push("targetKeywords must be an array");
  if (!Array.isArray(dto.rewriteBullets)) errors.push("rewriteBullets must be an array");
  if (!Array.isArray(dto.changeReasons)) errors.push("changeReasons must be an array");
  if (!Array.isArray(dto.checklist)) errors.push("checklist must be an array");
  if (!Array.isArray(dto.qaDraft)) errors.push("qaDraft must be an array");
  if (!dto.selfIntro || typeof dto.selfIntro !== "object") errors.push("selfIntro must be an object");
  if (!dto.admissionContext || typeof dto.admissionContext !== "object") {
    errors.push("admissionContext must be an object");
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  createPrepDto,
  validatePrepDto
};
