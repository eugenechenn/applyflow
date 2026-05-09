"use strict";

const {
  cleanLine,
  uniqueLines,
  hasFallbackText
} = require("../contracts/canonical-resume-contracts");
const { buildCanonicalResumeFromResumeDocument } = require("./legacy-resume-adapter");

function asText(value = "", max = 220) {
  const text = cleanLine(value, max);
  if (!text || hasFallbackText(text)) return "";
  return text;
}

function asTextList(items = [], max = 8, perItemMax = 220) {
  return uniqueLines(Array.isArray(items) ? items : [], max, perItemMax);
}

function extractFeedbackTraces(activityLogs = []) {
  return (Array.isArray(activityLogs) ? activityLogs : [])
    .map((item) => item?.metadata?.feedbackTrace || null)
    .filter((trace) => trace && typeof trace === "object")
    .sort((left, right) => new Date(right.recordedAt || 0) - new Date(left.recordedAt || 0));
}

function buildResumeViewModel(resumeDocument = null) {
  const canonical = buildCanonicalResumeFromResumeDocument(resumeDocument);
  const parseStatus = String(resumeDocument?.parseStatus || resumeDocument?.status || "missing").trim();
  const parseQuality = String(resumeDocument?.parseQuality?.label || "low").trim();
  const parseScore = Number(resumeDocument?.parseQuality?.score ?? 0);
  const summary = asText(canonical.selfSummary || "", 220);

  return {
    resumeId: resumeDocument?.id || "",
    fileName: asText(resumeDocument?.fileName || "未上传原始简历", 160),
    parseStatus,
    parseQuality,
    parseQualityScore: Number.isFinite(parseScore) ? parseScore : 0,
    resumeSummary: summary || "暂无可展示简历摘要。",
    highlights: asTextList(canonical.skills || [], 10, 80),
    sections: {
      workExperience: (Array.isArray(canonical.workExperience) ? canonical.workExperience : []).map((entry) =>
        asText([entry.company, entry.role, entry.timeRange].filter(Boolean).join(" / "), 180)
      ).filter(Boolean),
      projectExperience: (Array.isArray(canonical.projectExperience) ? canonical.projectExperience : []).map((entry) =>
        asText([entry.projectName, entry.role, entry.timeRange].filter(Boolean).join(" / "), 180)
      ).filter(Boolean),
      skills: asTextList(canonical.skills || [], 12, 80)
    },
    warnings: asTextList([resumeDocument?.parseWarning || ""], 4, 220),
    uploadedAt: resumeDocument?.updatedAt || resumeDocument?.createdAt || null
  };
}

function buildFeedbackTimelineView(feedbackTraces = []) {
  return (Array.isArray(feedbackTraces) ? feedbackTraces : [])
    .map((trace) => ({
      traceId: asText(trace.trace?.traceId || "", 80),
      eventType: asText(trace.eventType || "", 60),
      outcome: asText(trace.outcome || "", 40),
      timestamp: trace.recordedAt || null,
      summary: asText(
        trace.failureReason ||
          trace.executionSnapshot?.details ||
          trace.notes ||
          `${trace.eventType || "feedback"}: ${trace.outcome || "observed"}`,
        320
      ),
      actor: asText(trace.actor || "system", 40),
      failureReason: asText(trace.failureReason || "", 300),
      decision: {
        recommendation: asText(trace.decisionSnapshot?.recommendation || "", 40),
        nextAction: asText(trace.decisionSnapshot?.nextAction || "", 40),
        risks: asTextList(trace.decisionSnapshot?.risks || [], 6, 180)
      },
      control: {
        status: asText(trace.controlSnapshot?.status || "", 40),
        blockingIssues: asTextList(trace.controlSnapshot?.blockingIssues || [], 6, 180),
        requiredActions: asTextList(trace.controlSnapshot?.requiredActions || [], 6, 180)
      },
      execution: {
        stage: asText(trace.executionSnapshot?.stage || "", 40),
        status: asText(trace.executionSnapshot?.status || "", 40)
      }
    }))
    .filter((item) => item.eventType)
    .sort((left, right) => new Date(right.timestamp || 0) - new Date(left.timestamp || 0));
}

