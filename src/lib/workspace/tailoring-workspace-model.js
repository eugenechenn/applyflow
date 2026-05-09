"use strict";

const {
  normalizeText,
  cleanLine,
  uniqueLines,
  hasFallbackText,
  containsPersonalInfo
} = require("../contracts/canonical-resume-contracts");
const { createMasterResumeContract } = require("../contracts/master-resume-contracts");
const { buildCanonicalResumeFromResumeDocument } = require("./legacy-resume-adapter");

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_PATTERN = /(?:\+?86[-\s]?)?1[3-9]\d{9}|(?:\+?\d[\d\s\-()]{7,}\d)/;

const DEFAULT_SUMMARY = "Demonstrates strong execution, collaboration, and structured communication in real delivery environments.";
const DEFAULT_ROLE_SUMMARY = "Role details are available and ready for targeted resume tailoring.";

function sanitizeBulletList(items = [], max = 6) {
  return uniqueLines(items, max, 220)
    .filter((item) => !containsPersonalInfo(item))
    .filter((item) => !hasFallbackText(item));
}

function normalizeWorkEntry(entry = {}, index = 0) {
  return {
    id: entry.id || `work_${index + 1}`,
    company: cleanLine(entry.company || "", 80),
    role: cleanLine(entry.role || "", 60),
    timeRange: cleanLine(entry.timeRange || "", 40),
    bullets: sanitizeBulletList(entry.bullets || [], 6)
  };
}

function normalizeProjectEntry(entry = {}, index = 0) {
  return {
    id: entry.id || `project_${index + 1}`,
    projectName: cleanLine(entry.projectName || entry.name || "", 90),
    role: cleanLine(entry.role || "", 60),
    timeRange: cleanLine(entry.timeRange || "", 40),
    bullets: sanitizeBulletList(entry.bullets || [], 6)
  };
}

function inferPersonalInfo(resumeDocument = null, profile = {}) {
  const source = normalizeText([
    resumeDocument?.cleanedText || "",
    resumeDocument?.structuredProfile?.name || "",
    resumeDocument?.structuredProfile?.email || "",
    resumeDocument?.structuredProfile?.phone || "",
    profile.fullName || profile.name || "",
    profile.email || "",
    profile.phone || "",
    profile.location || ""
  ].join("\n"));

  const email = cleanLine(resumeDocument?.structuredProfile?.email || source.match(EMAIL_PATTERN)?.[0] || profile.email || "", 80);
  const phone = cleanLine(resumeDocument?.structuredProfile?.phone || source.match(PHONE_PATTERN)?.[0] || profile.phone || "", 40);
  const city = cleanLine(resumeDocument?.structuredProfile?.location || profile.location || "", 80);
  const name = cleanLine(resumeDocument?.structuredProfile?.name || profile.fullName || profile.name || "", 40);

  return { name, email, phone, city };
}

function normalizeResumeWorkspaceAsset(resumeDocument = null, profile = {}) {
  const canonical = buildCanonicalResumeFromResumeDocument(resumeDocument);
  const workExperience = (canonical.workExperience || [])
    .map(normalizeWorkEntry)
    .filter((entry) => entry.company || entry.role || entry.bullets.length);
  const projectExperience = (canonical.projectExperience || [])
    .map(normalizeProjectEntry)
    .filter((entry) => entry.projectName || entry.role || entry.bullets.length);

  return {
    id: resumeDocument?.id || "resume_asset_current",
    name: resumeDocument?.fileName || "resume",
    personalInfo: inferPersonalInfo(resumeDocument, profile),
    workExperience,
    projectExperience,
    selfSummary: cleanLine(canonical.selfSummary || "", 220) || DEFAULT_SUMMARY,
    education: [],
    skills: uniqueLines(canonical.skills || [], 12, 80)
  };
}

function normalizeResumeWorkspaceAssetFromMasterResume(masterResume = null, profile = {}, resumeDocument = null) {
  const contract = createMasterResumeContract(masterResume || {});
  const fallbackPersonalInfo = inferPersonalInfo(resumeDocument, profile);
  const workExperience = (contract.workExperience || [])
    .map(normalizeWorkEntry)
    .filter((entry) => entry.company || entry.role || entry.bullets.length);
  const projectExperience = (contract.projectExperience || [])
    .map(normalizeProjectEntry)
    .filter((entry) => entry.projectName || entry.role || entry.bullets.length);

  return {
    id: contract.masterResumeId || resumeDocument?.id || "master_resume_asset_current",
    name: contract.basicInfo?.name || resumeDocument?.fileName || "master_resume",
    personalInfo: {
      name: cleanLine(contract.basicInfo?.name || fallbackPersonalInfo.name || "", 40),
      email: cleanLine(contract.basicInfo?.email || fallbackPersonalInfo.email || "", 80),
      phone: cleanLine(contract.basicInfo?.phone || fallbackPersonalInfo.phone || "", 40),
      city: cleanLine(contract.basicInfo?.location || fallbackPersonalInfo.city || "", 80)
    },
    workExperience,
    projectExperience,
    selfSummary: cleanLine(contract.summary || "", 220) || DEFAULT_SUMMARY,
    education: Array.isArray(contract.education) ? contract.education : [],
    skills: uniqueLines(contract.skills || [], 12, 80)
  };
}

