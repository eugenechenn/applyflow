const store = require("../../server/store");
const { createId, nowIso } = require("../utils/id");
const jobStatusModule = require("../state/job-status");
const { updateJob } = require("./shared-state-helpers");
const { logActivity } = require("./activity-logger");
const { agentRegistry } = require("./agent-registry");
const { runAgentStage } = require("./stage-runner");
const logger = require("../../server/platform/logger");
const { exportTailoredResumeDocx, exportTailoredResumePdf } = require("../resume/resume-exporter");
const { buildExportDtoFromContracts } = require("../resume/export-dto-mapper");
const { parseResumeWithBestEffort, getResumeParserUrl } = require("../resume/resume-parser-client");
const { runRuleBasedResumeTailoringAgent, refineResumeBullet } = require("./agents/resume-tailoring-agent-v2");
const { buildJobDecisionFromFitAssessment } = require("../decision/job-decision-mapper");
const { buildControlGateResultFromJobDecision } = require("../control/control-gate-evaluator");
const { recordFeedbackTrace } = require("../feedback/feedback-trace-recorder");
const {
  createTailoredResumeContract,
  validateTailoredResumeContract
} = require("../contracts/tailored-resume-contracts");
const { createPrepDto, validatePrepDto } = require("../contracts/prep-dto-contracts");
const {
  createExecutionDto,
  validateExecutionDto,
  createSubmitContract,
  validateSubmitContract
} = require("../contracts/execution-contracts");
const {
  createResumeExportContract,
  validateResumeExportContract,
  validateExportDto,
  completeResumeExportContractSuccess,
  completeResumeExportContractFailure
} = require("../contracts/resume-export-contracts");
const {
  buildCanonicalResumeFromResumeDocument
} = require("../workspace/legacy-resume-adapter");
const {
  buildJobSummaryModel,
  normalizeResumeWorkspaceAsset: normalizeResumeWorkspaceAssetModel,
  normalizeResumeWorkspaceAssetFromMasterResume,
  buildTailoredWorkspaceResume: buildTailoredWorkspaceResumeModel,
  buildWorkspaceInsights,
  buildWorkspaceReviewModules
} = require("../workspace/tailoring-workspace-model");
const {
  buildJobWorkspaceViewModel,
  extractFeedbackTraces,
  buildResumeViewModel,
  buildFeedbackTimelineView,
  buildExecutionSessionView,
  buildTailoringWorkspaceViewModel,
  buildTailoringWorkspaceEditDto
} = require("../workspace/job-workspace-view-model");
const {
  buildJobScoringViewModel,
  attachScoringToJobWorkspaceViewModel,
  buildJobDeduplicationContext
} = require("../jobs/job-scoring-view-model");
const { applyLlmScoringToTopJobs } = require("../jobs/job-llm-scoring-view");
const {
  hasExplicitJobPreferenceProfile,
  normalizeLightweightProfile,
  normalizeJobPreferenceProfile,
  buildLightweightProfileFromJobPreferenceProfile
} = require("../jobs/job-preference-profile");
const {
  buildMasterResumeSeedFromResumeDocument,
  buildEmptyMasterResume,
  buildMasterResumeViewModel,
  buildMasterResumeEditDto
} = require("../workspace/master-resume-view-model");
const {
  createBrowserExecutionBridgeInput,
  validateBrowserExecutionBridgeInput,
  createBrowserExecutionBridgeResult,
  validateBrowserExecutionBridgeResult
} = require("../browser/browser-apply-bridge");
const { buildBrowserApplyViewModel } = require("../browser/browser-apply-view-model");
const { runGenericHtmlFormSession } = require("../browser/browser-apply-session-runner");
const {
  createMasterResumeContract,
  validateMasterResumeContract
} = require("../contracts/master-resume-contracts");
const {
  createDiscoveryIntent,
  importCandidatesToCanonicalListings,
  saveLeadProcessingResult,
  getLeadProcessingResultByIntent,
  getDiscoveryIntent,
  listCanonicalListingsByIntent,
  getDedupCandidatePoolByIntent,
  getBatchDecisionResultByIntent,
  getRankingResultByIntent,
  getShortlistResultByIntent,
  getCanonicalListingByIntentAndListingId,
  createShortlistAdmission
} = require("../discovery/job-discovery-pipeline");
const { ingestFeishuRawLeads } = require("../discovery/feishu-lead-adapter");
const { syncFeishuBitableLeads } = require("../discovery/feishu-sync-layer");
const {
  loadOfflineJsonBatch,
  buildLeadProcessingResultFromOfflineJson
} = require("../discovery/offline-json-source-adapter");
const { buildLeadResolutionViewModel } = require("../discovery/lead-resolution-view-model");
const {
  validateShortlistAdmissionContract
} = require("../contracts/job-shortlist-admission-contracts");

const assertJobStatusTransition =
  jobStatusModule?.assertJobStatusTransition ||
  function assertJobStatusTransitionFallback() {
    throw new Error("assertJobStatusTransition is not available.");
  };
const TRACKER_STATES = new Set([
  "none",
  "saved",
  "prep",
  "tailored",
  "applied",
  "interview",
  "rejected",
  "offer"
]);
const FEEDBACK_STATES = new Set(["none", "good_fit", "bad_fit", "misclassified"]);
const SHORTLIST_STATES = new Set(["none", "shortlisted"]);
const MATERIAL_RESUME_STATES = new Set(["none", "draft", "tailored", "finalized"]);
const MATERIAL_COVER_LETTER_STATES = new Set(["none", "draft", "tailored", "finalized"]);
const MATERIAL_INTERVIEW_PREP_STATES = new Set(["none", "draft", "ready"]);
const SUBMISSION_AUDIT_STATUS_STATES = new Set(["none", "ready", "submitted", "failed", "needs_review"]);
const SUBMISSION_AUDIT_SOURCE_STATES = new Set(["manual", "plugin", "system"]);
const FOLLOW_UP_STATUS_STATES = new Set(["none", "planned", "done", "skipped"]);
const FOLLOW_UP_CHANNEL_STATES = new Set(["email", "phone", "linkedin", "other"]);

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

function resolveTailoringMasterResumeSource(profile = {}, resumeDocument = null) {
  const savedCanonicalMasterResume = store.getMasterResume();
  if (savedCanonicalMasterResume) {
    const masterResume = createMasterResumeContract(savedCanonicalMasterResume);
    const validation = validateMasterResumeContract(masterResume);
    if (validation.valid) {
      return {
        masterResume,
        source: "canonical_saved",
        sourceResumeId: masterResume.trace?.sourceResumeId || resumeDocument?.id || ""
      };
    }
  }

  if (resumeDocument) {
    const masterResume = buildMasterResumeSeedFromResumeDocument(resumeDocument, profile);
    return {
      masterResume,
      source: "resume_document_seed",
      sourceResumeId: resumeDocument.id || ""
    };
  }

  return {
    masterResume: buildEmptyMasterResume(profile),
    source: "empty_seed",
    sourceResumeId: ""
  };
}

function buildTailoringBaseResumeAsset({ profile = {}, resumeDocument = null, masterResume = null } = {}) {
  if (masterResume) {
    return sanitizeCanonicalResumeAsset(
      normalizeResumeWorkspaceAssetFromMasterResume(masterResume, profile, resumeDocument)
    );
  }
  return sanitizeCanonicalResumeAsset(normalizeResumeWorkspaceAssetModel(resumeDocument, profile));
}

function buildTailoredWorkspaceResume(tailoringOutput = null, baseResumeAsset = {}, jobSummary = {}) {
  return buildTailoredWorkspaceResumeModel(tailoringOutput, baseResumeAsset, jobSummary);
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
  const jobDecision = buildJobDecisionFromFitAssessment({
    job,
    fitAssessment,
    userId: profile.id
  });

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
      activePolicyVersion: fitAssessment.activePolicyVersion,
      policyProposalId: fitAssessment.policyProposalId,
      overrideApplied: fitAssessment.overrideApplied,
      overrideSummary: fitAssessment.overrideSummary,
    metadata: {
      jobId,
      fitScore: fitAssessment.fitScore,
      recommendation: fitAssessment.recommendation,
      strategyDecision: fitAssessment.strategyDecision,
      jobDecision,
      llm: fitAssessment.llmMeta || null
    }
  });

  recordFeedbackTrace({
    jobId,
    decisionId: jobDecision.decisionId || fitAssessment.id || "",
    eventType: "decision_generated",
    outcome: "succeeded",
    actor: "system",
    jobDecision,
    executionSnapshot: {
      stage: "evaluate",
      status: "completed",
      details: "Job decision generated from fit assessment."
    },
    runId: jobDecision.trace?.runId || fitAssessment.id || "",
    source: "workflow_controller.evaluate"
  });

  return { job: updatedJob, fitAssessment, jobDecision, nextTask, globalPolicy };
}

function buildJobDecisionSnapshotForJob(job, fitAssessment = null) {
  if (!fitAssessment) return null;
  return buildJobDecisionFromFitAssessment({
    job,
    fitAssessment,
    userId: fitAssessment.profileId || store.getProfile()?.id || ""
  });
}

function buildControlGateResultForJob({
  job,
  fitAssessment,
  jobDecision = null,
  traceSource = "execution_gate"
}) {
  const decision = jobDecision || buildJobDecisionSnapshotForJob(job, fitAssessment);
  if (!decision) {
    const error = new Error("JobDecision is required before execution gate.");
    error.code = "DECISION_REQUIRED";
    throw error;
  }
  const globalPolicy = store.getGlobalStrategyPolicy() || {};
  return buildControlGateResultFromJobDecision({
    jobDecision: decision,
    job,
    policyVersion: createPolicyVersion(globalPolicy),
    trace: {
      source: traceSource,
      version: "workflow-controller.control-gate.v1",
      runId: decision.trace?.runId || decision.decisionId || ""
    }
  });
}

function assertExecutionAllowed(controlGateResult, context = "execution", feedbackContext = {}) {
  if (controlGateResult.status === "allowed") return;

  recordFeedbackTrace({
    jobId: feedbackContext.jobId || "",
    decisionId: feedbackContext.jobDecision?.decisionId || feedbackContext.decisionId || "",
    controlId: controlGateResult.controlId || "",
    eventType: "execution_blocked",
    outcome: "blocked",
    actor: feedbackContext.actor || "system",
    jobDecision: feedbackContext.jobDecision || null,
    controlGateResult,
    executionSnapshot: {
      stage: feedbackContext.stage || "execution",
      status: "blocked",
      details: `Blocked before ${context}.`
    },
    failureReason: controlGateResult.blockingIssues?.join("; ") || "Blocked by control gate.",
    runId: controlGateResult.trace?.runId || "",
    source: "workflow_controller.control_gate"
  });

  const error =
    controlGateResult.status === "blocked"
      ? new Error("Execution blocked by control gate.")
      : new Error("Execution requires human review before proceeding.");
  error.code =
    controlGateResult.status === "blocked"
      ? "CONTROL_GATE_BLOCKED"
      : "CONTROL_GATE_REVIEW_REQUIRED";
  error.details = {
    context,
    controlGateResult
  };
  throw error;
}

function normalizeAdmissionContext(admission = null) {
  if (!admission || typeof admission !== "object") {
    return {
      admissionId: "",
      intentId: "",
      shortlistId: "",
      listingId: "",
      admissionStatus: "",
      admissionBucket: "",
      selectionReason: ""
    };
  }
  return {
    admissionId: String(admission.admissionId || "").trim(),
    intentId: String(admission.intentId || "").trim(),
    shortlistId: String(admission.shortlistId || "").trim(),
    listingId: String(admission.listingId || "").trim(),
    admissionStatus: String(admission.admissionStatus || "").trim(),
    admissionBucket: String(admission.admissionBucket || "").trim(),
    selectionReason: String(admission.selectionReason || "").trim()
  };
}

