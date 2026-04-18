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
  if (/lead|own|drove|built|launched|defined|协调|主导|推动|负责|上线|增长|策略|产品|分析/i.test(text)) score += 1;
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

  const selectedExperience = scoredExperience.slice(0, 3);
  const selectedProjects = scoredProjects.slice(0, 2);
  const selectedSkills = pickTopItems(
    [
      ...targetKeywords,
      ...(resumeSnapshot.skills || []).filter((skill) => scoreEvidence(skill, targetKeywords, boosts) > 0)
    ],
    10
  );

  const deEmphasizedItems = scoredExperience
    .slice(3)
    .filter((item) => item.score <= 1)
    .map((item) => item.text)
    .slice(0, 3);

  return {
    selectedExperience,
    selectedProjects,
    selectedSkills,
    deEmphasizedItems
  };
}

function buildRuleBasedRewrite(item, job, targetKeywords, index) {
  const keyword = targetKeywords[index] || targetKeywords[0] || job.title;
  return {
    source: item.text,
    rewritten: `${item.text}。建议在这一条中前置与你的 ${keyword} 相关动作与结果，突出你如何定义问题、推动协作并拿到可量化成果。`
  };
}

function buildExplainability({ rewrittenBullets, selectedExperience, targetKeywords, fitAssessment, job }) {
  return rewrittenBullets.map((item, index) => ({
    id: `tailoring_reason_${index + 1}`,
    title: `定制理由 ${index + 1}`,
    before: item.source || "暂无原始表述",
    after: item.rewritten || "暂无改写表述",
    reason:
      selectedExperience[index]?.score > 3
        ? `这段经历与 ${job.title} 的核心要求重合度最高，因此被优先前置并增强结果表达。`
        : `这段经历能补足岗位对 ${targetKeywords[index] || "核心能力"} 的判断，因此被保留并改写。`,
    jdRequirement:
      job.jdStructured?.requirements?.[index] ||
      job.jdStructured?.responsibilities?.[index] ||
      targetKeywords[index] ||
      "请继续结合 JD 原文微调这条表达。",
    goal:
      fitAssessment?.recommendation === "cautious"
        ? "降低短板感知并提高可信度"
        : "强化岗位匹配度，让招聘方更快看到关键证据",
    evidenceAnchor: selectedExperience[index]?.text || "来自原始简历中的真实经历，不新增事实。"
  }));
}

function buildTailoredPreview({ tailoredSummary, whyMe, rewrittenBullets, selectedProjects, selectedSkills, resumeSnapshot, targetKeywords }) {
  return {
    summary: tailoredSummary || resumeSnapshot.summary || "暂无定制摘要。",
    positioning: whyMe || "暂无岗位适配说明。",
    experienceBullets: rewrittenBullets.map((item) => item.rewritten).filter(Boolean).slice(0, 5),
    projectHighlights: pickTopItems(selectedProjects.map((item) => item.text), 4),
    skills: pickTopItems(selectedSkills, 12),
    education: pickTopItems(resumeSnapshot.education || [], 3),
    keywords: pickTopItems(targetKeywords || [], 8)
  };
}

function buildDiffView({ resumeSnapshot, rewrittenBullets, orderingPlan, tailoredSummary, whyMe }) {
  const originalBullets = pickTopItems(resumeSnapshot.experience || [], rewrittenBullets.length);
  return {
    summaryChanged: Boolean(tailoredSummary),
    positioningChanged: Boolean(whyMe),
    changedBulletCount: rewrittenBullets.length,
    reorderedSections: orderingPlan,
    bulletDiffs: rewrittenBullets.map((item, index) => ({
      before: originalBullets[index] || item.source || "",
      after: item.rewritten || ""
    }))
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

function runRuleBasedResumeTailoringAgent({ job, profile, fitAssessment = null, resumeDocument = null }) {
  const resumeSnapshot = buildResumeSnapshot(resumeDocument, profile);
  const targetKeywords = extractTargetKeywords(job, fitAssessment);
  const selection = selectResumeEvidence(resumeSnapshot, targetKeywords, fitAssessment);
  const rewrittenBullets = selection.selectedExperience.map((item, index) =>
    buildRuleBasedRewrite(item, job, targetKeywords, index)
  );

  const tailoredSummary =
    `${job.title} 这条岗位最看重的是 ${pickTopItems(targetKeywords, 3).join("、") || "产品判断与推进能力"}。` +
    `我会在这版简历中优先突出最接近这些要求的真实经历，帮助招聘方更快建立“你适合这条岗位”的判断。`;
  const whyMe =
    `结合当前岗位要求与我的原始简历，最值得强化的是 ${pickTopItems(selection.selectedSkills, 3).join("、") || "与岗位最相关的能力证据"}。` +
    `这版定制会把相关经历前置，并减少不直接服务这条岗位判断的内容占位。`;
  const orderingPlan = ["summary", "experience", "projects", "skills"];
  const explainability = buildExplainability({
    rewrittenBullets,
    selectedExperience: selection.selectedExperience,
    targetKeywords,
    fitAssessment,
    job
  });
  const diffView = buildDiffView({
    resumeSnapshot,
    rewrittenBullets,
    orderingPlan,
    tailoredSummary,
    whyMe
  });
  const coverageReport = buildCoverageReport(
    job,
    targetKeywords,
    [...selection.selectedExperience, ...selection.selectedProjects],
    fitAssessment
  );

  return {
    id: createId("tailoring"),
    jobId: job.id,
    profileId: profile.id,
    resumeDocumentId: resumeDocument?.id || null,
    status: "completed_with_fallback",
    version: 1,
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
    rewrittenBullets,
    tailoredSummary,
    whyMe,
    explainability,
    diffView,
    coverageReport,
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
      fallbackUsed: true
    },
    llmMeta: {
      provider: "heuristic_fallback",
      model: null,
      fallbackUsed: true,
      errorSummary: null,
      latencyMs: null
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

async function runResumeTailoringAgent({ job, profile, fitAssessment = null, resumeDocument = null, existingOutput = null }) {
  const fallbackResult = runRuleBasedResumeTailoringAgent({ job, profile, fitAssessment, resumeDocument });
  const llmResult = await generateResumeTailoring({
    job,
    profile,
    fitAssessment,
    resumeDocument,
    fallbackResult
  });

  const llmProvider = getLlmConfig().provider;
  const selectedBase = llmResult.ok ? llmResult.data : fallbackResult;

  return {
    ...(existingOutput || {}),
    ...fallbackResult,
    ...selectedBase,
    id: existingOutput?.id || fallbackResult.id,
    jobId: job.id,
    profileId: profile.id,
    resumeDocumentId: resumeDocument?.id || existingOutput?.resumeDocumentId || null,
    status: llmResult.ok ? "completed" : "completed_with_fallback",
    version: Number(existingOutput?.version || 0) + 1,
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

module.exports = {
  runResumeTailoringAgent,
  runRuleBasedResumeTailoringAgent,
  buildResumeSnapshot
};