function splitJdLines(text = "") {
  return normalizeText(text)
    .split("\n")
    .map((line) => cleanLine(line, 160))
    .filter(Boolean)
    .filter((line) => !hasFallbackText(line));
}

function inferKeywords(job = {}, sources = []) {
  const allText = normalizeText([
    job.title || "",
    job.company || "",
    ...(Array.isArray(sources) ? sources : [])
  ]).toLowerCase();

  const candidates = ["ai", "agent", "product", "analysis", "strategy", "operations", "growth", "workflow"];
  return uniqueLines(candidates.filter((keyword) => allText.includes(keyword)), 8, 40);
}

function pickTopList(items = [], fallback = [], max = 5) {
  const cleaned = uniqueLines(items || [], max, 120);
  if (cleaned.length > 0) return cleaned;
  return uniqueLines(fallback || [], max, 120);
}

function buildJobSummaryModel(job = {}, fitAssessment = null, tailoringOutput = null) {
  const rawLines = splitJdLines(job.jdRaw || job.rawJdText || job.descriptionText || "");

  const responsibilities = pickTopList(
    job.jdStructured?.responsibilities || [],
    rawLines.slice(0, 5),
    5
  );
  const requirements = pickTopList(
    [...(job.jdStructured?.requirements || []), ...(job.jdStructured?.preferredQualifications || [])],
    rawLines.slice(5, 10),
    5
  );

  const targetKeywords = pickTopList(
    tailoringOutput?.targetingBrief?.targetKeywords || inferKeywords(job, [...responsibilities, ...requirements]),
    inferKeywords(job, [...responsibilities, ...requirements]),
    8
  );

  return {
    roleSummary: cleanLine(job.jdStructured?.summary || job.title || DEFAULT_ROLE_SUMMARY, 120),
    coreResponsibilities: responsibilities,
    coreRequirements: requirements,
    targetKeywords,
    riskNotes: uniqueLines(fitAssessment?.riskFlags || [], 2, 80),
    weakSignalNote: ""
  };
}

function scoreTextAgainstJob(text = "", jobSummary = {}) {
  const source = normalizeText(text).toLowerCase();
  const tokens = uniqueLines(
    [
      ...(jobSummary.targetKeywords || []),
      ...(jobSummary.coreResponsibilities || []),
      ...(jobSummary.coreRequirements || [])
    ],
    20,
    80
  ).map((item) => item.toLowerCase());

  return tokens.reduce((score, token) => (token && source.includes(token) ? score + 2 : score), 0);
}

function rankAndTrimBullets(bullets = [], jobSummary = {}, max = 3) {
  return sanitizeBulletList(bullets, 8)
    .sort((left, right) => scoreTextAgainstJob(right, jobSummary) - scoreTextAgainstJob(left, jobSummary))
    .slice(0, max);
}

function buildTailoredEntries(entries = [], kind = "work", jobSummary = {}) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const normalized = kind === "work"
        ? normalizeWorkEntry(entry, index)
        : normalizeProjectEntry(entry, index);

      return {
        ...normalized,
        bullets: rankAndTrimBullets(normalized.bullets, jobSummary, kind === "work" ? 3 : 2)
      };
    })
    .filter((entry) => kind === "work"
      ? entry.company || entry.role || entry.bullets.length
      : entry.projectName || entry.role || entry.bullets.length);
}

function buildTailoredSelfSummary(draftSummary = "", baseSummary = "", jobSummary = {}) {
  const preferred = cleanLine(draftSummary, 160);
  if (preferred && !hasFallbackText(preferred) && !containsPersonalInfo(preferred)) return preferred;

  const base = cleanLine(baseSummary, 160);
  if (base && !hasFallbackText(base) && !containsPersonalInfo(base)) return base;

  const keywords = (jobSummary.targetKeywords || []).slice(0, 3).join(", ");
  if (keywords) {
    return cleanLine(`Focuses on ${keywords} with proven execution and collaboration.`, 160);
  }

  return DEFAULT_SUMMARY;
}