function assertShortlistAdmissionForPrepare(job = {}, options = {}) {
  const admission = job?.shortlistAdmission || null;
  const discoveryContext = job?.discoveryContext || null;
  if (!discoveryContext?.intentId && !discoveryContext?.listingId && !admission) {
    return null;
  }

  if (!admission || typeof admission !== "object") {
    const error = new Error("Discovery-sourced job requires shortlist admission before prepare.");
    error.code = "SHORTLIST_ADMISSION_REQUIRED";
    error.details = {
      jobId: job.id,
      discoveryContext
    };
    throw error;
  }

  const validation = validateShortlistAdmissionContract(admission);
  if (!validation.ok) {
    const error = new Error(`Invalid shortlist admission on job: ${validation.errors.join("; ")}`);
    error.code = "INVALID_SHORTLIST_ADMISSION_CONTRACT";
    error.details = { errors: validation.errors, admission, jobId: job.id };
    throw error;
  }

  if (admission.admissionStatus === "admitted" || admission.admissionStatus === "overridden") {
    return admission;
  }

  if (admission.admissionStatus === "override_required") {
    const error = new Error("Listing requires explicit override before prepare.");
    error.code = "SHORTLIST_OVERRIDE_REQUIRED";
    error.details = {
      jobId: job.id,
      admission
    };
    throw error;
  }

  const error = new Error("Listing is blocked by shortlist admission policy.");
  error.code = "SHORTLIST_ADMISSION_BLOCKED";
  error.details = {
    jobId: job.id,
    admission
  };
  throw error;
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
  masterResume = null,
  masterResumeSource = "",
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
    masterResumeId: masterResume?.masterResumeId || existingTailoringOutput?.masterResumeId || null,
    masterResumeSource: masterResumeSource || existingTailoringOutput?.masterResumeSource || "unknown",
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
      baseResumeAssetId: masterResume?.masterResumeId || resumeDocument?.id || existingTailoringOutput?.workspace?.baseResumeAssetId || null,
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
  const masterResumeSource = resolveTailoringMasterResumeSource(profile, resumeDocument);
  if (!resumeDocument && masterResumeSource.source !== "canonical_saved") {
    const error = new Error("请先上传原始简历，再生成岗位定制简历。");
    error.code = "RESUME_REQUIRED";
    throw error;
  }

  const baseResumeAsset = buildTailoringBaseResumeAsset({
    profile,
    resumeDocument,
    masterResume: masterResumeSource.masterResume
  });
  const jobSummary = buildJobSummaryModel(job, fitAssessment, existingTailoringOutput);
  const fallbackAgentResult = runRuleBasedResumeTailoringAgent({
    job,
    profile,
    fitAssessment,
    resumeDocument,
    masterResume: masterResumeSource.masterResume,
    refinePrompt
  });
  const workspaceDraft = buildCanonicalWorkspaceDraft(baseResumeAsset, jobSummary, fitAssessment, {
    refinePrompt,
    selfEvaluation: fallbackAgentResult?.tailoredSummary || ""
  });
  const draftForModel = { workspaceDraft, tailoredSummary: workspaceDraft.selfEvaluation };
  const tailoredResume = buildTailoredWorkspaceResumeModel(draftForModel, baseResumeAsset, jobSummary);
  const reviewModules = buildWorkspaceReviewModules(baseResumeAsset, tailoredResume);
  const insights = buildWorkspaceInsights(jobSummary, baseResumeAsset, tailoredResume);
  const tailoringOutput = buildTailoringOutputRecord({
    existingTailoringOutput,
    job,
    fitAssessment,
    resumeDocument,
    masterResume: masterResumeSource.masterResume,
    masterResumeSource: masterResumeSource.source,
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
    inputSummary: `已基于岗位 ${job.title}、canonical MasterResume（${masterResumeSource.source}）与匹配评估结果生成定制版。`,
    outputSummary: `生成 ${workspaceDraft.workExperience.length} 段定制工作经历、${workspaceDraft.projectExperience.length} 段定制项目经历。`,
    decisionReason: "系统优先读取 canonical MasterResume 作为岗位定制主源，只保留结构化经历进入工作区。"
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

  const masterResumeSource = resolveTailoringMasterResumeSource(profile || {}, resumeDocument);
  const baseResumeAsset = buildTailoringBaseResumeAsset({
    profile: profile || {},
    resumeDocument,
    masterResume: masterResumeSource.masterResume
  });
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
  const tailoredResume = buildTailoredWorkspaceResumeModel(draftForModel, baseResumeAsset, jobSummary);
  const reviewModules = buildWorkspaceReviewModules(baseResumeAsset, tailoredResume);
  const insights = buildWorkspaceInsights(jobSummary, baseResumeAsset, tailoredResume);
  const tailoringOutput = buildTailoringOutputRecord({
    existingTailoringOutput,
    job,
    fitAssessment,
    resumeDocument,
    masterResume: masterResumeSource.masterResume,
    masterResumeSource: masterResumeSource.source,
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

async function prepareJobApplication(jobId, payload = {}) {
  const job = store.getJob(jobId);
  const profile = store.getProfile();
  const fitAssessment = store.getFitAssessmentByJobId(jobId);
  const resumeDocument = store.getLatestResumeDocument();

  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }
  try {
    const admission = assertShortlistAdmissionForPrepare(job, payload);
    if (admission?.admissionStatus === "overridden") {
      recordFeedbackTrace({
        jobId,
        decisionId: "",
        eventType: "user_override",
        outcome: "overridden",
        actor: admission.override?.actor || admission.actor || "user",
        executionSnapshot: {
          stage: "prepare",
          status: "override_applied",
          details: `Shortlist admission override accepted from ${admission.admissionBucket}.`
        },
        userOverride: {
          applied: true,
          action: "shortlist_admission_override",
          reason: admission.override?.overrideReason || ""
        },
        runId: admission.admissionId || "",
        source: "workflow_controller.shortlist_admission"
      });
    }
  } catch (error) {
    if (["SHORTLIST_ADMISSION_REQUIRED", "SHORTLIST_OVERRIDE_REQUIRED", "SHORTLIST_ADMISSION_BLOCKED"].includes(error.code)) {
      const admission = job?.shortlistAdmission || null;
      recordFeedbackTrace({
        jobId,
        decisionId: "",
        eventType: "execution_blocked",
        outcome: "blocked",
        actor: "system",
        executionSnapshot: {
          stage: "prepare",
          status: "blocked",
          details: error.message
        },
        failureReason: error.message,
        userOverride: admission?.override?.applied
          ? {
              applied: true,
              action: "shortlist_admission_override",
              reason: admission.override?.overrideReason || ""
            }
          : { applied: false, action: "", reason: "" },
        runId: admission?.admissionId || "",
        source: "workflow_controller.shortlist_admission"
      });
    }
    throw error;
  }

  if (!profile) {
    const error = new Error("Profile is required before preparation.");
    error.code = "PROFILE_REQUIRED";
    throw error;
  }
  const masterResumeSource = resolveTailoringMasterResumeSource(profile, resumeDocument);
  if (!resumeDocument && masterResumeSource.source !== "canonical_saved") {
    const error = new Error("请先上传原始简历，再生成申请准备包。");
    error.code = "RESUME_REQUIRED";
    throw error;
  }

  const jobDecision = buildJobDecisionSnapshotForJob(job, fitAssessment);
  const controlGateResult = buildControlGateResultForJob({
    job,
    fitAssessment,
    jobDecision,
    traceSource: "prepare_job_application"
  });
  recordFeedbackTrace({
    jobId,
    decisionId: jobDecision?.decisionId || "",
    controlId: controlGateResult.controlId || "",
    eventType: "control_evaluated",
    outcome:
      controlGateResult.status === "allowed"
        ? "succeeded"
        : controlGateResult.status === "blocked"
          ? "blocked"
          : "observed",
    actor: "system",
    jobDecision,
    controlGateResult,
    executionSnapshot: {
      stage: "prepare",
      status: "gate_checked",
      details: `Control gate status: ${controlGateResult.status}`
    },
    runId: controlGateResult.trace?.runId || "",
    source: "workflow_controller.prepare"
  });
  updateJob(jobId, () => ({
    latestControlGateResult: controlGateResult
  }));
  assertExecutionAllowed(controlGateResult, "prepare_job_application", {
    jobId,
    jobDecision,
    stage: "prepare",
    actor: "system"
  });

  try {
    const tailoringOutput =
      store.getTailoringOutputByJobId(jobId) ||
      (await generateResumeTailoringOutput(jobId)).tailoringOutput;
    const tailoredResumeContract = buildTailoredResumeContractForJob({
      job,
      fitAssessment,
      resumeDocument,
      masterResume: masterResumeSource.masterResume,
      tailoringOutput,
      applicationPrep: store.getApplicationPrepByJobId(jobId) || null
    });
    const prepDto = buildPrepDtoFromContracts({
      job,
      resumeDocument,
      tailoredResumeContract,
      applicationPrep: store.getApplicationPrepByJobId(jobId) || null,
      targetingBrief: tailoringOutput?.targetingBrief || null,
      shortlistAdmission: job.shortlistAdmission || null
    });
    const executionDto = buildExecutionDtoFromContracts({
      job,
      controlGateResult,
      tailoredResumeContract,
      prepDto,
      executionMode: "dry-run",
      targetUrl: job.jobUrl || "",
      actor: "system",
      note: "Prepared execution context from tailored resume and prep dto.",
      shortlistAdmission: job.shortlistAdmission || null
    });
    updateJob(jobId, () => ({
      latestExecutionDto: executionDto
    }));

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
      () =>
        agentRegistry.applicationPrep({
          job,
          profile,
          fitAssessment,
          resumeDocument,
          masterResume: masterResumeSource.masterResume,
          tailoredResumeContract,
          prepDto,
          tailoringOutput
        })
    );

    const applicationPrep = prepStage.result;
    store.saveApplicationPrep(applicationPrep);
    const updatedJob = updateJob(jobId, () => ({
      applicationPrepId: applicationPrep.id,
      resumeDocumentId: resumeDocument?.id || job.resumeDocumentId || null
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

    recordFeedbackTrace({
      jobId,
      decisionId: jobDecision?.decisionId || "",
      controlId: controlGateResult.controlId || "",
      eventType: "execution_prepared",
      outcome: "succeeded",
      actor: "system",
      jobDecision,
      controlGateResult,
      executionSnapshot: {
        stage: "prepare",
        status: "completed",
        details: "Application prep package generated."
      },
      runId: executionDto.runId || controlGateResult.trace?.runId || "",
      source: "workflow_controller.prepare"
    });

    return {
      job: updatedJob,
      jobDecision,
      controlGateResult,
      applicationPrep,
      tailoredResumeContract,
      prepDto,
      executionDto,
      resumeDocument
    };
  } catch (error) {
    if (!["CONTROL_GATE_BLOCKED", "CONTROL_GATE_REVIEW_REQUIRED"].includes(error.code)) {
      recordFeedbackTrace({
        jobId,
        decisionId: jobDecision?.decisionId || "",
        controlId: controlGateResult.controlId || "",
        eventType: "execution_failed",
        outcome: "failed",
        actor: "system",
        jobDecision,
        controlGateResult,
        executionSnapshot: {
          stage: "prepare",
          status: "failed",
          details: "Failed while generating preparation output."
        },
        failureReason: error.message || "Unknown preparation failure.",
        runId: controlGateResult.trace?.runId || "",
        source: "workflow_controller.prepare"
      });
    }
    throw error;
  }
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

function runExecutionDryRun(jobId, payload = {}) {
  const job = store.getJob(jobId);
  const fitAssessment = store.getFitAssessmentByJobId(jobId);
  const resumeDocument = store.getLatestResumeDocument();
  const applicationPrep = store.getApplicationPrepByJobId(jobId);
  const tailoringOutput = store.getTailoringOutputByJobId(jobId);

  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }
  if (!applicationPrep || !tailoringOutput) {
    const error = new Error("Dry-run requires prepared tailoring and prep data.");
    error.code = "PREP_REQUIRED";
    throw error;
  }

  const jobDecision = buildJobDecisionSnapshotForJob(job, fitAssessment);
  const controlGateResult = buildControlGateResultForJob({
    job,
    fitAssessment,
    jobDecision,
    traceSource: "execution_dry_run"
  });

  if (controlGateResult.status === "blocked") {
    assertExecutionAllowed(controlGateResult, "execution_dry_run", {
      jobId,
      jobDecision,
      stage: "dry_run",
      actor: "system"
    });
  }

  const tailoredResumeContract = buildTailoredResumeContractForJob({
    job,
    fitAssessment,
    resumeDocument,
    tailoringOutput,
    applicationPrep
  });
  const prepDto = buildPrepDtoFromContracts({
    job,
    resumeDocument,
    tailoredResumeContract,
    applicationPrep,
    targetingBrief: tailoringOutput?.targetingBrief || null,
    shortlistAdmission: job.shortlistAdmission || null
  });
  const executionDto = buildExecutionDtoFromContracts({
    job,
    controlGateResult,
    tailoredResumeContract,
    prepDto,
    executionMode: "dry-run",
    targetUrl: payload.targetUrl || job.jobUrl || "",
    actor: "system",
    note: "Dry-run execution prepared.",
    shortlistAdmission: job.shortlistAdmission || null
  });

  const updatedJob = updateJob(jobId, () => ({
    latestControlGateResult: controlGateResult,
    latestExecutionDto: executionDto
  }));

  recordFeedbackTrace({
    jobId,
    decisionId: jobDecision?.decisionId || "",
    controlId: controlGateResult.controlId || "",
    eventType: "execution_dry_run",
    outcome: controlGateResult.status === "blocked" ? "blocked" : "observed",
    actor: "system",
    jobDecision,
    controlGateResult,
    executionSnapshot: {
      stage: "dry_run",
      status: "completed",
      details: "Execution dry-run finished with contract snapshot."
    },
    runId: executionDto.runId,
    source: "workflow_controller.execution"
  });

  return { job: updatedJob, executionDto, controlGateResult, prepDto, tailoredResumeContract };
}

function buildDefaultBrowserFormSnapshot(mode = "standard", targetUrl = "") {
  const normalizedMode = String(mode || "standard").trim();
  if (normalizedMode === "no_form") {
    return {
      hasForm: false,
      sourceUrl: targetUrl || "",
      pageTitle: "ApplyFlow Browser Session",
      features: {
        hasCaptcha: false,
        requiresLogin: false,
        hasDeepIframe: false,
        multiStepHeavy: false,
        dynamicQuestionnaire: false
      },
      fields: []
    };
  }
  if (normalizedMode === "blocked") {
    return {
      hasForm: true,
      sourceUrl: targetUrl || "",
      pageTitle: "ApplyFlow Browser Session",
      features: {
        hasCaptcha: true,
        requiresLogin: true,
        hasDeepIframe: true,
        multiStepHeavy: true,
        dynamicQuestionnaire: true
      },
      fields: [{ selector: "input[name='email']", name: "email", label: "Email", type: "email", required: true }]
    };
  }
  return {
    hasForm: true,
    sourceUrl: targetUrl || "",
    pageTitle: "ApplyFlow Browser Session",
    features: {
      hasCaptcha: false,
      requiresLogin: false,
      hasDeepIframe: false,
      multiStepHeavy: false,
      dynamicQuestionnaire: false
    },
    fields: [
      { selector: "input[name='full_name']", name: "full_name", label: "Full Name", type: "text", required: true },
      { selector: "input[name='email']", name: "email", label: "Email", type: "email", required: true },
      { selector: "input[name='phone']", name: "phone", label: "Phone", type: "tel", required: false },
      { selector: "input[name='resume']", name: "resume", label: "Resume Upload", type: "file", required: true },
      {
        selector: "textarea[name='cover_letter']",
        name: "cover_letter",
        label: "Cover Letter",
        type: "textarea",
        required: false
      }
    ]
  };
}

function buildMockBrowserPage(formSnapshot = {}, targetUrl = "") {
  return {
    async getFormSnapshot() {
      return formSnapshot;
    },
    async fillField() {
      return true;
    },
    async uploadFile() {
      return true;
    },
    async collectEvidence() {
      return {
        currentUrl: formSnapshot.sourceUrl || targetUrl || "",
        pageTitle: formSnapshot.pageTitle || "ApplyFlow Browser Session",
        screenshotRefs: ["browser://shots/session-latest.png"],
        evidenceRefs: ["browser://evidence/session-latest.json"],
        notes: ["Browser apply session executed in controlled simulation mode."]
      };
    }
  };
}

async function runBrowserApplySession(jobId, payload = {}) {
  const job = store.getJob(jobId);
  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }
  if (!job.latestExecutionDto) {
    const error = new Error("Browser apply session requires an execution run. Please run dry-run first.");
    error.code = "EXECUTION_RUN_REQUIRED";
    throw error;
  }

  const bridgeInput = createBrowserExecutionBridgeInput({
    executionDto: job.latestExecutionDto,
    controlGateResult: job.latestControlGateResult || null,
    listingId: job.shortlistAdmission?.listingId || job.id || "",
    trace: {
      source: "workflow_controller.browser_apply",
      actor: String(payload.actor || "user")
    }
  });
  const bridgeInputValidation = validateBrowserExecutionBridgeInput(bridgeInput);
  if (!bridgeInputValidation.ok) {
    const error = new Error(`Invalid browser bridge input: ${bridgeInputValidation.errors.join("; ")}`);
    error.code = "INVALID_BROWSER_BRIDGE_INPUT";
    error.details = { errors: bridgeInputValidation.errors, bridgeInput };
    throw error;
  }

  const formSnapshot =
    payload.formSnapshot && typeof payload.formSnapshot === "object"
      ? payload.formSnapshot
      : buildDefaultBrowserFormSnapshot(payload.simulationMode || "standard", bridgeInput.targetUrl);

  const runResult = await runGenericHtmlFormSession({
    bridgeInput,
    page: buildMockBrowserPage(formSnapshot, bridgeInput.targetUrl),
    listingId: bridgeInput.listingId,
    trace: {
      source: "workflow_controller.browser_apply",
      actor: String(payload.actor || "user")
    }
  });

  const bridgeResult = createBrowserExecutionBridgeResult({
    bridgeInput,
    session: runResult.session,
    trace: {
      source: "workflow_controller.browser_apply"
    }
  });
  const bridgeResultValidation = validateBrowserExecutionBridgeResult(bridgeResult);
  if (!bridgeResultValidation.ok) {
    const error = new Error(`Invalid browser bridge result: ${bridgeResultValidation.errors.join("; ")}`);
    error.code = "INVALID_BROWSER_BRIDGE_RESULT";
    error.details = { errors: bridgeResultValidation.errors, bridgeResult };
    throw error;
  }

  const browserApplyViewModel = buildBrowserApplyViewModel({
    session: runResult.session,
    bridgeResult
  });

  const updatedJob = updateJob(jobId, () => ({
    latestBrowserApplySession: runResult.session,
    latestBrowserApplyBridgeResult: bridgeResult,
    latestBrowserApplyViewModel: browserApplyViewModel
  }));

  logActivity({
    type: "browser_apply_session_updated",
    entityType: "browser_apply_session",
    entityId: runResult.session.sessionId,
    action: "browser_apply_session_updated",
    summary: `Browser-assisted session status: ${runResult.session.status}`,
    jobId
  });

  return {
    job: updatedJob,
    browserApplyViewModel,
    nextAction: browserApplyViewModel.nextAction,
    submitEligible: browserApplyViewModel.submitEligible
  };
}

function confirmExecutionRun(jobId, payload = {}) {
  const job = store.getJob(jobId);
  const fitAssessment = store.getFitAssessmentByJobId(jobId);
  const latestExecutionDto = job?.latestExecutionDto || null;
  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }
  if (!latestExecutionDto) {
    const error = new Error("No execution run exists. Please start dry-run first.");
    error.code = "EXECUTION_RUN_REQUIRED";
    throw error;
  }

  const confirmToken = String(payload.confirmToken || "").trim();
  if (latestExecutionDto.confirmState.required && confirmToken !== latestExecutionDto.confirmState.confirmToken) {
    const error = new Error("Invalid confirm token.");
    error.code = "INVALID_CONFIRM_TOKEN";
    throw error;
  }

  const jobDecision = buildJobDecisionSnapshotForJob(job, fitAssessment);
  const controlGateResult = buildControlGateResultForJob({
    job,
    fitAssessment,
    jobDecision,
    traceSource: "execution_confirm"
  });
  const confirmedExecutionDto = createExecutionDto({
    ...latestExecutionDto,
    gateSnapshot: {
      controlId: controlGateResult.controlId || latestExecutionDto.gateSnapshot?.controlId || "",
      status: controlGateResult.status || latestExecutionDto.gateSnapshot?.status || "",
      reasons: controlGateResult.reasons || latestExecutionDto.gateSnapshot?.reasons || [],
      blockingIssues: controlGateResult.blockingIssues || latestExecutionDto.gateSnapshot?.blockingIssues || [],
      requiredActions: controlGateResult.requiredActions || latestExecutionDto.gateSnapshot?.requiredActions || [],
      checkedAt: controlGateResult.checkedAt || nowIso()
    },
    confirmState: {
      ...latestExecutionDto.confirmState,
      state: "confirmed",
      required: Boolean(latestExecutionDto.confirmState?.required),
      confirmToken: latestExecutionDto.confirmState?.confirmToken || "",
      confirmedBy: String(payload.actor || "user"),
      confirmedAt: nowIso()
    },
    executionMode: "live",
    updatedAt: nowIso()
  });
  const executionValidation = validateExecutionDto(confirmedExecutionDto);
  if (!executionValidation.ok) {
    const error = new Error(`Invalid confirmed Execution DTO: ${executionValidation.errors.join("; ")}`);
    error.code = "INVALID_EXECUTION_DTO";
    error.details = { errors: executionValidation.errors, executionDto: confirmedExecutionDto };
    throw error;
  }

  const updatedJob = updateJob(jobId, () => ({
    latestControlGateResult: controlGateResult,
    latestExecutionDto: confirmedExecutionDto
  }));

  recordFeedbackTrace({
    jobId,
    decisionId: jobDecision?.decisionId || "",
    controlId: controlGateResult.controlId || "",
    eventType: "execution_confirmed",
    outcome: "observed",
    actor: String(payload.actor || "user"),
    jobDecision,
    controlGateResult,
    executionSnapshot: {
      stage: "human_confirm",
      status: "completed",
      details: "Human confirmation recorded."
    },
    runId: confirmedExecutionDto.runId || "",
    source: "workflow_controller.execution"
  });

  return { job: updatedJob, executionDto: confirmedExecutionDto, controlGateResult };
}

function submitJobApplication(jobId, payload = {}) {
  const job = store.getJob(jobId);
  const fitAssessment = store.getFitAssessmentByJobId(jobId);
  const latestExecutionDto = job?.latestExecutionDto || null;
  const latestControlGateResult = job?.latestControlGateResult || null;

  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }
  if (!latestExecutionDto) {
    const error = new Error("Submit requires an execution run.");
    error.code = "EXECUTION_RUN_REQUIRED";
    throw error;
  }
  if (job.status !== "ready_to_apply") {
    const error = new Error("Submit requires job status ready_to_apply.");
    error.code = "SUBMIT_PRECONDITION_NOT_READY";
    error.details = {
      jobId,
      currentStatus: job.status,
      requiredStatus: "ready_to_apply"
    };
    throw error;
  }

  const controlGateResult =
    latestControlGateResult || null;
  if (!controlGateResult) {
    const error = new Error("Submit requires an evaluated ControlGateResult.");
    error.code = "CONTROL_GATE_REQUIRED";
    throw error;
  }
  assertSubmitAllowed(controlGateResult, latestExecutionDto);

  const jobDecision = buildJobDecisionSnapshotForJob(job, fitAssessment);
  const submitContract = createSubmitContract({
    submitId: createId("submit"),
    runId: latestExecutionDto.runId,
    jobId: job.id,
    tailoredResumeId: latestExecutionDto.tailoredResumeId,
    prepVersion: latestExecutionDto.prepVersion || 1,
    gateSnapshot: {
      controlId: controlGateResult.controlId || "",
      status: controlGateResult.status || "",
      blockingIssues: controlGateResult.blockingIssues || [],
      requiredActions: controlGateResult.requiredActions || [],
      checkedAt: controlGateResult.checkedAt || nowIso()
    },
    confirmToken: latestExecutionDto.confirmState?.confirmToken || "",
    confirmState: latestExecutionDto.confirmState?.state || "pending",
    submitMode: latestExecutionDto.executionMode === "live" ? "live_submit" : "manual_confirmed",
    outcome: "submitted",
    submittedAt: nowIso(),
    trace: {
      runId: latestExecutionDto.runId,
      source: "workflow_controller.submit"
    }
  });
  const submitValidation = validateSubmitContract(submitContract);
  if (!submitValidation.ok) {
    const error = new Error(`Invalid Submit contract: ${submitValidation.errors.join("; ")}`);
    error.code = "INVALID_SUBMIT_CONTRACT";
    error.details = { errors: submitValidation.errors, submitContract };
    throw error;
  }

  updateJob(jobId, () => ({
    latestSubmitContract: submitContract
  }));

  const transitioned = transitionJobStatus(jobId, "applied", {
    actor: String(payload.actor || "user"),
    source: "submit_contract",
    submitContract,
    executionDto: latestExecutionDto,
    controlGateResult
  });

  recordFeedbackTrace({
    jobId,
    decisionId: jobDecision?.decisionId || "",
    controlId: controlGateResult.controlId || "",
    eventType: "execution_submitted",
    outcome: "succeeded",
    actor: String(payload.actor || "user"),
    jobDecision,
    controlGateResult,
    executionSnapshot: {
      stage: "submit",
      status: "completed",
      details: "Submit contract completed and status transitioned to applied."
    },
    runId: latestExecutionDto.runId || "",
    source: "workflow_controller.submit"
  });

  return {
    job: transitioned.job,
    controlGateResult,
    executionDto: latestExecutionDto,
    submitContract,
    nextTask: transitioned.nextTask || null
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
  const fitAssessment = store.getFitAssessmentByJobId(jobId);
  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }

  if (nextStatus === "applied" && options.source !== "submit_contract") {
    const error = new Error("Transition to applied must be driven by Submit Contract.");
    error.code = "SUBMIT_CONTRACT_REQUIRED";
    throw error;
  }
  if (nextStatus === "applied" && options.source === "submit_contract" && !options.submitContract) {
    const error = new Error("Submit contract payload is required for transition to applied.");
    error.code = "SUBMIT_CONTRACT_MISSING";
    throw error;
  }

  assertJobStatusTransition(job.status, nextStatus);

  if (nextStatus === "ready_to_apply") {
    const prep = store.getApplicationPrepByJobId(jobId);
    if (!prep || !isPrepReady(prep)) {
      const jobDecision = buildJobDecisionSnapshotForJob(job, fitAssessment);
      recordFeedbackTrace({
        jobId,
        decisionId: jobDecision?.decisionId || "",
        eventType: "execution_failed",
        outcome: "failed",
        actor: options.actor || "user",
        jobDecision,
        executionSnapshot: {
          stage: "status_transition",
          status: "failed",
          details: "Transition to ready_to_apply failed because prep checklist is incomplete."
        },
        failureReason: "Preparation checklist not ready.",
        source: "workflow_controller.transition"
      });
      const error = new Error("在核心申请准备清单完成之前，不能推进到可投递状态。");
      error.code = "PREP_NOT_READY";
      error.details = { jobId, requiredChecklist: ["resume_reviewed", "intro_ready", "qa_ready"] };
      throw error;
    }
  }

  if (["ready_to_apply", "applied"].includes(nextStatus)) {
    const jobDecision = buildJobDecisionSnapshotForJob(job, fitAssessment);
    const controlGateResult =
      options.controlGateResult ||
      buildControlGateResultForJob({
        job,
        fitAssessment,
        jobDecision,
        traceSource: "transition_job_status"
      });
    recordFeedbackTrace({
      jobId,
      decisionId: jobDecision?.decisionId || "",
      controlId: controlGateResult.controlId || "",
      eventType: "control_evaluated",
      outcome:
        controlGateResult.status === "allowed"
          ? "succeeded"
          : controlGateResult.status === "blocked"
            ? "blocked"
            : "observed",
      actor: options.actor || "user",
      jobDecision,
      controlGateResult,
      executionSnapshot: {
        stage: "status_transition",
        status: "gate_checked",
        details: `Transition gate checked before moving to ${nextStatus}.`
      },
      runId: controlGateResult.trace?.runId || "",
      source: "workflow_controller.transition"
    });
    updateJob(jobId, () => ({
      latestControlGateResult: controlGateResult
    }));
    if (nextStatus === "applied" && options.source === "submit_contract") {
      assertSubmitAllowed(controlGateResult, options.executionDto || job.latestExecutionDto || null);
    } else {
      assertExecutionAllowed(controlGateResult, `transition_to_${nextStatus}`, {
        jobId,
        jobDecision,
        stage: "status_transition",
        actor: options.actor || "user"
      });
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
    fitAssessment,
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

  const latestControlGateResult = updatedJob.latestControlGateResult || null;
  return { job: updatedJob, controlGateResult: latestControlGateResult, nextTask };
}

function updateJobTrackerState(jobId, nextState) {
  const currentJob = store.getJob(jobId);
  if (!currentJob) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }
  const rawNextState = String(nextState || "").trim().toLowerCase();
  if (!TRACKER_STATES.has(rawNextState)) {
    const error = new Error(`Invalid tracker state: ${String(nextState || "")}.`);
    error.code = "VALIDATION_ERROR";
    error.details = {
      field: "nextState",
      allowedValues: [...TRACKER_STATES]
    };
    throw error;
  }
  const normalizedNextState = rawNextState;
  const updatedJob = updateJob(jobId, (job) => {
    const previousState = normalizeTrackerState(job?.trackerState || "");
    const timeline = normalizeTrackerTimeline(job?.trackerTimeline || []);
    if (normalizedNextState !== "none" && normalizedNextState !== previousState) {
      timeline.unshift({
        state: normalizedNextState,
        timestamp: nowIso()
      });
    }
    return {
      trackerState: normalizedNextState,
      trackerTimeline: timeline.slice(0, 20)
    };
  });

  logActivity({
    type: "job_tracker_state_changed",
    entityType: "job",
    entityId: jobId,
    action: "job_tracker_state_changed",
    actor: "user",
    jobId,
    summary: `已更新跟进状态为 ${normalizedNextState}。`
  });

  return {
    jobId,
    trackerView: buildJobTrackerView(updatedJob)
  };
}

function updateJobFeedbackState(jobId, nextState) {
  const currentJob = store.getJob(jobId);
  if (!currentJob) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }
  const rawNextState = String(nextState || "").trim().toLowerCase();
  if (!FEEDBACK_STATES.has(rawNextState)) {
    const error = new Error(`Invalid feedback state: ${String(nextState || "")}.`);
    error.code = "VALIDATION_ERROR";
    error.details = {
      field: "nextState",
      allowedValues: [...FEEDBACK_STATES]
    };
    throw error;
  }

  const normalizedNextState = rawNextState;
  const updatedJob = updateJob(jobId, (job) => {
    const previousState = normalizeFeedbackState(job?.feedbackState || "");
    const timeline = normalizeFeedbackTimeline(job?.feedbackTimeline || []);
    if (normalizedNextState !== "none" && normalizedNextState !== previousState) {
      timeline.unshift({
        state: normalizedNextState,
        timestamp: nowIso()
      });
    }
    return {
      feedbackState: normalizedNextState,
      feedbackTimeline: timeline.slice(0, 20)
    };
  });

  logActivity({
    type: "job_feedback_state_changed",
    entityType: "job",
    entityId: jobId,
    action: "job_feedback_state_changed",
    actor: "user",
    jobId,
    summary: `已更新反馈状态为 ${normalizedNextState}。`
  });

  return {
    jobId,
    feedbackView: buildJobFeedbackView(updatedJob)
  };
}

function updateJobShortlistState(jobId, nextState) {
  const currentJob = store.getJob(jobId);
  if (!currentJob) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }
  const rawNextState = String(nextState || "").trim().toLowerCase();
  if (!SHORTLIST_STATES.has(rawNextState)) {
    const error = new Error(`Invalid shortlist state: ${String(nextState || "")}.`);
    error.code = "VALIDATION_ERROR";
    error.details = {
      field: "nextState",
      allowedValues: [...SHORTLIST_STATES]
    };
    throw error;
  }

  const normalizedNextState = rawNextState;
  const updatedJob = updateJob(jobId, (job) => {
    const previousState = normalizeShortlistState(job?.shortlistState || "");
    const timeline = normalizeShortlistTimeline(job?.shortlistTimeline || []);
    if (normalizedNextState !== "none" && normalizedNextState !== previousState) {
      timeline.unshift({
        state: normalizedNextState,
        timestamp: nowIso()
      });
    }
    return {
      shortlistState: normalizedNextState,
      shortlistTimeline: timeline.slice(0, 20)
    };
  });

  logActivity({
    type: "job_shortlist_state_changed",
    entityType: "job",
    entityId: jobId,
    action: "job_shortlist_state_changed",
    actor: "user",
    jobId,
    details: {
      fromState: normalizeShortlistState(currentJob?.shortlistState || ""),
      toState: normalizedNextState
    }
  });

  return {
    jobId,
    shortlistView: buildJobShortlistView(updatedJob)
  };
}

function updateJobMaterialsPrep(jobId, payload = {}) {
  const currentJob = store.getJob(jobId);
  if (!currentJob) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }

  const normalizeEnum = (value, allowedStates, field) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (!allowedStates.has(normalized)) {
      const error = new Error(`Invalid ${field}: ${String(value || "")}.`);
      error.code = "VALIDATION_ERROR";
      error.details = {
        field,
        allowedValues: [...allowedStates]
      };
      throw error;
    }
    return normalized;
  };

  const nextResumeStatus = normalizeEnum(
    payload.resumeStatus ?? currentJob?.materialsPrep?.resumeStatus ?? "none",
    MATERIAL_RESUME_STATES,
    "resumeStatus"
  );
  const nextCoverLetterStatus = normalizeEnum(
    payload.coverLetterStatus ?? currentJob?.materialsPrep?.coverLetterStatus ?? "none",
    MATERIAL_COVER_LETTER_STATES,
    "coverLetterStatus"
  );
  const nextInterviewPrepStatus = normalizeEnum(
    payload.interviewPrepStatus ?? currentJob?.materialsPrep?.interviewPrepStatus ?? "none",
    MATERIAL_INTERVIEW_PREP_STATES,
    "interviewPrepStatus"
  );
  const nextNotes = String(payload.notes ?? currentJob?.materialsPrep?.notes ?? "").trim().slice(0, 2000);
  const currentMaterialsPrep = normalizeMaterialsPrepView(currentJob?.materialsPrep || {});
  const hasChanged =
    currentMaterialsPrep.resumeStatus !== nextResumeStatus ||
    currentMaterialsPrep.coverLetterStatus !== nextCoverLetterStatus ||
    currentMaterialsPrep.interviewPrepStatus !== nextInterviewPrepStatus ||
    currentMaterialsPrep.notes !== nextNotes;

  const updatedJob = updateJob(jobId, (job) => {
    const existing = normalizeMaterialsPrepView(job?.materialsPrep || {});
    if (!hasChanged) {
      return {
        materialsPrep: {
          ...existing
        }
      };
    }
    return {
      materialsPrep: {
        resumeStatus: nextResumeStatus,
        coverLetterStatus: nextCoverLetterStatus,
        interviewPrepStatus: nextInterviewPrepStatus,
        notes: nextNotes,
        lastUpdatedAt: nowIso()
      }
    };
  });

  logActivity({
    type: "job_materials_prep_updated",
    entityType: "job",
    entityId: jobId,
    action: "job_materials_prep_updated",
    actor: "user",
    jobId,
    summary: "已更新材料准备记录。"
  });

  return {
    jobId,
    materialsPrepView: buildJobMaterialsPrepView(updatedJob)
  };
}

