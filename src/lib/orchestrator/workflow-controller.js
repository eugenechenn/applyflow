const store = require("../../server/store");
const { createId, nowIso } = require("../utils/id");
const jobStatusModule = require("../state/job-status");
const { updateJob } = require("./shared-state-helpers");
const { logActivity } = require("./activity-logger");
const { agentRegistry } = require("./agent-registry");
const { runAgentStage } = require("./stage-runner");
const logger = require("../../server/platform/logger");
const { exportTailoredResumeDocx } = require("../resume/resume-exporter");
const { parseResumeWithBestEffort, getResumeParserUrl } = require("../resume/resume-parser-client");
const { runRuleBasedResumeTailoringAgent, refineResumeBullet } = require("./agents/resume-tailoring-agent-v2");
const {
  buildJobSummaryModel,
  normalizeResumeWorkspaceAsset: normalizeResumeWorkspaceAssetModel,
  buildTailoredWorkspaceResume: buildTailoredWorkspaceResumeModel,
  buildWorkspaceInsights,
  buildWorkspaceReviewModules
} = require("../workspace/tailoring-workspace-model");

const assertJobStatusTransition =
  jobStatusModule?.assertJobStatusTransition ||
  function assertJobStatusTransitionFallback() {
    throw new Error("assertJobStatusTransition is not available.");
  };

function safeGetAllowedNextStatuses(currentStatus) {
  const resolver = jobStatusModule?.getAllowedNextStatuses;
  if (typeof resolver !== "function") {
    console.error("ApplyFlow: getAllowedNextStatuses is not available.", {
      currentStatus,
      availableKeys: Object.keys(jobStatusModule || {})
    });
    return [];
  }
  return resolver(currentStatus);
}

function safeGetRecommendedNextStatuses(currentStatus) {
  const resolver = jobStatusModule?.getRecommendedNextStatuses;
  if (typeof resolver !== "function") {
    console.error("ApplyFlow: getRecommendedNextStatuses is not available.", {
      currentStatus,
      availableKeys: Object.keys(jobStatusModule || {})
    });
    return [];
  }
  return resolver(currentStatus);
}

function summarizeList(items = [], fallback = "none") {
  return items.length ? items.join(" / ") : fallback;
}

function pickTopItems(items = [], max = 5) {
  return (Array.isArray(items) ? items : []).filter(Boolean).slice(0, max);
}

function truncateText(value, max = 200) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function normalizeLineItem(value = "", max = 220) {
  return truncateText(
    String(value || "")
      .replace(/^[•·▪●■\-]\s*/, "")
      .replace(/\s+/g, " ")
      .trim(),
    max
  );
}

function splitStructuredContent(value = "", max = 8) {
  return String(value || "")
    .split(/\n|•|·|▪|●|■|-/)
    .map((item) => normalizeLineItem(item))
    .filter((item) => item.length >= 4)
    .slice(0, max);
}

