"use strict";

const { normalizeResumeData } = require("../resume/resume-structuring-audit");
const {
  normalizeCanonicalResumeContract,
  hasCanonicalResumeContent,
  cleanLine
} = require("../contracts/canonical-resume-contracts");

const TIME_RANGE_PATTERN = /((?:19|20)\d{2}[./-]\d{1,2}\s*[-–—至~]\s*(?:(?:19|20)\d{2}[./-]\d{1,2}|至今|现在|Present))/i;

function splitLegacyParts(text = "") {
  return String(text || "")
    .split("|")
    .map((part) => cleanLine(part, 220))
    .filter(Boolean);
}

function parseLegacyWorkEntry(text = "", index = 0) {
  const parts = splitLegacyParts(text);
  const header = parts[0] || "";
  const timeRange = cleanLine(header.match(TIME_RANGE_PATTERN)?.[1] || "", 40);
  const headerWithoutTime = cleanLine(header.replace(timeRange, " "), 120);
  const tokens = headerWithoutTime.split(/\s+/).filter(Boolean);

  return {
    id: `legacy_work_${index + 1}`,
    company: cleanLine(tokens[0] || headerWithoutTime, 80),
    role: cleanLine(tokens.slice(1).join(" "), 60),
    timeRange,
    bullets: parts.slice(1)
  };
}

function parseLegacyProjectEntry(text = "", index = 0) {
  const parts = splitLegacyParts(text);
  const header = parts[0] || "";
  const timeRange = cleanLine(header.match(TIME_RANGE_PATTERN)?.[1] || "", 40);
  const headerWithoutTime = cleanLine(header.replace(timeRange, " "), 120);
  const tokens = headerWithoutTime.split(/\s+/).filter(Boolean);

  return {
    id: `legacy_project_${index + 1}`,
    projectName: cleanLine(tokens.slice(0, -1).join(" ") || headerWithoutTime, 90),
    role: cleanLine(tokens.length > 1 ? tokens[tokens.length - 1] : "", 60),
    timeRange,
    bullets: parts.slice(1)
  };
}

function buildLegacyStructuredProfile(resumeDocument = null) {
  const legacy = resumeDocument?.structuredProfile || {};

  return normalizeResumeData({
    ...legacy,
    workExperience: (Array.isArray(legacy.experience) ? legacy.experience : [])
      .map(parseLegacyWorkEntry)
      .filter((entry) => entry.company || entry.role || (entry.bullets || []).length),
    projectExperience: (Array.isArray(legacy.projects) ? legacy.projects : [])
      .map(parseLegacyProjectEntry)
      .filter((entry) => entry.projectName || entry.role || (entry.bullets || []).length),
    summary: legacy.summary || legacy.selfSummary || ""
  });
}

function buildCanonicalResumeFromResumeDocument(resumeDocument = null) {
  const baseStructured = normalizeResumeData(resumeDocument?.structuredProfile || {});
  const baseContract = normalizeCanonicalResumeContract(baseStructured);

  if (hasCanonicalResumeContent(baseContract)) {
    return baseContract;
  }

  const legacyStructured = buildLegacyStructuredProfile(resumeDocument);
  return normalizeCanonicalResumeContract(legacyStructured);
}

module.exports = {
  buildCanonicalResumeFromResumeDocument,
  buildLegacyStructuredProfile
};