function updateJobSubmissionAudit(jobId, payload = {}) {
  const currentJob = store.getJob(jobId);
  if (!currentJob) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }

  const normalizeEnum = (value, allowedStates, field) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (!allowedStates.has(normalized)) {
      const error = new Error(`Invalid ${field}: ${String(value || "")}.`);
      error.code = "VALIDATION_ERROR";
      error.details = {
        field,
        allowedValues: [...allowedStates]
      };
      throw error;
    }
    return normalized;
  };

  const currentAudit = normalizeSubmissionAuditView(currentJob?.submissionAudit || {});
  const nextStatus = normalizeEnum(
    payload.status ?? currentAudit.status ?? "none",
    SUBMISSION_AUDIT_STATUS_STATES,
    "status"
  );
  const nextSource = normalizeEnum(
    payload.source ?? currentAudit.source ?? "manual",
    SUBMISSION_AUDIT_SOURCE_STATES,
    "source"
  );
  const nextLastError = String(payload.lastError ?? currentAudit.lastError ?? "").trim().slice(0, 2000);
  const nextNotes = String(payload.notes ?? currentAudit.notes ?? "").trim().slice(0, 2000);
  const hasContentChanged =
    currentAudit.status !== nextStatus ||
    currentAudit.source !== nextSource ||
    currentAudit.lastError !== nextLastError ||
    currentAudit.notes !== nextNotes;
  const shouldRecordAttempt = hasContentChanged && nextStatus !== "none";

  const updatedJob = updateJob(jobId, (job) => {
    const existing = normalizeSubmissionAuditView(job?.submissionAudit || {});
    if (!hasContentChanged) {
      return {
        submissionAudit: {
          ...existing
        }
      };
    }

    const now = nowIso();
    const isSubmittedNow = nextStatus === "submitted";
    const submittedAt = isSubmittedNow ? existing.submittedAt || now : existing.submittedAt;
    const attemptCount = shouldRecordAttempt ? Number(existing.attemptCount || 0) + 1 : Number(existing.attemptCount || 0);
    const lastAttemptAt = shouldRecordAttempt ? now : existing.lastAttemptAt;

    return {
      submissionAudit: {
        status: nextStatus,
        source: nextSource,
        submittedAt,
        lastAttemptAt,
        attemptCount,
        lastError: nextLastError,
        notes: nextNotes
      }
    };
  });

  logActivity({
    type: "job_submission_audit_updated",
    entityType: "job",
    entityId: jobId,
    action: "job_submission_audit_updated",
    actor: "user",
    jobId,
    summary: "已更新投递提交审计记录。"
  });

  return {
    jobId,
    submissionAuditView: buildJobSubmissionAuditView(updatedJob)
  };
}