function dedupeStrings(items = [], max = 8) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeLineItem(item))
    .filter((item) => {
      if (!item) return false;
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

function looksLikePlaceholderNote(value = "") {
  return /人工补充|人工确认|未清晰列出|未明确列出|建议确认|待补充/i.test(String(value || ""));
}

function cleanWorkspaceJobLines(items = [], { max = 5, allowWeakNote = false } = {}) {
  const cleaned = dedupeStrings(items, max * 2).filter((item) => {
    if (!item) return false;
    if (looksLikePlaceholderNote(item)) return allowWeakNote;
    return true;
  });
  return cleaned.slice(0, max);
}

function normalizeJobWorkspaceSummary(job = {}, fitAssessment = null, tailoringOutput = null) {
  return buildJobSummaryModel(job, fitAssessment, tailoringOutput);
}

function classifyResumeEntry(entry = "") {
  const text = String(entry || "").trim();
  if (!text) return "other";
  if (/@|\+?\d[\d\s\-()]{7,}/.test(text)) return "contact";
  if (/(大学|学院|本科|硕士|博士|mba|bachelor|master|university|college|school)/i.test(text)) return "education";
  if (/(项目|project|launch|上线|实验|增长|策略项目)/i.test(text)) return "project";
  if (/(sql|python|excel|tableau|power bi|figma|notion|jira|ai|llm|agent|技能|tool)/i.test(text) && text.length <= 120) {
    return "skill";
  }
  if (/(产品|经理|分析|运营|strategy|manager|analyst|lead|director|实习|experience|work history|20\d{2}|19\d{2})/i.test(text)) {
    return "work";
  }
  return "other";
}

function normalizeResumeWorkspaceAsset(resumeDocument = null, profile = {}) {
  return normalizeResumeWorkspaceAssetModel(resumeDocument, profile);
}

function buildTailoredWorkspaceResume(tailoringOutput = null, baseResumeAsset = {}) {
  return buildTailoredWorkspaceResumeModel(tailoringOutput, baseResumeAsset);
}

function deriveRoleBucket(job) {
  const text = `${job.title} ${job.jdRaw || ""}`.toLowerCase();
  if (/ai product manager|product manager|pm/.test(text)) return "AI Product Manager";
  if (/strategy/.test(text)) return "Product Strategy";
  if (/operations|ops/.test(text)) return "Operations";
  if (/growth/.test(text)) return "Growth";
  return "Other";
}

function deriveIndustryBucket(job) {
  const text = `${job.company} ${job.title} ${job.jdRaw || ""}`.toLowerCase();
  if (/ai|agent|llm/.test(text)) return "AI";
  if (/enterprise|saas|software/.test(text)) return "Enterprise Software";
  if (/commerce|marketplace|consumer/.test(text)) return "Consumer";
  if (/advertising|media|ad tech/.test(text)) return "Advertising";
  if (/strategy/.test(text)) return "Strategy";
  return "General";
}

function buildBiasMap(seed = {}) {
  return { ...seed };
}

function adjustBias(target, key, delta) {
  if (!key) return;
  target[key] = Math.max(-12, Math.min(12, Number(target[key] || 0) + delta));
}

function priorityWeight(priority) {
  return { high: 3, medium: 2, low: 1 }[priority] || 0;
}

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function listChangedPolicyFields(previous = {}, next = {}) {
  const keys = [
    "preferredRoles",
    "riskyRoles",
    "preferredIndustries",
    "riskyIndustries",
    "preferredLocations",
    "riskyLocations",
    "successPatterns",
    "failurePatterns",
    "focusMode",
    "riskTolerance"
  ];

  return keys.filter((key) => JSON.stringify(previous[key] || null) !== JSON.stringify(next[key] || null));
}

function createPolicyVersion(policy = {}) {
  return `${policy.id || "policy"}@${policy.version || 0}`;
}

function diffList(oldItems = [], newItems = []) {
  const oldSet = new Set(oldItems || []);
  const newSet = new Set(newItems || []);
  return {
    added: [...newSet].filter((item) => !oldSet.has(item)),
    removed: [...oldSet].filter((item) => !newSet.has(item))
  };
}

function buildPolicyDiff(previous = {}, next = {}) {
  const listFields = [
    "preferredRoles",
    "riskyRoles",
    "preferredIndustries",
    "riskyIndustries",
    "preferredLocations",
    "riskyLocations",
    "successPatterns",
    "failurePatterns"
  ];
  const lines = [];

  listFields.forEach((field) => {
    const diff = diffList(previous[field] || [], next[field] || []);
    diff.added.forEach((item) => lines.push(`已将 ${item} 加入 ${field}。`));
    diff.removed.forEach((item) => lines.push(`已将 ${item} 从 ${field} 中移除。`));
  });

  if ((previous.focusMode || "") !== (next.focusMode || "")) {
    lines.push(`聚焦模式已从 ${previous.focusMode || "未设置"} 调整为 ${next.focusMode}。`);
  }
  if ((previous.riskTolerance || "") !== (next.riskTolerance || "")) {
    lines.push(`风险偏好已从 ${previous.riskTolerance || "未设置"} 调整为 ${next.riskTolerance}。`);
  }

  return lines;
}

function inferProposalReason(triggerType, diffSummary) {
  if (diffSummary.length > 0) return diffSummary.slice(0, 2).join(" ");
  if (triggerType === "interview_reflection") {
    return "新的面试反馈更新了成功模式与失败模式，因此触发了策略调整。";
  }
  if (triggerType === "bad_case") {
    return "新的失败案例改变了整体风险判断，因此触发了策略调整。";
  }
  if (triggerType === "profile_update") {
    return "用户更新了画像层的策略控制项，因此触发了策略调整。";
  }
  return "系统完成新一轮策略刷新后，生成了这次策略调整。";
}

function logPolicyAudit({ eventType, actor = "system", relatedProposalId = null, summary }) {
  return store.savePolicyAuditLog({
    id: createId("audit"),
    timestamp: nowIso(),
    eventType,
    actor,
    relatedProposalId,
    summary
  });
}

function getLatestPendingMatchingProposal(proposedPolicy) {
  return store.listPolicyProposals().find((proposal) => {
    if (proposal.status !== "pending") return false;
    return JSON.stringify(proposal.proposedPolicySnapshot) === JSON.stringify(proposedPolicy);
  });
}

function applyPolicySnapshot({
  proposalId,
  oldPolicySnapshot,
  proposedPolicySnapshot,
  actor = "user",
  summary
}) {
  const appliedPolicy = {
    ...proposedPolicySnapshot,
    appliedProposalId: proposalId || null,
    updatedAt: nowIso(),
    lastUpdatedAt: nowIso(),
    version: Number(oldPolicySnapshot?.version || 0) + 1
  };

  store.saveGlobalStrategyPolicy(appliedPolicy);
  store.savePolicyHistoryEntry({
    id: createId("policyhist"),
    proposalId: proposalId || null,
    previousPolicySnapshot: oldPolicySnapshot || null,
    nextPolicySnapshot: appliedPolicy,
    summary: summary || "Applied a new global policy snapshot.",
    createdAt: nowIso()
  });
  logPolicyAudit({
    eventType: "policy_applied",
    actor,
    relatedProposalId: proposalId || null,
    summary: summary || "Applied a new global policy snapshot."
  });

  return appliedPolicy;
}

function derivePolicyRiskTolerance(metrics, strategyProfile, badCases) {
  if (badCases.length >= 3 || metrics.conversionRate < 0.2) return "low";
  if ((strategyProfile.preferredRoles || []).length >= 2) return "medium";
  return "high";
}

function derivePolicyFocusMode(jobs, strategyProfile) {
  const activeJobs = jobs.filter((job) => !["archived", "rejected"].includes(job.status));
  const roleBuckets = [...new Set(activeJobs.map((job) => deriveRoleBucket(job)))];
  if (roleBuckets.length <= 2 && (strategyProfile.preferredRoles || []).length > 0) return "focused";
  if (roleBuckets.length <= 4) return "balanced";
  return "exploratory";
}

function refreshGlobalStrategyPolicy(
  strategyProfile = store.getStrategyProfile() || refreshStrategyProfile(),
  options = {}
) {
  const jobs = store.listJobs();
  const badCases = store.listBadCases();
  const metrics = getMetricsSummary();
  const profile = store.getProfile() || {};
  const previousPolicy = store.getGlobalStrategyPolicy() || {};
  const preferredRoles = unique([
    ...(strategyProfile.preferredRoles || []),
    ...(profile.policyPreferences?.manualPreferredRoles || [])
  ]).slice(0, 4);
  const riskyRoles = unique(
    (strategyProfile.riskyRoles || []).filter(
      (role) => !(profile.policyPreferences?.ignoredRiskyRoles || []).includes(role)
    )
  ).slice(0, 4);
  const preferredIndustries = Object.entries(strategyProfile.scoreBias?.industryBiases || {})
    .filter(([, value]) => Number(value) >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key)
    .slice(0, 3);
  const riskyIndustries = Object.entries(strategyProfile.scoreBias?.industryBiases || {})
    .filter(([, value]) => Number(value) <= -3)
    .sort((a, b) => a[1] - b[1])
    .map(([key]) => key)
    .slice(0, 3);
  const preferredLocations = unique(profile.targetLocations || profile.preferredLocations || []).slice(0, 4);
  const riskyLocations = unique(
    jobs
      .filter(
        (job) =>
          ["rejected", "archived"].includes(job.status) &&
          job.location &&
          preferredLocations.length > 0 &&
          !preferredLocations.includes(job.location)
      )
      .map((job) => job.location)
  ).slice(0, 3);
  const successPatterns = unique(strategyProfile.successPatterns || []).slice(0, 4);
  const failurePatterns = unique(strategyProfile.failurePatterns || []).slice(0, 4);
  const avoidPatterns = unique([
    ...riskyRoles.map((role) => `${role} roles`),
    ...riskyIndustries.map((industry) => `${industry} industry`),
    ...failurePatterns
  ]).slice(0, 5);
  const riskTolerance =
    profile.policyPreferences?.riskToleranceOverride ||
    derivePolicyRiskTolerance(metrics, strategyProfile, badCases);
  const focusMode = derivePolicyFocusMode(jobs, strategyProfile);

  const policy = {
    id: previousPolicy.id || "global_policy_main",
    version: Number(previousPolicy.version || 1),
    appliedProposalId: previousPolicy.appliedProposalId || null,
    preferredRoles,
    riskyRoles,
    avoidPatterns,
    preferredIndustries,
    riskyIndustries,
    preferredLocations,
    riskyLocations,
    successPatterns,
    failurePatterns,
    targetRolesPriority: preferredRoles,
    riskTolerance,
    focusMode,
    policySummary:
      focusMode === "focused"
        ? `当前建议继续聚焦 ${summarizeList(preferredRoles, "高优先级岗位方向")}，并主动避开分散注意力的模式。`
        : focusMode === "balanced"
          ? "当前建议保持队列平衡，但继续向历史转化更强的岗位簇倾斜。"
          : "当前投递范围仍偏宽，建议继续探索，同时逐步收窄到最早出现强转化信号的岗位方向。",
    lastUpdatedAt: nowIso(),
    updatedAt: nowIso()
  };
  const changedFields = listChangedPolicyFields(previousPolicy, policy);
  const diffSummary = buildPolicyDiff(previousPolicy, policy);
  const triggerType = options.triggerType || "system_refresh";
  const autoApprove = Boolean(options.autoApprove);

  if (!previousPolicy.id) {
    return applyPolicySnapshot({
      proposalId: null,
      oldPolicySnapshot: null,
      proposedPolicySnapshot: { ...policy, version: 1 },
      actor: "system",
      summary: "已根据用户画像和历史流程信号初始化第一版全局策略。"
    });
  }

  if (changedFields.length === 0) {
    return previousPolicy;
  }

  const existingPending = getLatestPendingMatchingProposal(policy);
  if (existingPending) {
    return previousPolicy;
  }

  const proposal = {
    id: createId("proposal"),
    createdAt: nowIso(),
    triggerType,
    triggerSourceId: options.triggerSourceId || null,
    oldPolicySnapshot: previousPolicy,
    proposedPolicySnapshot: policy,
    diffSummary,
    reasonSummary: options.reasonSummary || inferProposalReason(triggerType, diffSummary),
    status: autoApprove ? "approved" : "pending",
    reviewerNote: options.reviewerNote || null,
    appliedAt: null,
    revertedAt: null
  };

  store.savePolicyProposal(proposal);
  logPolicyAudit({
    eventType: "proposal_created",
    actor: autoApprove ? "user" : "system",
    relatedProposalId: proposal.id,
    summary: proposal.reasonSummary
  });

  if (!autoApprove) {
    return previousPolicy;
  }

  proposal.status = "applied";
  proposal.appliedAt = nowIso();
  store.savePolicyProposal(proposal);
  logPolicyAudit({
    eventType: "proposal_approved",
    actor: "user",
    relatedProposalId: proposal.id,
    summary: `已批准提案 ${proposal.id}。`
  });
  return applyPolicySnapshot({
    proposalId: proposal.id,
    oldPolicySnapshot: previousPolicy,
    proposedPolicySnapshot: policy,
    actor: "user",
    summary: `已应用策略提案 ${proposal.id}。`
  });
}

function refreshStrategyProfile() {
  const jobs = store.listJobs();
  const reflections = store.getState().interviewReflections || [];
  const badCases = store.listBadCases();
  const existing = store.getStrategyProfile() || {};
  const roleBiases = buildBiasMap(existing.scoreBias?.roleBiases || {});
  const industryBiases = buildBiasMap(existing.scoreBias?.industryBiases || {});
  const positiveSignals = [...(existing.positiveSignals || [])];
  const cautionSignals = [...(existing.cautionSignals || [])];
  const learnedFromInterviews = [...(existing.learnedFromInterviews || [])];

  jobs.forEach((job) => {
    const role = deriveRoleBucket(job);
    const industry = deriveIndustryBucket(job);
    if (["interviewing", "offer"].includes(job.status)) {
      adjustBias(roleBiases, role, 4);
      adjustBias(industryBiases, industry, 3);
    }
    if (job.status === "rejected") {
      adjustBias(roleBiases, role, -3);
      adjustBias(industryBiases, industry, -2);
    }
  });

  badCases.forEach((badCase) => {
    const sourceJob = store.getJob(badCase.jobId) || badCase;
    adjustBias(roleBiases, deriveRoleBucket(sourceJob), -4);
    adjustBias(industryBiases, deriveIndustryBucket(sourceJob), -3);
    if (badCase.issueDescription) {
      cautionSignals.push(badCase.issueDescription);
    }
  });

  reflections.forEach((reflection) => {
    (reflection.successSignals || []).forEach((signal) => positiveSignals.push(signal));
    (reflection.failureReasons || []).forEach((signal) => cautionSignals.push(signal));
    (reflection.skillGaps || []).forEach((gap) => learnedFromInterviews.push(gap));
  });

  const profile = {
    id: "strategy_profile_main",
    preferredRoles: Object.entries(roleBiases)
      .filter(([, value]) => Number(value) >= 3)
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key)
      .slice(0, 3),
    riskyRoles: Object.entries(roleBiases)
      .filter(([, value]) => Number(value) <= -3)
      .sort((a, b) => a[1] - b[1])
      .map(([key]) => key)
      .slice(0, 3),
    successPatterns: [...new Set(positiveSignals)].slice(0, 4),
    failurePatterns: [...new Set(cautionSignals)].slice(0, 4),
    scoreBias: {
      roleBiases,
      industryBiases
    },
    positiveSignals: [...new Set(positiveSignals)].slice(0, 6),
    cautionSignals: [...new Set(cautionSignals)].slice(0, 6),
    learnedFromInterviews: [...new Set(learnedFromInterviews)].slice(0, 6),
    updatedAt: nowIso()
  };

  store.saveStrategyProfile(profile);
  return profile;
}

function getMetricsSummary() {
  const jobs = store.listJobs();
  const applicationPreps = jobs
    .map((job) => store.getApplicationPrepByJobId(job.id))
    .filter(Boolean);

  const appliedJobs = jobs.filter((job) =>
    ["applied", "follow_up", "interviewing", "offer", "rejected"].includes(job.status)
  ).length;
  const interviewJobs = jobs.filter((job) =>
    ["interviewing", "offer", "rejected"].includes(job.status)
  ).length;
  const offers = jobs.filter((job) => job.status === "offer").length;
  const rejected = jobs.filter((job) => job.status === "rejected").length;
  const prepCompleted = applicationPreps.filter((prep) => isPrepReady(prep)).length;

  return {
    totalJobs: jobs.length,
    appliedJobs,
    interviewJobs,
    offers,
    rejected,
    conversionRate: appliedJobs === 0 ? 0 : Number((interviewJobs / appliedJobs).toFixed(2)),
    prepCompletionRate:
      applicationPreps.length === 0 ? 0 : Number((prepCompleted / applicationPreps.length).toFixed(2))
  };
}

async function ingestJob(payload) {
  const ingestionStage = await runAgentStage(
    {
      stageKey: "job_ingestion",
      stageLabel: "岗位结构化",
      agentName: "岗位结构化阶段",
      entityType: "job",
      inputSummary: payload.rawJdText
        ? `收到岗位描述原文（${String(payload.rawJdText).length} 字），并包含人工补充字段。`
        : "收到手动填写的岗位字段，但没有完整岗位描述。"
    },
    () => agentRegistry.jobIngestion(payload)
  );
  const job = ingestionStage.result;
  const createdJob = store.saveJob(job) || job;
  const jobId = createdJob?.id || job?.id || null;

  logger.info("job.ingest_created", {
    source: "orchestrator.ingestJob",
    createdJobId: createdJob?.id || null,
    fallbackJobId: job?.id || null,
    company: createdJob?.company || job?.company || null,
    title: createdJob?.title || job?.title || null
  });

  if (!jobId) {
    const error = new Error("Failed to create job before inserting fit_assessment");
    error.code = "JOB_CREATE_FAILED";
    throw error;
  }

  logActivity({
    type: "job_created",
    entityType: "job",
    entityId: jobId,
    action: "job_created",
    summary: `已创建岗位：${createdJob.company} / ${createdJob.title}。`,
    jobId,
    metadata: {
      sourceLabel: createdJob.sourceLabel,
      llm: createdJob.llmMeta || null
    },
    agentName: "岗位结构化阶段",
    inputSummary: payload.rawJdText
      ? `收到岗位描述原文（${String(payload.rawJdText).length} 字），并包含人工补充字段。`
      : "收到手动填写的岗位字段，但没有完整岗位描述。",
    outputSummary: `已生成结构化岗位：职位=${createdJob.title}，公司=${createdJob.company}，地点=${createdJob.location}${createdJob.llmMeta?.fallbackUsed ? "，使用规则回退抽取。" : "，使用模型辅助抽取。"}`,
    decisionReason:
      "系统先把原始岗位信息标准化为共享 Job 对象，后续评估与申请准备才能在统一字段上运行。"
  });
  logger.info("job.ingest_job_id_extracted", {
    source: "orchestrator.ingestJob",
    jobId
  });
  const evaluation = await evaluateJob(jobId);
  return {
    job: evaluation.job,
    fitAssessment: evaluation.fitAssessment
  };
}

async function importJobDraftFromUrl(payload) {
  const stage = await runAgentStage(
    {
      stageKey: "url_import",
      stageLabel: "链接导入",
      agentName: "链接导入阶段",
      entityType: "job",
      inputSummary: `尝试导入岗位链接：${payload.jobUrl || "未知链接"}。`
    },
    () => agentRegistry.urlImport(payload)
  );

  return {
    draft: stage.result.draft,
    importer: {
      ok: stage.result.ok,
      strategy: stage.result.draft.importMeta?.strategy || "manual_fallback",
      errorSummary: stage.result.errorSummary || null
    },
    importPath: stage.result.importPath || "fallback_importer",
    extractor: stage.result.extractor || stage.result.draft.importMeta?.strategy || "manual_fallback",
    warning: stage.result.warning || stage.result.draft.importMeta?.warnings?.[0] || null,
    pipelinePreview: [
      {
        key: "url_import",
        label: "链接导入阶段",
        status: stage.status,
        summary: stage.result.stageOutputSummary || null
      },
      {
        key: "job_ingestion",
        label: "岗位结构化阶段",
        status: "pending",
        summary: "会在用户确认导入草稿后执行。"
      },
      {
        key: "fit_evaluation",
        label: "匹配评估阶段",
        status: "pending",
        summary: "会在岗位创建后自动执行。"
      }
    ]
  };
}

async function evaluateJob(jobId) {
  logger.info("fit.evaluate_requested", {
    source: "orchestrator.evaluateJob",
    jobId: jobId || null
  });
  const job = store.getJob(jobId);
  const profile = store.getProfile();

  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }

  if (!profile) {
    const error = new Error("Profile is required before evaluation.");
    error.code = "PROFILE_REQUIRED";
    throw error;
  }

  const fitStage = await runAgentStage(
    {
      stageKey: "fit_evaluation",
      stageLabel: "匹配评估",
      agentName: "匹配评估阶段",
      entityType: "fit_assessment",
      entityId: job.fitAssessmentId || job.id,
      jobId,
      inputSummary: `已根据用户画像做岗位对比：目标岗位=${summarizeList(profile.targetRoles)}，目标行业=${summarizeList(profile.targetIndustries)}。`
    },
    () =>
      agentRegistry.fitEvaluation({
        job,
        profile,
        strategyProfile: store.getStrategyProfile() || refreshStrategyProfile(),
        globalPolicy:
          store.getGlobalStrategyPolicy() ||
          refreshGlobalStrategyPolicy(store.getStrategyProfile() || refreshStrategyProfile(), {
            reason: "evaluation_bootstrap",
            triggerType: "system_refresh",
            triggerSource: "fit_evaluation"
          })
      })
  );
  const fitAssessment = fitStage.result;
  const fitJobId = fitAssessment?.jobId || job?.id || jobId || null;

  if (!fitJobId) {
    const error = new Error("Failed to create job before inserting fit_assessment");
    error.code = "JOB_CREATE_FAILED";
    throw error;
  }

  fitAssessment.jobId = fitJobId;
  logger.info("fit.assessment_insert_payload", {
    source: "orchestrator.evaluateJob",
    jobId: fitAssessment.jobId,
    fitAssessmentId: fitAssessment.id || null,
    recommendation: fitAssessment.recommendation || null,
    fitScore: fitAssessment.fitScore ?? null
  });
  store.saveFitAssessment(fitAssessment);

  const nextStatus =
    fitAssessment.strategyDecision === "avoid"
      ? "archived"
      : fitAssessment.strategyDecision === "deprioritize"
        ? "inbox"
        : "to_prepare";
  const nextPriority =
    fitAssessment.strategyDecision === "proceed"
      ? "high"
      : fitAssessment.strategyDecision === "cautious_proceed"
        ? "medium"
        : "low";
  const globalPolicy =
    store.getGlobalStrategyPolicy() ||
    refreshGlobalStrategyPolicy(store.getStrategyProfile() || refreshStrategyProfile(), {
      reason: "evaluation_refresh",
      triggerType: "system_refresh",
      triggerSource: "fit_evaluation"
    });
  const override = job.policyOverride?.active ? job.policyOverride : null;
  let resolvedStatus = nextStatus;
  let resolvedPriority =
    globalPolicy.focusMode === "focused" && fitAssessment.strategyDecision === "proceed"
      ? "high"
      : nextPriority;
  let resolvedDecision = fitAssessment.strategyDecision;

  if (override?.action === "force_proceed") {
    resolvedStatus = "to_prepare";
    resolvedPriority = "high";
    resolvedDecision = "proceed";
  } else if (override?.action === "ignore_policy" && ["avoid", "deprioritize"].includes(fitAssessment.strategyDecision)) {
    resolvedStatus = "to_prepare";
    resolvedPriority = "medium";
  } else if (override?.action === "force_archive") {
    resolvedStatus = "archived";
    resolvedPriority = "low";
    resolvedDecision = "avoid";
  }

  fitAssessment.activePolicyVersion = createPolicyVersion(globalPolicy);
  fitAssessment.policyProposalId = globalPolicy.appliedProposalId || null;
  fitAssessment.overrideApplied = Boolean(override);
  fitAssessment.overrideSummary = override ? `${override.action}${override.reason ? `: ${override.reason}` : ""}` : null;
  store.saveFitAssessment(fitAssessment);

  const updatedJob = updateJob(jobId, () => ({
    fitAssessmentId: fitAssessment.id,
    status: resolvedStatus,
    priority: resolvedPriority,
    strategyDecision: resolvedDecision,
    strategyReasoning: fitAssessment.strategyReasoning
  }));

  const nextTask = agentRegistry.pipelineManager({
    job: updatedJob,
    nextStatus: resolvedStatus,
    strategyDecision: resolvedDecision,
    fitAssessment,
    globalPolicy
  });

  if (nextTask) {
    store.saveTask(nextTask);
  }

  logActivity({
    type: "fit_generated",
    entityType: "fit_assessment",
    entityId: fitAssessment.id,
    action: "fit_generated",
    summary: `已为 ${job.company} 生成匹配评估。`,
    agentName: "匹配评估阶段",
    inputSummary: `已根据用户画像做岗位对比：目标岗位=${summarizeList(profile.targetRoles)}，目标行业=${summarizeList(profile.targetIndustries)}。`,
    outputSummary: `匹配度=${fitAssessment.fitScore}，推荐结论=${humanizeRecommendationCode(fitAssessment.recommendation)}，策略判断=${resolvedDecision}，下一状态=${humanizeLifecycleStatus(resolvedStatus)}${fitAssessment.llmMeta?.fallbackUsed ? "，使用规则回退评估。" : "，使用模型辅助评估。"}`,
    decisionReason: fitAssessment.strategyReasoning,
    policyInfluenceSummary: fitAssessment.policyInfluenceSummary,
    decisionBreakdown: fitAssessment.decisionBreakdown,
    activePolicyVersion: fitAssessment.activePolicyVersion,
    policyProposalId: fitAssessment.policyProposalId,
    overrideApplied: fitAssessment.overrideApplied,
    overrideSummary: fitAssessment.overrideSummary,
    metadata: {
      jobId,
      fitScore: fitAssessment.fitScore,
      recommendation: fitAssessment.recommendation,
      strategyDecision: fitAssessment.strategyDecision,
      llm: fitAssessment.llmMeta || null
    }
  });

  return { job: updatedJob, fitAssessment, nextTask, globalPolicy };
}