function buildTailoredWorkspaceResume(tailoringOutput = null, baseResumeAsset = {}, jobSummary = {}) {
  const draft = tailoringOutput?.workspaceDraft || {};
  const sourceWork = Array.isArray(draft.workExperience) && draft.workExperience.length
    ? draft.workExperience
    : baseResumeAsset.workExperience || [];
  const sourceProject = Array.isArray(draft.projectExperience) && draft.projectExperience.length
    ? draft.projectExperience
    : baseResumeAsset.projectExperience || [];

  const workExperience = buildTailoredEntries(sourceWork, "work", jobSummary).slice(0, 3);
  const projectExperience = buildTailoredEntries(sourceProject, "project", jobSummary).slice(0, 2);
  const selfEvaluation = buildTailoredSelfSummary(
    draft.selfEvaluation || tailoringOutput?.tailoredSummary || "",
    baseResumeAsset.selfSummary || "",
    jobSummary
  );

  const totalChars =
    selfEvaluation.length +
    [...workExperience, ...projectExperience].flatMap((entry) => entry.bullets || []).join("").length;
  const totalBullets =
    workExperience.reduce((sum, entry) => sum + entry.bullets.length, 0) +
    projectExperience.reduce((sum, entry) => sum + entry.bullets.length, 0);

  return {
    workExperience,
    projectExperience,
    selfEvaluation,
    education: [],
    skills: uniqueLines(baseResumeAsset.skills || [], 12, 80),
    lengthBudget: {
      status: totalChars > 1900 || totalBullets > 8 ? "over_budget" : "within_budget",
      totalChars,
      totalBullets,
      notes: totalChars > 1900 || totalBullets > 8
        ? ["Content is slightly long. Keep only evidence that directly supports this role."]
        : ["Content length is within one-page resume budget."]
    }
  };
}

function selectStrongestEntity(baseResumeAsset = {}, jobSummary = {}) {
  const entries = [
    ...(baseResumeAsset.workExperience || []).map((entry) => ({
      label: [entry.company, entry.role].filter(Boolean).join(" / "),
      score: scoreTextAgainstJob([entry.company, entry.role, ...(entry.bullets || [])].join(" "), jobSummary)
    })),
    ...(baseResumeAsset.projectExperience || []).map((entry) => ({
      label: [entry.projectName, entry.role].filter(Boolean).join(" / "),
      score: scoreTextAgainstJob([entry.projectName, entry.role, ...(entry.bullets || [])].join(" "), jobSummary)
    }))
  ];

  return entries.sort((left, right) => right.score - left.score)[0]?.label || "your most relevant experience";
}

function buildWorkspaceInsights(jobSummary = {}, baseResumeAsset = {}) {
  const strongest = selectStrongestEntity(baseResumeAsset, jobSummary);
  const biggestGap = uniqueLines(jobSummary.riskNotes || [], 1, 100)[0] || "add clearer evidence for key role requirements";

  return {
    headline: cleanLine(`This role emphasizes ${(jobSummary.targetKeywords || []).slice(0, 2).join(", ") || "execution and collaboration"}.`, 140),
    strongestMatch: cleanLine(`Your strongest match is ${strongest}.`, 140),
    biggestGap: cleanLine(`Current biggest gap: ${biggestGap}.`, 140),
    nextEditFocus: "Prioritize the most relevant work bullet first, then tighten project evidence."
  };
}

function formatEntryText(entry = {}, kind = "work") {
  const title = kind === "project"
    ? [entry.projectName || "", entry.role || "", entry.timeRange || ""].filter(Boolean).join(" / ")
    : [entry.company || "", entry.role || "", entry.timeRange || ""].filter(Boolean).join(" / ");

  return [title, ...(entry.bullets || [])].filter(Boolean).join("\n");
}

function buildWorkspaceReviewModules(baseResumeAsset = {}, tailoredResume = {}) {
  return [
    {
      key: "work_experience",
      title: "Work Experience",
      reason: "Move role-relevant work evidence to the top and keep bullets concise.",
      items: (baseResumeAsset.workExperience || []).slice(0, 3).map((entry, index) => ({
        bulletId: entry.id || `work_module_${index + 1}`,
        original: formatEntryText(entry, "work"),
        tailored: formatEntryText((tailoredResume.workExperience || [])[index] || entry, "work")
      }))
    },
    {
      key: "project_experience",
      title: "Project Experience",
      reason: "Highlight outcomes, ownership, and delivery impact from projects.",
      items: (baseResumeAsset.projectExperience || []).slice(0, 2).map((entry, index) => ({
        bulletId: entry.id || `project_module_${index + 1}`,
        original: formatEntryText(entry, "project"),
        tailored: formatEntryText((tailoredResume.projectExperience || [])[index] || entry, "project")
      }))
    },
    {
      key: "self_summary",
      title: "Self Summary",
      reason: "Keep one concise value statement aligned with this role.",
      items: baseResumeAsset.selfSummary || tailoredResume.selfEvaluation
        ? [
            {
              bulletId: "summary_module_1",
              original: baseResumeAsset.selfSummary || "",
              tailored: tailoredResume.selfEvaluation || ""
            }
          ]
        : []
    }
  ].filter((module) => module.items.length > 0);
}

module.exports = {
  buildJobSummaryModel,
  normalizeResumeWorkspaceAsset,
  normalizeResumeWorkspaceAssetFromMasterResume,
  buildTailoredWorkspaceResume,
  buildWorkspaceInsights,
  buildWorkspaceReviewModules
};