function updateJobFollowUp(jobId, payload = {}) {
  const currentJob = store.getJob(jobId);
  if (!currentJob) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }

  const normalizeEnum = (value, allowedStates, field) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (!allowedStates.has(normalized)) {
      const error = new Error(`Invalid ${field}: ${String(value || "")}.`);
      error.code = "VALIDATION_ERROR";
      error.details = {
        field,
        allowedValues: [...allowedStates]
      };
      throw error;
    }
    return normalized;
  };
  const normalizeDueAt = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      const error = new Error(`Invalid dueAt: ${raw}.`);
      error.code = "VALIDATION_ERROR";
      error.details = { field: "dueAt", message: "dueAt must be a valid ISO datetime or empty." };
      throw error;
    }
    return parsed.toISOString();
  };

  const currentFollowUp = normalizeFollowUpView(currentJob?.followUp || {});
  const nextStatus = normalizeEnum(
    payload.status ?? currentFollowUp.status ?? "none",
    FOLLOW_UP_STATUS_STATES,
    "status"
  );
  const nextChannel = normalizeEnum(
    payload.channel ?? currentFollowUp.channel ?? "other",
    FOLLOW_UP_CHANNEL_STATES,
    "channel"
  );
  const nextDueAt = normalizeDueAt(payload.dueAt ?? currentFollowUp.dueAt ?? null);
  const nextNotes = String(payload.notes ?? currentFollowUp.notes ?? "").trim().slice(0, 2000);
  const hasChanged =
    currentFollowUp.status !== nextStatus ||
    currentFollowUp.channel !== nextChannel ||
    currentFollowUp.dueAt !== nextDueAt ||
    currentFollowUp.notes !== nextNotes;

  const updatedJob = updateJob(jobId, (job) => {
    const existing = normalizeFollowUpView(job?.followUp || {});
    if (!hasChanged) {
      return {
        followUp: {
          ...existing
        }
      };
    }
    return {
      followUp: {
        status: nextStatus,
        dueAt: nextDueAt,
        channel: nextChannel,
        notes: nextNotes,
        lastUpdatedAt: nowIso()
      }
    };
  });

  logActivity({
    type: "job_follow_up_updated",
    entityType: "job",
    entityId: jobId,
    action: "job_follow_up_updated",
    actor: "user",
    jobId,
    summary: "已更新跟进提醒记录。"
  });

  return {
    jobId,
    followUpView: buildJobFollowUpView(updatedJob)
  };
}

