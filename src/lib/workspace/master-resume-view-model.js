"use strict";

const { normalizeResumeData } = require("../resume/resume-structuring-audit");
const { buildCanonicalResumeFromResumeDocument } = require("./legacy-resume-adapter");
const { createMasterResumeContract } = require("../contracts/master-resume-contracts");
const { cleanLine, uniqueLines } = require("../contracts/canonical-resume-contracts");

function sanitizeBasicInfo(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    name: cleanLine(source.name || source.fullName || "", 80),
    email: cleanLine(source.email || "", 120),
    phone: cleanLine(source.phone || source.mobile || "", 40),
    location: cleanLine(source.location || source.city || "", 80)
  };
}

function buildMasterResumeSeedFromResumeDocument(resumeDocument = null, profile = {}) {
  const structured = normalizeResumeData(resumeDocument?.structuredProfile || {});
  const canonical = buildCanonicalResumeFromResumeDocument(resumeDocument);
  const basicInfo = sanitizeBasicInfo({
    name: structured.name || resumeDocument?.structuredProfile?.name || profile.fullName || profile.name || "",
    email: structured.email || resumeDocument?.structuredProfile?.email || "",
    phone: structured.phone || resumeDocument?.structuredProfile?.phone || "",
    location: structured.location || resumeDocument?.structuredProfile?.location || profile.preferredLocations?.[0] || ""
  });

  return createMasterResumeContract({
    masterResumeId: resumeDocument?.id ? `master_${resumeDocument.id}` : "",
    basicInfo,
    summary: canonical.selfSummary || structured.summary || "",
    workExperience: canonical.workExperience || [],
    projectExperience: canonical.projectExperience || [],
    education: structured.educationItems || [],
    skills: canonical.skills || structured.skills || [],
    createdAt: resumeDocument?.createdAt || resumeDocument?.updatedAt,
    updatedAt: resumeDocument?.updatedAt || resumeDocument?.createdAt,
    trace: {
      source: "resume_document_seed",
      sourceResumeId: resumeDocument?.id || "",
      sourceProfileId: profile?.id || "",
      note: resumeDocument?.id ? "Seeded from latest parsed resume document." : "Initialized without parsed resume document."
    }
  });
}

function buildEmptyMasterResume(profile = {}) {
  return createMasterResumeContract({
    basicInfo: sanitizeBasicInfo({
      name: profile.fullName || profile.name || "",
      location: profile.preferredLocations?.[0] || ""
    }),
    summary: "",
    workExperience: [],
    projectExperience: [],
    education: [],
    skills: [],
    trace: {
      source: "empty_seed",
      sourceProfileId: profile?.id || "",
      note: "Initialized before any parsed resume document exists."
    }
  });
}

function buildMasterResumeViewModel(masterResume = {}) {
  const contract = createMasterResumeContract(masterResume);
  return {
    masterResumeId: contract.masterResumeId,
    basicInfo: contract.basicInfo,
    summary: contract.summary,
    workExperience: contract.workExperience,
    projectExperience: contract.projectExperience,
    education: contract.education,
    skills: contract.skills,
    sectionCounts: {
      workExperience: contract.workExperience.length,
      projectExperience: contract.projectExperience.length,
      education: contract.education.length,
      skills: contract.skills.length
    },
    source: contract.trace.source,
    updatedAt: contract.updatedAt
  };
}

function buildMasterResumeEditDto(masterResume = {}) {
  const contract = createMasterResumeContract(masterResume);
  return {
    masterResumeId: contract.masterResumeId,
    basicInfo: contract.basicInfo,
    summary: contract.summary,
    workExperience: contract.workExperience,
    projectExperience: contract.projectExperience,
    education: contract.education,
    skills: uniqueLines(contract.skills || [], 16, 80),
    updatedAt: contract.updatedAt
  };
}

module.exports = {
  buildMasterResumeSeedFromResumeDocument,
  buildEmptyMasterResume,
  buildMasterResumeViewModel,
  buildMasterResumeEditDto
};
