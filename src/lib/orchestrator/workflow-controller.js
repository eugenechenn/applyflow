const store = require("../../server/store");
const { createId, nowIso } = require("../utils/id");
const {
  assertJobStatusTransition,
  getAllowedNextStatuses,
  getRecommendedNextStatuses
} = require("../state/job-status");
const { updateJob } = require("./shared-state-helpers");
const { logActivity } = require("./activity-logger");
const { agentRegistry } = require("./agent-registry");
const { runAgentStage } = require("./stage-runner");

function summarizeList(items = [], fallback = "none") {
  return items.length ? items.join(" / ") : fallback;
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
    diff.added.forEach((item) => lines.push(`Added ${item} to ${field}.`));
    diff.removed.forEach((item) => lines.push(`Removed ${item} from ${field}.`));
  });

  if ((previous.focusMode || "") !== (next.focusMode || "")) {
    lines.push(`Changed focus mode from ${previous.focusMode || "unset"} to ${next.focusMode}.`);
  }
  if ((previous.riskTolerance || "") !== (next.riskTolerance || "")) {
    lines.push(
      `Changed risk tolerance from ${previous.riskTolerance || "unset"} to ${next.riskTolerance}.`
    );
  }

  return lines;
}

function inferProposalReason(triggerType, diffSummary) {
  if (diffSummary.length > 0) return diffSummary.slice(0, 2).join(" ");
  if (triggerType === "interview_reflection") {
    return "Policy adjusted after new interview feedback updated the success and failure patterns.";
  }
  if (triggerType === "bad_case") {
    return "Policy adjusted after a new bad case changed the risk picture.";
  }
  if (triggerType === "profile_update") {
    return "Policy adjusted because the user changed profile-level strategy controls.";
  }
  return "Policy adjusted after a new system-level strategy refresh.";
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
        ? `Stay concentrated on ${summarizeList(preferredRoles, "top roles")} and avoid distraction patterns.`
        : focusMode === "balanced"
          ? "Keep a balanced pipeline, but continue leaning toward the strongest historical role clusters."
          : "Pipeline is still broad; continue exploring while tightening around the first strong conversion signals.",
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
      summary: "Initialized the first active global policy from profile and historical pipeline signals."
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
    summary: `Approved proposal ${proposal.id}.`
  });
  return applyPolicySnapshot({
    proposalId: proposal.id,
    oldPolicySnapshot: previousPolicy,
    proposedPolicySnapshot: policy,
    actor: "user",
    summary: `Applied policy proposal ${proposal.id}.`
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
      stageLabel: "Job ingestion",
      agentName: "Job Ingestion Agent",
      entityType: "job",
      inputSummary: payload.rawJdText
        ? `Received JD text (${String(payload.rawJdText).length} chars) with manual overrides.`
        : "Received manual job fields without a full JD body."
    },
    () => agentRegistry.jobIngestion(payload)
  );
  const job = ingestionStage.result;
  store.saveJob(job);
  logActivity({
    type: "job_created",
    entityType: "job",
    entityId: job.id,
    action: "job_created",
    summary: `Created ${job.company} / ${job.title}.`,
    jobId: job.id,
    metadata: {
      sourceLabel: job.sourceLabel,
      llm: job.llmMeta || null
    },
    agentName: "Job Ingestion Agent",
    inputSummary: payload.rawJdText
      ? `Received JD text (${String(payload.rawJdText).length} chars) with manual overrides.`
      : "Received manual job fields without a full JD body.",
    outputSummary: `Structured job created with title=${job.title}, company=${job.company}, location=${job.location}${job.llmMeta?.fallbackUsed ? " via heuristic fallback" : " via LLM-assisted extraction"}.`,
    decisionReason:
      "The agent normalized the incoming role into a shared Job object so downstream evaluation can run on consistent fields."
  });
  const evaluation = await evaluateJob(job.id);
  return {
    job: evaluation.job,
    fitAssessment: evaluation.fitAssessment
  };
}