function saveProfile(payload) {
  const current = store.getProfile();
  const cleanText = (value, max = 500) => String(value || "").trim().slice(0, max);
  const cleanEnumText = (value, allowed = []) => {
    const normalized = cleanText(value, 40).toLowerCase();
    if (!normalized) return "";
    return allowed.includes(normalized) ? normalized : "";
  };
  const toObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
  const toArray = (value) => (Array.isArray(value) ? value : []);
  const normalizeDateInput = (value, fallback = "") => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const digits = raw.replace(/[./年月]/g, "-").replace(/日/g, "").replace(/\s+/g, "");
    if (/^\d{8}$/.test(digits)) {
      return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    }
    const match = digits.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
      const year = match[1];
      const month = String(Number(match[2])).padStart(2, "0");
      const day = String(Number(match[3])).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    const fallbackText = cleanText(raw || fallback || "", 40);
    return fallbackText;
  };
  const normalizeMonthInput = (value, fallback = "") => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^\d{4}-\d{2}$/.test(raw)) return raw;
    const compact = raw.replace(/[./年月]/g, "-").replace(/日/g, "").replace(/\s+/g, "");
    const monthMatch = compact.match(/^(\d{4})-(\d{1,2})$/);
    if (monthMatch) {
      const year = monthMatch[1];
      const month = String(Number(monthMatch[2])).padStart(2, "0");
      return `${year}-${month}`;
    }
    const dayMatch = compact.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (dayMatch) {
      const year = dayMatch[1];
      const month = String(Number(dayMatch[2])).padStart(2, "0");
      return `${year}-${month}`;
    }
    if (/^\d{6}$/.test(compact)) {
      return `${compact.slice(0, 4)}-${compact.slice(4, 6)}`;
    }
    const fallbackText = cleanText(raw || fallback || "", 20);
    return fallbackText;
  };
  const csvToArray = (value) =>
    Array.isArray(value)
      ? value
      : String(value || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

  const nextName = payload.name || payload.fullName || current?.fullName || current?.name || "";
  const currentAutofillProfile = toObject(current?.autofillProfile);
  const currentAutofillBasic = toObject(currentAutofillProfile.basic);
  const incomingAutofillProfile = toObject(payload.autofillProfile);
  const incomingAutofillBasic = toObject(incomingAutofillProfile.basic);

  const pickFirstNonEmpty = (...values) => {
    for (const value of values) {
      const normalized = cleanText(value, 500);
      if (normalized) return normalized;
    }
    return "";
  };
  const hasAnyText = (obj = {}, keys = []) =>
    keys.some((key) => Boolean(cleanText(obj?.[key] || "", 500)));
  const normalizeEducationLevel = (value = "") => {
    const raw = cleanText(value, 40).toLowerCase();
    if (!raw) return "";
    if (/^(bachelor|undergraduate|\u672c\u79d1|\u5b66\u58eb)/i.test(raw)) return "bachelor";
    if (/^(master|graduate|\u7855\u58eb|\u7814\u7a76\u751f)/i.test(raw)) return "master";
    return "";
  };
  const sanitizeEducationItem = (item = {}, fallbackLevel = "") => {
    const normalized = toObject(item);
    return {
      level: normalizeEducationLevel(normalized.level || fallbackLevel),
      school_name: cleanText(normalized.school_name || normalized.schoolName || "", 200),
      major: cleanText(normalized.major || "", 160),
      degree: cleanText(normalized.degree || "", 120),
      start_date: normalizeMonthInput(normalized.start_date || normalized.startDate || ""),
      end_date: normalizeMonthInput(normalized.end_date || normalized.endDate || "")
    };
  };
  const sanitizeWorkItem = (item = {}) => {
    const normalized = toObject(item);
    return {
      company_name: cleanText(normalized.company_name || normalized.companyName || "", 200),
      department: cleanText(normalized.department || "", 160),
      job_title: cleanText(normalized.job_title || normalized.jobTitle || "", 160),
      start_date: normalizeMonthInput(normalized.start_date || normalized.startDate || ""),
      end_date: normalizeMonthInput(normalized.end_date || normalized.endDate || ""),
      description: cleanText(normalized.description || "", 2000)
    };
  };
  const sanitizeProjectItem = (item = {}) => {
    const normalized = toObject(item);
    return {
      project_name: cleanText(normalized.project_name || normalized.projectName || "", 200),
      role: cleanText(normalized.role || "", 160),
      description: cleanText(normalized.description || "", 2000),
      start_date: normalizeMonthInput(normalized.start_date || normalized.startDate || ""),
      end_date: normalizeMonthInput(normalized.end_date || normalized.endDate || "")
    };
  };
  const sanitizeFamilyItem = (item = {}) => {
    const normalized = toObject(item);
    return {
      name: cleanText(normalized.name || "", 120),
      relation: cleanText(normalized.relation || "", 80),
      employer: cleanText(normalized.employer || "", 200),
      position: cleanText(normalized.position || "", 160)
    };
  };

  const nextBasic = {
    full_name: pickFirstNonEmpty(
      incomingAutofillBasic.full_name,
      payload.full_name,
      incomingAutofillProfile.full_name,
      nextName,
      currentAutofillBasic.full_name,
      currentAutofillProfile.full_name
    ).slice(0, 120),
    gender: cleanEnumText(
      pickFirstNonEmpty(
        incomingAutofillBasic.gender,
        payload.gender,
        incomingAutofillProfile.gender,
        currentAutofillBasic.gender,
        currentAutofillProfile.gender
      ),
      ["male", "female", "\u7537", "\u5973"]
    ),
    birth_date: normalizeDateInput(
      pickFirstNonEmpty(
        incomingAutofillBasic.birth_date,
        payload.birth_date,
        incomingAutofillProfile.birth_date,
        currentAutofillBasic.birth_date,
        currentAutofillProfile.birth_date
      )
    ),
    email: pickFirstNonEmpty(
      incomingAutofillBasic.email,
      payload.email,
      incomingAutofillProfile.email,
      currentAutofillBasic.email,
      currentAutofillProfile.email
    ).slice(0, 160),
    phone: pickFirstNonEmpty(
      incomingAutofillBasic.phone,
      payload.phone,
      incomingAutofillProfile.phone,
      currentAutofillBasic.phone,
      currentAutofillProfile.phone
    ).slice(0, 80)
  };

  const incomingEducation = toArray(incomingAutofillProfile.education).map((item) => sanitizeEducationItem(item));
  const currentEducation = toArray(currentAutofillProfile.education).map((item) => sanitizeEducationItem(item));

  const legacyHighest = sanitizeEducationItem(
    {
      school_name: pickFirstNonEmpty(
        incomingAutofillProfile.school_name,
        payload.school_name,
        currentAutofillProfile.school_name
      ),
      major: pickFirstNonEmpty(incomingAutofillProfile.major, payload.major, currentAutofillProfile.major),
      degree: pickFirstNonEmpty(incomingAutofillProfile.degree, payload.degree, currentAutofillProfile.degree),
      start_date: pickFirstNonEmpty(
        incomingAutofillProfile.master_start_date,
        payload.master_start_date,
        currentAutofillProfile.master_start_date,
        incomingAutofillProfile.bachelor_start_date,
        payload.bachelor_start_date,
        currentAutofillProfile.bachelor_start_date
      ),
      end_date: pickFirstNonEmpty(
        incomingAutofillProfile.master_end_date,
        payload.master_end_date,
        currentAutofillProfile.master_end_date,
        incomingAutofillProfile.bachelor_end_date,
        payload.bachelor_end_date,
        currentAutofillProfile.bachelor_end_date
      )
    },
    "master"
  );
  const legacyFirst = sanitizeEducationItem(
    {
      school_name: pickFirstNonEmpty(
        incomingAutofillProfile.first_school_name,
        payload.first_school_name,
        currentAutofillProfile.first_school_name
      ),
      major: pickFirstNonEmpty(
        incomingAutofillProfile.first_major,
        payload.first_major,
        currentAutofillProfile.first_major
      ),
      degree: pickFirstNonEmpty(
        incomingAutofillProfile.degree,
        payload.degree,
        currentAutofillProfile.degree
      ),
      start_date: pickFirstNonEmpty(
        incomingAutofillProfile.bachelor_start_date,
        payload.bachelor_start_date,
        currentAutofillProfile.bachelor_start_date
      ),
      end_date: pickFirstNonEmpty(
        incomingAutofillProfile.bachelor_end_date,
        payload.bachelor_end_date,
        currentAutofillProfile.bachelor_end_date
      )
    },
    "bachelor"
  );

  const seededEducation = incomingEducation.length ? incomingEducation : currentEducation;
  let nextEducation = seededEducation.filter((item) =>
    hasAnyText(item, ["school_name", "major", "degree", "start_date", "end_date"])
  );
  if (!nextEducation.length) {
    nextEducation = [legacyFirst, legacyHighest].filter((item) =>
      hasAnyText(item, ["school_name", "major", "degree", "start_date", "end_date"])
    );
  }

  const findEducationByLevel = (level) =>
    nextEducation.find((item) => item.level === level && hasAnyText(item, ["school_name", "major", "degree"]));
  const highestEducationCandidate =
    findEducationByLevel("master") ||
    findEducationByLevel("bachelor") ||
    nextEducation.find((item) => hasAnyText(item, ["school_name", "major", "degree"])) ||
    legacyHighest;
  const firstEducationCandidate =
    findEducationByLevel("bachelor") ||
    nextEducation.find((item) => item.level && item.level !== "master" && hasAnyText(item, ["school_name", "major"])) ||
    nextEducation.find((item) => hasAnyText(item, ["school_name", "major"])) ||
    legacyFirst;

  const nextWorkExperience = (
    toArray(incomingAutofillProfile.work_experience).length
      ? toArray(incomingAutofillProfile.work_experience)
      : toArray(currentAutofillProfile.work_experience)
  )
    .map((item) => sanitizeWorkItem(item))
    .filter((item) => hasAnyText(item, ["company_name", "department", "job_title", "description", "start_date", "end_date"]));
  const nextProjectExperience = (
    toArray(incomingAutofillProfile.project_experience).length
      ? toArray(incomingAutofillProfile.project_experience)
      : toArray(currentAutofillProfile.project_experience)
  )
    .map((item) => sanitizeProjectItem(item))
    .filter((item) => hasAnyText(item, ["project_name", "role", "description", "start_date", "end_date"]));
  const nextFamily = (
    toArray(incomingAutofillProfile.family).length
      ? toArray(incomingAutofillProfile.family)
      : toArray(currentAutofillProfile.family)
  )
    .map((item) => sanitizeFamilyItem(item))
    .filter((item) => hasAnyText(item, ["name", "relation", "employer", "position"]));

  const nextAutofillProfile = {
    ...currentAutofillProfile,
    basic: {
      ...currentAutofillBasic,
      ...nextBasic
    },
    education: nextEducation,
    work_experience: nextWorkExperience,
    project_experience: nextProjectExperience,
    family: nextFamily,
    full_name: nextBasic.full_name,
    email: nextBasic.email,
    phone: nextBasic.phone,
    gender: nextBasic.gender,
    birth_date: nextBasic.birth_date,
    school_name: cleanText(
      pickFirstNonEmpty(
        payload.school_name,
        incomingAutofillProfile.school_name,
        highestEducationCandidate?.school_name,
        currentAutofillProfile.school_name
      ),
      200
    ),
    first_school_name: cleanText(
      pickFirstNonEmpty(
        payload.first_school_name,
        incomingAutofillProfile.first_school_name,
        firstEducationCandidate?.school_name,
        currentAutofillProfile.first_school_name
      ),
      200
    ),
    degree: cleanText(
      pickFirstNonEmpty(
        payload.degree,
        incomingAutofillProfile.degree,
        highestEducationCandidate?.degree,
        currentAutofillProfile.degree
      ),
      120
    ),
    major: cleanText(
      pickFirstNonEmpty(
        payload.major,
        incomingAutofillProfile.major,
        highestEducationCandidate?.major,
        currentAutofillProfile.major
      ),
      160
    ),
    first_major: cleanText(
      pickFirstNonEmpty(
        payload.first_major,
        incomingAutofillProfile.first_major,
        firstEducationCandidate?.major,
        currentAutofillProfile.first_major
      ),
      160
    ),
    bachelor_start_date: normalizeMonthInput(
      pickFirstNonEmpty(
        findEducationByLevel("bachelor")?.start_date,
        firstEducationCandidate?.start_date,
        payload.bachelor_start_date,
        currentAutofillProfile.bachelor_start_date
      )
    ),
    bachelor_end_date: normalizeMonthInput(
      pickFirstNonEmpty(
        findEducationByLevel("bachelor")?.end_date,
        firstEducationCandidate?.end_date,
        payload.bachelor_end_date,
        currentAutofillProfile.bachelor_end_date
      )
    ),
    master_start_date: normalizeMonthInput(
      pickFirstNonEmpty(
        findEducationByLevel("master")?.start_date,
        payload.master_start_date,
        currentAutofillProfile.master_start_date
      )
    ),
    master_end_date: normalizeMonthInput(
      pickFirstNonEmpty(
        findEducationByLevel("master")?.end_date,
        payload.master_end_date,
        currentAutofillProfile.master_end_date
      )
    ),
    language_exam_language: cleanText(
      payload.language_exam_language || currentAutofillProfile.language_exam_language || "",
      80
    ),
    language_exam_level: cleanText(payload.language_exam_level || currentAutofillProfile.language_exam_level || "", 120),
    language_name: cleanText(payload.language_name || currentAutofillProfile.language_name || "", 80),
    english_proficiency: cleanText(payload.english_proficiency || currentAutofillProfile.english_proficiency || "", 120),
    english_score: cleanText(payload.english_score || currentAutofillProfile.english_score || "", 120),
    certificate_name: cleanText(payload.certificate_name || currentAutofillProfile.certificate_name || "", 120),
    achievement_score: cleanText(payload.achievement_score || currentAutofillProfile.achievement_score || "", 120),
    summary: cleanText(
      payload.autofill_summary ||
        incomingAutofillProfile.summary ||
        currentAutofillProfile.summary ||
        current?.summary ||
        "",
      2000
    ),
    updatedAt: nowIso()
  };

  const mergedLightweightProfile = normalizeLightweightProfile({
    ...current,
    ...payload,
    lightweightProfile:
      payload?.lightweightProfile && typeof payload.lightweightProfile === "object"
        ? payload.lightweightProfile
        : current?.lightweightProfile || {}
  });
  const normalizedJobPreferenceProfile = normalizeJobPreferenceProfile({
    ...current,
    ...payload,
    lightweightProfile: mergedLightweightProfile,
    jobPreferenceProfile:
      payload?.jobPreferenceProfile && typeof payload.jobPreferenceProfile === "object"
        ? payload.jobPreferenceProfile
        : current?.jobPreferenceProfile || {}
  });

  const profile = {
    ...(current || {}),
    ...payload,
    id: current?.id || createId("profile"),
    fullName: payload.name || payload.fullName || current?.fullName || "",
    name: payload.name || payload.fullName || current?.name || "",
    headline: payload.background || payload.headline || current?.headline || "",
    background: payload.background || payload.headline || current?.background || "",
    yearsOfExperience: Number(payload.yearsOfExperience ?? current?.yearsOfExperience ?? 0),
    targetRoles: csvToArray(payload.targetRoles ?? normalizedJobPreferenceProfile.targetRoles ?? current?.targetRoles ?? []),
    targetIndustries: csvToArray(
      payload.targetIndustries ?? normalizedJobPreferenceProfile.preferredIndustries ?? current?.targetIndustries ?? []
    ),
    preferredLocations: csvToArray(
      payload.targetLocations ??
        payload.preferredLocations ??
        normalizedJobPreferenceProfile.preferredLocations ??
        current?.preferredLocations ??
        []
    ),
    targetLocations: csvToArray(
      payload.targetLocations ??
        payload.preferredLocations ??
        normalizedJobPreferenceProfile.preferredLocations ??
        current?.targetLocations ??
        []
    ),
    strengths: csvToArray(payload.strengths ?? normalizedJobPreferenceProfile.skills ?? current?.strengths ?? []),
    constraints: csvToArray(payload.constraints ?? current?.constraints ?? []),
    baseResume: payload.baseResume ?? payload.masterResume ?? current?.baseResume ?? "",
    masterResume: payload.masterResume ?? payload.baseResume ?? current?.masterResume ?? "",
    policyPreferences: {
      manualPreferredRoles: csvToArray(payload.manualPreferredRoles ?? current?.policyPreferences?.manualPreferredRoles ?? []),
      ignoredRiskyRoles: csvToArray(payload.ignoredRiskyRoles ?? current?.policyPreferences?.ignoredRiskyRoles ?? []),
      riskToleranceOverride: payload.riskToleranceOverride || current?.policyPreferences?.riskToleranceOverride || ""
    },
    autofillProfile: nextAutofillProfile,
    lightweightProfile: mergedLightweightProfile,
    jobPreferenceProfile: normalizedJobPreferenceProfile,
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

function saveOnboardingProfile(payload = {}) {
  const current = store.getProfile() || {};
  const toArray = (value) =>
    Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean)
      : String(value || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

  const lightweightProfile = {
    targetRoles: toArray(payload.targetRoles),
    skills: toArray(payload.skills),
    preferredLocations: toArray(payload.preferredLocations),
    degree: payload.degree ? String(payload.degree).trim() : "",
    acceptsNonTech: Boolean(payload.acceptsNonTech)
  };
  const jobPreferenceProfile = normalizeJobPreferenceProfile({
    lightweightProfile,
    jobPreferenceProfile: {
      preferredIndustries: toArray(payload.preferredIndustries),
      excludedIndustries: toArray(payload.excludedIndustries),
      targetRoles: lightweightProfile.targetRoles,
      excludedRoles: toArray(payload.excludedRoles),
      skills: lightweightProfile.skills,
      preferredLocations: lightweightProfile.preferredLocations,
      companyTypes: toArray(payload.companyTypes),
      avoidCompanyTypes: toArray(payload.avoidCompanyTypes),
      jobType: payload.jobType || "不限",
      priorityWeights:
        payload.priorityWeights && typeof payload.priorityWeights === "object"
          ? payload.priorityWeights
          : undefined
    }
  });

  const profile = {
    ...current,
    id: current?.id || createId("profile"),
    name: current?.name || current?.fullName || "候选人",
    fullName: current?.fullName || current?.name || "候选人",
    background: current?.background || current?.headline || "正在完善求职偏好",
    headline: current?.headline || current?.background || "正在完善求职偏好",
    targetRoles: lightweightProfile.targetRoles,
    targetIndustries: jobPreferenceProfile.preferredIndustries,
    strengths: lightweightProfile.skills,
    preferredLocations: lightweightProfile.preferredLocations,
    targetLocations: lightweightProfile.preferredLocations,
    lightweightProfile,
    jobPreferenceProfile,
    createdAt: current?.createdAt || nowIso(),
    updatedAt: nowIso()
  };

  store.saveProfile(profile);
  refreshGlobalStrategyPolicy(refreshStrategyProfile(), {
    reason: "profile_updated",
    triggerType: "profile_update",
    triggerSource: "user_onboarding",
    autoApprove: true
  });
  logActivity({
    type: "onboarding_profile_saved",
    entityType: "profile",
    entityId: profile.id,
    action: "onboarding_profile_saved",
    actor: "user",
    summary: "已保存轻量用户画像（onboarding）。"
  });

  return profile;
}

function saveMasterResume(payload = {}) {
  const currentProfile = store.getProfile() || {};
  const existingCanonical = store.getMasterResume();
  const latestResumeDocument = store.getLatestResumeDocument() || null;
  const arrayFields = ["workExperience", "projectExperience", "education", "skills"];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const error = new Error("MasterResumeEditDto must be an object.");
    error.code = "INVALID_MASTER_RESUME_DTO";
    throw error;
  }
  if (!payload.basicInfo || typeof payload.basicInfo !== "object" || Array.isArray(payload.basicInfo)) {
    const error = new Error("basicInfo must be an object.");
    error.code = "INVALID_MASTER_RESUME_DTO";
    throw error;
  }
  const invalidArrayField = arrayFields.find((field) => payload[field] !== undefined && !Array.isArray(payload[field]));
  if (invalidArrayField) {
    const error = new Error(`${invalidArrayField} must be an array.`);
    error.code = "INVALID_MASTER_RESUME_DTO";
    throw error;
  }
  const seed =
    existingCanonical ||
    (latestResumeDocument ? buildMasterResumeSeedFromResumeDocument(latestResumeDocument, currentProfile) : buildEmptyMasterResume(currentProfile));

  const nextMasterResume = createMasterResumeContract({
    ...seed,
    ...payload,
    masterResumeId: payload.masterResumeId || seed.masterResumeId,
    createdAt: seed.createdAt,
    updatedAt: nowIso(),
    trace: {
      ...(seed.trace || {}),
      source: "canonical_saved",
      sourceResumeId: seed.trace?.sourceResumeId || latestResumeDocument?.id || "",
      sourceProfileId: currentProfile.id || "",
      note: "Saved from MasterResume editor."
    }
  });
  const validation = validateMasterResumeContract(nextMasterResume);
  if (!validation.valid) {
    const error = new Error(`Invalid MasterResume payload: ${validation.errors.join("; ")}`);
    error.code = "INVALID_MASTER_RESUME_CONTRACT";
    error.details = { errors: validation.errors };
    throw error;
  }

  store.saveMasterResume(nextMasterResume);
  logActivity({
    type: "master_resume_saved",
    entityType: "master_resume",
    entityId: nextMasterResume.masterResumeId,
    action: "master_resume_saved",
    actor: "user",
    summary: `已保存 ${nextMasterResume.basicInfo?.name || currentProfile.fullName || "候选人"} 的结构化主简历。`,
    metadata: {
      masterResumeId: nextMasterResume.masterResumeId,
      source: nextMasterResume.trace?.source || "canonical_saved"
    }
  });

  return getMasterResumeView();
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
  const jobDecision = buildJobDecisionSnapshotForJob(job, fitAssessment);
  const controlGateResult = jobDecision
    ? buildControlGateResultForJob({
        job,
        fitAssessment,
        jobDecision,
        traceSource: "job_detail_view"
      })
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
  const feedbackTraces = extractFeedbackTraces(activityLogs);
  const resumeViewModel = buildResumeViewModel(resumeDocument);
  const feedbackTimelineView = buildFeedbackTimelineView(feedbackTraces);
  const jobWorkspaceViewModel = buildJobWorkspaceViewModel({
    job,
    jobDecision,
    controlGateResult,
    feedbackTraces
  });

  return {
    job,
    fitAssessment,
    jobDecision,
    controlGateResult,
    feedbackTraces,
    feedbackTimelineView,
    resumeViewModel,
    jobWorkspaceViewModel,
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

async function getJobWorkspaceList(options = {}) {
  const startedAt = Date.now();
  const stageTimings = {};
  const stageMark = (name, start) => {
    stageTimings[name] = Date.now() - start;
  };
  const includeProfiling = Boolean(options?.includeProfiling);

  const readStart = Date.now();
  const jobs = store.listJobs();
  const profile = store.getProfile() || {};
  const legacyLightweightProfile = normalizeLightweightProfile(profile);
  const hasExplicitJobPreference = hasExplicitJobPreferenceProfile(profile?.jobPreferenceProfile || {});
  const preferenceSource = hasExplicitJobPreference ? "jobPreferenceProfile" : "legacy";
  const jobPreferenceProfile = hasExplicitJobPreference
    ? normalizeJobPreferenceProfile(
        {
          jobPreferenceProfile: profile.jobPreferenceProfile,
          lightweightProfile: legacyLightweightProfile
        },
        { strict: true }
      )
    : normalizeJobPreferenceProfile({
        ...profile,
        lightweightProfile: legacyLightweightProfile
      });
  const lightweightProfile = buildLightweightProfileFromJobPreferenceProfile(
    jobPreferenceProfile,
    legacyLightweightProfile
  );
  stageMark("read_jobs_and_profile_ms", readStart);

  const normalizeStart = Date.now();
  const normalizedJobs = jobs.filter((job) => !isOfflineJsonFallbackJob(job));
  const rawLimit = Number(options?.limit);
  const hasLimit = Number.isFinite(rawLimit) && rawLimit > 0;
  const limit = hasLimit ? Math.max(1, Math.min(500, Math.floor(rawLimit))) : null;
  const selectedJobs = normalizedJobs;
  stageMark("normalize_jobs_ms", normalizeStart);

  const prefetchStart = Date.now();
  const selectedJobIdSet = new Set(selectedJobs.map((job) => String(job.id || "")).filter(Boolean));
  const fitAssessments = store.listFitAssessments();
  const fitAssessmentByJobId = new Map(
    (Array.isArray(fitAssessments) ? fitAssessments : [])
      .filter((entry) => selectedJobIdSet.has(String(entry?.jobId || "")))
      .map((entry) => [String(entry.jobId || ""), entry])
  );
  const activityLogs = store.listActivityLogs();
  const activityLogsByJobId = new Map();
  (Array.isArray(activityLogs) ? activityLogs : []).forEach((entry) => {
    const jobId = String(entry?.jobId || "");
    if (!jobId || !selectedJobIdSet.has(jobId)) return;
    if (!activityLogsByJobId.has(jobId)) activityLogsByJobId.set(jobId, []);
    activityLogsByJobId.get(jobId).push(entry);
  });
  stageMark("prefetch_fit_and_activity_ms", prefetchStart);

  const baseViewStart = Date.now();
  const baseJobWorkspaceEntries = selectedJobs.map((job) => {
      const fitAssessment = fitAssessmentByJobId.get(String(job.id || "")) || null;
      const jobDecision = buildJobDecisionSnapshotForJob(job, fitAssessment);
      const controlGateResult = jobDecision
        ? buildControlGateResultForJob({
            job,
            fitAssessment,
            jobDecision,
            traceSource: "job_list_view"
          })
        : null;
      const logsForJob = activityLogsByJobId.get(String(job.id || "")) || [];
      const feedbackTraces = extractFeedbackTraces(logsForJob);
      const baseViewModel = buildJobWorkspaceViewModel({
        job,
        jobDecision,
        controlGateResult,
        feedbackTraces
      });
      return {
        job,
        baseViewModel: {
          ...baseViewModel,
          trackerView: buildJobTrackerView(job),
          feedbackView: buildJobFeedbackView(job),
          shortlistView: buildJobShortlistView(job),
          materialsPrepView: buildJobMaterialsPrepView(job),
          submissionAuditView: buildJobSubmissionAuditView(job),
          followUpView: buildJobFollowUpView(job)
        }
      };
    });
  stageMark("view_model_build_ms", baseViewStart);

  const ruleScoringStart = Date.now();
  const dedupeContext = buildJobDeduplicationContext(selectedJobs);
  const provisionalScoringEntries = baseJobWorkspaceEntries.map(({ job, baseViewModel }) => {
    const scoringView = buildJobScoringViewModel({
      job,
      lightweightProfile,
      jobPreferenceProfile,
      preferenceSource,
      dedupeContext
    });
    return { job, baseViewModel, scoringView };
  });
  const feedbackInfluenceSignals = buildFeedbackInfluenceSignals(provisionalScoringEntries);
  const ruleScoredJobWorkspaceViewModels = provisionalScoringEntries.map(({ job, baseViewModel, scoringView }) => {
    const feedbackInfluenceSignal = feedbackInfluenceSignals.get(String(job?.id || "")) || null;
    const nextScoringView = buildJobScoringViewModel({
      job,
      lightweightProfile,
      jobPreferenceProfile,
      preferenceSource,
      feedbackInfluenceSignal,
      baseScoringView: scoringView,
      dedupeContext
    });
    return attachScoringToJobWorkspaceViewModel(baseViewModel, nextScoringView);
  });
  stageMark("rule_scoring_ms", ruleScoringStart);

  const sortStart = Date.now();
  ruleScoredJobWorkspaceViewModels.sort(compareJobWorkspacePriority);
  stageMark("sort_ms", sortStart);

  const llmStart = Date.now();
  let jobWorkspaceViewModels = ruleScoredJobWorkspaceViewModels;
  try {
    jobWorkspaceViewModels = await applyLlmScoringToTopJobs({
      lightweightProfile,
      ruleScoredJobWorkspaceViewModels
    });
    jobWorkspaceViewModels = mergeRuleScoringDisplayFields(
      jobWorkspaceViewModels,
      ruleScoredJobWorkspaceViewModels
    );
    jobWorkspaceViewModels.sort(compareJobWorkspacePriority);
  } catch (error) {
    // LLM 派生层必须可降级，不能影响 jobs 主返回。
    logger.warn("jobs.llm_scoring.unavailable", {
      source: "workflow.getJobWorkspaceList",
      error: error?.message || String(error || "unknown_error")
    });
  }
  stageMark("llm_cache_check_and_schedule_ms", llmStart);
  stageTimings.total_ms = Date.now() - startedAt;
  stageTimings.jobs_count = jobs.length;
  stageTimings.normalized_jobs_count = normalizedJobs.length;
  stageTimings.selected_jobs_count = selectedJobs.length;
  const dedupedJobWorkspaceViewModels = dedupeJobWorkspaceViewModels(jobWorkspaceViewModels);
  const finalJobs = limit ? dedupedJobWorkspaceViewModels.slice(0, limit) : dedupedJobWorkspaceViewModels;
  stageTimings.returned_jobs_count = finalJobs.length;
  stageTimings.limit = limit;
  stageTimings.apply_link_company_title_mapping_ms = stageTimings.view_model_build_ms;

  if (includeProfiling || String(process.env.JOBS_PROFILE_LOG || "").trim() === "1") {
    logger.info("jobs.api.profile", {
      source: "workflow.getJobWorkspaceList",
      timings: stageTimings
    });
  }

  const response = { jobWorkspaceViewModels: finalJobs };
  if (includeProfiling) response.profiling = stageTimings;
  return response;
}

function normalizeTrackerState(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return TRACKER_STATES.has(normalized) ? normalized : "none";
}

function normalizeTrackerTimeline(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((entry) => {
      const state = normalizeTrackerState(entry?.state);
      if (state === "none") return null;
      const rawTimestamp = String(entry?.timestamp || "").trim();
      if (!rawTimestamp) return null;
      const parsed = new Date(rawTimestamp);
      if (Number.isNaN(parsed.getTime())) return null;
      return {
        state,
        timestamp: parsed.toISOString()
      };
    })
    .filter(Boolean)
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 20);
}

function buildJobTrackerView(job = {}) {
  const trackerState = normalizeTrackerState(job?.trackerState || job?.tracker?.state || "");
  const timeline = normalizeTrackerTimeline(job?.trackerTimeline || job?.tracker?.timeline || []);
  return {
    state: trackerState,
    timeline,
    lastUpdatedAt: timeline[0]?.timestamp || null
  };
}

function normalizeFeedbackState(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return FEEDBACK_STATES.has(normalized) ? normalized : "none";
}

function normalizeShortlistState(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return SHORTLIST_STATES.has(normalized) ? normalized : "none";
}

function normalizeShortlistTimeline(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((entry) => {
      const state = normalizeShortlistState(entry?.state);
      if (state === "none") return null;
      const rawTimestamp = String(entry?.timestamp || "").trim();
      if (!rawTimestamp) return null;
      const parsed = new Date(rawTimestamp);
      if (Number.isNaN(parsed.getTime())) return null;
      return {
        state,
        timestamp: parsed.toISOString()
      };
    })
    .filter(Boolean)
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 20);
}

function buildJobShortlistView(job = {}) {
  const shortlistState = normalizeShortlistState(job?.shortlistState || "");
  const timeline = normalizeShortlistTimeline(job?.shortlistTimeline || []);
  return {
    state: shortlistState,
    timeline,
    lastUpdatedAt: timeline[0]?.timestamp || null
  };
}

function normalizeFeedbackTimeline(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((entry) => {
      const state = normalizeFeedbackState(entry?.state);
      if (state === "none") return null;
      const rawTimestamp = String(entry?.timestamp || "").trim();
      if (!rawTimestamp) return null;
      const parsed = new Date(rawTimestamp);
      if (Number.isNaN(parsed.getTime())) return null;
      return {
        state,
        timestamp: parsed.toISOString()
      };
    })
    .filter(Boolean)
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 20);
}