function containsPersonalInfoContamination(value = "") {
  return /@|(?:\+?86[-\s]?)?1[3-9]\d{9}|姓名|电话|手机|邮箱|出生年月|籍贯/i.test(String(value || ""));
}

function containsEducationContamination(value = "") {
  return /(大学|学院|本科|硕士|博士|MBA|学位|专业)/i.test(String(value || ""));
}

function containsFallbackPlaceholder(value = "") {
  return /建议人工补充确认|建议人工确认|暂无可展示|信息较少|岗位职责没有被清晰列出|核心要求没有被清晰列出/i.test(String(value || ""));
}

function sanitizeTailoringLine(value = "", max = 180) {
  const text = truncateText(
    String(value || "")
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    max
  );
  if (!text) return "";
  if (containsFallbackPlaceholder(text)) return "";
  return text;
}

function sanitizeTailoringBullets(items = [], max = 5) {
  return dedupeStrings((Array.isArray(items) ? items : []).map((item) => sanitizeTailoringLine(item, 220)).filter(Boolean), max);
}

function sanitizeCanonicalResumeAsset(asset = {}) {
  const workExperience = (Array.isArray(asset.workExperience) ? asset.workExperience : [])
    .map((entry, index) => ({
      id: entry?.id || `work_${index + 1}`,
      company: sanitizeTailoringLine(entry?.company || "", 80),
      role: sanitizeTailoringLine(entry?.role || "", 60),
      timeRange: sanitizeTailoringLine(entry?.timeRange || "", 40),
      bullets: sanitizeTailoringBullets(entry?.bullets || [], 6)
    }))
    .filter((entry) => entry.company && !containsPersonalInfoContamination(entry.company) && !containsEducationContamination(entry.company));

  const projectExperience = (Array.isArray(asset.projectExperience) ? asset.projectExperience : [])
    .map((entry, index) => ({
      id: entry?.id || `project_${index + 1}`,
      projectName: sanitizeTailoringLine(entry?.projectName || entry?.company || "", 90),
      role: sanitizeTailoringLine(entry?.role || "", 60),
      timeRange: sanitizeTailoringLine(entry?.timeRange || "", 40),
      bullets: sanitizeTailoringBullets(entry?.bullets || [], 6)
    }))
    .filter((entry) => entry.projectName && !containsPersonalInfoContamination(entry.projectName) && !containsEducationContamination(entry.projectName));

  const selfSummary = sanitizeTailoringLine(asset.selfSummary || "", 260);
  const cleanedSelfSummary = containsPersonalInfoContamination(selfSummary) || containsEducationContamination(selfSummary) ? "" : selfSummary;

  return {
    ...asset,
    workExperience,
    projectExperience,
    selfSummary: cleanedSelfSummary,
    education: Array.isArray(asset.education) ? asset.education : [],
    skills: Array.isArray(asset.skills) ? asset.skills : []
  };
}

function buildReviewSummary(reviewModules = []) {
  const count = Array.isArray(reviewModules)
    ? reviewModules.reduce((sum, module) => sum + (Array.isArray(module.items) ? module.items.length : 0), 0)
    : 0;
  return {
    acceptedCount: count,
    rejectedCount: 0,
    pendingCount: 0
  };
}

function scoreEntryForJob(entry = {}, jobSummary = {}, fitAssessment = null) {
  const haystack = [entry.company, entry.projectName, entry.role, ...(entry.bullets || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const signals = [
    ...(jobSummary.targetKeywords || []),
    ...(jobSummary.coreResponsibilities || []),
    ...(jobSummary.coreRequirements || [])
  ].filter(Boolean);

  let score = 0;
  signals.forEach((signal) => {
    const token = String(signal || "").trim().toLowerCase();
    if (!token) return;
    if (haystack.includes(token)) score += 3;
    else if (token.length >= 2 && haystack.includes(token.slice(0, Math.min(token.length, 4)))) score += 1;
  });

  if (fitAssessment?.recommendation === "apply") score += 2;
  if (fitAssessment?.recommendation === "cautious") score += 1;
  return score;
}

function buildTailoredEntries(entries = [], jobSummary = {}, fitAssessment = null, kind = "work", refinePrompt = "") {
  const refinedInstruction = String(refinePrompt || "").trim();
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const relevantRequirement = (jobSummary.coreRequirements || [])[index] || (jobSummary.targetKeywords || [])[index] || "";
      const bullets = sanitizeTailoringBullets(entry.bullets || [], kind === "project" ? 4 : 5).map((bullet) =>
        refinedInstruction ? refineResumeBullet(bullet, refinedInstruction, relevantRequirement) : bullet
      );
      return {
        ...entry,
        bullets,
        priorityScore: scoreEntryForJob(entry, jobSummary, fitAssessment)
      };
    })
    .sort((left, right) => right.priorityScore - left.priorityScore)
    .slice(0, kind === "project" ? 2 : 3)
    .map(({ priorityScore, ...entry }) => entry);
}

