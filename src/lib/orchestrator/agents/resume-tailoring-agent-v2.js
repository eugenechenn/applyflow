const { createId, nowIso } = require("../../utils/id");
const { generateResumeTailoring, getLlmConfig } = require("../../llm/applyflow-llm-service");

function pickTopItems(items = [], max = 5) {
  return (Array.isArray(items) ? items : []).filter(Boolean).slice(0, max);
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitKeywords(value = "") {
  return String(value || "")
    .split(/[,\n/|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function trimBullet(text = "", max = 165) {
  const normalized = normalizeText(text)
    .replace(/[。；;]+$/g, "")
    .replace(/\s*[-–—]\s*/g, "，");
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function compressResumeLine(text = "", max = 165) {
  return trimBullet(
    String(text || "")
      .replace(/^[•·▪●■\-]\s*/, "")
      .replace(/^(负责|参与|支持)\s*/u, "")
      .replace(/(建议|请|可考虑|优先|尝试)[^。；;]*$/u, "")
      .replace(/，{2,}/g, "，"),
    max
  );
}

function refineResumeBullet(text = "", prompt = "", jdRequirement = "") {
  const base = compressResumeLine(text, 165);
  const instruction = normalizeText(prompt);
  if (!instruction) return base;

  let refined = base;
  if (/太长|压缩|精简|更短|concise|short/i.test(instruction)) {
    refined = compressResumeLine(base, 118);
  }
  if (/结果|impact|outcome|量化/i.test(instruction) && !/结果|提升|增长|效率|转化|impact|outcome/i.test(refined)) {
    refined = trimBullet(`${refined}，补足结果或影响表达`, 150);
  }
  if (/协同|合作|跨团队|stakeholder/i.test(instruction) && !/协同|合作|跨团队/i.test(refined)) {
    refined = trimBullet(`${refined}，突出跨团队协同推进`, 150);
  }
  if (/AI|智能体|大模型|LLM|agent/i.test(instruction) && !/AI|智能体|大模型|LLM|agent/i.test(refined)) {
    refined = trimBullet(`${refined}，强调 AI 工具落地相关性`, 150);
  }
  if (/保守|不要写太满|不要过度/i.test(instruction)) {
    refined = refined.replace(/主导|全面负责|核心推动/g, "参与推进");
  }
  if (/强调|突出|更重/i.test(instruction) && jdRequirement && !refined.includes(jdRequirement)) {
    refined = trimBullet(`${refined}，对齐 ${jdRequirement}`, 150);
  }
  return refined;
}

function estimateLengthBudget({
  summary = "",
  workExperience = [],
  projectExperience = [],
  skills = []
}) {
  const totalChars = [summary, ...workExperience, ...projectExperience, ...skills]
    .map((item) => String(item || "").trim())
    .join("")
    .length;
  const totalBullets = workExperience.length + projectExperience.length;
  const withinBudget = totalChars <= 1900 && totalBullets <= 8;
  const notes = [];
  if ((summary || "").length > 140) notes.push("摘要建议压缩到 140 字以内。");
  if (totalBullets > 8) notes.push("经历条目偏多，建议只保留最相关的 6-8 条。");
  if (totalChars > 1900) notes.push("整体仍偏长，距离一页纸导出还有压缩空间。");
  if (skills.length > 10) notes.push("技能关键词偏多，建议只保留最贴近岗位的 6-10 个。");
  return {
    target: "一页纸简历",
    totalChars,
    totalBullets,
    status: withinBudget ? "within_budget" : "over_budget",
    notes
  };
}

function buildTailoredResumeSections({
  tailoredSummary,
  rewrittenBullets,
  selectedProjects,
  selectedSkills,
  resumeSnapshot,
  targetKeywords
}) {
  const summary = trimBullet(tailoredSummary || resumeSnapshot.summary || "", 140);
  const workExperience = pickTopItems(
    rewrittenBullets
      .filter((item) => item.status !== "rejected")
      .map((item) => trimBullet(item.after || item.rewritten || item.suggestion || "", 150))
      .filter(Boolean),
    5
  );
  const projectExperience = pickTopItems(
    (selectedProjects || [])
      .map((item) => compressResumeLine(item.text || item, 140))
      .filter(Boolean),
    3
  );
  const skills = pickTopItems(
    (selectedSkills && selectedSkills.length ? selectedSkills : targetKeywords || [])
      .map((item) => normalizeText(item))
      .filter(Boolean),
    10
  );

  return {
    summary,
    workExperience,
    projectExperience,
    skills,
    education: pickTopItems(resumeSnapshot.education || [], 3),
    lengthBudget: estimateLengthBudget({
      summary,
      workExperience,
      projectExperience,
      skills
    })
  };
}

function buildResumeSnapshot(resumeDocument = null, profile = {}) {
  const structured = resumeDocument?.structuredProfile || resumeDocument?.structured || {};
  return {
    sourceResumeId: resumeDocument?.id || null,
    fileName: resumeDocument?.fileName || "未上传原始简历",
    status: resumeDocument?.parseStatus || resumeDocument?.status || "missing",
    parseQuality: resumeDocument?.parseQuality || null,
    parseWarning: resumeDocument?.parseWarning || "",
    summary:
      structured.summary ||
      resumeDocument?.summary ||
      String(resumeDocument?.cleanedText || "").slice(0, 1200) ||
      profile.masterResume ||
      profile.baseResume ||
      "",
    experience: pickTopItems(structured.experience || [], 8),
    projects: pickTopItems(structured.projects || [], 5),
    skills: pickTopItems(structured.skills || [], 16),
    education: pickTopItems(structured.education || [], 4),
    achievements: pickTopItems(structured.achievements || structured.highlights || [], 8),
    cleanedText: resumeDocument?.cleanedText || "",
    extractionMethod: resumeDocument?.extractionMethod || "profile_master_resume"
  };
}

function scoreEvidence(item, keywords = [], boosts = []) {
  const text = String(item || "").toLowerCase();
  let score = 0;
  keywords.forEach((keyword) => {
    const normalized = String(keyword || "").toLowerCase();
    if (!normalized) return;
    if (text.includes(normalized)) score += 3;
    normalized.split(/\s+/).forEach((token) => {
      if (token.length >= 3 && text.includes(token)) score += 1;
    });
  });
  boosts.forEach((boost) => {
    if (text.includes(String(boost || "").toLowerCase())) score += 2;
  });
  if (/\d+%|\d+x|\d+\+/.test(text)) score += 2;
  if (/lead|own|drove|built|launched|defined|协调|主导|推动|负责|上线|增长|策略|产品|分析/i.test(text)) {
    score += 1;
  }
  return score;
}

function extractTargetKeywords(job = {}, fitAssessment = null) {
  const base = [
    ...(job.jdStructured?.keywords || []),
    ...(job.jdStructured?.requirements || []),
    ...(job.jdStructured?.responsibilities || []),
    ...(fitAssessment?.whyApply || [])
  ];

  const expanded = base.flatMap((item) => splitKeywords(item));
  const deduped = [];
  expanded.forEach((item) => {
    const normalized = normalizeText(item);
    if (!normalized) return;
    if (!deduped.find((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
      deduped.push(normalized);
    }
  });
  return deduped.slice(0, 10);
}

function selectResumeEvidence(resumeSnapshot, targetKeywords, fitAssessment) {
  const boosts = [
    ...(fitAssessment?.whyApply || []),
    ...(fitAssessment?.riskFlags || []),
    ...(fitAssessment?.keyGaps || [])
  ];

  const scoredExperience = (resumeSnapshot.experience || [])
    .map((item, index) => ({
      id: `exp_${index + 1}`,
      kind: "experience",
      text: item,
      score: scoreEvidence(item, targetKeywords, boosts)
    }))
    .sort((a, b) => b.score - a.score);

  const scoredProjects = (resumeSnapshot.projects || [])
    .map((item, index) => ({
      id: `proj_${index + 1}`,
      kind: "project",
      text: item,
      score: scoreEvidence(item, targetKeywords, boosts)
    }))
    .sort((a, b) => b.score - a.score);

  return {
    selectedExperience: scoredExperience.slice(0, 3),
    selectedProjects: scoredProjects.slice(0, 2),
    selectedSkills: pickTopItems(
      [
        ...targetKeywords,
        ...(resumeSnapshot.skills || []).filter((skill) => scoreEvidence(skill, targetKeywords, boosts) > 0)
      ],
      10
    ),
    deEmphasizedItems: scoredExperience
      .slice(3)
      .filter((item) => item.score <= 1)
      .map((item) => item.text)
      .slice(0, 3)
  };
}

function buildRuleBasedRewrite(item, job, targetKeywords, index) {
  const keyword = targetKeywords[index] || targetKeywords[0] || job.title || "岗位重点";
  return `${item.text}。建议把与 ${keyword} 最相关的动作、协作对象和结果放到前半句，突出你如何定义问题、推进执行并拿到结果。`;
}

function applyRefinePrompt(text, refinePrompt = "") {
  const baseText = normalizeText(text);
  const prompt = normalizeText(refinePrompt);
  if (!prompt) return baseText;
  if (/简洁|精炼|concise|short/i.test(prompt)) {
    return baseText.replace(/，[^，。；]{18,}[。]?$/, "。");
  }
  if (/强调|突出|highlight|emphas/i.test(prompt)) {
    return `${baseText} 这版会额外突出与目标岗位最相关的影响力和结果。`;
  }
  return `${baseText} 补充要求：${prompt}。`;
}

function normalizeTailoringBullets(items = [], selectedExperience = [], targetKeywords = [], job = {}) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const sourceItem = selectedExperience[index] || {};
      const before = normalizeText(item.before || item.source || sourceItem.text || "");
      const suggestion = normalizeText(item.suggestion || item.rewritten || item.after || "");
      const reason =
        normalizeText(item.reason) ||
        `这条经历与 ${targetKeywords[index] || targetKeywords[0] || job.title || "岗位"} 的核心要求最接近，因此被优先强化。`;
      if (!before && !suggestion) return null;
      return {
        bulletId: item.bulletId || `tailored_bullet_${index + 1}`,
        sourceId: item.sourceId || sourceItem.id || `resume_item_${index + 1}`,
        type: item.type || (before && suggestion ? "modified" : before ? "deleted" : "added"),
        before,
        after: normalizeText(item.after || item.rewritten || item.suggestion || ""),
        source: before,
        suggestion,
        rewritten: normalizeText(item.rewritten || item.after || item.suggestion || ""),
        status: ["pending", "accepted", "rejected"].includes(item.status) ? item.status : "pending",
        reason,
        jdRequirement:
          normalizeText(item.jdRequirement) ||
          normalizeText(job.jdStructured?.requirements?.[index] || job.jdStructured?.responsibilities?.[index] || targetKeywords[index] || ""),
        goal: normalizeText(item.goal) || "让招聘方更快看到与你最相关的真实能力证据。",
        evidenceAnchor: normalizeText(item.evidenceAnchor || sourceItem.text || before || "")
      };
    })
    .filter(Boolean);
}

function buildExplainability({ rewrittenBullets, selectedExperience, targetKeywords, fitAssessment, job }) {
  return rewrittenBullets.map((item, index) => ({
    id: `tailoring_reason_${index + 1}`,
    bulletId: item.bulletId,
    title: `改写理由 ${index + 1}`,
    before: item.before || "暂无原始表述",
    after: item.after || "暂无改写表述",
    reason:
      item.reason ||
      (selectedExperience[index]?.score > 3
        ? `这段经历与 ${job.title} 的核心要求重合度最高，因此被优先前置并增强结果表达。`
        : `这段经历能够补足岗位对 ${targetKeywords[index] || "核心能力"} 的判断，因此被保留并改写。`),
    jdRequirement:
      item.jdRequirement ||
      job.jdStructured?.requirements?.[index] ||
      job.jdStructured?.responsibilities?.[index] ||
      targetKeywords[index] ||
      "请继续结合 JD 原文微调这条表达。",
    goal:
      item.goal ||
      (fitAssessment?.recommendation === "cautious"
        ? "降低短板感知并提高可信度"
        : "强化岗位匹配度，让招聘方更快看到关键证据"),
    evidenceAnchor: item.evidenceAnchor || selectedExperience[index]?.text || "来自原始简历中的真实经历，不新增事实。"
  }));
}

function buildDiffItems({ resumeSnapshot, rewrittenBullets, tailoredSummary, whyMe }) {
  const diff = [];

  if (tailoredSummary && normalizeText(tailoredSummary) !== normalizeText(resumeSnapshot.summary || "")) {
    diff.push({
      type: "modified",
      section: "summary",
      before: normalizeText(resumeSnapshot.summary || ""),
      after: normalizeText(tailoredSummary),
      reason: "根据 JD 重点重新组织个人定位摘要，让岗位匹配点更靠前。"
    });
  }

  if (whyMe) {
    diff.push({
      type: "added",
      section: "why_me",
      before: "",
      after: normalizeText(whyMe),
      reason: "新增“为什么适合这个岗位”的表达，帮助用户更快用于投递与面试叙事。"
    });
  }

  rewrittenBullets.forEach((item) => {
    diff.push({
      type: item.type || "modified",
      section: "experience",
      bulletId: item.bulletId,
      before: item.before || "",
      after: item.after || "",
      reason: item.reason || "根据 JD 关键词重排并强化这条经历。"
    });
  });

  return diff;
}

function buildDiffView({ resumeSnapshot, rewrittenBullets, orderingPlan, tailoredSummary, whyMe }) {
  const diffItems = buildDiffItems({ resumeSnapshot, rewrittenBullets, tailoredSummary, whyMe });
  return {
    original: {
      summary: resumeSnapshot.summary || "",
      experienceBullets: pickTopItems(resumeSnapshot.experience || [], 6)
    },
    tailored: {
      summary: tailoredSummary || resumeSnapshot.summary || "",
      whyMe: whyMe || "",
      experienceBullets: rewrittenBullets.map((item) => item.after || item.rewritten || "").filter(Boolean)
    },
    diff: diffItems,
    summaryChanged: Boolean(tailoredSummary),
    positioningChanged: Boolean(whyMe),
    changedBulletCount: rewrittenBullets.length,
    reorderedSections: orderingPlan,
    bulletDiffs: rewrittenBullets.map((item) => ({
      bulletId: item.bulletId,
      before: item.before || "",
      after: item.after || "",
      reason: item.reason || ""
    }))
  };
}

function buildTailoredPreview({
  tailoredSummary,
  whyMe,
  rewrittenBullets,
  selectedProjects,
  selectedSkills,
  resumeSnapshot,
  targetKeywords
}) {
  return {
    summary: tailoredSummary || resumeSnapshot.summary || "暂无定制摘要。",
    positioning: whyMe || "暂无岗位适配说明。",
    experienceBullets: rewrittenBullets
      .filter((item) => item.status !== "rejected")
      .map((item) => item.after || item.rewritten)
      .filter(Boolean)
      .slice(0, 5),
    projectHighlights: pickTopItems(selectedProjects.map((item) => item.text), 4),
    skills: pickTopItems(selectedSkills, 12),
    education: pickTopItems(resumeSnapshot.education || [], 3),
    keywords: pickTopItems(targetKeywords || [], 8)
  };
}

function buildCoverageReport(job = {}, targetKeywords = [], selectedEvidence = [], fitAssessment = null) {
  const requirements = job.jdStructured?.requirements || [];
  const coveredRequirements = [];
  const partiallyCoveredRequirements = [];
  const uncoveredRequirements = [];
  const selectedText = selectedEvidence.map((item) => String(item.text || "").toLowerCase()).join("\n");

  requirements.forEach((requirement) => {
    const normalized = String(requirement || "").toLowerCase();
    if (!normalized) return;
    const tokens = normalized.split(/\s+/).filter((token) => token.length >= 3);
    const overlap = tokens.filter((token) => selectedText.includes(token)).length;
    if (overlap >= 2) coveredRequirements.push(requirement);
    else if (overlap >= 1) partiallyCoveredRequirements.push(requirement);
    else uncoveredRequirements.push(requirement);
  });

  (fitAssessment?.keyGaps || []).forEach((gap) => {
    if (!uncoveredRequirements.includes(gap)) {
      partiallyCoveredRequirements.push(gap);
    }
  });

  return {
    coveredRequirements: pickTopItems(coveredRequirements, 6),
    partiallyCoveredRequirements: pickTopItems(partiallyCoveredRequirements, 6),
    uncoveredRequirements: pickTopItems(uncoveredRequirements, 6),
    highlightedKeywords: pickTopItems(targetKeywords, 8)
  };
}

function buildRuleBasedRewrite(item, job, targetKeywords, index) {
  const keyword = targetKeywords[index] || targetKeywords[0] || job.title || "岗位重点";
  const base = compressResumeLine(item.text, 150);
  if (!base) return "";
  if (base.includes(keyword)) return base;
  return trimBullet(`${base}，突出与 ${keyword} 最相关的成果`, 150);
}

function buildDiffItems({ resumeSnapshot, rewrittenBullets, tailoredSummary }) {
  const diff = [];

  if (tailoredSummary && normalizeText(tailoredSummary) !== normalizeText(resumeSnapshot.summary || "")) {
    diff.push({
      type: "modified",
      section: "summary",
      before: normalizeText(resumeSnapshot.summary || ""),
      after: normalizeText(tailoredSummary),
      reason: "围绕岗位重点重写了简历摘要，让匹配信号更靠前。"
    });
  }

  rewrittenBullets.forEach((item) => {
    diff.push({
      type: item.type || "modified",
      section: item.section || "work_experience",
      bulletId: item.bulletId,
      before: item.before || "",
      after: item.after || "",
      reason: item.reason || "根据岗位关键词重排并强化了这条经历表达。"
    });
  });

  return diff;
}

function buildDiffView({ resumeSnapshot, rewrittenBullets, orderingPlan, tailoredSummary }) {
  const diffItems = buildDiffItems({ resumeSnapshot, rewrittenBullets, tailoredSummary });
  const tailoredSections = buildTailoredResumeSections({
    tailoredSummary,
    rewrittenBullets,
    selectedProjects: [],
    selectedSkills: [],
    resumeSnapshot,
    targetKeywords: []
  });
  return {
    original: {
      summary: resumeSnapshot.summary || "",
      workExperience: pickTopItems(resumeSnapshot.experience || [], 6),
      projectExperience: pickTopItems(resumeSnapshot.projects || [], 4),
      skills: pickTopItems(resumeSnapshot.skills || [], 12)
    },
    tailored: {
      summary: tailoredSections.summary,
      workExperience: tailoredSections.workExperience,
      projectExperience: tailoredSections.projectExperience,
      skills: tailoredSections.skills
    },
    diff: diffItems,
    summaryChanged: Boolean(tailoredSummary),
    positioningChanged: false,
    changedBulletCount: rewrittenBullets.length,
    reorderedSections: orderingPlan,
    bulletDiffs: rewrittenBullets.map((item) => ({
      bulletId: item.bulletId,
      before: item.before || "",
      after: item.after || "",
      reason: item.reason || "",
      jdRequirement: item.jdRequirement || "",
      status: item.status || "pending"
    }))
  };
}

function buildResumeSnapshot(resumeDocument = null, profile = {}) {
  const structured = resumeDocument?.structuredProfile || resumeDocument?.structured || {};
  const workExperience = (structured.workExperience || []).map((entry, index) => ({
    id: entry.id || `work_${index + 1}`,
    company: entry.company || "",
    role: entry.role || "",
    timeRange: entry.timeRange || "",
    bullets: pickTopItems(entry.bullets || [], 4),
    displayTitle: entry.displayTitle || [entry.timeRange, entry.company, entry.role].filter(Boolean).join(" ")
  }));
  const projectExperience = (structured.projectExperience || []).map((entry, index) => ({
    id: entry.id || `project_${index + 1}`,
    name: entry.name || "",
    role: entry.role || "",
    timeRange: entry.timeRange || "",
    bullets: pickTopItems(entry.bullets || [], 4),
    displayTitle: entry.displayTitle || [entry.timeRange, entry.name, entry.role].filter(Boolean).join(" ")
  }));
  const education = (structured.educationItems || []).map((entry, index) => ({
    id: entry.id || `edu_${index + 1}`,
    school: entry.school || "",
    major: entry.major || "",
    timeRange: entry.timeRange || "",
    displayTitle: entry.displayTitle || [entry.timeRange, entry.school, entry.major].filter(Boolean).join(" ")
  }));

  return {
    sourceResumeId: resumeDocument?.id || null,
    fileName: resumeDocument?.fileName || "未上传原始简历",
    status: resumeDocument?.parseStatus || resumeDocument?.status || "missing",
    parseQuality: resumeDocument?.parseQuality || null,
    parseWarning: resumeDocument?.parseWarning || "",
    summary:
      structured.summary ||
      resumeDocument?.summary ||
      String(resumeDocument?.cleanedText || "").slice(0, 1200) ||
      profile.masterResume ||
      profile.baseResume ||
      "",
    workExperience,
    projectExperience,
    education,
    skills: pickTopItems(structured.skills || [], 16),
    achievements: pickTopItems(structured.achievements || structured.highlights || [], 8),
    cleanedText: resumeDocument?.cleanedText || "",
    extractionMethod: resumeDocument?.extractionMethod || "profile_master_resume",
    experience: workExperience.map((entry) => [entry.displayTitle, ...(entry.bullets || [])].filter(Boolean).join("｜")),
    projects: projectExperience.map((entry) => [entry.displayTitle, ...(entry.bullets || [])].filter(Boolean).join("｜"))
  };
}

function normalizeTailoringBullets(items = [], selectedExperience = [], targetKeywords = [], job = {}) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const sourceItem = selectedExperience[index] || {};
      const before = normalizeText(item.before || item.source || sourceItem.text || "");
      const suggestion = compressResumeLine(item.suggestion || item.rewritten || item.after || "", 145);
      if (!before && !suggestion) return null;
      return {
        bulletId: item.bulletId || `tailored_bullet_${index + 1}`,
        sourceId: item.sourceId || sourceItem.id || `resume_item_${index + 1}`,
        type: item.type || "modified",
        before,
        after: compressResumeLine(item.after || item.rewritten || item.suggestion || "", 145),
        source: before,
        suggestion,
        rewritten: compressResumeLine(item.rewritten || item.after || item.suggestion || "", 145),
        status: ["pending", "accepted", "rejected"].includes(item.status) ? item.status : "pending",
        reason:
          normalizeText(item.reason) ||
          `这条经历最接近 ${targetKeywords[index] || targetKeywords[0] || job.title || "岗位重点"}，因此优先保留并前置。`,
        jdRequirement:
          normalizeText(item.jdRequirement) ||
          normalizeText(job.jdStructured?.requirements?.[index] || job.jdStructured?.responsibilities?.[index] || targetKeywords[index] || ""),
        goal: normalizeText(item.goal) || "让招聘方更快看到与你最相关的真实能力证据。",
        evidenceAnchor: normalizeText(item.evidenceAnchor || sourceItem.text || before || "")
      };
    })
    .filter(Boolean);
}

function buildTailoredResumeSections({
  tailoredSummary,
  rewrittenBullets,
  selectedProjects,
  selectedSkills,
  resumeSnapshot,
  targetKeywords
}) {
  const summary = compressResumeLine(tailoredSummary || resumeSnapshot.summary || "", 140);
  const workExperience = (resumeSnapshot.workExperience || []).slice(0, 5).map((entry, index) => {
    const rewritten = (rewrittenBullets || []).filter((item) => item.status !== "rejected")[index];
    return {
      ...entry,
      bullets: rewritten
        ? [compressResumeLine(rewritten.after || rewritten.rewritten || rewritten.suggestion || "", 145)]
        : pickTopItems(entry.bullets || [], 4)
    };
  });
  const projectExperience = ((selectedProjects || []).length ? selectedProjects : resumeSnapshot.projectExperience || [])
    .slice(0, 3)
    .map((entry, index) => ({
      id: entry.id || `project_${index + 1}`,
      name: entry.name || entry.text || "",
      role: entry.role || "",
      timeRange: entry.timeRange || "",
      bullets: pickTopItems(entry.bullets || [compressResumeLine(entry.text || "", 135)].filter(Boolean), 4),
      displayTitle: entry.displayTitle || [entry.timeRange, entry.name || entry.text, entry.role].filter(Boolean).join(" ")
    }));
  const skills = pickTopItems(
    (selectedSkills && selectedSkills.length ? selectedSkills : targetKeywords || [])
      .map((item) => normalizeText(item))
      .filter((item) => item && item.length <= 40),
    10
  );

  return {
    summary,
    selfEvaluation: summary,
    workExperience,
    projectExperience,
    skills,
    education: pickTopItems(resumeSnapshot.education || [], 3),
    lengthBudget: estimateLengthBudget({
      summary,
      workExperience: workExperience.flatMap((entry) => entry.bullets || []),
      projectExperience: projectExperience.flatMap((entry) => entry.bullets || []),
      skills
    })
  };
}

function buildDiffView({ resumeSnapshot, rewrittenBullets, orderingPlan, tailoredSummary }) {
  const tailoredSections = buildTailoredResumeSections({
    tailoredSummary,
    rewrittenBullets,
    selectedProjects: resumeSnapshot.projectExperience || [],
    selectedSkills: resumeSnapshot.skills || [],
    resumeSnapshot,
    targetKeywords: []
  });
  return {
    original: {
      summary: resumeSnapshot.summary || "",
      workExperience: resumeSnapshot.workExperience || [],
      projectExperience: resumeSnapshot.projectExperience || [],
      education: resumeSnapshot.education || []
    },
    tailored: {
      summary: tailoredSections.summary,
      workExperience: tailoredSections.workExperience,
      projectExperience: tailoredSections.projectExperience,
      education: tailoredSections.education
    },
    diff: (rewrittenBullets || []).map((item) => ({
      type: item.type || "modified",
      section: "work_experience",
      bulletId: item.bulletId,
      before: item.before || "",
      after: item.after || "",
      reason: item.reason || ""
    })),
    summaryChanged: Boolean(tailoredSummary),
    positioningChanged: false,
    changedBulletCount: (rewrittenBullets || []).length,
    reorderedSections: orderingPlan,
    bulletDiffs: (rewrittenBullets || []).map((item) => ({
      bulletId: item.bulletId,
      before: item.before || "",
      after: item.after || "",
      reason: item.reason || "",
      jdRequirement: item.jdRequirement || "",
      status: item.status || "pending"
    }))
  };
}

function buildTailoredPreview({
  tailoredSummary,
  whyMe,
  rewrittenBullets,
  selectedProjects,
  selectedSkills,
  resumeSnapshot,
  targetKeywords
}) {
  const sections = buildTailoredResumeSections({
    tailoredSummary,
    rewrittenBullets,
    selectedProjects,
    selectedSkills,
    resumeSnapshot,
    targetKeywords
  });

  return {
    ...sections,
    experienceBullets: sections.workExperience.flatMap((entry) => entry.bullets || []),
    projectHighlights: sections.projectExperience.flatMap((entry) => entry.bullets || []),
    keywords: pickTopItems(targetKeywords || [], 8),
    prepNarrative: whyMe || ""
  };
}

function buildTailoringOutputShape({
  job,
  profile,
  resumeDocument,
  fitAssessment,
  resumeSnapshot,
  targetKeywords,
  selection,
  rewrittenBullets,
  tailoredSummary,
  whyMe,
  explainability,
  orderingPlan,
  status,
  llmMeta,
  version = 1
}) {
  const diffView = buildDiffView({
    resumeSnapshot,
    rewrittenBullets,
    orderingPlan,
    tailoredSummary,
    whyMe
  });

  return {
    id: createId("tailoring"),
    jobId: job.id,
    profileId: profile.id,
    resumeDocumentId: resumeDocument?.id || null,
    status,
    version,
    resumeSnapshot,
    targetingBrief: {
      targetKeywords,
      mustHaveRequirements: pickTopItems(job.jdStructured?.requirements || [], 5),
      niceToHaveRequirements: pickTopItems(job.jdStructured?.preferredQualifications || [], 4),
      prioritySignals: pickTopItems(job.jdStructured?.responsibilities || [], 4),
      riskSignals: pickTopItems(fitAssessment?.riskFlags || job.jdStructured?.riskFlags || [], 4),
      roleNarrative: tailoredSummary
    },
    selectionPlan: {
      selectedExperienceIds: selection.selectedExperience.map((item) => item.id),
      selectedProjectIds: selection.selectedProjects.map((item) => item.id),
      selectedSkills: selection.selectedSkills,
      deEmphasizedItems: selection.deEmphasizedItems,
      orderingPlan
    },
    original: {
      summary: resumeSnapshot.summary || "",
      experienceBullets: pickTopItems(resumeSnapshot.experience || [], 6),
      skills: pickTopItems(resumeSnapshot.skills || [], 12),
      projects: pickTopItems(resumeSnapshot.projects || [], 4)
    },
    tailored: {
      summary: tailoredSummary || resumeSnapshot.summary || "",
      experienceBullets: rewrittenBullets.map((item) => item.after || item.rewritten).filter(Boolean),
      skills: selection.selectedSkills,
      projects: pickTopItems(selection.selectedProjects.map((item) => item.text), 4)
    },
    diff: diffView.diff,
    rewrittenBullets,
    tailoredSummary,
    whyMe,
    prepNarrative: {
      whyMe: whyMe || ""
    },
    explainability,
    diffView,
    coverageReport: buildCoverageReport(
      job,
      targetKeywords,
      [...selection.selectedExperience, ...selection.selectedProjects],
      fitAssessment
    ),
    tailoredResumePreview: buildTailoredPreview({
      tailoredSummary,
      whyMe,
      rewrittenBullets,
      selectedProjects: selection.selectedProjects,
      selectedSkills: selection.selectedSkills,
      resumeSnapshot,
      targetKeywords
    }),
    whyThisVersion:
      fitAssessment?.recommendation === "cautious"
        ? "这版定制优先缓解岗位短板感知，并把最强的可迁移证据放到前面。"
        : "这版定制优先放大与你最匹配的岗位证据，让招聘方更快看到相关性。",
    decisionSummary: `已基于 JD 与原始简历筛出 ${selection.selectedExperience.length} 条高相关经历，并生成 ${rewrittenBullets.length} 条可编辑改写建议。`,
    stageOutputSummary: `已完成岗位定制简历初稿，关键词 ${targetKeywords.length} 个，改写建议 ${rewrittenBullets.length} 条。`,
    stageDecisionReason: "系统先从 JD 提取优先信号，再从原始简历中选择、重排并强化最相关的真实经历。",
    decisionBreakdown: {
      jdKeywordCount: targetKeywords.length,
      selectedExperienceCount: selection.selectedExperience.length,
      selectedProjectCount: selection.selectedProjects.length,
      changedBulletCount: rewrittenBullets.length,
      fallbackUsed: llmMeta?.fallbackUsed !== false
    },
    llmMeta,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function runRuleBasedResumeTailoringAgent({
  job,
  profile,
  fitAssessment = null,
  resumeDocument = null,
  refinePrompt = ""
}) {
  const resumeSnapshot = buildResumeSnapshot(resumeDocument, profile);
  const targetKeywords = extractTargetKeywords(job, fitAssessment);
  const selection = selectResumeEvidence(resumeSnapshot, targetKeywords, fitAssessment);
  const rewrittenBullets = normalizeTailoringBullets(
    selection.selectedExperience.map((item, index) => ({
      sourceId: item.id,
      before: item.text,
      suggestion: buildRuleBasedRewrite(item, job, targetKeywords, index),
      status: "pending",
      reason:
        item.score > 3
          ? `这段经历和 ${job.title} 的核心要求最接近，因此被优先强化并前置。`
          : `这段经历能够支撑 ${targetKeywords[index] || "岗位重点"}，因此被保留并做表达增强。`,
      jdRequirement:
        job.jdStructured?.requirements?.[index] ||
        job.jdStructured?.responsibilities?.[index] ||
        targetKeywords[index] ||
        ""
    })),
    selection.selectedExperience,
    targetKeywords,
    job
  );

  const tailoredSummary =
    `${job.title} 这条岗位最看重的是 ${pickTopItems(targetKeywords, 3).join("、") || "产品判断与推进能力"}。` +
    "我会在这版简历中优先突出最贴近这些要求的真实经历，帮助招聘方更快建立“你适合这条岗位”的判断。";
  const whyMe =
    `结合当前岗位要求与我的原始简历，最值得强化的是 ${pickTopItems(selection.selectedSkills, 3).join("、") || "与岗位最相关的能力证据"}。` +
    "这版定制会把相关经历前置，并减少与该岗位判断无关的内容占位。";
  const refinedTailoredSummary = applyRefinePrompt(tailoredSummary, refinePrompt);
  const refinedWhyMe = applyRefinePrompt(whyMe, refinePrompt);
  const orderingPlan = ["summary", "experience", "projects", "skills"];
  const explainability = buildExplainability({
    rewrittenBullets,
    selectedExperience: selection.selectedExperience,
    targetKeywords,
    fitAssessment,
    job
  });

  return buildTailoringOutputShape({
    job,
    profile,
    resumeDocument,
    fitAssessment,
    resumeSnapshot,
    targetKeywords,
    selection,
    rewrittenBullets,
    tailoredSummary: refinedTailoredSummary,
    whyMe: refinedWhyMe,
    explainability,
    orderingPlan,
    status: "completed_with_fallback",
    llmMeta: {
      provider: "heuristic_fallback",
      model: null,
      fallbackUsed: true,
      errorSummary: null,
      latencyMs: null
    }
  });
}

async function runResumeTailoringAgent({
  job,
  profile,
  fitAssessment = null,
  resumeDocument = null,
  existingOutput = null,
  refinePrompt = ""
}) {
  const fallbackResult = runRuleBasedResumeTailoringAgent({
    job,
    profile,
    fitAssessment,
    resumeDocument,
    refinePrompt
  });
  const llmResult = await generateResumeTailoring({
    job,
    profile,
    fitAssessment,
    resumeDocument,
    fallbackResult,
    refinePrompt,
    existingOutput
  });

  const llmProvider = getLlmConfig().provider;
  const selectedExperience =
    fallbackResult.selectionPlan?.selectedExperienceIds?.map((id, index) => ({
      id,
      text: fallbackResult.original?.experienceBullets?.[index] || ""
    })) || [];

  const llmBullets = normalizeTailoringBullets(
    llmResult.ok ? llmResult.data.rewrittenBullets || [] : fallbackResult.rewrittenBullets || [],
    selectedExperience,
    fallbackResult.targetingBrief?.targetKeywords || [],
    job
  );

  const tailoredSummary = (llmResult.ok ? llmResult.data.tailoredSummary : null) || fallbackResult.tailoredSummary;
  const whyMe = (llmResult.ok ? llmResult.data.whyMe : null) || fallbackResult.whyMe;
  const explainability = buildExplainability({
    rewrittenBullets: llmBullets,
    selectedExperience,
    targetKeywords: fallbackResult.targetingBrief?.targetKeywords || [],
    fitAssessment,
    job
  });

  return {
    ...(existingOutput || {}),
    ...fallbackResult,
    id: existingOutput?.id || fallbackResult.id,
    jobId: job.id,
    profileId: profile.id,
    resumeDocumentId: resumeDocument?.id || existingOutput?.resumeDocumentId || null,
    rewrittenBullets: llmBullets,
    explainability,
    diff: buildDiffItems({
      resumeSnapshot: fallbackResult.resumeSnapshot,
      rewrittenBullets: llmBullets,
      tailoredSummary,
      whyMe
    }),
    diffView: buildDiffView({
      resumeSnapshot: fallbackResult.resumeSnapshot,
      rewrittenBullets: llmBullets,
      orderingPlan: fallbackResult.selectionPlan?.orderingPlan || ["summary", "experience", "projects", "skills"],
      tailoredSummary,
      whyMe
    }),
    tailoredSummary,
    whyMe,
    tailoredResumePreview: buildTailoredPreview({
      tailoredSummary,
      whyMe,
      rewrittenBullets: llmBullets,
      selectedProjects:
        fallbackResult.selectionPlan?.selectedProjectIds?.map((id, index) => ({
          id,
          text: fallbackResult.original?.projects?.[index] || ""
        })) || [],
      selectedSkills: fallbackResult.selectionPlan?.selectedSkills || [],
      resumeSnapshot: fallbackResult.resumeSnapshot,
      targetKeywords: fallbackResult.targetingBrief?.targetKeywords || []
    }),
    status: llmResult.ok ? "completed" : "completed_with_fallback",
    version: Number(existingOutput?.version || 0) + 1,
    refinePrompt: normalizeText(refinePrompt),
    createdAt: existingOutput?.createdAt || fallbackResult.createdAt,
    updatedAt: nowIso(),
    llmMeta: llmResult.ok
      ? {
          provider: llmProvider,
          model: llmResult.model,
          fallbackUsed: false,
          latencyMs: llmResult.latencyMs || null,
          errorSummary: null
        }
      : {
          provider: "heuristic_fallback",
          model: llmResult.model || null,
          fallbackUsed: true,
          latencyMs: llmResult.latencyMs || null,
          errorSummary: llmResult.errorSummary || null
        }
  };
}

function stripResumeExplanation(text = "") {
  return normalizeText(
    String(text || "")
      .replace(/建议[^。；;]*[。；;]?/gi, "")
      .replace(/可以[^。；;]*[。；;]?/gi, "")
      .replace(/应当[^。；;]*[。；;]?/gi, "")
      .replace(/把[^。；;]*放到前半句[^。；;]*[。；;]?/gi, "")
      .replace(/突出你如何[^。；;]*[。；;]?/gi, "")
      .replace(/已根据你的补充要求继续微调[:：]?\s*/gi, "")
      .replace(/\[(edited|refined)\]/gi, "")
      .replace(/[。；;]{2,}/g, "。")
      .replace(/[，,]{2,}/g, "，")
  );
}

function compressResumeLine(text = "", max = 165) {
  return trimBullet(
    stripResumeExplanation(
      String(text || "")
        .replace(/^[•·▪●■\-]\s*/, "")
        .replace(/^(负责|参与|支持)\s*/u, "")
    ),
    max
  );
}

function refineResumeBullet(text = "", prompt = "", jdRequirement = "") {
  const base = compressResumeLine(text, 150);
  const instruction = normalizeText(prompt);
  if (!instruction) return base;

  let refined = base;
  if (/太长|压缩|精简|更短|concise|short/i.test(instruction)) {
    refined = compressResumeLine(base, 110);
  }
  if (/结果|量化|impact|outcome/i.test(instruction) && !/提升|增长|效率|结果|impact|outcome/i.test(refined)) {
    refined = `${refined}，体现结果影响`;
  }
  if (/协同|合作|跨团队|stakeholder/i.test(instruction) && !/协同|合作|跨团队/i.test(refined)) {
    refined = `${refined}，协同跨团队推进落地`;
  }
  if (/AI|智能体|大模型|LLM|agent/i.test(instruction) && !/AI|智能体|大模型|LLM|agent/i.test(refined)) {
    refined = `${refined}，突出 AI 工具落地经验`;
  }
  if (/保守|不要写太满|不要过度/i.test(instruction)) {
    refined = refined.replace(/主导|全面负责|核心推动/g, "推动");
  }
  if (/强调|突出|更重/i.test(instruction) && jdRequirement && !refined.includes(jdRequirement)) {
    refined = `${refined}，贴合 ${jdRequirement}`;
  }
  return compressResumeLine(refined, 145);
}

function estimateLengthBudget({
  summary = "",
  workExperience = [],
  projectExperience = [],
  skills = []
}) {
  const totalChars = [summary, ...workExperience, ...projectExperience, ...skills]
    .map((item) => String(item || "").trim())
    .join("")
    .length;
  const totalBullets = workExperience.length + projectExperience.length;
  const withinBudget = totalChars <= 1900 && totalBullets <= 8;
  const notes = [];
  if ((summary || "").length > 140) notes.push("摘要建议控制在 140 字以内。");
  if (totalBullets > 8) notes.push("经历条目偏多，建议只保留最相关的 6-8 条。");
  if (totalChars > 1900) notes.push("整体内容偏长，距离一页纸导出仍有压缩空间。");
  if (skills.length > 10) notes.push("技能关键词偏多，建议保留 6-10 个最贴近岗位的关键词。");
  return {
    target: "一页纸简历",
    totalChars,
    totalBullets,
    status: withinBudget ? "within_budget" : "over_budget",
    notes
  };
}

function buildTailoredResumeSections({
  tailoredSummary,
  rewrittenBullets,
  selectedProjects,
  selectedSkills,
  resumeSnapshot,
  targetKeywords
}) {
  const summary = compressResumeLine(tailoredSummary || resumeSnapshot.summary || "", 140);
  const workExperience = pickTopItems(
    rewrittenBullets
      .filter((item) => item.status !== "rejected")
      .map((item) => compressResumeLine(item.after || item.rewritten || item.suggestion || "", 145))
      .filter(Boolean),
    5
  );
  const projectExperience = pickTopItems(
    (selectedProjects || [])
      .map((item) => compressResumeLine(item.text || item, 135))
      .filter(Boolean),
    3
  );
  const skills = pickTopItems(
    (selectedSkills && selectedSkills.length ? selectedSkills : targetKeywords || [])
      .map((item) => normalizeText(item))
      .filter((item) => item && item.length <= 40),
    10
  );

  return {
    summary,
    workExperience,
    projectExperience,
    skills,
    education: pickTopItems(resumeSnapshot.education || [], 3),
    lengthBudget: estimateLengthBudget({
      summary,
      workExperience,
      projectExperience,
      skills
    })
  };
}

function buildRuleBasedRewrite(item, job, targetKeywords, index) {
  const keyword = targetKeywords[index] || targetKeywords[0] || job.title || "岗位重点";
  const base = compressResumeLine(item.text, 135);
  if (!base) return "";
  if (base.includes(keyword)) return base;
  return compressResumeLine(`${base}，突出 ${keyword} 相关成果`, 145);
}

function buildResumeStyleSummary({ targetKeywords = [], selection = {}, resumeSnapshot = {} }) {
  const focusKeywords = pickTopItems(targetKeywords, 3);
  const strongestSignal =
    selection?.selectedExperience?.[0]?.text ||
    selection?.selectedProjects?.[0]?.text ||
    resumeSnapshot.summary ||
    "";
  const focusText = focusKeywords.length ? `聚焦 ${focusKeywords.join("、")}` : "聚焦岗位最相关的执行与协同能力";
  return compressResumeLine(`${focusText}，突出 ${truncateText(strongestSignal, 44)}`, 120);
}

function buildDiffView({ resumeSnapshot, rewrittenBullets, orderingPlan, tailoredSummary }) {
  const diffItems = buildDiffItems({ resumeSnapshot, rewrittenBullets, tailoredSummary });
  const tailoredSections = buildTailoredResumeSections({
    tailoredSummary,
    rewrittenBullets,
    selectedProjects: [],
    selectedSkills: [],
    resumeSnapshot,
    targetKeywords: []
  });
  return {
    original: {
      summary: resumeSnapshot.summary || "",
      workExperience: pickTopItems(resumeSnapshot.experience || [], 6),
      projectExperience: pickTopItems(resumeSnapshot.projects || [], 4),
      skills: pickTopItems(resumeSnapshot.skills || [], 12)
    },
    tailored: {
      summary: tailoredSections.summary,
      workExperience: tailoredSections.workExperience,
      projectExperience: tailoredSections.projectExperience,
      skills: tailoredSections.skills
    },
    diff: diffItems,
    summaryChanged: Boolean(tailoredSummary),
    positioningChanged: false,
    changedBulletCount: rewrittenBullets.length,
    reorderedSections: orderingPlan,
    bulletDiffs: rewrittenBullets.map((item) => ({
      bulletId: item.bulletId,
      before: item.before || "",
      after: compressResumeLine(item.after || "", 145),
      reason: item.reason || "",
      jdRequirement: item.jdRequirement || "",
      status: item.status || "pending"
    }))
  };
}

function buildTailoredPreview({
  tailoredSummary,
  whyMe,
  rewrittenBullets,
  selectedProjects,
  selectedSkills,
  resumeSnapshot,
  targetKeywords
}) {
  const sections = buildTailoredResumeSections({
    tailoredSummary,
    rewrittenBullets,
    selectedProjects,
    selectedSkills,
    resumeSnapshot,
    targetKeywords
  });

  return {
    ...sections,
    experienceBullets: sections.workExperience,
    projectHighlights: sections.projectExperience,
    keywords: pickTopItems(targetKeywords || [], 8),
    prepNarrative: whyMe || ""
  };
}

function buildRuleBasedRewrite(item, job, targetKeywords, index) {
  const keyword = targetKeywords[index] || targetKeywords[0] || job.title || "岗位重点";
  const base = compressResumeLine(item.text || "", 130);
  if (!base) return "";
  if (base.includes(keyword)) return base;
  return compressResumeLine(`${base}，突出与${keyword}相关的执行与结果`, 145);
}

function buildResumeStyleSummary({ targetKeywords = [], selection = {}, resumeSnapshot = {} }) {
  const focusKeywords = pickTopItems(targetKeywords, 3);
  const strongestSignal =
    selection?.selectedExperience?.[0]?.text ||
    selection?.selectedProjects?.[0]?.text ||
    resumeSnapshot.summary ||
    "";
  const focusText = focusKeywords.length ? `聚焦 ${focusKeywords.join("、")}` : "聚焦岗位最相关的执行与协同能力";
  return compressResumeLine(`${focusText}，优先突出 ${truncateText(strongestSignal, 40)}`, 120);
}

function runRuleBasedResumeTailoringAgent({
  job,
  profile,
  fitAssessment = null,
  resumeDocument = null,
  refinePrompt = ""
}) {
  const resumeSnapshot = buildResumeSnapshot(resumeDocument, profile);
  const targetKeywords = extractTargetKeywords(job, fitAssessment);
  const selection = selectResumeEvidence(resumeSnapshot, targetKeywords, fitAssessment);
  const rewrittenBullets = normalizeTailoringBullets(
    selection.selectedExperience.map((item, index) => ({
      sourceId: item.id,
      before: item.text,
      suggestion: buildRuleBasedRewrite(item, job, targetKeywords, index),
      status: "pending",
      reason:
        item.score > 3
          ? `这段经历和 ${job.title} 的核心要求最接近，适合优先前置。`
          : `这段经历能支撑 ${targetKeywords[index] || "岗位重点"}，因此保留并压缩表达。`,
      jdRequirement:
        job.jdStructured?.requirements?.[index] ||
        job.jdStructured?.responsibilities?.[index] ||
        targetKeywords[index] ||
        ""
    })),
    selection.selectedExperience,
    targetKeywords,
    job
  );

  const tailoredSummary =
    `${job.title} 这条岗位最看重的是 ${pickTopItems(targetKeywords, 3).join("、") || "与岗位最相关的执行与协同能力"}。` +
    "这版简历会优先把最贴近这些要求的真实经历放到前面。";
  const whyMe =
    `结合当前岗位要求与原始简历，最值得强化的是 ${pickTopItems(selection.selectedSkills, 3).join("、") || "最相关的经历证据"}。` +
    "这版定制会减少弱相关内容占位。";
  const refinedTailoredSummary = applyRefinePrompt(tailoredSummary, refinePrompt);
  const refinedWhyMe = applyRefinePrompt(whyMe, refinePrompt);
  const orderingPlan = ["summary", "experience", "projects", "skills"];
  const explainability = buildExplainability({
    rewrittenBullets,
    selectedExperience: selection.selectedExperience,
    targetKeywords,
    fitAssessment,
    job
  });

  return buildTailoringOutputShape({
    job,
    profile,
    resumeDocument,
    fitAssessment,
    resumeSnapshot,
    targetKeywords,
    selection,
    rewrittenBullets,
    tailoredSummary: refinedTailoredSummary,
    whyMe: refinedWhyMe,
    explainability,
    orderingPlan,
    status: "completed_with_fallback",
    llmMeta: {
      provider: "heuristic_fallback",
      model: null,
      fallbackUsed: true,
      errorSummary: null,
      latencyMs: null
    }
  });
}

module.exports = {
  runResumeTailoringAgent,
  runRuleBasedResumeTailoringAgent,
  buildResumeSnapshot,
  buildTailoredPreview,
  buildTailoredResumeSections,
  buildDiffView,
  buildExplainability,
  normalizeTailoringBullets,
  refineResumeBullet,
  compressResumeLine
};