function buildJobFeedbackView(job = {}) {
  const feedbackState = normalizeFeedbackState(job?.feedbackState || "");
  const timeline = normalizeFeedbackTimeline(job?.feedbackTimeline || []);
  return {
    state: feedbackState,
    timeline,
    lastUpdatedAt: timeline[0]?.timestamp || null
  };
}

function normalizeMaterialsPrepView(input = {}) {
  const resumeStatus = MATERIAL_RESUME_STATES.has(String(input?.resumeStatus || "").trim().toLowerCase())
    ? String(input.resumeStatus || "").trim().toLowerCase()
    : "none";
  const coverLetterStatus = MATERIAL_COVER_LETTER_STATES.has(
    String(input?.coverLetterStatus || "").trim().toLowerCase()
  )
    ? String(input.coverLetterStatus || "").trim().toLowerCase()
    : "none";
  const interviewPrepStatus = MATERIAL_INTERVIEW_PREP_STATES.has(
    String(input?.interviewPrepStatus || "").trim().toLowerCase()
  )
    ? String(input.interviewPrepStatus || "").trim().toLowerCase()
    : "none";
  const notes = String(input?.notes || "").trim().slice(0, 2000);
  const rawUpdatedAt = String(input?.lastUpdatedAt || "").trim();
  const parsed = rawUpdatedAt ? new Date(rawUpdatedAt) : null;
  const lastUpdatedAt =
    parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;

  return {
    resumeStatus,
    coverLetterStatus,
    interviewPrepStatus,
    notes,
    lastUpdatedAt
  };
}

function buildJobMaterialsPrepView(job = {}) {
  return normalizeMaterialsPrepView(job?.materialsPrep || {});
}

function normalizeSubmissionAuditView(input = {}) {
  const status = SUBMISSION_AUDIT_STATUS_STATES.has(String(input?.status || "").trim().toLowerCase())
    ? String(input.status || "").trim().toLowerCase()
    : "none";
  const source = SUBMISSION_AUDIT_SOURCE_STATES.has(String(input?.source || "").trim().toLowerCase())
    ? String(input.source || "").trim().toLowerCase()
    : "manual";
  const normalizeIso = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  };
  return {
    status,
    source,
    submittedAt: normalizeIso(input?.submittedAt),
    lastAttemptAt: normalizeIso(input?.lastAttemptAt),
    attemptCount: Number.isFinite(Number(input?.attemptCount)) ? Math.max(0, Number(input.attemptCount)) : 0,
    lastError: String(input?.lastError || "").trim().slice(0, 2000),
    notes: String(input?.notes || "").trim().slice(0, 2000)
  };
}

function buildJobSubmissionAuditView(job = {}) {
  return normalizeSubmissionAuditView(job?.submissionAudit || {});
}

function normalizeFollowUpView(input = {}) {
  const status = FOLLOW_UP_STATUS_STATES.has(String(input?.status || "").trim().toLowerCase())
    ? String(input.status || "").trim().toLowerCase()
    : "none";
  const channel = FOLLOW_UP_CHANNEL_STATES.has(String(input?.channel || "").trim().toLowerCase())
    ? String(input.channel || "").trim().toLowerCase()
    : "other";
  const normalizeIso = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  };
  return {
    status,
    dueAt: normalizeIso(input?.dueAt),
    channel,
    notes: String(input?.notes || "").trim().slice(0, 2000),
    lastUpdatedAt: normalizeIso(input?.lastUpdatedAt)
  };
}

function buildJobFollowUpView(job = {}) {
  return normalizeFollowUpView(job?.followUp || {});
}

function scoreFeedbackStateValue(state = "none") {
  if (state === "good_fit") return 1;
  if (state === "bad_fit") return -1;
  if (state === "misclassified") return -1;
  return 0;
}

function buildFeedbackInfluenceSignals(provisionalScoringEntries = []) {
  const aggregates = new Map();
  const register = (key = "", score = 0) => {
    if (!key) return;
    if (!aggregates.has(key)) {
      aggregates.set(key, { total: 0, positive: 0, negative: 0 });
    }
    const bucket = aggregates.get(key);
    bucket.total += 1;
    if (score > 0) bucket.positive += 1;
    if (score < 0) bucket.negative += 1;
  };

  provisionalScoringEntries.forEach(({ job, scoringView }) => {
    const feedbackState = normalizeFeedbackState(job?.feedbackState || "");
    const feedbackScore = scoreFeedbackStateValue(feedbackState);
    if (feedbackScore === 0) return;
    const inferredIndustry = String(scoringView?.inferredIndustry || "").trim();
    const inferredRoleFamily = String(scoringView?.inferredRoleFamily || "").trim();
    register(`industry:${inferredIndustry}`, feedbackScore);
    // 角色为空时不参与同类反馈聚合，避免空桶扩散到不相关岗位。
    if (inferredRoleFamily) {
      register(`role:${inferredRoleFamily}`, feedbackScore);
    }
  });

  const signalsByJobId = new Map();
  provisionalScoringEntries.forEach(({ job, scoringView }) => {
    const inferredIndustry = String(scoringView?.inferredIndustry || "").trim();
    const inferredRoleFamily = String(scoringView?.inferredRoleFamily || "").trim();
    const industryBucket = aggregates.get(`industry:${inferredIndustry}`) || { total: 0, positive: 0, negative: 0 };
    const roleBucket = inferredRoleFamily
      ? aggregates.get(`role:${inferredRoleFamily}`) || { total: 0, positive: 0, negative: 0 }
      : { total: 0, positive: 0, negative: 0 };
    const total = industryBucket.total + roleBucket.total;
    if (total <= 0) {
      signalsByJobId.set(String(job?.id || ""), {
        boost: 0,
        reason: ""
      });
      return;
    }
    const netScore = industryBucket.positive + roleBucket.positive - industryBucket.negative - roleBucket.negative;
    let boost = 0;
    let reason = "";
    if (netScore >= 2) {
      boost = 4;
      reason = "基于你的历史偏好反馈，此类岗位优先级略提升";
    } else if (netScore === 1) {
      boost = 3;
      reason = "基于你的历史偏好反馈，此类岗位优先级小幅提升";
    } else if (netScore <= -2) {
      boost = -4;
      reason = "基于你的历史偏好反馈，此类岗位优先级略降低";
    } else if (netScore === -1) {
      boost = -3;
      reason = "基于你的历史偏好反馈，此类岗位优先级小幅降低";
    }
    signalsByJobId.set(String(job?.id || ""), { boost, reason });
  });

  return signalsByJobId;
}

function compareJobWorkspacePriority(left = {}, right = {}) {
  const leftFeedbackBoost = Number(left?.scoringView?.feedbackInfluence?.boost);
  const rightFeedbackBoost = Number(right?.scoringView?.feedbackInfluence?.boost);
  // 生产排序稳定顺序：用户五维优先级 > 等级 > 各维度 > 末位弱反馈信号。
  // jobQualityFit、sourceReliability 等质量/来源字段仅保留诊断用途，不参与生产排序。
  const comparisons = [
    compareNumericDesc(left?.scoringView?.userPriorityScore ?? left?.scoringView?.preferenceMatchScore, right?.scoringView?.userPriorityScore ?? right?.scoringView?.preferenceMatchScore),
    compareNumericDesc(resolveGradeRank(left?.scoringView?.decisionVerdict?.grade), resolveGradeRank(right?.scoringView?.decisionVerdict?.grade)),
    compareNumericDesc(left?.scoringView?.roleFit, right?.scoringView?.roleFit),
    compareNumericDesc(left?.scoringView?.industryFit, right?.scoringView?.industryFit),
    compareNumericDesc(left?.scoringView?.locationFit, right?.scoringView?.locationFit),
    compareNumericDesc(left?.scoringView?.companyFit, right?.scoringView?.companyFit),
    compareNumericDesc(left?.scoringView?.applicationAccessibilityFit, right?.scoringView?.applicationAccessibilityFit),
    compareNumericDesc(
      Number.isFinite(leftFeedbackBoost) ? leftFeedbackBoost : 0,
      Number.isFinite(rightFeedbackBoost) ? rightFeedbackBoost : 0
    )
  ];
  const decided = comparisons.find((value) => value !== 0);
  if (decided) return decided;

  const leftTime = new Date(left?.jobSummary?.updatedAt || left?.feedbackView?.lastUpdatedAt || 0).getTime();
  const rightTime = new Date(right?.jobSummary?.updatedAt || right?.feedbackView?.lastUpdatedAt || 0).getTime();
  return rightTime - leftTime;
}

function resolveGradeRank(grade = "") {
  const normalized = String(grade || "").trim().toUpperCase();
  if (normalized === "A") return 5;
  if (normalized === "B") return 4;
  if (normalized === "C") return 3;
  if (normalized === "D") return 2;
  if (normalized === "F") return 1;
  return 0;
}

function compareNumericDesc(leftValue, rightValue) {
  const left = Number(leftValue);
  const right = Number(rightValue);
  if (Number.isFinite(left) && Number.isFinite(right) && right !== left) return right - left;
  if (Number.isFinite(right) && !Number.isFinite(left)) return 1;
  if (Number.isFinite(left) && !Number.isFinite(right)) return -1;
  return 0;
}

function dedupeJobWorkspaceViewModels(items = []) {
  const deduped = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const dedupeKey = buildJobWorkspaceDedupeKey(item);
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    deduped.push(item);
  });
  return deduped;
}

function mergeRuleScoringDisplayFields(items = [], ruleItems = []) {
  const ruleByJobId = new Map(
    (Array.isArray(ruleItems) ? ruleItems : [])
      .map((item) => [String(item?.id || item?.jobSummary?.id || ""), item])
      .filter(([jobId]) => Boolean(jobId))
  );

  return (Array.isArray(items) ? items : []).map((item) => {
    const jobId = String(item?.id || item?.jobSummary?.id || "");
    const ruleItem = ruleByJobId.get(jobId);
    if (!ruleItem) return item;
    const ruleScoringView = ruleItem.scoringView || {};
    const currentScoringView = item.scoringView || {};
    return {
      ...item,
      scoringView: mergeScoringViewWithRuleFallback(ruleScoringView, currentScoringView)
    };
  });
}

function mergeScoringViewWithRuleFallback(ruleScoringView = {}, currentScoringView = {}) {
  const merged = { ...ruleScoringView, ...currentScoringView };
  const stringFields = ["inferredIndustry", "inferredIndustryConfidence", "inferredRoleFamily", "preferenceType", "opportunityType", "opportunityTypeConfidence", "opportunityTypeSummary", "opportunityTypeLabel"];
  stringFields.forEach((field) => {
    const currentValue = String(currentScoringView?.[field] || "").trim();
    if (!currentValue) {
      merged[field] = String(ruleScoringView?.[field] || "").trim();
    }
  });
  ["inferredSkills", "matchSignals", "mismatchSignals"].forEach((field) => {
    const currentValue = Array.isArray(currentScoringView?.[field]) ? currentScoringView[field] : [];
    if (currentValue.length === 0) {
      merged[field] = Array.isArray(ruleScoringView?.[field]) ? ruleScoringView[field] : [];
    }
  });
  return merged;
}

function buildJobWorkspaceDedupeKey(item = {}) {
  const company = normalizeDedupeText(item?.jobSummary?.company || "");
  const title = normalizeJobTitleForDedupe(item?.jobSummary?.title || "");
  return `${company}::${title}`;
}

function normalizeDedupeText(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function normalizeJobTitleForDedupe(value = "") {
  return normalizeDedupeText(value)
    .replace(/（[^）]*）/g, "")
    .replace(/[|｜/、,，;；:：·•()\[\]{}【】]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");
}

function isOfflineJsonFallbackJob(job = {}) {
  const company = String(job.company || "");
  const title = String(job.title || "");
  const url = String(job.jobUrl || job.sourceUrl || "");
  return (
    company === "工程师 团队" ||
    title === "工程师 相关岗位" ||
    /applyflow\.local\/fallback/i.test(url) ||
    /^fallback_/i.test(String(job.sourceJobId || job.externalId || ""))
  );
}

function sanitizeForUiBoundary(value, forbiddenKeys = new Set()) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForUiBoundary(item, forbiddenKeys));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const output = {};
  Object.entries(value).forEach(([key, nestedValue]) => {
    if (forbiddenKeys.has(key)) return;
    output[key] = sanitizeForUiBoundary(nestedValue, forbiddenKeys);
  });
  return output;
}

function buildTailoredResumeContractForJob({
  job = {},
  fitAssessment = null,
  resumeDocument = null,
  masterResume = null,
  tailoringOutput = null,
  applicationPrep = null
} = {}) {
  const profile = store.getProfile() || {};
  const resolvedMasterResume = masterResume || resolveTailoringMasterResumeSource(profile, resumeDocument).masterResume;
  if (!tailoringOutput || !job?.id || (!resumeDocument && !resolvedMasterResume)) return null;
  const baseResumeAsset = buildTailoringBaseResumeAsset({
    profile,
    resumeDocument,
    masterResume: resolvedMasterResume
  });
  const jobSummary = buildJobSummaryModel(job, fitAssessment, tailoringOutput);
  const canonicalTailoredResume = buildTailoredWorkspaceResumeModel(tailoringOutput, baseResumeAsset, jobSummary);
  const reviewModules = buildWorkspaceReviewModules(baseResumeAsset, canonicalTailoredResume);

  const sectionDiffs = reviewModules.flatMap((module) =>
    (Array.isArray(module.items) ? module.items : []).map((item, index) => ({
      diffId: `${module.key}_${index + 1}`,
      sectionKey: module.key,
      before: item.original || "",
      after: item.tailored || "",
      reason: module.reason || "",
      status: "accepted"
    }))
  );

  const contract = createTailoredResumeContract({
    tailoredResumeId: tailoringOutput.id || createId("tailored_resume"),
    jobId: job.id,
    masterResumeId: resolvedMasterResume?.masterResumeId || resumeDocument?.id || "",
    version: Number(tailoringOutput.version || tailoringOutput.workspace?.activeVersion || 1),
    canonicalTailoredResume,
    changeReasons: [
      ...(tailoringOutput.tailoringExplainability || []),
      ...(tailoringOutput.insights
        ? [
            tailoringOutput.insights.headline || "",
            tailoringOutput.insights.strongestMatch || "",
            tailoringOutput.insights.biggestGap || "",
            tailoringOutput.insights.nextEditFocus || ""
          ]
        : [])
    ],
    generatedSections: reviewModules.map((module) => module.key),
    sectionDiffs,
    exportStatus: {
      status: applicationPrep ? "ready" : "not_ready",
      docxReady: Boolean(applicationPrep),
      lastExportedAt: null
    },
    trace: {
      source: resolvedMasterResume?.trace?.source || "tailoring_output_adapter",
      model: tailoringOutput.llmMeta?.model || "",
      runId: tailoringOutput.id || ""
    },
    createdAt: tailoringOutput.createdAt || nowIso(),
    updatedAt: tailoringOutput.updatedAt || nowIso()
  });

  const validation = validateTailoredResumeContract(contract);
  if (!validation.ok) {
    const error = new Error(`Invalid TailoredResume contract: ${validation.errors.join("; ")}`);
    error.code = "INVALID_TAILORED_RESUME_CONTRACT";
    error.details = { errors: validation.errors, contract };
    throw error;
  }

  return contract;
}

function buildPrepDtoFromContracts({
  job = {},
  resumeDocument = null,
  tailoredResumeContract = null,
  applicationPrep = null,
  targetingBrief = null,
  shortlistAdmission = null
} = {}) {
  if (!job?.id || !tailoredResumeContract) return null;

  const prepDto = createPrepDto({
    prepDtoId: applicationPrep?.id || createId("prep_dto"),
    jobId: job.id,
    tailoredResumeId: tailoredResumeContract.tailoredResumeId,
    masterResumeId: tailoredResumeContract.masterResumeId,
    prepVersion: Number(applicationPrep?.version || 1),
    resumeDocumentId: resumeDocument?.id || "",
    targetKeywords: targetingBrief?.targetKeywords || [],
    tailoredSummary:
      applicationPrep?.tailoredSummary || tailoredResumeContract.canonicalTailoredResume?.selfEvaluation || "",
    sectionDiffs: tailoredResumeContract.sectionDiffs || [],
    changeReasons: tailoredResumeContract.changeReasons || [],
    selfIntro: applicationPrep?.selfIntro || {},
    qaDraft: applicationPrep?.qaDraft || [],
    talkingPoints: applicationPrep?.talkingPoints || [],
    coverNote: applicationPrep?.coverNote || "",
    outreachNote: applicationPrep?.outreachNote || "",
    checklist: applicationPrep?.checklist || [],
    admissionContext: normalizeAdmissionContext(shortlistAdmission),
    prepStatus: applicationPrep ? "ready" : "draft",
    updatedAt: applicationPrep?.updatedAt || tailoredResumeContract.updatedAt || nowIso()
  });

  const validation = validatePrepDto(prepDto);
  if (!validation.ok) {
    const error = new Error(`Invalid Prep DTO: ${validation.errors.join("; ")}`);
    error.code = "INVALID_PREP_DTO";
    error.details = { errors: validation.errors, prepDto };
    throw error;
  }

  return prepDto;
}

