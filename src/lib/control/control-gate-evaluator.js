"use strict";

const {
  createControlContract,
  validateControlContract
} = require("../contracts/agent-governance-contracts");

const HIGH_RISK_PATTERN = /高风险|high[\s_-]?risk|违规|compliance|法律|legal|签证|visa|background check/i;
const MISSING_INFO_PATTERN = /信息不全|信息不足|待补充|missing|unknown|待确认|collect info/i;
const HARDBLOCKER_PATTERN = /^hard[_\s-]?blocker[:：]\s*/i;

function toTextList(items = [], max = 8) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

function hasHighRiskSignals(risks = []) {
  return toTextList(risks, 20).some((risk) => HIGH_RISK_PATTERN.test(risk));
}

function hasMissingInfoSignals(gaps = [], risks = [], nextAction = "") {
  if (String(nextAction || "").trim() === "collect_info") return true;
  return [...toTextList(gaps, 20), ...toTextList(risks, 20)].some((item) => MISSING_INFO_PATTERN.test(item));
}

function extractHardBlockersFromRisks(risks = []) {
  return toTextList(risks, 20)
    .filter((item) => HARDBLOCKER_PATTERN.test(item))
    .map((item) => item.replace(HARDBLOCKER_PATTERN, "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function buildControlGateResultFromJobDecision({
  jobDecision,
  job = {},
  policyVersion = "control.v1",
  trace = {}
} = {}) {
  if (!jobDecision || typeof jobDecision !== "object") {
    const error = new Error("JobDecision is required before evaluating control gate.");
    error.code = "DECISION_REQUIRED";
    throw error;
  }

  const recommendation = String(jobDecision.recommendation || "").trim();
  const nextAction = String(jobDecision.nextAction || "").trim();
  const risks = toTextList(jobDecision.risks || [], 8);
  const gaps = toTextList(jobDecision.gaps || [], 8);
  const hardBlockers = extractHardBlockersFromRisks(risks);

  let status = "needs_human_review";
  const reasons = [];
  const blockingIssues = [];
  const requiredActions = [];

  if (hardBlockers.length > 0 || recommendation === "skip" || nextAction === "skip") {
    status = "blocked";
    reasons.push(
      hardBlockers.length > 0
        ? "Decision verdict contains hard blockers. Apply flow is blocked."
        : "Decision recommendation indicates this job should be skipped."
    );
    if (hardBlockers.length > 0) {
      blockingIssues.push(...hardBlockers);
    } else {
      blockingIssues.push("Low fit or explicit skip recommendation.");
    }
    requiredActions.push("Do not execute apply flow for this job.");
  } else {
    const missingInfo = hasMissingInfoSignals(gaps, risks, nextAction);
    const highRisk = hasHighRiskSignals(risks);

    if (missingInfo) {
      status = "needs_human_review";
      reasons.push("Decision indicates missing information before execution.");
      blockingIssues.push("Insufficient verified information for safe execution.");
      requiredActions.push("Collect missing job or profile information.");
      requiredActions.push("Human review required before moving to submission.");
    }

    if (highRisk) {
      status = "needs_human_review";
      reasons.push("High-risk signals were detected from decision risks.");
      blockingIssues.push("Risk level exceeds automatic execution threshold.");
      requiredActions.push("Human confirmation required due to high risk.");
    }

    if (!missingInfo && !highRisk && recommendation === "apply" && nextAction === "apply") {
      status = "allowed";
      reasons.push("Decision is apply and no high-risk or missing-info blockers found.");
    }

    if (status !== "allowed" && requiredActions.length === 0) {
      requiredActions.push("Human review required before execution.");
    }
  }

  const override = job?.policyOverride?.active ? job.policyOverride : null;
  if (override?.action === "force_proceed" && status === "needs_human_review") {
    status = "allowed";
    reasons.push("User force_proceed override allows execution after human review.");
    blockingIssues.length = 0;
    requiredActions.length = 0;
  }

  const gate = createControlContract({
    controlId: `${job.id || jobDecision.jobId || "job"}_control_${Date.now()}`,
    decisionId: jobDecision.decisionId || "",
    jobId: jobDecision.jobId || job.id || "",
    status,
    reasons,
    blockingIssues,
    requiredActions,
    sourceDecision: {
      recommendation,
      nextAction,
      fitScore: Number(jobDecision.fitScore || 0),
      risks,
      gaps
    },
    policyVersion,
    trace: {
      source: trace.source || "control_gate_evaluator",
      version: trace.version || "control-gate-evaluator.v1",
      runId: trace.runId || jobDecision.trace?.runId || jobDecision.decisionId || ""
    },
    checkedAt: new Date().toISOString()
  });

  const validation = validateControlContract(gate);
  if (!validation.ok) {
    const error = new Error(`Invalid ControlGateResult contract: ${validation.errors.join("; ")}`);
    error.code = "INVALID_CONTROL_GATE_CONTRACT";
    error.details = { errors: validation.errors, gate };
    throw error;
  }

  return gate;
}

module.exports = {
  buildControlGateResultFromJobDecision
};