async function importJobDraftFromUrl(payload) {
  const stage = await runAgentStage(
    {
      stageKey: "url_import",
      stageLabel: "URL import",
      agentName: "URL Import Agent",
      entityType: "job",
      inputSummary: `Attempted URL import for ${payload.jobUrl || "unknown url"}.`
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
        label: "URL Import Agent",
        status: stage.status,
        summary: stage.result.stageOutputSummary || null
      },
      {
        key: "job_ingestion",
        label: "Job Ingestion Agent",
        status: "pending",
        summary: "Will run after the user confirms the imported draft."
      },
      {
        key: "fit_evaluation",
        label: "Fit Evaluation Agent",
        status: "pending",
        summary: "Will run automatically after job creation."
      }
    ]
  };
}

async function evaluateJob(jobId) {
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
      stageLabel: "Fit evaluation",
      agentName: "Fit Evaluation Agent",
      entityType: "fit_assessment",
      entityId: job.fitAssessmentId || job.id,
      jobId,
      inputSummary: `Compared role against profile targets: roles=${summarizeList(profile.targetRoles)}, industries=${summarizeList(profile.targetIndustries)}.`
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
    summary: `Generated ${fitAssessment.recommendation} assessment for ${job.company}.`,
    agentName: "Fit Evaluation Agent",
    inputSummary: `Compared role against profile targets: roles=${summarizeList(profile.targetRoles)}, industries=${summarizeList(profile.targetIndustries)}.`,
    outputSummary: `fitScore=${fitAssessment.fitScore}, recommendation=${fitAssessment.recommendation}, strategyDecision=${resolvedDecision}, nextStatus=${resolvedStatus}${fitAssessment.llmMeta?.fallbackUsed ? " via heuristic fallback" : " via LLM-assisted evaluation"}.`,
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

async function prepareJobApplication(jobId) {
  const job = store.getJob(jobId);
  const profile = store.getProfile();

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

  const prepStage = await runAgentStage(
    {
      stageKey: "prep_generation",
      stageLabel: "Prep generation",
      agentName: "Application Prep Agent",
      entityType: "application_prep",
      entityId: job.applicationPrepId || job.id,
      jobId,
      inputSummary: `Generated prep draft from job keywords=${summarizeList(job.jdStructured?.keywords || [])}.`
    },
    () => agentRegistry.applicationPrep({ job, profile })
  );
  const applicationPrep = prepStage.result;
  store.saveApplicationPrep(applicationPrep);

  let updatedJob = updateJob(jobId, () => ({
    applicationPrepId: applicationPrep.id,
    status:
      ["inbox", "archived"].includes(job.status) && ["deprioritize", "avoid"].includes(job.strategyDecision)
        ? "to_prepare"
        : job.status,
    priority: job.priority === "low" ? "medium" : job.priority
  }));

  logActivity({
    type: "prep_saved",
    entityType: "application_prep",
    entityId: applicationPrep.id,
    action: "prep_saved",
    summary: `Saved application prep for ${job.company}.`,
    metadata: {
      jobId,
      checklistCompleted: isPrepReady(applicationPrep),
      llm: applicationPrep.llmMeta || null
    },
    agentName: "Application Prep Agent",
    inputSummary: `Generated prep draft from job keywords=${summarizeList(applicationPrep.resumeTailoring?.targetKeywords || [])}.`,
    outputSummary: `Prep draft includes ${applicationPrep.resumeTailoring?.rewriteBullets?.length || 0} tailored bullets and ${applicationPrep.qaDraft?.length || 0} Q&A prompts${applicationPrep.llmMeta?.fallbackUsed ? " via heuristic fallback" : " via LLM-assisted generation"}.`,
    decisionReason:
      ["deprioritize", "avoid"].includes(job.strategyDecision)
        ? "The user explicitly overrode the strategy policy, so the role was reintroduced into the prep path."
        : job.strategyDecision === "cautious_proceed"
        ? "The strategy layer allows prep, but with explicit caution because the role carries higher narrative or outcome risk."
        : "The prep agent creates a first working draft so the user can review, edit, and keep the final submission inside the human approval boundary.",
    activePolicyVersion: createPolicyVersion(store.getGlobalStrategyPolicy()),
    policyProposalId: store.getGlobalStrategyPolicy()?.appliedProposalId || null,
    overrideApplied: Boolean(job.policyOverride?.active),
    overrideSummary: job.policyOverride?.active
      ? `${job.policyOverride.action}${job.policyOverride.reason ? `: ${job.policyOverride.reason}` : ""}`
      : null
  });

  return { job: updatedJob, applicationPrep };
}

function saveApplicationPrep(jobId, payload) {
  const job = store.getJob(jobId);
  const profile = store.getProfile();
  const existing = store.getApplicationPrepByJobId(jobId);

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
      ? value
      : String(value || "")
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean);

  const rewriteBullets = normalizeLines(payload.tailoredResumeBullets).map((line, index) => ({
    source: existing?.resumeTailoring?.rewriteBullets?.[index]?.source || `Bullet ${index + 1}`,
    rewritten: line
  }));

  const qaDraft = normalizeLines(payload.qaDraft).map((line, index) => {
    const [question, ...answerParts] = line.split("::");
    return {
      question: (question || `Question ${index + 1}`).trim(),
      draftAnswer: (answerParts.join("::") || "").trim()
    };
  });

  const checklist = (payload.checklist || []).map((item, index) => ({
    key: item.key || `check_${index + 1}`,
    label: item.label || `Checklist item ${index + 1}`,
    completed: Boolean(item.completed)
  }));

  const applicationPrep = {
    id: existing?.id || createId("prep"),
    jobId,
    profileId: profile.id,
    version: (existing?.version || 0) + 1,
    resumeTailoring: {
      targetKeywords:
        payload.targetKeywords ||
        existing?.resumeTailoring?.targetKeywords ||
        job.jdStructured?.keywords?.slice(0, 5) ||
        [],
      rewriteBullets
    },
    selfIntro: {
      short: payload.selfIntroShort || existing?.selfIntro?.short || "",
      medium: payload.selfIntroMedium || existing?.selfIntro?.medium || ""
    },
    tailoredSummary: payload.tailoredSummary || existing?.tailoredSummary || "",
    whyMe: payload.whyMe || existing?.whyMe || "",
    qaDraft,
    talkingPoints: normalizeLines(payload.talkingPoints || existing?.talkingPoints || []),
    coverNote: payload.coverNote || "",
    outreachNote: payload.outreachNote || existing?.outreachNote || "",
    checklist,
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso()
  };

  store.saveApplicationPrep(applicationPrep);
  const updatedJob = updateJob(jobId, () => ({
    applicationPrepId: applicationPrep.id
  }));

  logActivity({
    type: "prep_saved",
    entityType: "application_prep",
    entityId: applicationPrep.id,
    action: "prep_saved",
    actor: "user",
    jobId,
    summary: `Saved editable prep for ${job.company}.`,
    agentName: "Application Prep Agent",
    inputSummary: `User updated prep fields and ${checklist.filter((item) => item.completed).length}/${checklist.length} checklist items are complete.`,
    outputSummary: `Prep version ${applicationPrep.version} saved with prepReady=${isPrepReady(applicationPrep)} and ${applicationPrep.talkingPoints?.length || 0} talking points.`,
    decisionReason:
      "The system preserves user-edited application materials as shared state so the pipeline can safely decide when the role is ready to apply.",
    activePolicyVersion: createPolicyVersion(store.getGlobalStrategyPolicy()),
    policyProposalId: store.getGlobalStrategyPolicy()?.appliedProposalId || null,
    overrideApplied: Boolean(job.policyOverride?.active),
    overrideSummary: job.policyOverride?.active
      ? `${job.policyOverride.action}${job.policyOverride.reason ? `: ${job.policyOverride.reason}` : ""}`
      : null
  });

  return {
    job: updatedJob,
    applicationPrep,
    prepReady: isPrepReady(applicationPrep)
  };
}

