"use strict";

const { createExportDto, validateExportDto } = require("../contracts/resume-export-contracts");

const FORBIDDEN_EXPORT_OPTION_KEYS = new Set([
  "resumeDocument",
  "structuredProfile",
  "rawText",
  "cleanedText",
  "tailoringOutput",
  "operationData",
  "applicationPrep"
]);

function buildExportDtoFromContracts({
  resumeExportContract,
  canonicalResumeContract,
  tailoredResumeContract,
  prepDto,
  exportOptions = {}
} = {}) {
  if (!resumeExportContract || typeof resumeExportContract !== "object") {
    const error = new Error("resumeExportContract is required for export mapping.");
    error.code = "EXPORT_MAPPING_REQUIRED_INPUT";
    throw error;
  }
  if (!canonicalResumeContract || typeof canonicalResumeContract !== "object") {
    const error = new Error("canonicalResumeContract is required for export mapping.");
    error.code = "EXPORT_MAPPING_REQUIRED_INPUT";
    throw error;
  }
  if (!tailoredResumeContract || typeof tailoredResumeContract !== "object") {
    const error = new Error("tailoredResumeContract is required for export mapping.");
    error.code = "EXPORT_MAPPING_REQUIRED_INPUT";
    throw error;
  }
  if (!prepDto || typeof prepDto !== "object") {
    const error = new Error("prepDto is required for export mapping.");
    error.code = "EXPORT_MAPPING_REQUIRED_INPUT";
    throw error;
  }

  const forbiddenOptionKey = Object.keys(exportOptions || {}).find((key) => FORBIDDEN_EXPORT_OPTION_KEYS.has(key));
  if (forbiddenOptionKey) {
    const error = new Error(`exportOptions contains forbidden key: ${forbiddenOptionKey}`);
    error.code = "EXPORT_MAPPING_FORBIDDEN_SOURCE";
    throw error;
  }

  const transitionalSources = Array.isArray(exportOptions.transitionalSources)
    ? exportOptions.transitionalSources.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  const dto = createExportDto({
    exportId: resumeExportContract.exportId,
    jobId: resumeExportContract.jobId,
    masterResumeId: resumeExportContract.masterResumeId,
    tailoredResumeId: resumeExportContract.tailoredResumeId,
    exportFormat: resumeExportContract.exportFormat,
    profile: {
      candidateName: exportOptions.candidateName || "",
      targetRole: exportOptions.targetRole || "",
      targetCompany: exportOptions.targetCompany || "",
      targetLocation: exportOptions.targetLocation || ""
    },
    sections: {
      summary: prepDto.tailoredSummary || tailoredResumeContract?.canonicalTailoredResume?.selfEvaluation || "",
      whyFit: prepDto.coverNote || "",
      workExperience: Array.isArray(tailoredResumeContract?.canonicalTailoredResume?.workExperience)
        ? tailoredResumeContract.canonicalTailoredResume.workExperience
        : [],
      projectExperience: Array.isArray(tailoredResumeContract?.canonicalTailoredResume?.projectExperience)
        ? tailoredResumeContract.canonicalTailoredResume.projectExperience
        : [],
      skills: Array.isArray(tailoredResumeContract?.canonicalTailoredResume?.skills) &&
        tailoredResumeContract.canonicalTailoredResume.skills.length
        ? tailoredResumeContract.canonicalTailoredResume.skills
        : (Array.isArray(canonicalResumeContract?.skills) ? canonicalResumeContract.skills : []),
      keywords: Array.isArray(prepDto.targetKeywords) ? prepDto.targetKeywords : [],
      talkingPoints: Array.isArray(prepDto.talkingPoints) ? prepDto.talkingPoints : [],
      coverNote: prepDto.coverNote || ""
    },
    changeReasons: Array.isArray(tailoredResumeContract.changeReasons) ? tailoredResumeContract.changeReasons : [],
    sectionDiffs: Array.isArray(tailoredResumeContract.sectionDiffs) ? tailoredResumeContract.sectionDiffs : [],
    sourceContracts: [
      "canonical_resume_contract",
      "tailored_resume_contract",
      "prep_dto",
      "export_options"
    ],
    artifactMeta: {
      suggestedFileName: resumeExportContract.artifactName,
      mimeType: resumeExportContract.artifactMeta?.mimeType || ""
    },
    trace: {
      source: "export_dto_mapper.v1",
      runId: resumeExportContract.trace?.runId || resumeExportContract.exportId || ""
    }
  });

  const validation = validateExportDto(dto);
  if (!validation.ok) {
    const error = new Error(`Invalid ExportDTO from mapping layer: ${validation.errors.join("; ")}`);
    error.code = "INVALID_EXPORT_DTO";
    error.details = { errors: validation.errors, dto };
    throw error;
  }

  return {
    exportDto: dto,
    mappingMeta: {
      sourceContracts: dto.sourceContracts,
      transitionalSources
    }
  };
}

module.exports = {
  buildExportDtoFromContracts
};