function buildCanonicalWorkspaceDraft(baseResumeAsset = {}, jobSummary = {}, fitAssessment = null, options = {}) {
  const refinePrompt = truncateText(options.refinePrompt || "", 200);
  const workExperience = buildTailoredEntries(baseResumeAsset.workExperience || [], jobSummary, fitAssessment, "work", refinePrompt);
  const projectExperience = buildTailoredEntries(baseResumeAsset.projectExperience || [], jobSummary, fitAssessment, "project", refinePrompt);
  const selfEvaluationSource = sanitizeTailoringLine(baseResumeAsset.selfSummary || "", 160);
  const strongestSignal = (jobSummary.targetKeywords || [])[0] || (jobSummary.coreRequirements || [])[0] || "岗位重点";
  const selfEvaluation = sanitizeTailoringLine(
    options.selfEvaluation ||
      (selfEvaluationSource
        ? `${selfEvaluationSource}，优先突出与${strongestSignal}最相关的真实经历和执行结果。`
        : `这版简历优先突出与${strongestSignal}最相关的真实经历与项目成果。`),
    160
  );

  return {
    workExperience,
    projectExperience,
    selfEvaluation,
    education: []
  };
}

function buildCompatibilityRewrittenBullets(workspaceDraft = {}) {
  const workBullets = (workspaceDraft.workExperience || []).flatMap((entry, index) =>
    (entry.bullets || []).map((bullet, bulletIndex) => ({
      bulletId: `work_${index + 1}_${bulletIndex + 1}`,
      before: bullet,
      after: bullet,
      suggestion: bullet,
      rewritten: bullet,
      status: "accepted",
      reason: "已基于结构化工作经历生成当前定制版。",
      jdRequirement: ""
    }))
  );
  const projectBullets = (workspaceDraft.projectExperience || []).flatMap((entry, index) =>
    (entry.bullets || []).map((bullet, bulletIndex) => ({
      bulletId: `project_${index + 1}_${bulletIndex + 1}`,
      before: bullet,
      after: bullet,
      suggestion: bullet,
      rewritten: bullet,
      status: "accepted",
      reason: "已基于结构化项目经历生成当前定制版。",
      jdRequirement: ""
    }))
  );
  return [...workBullets, ...projectBullets];
}

function buildTailoringOutputRecord({
  existingTailoringOutput = null,
  job = null,
  fitAssessment = null,
  resumeDocument = null,
  workspaceDraft = {},
  workspaceName = "",
  refinePrompt = "",
  llmMeta = null,
  targetingBrief = null,
  reviewModules = [],
  insights = {}
}) {
  const activeVersion = Math.max(Number(existingTailoringOutput?.workspace?.activeVersion || 0), Number(existingTailoringOutput?.version || 0), 1);
  const resolvedName = workspaceName || existingTailoringOutput?.workspace?.name || buildDefaultTailoringWorkspaceName(job || {});
  const rewrittenBullets = buildCompatibilityRewrittenBullets(workspaceDraft);

  return {
    ...(existingTailoringOutput || {}),
    id: existingTailoringOutput?.id || createId("tailoring"),
    jobId: job?.id || existingTailoringOutput?.jobId || null,
    fitAssessmentId: fitAssessment?.id || existingTailoringOutput?.fitAssessmentId || null,
    resumeDocumentId: resumeDocument?.id || existingTailoringOutput?.resumeDocumentId || null,
    tailoredSummary: workspaceDraft.selfEvaluation || "",
    whyMe: "",
    workspaceDraft,
    rewrittenBullets,
    reviewModules,
    insights,
    targetingBrief: targetingBrief || existingTailoringOutput?.targetingBrief || { targetKeywords: job ? buildJobSummaryModel(job, fitAssessment, null).targetKeywords : [] },
    llmMeta: llmMeta || existingTailoringOutput?.llmMeta || { provider: "rule_based_workspace", model: null, fallbackUsed: true },
    version: activeVersion,
    workspace: {
      id: existingTailoringOutput?.workspace?.id || `workspace_${job?.id || createId("workspace")}`,
      name: resolvedName,
      activeVersion,
      baseResumeAssetId: resumeDocument?.id || existingTailoringOutput?.workspace?.baseResumeAssetId || null,
      lastRefinePrompt: refinePrompt || existingTailoringOutput?.workspace?.lastRefinePrompt || "",
      updatedAt: nowIso(),
      lastSavedAt: nowIso()
    },
    createdAt: existingTailoringOutput?.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function buildDefaultTailoringWorkspaceName(job = {}) {
  return `${job.company || "目标公司"} ${job.title || "岗位"}定制版`;
}

async function generateResumeTailoringOutput(jobId, options = {}) {
  const job = store.getJob(jobId);
  const profile = store.getProfile();
  const fitAssessment = store.getFitAssessmentByJobId(jobId);
  const resumeDocument = store.getLatestResumeDocument();
  const existingTailoringOutput = store.getTailoringOutputByJobId(jobId);
  const refinePrompt = truncateText(options.refinePrompt || "", 500);
  const workspaceName = truncateText(options.workspaceName || existingTailoringOutput?.workspace?.name || buildDefaultTailoringWorkspaceName(job || {}), 120);

  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }
  if (!profile) {
    const error = new Error("Profile is required before resume tailoring.");
    error.code = "PROFILE_REQUIRED";
    throw error;
  }
  if (!resumeDocument) {
    const error = new Error("请先上传原始简历，再生成岗位定制简历。");
    error.code = "RESUME_REQUIRED";
    throw error;
  }

  const baseResumeAsset = sanitizeCanonicalResumeAsset(normalizeResumeWorkspaceAssetModel(resumeDocument, profile));
  const jobSummary = buildJobSummaryModel(job, fitAssessment, existingTailoringOutput);
  const fallbackAgentResult = runRuleBasedResumeTailoringAgent({
    job,
    profile,
    fitAssessment,
    resumeDocument,
    refinePrompt
  });
  const workspaceDraft = buildCanonicalWorkspaceDraft(baseResumeAsset, jobSummary, fitAssessment, {
    refinePrompt,
    selfEvaluation: fallbackAgentResult?.tailoredSummary || ""
  });
  const draftForModel = { workspaceDraft, tailoredSummary: workspaceDraft.selfEvaluation };
  const tailoredResume = buildTailoredWorkspaceResumeModel(draftForModel, baseResumeAsset);
  const reviewModules = buildWorkspaceReviewModules(jobSummary, baseResumeAsset, tailoredResume);
  const insights = buildWorkspaceInsights(jobSummary, baseResumeAsset, tailoredResume);
  const tailoringOutput = buildTailoringOutputRecord({
    existingTailoringOutput,
    job,
    fitAssessment,
    resumeDocument,
    workspaceDraft,
    workspaceName,
    refinePrompt,
    llmMeta: fallbackAgentResult?.llmMeta || null,
    targetingBrief: { targetKeywords: jobSummary.targetKeywords || [] },
    reviewModules,
    insights
  });

  store.saveTailoringOutput(tailoringOutput);
  logActivity({
    type: "tailoring_generated",
    entityType: "tailoring_output",
    entityId: tailoringOutput.id,
    action: "tailoring_generated",
    summary: `已为 ${job.company} 生成岗位定制版简历。`,
    jobId,
    agentName: "简历定制阶段",
    inputSummary: `已基于岗位 ${job.title}、当前简历 ${resumeDocument.fileName} 与匹配评估结果生成定制版。`,
    outputSummary: `生成 ${workspaceDraft.workExperience.length} 段定制工作经历、${workspaceDraft.projectExperience.length} 段定制项目经历。`,
    decisionReason: "系统已切换到结构化简历实体建模路径，只保留公司、岗位、时间和要点进入工作区。"
  });

  return {
    job,
    fitAssessment,
    tailoringOutput,
    workspace: buildTailoringWorkspace(jobId).workspace
  };
}

function saveResumeTailoringOutput(jobId, payload = {}) {
  const job = store.getJob(jobId);
  const profile = store.getProfile();
  const fitAssessment = store.getFitAssessmentByJobId(jobId);
  const resumeDocument = store.getLatestResumeDocument();
  const existingTailoringOutput = store.getTailoringOutputByJobId(jobId);
  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }

  const baseResumeAsset = sanitizeCanonicalResumeAsset(normalizeResumeWorkspaceAssetModel(resumeDocument, profile || {}));
  const jobSummary = buildJobSummaryModel(job, fitAssessment, existingTailoringOutput);
  const suppliedDraft = payload.workspaceDraft || existingTailoringOutput?.workspaceDraft || {};
  const sanitizedDraftSource = sanitizeCanonicalResumeAsset({
    workExperience: suppliedDraft.workExperience || [],
    projectExperience: suppliedDraft.projectExperience || [],
    selfSummary: payload.tailoredSummary || suppliedDraft.selfEvaluation || existingTailoringOutput?.tailoredSummary || baseResumeAsset.selfSummary || ""
  });
  const workspaceDraft = {
    workExperience: sanitizedDraftSource.workExperience,
    projectExperience: sanitizedDraftSource.projectExperience,
    selfEvaluation: sanitizedDraftSource.selfSummary,
    education: []
  };
  const draftForModel = { workspaceDraft, tailoredSummary: workspaceDraft.selfEvaluation };
  const tailoredResume = buildTailoredWorkspaceResumeModel(draftForModel, baseResumeAsset);
  const reviewModules = buildWorkspaceReviewModules(jobSummary, baseResumeAsset, tailoredResume);
  const insights = buildWorkspaceInsights(jobSummary, baseResumeAsset, tailoredResume);
  const tailoringOutput = buildTailoringOutputRecord({
    existingTailoringOutput,
    job,
    fitAssessment,
    resumeDocument,
    workspaceDraft,
    workspaceName: truncateText(payload.workspaceName || existingTailoringOutput?.workspace?.name || buildDefaultTailoringWorkspaceName(job), 120),
    refinePrompt: truncateText(payload.refinePrompt || existingTailoringOutput?.workspace?.lastRefinePrompt || "", 500),
    llmMeta: existingTailoringOutput?.llmMeta || null,
    targetingBrief: { targetKeywords: jobSummary.targetKeywords || [] },
    reviewModules,
    insights
  });

  store.saveTailoringOutput(tailoringOutput);
  logActivity({
    type: "tailoring_review_saved",
    entityType: "tailoring_output",
    entityId: tailoringOutput.id,
    action: "tailoring_review_saved",
    summary: `已保存 ${job.company} 的当前定制版。`,
    jobId,
    metadata: {
      acceptedCount: buildReviewSummary(reviewModules).acceptedCount
    }
  });
  return tailoringOutput;
}

