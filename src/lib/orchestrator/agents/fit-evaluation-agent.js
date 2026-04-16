const { createId, nowIso } = require("../../utils/id");
const store = require("../../../server/store");
const { generateFitAssessment, getLlmConfig } = require("../../llm/applyflow-llm-service");

function hasAnyKeyword(text, values) {
  return (values || []).some((value) => text.includes(String(value).toLowerCase()));
}

function deriveRecommendation(score) {
  if (score >= 72) return "apply";
  if (score >= 50) return "cautious";
  return "skip";
}

function deriveStrategyDecision({
  score,
  recommendation,
  matchingBadCase,
  roleBias,
  industryBias,
  riskFlags,
  globalPolicy
}) {
  const negativeBias = Number(roleBias || 0) + Number(industryBias || 0);
  const heavyRisk = riskFlags.length >= 4;
  const lowTolerance = globalPolicy?.riskTolerance === "low";
  const focusedMode = globalPolicy?.focusMode === "focused";

  if (recommendation === "skip" || matchingBadCase || score < 40) {
    return "avoid";
  }

  if (negativeBias <= -5 || heavyRisk || score < 55 || (lowTolerance && riskFlags.length >= 3)) {
    return "deprioritize";
  }

  if (recommendation === "cautious" || riskFlags.length >= 4 || score < 74 || (focusedMode && riskFlags.length >= 3)) {
    return "cautious_proceed";
  }

  return "proceed";
}

