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
    whyApply.push("岗位名称和岗位描述与目标岗位方向高度重合。");
  }

  if (/product|pm|roadmap|workflow|agent|ai/.test(jobText)) {
    baseScore += 15;
    whyApply.push("岗位包含产品或 AI 工作流信号，和当前主方向一致。");
  }

  if (hasAnyKeyword(jobText, industryTargets)) {
    baseScore += 10;
    whyApply.push("行业背景与目标行业方向有明显交集。");
  }

  if (hasAnyKeyword(jobText, targetRolesPriority)) {
    policyAdjustment += 6;
    whyApply.push("全局策略正在优先推进这一类岗位。");
    policyReasons.push("这类岗位正处于当前全局聚焦方向，因此获得了策略加权。");
  }

  if (hasAnyKeyword(jobText, preferredIndustries)) {
    policyAdjustment += 5;
    whyApply.push("岗位所在行业与当前策略聚焦行业一致。");
    policyReasons.push("相似行业在当前求职流程中的表现更好，因此获得了策略加权。");
  }

  if (hasAnyKeyword(jobText, locationTargets)) {
    baseScore += 8;
    whyApply.push("地点位于当前优先投递区域内。");
  } else if (locationTargets.length > 0) {
    riskFlags.push("岗位地点不在当前优先投递区域内。");
  }

  if (/director|head of|vp/.test(jobText)) {
    baseScore -= 18;
    keyGaps.push("岗位资深度可能高于当前定位。");
  }

  if (/advertising|ad tech|media sales/.test(jobText)) {
    baseScore -= 14;
    keyGaps.push("领域专业方向与当前 AI 产品主路径距离较远。");
  }

  if (/10\+ years|8\+ years|12\+ years/.test(jobText) && Number(profile.yearsOfExperience || 0) < 8) {
    baseScore -= 12;
    keyGaps.push("岗位要求的工作年限可能高于当前画像。");
  }

  if (strengths.length > 0 && /strategy|stakeholder|execution|cross-functional/.test(jobText)) {
    baseScore += 8;
    whyApply.push("岗位强调的能力与当前画像中的优势高度一致。");
  }

  if (hasAnyKeyword(jobText, constraints)) {
    baseScore -= 20;
    riskFlags.push("岗位内容与个人限制条件存在重叠。");
  }

  if (hasAnyKeyword(jobText, avoidPatterns)) {
    policyAdjustment -= 10;
    riskFlags.push("全局策略已将这类模式标记为分散精力的方向。");
    policyReasons.push("这类模式通常带来的收益较低，因此被策略主动降权。");
  }

  const roleBiasEntry = Object.entries(roleBiases).find(([key]) => jobText.includes(String(key).toLowerCase()));
  const roleBiasValue = roleBiasEntry ? Number(roleBiasEntry[1] || 0) : 0;
  if (roleBiasEntry) {
    historyAdjustment += roleBiasValue;
    if (roleBiasValue !== 0) {
      riskFlags.push(
        roleBiasValue > 0
          ? `历史表现提升了系统对 ${roleBiasEntry[0]} 类岗位的信心。`
          : `历史表现降低了系统对 ${roleBiasEntry[0]} 类岗位的信心。`
      );
      historyReasons.push(
        roleBiasValue > 0
          ? `你在 ${roleBiasEntry[0]} 类岗位上曾有较好结果，因此本次判断被抬高。`
          : `相似的 ${roleBiasEntry[0]} 类岗位历史转化较弱，因此本次判断被下调。`
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
          ? `历史结果显示你在 ${industryBiasEntry[0]} 行业场景中更容易推进。`
          : `历史结果显示你在 ${industryBiasEntry[0]} 行业场景中的推进表现较弱。`
      );
      historyReasons.push(
        industryBiasValue > 0
          ? `历史数据对 ${industryBiasEntry[0]} 行业岗位更有利。`
          : `历史数据对 ${industryBiasEntry[0]} 行业岗位不够有利。`
      );
    }
  }

  if (matchingBadCase) {
    historyAdjustment -= 8;
    riskFlags.push(`与历史失败案例相似：${matchingBadCase.company} / ${matchingBadCase.title}。`);
    keyGaps.push("建议先回看过往失败案例反馈，再决定是否继续投入。");
    historyReasons.push("相似岗位曾进入失败案例库，因此本次判断被下调。");
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
        ? "这条岗位与当前成功路径足够接近，值得进入主动推进队列。"
        : strategyDecision === "cautious_proceed"
          ? "这条岗位可以继续推进，但申请准备阶段需要明确管理风险。"
          : strategyDecision === "deprioritize"
            ? "这条岗位暂时不够强，不建议默认进入主准备队列。"
            : "这条岗位与历史反馈或当前全局策略冲突较大，暂不建议主动推进。",
    historyInfluenceSummary:
      historyReasons[0] ||
      "历史结果没有明显改变这条岗位相对于当前画像的基础判断。",
    policyInfluenceSummary:
      policyReasons[0] ||
      "全局策略没有明显覆盖这条岗位的基础匹配判断。",
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
        ? "这条岗位与目标方向较为一致，值得进入申请准备。"
        : recommendation === "cautious"
          ? "这条岗位可以尝试，但需要更严格地控制优先级和申请叙事。"
          : "这条岗位整体偏离当前方向，更适合作为暂不优先处理。",
    whyApply: whyApply.slice(0, 4),
    keyGaps:
      keyGaps.length > 0
        ? keyGaps.slice(0, 4)
        : recommendation === "apply"
          ? ["仍需补强能直接体现产品判断与跨团队协作的案例。"]
          : ["当前岗位匹配度不足，不值得投入高强度准备成本。"],
    riskFlags:
      [...new Set(
        riskFlags.length > 0
          ? riskFlags
          : recommendation === "cautious"
            ? ["只有在本周岗位储备不足时，才建议把它纳入推进。"]
            : ["预期转化概率较低。"]
      )].slice(0, 5),
    suggestedAction:
      recommendation === "apply"
        ? "进入申请准备，并为这条岗位定制材料。"
        : recommendation === "cautious"
          ? "作为次优先级保留，只有在队列需要补量时再进入准备。"
          : "现在不要继续投入，建议归档并把精力放到更匹配的岗位上。",
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