function isPrepReady(applicationPrep) {
  const requiredKeys = ["resume_reviewed", "intro_ready", "qa_ready"];
  const doneKeys = new Set(
    (applicationPrep.checklist || [])
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
      const error = new Error(
        "Cannot move to ready_to_apply until prep core checklist is completed."
      );
      error.code = "PREP_NOT_READY";
      error.details = { jobId, requiredChecklist: ["resume_reviewed", "intro_ready", "qa_ready"] };
      throw error;
    }
  }

  const updatedJob = updateJob(jobId, () => ({
    status: nextStatus
  }));

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

  if (nextTask) {
    store.saveTask(nextTask);
  }

  logActivity({
    type: "job_status_changed",
    entityType: "job",
    entityId: jobId,
    action: "job_status_changed",
    actor: options.actor || "user",
    jobId,
    summary: `Moved ${updatedJob.company} to ${nextStatus}.`,
    metadata: { currentStatus: job.status, nextStatus },
    agentName: "Pipeline Manager Agent",
    inputSummary: `Requested status transition from ${job.status} to ${nextStatus}.`,
    outputSummary: nextTask
      ? `Status updated to ${nextStatus}; created follow-up task ${nextTask.title}.`
      : `Status updated to ${nextStatus}; no follow-up task generated.`,
    decisionReason:
      nextStatus === "ready_to_apply"
        ? "The transition was allowed only after the core prep checklist was complete."
        : "The transition followed the job lifecycle state machine and updated shared pipeline state.",
    policyInfluenceSummary: `Pipeline executed this transition under focusMode=${globalPolicy.focusMode} with riskTolerance=${globalPolicy.riskTolerance}.`,
    activePolicyVersion: createPolicyVersion(globalPolicy),
    policyProposalId: globalPolicy.appliedProposalId || null,
    overrideApplied: Boolean(updatedJob.policyOverride?.active),
    overrideSummary: updatedJob.policyOverride?.active
      ? `${updatedJob.policyOverride.action}${updatedJob.policyOverride.reason ? `: ${updatedJob.policyOverride.reason}` : ""}`
      : null
  });

  const strategyProfile = refreshStrategyProfile();
  refreshGlobalStrategyPolicy(strategyProfile, {
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
    preferredLocations: csvToArray(
      payload.targetLocations ?? payload.preferredLocations ?? current?.preferredLocations ?? []
    ),
    targetLocations: csvToArray(
      payload.targetLocations ?? payload.preferredLocations ?? current?.targetLocations ?? []
    ),
    strengths: csvToArray(payload.strengths ?? current?.strengths ?? []),
    constraints: csvToArray(payload.constraints ?? current?.constraints ?? []),
    baseResume: payload.masterResume || payload.baseResume || current?.baseResume || "",
    masterResume: payload.masterResume || payload.baseResume || current?.masterResume || "",
    policyPreferences: {
      manualPreferredRoles: csvToArray(
        payload.manualPreferredRoles ?? current?.policyPreferences?.manualPreferredRoles ?? []
      ),
      ignoredRiskyRoles: csvToArray(
        payload.ignoredRiskyRoles ?? current?.policyPreferences?.ignoredRiskyRoles ?? []
      ),
      riskToleranceOverride:
        payload.riskToleranceOverride ||
        current?.policyPreferences?.riskToleranceOverride ||
        ""
    },
    summary:
      payload.background ||
      payload.summary ||
      current?.summary ||
      payload.headline ||
      "",
    createdAt: current?.createdAt || nowIso(),
    updatedAt: nowIso()
  };

  store.saveProfile(profile);
  if (
    JSON.stringify(current?.policyPreferences || {}) !== JSON.stringify(profile.policyPreferences || {})
  ) {
    logPolicyAudit({
      eventType: "user_override_applied",
      actor: "user",
      summary: "Updated profile-level policy overrides."
    });
  }
  const strategyProfile = refreshStrategyProfile();
  const globalPolicy = refreshGlobalStrategyPolicy(strategyProfile, {
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
    summary: `Saved profile for ${profile.fullName || "candidate"}.`,
    inputSummary: `Profile updated with targetRoles=${summarizeList(profile.targetRoles)}, targetIndustries=${summarizeList(profile.targetIndustries)}.`,
    outputSummary: `Profile now records ${profile.yearsOfExperience} years experience and ${profile.strengths.length} strengths.`,
    decisionReason: "The profile is the long-lived source of truth used by ingestion, evaluation, and prep.",
    policyInfluenceSummary: `Global policy refreshed with focusMode=${globalPolicy.focusMode} and riskTolerance=${globalPolicy.riskTolerance}.`
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
  const updatedJob = updateJob(payload.jobId, () => ({
    latestInterviewReflectionId: reflection.id,
    latestFailureReasons: reflection.failureReasons || [],
    latestSuccessSignals: reflection.successSignals || [],
    latestSkillGaps: reflection.skillGaps || []
  }));

  if (profile) {
    store.saveProfile({
      ...profile,
      learnedStrengths: [
        ...new Set([...(profile.learnedStrengths || []), ...(reflection.successSignals || [])])
      ].slice(0, 8),
      learnedSkillGaps: [
        ...new Set([...(profile.learnedSkillGaps || []), ...(reflection.skillGaps || [])])
      ].slice(0, 8),
      successSignals: [
        ...new Set([...(profile.successSignals || []), ...(reflection.successSignals || [])])
      ].slice(0, 8),
      updatedAt: nowIso()
    });
  }

  const strategyProfile = refreshStrategyProfile();
  const globalPolicy = refreshGlobalStrategyPolicy(strategyProfile, {
    reason: "interview_reflection",
    triggerType: "interview_reflection",
    triggerSource: "interview_reflection"
  });

  logActivity({
    type: "interview_reflected",
    entityType: "interview_reflection",
    entityId: reflection.id,
    action: "interview_reflected",
    summary: `Logged interview reflection for ${job.company}.`,
    metadata: { jobId: job.id, skillGaps: reflection.skillGaps || [] },
    agentName: "Interview Reflection Agent",
    inputSummary: `Interview notes captured for ${updatedJob.title}.`,
    outputSummary: `Captured ${reflection.successSignals?.length || 0} success signals and ${reflection.skillGaps?.length || 0} skill gaps.`,
    decisionReason: `This reflection now updates future scoring biases and strategy advice. Strategy profile refreshed at ${strategyProfile.updatedAt}; global policy refreshed at ${globalPolicy.updatedAt}.`
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
  const fitAssessment = store.getFitAssessmentByJobId(jobId)
    ? {
        ...store.getFitAssessmentByJobId(jobId),
        overrideApplied: Boolean(job.policyOverride?.active) || store.getFitAssessmentByJobId(jobId).overrideApplied,
        overrideSummary: job.policyOverride?.active
          ? `${job.policyOverride.action}${job.policyOverride.reason ? `: ${job.policyOverride.reason}` : ""}`
          : store.getFitAssessmentByJobId(jobId).overrideSummary || null
      }
    : null;
  const globalPolicy =
    store.getGlobalStrategyPolicy() ||
    refreshGlobalStrategyPolicy(store.getStrategyProfile() || refreshStrategyProfile(), {
      reason: "job_detail_view",
      triggerType: "system_refresh",
      triggerSource: "ui"
    });

  return {
    job,
    fitAssessment,
    applicationPrep: store.getApplicationPrepByJobId(jobId) || null,
    tasks: store.listTasksByJobId(jobId),
    activityLogs,
    interviewReflection: store.getInterviewReflectionByJobId(jobId) || null,
    badCase: store.getBadCaseByJobId(jobId) || null,
    globalPolicy,
    policyExplanation: buildJobPolicyExplanation(job, fitAssessment, globalPolicy),
    pipelineStages: buildJobPipelineStages({
      job,
      fitAssessment,
      applicationPrep: store.getApplicationPrepByJobId(jobId) || null,
      activityLogs
    }),
    policyProposals: listPolicyProposals().slice(0, 3),
    policyAuditLogs: listPolicyAuditHistory().slice(0, 5),
    nextAction: getJobNextAction(job),
    allowedNextStatuses: getAllowedNextStatuses(job.status),
    recommendedNextStatuses: getRecommendedNextStatuses(job.status)
  };
}

function buildJobPolicyExplanation(job, fitAssessment, globalPolicy) {
  const explanation = [];
  if (!fitAssessment) return explanation;

  explanation.push(`Strategy decision: ${fitAssessment.strategyDecision}.`);

  if (fitAssessment.policyInfluenceSummary) {
    explanation.push(fitAssessment.policyInfluenceSummary);
  }

  if (fitAssessment.historyInfluenceSummary) {
    explanation.push(fitAssessment.historyInfluenceSummary);
  }

  if (job.status === "archived" && fitAssessment.strategyDecision === "avoid") {
    explanation.push("The role was archived by default because current policy and historical evidence both indicate low expected leverage.");
  }

  if (job.priority === "high" && globalPolicy.focusMode === "focused") {
    explanation.push("This job is elevated because it fits the current focused pipeline strategy.");
  }

  if (job.strategyDecision === "deprioritize") {
    explanation.push("The system kept this job out of the active prep queue, but you can still override that manually.");
  }

  if (job.policyOverride?.active) {
    explanation.push(
      `A user override is active (${job.policyOverride.action})${job.policyOverride.reason ? `: ${job.policyOverride.reason}` : "."}`
    );
  }

  return explanation;
}

function buildJobPipelineStages({ job, fitAssessment, applicationPrep, activityLogs }) {
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
      "URL Import Agent",
      urlImportStatus,
      job.source === "url" ? "The job entered ApplyFlow through a URL-first intake path." : "This job was created manually."
    ),
    stageFor(
      "job_ingestion",
      "Job Ingestion Agent",
      job.id ? "completed" : "pending",
      job.id ? "The raw input was normalized into the shared Job object." : "Waiting to create the shared job object."
    ),
    stageFor(
      "fit_evaluation",
      "Fit Evaluation Agent",
      fitAssessment ? "completed" : "pending",
      fitAssessment ? `Generated a ${fitAssessment.recommendation} recommendation with score ${fitAssessment.fitScore}.` : "Waiting to generate the structured fit assessment."
    ),
    stageFor(
      "prep_generation",
      "Prep Generation Agent",
      applicationPrep ? "completed" : job.status === "to_prepare" ? "ready" : "pending",
      applicationPrep
        ? `Generated the prep pack with ${applicationPrep.resumeTailoring?.rewriteBullets?.length || 0} tailored bullets.`
        : "Prep can run once the user chooses to create or refine the application pack."
    ),
    {
      key: "pipeline_manager",
      label: "Pipeline Manager Agent",
      status: job.status === "archived" ? "completed" : "active",
      summary: `The pipeline manager currently holds this role at ${job.status} with priority ${job.priority}.`,
      timestamp: job.updatedAt
    }
  ];
}

function getJobNextAction(job) {
  const prep = store.getApplicationPrepByJobId(job.id);
  const fit = store.getFitAssessmentByJobId(job.id);
  const globalPolicy = store.getGlobalStrategyPolicy() || refreshGlobalStrategyPolicy();

  if (job.strategyDecision === "deprioritize" && job.status === "inbox") {
    return {
      tone: "warning",
      title:
        globalPolicy.focusMode === "focused"
          ? "This role is deprioritized under the current focus policy"
          : "This role is currently deprioritized",
      description:
        fit?.strategyReasoning ||
        (globalPolicy.focusMode === "focused"
          ? "The global policy is concentrating effort on a narrower set of roles, so this job is held outside the active prep queue unless you override it."
          : "The strategy layer kept this role out of the active prep queue. Only continue if you want to override the backlog decision."),
      ctaLabel: "Override and prep",
      ctaType: "prepare"
    };
  }

  if (job.status === "archived") {
    return {
      tone: "warning",
      title: "This role is not recommended for active pursuit",
      description:
        fit?.strategyDecision === "avoid"
          ? "The strategy policy marked this role as avoid. Keep it archived unless you explicitly want to override the decision."
          : "This role has been archived from the active pipeline.",
      ctaLabel: fit?.strategyDecision === "avoid" ? "Override and prep" : "Review archived rationale",
      ctaType: fit?.strategyDecision === "avoid" ? "prepare" : "none"
    };
  }

  if (job.status === "evaluating") {
    return {
      tone: "primary",
      title: "Complete the fit evaluation",
      description: "Run the evaluation so the system can decide whether this role is worth preparing for.",
      ctaLabel: "Run evaluation",
      ctaType: "evaluate"
    };
  }

  if (job.status === "to_prepare") {
    if (!prep) {
      return {
        tone: job.strategyDecision === "cautious_proceed" ? "warning" : "primary",
        title:
          job.strategyDecision === "cautious_proceed"
            ? "Prepare carefully with the key risks in mind"
            : "Create the first prep draft",
        description:
          job.strategyDecision === "cautious_proceed"
            ? `Move forward carefully. Watch these risks: ${(fit?.riskFlags || []).slice(0, 2).join(" / ") || "review the fit assessment."}`
            : globalPolicy.focusMode === "focused" && job.priority === "high"
              ? "This role matches the current global focus. Generate tailored application materials now to keep momentum."
              : "Generate tailored application materials before deciding whether to invest further.",
        ctaLabel: "Generate prep draft",
        ctaType: "prepare"
      };
    }

    const missing = (prep.checklist || [])
      .filter((item) => !item.completed && ["resume_reviewed", "intro_ready", "qa_ready"].includes(item.key))
      .map((item) => item.label);

    return {
      tone: missing.length === 0 ? "primary" : "warning",
      title: missing.length === 0 ? "Mark prep as complete" : "Finish the prep checklist",
      description:
        missing.length === 0
          ? "Core prep items are complete. You can now move this role to ready_to_apply."
          : `Complete these core items first: ${missing.join(" / ")}.`,
      ctaLabel: "Open Prep",
      ctaType: "open_prep"
    };
  }

  if (job.status === "ready_to_apply") {
    return {
      tone: "primary",
      title:
        globalPolicy.focusMode === "focused" && job.priority === "high"
          ? "High-priority role is ready to submit"
          : "Confirm the application has been submitted",
      description:
        globalPolicy.focusMode === "focused" && job.priority === "high"
          ? "This role is on-policy and fully prepped. After you apply outside the system, mark it as applied here to keep the focused pipeline moving."
          : "This role is ready. After you apply outside the system, mark it as applied here.",
      ctaLabel: "Mark as applied",
      ctaType: "status",
      nextStatus: "applied"
    };
  }

  if (job.status === "applied") {
    return {
      tone: "primary",
      title: "Move the role into follow-up",
      description: "Track the response window and prepare your next checkpoint.",
      ctaLabel: "Start follow-up",
      ctaType: "status",
      nextStatus: "follow_up"
    };
  }

  if (job.status === "follow_up") {
    return {
      tone: "warning",
      title: "Wait for response or mark interview progress",
      description: "If the company replies, move this role into interviewing. Otherwise keep tracking the follow-up window.",
      ctaLabel: "Mark interviewing",
      ctaType: "status",
      nextStatus: "interviewing"
    };
  }

  if (job.status === "interviewing") {
    return {
      tone: "primary",
      title: "Capture the interview outcome",
      description: "Once the process moves forward, update the role to offer or rejected.",
      ctaLabel: "Log next outcome",
      ctaType: "none"
    };
  }

  return {
    tone: "neutral",
    title: "Review this role",
    description: "Open the latest details and decide the next manual action.",
    ctaLabel: "Open detail",
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
    summary: `Approved policy proposal ${proposalId}.`
  });

  const appliedPolicy = applyPolicySnapshot({
    proposalId,
    oldPolicySnapshot: proposal.oldPolicySnapshot,
    proposedPolicySnapshot: proposal.proposedPolicySnapshot,
    actor: "user",
    summary: `Applied policy proposal ${proposalId}.`
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
    summary: `Rejected policy proposal ${proposalId}.`
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
    summary: "Reverted to the previous active policy snapshot."
  });

  store.savePolicyHistoryEntry({
    id: createId("policyhist"),
    proposalId: null,
    previousPolicySnapshot: currentPolicy,
    nextPolicySnapshot: revertedPolicy,
    summary: "Recorded explicit policy revert action.",
    createdAt: nowIso(),
    revertedAt: nowIso()
  });
  logPolicyAudit({
    eventType: "policy_reverted",
    actor: "user",
    relatedProposalId: null,
    summary: `Reverted active policy from ${createPolicyVersion(currentPolicy)} to ${createPolicyVersion(
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
    summary: `Applied ${action} override to ${job.company} / ${job.title}.`
  });
  logActivity({
    type: "job_override_applied",
    entityType: "job",
    entityId: jobId,
    action: "job_override_applied",
    actor: "user",
    jobId,
    summary: `Applied ${action} override to ${job.company}.`,
    decisionReason: "The user explicitly overrode the current policy-driven job handling.",
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
    recommendations.push(`You convert best in ${topRole} roles, so keep them in the active pipeline and prep queue.`);
  }
  if (weakRole) {
    recommendations.push(`Reduce ${weakRole} submissions because they cluster in failures or bad cases.`);
  }
  if (strategyProfile.learnedFromInterviews?.length) {
    recommendations.push(`Priority capability gap: ${strategyProfile.learnedFromInterviews[0]}.`);
  }
  if (recommendations.length === 0) {
    recommendations.push("Pipeline is still too small for strong biasing; keep exploring but log outcomes consistently.");
  }
  recommendations.unshift(
    globalPolicy.focusMode === "focused"
      ? `Stay focused on ${summarizeList(globalPolicy.preferredRoles || globalPolicy.targetRolesPriority || [], "core roles")} and keep lower-signal roles out of the prep queue.`
      : globalPolicy.focusMode === "exploratory"
        ? "Pipeline is still broad. Narrow the next wave of applications toward the first role cluster that reaches interviews."
        : "Pipeline is reasonably balanced. Keep prioritizing the best-converting role clusters."
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
      summary: `Removed bad case flag for ${job.company}.`,
      agentName: "Feedback Loop",
      inputSummary: "User cleared the bad case marker.",
      outputSummary: "Job is no longer tracked as a bad case.",
      decisionReason: "This keeps the failure library aligned with the user's latest judgement."
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
    summary: `Marked ${job.company} as a bad case.`,
    agentName: "Feedback Loop",
    inputSummary: payload.issueDescription
      ? `User flagged this job with note: ${payload.issueDescription}`
      : "User flagged this job as a bad case.",
    outputSummary: `Bad case library now contains a replayable record for ${job.company}.`,
    decisionReason:
      "Bad cases preserve failed or misleading decisions so future evaluations can be audited and improved."
  });

  return badCase;
}

function listBadCases() {
  return store
    .listBadCases()
    .slice()
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

module.exports = {
  importJobDraftFromUrl,
  ingestJob,
  evaluateJob,
  prepareJobApplication,
  saveApplicationPrep,
  transitionJobStatus,
  saveProfile,
  reflectInterview,
  getJobDetail,
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