function runRuleBasedFitEvaluationAgent({ job, profile, strategyProfile, globalPolicy }) {
  const jobText = `${job.title} ${job.company} ${job.location} ${job.jdRaw} ${(job.jdStructured?.keywords || []).join(" ")}`
    .toLowerCase();
  const roleTargets = profile.targetRoles || [];
  const industryTargets = profile.targetIndustries || [];
  const locationTargets = profile.targetLocations || profile.preferredLocations || [];
  const strengths = profile.strengths || [];
  const constraints = profile.constraints || [];
  const roleBiases = strategyProfile?.scoreBias?.roleBiases || {};
  const industryBiases = strategyProfile?.scoreBias?.industryBiases || {};
  const targetRolesPriority = globalPolicy?.targetRolesPriority || [];
  const preferredIndustries = globalPolicy?.preferredIndustries || [];
  const avoidPatterns = globalPolicy?.avoidPatterns || [];
  let baseScore = 40;
  let historyAdjustment = 0;
  let policyAdjustment = 0;
  const whyApply = [];
  const keyGaps = [];
  const riskFlags = [...(job.jdStructured?.riskFlags || [])];
  const historyReasons = [];
  const policyReasons = [];
  const matchingBadCase = store.listBadCases().find((badCase) => {
    const corpus = `${badCase.company} ${badCase.title} ${badCase.rawJd || ""}`.toLowerCase();
    return (
      corpus.includes(job.company.toLowerCase()) ||
      corpus.includes(job.title.toLowerCase()) ||
      (job.jdStructured?.keywords || []).some((keyword) => corpus.includes(String(keyword).toLowerCase()))
    );
  });

  if (hasAnyKeyword(jobText, roleTargets)) {
    baseScore += 18;
    whyApply.push("Job title and JD language overlap with target roles.");
  }

  if (/product|pm|roadmap|workflow|agent|ai/.test(jobText)) {
    baseScore += 15;
    whyApply.push("Role includes product or AI-workflow signals aligned with current direction.");
  }

  if (hasAnyKeyword(jobText, industryTargets)) {
    baseScore += 10;
    whyApply.push("Industry context overlaps with preferred target industries.");
  }

  if (hasAnyKeyword(jobText, targetRolesPriority)) {
    policyAdjustment += 6;
    whyApply.push("Global policy is actively prioritizing this role family.");
    policyReasons.push("Boosted because this role family is part of the current global focus.");
  }

  if (hasAnyKeyword(jobText, preferredIndustries)) {
    policyAdjustment += 5;
    whyApply.push("Industry matches the current global policy focus.");
    policyReasons.push("Boosted because similar industries are outperforming in the current pipeline.");
  }

  if (hasAnyKeyword(jobText, locationTargets)) {
    baseScore += 8;
    whyApply.push("Location is within preferred target geography.");
  } else if (locationTargets.length > 0) {
    riskFlags.push("Location is outside the current preferred target list.");
  }

  if (/director|head of|vp/.test(jobText)) {
    baseScore -= 18;
    keyGaps.push("Seniority may be higher than current target positioning.");
  }

  if (/advertising|ad tech|media sales/.test(jobText)) {
    baseScore -= 14;
    keyGaps.push("Domain specialization appears far from current AI PM target path.");
  }

  if (/10\+ years|8\+ years|12\+ years/.test(jobText) && Number(profile.yearsOfExperience || 0) < 8) {
    baseScore -= 12;
    keyGaps.push("Required experience years may exceed current profile.");
  }

  if (strengths.length > 0 && /strategy|stakeholder|execution|cross-functional/.test(jobText)) {
    baseScore += 8;
    whyApply.push("Role values strengths already present in the profile.");
  }

  if (hasAnyKeyword(jobText, constraints)) {
    baseScore -= 20;
    riskFlags.push("Job text overlaps with stated profile constraints.");
  }

  if (hasAnyKeyword(jobText, avoidPatterns)) {
    policyAdjustment -= 10;
    riskFlags.push("Global policy marks this pattern as a pipeline distraction.");
    policyReasons.push("Downranked because the global policy has learned this pattern is usually low leverage.");
  }

  const roleBiasEntry = Object.entries(roleBiases).find(([key]) => jobText.includes(String(key).toLowerCase()));
  const roleBiasValue = roleBiasEntry ? Number(roleBiasEntry[1] || 0) : 0;
  if (roleBiasEntry) {
    historyAdjustment += roleBiasValue;
    if (roleBiasValue !== 0) {
      riskFlags.push(
        roleBiasValue > 0
          ? `Historical performance raises confidence for ${roleBiasEntry[0]} roles.`
          : `Historical performance lowers confidence for ${roleBiasEntry[0]} roles.`
      );
      historyReasons.push(
        roleBiasValue > 0
          ? `Boosted due to previous success in ${roleBiasEntry[0]} roles.`
          : `Reduced because similar ${roleBiasEntry[0]} roles had weak conversion.`
      );
    }
  }

  const industryBiasEntry = Object.entries(industryBiases).find(([key]) =>
    jobText.includes(String(key).toLowerCase())
  );
  const industryBiasValue = industryBiasEntry ? Number(industryBiasEntry[1] || 0) : 0;
  if (industryBiasEntry) {
    historyAdjustment += industryBiasValue;
    if (industryBiasValue !== 0) {
      riskFlags.push(
        industryBiasValue > 0
          ? `Past outcomes suggest stronger traction in ${industryBiasEntry[0]} contexts.`
          : `Past outcomes suggest weaker traction in ${industryBiasEntry[0]} contexts.`
      );
      historyReasons.push(
        industryBiasValue > 0
          ? `History is favorable for ${industryBiasEntry[0]} industry roles.`
          : `History is unfavorable for ${industryBiasEntry[0]} industry roles.`
      );
    }
  }

  if (matchingBadCase) {
    historyAdjustment -= 8;
    riskFlags.push(`Similar to a previous bad case: ${matchingBadCase.company} / ${matchingBadCase.title}.`);
    keyGaps.push("Review prior bad case feedback before investing further effort.");
    historyReasons.push("Lowered because similar jobs previously became bad cases.");
  }

  let score = baseScore + historyAdjustment + policyAdjustment;
  score = Math.max(0, Math.min(score, 95));
  const recommendation = deriveRecommendation(score);
  const strategyDecision = deriveStrategyDecision({
    score,
    recommendation,
    matchingBadCase,
    roleBias: roleBiasValue,
    industryBias: industryBiasValue,
    riskFlags,
    globalPolicy
  });
  const confidence = Math.min(
    0.95,
    0.55 + Math.min((job.jdStructured?.keywords?.length || 0) * 0.02, 0.2)
  );

  return {
    id: createId("fit"),
    jobId: job.id,
    profileId: profile.id,
    fitScore: score,
    recommendation,
    strategyDecision,
    strategyReasoning:
    strategyDecision === "proceed"
        ? "This role matches current success patterns closely enough to justify active pursuit."
        : strategyDecision === "cautious_proceed"
          ? "This role can move forward, but only with deliberate risk management during prep."
          : strategyDecision === "deprioritize"
            ? "This role is not a strong enough strategic bet to enter the active prep queue by default."
            : "This role conflicts with historical feedback or current global policy enough to avoid active pursuit.",
    historyInfluenceSummary:
      historyReasons[0] ||
      "History did not materially shift this role beyond the current profile-to-job fit.",
    policyInfluenceSummary:
      policyReasons[0] ||
      "Global policy did not materially override the default fit judgement for this role.",
    decisionBreakdown: {
      baseScore,
      historyAdjustment,
      policyAdjustment,
      finalScore: score,
      finalDecision: strategyDecision
    },
    confidence,
    decisionSummary:
      recommendation === "apply"
        ? "Role aligns well with target direction and is worth preparing for."
        : recommendation === "cautious"
          ? "Role is viable but may need tighter prioritization and narrative control."
          : "Role appears misaligned enough that it is better treated as a skip.",
    whyApply: whyApply.slice(0, 4),
    keyGaps:
      keyGaps.length > 0
        ? keyGaps.slice(0, 4)
        : recommendation === "apply"
          ? ["Need tighter examples that show direct product and technical collaboration."]
          : ["Role fit is not strong enough to justify high effort."],
    riskFlags:
      [...new Set(
        riskFlags.length > 0
          ? riskFlags
          : recommendation === "cautious"
            ? ["Proceed only if weekly pipeline needs more volume."]
            : ["Expected conversion probability is low."]
      )].slice(0, 5),
    suggestedAction:
      recommendation === "apply"
        ? "Proceed to application prep and tailor materials for this role."
        : recommendation === "cautious"
          ? "Keep as a secondary priority and only prepare if pipeline needs more volume."
          : "Do not invest more effort now; archive and focus on better-fit jobs.",
    editable: true,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

async function runFitEvaluationAgent({ job, profile, strategyProfile, globalPolicy }) {
  const fallbackResult = runRuleBasedFitEvaluationAgent({ job, profile, strategyProfile, globalPolicy });
  const llmResult = await generateFitAssessment({
    job,
    profile,
    strategyProfile,
    globalPolicy,
    fallbackResult
  });
  const llmProvider = getLlmConfig().provider;

  if (!llmResult.ok) {
    return {
      ...fallbackResult,
      llmMeta: {
        provider: "heuristic_fallback",
        model: llmResult.model,
        fallbackUsed: true,
        errorSummary: llmResult.errorSummary || null,
        latencyMs: llmResult.latencyMs || null
      }
    };
  }

  return {
    ...fallbackResult,
    fitScore: llmResult.data.fitScore,
    recommendation: llmResult.data.recommendation,
    strategyDecision: llmResult.data.strategyDecision,
    strategyReasoning: llmResult.data.strategyReasoning,
    historyInfluenceSummary: llmResult.data.historyInfluenceSummary,
    policyInfluenceSummary: llmResult.data.policyInfluenceSummary,
    confidence: llmResult.data.confidence,
    decisionSummary: llmResult.data.decisionSummary,
    whyApply: llmResult.data.whyApply.length > 0 ? llmResult.data.whyApply : fallbackResult.whyApply,
    keyGaps: llmResult.data.keyGaps.length > 0 ? llmResult.data.keyGaps : fallbackResult.keyGaps,
    riskFlags: llmResult.data.riskFlags.length > 0 ? llmResult.data.riskFlags : fallbackResult.riskFlags,
    suggestedAction: llmResult.data.suggestedAction || fallbackResult.suggestedAction,
    decisionBreakdown: {
      ...fallbackResult.decisionBreakdown,
      finalScore: llmResult.data.fitScore,
      finalDecision: llmResult.data.strategyDecision
    },
    llmMeta: {
      provider: llmProvider,
      model: llmResult.model,
      fallbackUsed: false,
      latencyMs: llmResult.latencyMs || null,
      errorSummary: null
    }
  };
}

module.exports = { runFitEvaluationAgent, runRuleBasedFitEvaluationAgent };