function buildExecutionDtoFromContracts({
  job = {},
  controlGateResult = null,
  tailoredResumeContract = null,
  prepDto = null,
  executionMode = "dry-run",
  targetUrl = "",
  actor = "system",
  note = "",
  shortlistAdmission = null
} = {}) {
  if (!job?.id || !tailoredResumeContract || !prepDto) return null;

  const runId = createId("run");
  const executionDto = createExecutionDto({
    runId,
    jobId: job.id,
    tailoredResumeId: tailoredResumeContract.tailoredResumeId,
    prepDtoId: prepDto.prepDtoId || "",
    prepVersion: prepDto.prepVersion || 1,
    gateSnapshot: {
      controlId: controlGateResult?.controlId || "",
      status: controlGateResult?.status || "",
      reasons: controlGateResult?.reasons || [],
      blockingIssues: controlGateResult?.blockingIssues || [],
      requiredActions: controlGateResult?.requiredActions || [],
      checkedAt: controlGateResult?.checkedAt || nowIso()
    },
    executionMode,
    confirmState: {
      state: controlGateResult?.status === "needs_human_review" ? "pending" : "confirmed",
      required: controlGateResult?.status === "needs_human_review",
      confirmToken: controlGateResult?.status === "needs_human_review" ? createId("confirm") : "",
      confirmedBy: controlGateResult?.status === "needs_human_review" ? "" : actor,
      confirmedAt: controlGateResult?.status === "needs_human_review" ? null : nowIso()
    },
    targetUrl: targetUrl || job.jobUrl || "",
    prefillPayload: {
      targetKeywords: prepDto.targetKeywords || [],
      tailoredSummary: prepDto.tailoredSummary || "",
      rewriteBullets: prepDto.rewriteBullets || []
    },
    formPayload: {},
    auditContext: {
      actor,
      source: "workflow_controller.execution",
      note
    },
    admissionContext: normalizeAdmissionContext(shortlistAdmission),
    trace: {
      runId,
      source: "execution_dto_builder",
      createdBy: actor
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  const validation = validateExecutionDto(executionDto);
  if (!validation.ok) {
    const error = new Error(`Invalid Execution DTO: ${validation.errors.join("; ")}`);
    error.code = "INVALID_EXECUTION_DTO";
    error.details = { errors: validation.errors, executionDto };
    throw error;
  }

  return executionDto;
}

function assertSubmitAllowed(controlGateResult, executionDto = null) {
  if (!controlGateResult || typeof controlGateResult !== "object") {
    const error = new Error("ControlGateResult is required before submit.");
    error.code = "CONTROL_GATE_REQUIRED";
    throw error;
  }
  if (controlGateResult.status === "blocked") {
    const error = new Error("Submit blocked by control gate.");
    error.code = "CONTROL_GATE_BLOCKED";
    error.details = { controlGateResult };
    throw error;
  }
  if (controlGateResult.status === "needs_human_review") {
    const confirmed = executionDto?.confirmState?.state === "confirmed";
    if (!confirmed) {
      const error = new Error("Submit requires human confirmation.");
      error.code = "HUMAN_CONFIRM_REQUIRED";
      error.details = { controlGateResult, executionDto };
      throw error;
    }
  }
}

function getJobDetailView(jobId) {
  const detail = getJobDetail(jobId);
  const feedbackTimelineView = buildFeedbackTimelineView(detail.feedbackTraces || []);
  const resumeViewModel = buildResumeViewModel(detail.resumeDocument || null);
  const tailoredResumeContract = buildTailoredResumeContractForJob({
    job: detail.job,
    fitAssessment: detail.fitAssessment,
    resumeDocument: detail.resumeDocument,
    tailoringOutput: detail.tailoringOutput,
    applicationPrep: detail.applicationPrep
  });
  const detailProfile = store.getProfile() || {};
  const detailMasterResumeSource = resolveTailoringMasterResumeSource(detailProfile, detail.resumeDocument);
  const prepDto = buildPrepDtoFromContracts({
    job: detail.job,
    resumeDocument: detail.resumeDocument,
    tailoredResumeContract,
    applicationPrep: detail.applicationPrep,
    targetingBrief: detail.tailoringOutput?.targetingBrief || null,
    shortlistAdmission: detail.job?.shortlistAdmission || null
  });
  const tailoringDisplayView = buildTailoringWorkspaceViewModel({
    job: detail.job || {},
    workspace: {
      id: detail.tailoringOutput?.workspace?.id || `workspace_${detail.job?.id || "job"}`,
      name: detail.tailoringOutput?.workspace?.name || buildDefaultTailoringWorkspaceName(detail.job || {}),
      activeVersion: detail.tailoringOutput?.workspace?.activeVersion || detail.tailoringOutput?.version || 1,
      updatedAt: detail.tailoringOutput?.updatedAt || detail.job?.updatedAt || nowIso(),
      jobSummary: buildJobSummaryModel(detail.job || {}, detail.fitAssessment, detail.tailoringOutput || null),
      baseResumeAsset: buildTailoringBaseResumeAsset({
        profile: detailProfile,
        resumeDocument: detail.resumeDocument,
        masterResume: detailMasterResumeSource.masterResume
      }),
      tailoredResume: tailoredResumeContract?.canonicalTailoredResume || {
        workExperience: [],
        projectExperience: [],
        selfEvaluation: ""
      },
      reviewSummary: { acceptedCount: (tailoredResumeContract?.sectionDiffs || []).length, pendingCount: 0, rejectedCount: 0 },
      reviewModules: [],
      insights: detail.tailoringOutput?.insights || {}
    },
    tailoringOutput: detail.tailoringOutput || null,
    tailoredResumeContract
  });
  const executionSessionView = buildExecutionSessionView({
    executionDto: detail.job?.latestExecutionDto || null,
    submitContract: detail.job?.latestSubmitContract || null,
    feedbackTraces: detail.feedbackTraces || [],
    controlGateResult: detail.controlGateResult || null
  });
  const browserApplyViewModel =
    detail.job?.latestBrowserApplyViewModel && typeof detail.job.latestBrowserApplyViewModel === "object"
      ? detail.job.latestBrowserApplyViewModel
      : null;
  const operationData = sanitizeForUiBoundary(
    {
      applicationPrep: detail.applicationPrep || null,
      tailoredResumeContract,
      tailoringDisplayView,
      prepDto,
      executionSessionView,
      browserApplyViewModel,
      tasks: detail.tasks || [],
      interviewReflection: detail.interviewReflection || null,
      badCase: detail.badCase || null,
      pipelineStages: detail.pipelineStages || []
    },
    new Set(["resumeDocument", "structuredProfile", "cleanedText", "rawText"])
  );

  return {
    jobId: detail.job?.id || jobId,
    jobWorkspaceViewModel: detail.jobWorkspaceViewModel,
    resumeViewModel,
    feedbackTimelineView,
    executionSessionView,
    browserApplyViewModel,
    executionActions: {
      nextAction: detail.nextAction || null,
      allowedNextStatuses: detail.allowedNextStatuses || [],
      recommendedNextStatuses: detail.recommendedNextStatuses || []
    },
    operationData,
    governanceView: {
      globalPolicy: detail.globalPolicy || null,
      policyExplanation: detail.policyExplanation || [],
      policyProposals: detail.policyProposals || [],
      policyAuditLogs: detail.policyAuditLogs || []
    }
  };
}

function buildTailoringWorkspace(jobId) {
  const detail = getJobDetail(jobId);
  const { job, fitAssessment, nextAction } = detail;
  const tailoringOutput = store.getTailoringOutputByJobId(jobId) || null;
  const applicationPrep = store.getApplicationPrepByJobId(jobId) || null;
  const resumeDocument = job.resumeDocumentId
    ? store.getResumeDocument(job.resumeDocumentId) || store.getLatestResumeDocument()
    : store.getLatestResumeDocument();
  const profile = store.getProfile() || {};
  const masterResumeSource = resolveTailoringMasterResumeSource(profile, resumeDocument);
  const baseResumeAsset = buildTailoringBaseResumeAsset({
    profile,
    resumeDocument,
    masterResume: masterResumeSource.masterResume
  });
  const safeTailoringOutput = tailoringOutput || {
    workspaceDraft: null,
    tailoredSummary: "",
    reviewModules: [],
    insights: {}
  };
  const jobSummary = buildJobSummaryModel(job, fitAssessment, safeTailoringOutput);
  const tailoredResume = buildTailoredWorkspaceResumeModel(safeTailoringOutput, baseResumeAsset, jobSummary);
  const reviewModules = buildWorkspaceReviewModules(baseResumeAsset, tailoredResume);
  const insights = buildWorkspaceInsights(jobSummary, baseResumeAsset, tailoredResume);
  const workspaceState = {
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
    insights,
    jobSummary,
    nextAction
  };
  const tailoredResumeContract = buildTailoredResumeContractForJob({
    job,
    fitAssessment,
    resumeDocument,
    masterResume: masterResumeSource.masterResume,
    tailoringOutput: safeTailoringOutput,
    applicationPrep
  });
  const prepDto = buildPrepDtoFromContracts({
    job,
    resumeDocument,
    tailoredResumeContract,
    applicationPrep,
    targetingBrief: safeTailoringOutput.targetingBrief || null,
    shortlistAdmission: job.shortlistAdmission || null
  });
  const feedbackTimelineView = buildFeedbackTimelineView(detail.feedbackTraces || []);

  return {
    jobId: job.id,
    jobWorkspaceViewModel: detail.jobWorkspaceViewModel,
    resumeViewModel: detail.resumeViewModel,
    feedbackTimelineView,
    tailoredResumeContract,
    prepDto,
    tailoringWorkspaceViewModel: buildTailoringWorkspaceViewModel({
      job,
      workspace: workspaceState,
      tailoringOutput: safeTailoringOutput,
      tailoredResumeContract
    }),
    tailoringWorkspaceEditDto: buildTailoringWorkspaceEditDto({
      job,
      workspace: workspaceState,
      tailoringOutput: safeTailoringOutput
    })
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

  const updatedAssessment = store.getFitAssessmentByJobId(jobId);
  const jobDecision = buildJobDecisionSnapshotForJob(updatedJob, updatedAssessment);
  recordFeedbackTrace({
    jobId,
    decisionId: jobDecision?.decisionId || "",
    eventType: "user_override",
    outcome: "overridden",
    actor: "user",
    jobDecision,
    executionSnapshot: {
      stage: "override",
      status: "completed",
      details: `User override applied: ${action}`
    },
    userOverride: {
      applied: true,
      action,
      reason: payload.reason || ""
    },
    source: "workflow_controller.override"
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

  return { resumeDocument: savedResume, resumeViewModel: buildResumeViewModel(savedResume) };
}

function getCurrentResume() {
  const resumeDocument = store.getLatestResumeDocument() || null;
  const resumeViewModel = buildResumeViewModel(resumeDocument);
  return {
    resumeViewModel,
    resumeMeta: {
      resumeId: resumeViewModel.resumeId || "",
      hasResume: Boolean(resumeViewModel.resumeId),
      parseStatus: resumeViewModel.parseStatus || "missing",
      parseQuality: resumeViewModel.parseQuality || "low",
      parseQualityScore: Number.isFinite(Number(resumeViewModel.parseQualityScore))
        ? Number(resumeViewModel.parseQualityScore)
        : 0,
      uploadedAt: resumeViewModel.uploadedAt || null,
      warningCount: Array.isArray(resumeViewModel.warnings) ? resumeViewModel.warnings.length : 0
    }
  };
}

function getMasterResumeView() {
  const profile = store.getProfile() || {};
  const savedCanonicalMasterResume = store.getMasterResume();
  const latestResumeDocument = store.getLatestResumeDocument() || null;

  let masterResumeContract = null;
  let source = "empty_seed";

  if (savedCanonicalMasterResume) {
    masterResumeContract = createMasterResumeContract(savedCanonicalMasterResume);
    const validation = validateMasterResumeContract(masterResumeContract);
    if (!validation.valid) {
      masterResumeContract = null;
    } else {
      source = "canonical_saved";
    }
  }

  if (!masterResumeContract && latestResumeDocument) {
    masterResumeContract = buildMasterResumeSeedFromResumeDocument(latestResumeDocument, profile);
    source = "resume_document_seed";
  }

  if (!masterResumeContract) {
    masterResumeContract = buildEmptyMasterResume(profile);
  }

  const normalizedMasterResume = createMasterResumeContract({
    ...masterResumeContract,
    trace: {
      ...(masterResumeContract.trace || {}),
      source
    }
  });

  return {
    masterResumeViewModel: buildMasterResumeViewModel(normalizedMasterResume),
    masterResumeEditDto: buildMasterResumeEditDto(normalizedMasterResume),
    masterResumeMeta: {
      masterResumeId: normalizedMasterResume.masterResumeId,
      source,
      hasSavedCanonical: source === "canonical_saved",
      seededFromResumeDocument: source === "resume_document_seed",
      sourceResumeId: normalizedMasterResume.trace?.sourceResumeId || "",
      updatedAt: normalizedMasterResume.updatedAt || null
    }
  };
}

async function exportJobTailoringByFormat(jobId, exportFormat = "docx") {
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

  const tailoredResumeContract = buildTailoredResumeContractForJob({
    job,
    fitAssessment: store.getFitAssessmentByJobId(jobId),
    resumeDocument,
    tailoringOutput,
    applicationPrep
  });
  const prepDto = buildPrepDtoFromContracts({
    job,
    resumeDocument,
    tailoredResumeContract,
    applicationPrep,
    targetingBrief: tailoringOutput?.targetingBrief || null,
    shortlistAdmission: job?.shortlistAdmission || null
  });
  const canonicalResumeContract = buildCanonicalResumeFromResumeDocument(resumeDocument || null);

  const resumeExportContract = createResumeExportContract({
    exportId: createId("export"),
    jobId: job.id,
    masterResumeId: tailoredResumeContract.masterResumeId || resumeDocument?.id || "",
    tailoredResumeId: tailoredResumeContract.tailoredResumeId || "",
    exportFormat,
    exportStatus: "ready",
    artifactName: `${job.company || "ApplyFlow"}-${job.title || "TailoredResume"}.${exportFormat}`,
    artifactMeta: {
      mimeType:
        exportFormat === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extension: exportFormat
    },
    trace: {
      source: "workflow_controller.export",
      runId: tailoredResumeContract.trace?.runId || tailoredResumeContract.tailoredResumeId || ""
    },
    warnings: [],
    errors: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
  const exportContractValidation = validateResumeExportContract(resumeExportContract);
  if (!exportContractValidation.ok) {
    const error = new Error(`Invalid ResumeExport contract: ${exportContractValidation.errors.join("; ")}`);
    error.code = "INVALID_RESUME_EXPORT_CONTRACT";
    error.details = { errors: exportContractValidation.errors, resumeExportContract };
    throw error;
  }

  const { exportDto } = buildExportDtoFromContracts({
    resumeExportContract,
    canonicalResumeContract,
    tailoredResumeContract,
    prepDto,
    exportOptions: {
      candidateName: resumeDocument?.name || "",
      targetRole: job.title || "",
      targetCompany: job.company || "",
      targetLocation: job.location || "",
      transitionalSources: ["resumeDocument->canonical_resume_contract"]
    }
  });
  const exportDtoValidation = validateExportDto(exportDto);
  if (!exportDtoValidation.ok) {
    const error = new Error(`Invalid ExportDTO: ${exportDtoValidation.errors.join("; ")}`);
    error.code = "INVALID_EXPORT_DTO";
    error.details = { errors: exportDtoValidation.errors, exportDto };
    throw error;
  }

  let finalizedExportContract = resumeExportContract;
  let exported = null;
  try {
    exported =
      exportFormat === "pdf"
        ? await exportTailoredResumePdf(exportDto)
        : await exportTailoredResumeDocx(exportDto);
    finalizedExportContract = completeResumeExportContractSuccess(resumeExportContract, exported);
    const finalizedValidation = validateResumeExportContract(finalizedExportContract);
    if (!finalizedValidation.ok) {
      const error = new Error(`Invalid finalized ResumeExport contract: ${finalizedValidation.errors.join("; ")}`);
      error.code = "INVALID_RESUME_EXPORT_CONTRACT";
      error.details = { errors: finalizedValidation.errors, finalizedExportContract };
      throw error;
    }
  } catch (exportError) {
    finalizedExportContract = completeResumeExportContractFailure(resumeExportContract, {
      message: exportError?.message || `${String(exportFormat || "docx").toUpperCase()} export failed.`,
      warnings: []
    });
    const failedValidation = validateResumeExportContract(finalizedExportContract);
    if (!failedValidation.ok) {
      exportError.details = {
        ...(exportError.details || {}),
        failedContractValidationErrors: failedValidation.errors
      };
    }
    exportError.code = exportError.code || `${String(exportFormat || "docx").toUpperCase()}_EXPORT_FAILED`;
    exportError.details = {
      ...(exportError.details || {}),
      exportContract: finalizedExportContract,
      exportDto
    };
    throw exportError;
  }

  logActivity({
    type: "tailoring_exported",
    entityType: "tailoring_output",
    entityId: tailoringOutput.id,
    action: "tailoring_exported",
    jobId,
    summary: `Exported ${job.company} / ${job.title} as ${String(exportFormat).toUpperCase()}.`,
    agentName: "??????",
    inputSummary: `Export request for ${job.company} / ${job.title}.`,
    outputSummary: `Produced ${exported.fileName}.`,
    decisionReason: "Resume export completed via contract-driven export pipeline."
  });

  return {
    ...exported,
    exportContract: finalizedExportContract,
    exportDto
  };
}

async function exportJobTailoringDocx(jobId) {
  return exportJobTailoringByFormat(jobId, "docx");
}

async function exportJobTailoringPdf(jobId) {
  return exportJobTailoringByFormat(jobId, "pdf");
}

function buildJobDraftFromCanonicalListing(listing = {}, intentId = "", admission = null) {
  const requirementLines = Array.isArray(listing.requirements) ? listing.requirements.filter(Boolean).slice(0, 10) : [];
  const jdRaw = [listing.jdSummary || "", ...requirementLines].filter(Boolean).join("\n");
  return {
    id: createId("job"),
    company: listing.company || "Unknown Company",
    title: listing.title || "Untitled Listing",
    location: listing.location || "",
    priority: "medium",
    status: "inbox",
    sourceLabel: listing.source || "discovery",
    sourcePlatform: listing.source || "discovery",
    jobUrl: listing.normalizedUrl || listing.sourceUrl || "",
    jdRaw,
    importMeta: {
      strategy: "discovery_shortlist_admission",
      importedFromIntentId: intentId,
      listingId: listing.listingId,
      shortlistId: admission?.shortlistId || "",
      admissionId: admission?.admissionId || ""
    },
    discoveryContext: {
      intentId,
      listingId: listing.listingId,
      clusterId: admission?.clusterId || "",
      shortlistId: admission?.shortlistId || "",
      source: "discovery_shortlist"
    },
    shortlistAdmission: admission || null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function attachShortlistAdmissionToJobWorkflow(jobId, payload = {}) {
  const job = store.getJob(jobId);
  if (!job) {
    const error = new Error(`Job ${jobId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }

  const intentId = String(payload.intentId || "").trim();
  const listingId = String(payload.listingId || "").trim();
  if (!intentId || !listingId) {
    const error = new Error("intentId and listingId are required for shortlist admission.");
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  const admission = createShortlistAdmission({
    intentId,
    listingId,
    actor: String(payload.actor || "user"),
    overrideReason: String(payload.overrideReason || "").trim(),
    allowSkipOverride: Boolean(payload.allowSkipOverride)
  });

  if (!["admitted", "overridden"].includes(admission.admissionStatus)) {
    const error = new Error("Listing is not admitted to Tailor/Execute chain.");
    error.code =
      admission.admissionStatus === "override_required"
        ? "SHORTLIST_OVERRIDE_REQUIRED"
        : "SHORTLIST_ADMISSION_BLOCKED";
    error.details = { admission };
    throw error;
  }

  const updatedJob = updateJob(jobId, () => ({
    shortlistAdmission: admission,
    discoveryContext: {
      intentId: admission.intentId,
      listingId: admission.listingId,
      clusterId: admission.clusterId,
      shortlistId: admission.shortlistId,
      source: "discovery_shortlist"
    }
  }));

  if (admission.admissionStatus === "overridden") {
    recordFeedbackTrace({
      jobId,
      decisionId: "",
      eventType: "user_override",
      outcome: "overridden",
      actor: admission.override?.actor || admission.actor || "user",
      executionSnapshot: {
        stage: "shortlist_admission",
        status: "override_applied",
        details: `Override admitted listing from bucket=${admission.admissionBucket}.`
      },
      userOverride: {
        applied: true,
        action: "shortlist_admission_override",
        reason: admission.override?.overrideReason || ""
      },
      runId: admission.admissionId || "",
      source: "workflow_controller.discovery"
    });
  }

  return { job: updatedJob, admission };
}

async function admitDiscoveryListingWorkflow(intentId, listingId, payload = {}) {
  const admission = createShortlistAdmission({
    intentId,
    listingId,
    actor: String(payload.actor || "user"),
    overrideReason: String(payload.overrideReason || "").trim(),
    allowSkipOverride: Boolean(payload.allowSkipOverride)
  });

  if (!["admitted", "overridden"].includes(admission.admissionStatus)) {
    const error = new Error("Listing is not admitted to Tailor/Execute chain.");
    error.code =
      admission.admissionStatus === "override_required"
        ? "SHORTLIST_OVERRIDE_REQUIRED"
        : "SHORTLIST_ADMISSION_BLOCKED";
    error.details = { admission };
    throw error;
  }

  const listing = getCanonicalListingByIntentAndListingId(intentId, listingId);
  if (!listing) {
    const error = new Error(`Listing ${listingId} not found in intent ${intentId}.`);
    error.code = "LISTING_NOT_FOUND";
    throw error;
  }

  const draft = buildJobDraftFromCanonicalListing(listing, intentId, admission);
  const savedJob = store.saveJob(draft) || draft;

  logActivity({
    type: "discovery_listing_admitted",
    entityType: "job",
    entityId: savedJob.id,
    action: "discovery_listing_admitted",
    actor: admission.actor || "user",
    jobId: savedJob.id,
    summary: `已将 shortlist listing ${listingId} 准入并创建岗位 ${savedJob.company} / ${savedJob.title}。`,
    metadata: {
      intentId,
      listingId,
      shortlistId: admission.shortlistId,
      admissionId: admission.admissionId,
      admissionStatus: admission.admissionStatus,
      admissionBucket: admission.admissionBucket
    }
  });

  if (admission.admissionStatus === "overridden") {
    recordFeedbackTrace({
      jobId: savedJob.id,
      decisionId: "",
      eventType: "user_override",
      outcome: "overridden",
      actor: admission.override?.actor || admission.actor || "user",
      executionSnapshot: {
        stage: "shortlist_admission",
        status: "override_applied",
        details: `Override admitted listing from bucket=${admission.admissionBucket}.`
      },
      userOverride: {
        applied: true,
        action: "shortlist_admission_override",
        reason: admission.override?.overrideReason || ""
      },
      runId: admission.admissionId || "",
      source: "workflow_controller.discovery"
    });
  } else {
    recordFeedbackTrace({
      jobId: savedJob.id,
      decisionId: "",
      eventType: "execution_prepared",
      outcome: "observed",
      actor: admission.actor || "system",
      executionSnapshot: {
        stage: "shortlist_admission",
        status: "admitted",
        details: "Listing admitted from shortlist to Tailor/Execute chain."
      },
      runId: admission.admissionId || "",
      source: "workflow_controller.discovery"
    });
  }

  return { admission, job: savedJob };
}

function createDiscoveryIntentWorkflow(payload = {}) {
  const profile = store.getProfile() || {};
  const intent = createDiscoveryIntent({
    userId: payload.userId || profile.id || "user_a",
    keywords: payload.keywords || [],
    city: payload.city || "",
    jobType: payload.jobType || "unknown",
    seniority: payload.seniority || "unknown",
    salaryRange: payload.salaryRange || {},
    constraints: payload.constraints || {},
    riskTolerance: payload.riskTolerance || "medium"
  });

  return { intent };
}

function importDiscoveryCandidatesWorkflow(intentId, payload = {}) {
  const profile = store.getProfile() || {};
  return importCandidatesToCanonicalListings({
    intentId,
    userId: profile.id || payload.userId || "user_a",
    candidates: payload.candidates || payload.jobLinks || [],
    profile
  });
}

function importDiscoveryFeishuLeadsWorkflow(intentId, payload = {}) {
  const profile = store.getProfile() || {};
  const leadProcessingResult = ingestFeishuRawLeads({
    leads: payload.leads || [],
    fetchMeta: {
      origin: payload.origin || "feishu_ui_import",
      docName: payload.docName || "",
      importedAt: nowIso(),
      rawStatus: "ok"
    }
  });
  const storedLeadProcessingResult = saveLeadProcessingResult(intentId, leadProcessingResult);
  const importResult = importCandidatesToCanonicalListings({
    intentId,
    userId: profile.id || payload.userId || "user_a",
    candidates: leadProcessingResult.candidateInputs || [],
    profile
  });

  return {
    ...importResult,
    leadProcessingResult: storedLeadProcessingResult
  };
}

async function syncDiscoveryFeishuBitableWorkflow(intentId, payload = {}) {
  const profile = store.getProfile() || {};
  return syncFeishuBitableLeads({
    intentId,
    userId: profile.id || payload.userId || "user_a",
    profile,
    appToken: payload.appToken || "",
    tableId: payload.tableId || "",
    tenantAccessToken: payload.tenantAccessToken || "",
    viewId: payload.viewId || "",
    pageSize: Number(payload.pageSize || 100),
    maxPages: Number(payload.maxPages || 10),
    docName: payload.docName || "",
    origin: payload.origin || "feishu_bitable_sync",
    fieldMap: payload.fieldMap || {},
    fetchImpl: payload.fetchImpl
  });
}

async function importDiscoveryOfflineJsonWorkflow(intentId, payload = {}) {
  const profile = store.getProfile() || {};
  const lightweightProfile =
    profile.lightweightProfile && typeof profile.lightweightProfile === "object"
      ? profile.lightweightProfile
      : {};
  const effectiveIntentId = String(intentId || createId("intent")).trim();
  let intent = getDiscoveryIntent(effectiveIntentId);
  if (!intent) {
    intent = createDiscoveryIntent({
      intentId: effectiveIntentId,
      userId: profile.id || payload.userId || "user_a",
      keywords: Array.isArray(payload.keywords)
        ? payload.keywords
        : Array.isArray(lightweightProfile.targetRoles)
          ? lightweightProfile.targetRoles
          : [],
      city:
        payload.city ||
        (Array.isArray(lightweightProfile.preferredLocations) ? lightweightProfile.preferredLocations[0] || "" : ""),
      jobType: payload.jobType || "unknown"
    });
    logger.warn("discovery.offline_json_intent_recreated", {
      source: "workflow.importDiscoveryOfflineJsonWorkflow",
      intentId: effectiveIntentId
    });
  }
  const batchInput = {
    filePath: payload.filePath || "data/standardized_feishu_records.json",
    records: Array.isArray(payload.records) ? payload.records : null,
    candidateLimit: Number(payload.candidateLimit || 50),
    resolutionLimit: Number(payload.resolutionLimit || 30),
    fallbackKeywords: Array.isArray(payload.fallbackKeywords)
      ? payload.fallbackKeywords
      : Array.isArray(lightweightProfile.targetRoles)
        ? lightweightProfile.targetRoles
        : [],
    fallbackCity:
      payload.fallbackCity ||
      (Array.isArray(lightweightProfile.preferredLocations) ? lightweightProfile.preferredLocations[0] || "" : ""),
    fallbackCount: Number(payload.fallbackCount || 12)
  };

  const batch = await loadOfflineJsonBatch(batchInput);

  const leadProcessingResult = buildLeadProcessingResultFromOfflineJson(batch.selectedRecords, {
    filePath: batch.filePath,
    origin: payload.origin || "offline_json_import",
    docName: payload.docName || "standardized_feishu_records",
    importedAt: nowIso()
  });
  const storedLeadProcessingResult = saveLeadProcessingResult(effectiveIntentId, leadProcessingResult);
  const importResult = importCandidatesToCanonicalListings({
    intentId: effectiveIntentId,
    userId: profile.id || payload.userId || "user_a",
    candidates: leadProcessingResult.candidateInputs || [],
    profile
  });

  const origin = String(payload.origin || "offline_json_import");
  const shouldAutoAdmitForJobs =
    Boolean(payload.autoAdmitForJobs) ||
    origin === "dashboard_bootstrap" ||
    origin === "onboarding_bootstrap";
  const autoAdmitLimit = Math.max(0, Number(payload.autoAdmitLimit || 12));
  const admittedJobs = [];

  if (shouldAutoAdmitForJobs && autoAdmitLimit > 0) {
    const shortlist = getShortlistResultByIntent(effectiveIntentId, { profile }) || {};
    const ranking = getRankingResultByIntent(effectiveIntentId, { profile }) || {};
    const buckets = [
      ...(Array.isArray(shortlist.shortlistedItems) ? shortlist.shortlistedItems : []),
      ...(Array.isArray(shortlist.holdItems) ? shortlist.holdItems : []),
      ...(Array.isArray(ranking.rankedItems) ? ranking.rankedItems : [])
    ];
    const listingIds = [];
    const seen = new Set();
    buckets.forEach((item) => {
      const listingId = String(item?.listingId || "").trim();
      if (!listingId || seen.has(listingId)) return;
      seen.add(listingId);
      listingIds.push(listingId);
    });

    const admitTargets = listingIds.slice(0, autoAdmitLimit);
    for (const listingId of admitTargets) {
      try {
        const listing = getCanonicalListingByIntentAndListingId(effectiveIntentId, listingId);
        const listingUrl = String(listing?.sourceUrl || listing?.normalizedUrl || "");
        if (
          listing?.metadata?.isFallback === true ||
          /^fallback_/i.test(String(listing?.sourceJobId || "")) ||
          /applyflow\.local\/fallback/i.test(listingUrl)
        ) {
          continue;
        }
        const admitted = await admitDiscoveryListingWorkflow(effectiveIntentId, listingId, {
          actor: "system",
          overrideReason: "offline_json bootstrap for jobs list visibility",
          allowSkipOverride: true
        });
        if (admitted?.job?.id) {
          admittedJobs.push(admitted.job.id);
        }
      } catch (error) {
        // Best effort: skip blocked or already-admitted listings.
      }
    }
  }

  return {
    ...importResult,
    source: "offline_json",
    batchSummary: batch.selectedSummary,
    leadProcessingResult: storedLeadProcessingResult,
    admissionSummary: {
      autoAdmitEnabled: shouldAutoAdmitForJobs,
      autoAdmitLimit,
      admittedJobsCount: admittedJobs.length
    }
  };
}

function getDiscoveryIntentView(intentId) {
  const intent = getDiscoveryIntent(intentId);
  if (!intent) {
    const error = new Error(`Discovery intent ${intentId} not found.`);
    error.code = "NOT_FOUND";
    throw error;
  }

  const leadProcessingResult = getLeadProcessingResultByIntent(intentId);

  return {
    intent,
    leadResolutionViewModel: buildLeadResolutionViewModel(leadProcessingResult),
    canonicalListings: listCanonicalListingsByIntent(intentId),
    dedupCandidatePool: getDedupCandidatePoolByIntent(intentId),
    batchDecisionResult: getBatchDecisionResultByIntent(intentId, {
      profile: store.getProfile() || {}
    }),
    rankingResult: getRankingResultByIntent(intentId, {
      profile: store.getProfile() || {}
    }),
    shortlistResult: getShortlistResultByIntent(intentId, {
      profile: store.getProfile() || {}
    })
  };
}

module.exports = {
  importJobDraftFromUrl,
  ingestJob,
  evaluateJob,
  generateResumeTailoringOutput,
  saveResumeTailoringOutput,
  prepareJobApplication,
  runExecutionDryRun,
  runBrowserApplySession,
  confirmExecutionRun,
  submitJobApplication,
  saveApplicationPrep,
  transitionJobStatus,
  updateJobTrackerState,
  updateJobFeedbackState,
  updateJobShortlistState,
  updateJobMaterialsPrep,
  updateJobSubmissionAudit,
  updateJobFollowUp,
  saveProfile,
  saveOnboardingProfile,
  saveMasterResume,
  uploadResumeDocument,
  getCurrentResume,
  getMasterResumeView,
  exportJobTailoringDocx,
  exportJobTailoringPdf,
  reflectInterview,
  getJobDetail,
  getJobDetailView,
  getJobWorkspaceList,
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
  isPrepReady,
  createDiscoveryIntentWorkflow,
  importDiscoveryCandidatesWorkflow,
  importDiscoveryFeishuLeadsWorkflow,
  syncDiscoveryFeishuBitableWorkflow,
  importDiscoveryOfflineJsonWorkflow,
  getDiscoveryIntentView,
  admitDiscoveryListingWorkflow,
  attachShortlistAdmissionToJobWorkflow
};