function buildExecutionSessionView({
  executionDto = null,
  submitContract = null,
  feedbackTraces = [],
  controlGateResult = null
} = {}) {
  const traces = Array.isArray(feedbackTraces) ? feedbackTraces : [];
  const runId =
    asText(executionDto?.runId || "", 120) ||
    asText(submitContract?.runId || "", 120) ||
    asText(traces[0]?.trace?.runId || "", 120);

  const scopedTraces = runId
    ? traces.filter((trace) => asText(trace?.trace?.runId || "", 120) === runId)
    : traces;
  const latestTrace = scopedTraces[0] || traces[0] || null;

  const stageMapping = [
    { key: "dry_run", eventTypes: ["execution_dry_run"] },
    { key: "human_confirm", eventTypes: ["execution_confirmed"] },
    { key: "submit", eventTypes: ["execution_submitted", "execution_failed", "execution_blocked"] }
  ];

  const stageTimeline = stageMapping.map((stage) => {
    const trace = scopedTraces.find((item) => stage.eventTypes.includes(String(item?.eventType || ""))) || null;
    return {
      stage: stage.key,
      eventType: asText(trace?.eventType || "", 60),
      outcome: asText(trace?.outcome || "", 40),
      status: asText(trace?.executionSnapshot?.status || "", 40) || (trace ? "completed" : "pending"),
      timestamp: trace?.recordedAt || null
    };
  });

  const gateStatus =
    asText(executionDto?.gateSnapshot?.status || "", 40) ||
    asText(controlGateResult?.status || "", 40) ||
    asText(latestTrace?.controlSnapshot?.status || "", 40) ||
    "needs_human_review";
  const requiredActions =
    asTextList(executionDto?.gateSnapshot?.requiredActions || [], 8, 220).length > 0
      ? asTextList(executionDto?.gateSnapshot?.requiredActions || [], 8, 220)
      : asTextList(latestTrace?.controlSnapshot?.requiredActions || [], 8, 220);
  const failureReason = asText(
    submitContract?.failureReason ||
      latestTrace?.failureReason ||
      "",
    320
  );
  const submitOutcome =
    asText(submitContract?.outcome || "", 40) ||
    asText(stageTimeline.find((item) => item.stage === "submit")?.outcome || "", 40) ||
    "pending";
  const confirmState =
    asText(executionDto?.confirmState?.state || "", 40) ||
    asText(submitContract?.confirmState || "", 40) ||
    "pending";

  return {
    runId,
    gateStatus,
    confirmState,
    confirmRequired: Boolean(executionDto?.confirmState?.required),
    confirmToken: asText(executionDto?.confirmState?.confirmToken || "", 120),
    submitOutcome,
    latestEventType: asText(latestTrace?.eventType || "", 60),
    failureReason,
    requiredActions,
    stageTimeline,
    updatedAt: latestTrace?.recordedAt || executionDto?.updatedAt || submitContract?.submittedAt || null
  };
}