async function prepareJobApplication(jobId) {
  const job = store.getJob(jobId);
  const profile = store.getProfile();
  const fitAssessment = store.getFitAssessmentByJobId(jobId);
  const resumeDocument = store.getLatestResumeDocument();

  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }
  if (!profile) {
    const error = new Error("Profile is required before preparation.");
    error.code = "PROFILE_REQUIRED";
    throw error;
  }
  if (!resumeDocument) {
    const error = new Error("请先上传原始简历，再生成申请准备包。");
    error.code = "RESUME_REQUIRED";
    throw error;
  }

  const tailoringOutput =
    store.getTailoringOutputByJobId(jobId) ||
    (await generateResumeTailoringOutput(jobId)).tailoringOutput;

  const prepStage = await runAgentStage(
    {
      stageKey: "prep_generation",
      stageLabel: "申请准备阶段",
      agentName: "Application Prep Agent",
      entityType: "application_prep",
      entityId: job.applicationPrepId || job.id,
      jobId,
      inputSummary: `系统会复用岗位定制简历结果，继续生成自我介绍、问答草稿与投递附言。`
    },
    () => agentRegistry.applicationPrep({ job, profile, fitAssessment, resumeDocument, tailoringOutput })
  );

  const applicationPrep = prepStage.result;
  store.saveApplicationPrep(applicationPrep);
  const updatedJob = updateJob(jobId, () => ({
    applicationPrepId: applicationPrep.id,
    resumeDocumentId: resumeDocument.id
  }));

  logActivity({
    type: "prep_saved",
    entityType: "application_prep",
    entityId: applicationPrep.id,
    action: "prep_saved",
    summary: `已为 ${job.company} 生成申请准备包。`,
    jobId,
    agentName: "Application Prep Agent",
    inputSummary: "系统已基于岗位定制简历结果继续生成申请准备材料。",
    outputSummary: `问答草稿 ${applicationPrep.qaDraft?.length || 0} 条，沟通重点 ${(applicationPrep.talkingPoints || []).length || 0} 条。`,
    decisionReason: "申请准备阶段只消费当前定制版与用户确认过的内容，不再直接读取脏文本。"
  });

  return { job: updatedJob, applicationPrep, tailoringOutput, resumeDocument };
}

function saveApplicationPrep(jobId, payload = {}) {
  const job = store.getJob(jobId);
  const profile = store.getProfile();
  const existing = store.getApplicationPrepByJobId(jobId);
  const tailoringOutput = store.getTailoringOutputByJobId(jobId);

  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }
  if (!profile) {
    const error = new Error("Profile is required before saving prep.");
    error.code = "PROFILE_REQUIRED";
    throw error;
  }

  const normalizeLines = (value) =>
    Array.isArray(value)
      ? value.filter(Boolean)
      : String(value || "")
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean);

  const rewriteBullets = normalizeLines(payload.tailoredResumeBullets).map((line, index) => ({
    bulletId: `accepted_bullet_${index + 1}`,
    before: line,
    after: line,
    suggestion: line,
    rewritten: line,
    status: "accepted"
  }));

  const qaDraft = normalizeLines(payload.qaDraft).map((line, index) => {
    const [question, ...answerParts] = line.split("::");
    return {
      question: (question || `问题 ${index + 1}`).trim(),
      draftAnswer: answerParts.join("::").trim()
    };
  });

  const checklist = (Array.isArray(payload.checklist) ? payload.checklist : []).map((item, index) => ({
    key: item.key || `check_${index + 1}`,
    label: item.label || `检查项 ${index + 1}`,
    completed: Boolean(item.completed)
  }));

  const applicationPrep = {
    ...(existing || {}),
    id: existing?.id || createId("prep"),
    jobId,
    profileId: profile.id,
    version: (existing?.version || 0) + 1,
    resumeDocumentId: payload.resumeDocumentId || existing?.resumeDocumentId || job.resumeDocumentId || null,
    tailoredSummary: payload.tailoredSummary || existing?.tailoredSummary || tailoringOutput?.tailoredSummary || "",
    whyMe: payload.whyMe || existing?.whyMe || "",
    resumeTailoring: {
      ...(existing?.resumeTailoring || {}),
      rewriteBullets,
      usedBullets: rewriteBullets,
      unusedBullets: [],
      targetKeywords: tailoringOutput?.targetingBrief?.targetKeywords || []
    },
    selfIntro: {
      short: payload.selfIntroShort || existing?.selfIntro?.short || "",
      medium: payload.selfIntroMedium || existing?.selfIntro?.medium || ""
    },
    qaDraft,
    talkingPoints: normalizeLines(payload.talkingPoints || existing?.talkingPoints || []),
    coverNote: payload.coverNote || existing?.coverNote || "",
    outreachNote: payload.outreachNote || existing?.outreachNote || "",
    checklist,
    contentWithSources: existing?.contentWithSources || [],
    tailoringExplainability: existing?.tailoringExplainability || [],
    tailoredResumePreview: existing?.tailoredResumePreview || null,
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso()
  };

  store.saveApplicationPrep(applicationPrep);
  updateJob(jobId, () => ({
    applicationPrepId: applicationPrep.id,
    resumeDocumentId: applicationPrep.resumeDocumentId || job.resumeDocumentId || null
  }));

  logActivity({
    type: "prep_saved",
    entityType: "application_prep",
    entityId: applicationPrep.id,
    action: "prep_saved",
    summary: `已保存 ${job.company} 的申请准备内容。`,
    jobId
  });

  return {
    job: store.getJob(jobId),
    applicationPrep,
    prepReady: isPrepReady(applicationPrep)
  };
}

function isPrepReady(applicationPrep) {
  const requiredKeys = ["resume_reviewed", "intro_ready", "qa_ready"];
  const doneKeys = new Set(
    (applicationPrep?.checklist || [])
      .filter((item) => item.completed)
      .map((item) => item.key)
  );
  return requiredKeys.every((key) => doneKeys.has(key));
}

function transitionJobStatus(jobId, nextStatus, options = {}) {
  const job = store.getJob(jobId);
  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }

  assertJobStatusTransition(job.status, nextStatus);

  if (nextStatus === "ready_to_apply") {
    const prep = store.getApplicationPrepByJobId(jobId);
    if (!prep || !isPrepReady(prep)) {
      const error = new Error("在核心申请准备清单完成之前，不能推进到可投递状态。");
      error.code = "PREP_NOT_READY";
      error.details = { jobId, requiredChecklist: ["resume_reviewed", "intro_ready", "qa_ready"] };
      throw error;
    }
  }

  const updatedJob = updateJob(jobId, () => ({ status: nextStatus }));
  const globalPolicy =
    store.getGlobalStrategyPolicy() ||
    refreshGlobalStrategyPolicy(store.getStrategyProfile() || refreshStrategyProfile(), {
      reason: "status_transition",
      triggerType: "metrics_shift",
      triggerSource: "pipeline_manager"
    });
  const nextTask = agentRegistry.pipelineManager({
    job: updatedJob,
    nextStatus,
    strategyDecision: updatedJob.strategyDecision,
    fitAssessment: store.getFitAssessmentByJobId(jobId),
    globalPolicy
  });

  if (nextTask) store.saveTask(nextTask);

  logActivity({
    type: "job_status_changed",
    entityType: "job",
    entityId: jobId,
    action: "job_status_changed",
    actor: options.actor || "user",
    jobId,
    summary: `已将 ${updatedJob.company} 更新到 ${humanizeLifecycleStatus(nextStatus)}。`
  });

  refreshGlobalStrategyPolicy(refreshStrategyProfile(), {
    reason: "status_transition",
    triggerType: "metrics_shift",
    triggerSource: "pipeline_manager"
  });

  return { job: updatedJob, nextTask };
}

