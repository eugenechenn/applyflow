"use strict";

const {
  normalizeResumeAuditText,
  splitAuditLines,
  buildStructuredWorkExperience,
  buildStructuredProjectExperience,
  buildStructuredEducation,
  extractCanonicalSkillTokens,
  parseWorkHeader,
  parseProjectHeader,
  isPersonalInfoLine,
  isEducationLine,
  isSelfSummaryLine
} = require("../resume/resume-structuring-audit");

function unique(items = [], max = 8) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").trim())
    .filter((item) => {
      if (!item) return false;
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

function truncate(value = "", max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function sanitizeDisplayText(value = "") {
  return String(value || "")
    .replace(/建议人工补充确认/g, "")
    .replace(/暂无可展示的核心职责/g, "")
    .replace(/暂无可展示的核心要求/g, "")
    .replace(/未清晰列出/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function removePlaceholders(items = []) {
  return unique(items, 20).filter(
    (item) => !/建议人工补充确认|未清晰列出|暂无可展示|待补充|未知/i.test(item)
  );
}

function splitJdLines(text = "") {
  return String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^[•·▪●■-]\s*/, "").trim())
    .filter(Boolean);
}

function extractLinesUnderHeadings(text = "", headingPatterns = [], stopPatterns = [], limit = 6) {
  const lines = splitJdLines(text);
  const results = [];
  let active = false;

  for (const line of lines) {
    if (headingPatterns.some((pattern) => pattern.test(line))) {
      active = true;
      continue;
    }
    if (active && stopPatterns.some((pattern) => pattern.test(line))) break;
    if (active) results.push(line);
  }

  return removePlaceholders(results).slice(0, limit);
}

function inferKeywords(job = {}, lines = []) {
  const source = [
    ...(job.jdStructured?.keywords || []),
    ...(job.jdStructured?.requirements || []),
    ...(job.jdStructured?.responsibilities || []),
    ...lines
  ].join("\n");

  const candidateTokens = [
    "AI",
    "AI Agent",
    "工作流",
    "工程化落地",
    "流程搭建",
    "SOP",
    "文档整理",
    "需求理解",
    "项目推进",
    "复盘",
    "数据分析",
    "跨部门协同",
    "平台操作"
  ];

  const hits = candidateTokens.filter((token) => source.includes(token));
  return unique(hits.length ? hits : lines.map((line) => truncate(line, 18)), 8);
}

function buildJobSummaryModel(job = {}, fitAssessment = null, tailoringOutput = null) {
  const rawText = job.jdRaw || job.rawJdText || job.descriptionText || "";
  const responsibilities = removePlaceholders([
    ...(job.jdStructured?.responsibilities || []),
    ...extractLinesUnderHeadings(
      rawText,
      [/岗位职责/i, /工作职责/i, /工作内容/i, /你将负责/i],
      [/任职要求/i, /任职资格/i, /我们希望/i, /你需要具备/i, /加分项/i],
      5
    )
  ]).slice(0, 5);

  const requirements = removePlaceholders([
    ...(job.jdStructured?.requirements || []),
    ...(job.jdStructured?.preferredQualifications || []),
    ...extractLinesUnderHeadings(
      rawText,
      [/任职要求/i, /任职资格/i, /我们希望/i, /你需要具备/i],
      [/加分项/i, /优先条件/i, /工作地点/i, /岗位职责/i],
      5
    )
  ]).slice(0, 5);

  const targetKeywords = removePlaceholders(
    tailoringOutput?.targetingBrief?.targetKeywords?.length
      ? tailoringOutput.targetingBrief.targetKeywords
      : inferKeywords(job, [...responsibilities, ...requirements])
  ).slice(0, 8);

  const riskNotes = removePlaceholders((fitAssessment?.riskFlags || []).slice(0, 1));

  return {
    roleSummary:
      truncate(
        sanitizeDisplayText(
          job.jdStructured?.summary ||
            `${job.title || "该岗位"}最看重 ${targetKeywords.slice(0, 3).join("、") || "执行推进、文档整理与协同能力"}，更适合有真实项目推进与流程梳理经验的候选人。`
        ),
        120
      ) || "系统已根据岗位原文整理出核心职责、任职要求与关键词。",
    coreResponsibilities: responsibilities.length
      ? responsibilities.map((item) => sanitizeDisplayText(item)).filter(Boolean)
      : ["协助推进重点业务或项目落地", "配合团队完成资料整理与流程梳理", "在真实业务场景中支持执行与复盘"],
    coreRequirements: requirements.length
      ? requirements.map((item) => sanitizeDisplayText(item)).filter(Boolean)
      : ["具备基础的沟通、执行与学习能力", "能快速理解岗位场景并完成资料整理", "愿意在真实业务中持续迭代"],
    targetKeywords: targetKeywords.map((item) => sanitizeDisplayText(item)).filter(Boolean),
    riskNotes: riskNotes.map((item) => sanitizeDisplayText(item)).filter(Boolean),
    weakSignalNote:
      responsibilities.length < 2 || requirements.length < 2
        ? "部分岗位重点来自原文归纳，建议投递前再快速核对一次 JD。"
        : ""
  };
}

const SECTION_PATTERNS = {
  personal: /^(个人信息|基本信息|联系方式|联系信息)$/i,
  work: /^(工作经历|工作经验|实习经历|任职经历)$/i,
  project: /^(项目经历|项目经验|项目实践)$/i,
  summary: /^(自我评价|个人评价|个人优势|个人简介|个人总结)$/i,
  education: /^(教育背景|教育经历|学习经历)$/i,
  skills: /^(技能|专业技能|工具技能|能力标签)$/i
};

function sectionKeyForHeading(line = "") {
  if (SECTION_PATTERNS.personal.test(line)) return "personal";
  if (SECTION_PATTERNS.work.test(line)) return "work";
  if (SECTION_PATTERNS.project.test(line)) return "project";
  if (SECTION_PATTERNS.summary.test(line)) return "summary";
  if (SECTION_PATTERNS.education.test(line)) return "education";
  if (SECTION_PATTERNS.skills.test(line)) return "skills";
  return "";
}

function splitResumeSections(cleanedText = "") {
  const text = normalizeResumeAuditText(cleanedText);
  const lines = splitAuditLines(text);
  const sections = {
    personal: [],
    work: [],
    project: [],
    summary: [],
    education: [],
    skills: [],
    unknown: []
  };

  let current = "unknown";
  lines.forEach((line) => {
    const headingKey = sectionKeyForHeading(line);
    if (headingKey) {
      current = headingKey;
      return;
    }
    sections[current].push(line);
  });

  return sections;
}

function asBullets(lines = [], max = 6) {
  return unique(
    (Array.isArray(lines) ? lines : [])
      .map((line) => String(line || "").replace(/^[•·▪●■-]\s*/, "").trim())
      .filter(Boolean)
      .filter((line) => line.length >= 4)
      .filter((line) => !isPersonalInfoLine(line))
      .filter((line) => !isEducationLine(line)),
    max
  );
}

function parseEntityEntries(lines = [], kind = "work") {
  const list = Array.isArray(lines) ? lines : [];
  const results = [];
  let current = null;

  const pushCurrent = () => {
    if (!current || !current.header) return;
    results.push({
      header: current.header,
      bullets: asBullets(current.bullets)
    });
  };

  const isHeader = (line) => (kind === "project" ? Boolean(parseProjectHeader(line).timeRange) : Boolean(parseWorkHeader(line).timeRange));

  list.forEach((line) => {
    if (isHeader(line)) {
      pushCurrent();
      current = { header: line, bullets: [] };
      return;
    }
    if (!current) return;
    current.bullets.push(line);
  });

  pushCurrent();
  return results;
}

function buildFallbackEntitiesFromStructured(structured = {}) {
  return {
    workExperience: buildStructuredWorkExperience(structured.workExperience || structured.experience || []),
    projectExperience: buildStructuredProjectExperience(structured.projectExperience || structured.projects || []),
    education: buildStructuredEducation(structured.educationItems || structured.education || [])
  };
}

function inferPersonalInfo(text = "", structured = {}, profile = {}) {
  const normalized = normalizeResumeAuditText(text);
  const emailMatch = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = normalized.match(/1\d{10}/);
  const leadingName = splitAuditLines(normalized).find(
    (line) => /^[\u4e00-\u9fa5]{2,4}$/.test(line) && !sectionKeyForHeading(line)
  );

  return {
    name: structured.name || profile.name || leadingName || "",
    email: structured.email || profile.email || (emailMatch ? emailMatch[0] : ""),
    phone: structured.phone || profile.phone || (phoneMatch ? phoneMatch[0] : ""),
    location: structured.location || ""
  };
}

function extractSelfSummary(structured = {}, sections = {}, resumeDocument = null, profile = {}) {
  const explicit = asBullets(sections.summary || [], 6)
    .filter((line) => !isPersonalInfoLine(line))
    .filter((line) => !isEducationLine(line))
    .filter((line) => isSelfSummaryLine(line))
    .join(" ");
  return truncate(structured.summary || explicit || resumeDocument?.summary || profile.background || "", 220);
}

function sanitizeWorkEntries(entries = []) {
  return (entries || [])
    .filter((entry) => entry?.company || entry?.role)
    .map((entry) => ({
      ...entry,
      bullets: asBullets(entry.bullets || [], 6)
        .filter((line) => !/大学|学院|本科|硕士|邮箱|手机|出生年月|姓名|籍贯/i.test(line))
    }))
    .filter((entry) => entry.bullets.length || entry.company || entry.role);
}

function sanitizeProjectEntries(entries = []) {
  return (entries || [])
    .filter((entry) => entry?.projectName || entry?.role)
    .map((entry) => ({
      ...entry,
      bullets: asBullets(entry.bullets || [], 6)
        .filter((line) => !/邮箱|手机|出生年月|姓名|籍贯/i.test(line))
    }))
    .filter((entry) => entry.bullets.length || entry.projectName);
}

function normalizeResumeWorkspaceAsset(resumeDocument = null, profile = {}) {
  const structured = resumeDocument?.structuredProfile || {};
  const cleanedText = resumeDocument?.cleanedText || structured.cleanedText || structured.rawText || "";
  const sections = splitResumeSections(cleanedText);
  const fallbackEntities = buildFallbackEntitiesFromStructured(structured);

  const workExperience = sanitizeWorkEntries(
    buildStructuredWorkExperience(parseEntityEntries(sections.work || [], "work"))
  );
  const projectExperience = sanitizeProjectEntries(
    buildStructuredProjectExperience(parseEntityEntries(sections.project || [], "project"))
  );
  const education = buildStructuredEducation(
    (sections.education || [])
      .filter((line) => isEducationLine(line))
      .map((line) => ({ header: line, bullets: [] }))
  );
  const selfSummary = extractSelfSummary(structured, sections, resumeDocument, profile);

  return {
    id: resumeDocument?.id || "resume_asset_current",
    name: resumeDocument?.fileName || "原始简历",
    personalInfo: inferPersonalInfo(cleanedText, structured, profile),
    workExperience: workExperience.length ? workExperience : fallbackEntities.workExperience,
    projectExperience: projectExperience.length ? projectExperience : fallbackEntities.projectExperience,
    selfSummary,
    education: education.length ? education : fallbackEntities.education,
    skills: unique(
      extractCanonicalSkillTokens([...(structured.skills || []), ...(sections.skills || [])]),
      12
    )
  };
}

function sanitizeWorkspaceDraftEntries(entries = [], kind = "work") {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const id = entry?.id || `${kind}_${index + 1}`;
      return {
        ...entry,
        id,
        bullets: asBullets(entry?.bullets || [], 6)
      };
    })
    .filter((entry) => {
      if (kind === "work") return entry.company || entry.role || entry.bullets.length;
      return entry.projectName || entry.role || entry.bullets.length;
    });
}

function buildTailoredWorkspaceResume(tailoringOutput = null, baseResumeAsset = {}) {
  if (!tailoringOutput) {
    return {
      workExperience: [],
      projectExperience: [],
      selfEvaluation: "",
      education: [],
      lengthBudget: { status: "within_budget", totalChars: 0, totalBullets: 0, notes: [] }
    };
  }

  const draft = tailoringOutput.workspaceDraft || {};
  const workExperience = sanitizeWorkspaceDraftEntries(
    draft.workExperience || baseResumeAsset.workExperience || [],
    "work"
  ).slice(0, 3);
  const projectExperience = sanitizeWorkspaceDraftEntries(
    draft.projectExperience || baseResumeAsset.projectExperience || [],
    "project"
  ).slice(0, 2);
  const selfEvaluation = truncate(
    sanitizeDisplayText(draft.selfEvaluation || tailoringOutput.tailoredSummary || baseResumeAsset.selfSummary || ""),
    140
  );

  const totalChars =
    selfEvaluation.length +
    [...workExperience, ...projectExperience]
      .flatMap((entry) => entry.bullets || [])
      .join("").length;
  const totalBullets =
    workExperience.reduce((sum, entry) => sum + (entry.bullets || []).length, 0) +
    projectExperience.reduce((sum, entry) => sum + (entry.bullets || []).length, 0);

  return {
    workExperience,
    projectExperience,
    selfEvaluation,
    education: [],
    skills: baseResumeAsset.skills || [],
    lengthBudget: {
      status: totalChars > 1900 || totalBullets > 8 ? "over_budget" : "within_budget",
      totalChars,
      totalBullets,
      notes:
        totalChars > 1900 || totalBullets > 8
          ? ["当前内容偏长，建议继续压缩低相关描述，控制到一页纸简历长度。"]
          : ["当前长度接近一页纸约束，可继续微调措辞后进入申请准备。"]
    }
  };
}

function buildWorkspaceInsights(job = {}, fitAssessment = null, jobSummary = {}, baseResumeAsset = {}) {
  const strongestWork = baseResumeAsset.workExperience?.[0];
  const strongestProject = baseResumeAsset.projectExperience?.[0];
  const strongestMatch = strongestWork
    ? `${strongestWork.company}${strongestWork.role ? ` 的${strongestWork.role}` : ""}`
    : strongestProject
      ? `${strongestProject.projectName}${strongestProject.role ? `（${strongestProject.role}）` : ""}`
      : "最相关的一段真实经历";

  const biggestGap =
    (fitAssessment?.keyGaps || [])[0] ||
    (jobSummary.riskNotes || [])[0] ||
    "还需要把最贴近岗位要求的经历表达得更聚焦。";

  const keywordFocus = (jobSummary.targetKeywords || []).slice(0, 2).join("、") || "岗位最相关信号";

  return {
    headline:
      fitAssessment?.recommendation === "apply"
        ? `这条岗位值得推进，重点是把 ${keywordFocus} 相关经历放到更靠前的位置。`
        : fitAssessment?.recommendation === "cautious"
          ? `这条岗位可以尝试，但需要先把 ${keywordFocus} 表达得更清晰。`
          : "这条岗位优先级偏低，除非你能用更强的相关经历支撑，否则不建议投入太多时间。",
    strongestMatch: `你当前最能打动这个岗位的内容，是 ${strongestMatch} 这段经历。`,
    biggestGap: `当前最大短板是：${biggestGap}`,
    nextEditFocus: `下一步最值得先改的是与 ${keywordFocus} 最接近的那一段经历。`
  };
}

function formatEntryText(entry = {}, kind = "work") {
  if (!entry) return "";
  const title =
    kind === "project"
      ? [entry.projectName || entry.name || "", entry.role || "", entry.timeRange || ""].filter(Boolean).join(" / ")
      : [entry.company || "", entry.role || "", entry.timeRange || ""].filter(Boolean).join(" / ");
  return [title, ...(entry.bullets || [])].filter(Boolean).join("\n");
}

function buildWorkspaceReviewModules(baseResumeAsset = {}, tailoredResume = {}) {
  return [
    {
      key: "work_experience",
      title: "工作经历优化",
      reason: "把最贴近岗位要求的工作经历前置，并压缩低相关背景描述。",
      items: (baseResumeAsset.workExperience || []).slice(0, 3).map((entry, index) => ({
        bulletId: entry.id || `work_module_${index + 1}`,
        original: formatEntryText(entry, "work"),
        tailored: formatEntryText(tailoredResume.workExperience?.[index] || entry, "work"),
        reason: "优先展示与岗位关键词最接近的动作、协同对象和结果。"
      }))
    },
    {
      key: "project_experience",
      title: "项目经历优化",
      reason: "突出项目里的分析、方案、落地和复盘能力。",
      items: (baseResumeAsset.projectExperience || []).slice(0, 2).map((entry, index) => ({
        bulletId: entry.id || `project_module_${index + 1}`,
        original: formatEntryText(entry, "project"),
        tailored: formatEntryText(tailoredResume.projectExperience?.[index] || entry, "project"),
        reason: "让项目模块更直接体现你拆解问题、推进方案和输出结果的能力。"
      }))
    },
    {
      key: "self_summary",
      title: "个人优势优化",
      reason: "把自我评价收敛成一句更贴近当前岗位的简历摘要。",
      items: [
        {
          bulletId: "summary_module_1",
          original: baseResumeAsset.selfSummary || "",
          tailored: tailoredResume.selfEvaluation || "",
          reason: "只保留最能支撑岗位判断的定位，不混入个人信息或系统说明。"
        }
      ].filter((item) => item.original || item.tailored)
    }
  ].filter((module) => module.items.length);
}

module.exports = {
  buildJobSummaryModel,
  normalizeResumeWorkspaceAsset,
  buildTailoredWorkspaceResume,
  buildWorkspaceInsights,
  buildWorkspaceReviewModules
};