function buildTailoringWorkspaceViewModel({
  job = {},
  workspace = {},
  tailoringOutput = null,
  tailoredResumeContract = null
} = {}) {
  const safeWorkspace = workspace && typeof workspace === "object" ? workspace : {};
  const safeTailoring = tailoringOutput && typeof tailoringOutput === "object" ? tailoringOutput : {};
  const safeTailoredResume = tailoredResumeContract && typeof tailoredResumeContract === "object" ? tailoredResumeContract : {};
  const sectionDiffs = Array.isArray(safeTailoredResume.sectionDiffs) ? safeTailoredResume.sectionDiffs : [];

  return {
    tailoredResumeId: asText(safeTailoredResume.tailoredResumeId || "", 80),
    workspaceId: asText(safeWorkspace.id || "", 80) || `workspace_${job.id || "job"}`,
    workspaceName: asText(safeWorkspace.name || "", 120),
    activeVersion: Number(safeWorkspace.activeVersion || 1),
    updatedAt: safeWorkspace.updatedAt || null,
    helpNote: asText(
      safeWorkspace.helpNote ||
        "左侧是原始简历标准化实体，右侧是当前岗位定制版；确认后再进入申请准备。",
      220
    ),
    hasTailoringOutput: Boolean(tailoringOutput),
    jobSummary: safeWorkspace.jobSummary || {
      roleSummary: "",
      coreResponsibilities: [],
      coreRequirements: [],
      targetKeywords: [],
      riskNotes: [],
      weakSignalNote: ""
    },
    baseResume: safeWorkspace.baseResumeAsset || {
      workExperience: [],
      projectExperience: [],
      selfSummary: ""
    },
    tailoredResume: safeWorkspace.tailoredResume || {
      workExperience: [],
      projectExperience: [],
      selfEvaluation: "",
      lengthBudget: { status: "within_budget", totalChars: 0, totalBullets: 0, notes: [] }
    },
    insights: safeWorkspace.insights || {
      headline: "",
      strongestMatch: "",
      biggestGap: "",
      nextEditFocus: ""
    },
    reviewSummary: safeWorkspace.reviewSummary || { acceptedCount: 0, pendingCount: 0, rejectedCount: 0 },
    reviewModules: Array.isArray(safeWorkspace.reviewModules) ? safeWorkspace.reviewModules : [],
    changeReasons: asTextList(safeTailoredResume.changeReasons || safeTailoring.tailoringExplainability || [], 10, 220),
    sectionDiffs: sectionDiffs.map((item) => ({
      diffId: asText(item.diffId || "", 80),
      sectionKey: asText(item.sectionKey || "", 60),
      before: asText(item.before || "", 320),
      after: asText(item.after || "", 320),
      reason: asText(item.reason || "", 220),
      status: asText(item.status || "accepted", 40) || "accepted"
    })),
    diffSummary: {
      changedBulletCount: Number(sectionDiffs.length || 0),
      reorderedSections: asTextList(safeTailoredResume.generatedSections || [], 8, 80)
    },
    warnings: asTextList(
      [
        safeTailoredResume.exportStatus?.status === "failed" ? "导出状态失败，请重新生成后再尝试。" : "",
        safeWorkspace.tailoringWarning || ""
      ],
      4,
      220
    )
  };
}

function buildTailoringWorkspaceEditDto({
  job = {},
  workspace = {},
  tailoringOutput = null
} = {}) {
  const safeWorkspace = workspace && typeof workspace === "object" ? workspace : {};
  const safeTailoring = tailoringOutput && typeof tailoringOutput === "object" ? tailoringOutput : {};
  const workspaceDraft = safeTailoring.workspaceDraft && typeof safeTailoring.workspaceDraft === "object"
    ? safeTailoring.workspaceDraft
    : { workExperience: [], projectExperience: [], selfEvaluation: "" };

  return {
    jobId: job.id || "",
    workspaceName: asText(safeWorkspace.name || "", 120),
    lastRefinePrompt: asText(safeWorkspace.lastRefinePrompt || "", 500),
    tailoredSummary: asText(safeTailoring.tailoredSummary || workspaceDraft.selfEvaluation || "", 220),
    workspaceDraft: {
      workExperience: Array.isArray(workspaceDraft.workExperience) ? workspaceDraft.workExperience : [],
      projectExperience: Array.isArray(workspaceDraft.projectExperience) ? workspaceDraft.projectExperience : [],
      selfEvaluation: asText(workspaceDraft.selfEvaluation || "", 220)
    }
  };
}

function deriveExecutionView(job = {}, controlView = {}, decisionView = {}) {
  const gateStatus = controlView.gateStatus;
  const requiresHumanReview = gateStatus === "needs_human_review";
  const blocked = gateStatus === "blocked";

  const canPrepare = !blocked && !requiresHumanReview;
  const canSubmit =
    !blocked &&
    !requiresHumanReview &&
    ["ready_to_apply", "applied"].includes(String(job.status || "").trim()) &&
    decisionView.nextAction === "apply";

  return {
    canPrepare,
    canSubmit,
    requiresHumanReview
  };
}

