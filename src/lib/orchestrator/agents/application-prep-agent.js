const { createId, nowIso } = require("../../utils/id");
const { generatePrepDraft, getLlmConfig } = require("../../llm/applyflow-llm-service");
const { buildResumeSnapshot } = require("./resume-tailoring-agent-v2");

function splitLines(value) {
  return String(value || "")
    .split(/\n|•|·|▪|●|\-/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function pickTopItems(items = [], max = 4) {
  return (Array.isArray(items) ? items : []).filter(Boolean).slice(0, max);
}

function buildSourceAttribution({ label, sources = [] }) {
  return {
    label,
    sources: sources.filter(Boolean)
  };
}

function formatBulletLabel(item = {}, index = 0) {
  const before = String(item.before || item.source || "").trim();
  if (before) {
    return before.length > 88 ? `${before.slice(0, 88)}...` : before;
  }
  return `确认内容 ${index + 1}`;
}

function buildContentWithSources({ tailoredSummary, whyMe, selfIntro, qaDraft, talkingPoints, coverNote, outreachNote, acceptedBullets }) {
  const bulletSources = acceptedBullets.map((item, index) => ({
    type: "tailored_bullet",
    bulletId: item.bulletId,
    sourceId: item.sourceId || "",
    label: formatBulletLabel(item, index)
  }));

  return [
    {
      key: "tailored_summary",
      title: "定制摘要",
      text: tailoredSummary,
      ...buildSourceAttribution({ label: "基于已确认的经历重写生成", sources: bulletSources.slice(0, 2) })
    },
    {
      key: "why_me",
      title: "为什么适合我",
      text: whyMe,
      ...buildSourceAttribution({ label: "基于已确认内容与岗位要求生成", sources: bulletSources.slice(0, 3) })
    },
    {
      key: "self_intro_short",
      title: "自我介绍（短版）",
      text: selfIntro?.short || "",
      ...buildSourceAttribution({ label: "基于已确认经历浓缩而成", sources: bulletSources.slice(0, 2) })
    },
    {
      key: "self_intro_medium",
      title: "自我介绍（中版）",
      text: selfIntro?.medium || "",
      ...buildSourceAttribution({ label: "基于已确认经历扩展生成", sources: bulletSources.slice(0, 3) })
    },
    {
      key: "qa_draft",
      title: "问答草稿",
      text: (qaDraft || []).map((item) => `${item.question}：${item.draftAnswer}`).join("\n"),
      ...buildSourceAttribution({ label: "基于岗位关键词与确认内容整理", sources: bulletSources.slice(0, 3) })
    },
    {
      key: "talking_points",
      title: "沟通重点",
      text: (talkingPoints || []).join("\n"),
      ...buildSourceAttribution({ label: "基于已确认 bullet 提炼面试表达重点", sources: bulletSources.slice(0, 3) })
    },
    {
      key: "cover_note",
      title: "投递附言",
      text: coverNote || "",
      ...buildSourceAttribution({ label: "基于已确认内容与岗位关键词生成", sources: bulletSources.slice(0, 2) })
    },
    {
      key: "outreach_note",
      title: "外联附言",
      text: outreachNote || "",
      ...buildSourceAttribution({ label: "基于已确认内容压缩成外联表达", sources: bulletSources.slice(0, 2) })
    }
  ].filter((item) => String(item.text || "").trim());
}

function buildChecklist(existingChecklist = [], hasAcceptedBullets = false) {
  if (existingChecklist.length > 0) {
    return existingChecklist;
  }
  return [
    { key: "resume_reviewed", label: "简历改写已确认", completed: hasAcceptedBullets },
    { key: "intro_ready", label: "自我介绍已准备", completed: true },
    { key: "qa_ready", label: "问答草稿已准备", completed: true },
    { key: "talking_points_ready", label: "沟通重点已确认", completed: false },
    { key: "submit_ready", label: "投递路径已确认", completed: false }
  ];
}

function buildPrepFromTailoring({ job, profile, fitAssessment, resumeDocument, tailoringOutput }) {
  const resumeSnapshot = tailoringOutput?.resumeSnapshot || buildResumeSnapshot(resumeDocument, profile);
  const targetKeywords = tailoringOutput?.targetingBrief?.targetKeywords || [];
  const acceptedBullets = (tailoringOutput?.rewrittenBullets || []).filter((item) => item.status === "accepted");
  const unusedBullets = (tailoringOutput?.rewrittenBullets || []).filter((item) => item.status !== "accepted");
  const selfIntro = {
    short: `我具备与 ${job.title} 高度相关的问题拆解、协同推进与结果表达能力，能把复杂需求快速转成可执行方案。`,
    medium: `结合我现有的策略、产品与执行背景，我最能为 ${job.company} 这条 ${job.title} 岗位提供的价值，是把模糊问题转化成结构化推进路径，并在跨团队协作中持续把结果做出来。`
  };
  const tailoredSummary =
    tailoringOutput?.tailoredSummary ||
    `${job.title} 对我有吸引力，因为它要求把问题定义、跨团队推进和结果表达结合起来，而这些正是我希望继续强化的方向。`;
  const whyMe =
    tailoringOutput?.whyMe ||
    `我会优先突出与 ${job.company} 当前岗位最相关的真实经历与结果，让招聘方更快看到为什么我适合这条岗位。`;
  const qaDraft = [
    {
      question: "为什么想投这条岗位？",
      draftAnswer: `这条岗位和我当前的职业目标高度对齐，尤其是在 ${pickTopItems(targetKeywords, 2).join("、") || "产品判断与执行推进"} 方面。`
    },
    {
      question: "为什么你适合这个岗位？",
      draftAnswer: `我已经从原始简历中整理出最能证明岗位匹配度的经历，这些经历同时覆盖了 ${pickTopItems(targetKeywords, 3).join("、") || "核心岗位要求"}。`
    }
  ];
  const talkingPoints = [
    `优先讲清楚你为什么适合 ${job.company} 的 ${job.title}，并用一条最强经历作为开场。`,
    `准备一个可量化案例，回应岗位最核心的要求：${pickTopItems(targetKeywords, 2).join(" / ") || "核心职责"}。`,
    `如果面试官担心 ${pickTopItems(fitAssessment?.riskFlags || [], 2).join(" / ") || "短板问题"}，请提前准备回应。`
  ];
  const coverNote = `你好，我对 ${job.company} 的 ${job.title} 岗位很感兴趣，尤其认同这条岗位对 ${pickTopItems(targetKeywords, 2).join("、") || "核心能力"} 的重视。结合我过往的真实经历，我相信自己能较快进入状态并贡献明确结果。`;
  const outreachNote = `你好，我最近在系统梳理与 ${job.title} 相关的岗位，也认真研究了 ${job.company} 的这条机会。我的背景在 ${pickTopItems(targetKeywords, 2).join("、") || "关键能力"} 方面有直接关联，想进一步交流是否适合这条岗位。`;

  return {
    id: createId("prep"),
    jobId: job.id,
    profileId: profile.id,
    version: 1,
    resumeDocumentId: resumeDocument?.id || tailoringOutput?.resumeDocumentId || null,
    resumeSnapshot,
    resumeTailoring: {
      targetKeywords,
      rewriteBullets: acceptedBullets,
      usedBullets: acceptedBullets,
      unusedBullets,
      strengthenAreas:
        tailoringOutput?.selectionPlan?.selectedSkills?.slice(0, 4) ||
        pickTopItems(targetKeywords, 4),
      deEmphasizeAreas: tailoringOutput?.selectionPlan?.deEmphasizedItems || pickTopItems(fitAssessment?.keyGaps || [], 3),
      keywordSuggestions: pickTopItems(targetKeywords, 6)
    },
    selfIntro,
    tailoredSummary,
    whyMe,
    qaDraft,
    talkingPoints,
    coverNote,
    outreachNote,
    checklist: buildChecklist([], acceptedBullets.length > 0),
    tailoringReviewStatus: {
      acceptedBulletCount: acceptedBullets.length,
      pendingBulletCount: (tailoringOutput?.rewrittenBullets || []).filter((item) => item.status === "pending").length,
      rejectedBulletCount: (tailoringOutput?.rewrittenBullets || []).filter((item) => item.status === "rejected").length,
      warning:
        acceptedBullets.length === 0
          ? "你还没有确认任何简历改写项，申请准备不会自动带入 AI 改写内容。"
          : ""
    },
    contentWithSources: buildContentWithSources({
      tailoredSummary,
      whyMe,
      selfIntro,
      qaDraft,
      talkingPoints,
      coverNote,
      outreachNote,
      acceptedBullets
    }),
    tailoringExplainability: tailoringOutput?.explainability || [],
    tailoredResumePreview: tailoringOutput?.tailoredResumePreview || null,
    whyThisVersion:
      tailoringOutput?.whyThisVersion ||
      (fitAssessment?.recommendation === "cautious"
        ? "这版申请材料更强调可迁移能力与量化结果，用来回应当前岗位的短板和风险。"
        : "这版申请材料优先放大与你最匹配的能力证据，帮助招聘方更快建立岗位匹配判断。"),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

async function runApplicationPrepAgent({ job, profile, fitAssessment = null, resumeDocument = null, tailoringOutput = null }) {
  const fallbackResult = buildPrepFromTailoring({ job, profile, fitAssessment, resumeDocument, tailoringOutput });
  const acceptedBullets = (tailoringOutput?.rewrittenBullets || []).filter((item) => item.status === "accepted");
  const llmResult = await generatePrepDraft({
    job,
    profile: {
      ...profile,
      masterResume:
        resumeDocument?.cleanedText ||
        resumeDocument?.summary ||
        profile.masterResume ||
        profile.baseResume ||
        "",
      resumeDocument: resumeDocument
        ? {
            fileName: resumeDocument.fileName,
            cleanedText: resumeDocument.cleanedText || "",
            summary: resumeDocument.summary || "",
            structuredProfile: resumeDocument.structuredProfile || resumeDocument.structured || {}
          }
        : null,
      tailoringOutput: tailoringOutput
        ? {
            tailoredSummary: tailoringOutput.tailoredSummary || "",
            whyMe: tailoringOutput.whyMe || "",
            targetKeywords: tailoringOutput.targetingBrief?.targetKeywords || [],
            rewrittenBullets: acceptedBullets,
            explainability: tailoringOutput.explainability || []
          }
        : null
    },
    fallbackResult
  });

  const llmProvider = getLlmConfig().provider;
  const baseResult = !llmResult.ok
    ? {
        ...fallbackResult,
        llmMeta: {
          provider: "heuristic_fallback",
          model: llmResult.model,
          fallbackUsed: true,
          errorSummary: llmResult.errorSummary || null,
          latencyMs: llmResult.latencyMs || null
        }
      }
    : {
        ...fallbackResult,
        selfIntro: {
          short: llmResult.data.selfIntroShort || fallbackResult.selfIntro.short,
          medium: llmResult.data.selfIntroMedium || fallbackResult.selfIntro.medium
        },
        qaDraft: llmResult.data.qaDraft.length > 0 ? llmResult.data.qaDraft : fallbackResult.qaDraft,
        talkingPoints:
          llmResult.data.talkingPoints.length > 0 ? llmResult.data.talkingPoints : fallbackResult.talkingPoints,
        coverNote: llmResult.data.coverNote || fallbackResult.coverNote,
        outreachNote: llmResult.data.outreachNote || fallbackResult.outreachNote,
        llmMeta: {
          provider: llmProvider,
          model: llmResult.model,
          fallbackUsed: false,
          latencyMs: llmResult.latencyMs || null,
          errorSummary: null
        }
      };

  return {
    ...baseResult,
    checklist: buildChecklist(baseResult.checklist || fallbackResult.checklist || []),
    stageOutputSummary: `已生成申请准备包，问答草稿 ${baseResult.qaDraft?.length || 0} 条，沟通重点 ${(baseResult.talkingPoints || []).length} 条。`,
    stageDecisionReason: "系统复用了岗位定制简历结果，再补齐申请叙事、自我介绍和投递附言，形成可编辑的申请包。"
  };
}

module.exports = { runApplicationPrepAgent };