function saveProfile(payload) {
  const current = store.getProfile();
  const csvToArray = (value) =>
    Array.isArray(value)
      ? value
      : String(value || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

  const profile = {
    ...(current || {}),
    ...payload,
    id: current?.id || createId("profile"),
    fullName: payload.name || payload.fullName || current?.fullName || "",
    name: payload.name || payload.fullName || current?.name || "",
    headline: payload.background || payload.headline || current?.headline || "",
    background: payload.background || payload.headline || current?.background || "",
    yearsOfExperience: Number(payload.yearsOfExperience ?? current?.yearsOfExperience ?? 0),
    targetRoles: csvToArray(payload.targetRoles ?? current?.targetRoles ?? []),
    targetIndustries: csvToArray(payload.targetIndustries ?? current?.targetIndustries ?? []),
    preferredLocations: csvToArray(payload.targetLocations ?? payload.preferredLocations ?? current?.preferredLocations ?? []),
    targetLocations: csvToArray(payload.targetLocations ?? payload.preferredLocations ?? current?.targetLocations ?? []),
    strengths: csvToArray(payload.strengths ?? current?.strengths ?? []),
    constraints: csvToArray(payload.constraints ?? current?.constraints ?? []),
    baseResume: payload.masterResume || payload.baseResume || current?.baseResume || "",
    masterResume: payload.masterResume || payload.baseResume || current?.masterResume || "",
    policyPreferences: {
      manualPreferredRoles: csvToArray(payload.manualPreferredRoles ?? current?.policyPreferences?.manualPreferredRoles ?? []),
      ignoredRiskyRoles: csvToArray(payload.ignoredRiskyRoles ?? current?.policyPreferences?.ignoredRiskyRoles ?? []),
      riskToleranceOverride: payload.riskToleranceOverride || current?.policyPreferences?.riskToleranceOverride || ""
    },
    summary: payload.background || payload.summary || current?.summary || payload.headline || "",
    createdAt: current?.createdAt || nowIso(),
    updatedAt: nowIso()
  };

  store.saveProfile(profile);
  refreshGlobalStrategyPolicy(refreshStrategyProfile(), {
    reason: "profile_updated",
    triggerType: "profile_update",
    triggerSource: "user_profile",
    reasonSummary: "User updated profile-level policy controls.",
    autoApprove: true
  });
  logActivity({
    type: "profile_saved",
    entityType: "profile",
    entityId: profile.id,
    action: "profile_saved",
    actor: "user",
    summary: `已保存 ${profile.fullName || "候选人"} 的个人画像。`
  });
  return profile;
}

function reflectInterview(payload) {
  const job = store.getJob(payload.jobId);
  const profile = store.getProfile();

  if (!job) {
    const error = new Error(`Job ${payload.jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }

  const reflection = agentRegistry.interviewReflection({ payload, profile });
  store.saveInterviewReflection(reflection);
  updateJob(payload.jobId, () => ({
    latestInterviewReflectionId: reflection.id,
    latestFailureReasons: reflection.failureReasons || [],
    latestSuccessSignals: reflection.successSignals || [],
    latestSkillGaps: reflection.skillGaps || []
  }));

  refreshGlobalStrategyPolicy(refreshStrategyProfile(), {
    reason: "interview_reflection",
    triggerType: "interview_reflection",
    triggerSource: "interview_reflection"
  });
  logActivity({
    type: "interview_reflected",
    entityType: "interview_reflection",
    entityId: reflection.id,
    action: "interview_reflected",
    summary: `已记录 ${job.company} 的面试复盘。`
  });

  return reflection;
}

function getJobDetail(jobId) {
  const job = store.getJob(jobId);
  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }

  const activityLogs = store
    .listActivityLogsByJobId(jobId)
    .sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt));
  const storedAssessment = store.getFitAssessmentByJobId(jobId);
  const fitAssessment = storedAssessment
    ? {
        ...storedAssessment,
        overrideApplied: Boolean(job.policyOverride?.active) || storedAssessment.overrideApplied,
        overrideSummary: job.policyOverride?.active
          ? `${job.policyOverride.action}${job.policyOverride.reason ? `: ${job.policyOverride.reason}` : ""}`
          : storedAssessment.overrideSummary || null
      }
    : null;
  const globalPolicy =
    store.getGlobalStrategyPolicy() ||
    refreshGlobalStrategyPolicy(store.getStrategyProfile() || refreshStrategyProfile(), {
      reason: "job_detail_view",
      triggerType: "system_refresh",
      triggerSource: "ui"
    });
  const applicationPrep = store.getApplicationPrepByJobId(jobId) || null;
  const tailoringOutput = store.getTailoringOutputByJobId(jobId) || null;
  const resumeDocument = job.resumeDocumentId
    ? store.getResumeDocument(job.resumeDocumentId) || store.getLatestResumeDocument()
    : store.getLatestResumeDocument();

  return {
    job,
    fitAssessment,
    applicationPrep,
    tailoringOutput,
    resumeDocument,
    tasks: store.listTasksByJobId(jobId),
    activityLogs,
    interviewReflection: store.getInterviewReflectionByJobId(jobId) || null,
    badCase: store.getBadCaseByJobId(jobId) || null,
    globalPolicy,
    policyExplanation: buildJobPolicyExplanation(job, fitAssessment, globalPolicy),
    pipelineStages: buildJobPipelineStages({
      job,
      fitAssessment,
      tailoringOutput,
      applicationPrep,
      activityLogs
    }),
    policyProposals: listPolicyProposals().slice(0, 3),
    policyAuditLogs: listPolicyAuditHistory().slice(0, 5),
    nextAction: getJobNextAction(job),
    allowedNextStatuses: safeGetAllowedNextStatuses(job.status),
    recommendedNextStatuses: safeGetRecommendedNextStatuses(job.status)
  };
}

function buildTailoringWorkspace(jobId) {
  const detail = getJobDetail(jobId);
  const { job, fitAssessment, activityLogs, nextAction } = detail;
  const tailoringOutput = store.getTailoringOutputByJobId(jobId) || null;
  const resumeDocument = job.resumeDocumentId
    ? store.getResumeDocument(job.resumeDocumentId) || store.getLatestResumeDocument()
    : store.getLatestResumeDocument();
  const baseResumeAsset = sanitizeCanonicalResumeAsset(normalizeResumeWorkspaceAssetModel(resumeDocument, store.getProfile() || {}));
  const safeTailoringOutput = tailoringOutput || {
    workspaceDraft: null,
    tailoredSummary: "",
    reviewModules: [],
    insights: {}
  };
  const tailoredResume = buildTailoredWorkspaceResumeModel(safeTailoringOutput, baseResumeAsset);
  const jobSummary = buildJobSummaryModel(job, fitAssessment, safeTailoringOutput);
  const reviewModules = safeTailoringOutput.reviewModules?.length
    ? safeTailoringOutput.reviewModules
    : buildWorkspaceReviewModules(jobSummary, baseResumeAsset, tailoredResume);

  return {
    ...detail,
    tailoringOutput: safeTailoringOutput,
    workspace: {
      id: safeTailoringOutput.workspace?.id || `workspace_${job.id}`,
      name: safeTailoringOutput.workspace?.name || buildDefaultTailoringWorkspaceName(job),
      activeVersion: safeTailoringOutput.workspace?.activeVersion || safeTailoringOutput.version || 1,
      lastRefinePrompt: safeTailoringOutput.workspace?.lastRefinePrompt || "",
      updatedAt: safeTailoringOutput.workspace?.updatedAt || safeTailoringOutput.updatedAt || job.updatedAt,
      canGeneratePrepFromAcceptedOnly: true,
      baseResumeAsset,
      tailoredResume,
      reviewSummary: buildReviewSummary(reviewModules),
      reviewModules,
      insights: safeTailoringOutput.insights || buildWorkspaceInsights(jobSummary, baseResumeAsset, tailoredResume),
      jobSummary,
      nextAction
    },
    workspaceActivity: (activityLogs || []).filter((entry) => ["tailoring_generated", "tailoring_review_saved", "prep_saved"].includes(entry.type))
  };
}

async function saveTailoringWorkspace(jobId, payload = {}) {
  saveResumeTailoringOutput(jobId, payload);
  return buildTailoringWorkspace(jobId);
}

async function refineTailoringWorkspace(jobId, payload = {}) {
  const job = store.getJob(jobId);
  const current = store.getTailoringOutputByJobId(jobId);
  const workspaceName = truncateText(payload.workspaceName || current?.workspace?.name || buildDefaultTailoringWorkspaceName(job || {}), 120);
  const refinePrompt = truncateText(payload.refinePrompt || "", 500);
  const moduleKey = String(payload.moduleKey || "").trim();

  if (!current) {
    return generateResumeTailoringOutput(jobId, { workspaceName, refinePrompt });
  }

  const draft = JSON.parse(JSON.stringify(current.workspaceDraft || {}));
  if (moduleKey === "self_summary") {
    draft.selfEvaluation = refineResumeBullet(String(payload.currentText || draft.selfEvaluation || ""), refinePrompt, "自我评价");
  } else if (moduleKey === "work_experience") {
    draft.workExperience = (Array.isArray(draft.workExperience) ? draft.workExperience : []).map((entry) => ({
      ...entry,
      bullets: sanitizeTailoringBullets((entry.bullets || []).map((bullet) => refineResumeBullet(bullet, refinePrompt, entry.role || entry.company || "工作经历")), 6)
    }));
  } else if (moduleKey === "project_experience") {
    draft.projectExperience = (Array.isArray(draft.projectExperience) ? draft.projectExperience : []).map((entry) => ({
      ...entry,
      bullets: sanitizeTailoringBullets((entry.bullets || []).map((bullet) => refineResumeBullet(bullet, refinePrompt, entry.projectName || "项目经历")), 6)
    }));
  }

  await saveTailoringWorkspace(jobId, {
    workspaceName,
    workspaceDraft: draft,
    tailoredSummary: draft.selfEvaluation || current.tailoredSummary || "",
    refinePrompt
  });
  return buildTailoringWorkspace(jobId);
}

async function getOrBuildTailoringWorkspace(jobId) {
  const current = store.getTailoringOutputByJobId(jobId);
  if (!current) {
    await generateResumeTailoringOutput(jobId);
  }
  return buildTailoringWorkspace(jobId);
}
function humanizeRecommendationCode(value) {
  const map = {
    apply: "建议投递",
    cautious: "谨慎投递",
    skip: "暂不优先"
  };
  return map[value] || value || "待判断";
}

function humanizeLifecycleStatus(value) {
  const map = {
    inbox: "待处理",
    evaluating: "评估中",
    to_prepare: "待准备",
    ready_to_apply: "可投递",
    applied: "已投递",
    follow_up: "待跟进",
    interviewing: "面试中",
    rejected: "未通过",
    offer: "录用",
    archived: "已归档"
  };
  return map[value] || value || "未知状态";
}

function humanizePriorityCode(value) {
  const map = {
    high: "高优先级",
    medium: "中优先级",
    low: "低优先级"
  };
  return map[value] || value || "未设置";
}

function humanizeOverrideActionCode(value) {
  const map = {
    force_proceed: "强制继续推进",
    ignore_policy: "忽略系统策略",
    force_archive: "强制归档"
  };
  return map[value] || value || "人工覆盖";
}

function buildJobPolicyExplanation(job, fitAssessment, globalPolicy) {
  const explanation = [];
  if (!fitAssessment) return explanation;

  explanation.push(`策略判断：${fitAssessment.strategyDecision}。`);

  if (fitAssessment.policyInfluenceSummary) {
    explanation.push(fitAssessment.policyInfluenceSummary);
  }

  if (fitAssessment.historyInfluenceSummary) {
    explanation.push(fitAssessment.historyInfluenceSummary);
  }

  if (job.status === "archived" && fitAssessment.strategyDecision === "avoid") {
    explanation.push("这条岗位被默认归档，因为当前策略与历史证据都表明继续投入的预期收益较低。");
  }

  if (job.priority === "high" && globalPolicy.focusMode === "focused") {
    explanation.push("这条岗位被抬升优先级，因为它符合当前的聚焦推进策略。");
  }

  if (job.strategyDecision === "deprioritize") {
    explanation.push("系统暂时没有把这条岗位放进主准备队列，但你仍然可以手动覆盖这一判断。");
  }

  if (job.policyOverride?.active) {
    explanation.push(
      `当前存在人工覆盖（${humanizeOverrideActionCode(job.policyOverride.action)}）${job.policyOverride.reason ? `：${job.policyOverride.reason}` : "。"}`
    );
  }

  return explanation;
}

function buildJobPipelineStages({ job, fitAssessment, tailoringOutput, applicationPrep, activityLogs }) {
  const stageLogs = (activityLogs || []).filter((entry) => entry.metadata?.stageKey);
  const findStageLog = (stageKey) => stageLogs.find((entry) => entry.metadata?.stageKey === stageKey);
  const stageFor = (stageKey, label, fallbackStatus = "pending", summaryFallback = "") => {
    const log = findStageLog(stageKey);
    return {
      key: stageKey,
      label,
      status: log?.metadata?.stageStatus || fallbackStatus,
      summary: log?.summary || summaryFallback,
      timestamp: log?.timestamp || log?.createdAt || null
    };
  };

  const urlImportStatus = job.source === "url" ? "completed" : "not_applicable";

  return [
    stageFor(
      "url_import",
      "链接导入阶段",
      urlImportStatus,
      job.source === "url" ? "该岗位通过链接优先导入路径进入 ApplyFlow。" : "该岗位通过手动方式创建。"
    ),
    stageFor(
      "job_ingestion",
      "岗位结构化阶段",
      job.id ? "completed" : "pending",
      job.id ? "原始输入已经被整理为共享 Job 对象。" : "等待创建共享 Job 对象。"
    ),
    stageFor(
      "fit_evaluation",
      "匹配评估阶段",
      fitAssessment ? "completed" : "pending",
      fitAssessment
        ? `已生成匹配评估：结论为 ${humanizeRecommendationCode(fitAssessment.recommendation)}，评分 ${fitAssessment.fitScore}。`
        : "等待生成结构化匹配评估。"
    ),
    stageFor(
      "resume_tailoring",
      "简历定制阶段",
      tailoringOutput ? "completed" : fitAssessment ? "ready" : "pending",
      tailoringOutput
        ? `已生成岗位定制简历，改写 ${tailoringOutput.rewrittenBullets?.length || tailoringOutput.diffView?.changedBulletCount || 0} 条经历表达。`
        : "等待根据 JD 与原始简历生成岗位定制版简历。"
    ),
    stageFor(
      "prep_generation",
      "申请准备阶段",
      applicationPrep ? "completed" : tailoringOutput ? "ready" : job.status === "to_prepare" ? "ready" : "pending",
      applicationPrep
        ? `已生成申请准备包，其中包含 ${applicationPrep.qaDraft?.length || 0} 条问答草稿与 ${(applicationPrep.talkingPoints || []).length} 条沟通重点。`
        : "当岗位定制简历完成后，这一阶段即可继续补齐申请叙事与材料包。"
    ),
    {
      key: "pipeline_manager",
      label: "流程管理阶段",
      status: job.status === "archived" ? "completed" : "active",
      summary: `流程管理器当前将该岗位维持在 ${humanizeLifecycleStatus(job.status)} 状态，优先级为 ${humanizePriorityCode(job.priority)}。`,
      timestamp: job.updatedAt
    }
  ];
}

function getJobNextAction(job) {
  const prep = store.getApplicationPrepByJobId(job.id);
  const tailoringOutput = store.getTailoringOutputByJobId(job.id);
  const fit = store.getFitAssessmentByJobId(job.id);
  const globalPolicy = store.getGlobalStrategyPolicy() || refreshGlobalStrategyPolicy();

if (job.strategyDecision === "deprioritize" && job.status === "inbox") {
    return {
      tone: "warning",
      title:
        globalPolicy.focusMode === "focused"
          ? "这条岗位在当前聚焦策略下被降低优先级"
          : "这条岗位当前处于低优先级",
      description:
        fit?.strategyReasoning ||
        (globalPolicy.focusMode === "focused"
          ? "全局策略正在把精力集中到更窄的一组岗位上，因此这条岗位暂时不会进入主准备队列，除非你主动覆盖。"
          : "策略层暂时把这条岗位放在主准备队列之外，只有在你明确想推进时才建议继续。"),
      ctaLabel: "人工覆盖并开始准备",
      ctaType: "prepare"
    };
  }

  if (job.status === "archived") {
    return {
      tone: "warning",
      title: "这条岗位当前不建议继续主动推进",
      description:
        fit?.strategyDecision === "avoid"
          ? "策略层已将这条岗位标记为建议回避。除非你明确想覆盖判断，否则建议继续保持归档。"
          : "这条岗位已经从主动推进队列中归档。",
      ctaLabel: fit?.strategyDecision === "avoid" ? "人工覆盖并开始准备" : "查看归档原因",
      ctaType: fit?.strategyDecision === "avoid" ? "prepare" : "none"
    };
  }

  if (job.status === "evaluating") {
    return {
      tone: "primary",
      title: "完成匹配评估",
      description: "先运行评估，让系统判断这条岗位是否值得进入申请准备。",
      ctaLabel: "立即评估",
      ctaType: "evaluate"
    };
  }

  if (job.status === "to_prepare") {
    if (!tailoringOutput) {
      return {
        tone: job.strategyDecision === "cautious_proceed" ? "warning" : "primary",
        title:
          job.strategyDecision === "cautious_proceed"
            ? "先生成岗位定制简历，再谨慎推进"
            : "先生成岗位定制简历",
        description:
          job.strategyDecision === "cautious_proceed"
            ? `请谨慎推进，并优先关注这些风险：${(fit?.riskFlags || []).slice(0, 2).join(" / ") || "请先查看匹配评估。"}` 
            : "先把原始简历转换成针对该 JD 的定制版本，再进入申请准备，会更符合真实求职流程。",
        ctaLabel: "生成岗位定制简历",
        ctaType: "tailor"
      };
    }

    if (!prep) {
      return {
        tone: job.strategyDecision === "cautious_proceed" ? "warning" : "primary",
        title:
          job.strategyDecision === "cautious_proceed"
            ? "带着关键风险继续完善申请准备"
            : "基于定制简历生成申请准备包",
        description:
          job.strategyDecision === "cautious_proceed"
            ? `请谨慎推进，并优先关注这些风险：${(fit?.riskFlags || []).slice(0, 2).join(" / ") || "请先查看匹配评估。"}`
            : globalPolicy.focusMode === "focused" && job.priority === "high"
              ? "这条岗位符合当前全局聚焦方向，建议立刻补齐申请叙事与材料包，保持推进节奏。"
              : "建议在岗位定制简历基础上继续生成申请准备包，再决定是否投入更多时间。",
        ctaLabel: "生成申请准备包",
        ctaType: "prepare"
      };
    }

    const missing = (prep.checklist || [])
      .filter((item) => !item.completed && ["resume_reviewed", "intro_ready", "qa_ready"].includes(item.key))
      .map((item) => item.label);

    return {
      tone: missing.length === 0 ? "primary" : "warning",
      title: missing.length === 0 ? "标记申请准备完成" : "补齐申请准备清单",
      description:
        missing.length === 0
          ? "核心准备项已经完成。现在可以把这条岗位推进到可投递状态。"
          : `请先完成这些核心项目：${missing.join(" / ")}。`,
      ctaLabel: "打开申请准备",
      ctaType: "open_prep"
    };
  }

  if (job.status === "ready_to_apply") {
    return {
      tone: "primary",
      title:
        globalPolicy.focusMode === "focused" && job.priority === "high"
          ? "高优先级岗位已准备好投递"
          : "确认岗位已经完成投递",
      description:
        globalPolicy.focusMode === "focused" && job.priority === "high"
          ? "这条岗位符合当前策略方向，且准备工作已经完成。你在线下完成投递后，请回到这里标记为已投递，保持主队列流动。"
          : "这条岗位已经准备完成。你在线下完成投递后，请回到这里标记为已投递。",
      ctaLabel: "标记已投递",
      ctaType: "status",
      nextStatus: "applied"
    };
  }

  if (job.status === "applied") {
    return {
      tone: "primary",
      title: "进入跟进阶段",
      description: "开始追踪回复窗口，并准备下一次检查节点。",
      ctaLabel: "开始跟进",
      ctaType: "status",
      nextStatus: "follow_up"
    };
  }

  if (job.status === "follow_up") {
    return {
      tone: "warning",
      title: "等待反馈或记录面试推进",
      description: "如果公司已经回复，可以把这条岗位推进到面试中；否则继续跟进时间窗口。",
      ctaLabel: "标记进入面试",
      ctaType: "status",
      nextStatus: "interviewing"
    };
  }

  if (job.status === "interviewing") {
    return {
      tone: "primary",
      title: "记录面试结果",
      description: "当流程有进一步结果时，请把岗位更新为录用或未通过。",
      ctaLabel: "记录下一步结果",
      ctaType: "none"
    };
  }

  return {
    tone: "neutral",
    title: "检查这条岗位",
    description: "查看最新信息，并决定下一步人工动作。",
    ctaLabel: "查看详情",
    ctaType: "none"
  };
}

function getDashboardSummary() {
  const jobs = store.listJobs();
  const tasks = store.listTasks();
  const globalPolicy = store.getGlobalStrategyPolicy() || refreshGlobalStrategyPolicy();
  const statusCounts = jobs.reduce((acc, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1;
    return acc;
  }, {});

  return {
    statusCounts,
    metrics: getMetricsSummary(),
    strategyInsights: getStrategyInsights(),
    globalPolicy,
    policyHistory: store.listPolicyHistory().slice(0, 3),
    policyProposals: listPolicyProposals().slice(0, 3),
    policyAuditLogs: listPolicyAuditHistory().slice(0, 5),
    strategyProfile: store.getStrategyProfile() || refreshStrategyProfile(),
    profile: store.getProfile(),
    todoTasks: tasks.filter((task) => task.status === "todo").slice(0, 5),
    recentJobs: [...jobs]
      .sort(
        (a, b) =>
          priorityWeight(b.priority) - priorityWeight(a.priority) ||
          new Date(b.updatedAt) - new Date(a.updatedAt)
      )
      .slice(0, 5),
    staleJobs: jobs.filter((job) => {
      if (!["to_prepare", "ready_to_apply", "follow_up"].includes(job.status)) return false;
      if (globalPolicy.focusMode === "focused") return job.priority === "high";
      return job.priority !== "low";
    })
  };
}

function getPolicyHistory() {
  return store
    .listPolicyHistory()
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getCurrentPolicy() {
  return store.getGlobalStrategyPolicy();
}

function listPolicyProposals() {
  return store
    .listPolicyProposals()
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function listPolicyAuditHistory() {
  return store
    .listPolicyAuditLogs()
    .slice()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function approvePolicyProposal(proposalId, reviewerNote = "") {
  const proposal = store.getPolicyProposal(proposalId);
  if (!proposal) {
    const error = new Error(`Policy proposal ${proposalId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }
  if (!["pending", "approved"].includes(proposal.status)) {
    const error = new Error(`Proposal ${proposalId} cannot be approved from status ${proposal.status}.`);
    error.code = "INVALID_PROPOSAL_STATE";
    throw error;
  }

  proposal.status = "applied";
  proposal.reviewerNote = reviewerNote || proposal.reviewerNote || "";
  proposal.appliedAt = nowIso();
  store.savePolicyProposal(proposal);
  logPolicyAudit({
    eventType: "proposal_approved",
    actor: "user",
    relatedProposalId: proposalId,
    summary: `已批准策略提案 ${proposalId}。`
  });

  const appliedPolicy = applyPolicySnapshot({
    proposalId,
    oldPolicySnapshot: proposal.oldPolicySnapshot,
    proposedPolicySnapshot: proposal.proposedPolicySnapshot,
    actor: "user",
    summary: `已应用策略提案 ${proposalId}。`
  });

  return { proposal, policy: appliedPolicy };
}

function rejectPolicyProposal(proposalId, reviewerNote = "") {
  const proposal = store.getPolicyProposal(proposalId);
  if (!proposal) {
    const error = new Error(`Policy proposal ${proposalId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }
  if (!["pending", "approved"].includes(proposal.status)) {
    const error = new Error(`Proposal ${proposalId} cannot be rejected from status ${proposal.status}.`);
    error.code = "INVALID_PROPOSAL_STATE";
    throw error;
  }

  proposal.status = "rejected";
  proposal.reviewerNote = reviewerNote || proposal.reviewerNote || "";
  store.savePolicyProposal(proposal);
  logPolicyAudit({
    eventType: "proposal_rejected",
    actor: "user",
    relatedProposalId: proposalId,
    summary: `已拒绝策略提案 ${proposalId}。`
  });

  return proposal;
}

function revertCurrentPolicy() {
  const currentPolicy = store.getGlobalStrategyPolicy();
  const previousEntry = getPolicyHistory()[0];
  const targetSnapshot = previousEntry?.previousPolicySnapshot;

  if (!currentPolicy || !targetSnapshot) {
    const error = new Error("No previous policy snapshot is available to revert to.");
    error.code = "NO_REVERT_TARGET";
    throw error;
  }

  const revertedPolicy = applyPolicySnapshot({
    proposalId: null,
    oldPolicySnapshot: currentPolicy,
    proposedPolicySnapshot: targetSnapshot,
    actor: "user",
    summary: "已回滚到上一版生效策略快照。"
  });

  store.savePolicyHistoryEntry({
    id: createId("policyhist"),
    proposalId: null,
    previousPolicySnapshot: currentPolicy,
    nextPolicySnapshot: revertedPolicy,
    summary: "已记录本次显式策略回滚动作。",
    createdAt: nowIso(),
    revertedAt: nowIso()
  });
  logPolicyAudit({
    eventType: "policy_reverted",
    actor: "user",
    relatedProposalId: null,
    summary: `已将当前生效策略从 ${createPolicyVersion(currentPolicy)} 回滚到 ${createPolicyVersion(
      revertedPolicy
    )}.`
  });

  return revertedPolicy;
}

function applyJobOverride(jobId, payload = {}) {
  const job = store.getJob(jobId);
  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }

  const action = payload.action;
  if (!["force_proceed", "ignore_policy", "force_archive"].includes(action)) {
    const error = new Error("Invalid override action.");
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  const override = {
    action,
    active: true,
    reason: payload.reason || "",
    appliedAt: nowIso()
  };
  let nextPatch = { policyOverride: override };

  if (action === "force_proceed") {
    nextPatch = {
      ...nextPatch,
      strategyDecision: "proceed",
      status: ["archived", "inbox", "evaluating"].includes(job.status) ? "to_prepare" : job.status,
      priority: "high"
    };
  }

  if (action === "ignore_policy") {
    nextPatch = {
      ...nextPatch,
      status: ["archived", "inbox", "evaluating"].includes(job.status) ? "to_prepare" : job.status,
      priority: job.priority === "low" ? "medium" : job.priority
    };
  }

  if (action === "force_archive") {
    nextPatch = {
      ...nextPatch,
      status: "archived",
      priority: "low",
      strategyDecision: "avoid"
    };
  }

  const updatedJob = updateJob(jobId, () => nextPatch);
  logPolicyAudit({
    eventType: "user_override_applied",
    actor: "user",
    relatedProposalId: null,
    summary: `已对 ${job.company} / ${job.title} 应用人工覆盖：${humanizeOverrideActionCode(action)}。`
  });
  logActivity({
    type: "job_override_applied",
    entityType: "job",
    entityId: jobId,
    action: "job_override_applied",
    actor: "user",
    jobId,
    summary: `已对 ${job.company} 应用人工覆盖：${humanizeOverrideActionCode(action)}。`,
    decisionReason: "用户显式覆盖了当前由策略驱动的岗位处理方式。",
    overrideApplied: true,
    overrideSummary: payload.reason || action,
    activePolicyVersion: createPolicyVersion(store.getGlobalStrategyPolicy())
  });

  return updatedJob;
}

function getStrategyInsights() {
  const jobs = store.listJobs();
  const badCases = store.listBadCases();
  const reflections = store.getState().interviewReflections || [];
  const strategyProfile = store.getStrategyProfile() || refreshStrategyProfile();
  const globalPolicy = store.getGlobalStrategyPolicy() || refreshGlobalStrategyPolicy(strategyProfile);
  const roleDistribution = {};
  const industryDistribution = {};
  const successPaths = {};
  const failurePoints = {};

  jobs.forEach((job) => {
    const role = deriveRoleBucket(job);
    const industry = deriveIndustryBucket(job);
    roleDistribution[role] = (roleDistribution[role] || 0) + 1;
    industryDistribution[industry] = (industryDistribution[industry] || 0) + 1;

    if (["interviewing", "offer"].includes(job.status)) {
      successPaths[role] = (successPaths[role] || 0) + 1;
    }
    if (job.status === "rejected") {
      failurePoints[role] = (failurePoints[role] || 0) + 1;
    }
  });

  badCases.forEach((badCase) => {
    const sourceJob = store.getJob(badCase.jobId) || badCase;
    const role = deriveRoleBucket(sourceJob);
    failurePoints[role] = (failurePoints[role] || 0) + 1;
  });

  const topRole = Object.entries(successPaths).sort((a, b) => b[1] - a[1])[0]?.[0];
  const weakRole = Object.entries(failurePoints).sort((a, b) => b[1] - a[1])[0]?.[0];
  const recommendations = [];

  if (topRole) {
    recommendations.push(`你在 ${topRole} 类岗位上的转化更好，建议继续保留在主动推进与申请准备队列。`);
  }
  if (weakRole) {
    recommendations.push(`建议减少 ${weakRole} 类岗位的投递，因为它们更容易集中出现在失败结果或失败案例里。`);
  }
  if (strategyProfile.learnedFromInterviews?.length) {
    recommendations.push(`当前最优先补齐的能力短板：${strategyProfile.learnedFromInterviews[0]}。`);
  }
  if (recommendations.length === 0) {
    recommendations.push("当前样本还不够多，暂时无法形成强策略偏向；建议继续探索，同时持续记录结果。");
  }
  recommendations.unshift(
    globalPolicy.focusMode === "focused"
      ? `当前建议继续聚焦 ${summarizeList(globalPolicy.preferredRoles || globalPolicy.targetRolesPriority || [], "核心岗位方向")}，把信号较弱的岗位放在主准备队列之外。`
      : globalPolicy.focusMode === "exploratory"
        ? "当前投递方向仍然偏分散。下一轮建议逐步收窄到最先进入面试的岗位簇。"
        : "当前投递结构相对平衡，继续优先推进转化表现更好的岗位簇。"
  );

  return {
    roleDistribution,
    industryDistribution,
    successPaths,
    failurePoints,
    globalPolicy,
    preferredRoles: strategyProfile.preferredRoles || [],
    riskyRoles: strategyProfile.riskyRoles || [],
    successPatterns: strategyProfile.successPatterns || [],
    failurePatterns: strategyProfile.failurePatterns || [],
    interviewThemes: reflections.flatMap((item) => item.skillGaps || []).slice(0, 6),
    recommendations: recommendations.slice(0, 3),
    policySignals: {
      focusMode: globalPolicy.focusMode,
      riskTolerance: globalPolicy.riskTolerance,
      targetRolesPriority: globalPolicy.targetRolesPriority || []
    },
    concentrationScore:
      Object.keys(roleDistribution).length <= 2 ? "high" : Object.keys(roleDistribution).length <= 4 ? "medium" : "low",
    driftStatus:
      weakRole && topRole && weakRole !== topRole
        ? "drifting_from_success_path"
        : Object.keys(roleDistribution).length > 4
          ? "over_distributed"
          : "aligned",
    strategyHealth:
      topRole && !weakRole
        ? "focused"
        : weakRole && badCases.length > 1
          ? "needs_tightening"
          : "forming"
  };
}

function updateBadCase(jobId, payload = {}) {
  const job = store.getJob(jobId);
  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }

  const existing = store.getBadCaseByJobId(jobId);
  if (payload.isBadCase === false) {
    store.removeBadCase(jobId);
    const strategyProfile = refreshStrategyProfile();
    refreshGlobalStrategyPolicy(strategyProfile, {
      reason: "bad_case_cleared",
      triggerType: "bad_case",
      triggerSource: "feedback_loop"
    });
    logActivity({
      type: "bad_case_cleared",
      entityType: "job",
      entityId: jobId,
      action: "bad_case_cleared",
      actor: "user",
      jobId,
      summary: `已取消 ${job.company} 的失败案例标记。`,
      agentName: "反馈回流阶段",
      inputSummary: "用户取消了失败案例标记。",
      outputSummary: "这条岗位不再作为失败案例继续跟踪。",
      decisionReason: "这样可以让失败案例库与用户最新判断保持一致。"
    });
    return null;
  }

  const badCase = {
    id: existing?.id || createId("badcase"),
    jobId,
    company: job.company,
    title: job.title,
    rawJd: job.jdRaw || "",
    fitAssessment: store.getFitAssessmentByJobId(jobId) || null,
    finalStatus: job.status,
    issueDescription: payload.issueDescription || existing?.issueDescription || "",
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso()
  };

  store.saveBadCase(badCase);
  const strategyProfile = refreshStrategyProfile();
  refreshGlobalStrategyPolicy(strategyProfile, {
    reason: "bad_case_marked",
    triggerType: "bad_case",
    triggerSource: "feedback_loop"
  });
  logActivity({
    type: "bad_case_marked",
    entityType: "job",
    entityId: jobId,
    action: "bad_case_marked",
    actor: "user",
    jobId,
    summary: `已将 ${job.company} 标记为失败案例。`,
    agentName: "反馈回流阶段",
    inputSummary: payload.issueDescription
      ? `用户将这条岗位标记为失败案例，并补充说明：${payload.issueDescription}`
      : "用户将这条岗位标记为失败案例。",
    outputSummary: `失败案例库中已新增 ${job.company} 的可回放记录。`,
    decisionReason:
      "失败案例会保留错误或失真的判断轨迹，方便后续评估回看、审计与持续修正。"
  });

  return badCase;
}

function listBadCases() {
  return store
    .listBadCases()
    .slice()
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

async function uploadResumeDocument(payload) {
  const parserUrl = getResumeParserUrl();
  const resumeDocument = await parseResumeWithBestEffort(payload);
  const savedResume = store.saveResumeDocument(resumeDocument);

  logger.info("resume.upload_parsed", {
    parserUrl: parserUrl || "local_node_parser",
    fileName: savedResume.fileName,
    parseStatus: savedResume.parseStatus || savedResume.status || null,
    parseQuality: savedResume.parseQuality?.label || null,
    cleanedTextLength: savedResume.cleanedText?.length || 0,
    summaryLength: savedResume.summary?.length || 0
  });

  logActivity({
    type: "resume_uploaded",
    entityType: "resume_document",
    entityId: savedResume.id,
    action: "resume_uploaded",
    summary: `已上传原始简历：${savedResume.fileName}。`,
    agentName: "简历解析阶段",
    inputSummary: `收到简历文件 ${savedResume.fileName}（${savedResume.mimeType}，${savedResume.fileSizeBytes} bytes）。`,
    outputSummary: `解析状态=${savedResume.parseStatus || savedResume.status}；质量=${savedResume.parseQuality?.label || "low"}；提取方式=${savedResume.extractionMethod}；清洗后文本长度=${savedResume.cleanedText?.length || 0}。`,
    decisionReason:
      savedResume.parseStatus === "parse_success" || savedResume.status === "parsed"
        ? "系统已提取并结构化原始简历，后续岗位定制会优先使用结构化 profile 与清洗后的正文。"
        : savedResume.parseStatus === "parse_partial" || savedResume.status === "partial"
          ? "系统只提取到部分可用信息，因此会保留结构化结果和清洗后正文，并提示用户继续人工修正。"
          : "系统未能稳定解析这份简历，建议用户改传 DOCX 或稍后重试。"
  });

  return { resumeDocument: savedResume };
}

function getCurrentResume() {
  return {
    resumeDocument: store.getLatestResumeDocument() || null,
    resumeDocuments: store.listResumeDocuments()
  };
}

async function exportJobTailoringDocx(jobId) {
  const job = store.getJob(jobId);
  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }

  const tailoringOutput = store.getTailoringOutputByJobId(jobId) || null;
  const applicationPrep = store.getApplicationPrepByJobId(jobId) || null;
  const resumeDocument = job.resumeDocumentId
    ? store.getResumeDocument(job.resumeDocumentId) || store.getLatestResumeDocument()
    : store.getLatestResumeDocument();

  if (!applicationPrep || !tailoringOutput) {
    const error = new Error("???????????????? DOCX?");
    error.code = "TAILORING_REQUIRED";
    throw error;
  }

  const exported = await exportTailoredResumeDocx({
    job,
    tailoringOutput: {
      ...tailoringOutput,
      applicationPrepSnapshot: applicationPrep
    },
    resumeDocument
  });

  logActivity({
    type: "tailoring_exported",
    entityType: "tailoring_output",
    entityId: tailoringOutput.id,
    action: "tailoring_exported",
    jobId,
    summary: `??? ${job.company} / ${job.title} ? DOCX ?????`,
    agentName: "??????",
    inputSummary: `??????????${job.company} / ${job.title}?`,
    outputSummary: `???? ${exported.fileName}??????????????????`,
    decisionReason: "????????????????????????????????????????"
  });

  return exported;
}

module.exports = {
  importJobDraftFromUrl,
  ingestJob,
  evaluateJob,
  generateResumeTailoringOutput,
  saveResumeTailoringOutput,
  prepareJobApplication,
  saveApplicationPrep,
  transitionJobStatus,
  saveProfile,
  uploadResumeDocument,
  getCurrentResume,
  exportJobTailoringDocx,
  reflectInterview,
  getJobDetail,
  buildTailoringWorkspace,
  getOrBuildTailoringWorkspace,
  saveTailoringWorkspace,
  refineTailoringWorkspace,
  getDashboardSummary,
  getMetricsSummary,
  getCurrentPolicy,
  getStrategyInsights,
  getPolicyHistory,
  listPolicyProposals,
  listPolicyAuditHistory,
  approvePolicyProposal,
  rejectPolicyProposal,
  revertCurrentPolicy,
  refreshGlobalStrategyPolicy,
  updateBadCase,
  applyJobOverride,
  listBadCases,
  isPrepReady
};