function validateJobWorkspaceViewModel(viewModel = {}) {
  const errors = [];
  if (!viewModel || typeof viewModel !== "object") errors.push("viewModel must be an object");

  if (!viewModel.jobSummary || typeof viewModel.jobSummary !== "object") {
    errors.push("jobSummary is required");
  }

  const decisionView = viewModel.decisionView || {};
  const controlView = viewModel.controlView || {};
  const feedbackView = viewModel.feedbackView || {};
  const executionView = viewModel.executionView || {};

  if (!Array.isArray(decisionView.evidence)) errors.push("decisionView.evidence must be an array");
  if (!Array.isArray(decisionView.gaps)) errors.push("decisionView.gaps must be an array");
  if (!Array.isArray(decisionView.risks)) errors.push("decisionView.risks must be an array");

  if (!Array.isArray(controlView.reasons)) errors.push("controlView.reasons must be an array");
  if (!Array.isArray(controlView.blockingIssues)) errors.push("controlView.blockingIssues must be an array");
  if (!Array.isArray(controlView.requiredActions)) errors.push("controlView.requiredActions must be an array");

  [
    feedbackView.latestFailureReason,
    decisionView.rationale,
    decisionView.summary
  ].forEach((text) => {
    if (hasFallbackText(String(text || ""))) {
      errors.push("viewModel contains fallback text");
    }
  });

  ["canPrepare", "canSubmit", "requiresHumanReview"].forEach((key) => {
    if (typeof executionView[key] !== "boolean") {
      errors.push(`executionView.${key} must be a boolean`);
    }
  });

  return { ok: errors.length === 0, errors };
}

function buildJobWorkspaceViewModel({
  job = {},
  jobDecision = null,
  controlGateResult = null,
  feedbackTraces = []
} = {}) {
  const latestFeedback = (Array.isArray(feedbackTraces) ? feedbackTraces : [])[0] || null;

  const decisionView = {
    recommendation: asText(jobDecision?.recommendation || "", 40) || "cautious",
    rationale: asText(jobDecision?.rationale || "", 500),
    summary: asText(jobDecision?.rationale || "", 240),
    evidence: asTextList(jobDecision?.evidence || [], 8, 220),
    gaps: asTextList(jobDecision?.gaps || [], 8, 220),
    risks: asTextList(jobDecision?.risks || [], 8, 220),
    nextAction: asText(jobDecision?.nextAction || "", 40) || "hold",
    fitScore: Number.isFinite(Number(jobDecision?.fitScore)) ? Number(jobDecision.fitScore) : null
  };

  const controlView = {
    gateStatus: asText(controlGateResult?.status || "", 40) || "needs_human_review",
    reasons: asTextList(controlGateResult?.reasons || [], 8, 220),
    blockingIssues: asTextList(controlGateResult?.blockingIssues || [], 8, 220),
    requiredActions: asTextList(controlGateResult?.requiredActions || [], 8, 220)
  };

  const feedbackView = {
    latestOutcome: asText(latestFeedback?.outcome || "", 40) || "observed",
    latestEventType: asText(latestFeedback?.eventType || "", 60) || "decision_generated",
    latestFailureReason: asText(latestFeedback?.failureReason || "", 300),
    lastUpdatedAt: latestFeedback?.recordedAt || job.updatedAt || null,
    hasUserOverride: Boolean(latestFeedback?.userOverride?.applied) || Boolean(job.policyOverride?.active)
  };

  const viewModel = {
    id: job.id || "",
    jobSummary: {
      title: asText(job.title || "", 240),
      company: asText(job.company || "", 120),
      location: asText(job.location || "", 120),
      sourceUrl: asText(job.jobUrl || job.sourceUrl || "", 400),
      status: asText(job.status || "", 40) || "inbox"
    },
    decisionView,
    controlView,
    feedbackView,
    executionView: deriveExecutionView(job, controlView, decisionView)
  };

  const validation = validateJobWorkspaceViewModel(viewModel);
  if (!validation.ok) {
    const error = new Error(`Invalid JobWorkspaceViewModel: ${validation.errors.join("; ")}`);
    error.code = "INVALID_JOB_WORKSPACE_VIEW_MODEL";
    error.details = { errors: validation.errors, viewModel };
    throw error;
  }

  return viewModel;
}

module.exports = {
  buildJobWorkspaceViewModel,
  validateJobWorkspaceViewModel,
  extractFeedbackTraces,
  buildResumeViewModel,
  buildFeedbackTimelineView,
  buildExecutionSessionView,
  buildTailoringWorkspaceViewModel,
  buildTailoringWorkspaceEditDto
};
