"use strict";

const { buildStructuredEducation } = require("../resume/resume-structuring-audit");
const {
  normalizeCanonicalResumeContract,
  cleanLine,
  uniqueLines
} = require("./canonical-resume-contracts");
const { createId, nowIso } = require("../utils/id");

function normalizeBasicInfo(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    name: cleanLine(source.name || source.fullName || "", 80),
    email: cleanLine(source.email || "", 120),
    phone: cleanLine(source.phone || source.mobile || "", 40),
    location: cleanLine(source.location || source.city || "", 80)
  };
}

function normalizeEducationEntries(entries = []) {
  return buildStructuredEducation(Array.isArray(entries) ? entries : []);
}

function normalizeTrace(trace = {}) {
  const source = trace && typeof trace === "object" ? trace : {};
  return {
    source: cleanLine(source.source || "master_resume_seed", 40) || "master_resume_seed",
    sourceResumeId: cleanLine(source.sourceResumeId || "", 80),
    sourceProfileId: cleanLine(source.sourceProfileId || "", 80),
    note: cleanLine(source.note || "", 220)
  };
}

function createMasterResumeContract(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const canonical = normalizeCanonicalResumeContract({
    workExperience: source.workExperience,
    projectExperience: source.projectExperience,
    summary: source.summary || source.selfSummary,
    skills: source.skills
  });

  return {
    masterResumeId: cleanLine(source.masterResumeId || "", 80) || createId("master_resume"),
    basicInfo: normalizeBasicInfo(source.basicInfo || source),
    summary: cleanLine(source.summary || canonical.selfSummary || "", 220) || canonical.selfSummary,
    workExperience: canonical.workExperience,
    projectExperience: canonical.projectExperience,
    education: normalizeEducationEntries(source.education || source.educationItems || []),
    skills: uniqueLines(source.skills || canonical.skills || [], 16, 80),
    createdAt: source.createdAt || nowIso(),
    updatedAt: source.updatedAt || source.createdAt || nowIso(),
    trace: normalizeTrace(source.trace || {})
  };
}

function validateMasterResumeContract(contract = {}) {
  const errors = [];
  const value = contract && typeof contract === "object" ? contract : {};

  if (!value.masterResumeId) errors.push("masterResumeId is required");
  if (!value.basicInfo || typeof value.basicInfo !== "object") {
    errors.push("basicInfo is required");
  }
  if (!Array.isArray(value.workExperience)) errors.push("workExperience must be an array");
  if (!Array.isArray(value.projectExperience)) errors.push("projectExperience must be an array");
  if (!Array.isArray(value.education)) errors.push("education must be an array");
  if (!Array.isArray(value.skills)) errors.push("skills must be an array");
  if (!value.createdAt) errors.push("createdAt is required");
  if (!value.updatedAt) errors.push("updatedAt is required");
  if (!value.trace || typeof value.trace !== "object") errors.push("trace is required");

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  createMasterResumeContract,
  validateMasterResumeContract
};
