"use strict";

const {
  createDecisionContract,
  validateDecisionContract
} = require("../contracts/agent-governance-contracts");

const FALLBACK_TEXT_PATTERN = /建议人工补充确认|暂无可展示|未清晰列出|fallback|回退结果|completed with fallback/i;
const HARDBLOCKER_PREFIX = "HARD_BLOCKER: ";

function toCleanList(items = [], max = 8, itemMax = 220) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").trim().slice(0, itemMax))
    .filter(Boolean)
    .filter((item) => !FALLBACK_TEXT_PATTERN.test(item))
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

function toRecommendation(value = "") {
  const v = String(value || "").trim().toLowerCase();
  if (v === "apply") return "apply";
  if (v === "skip") return "skip";
  return "cautious";
}

function normalizeDecisionVerdict(fitAssessment = {}) {
  const verdict = fitAssessment?.decisionVerdict;
  if (!verdict || typeof verdict !== "object") return null;
  const normalizedVerdict = String(verdict.verdict || "").trim().toLowerCase();
  if (!["go", "review", "no_go"].includes(normalizedVerdict)) return null;
  return verdict;
}

function mapVerdictToRecommendation(verdict = "") {
  const normalized = String(verdict || "").trim().toLowerCase();
  if (normalized === "go") return "apply";
  if (normalized === "no_go") return "skip";
  if (normalized === "review") return "cautious";
  return "";
}

function mapVerdictToNextAction(verdict = "") {
  const normalized = String(verdict || "").trim().toLowerCase();
  if (normalized === "go") return "apply";
  if (normalized === "no_go") return "skip";
  if (normalized === "review") return "collect_info";
  return "";
}

function mapStrategyDecisionToNextAction(strategyDecision = "", recommendation = "cautious") {
  const decision = String(strategyDecision || "").trim().toLowerCase();
  if (decision === "proceed") return "apply";
  if (decision === "cautious_proceed") return "collect_info";
  if (decision === "avoid") return "skip";
  if (decision === "deprioritize") return "hold";

  if (recommendation === "apply") return "apply";
  if (recommendation === "skip") return "skip";
  return "hold";
}

function buildEvidenceList(fitAssessment = {}) {
  return toCleanList(
    [
      ...(fitAssessment.whyApply || [])
    ],
    8,
    220
  );
}

function buildJobDecisionFromFitAssessment({ job = {}, fitAssessment = {}, userId = "" } = {}) {
  const decisionVerdict = normalizeDecisionVerdict(fitAssessment);
  const verdictRecommendation = mapVerdictToRecommendation(decisionVerdict?.verdict);
  const hasAuthoritativeVerdict = Boolean(decisionVerdict && verdictRecommendation);
  const fallbackRecommendation = toRecommendation(fitAssessment.recommendation || "");
  const recommendation = hasAuthoritativeVerdict ? verdictRecommendation : fallbackRecommendation;
  const hardBlockers = toCleanList(decisionVerdict?.hardBlockers || [], 6, 220);
  const risks = toCleanList(
    [
      ...(!hasAuthoritativeVerdict ? ["决策信息不足，建议人工复核"] : []),
      ...hardBlockers.map((item) => `${HARDBLOCKER_PREFIX}${item}`),
      ...(fitAssessment.riskFlags || [])
    ],
    8,
    220
  );
  const verdictNextAction = mapVerdictToNextAction(decisionVerdict?.verdict);
  const nextAction = verdictNextAction || mapStrategyDecisionToNextAction(fitAssessment.strategyDecision, recommendation);
  const rationale =
    (!hasAuthoritativeVerdict ? "决策信息不足，建议人工复核。" : "") ||
    fitAssessment.strategyReasoning ||
    fitAssessment.decisionSummary ||
    (decisionVerdict?.nextAction ? String(decisionVerdict.nextAction).trim() : "");
  const decision = createDecisionContract({
    decisionId: fitAssessment.id || "",
    jobId: fitAssessment.jobId || job.id || "",
    userId: userId || fitAssessment.profileId || "",
    fitScore: fitAssessment.fitScore,
    recommendation,
    evidence: buildEvidenceList(fitAssessment),
    gaps: toCleanList(fitAssessment.keyGaps || [], 8, 220),
    risks,
    nextAction,
    rationale,
    confidence: fitAssessment.confidence,
    trace: {
      source: "fit_assessment_mapper",
      model: fitAssessment.llmMeta?.model || "",
      version: "job-decision-mapper.v2",
      runId: fitAssessment.id || ""
    },
    decidedAt: fitAssessment.updatedAt || fitAssessment.createdAt
  });

  const validation = validateDecisionContract(decision);
  if (!validation.ok) {
    const error = new Error(`Invalid JobDecision contract: ${validation.errors.join("; ")}`);
    error.code = "INVALID_JOB_DECISION_CONTRACT";
    error.details = { errors: validation.errors, decision };
    throw error;
  }

  return decision;
}

module.exports = {
  buildJobDecisionFromFitAssessment,
  mapStrategyDecisionToNextAction
};
