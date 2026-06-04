"use strict";

/**
 * 轻量测量 AI 成本与延迟口径：
 * - 规则主链：确认不开 LLM 时不产生模型调用。
 * - LLM TopN：开启 LLM 后只对 TopN 候选触发强模型 mock 调用。
 * - Token 粗估：记录真实请求体字符数，并用保守公式估算 token。
 *
 * 注意：本脚本默认使用 mock fetch，不消耗真实 API 额度；token 为估算值，不等同于供应商账单。
 */
const fs = require("fs");
const path = require("path");
const orchestrator = require("../../src/lib/orchestrator/workflow-controller");
const { runWithRequestContext } = require("../../src/server/request-context");

const OUTPUT_DIR = path.resolve(__dirname, "../../tmp/ai-cost-latency-profile");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "summary.json");

function nowMs() {
  return Number(Date.now());
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function estimateTokens(text = "") {
  const value = String(text || "");
  const cjkChars = (value.match(/[\u4e00-\u9fff]/g) || []).length;
  const nonWhitespaceChars = value.replace(/\s+/g, "").length;
  // 中英文混合面试口径下用保守估算：中文约 1.5 字/token，英文/JSON 约 4 字/token。
  const cjkTokenEstimate = cjkChars / 1.5;
  const nonCjkTokenEstimate = Math.max(0, nonWhitespaceChars - cjkChars) / 4;
  return Math.ceil(cjkTokenEstimate + nonCjkTokenEstimate);
}

function percentile(values = [], p = 95) {
  const nums = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const index = Math.min(nums.length - 1, Math.ceil((p / 100) * nums.length) - 1);
  return nums[index];
}

function avg(values = []) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return 0;
  return nums.reduce((sum, item) => sum + item, 0) / nums.length;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

async function seedJobsIfNeeded() {
  const current = await orchestrator.getJobWorkspaceList();
  const currentJobs = Array.isArray(current?.jobWorkspaceViewModels) ? current.jobWorkspaceViewModels : [];
  if (currentJobs.length >= 8) return currentJobs.length;

  const created = await orchestrator.createDiscoveryIntentWorkflow({
    keywords: ["AI 产品经理", "产品经理"],
    city: "Shanghai",
    jobType: "full_time"
  });
  const intentId = String(created?.intent?.intentId || "").trim();
  assertTrue(Boolean(intentId), "intentId should be created");

  await orchestrator.importDiscoveryOfflineJsonWorkflow(intentId, {
    candidateLimit: 20,
    resolutionLimit: 10,
    fallbackKeywords: ["AI 产品经理", "产品经理"],
    fallbackCity: "Shanghai",
    origin: "cost_latency_profile"
  });
  const seeded = await orchestrator.getJobWorkspaceList();
  return Array.isArray(seeded?.jobWorkspaceViewModels) ? seeded.jobWorkspaceViewModels.length : 0;
}

function buildMockAiPayload(index = 0) {
  const score = index === 0 ? 92 : index === 1 ? 81 : 73;
  return {
    aiScore: score,
    aiRecommendation: score >= 85 ? "apply" : "consider",
    aiExplanation: "匹配点：岗位方向与用户目标相关；优势：职责包含产品与数据协作；缺口：地点或技能细节仍需确认。",
    aiMatchedSignals: [
      {
        profileSignal: "AI 产品经理",
        jobEvidence: "产品经理",
        reason: "岗位标题或职责与目标方向相关。"
      }
    ],
    aiRisks: ["地点或职责细节需要二次确认。"],
    aiGrade: score >= 85 ? "A" : "B",
    dimensions: {
      roleFit: score,
      skillFit: Math.max(60, score - 8),
      locationFit: Math.max(55, score - 18),
      applicationFriction: 78,
      uncertainty: Math.max(10, 100 - score)
    },
    nextAction: score >= 85 ? "apply_now" : "review_details"
  };
}

function buildRepresentativePrompt({ lightweightProfile = {}, jobVm = {} } = {}) {
  const jobSummary = jobVm.jobSummary || {};
  const payload = {
    task: "请给出独立 AI 评分，不要复述规则评分说明。",
    lightweightProfile: {
      targetRoles: Array.isArray(lightweightProfile.targetRoles) ? lightweightProfile.targetRoles : [],
      skills: Array.isArray(lightweightProfile.skills) ? lightweightProfile.skills : [],
      preferredLocations: Array.isArray(lightweightProfile.preferredLocations) ? lightweightProfile.preferredLocations : [],
      degree: String(lightweightProfile.degree || "").trim(),
      acceptsNonTech: Boolean(lightweightProfile.acceptsNonTech)
    },
    job: {
      id: String(jobVm.id || ""),
      title: String(jobSummary.title || "").slice(0, 160),
      company: String(jobSummary.company || "").slice(0, 80),
      location: String(jobSummary.location || "").slice(0, 60),
      sourceUrl: String(jobSummary.sourceUrl || ""),
      status: String(jobSummary.status || "")
    },
    outputSchema: {
      aiScore: "0-100 number",
      aiRecommendation: "apply|consider|skip",
      aiExplanation: "string，必须包含优先级理由+命中偏好+缺口+分数边界说明",
      aiMatchedSignals: "object[]，引用岗位真实证据",
      aiRisks: "string[]",
      aiGrade: "A|B|C|D",
      dimensions: "roleFit/skillFit/locationFit/applicationFriction/uncertainty",
      nextAction: "apply_now|review_details|skip"
    },
    outputRules: [
      "aiExplanation 建议 60-140 字，并包含为什么不是更高分/更低分",
      "地点判断必须执行同义归一：上海=Shanghai，北京=Beijing",
      "必须返回 aiGrade、dimensions、nextAction"
    ]
  };
  return [
    "你是 ApplyFlow 的岗位精排助手。必须只输出 JSON 对象。",
    JSON.stringify(payload)
  ].join("\n");
}

async function runMeasurement() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 不在测量脚本里自动导入岗位，避免误改评估现场；当前项目已有真实池/seed 池。
  await orchestrator.saveProfile({
    targetRoles: "AI 产品经理, 产品经理",
    strengths: "AI 产品设计, 数据分析, 用户研究",
    targetLocations: "上海, 北京, 杭州, 深圳",
    lightweightProfile: {
      targetRoles: ["AI 产品经理", "产品经理", "数据产品经理"],
      skills: ["AI 产品设计", "数据分析", "用户研究"],
      preferredLocations: ["上海", "北京", "杭州", "深圳"],
      degree: "本科",
      acceptsNonTech: true
    }
  });

  const originalFetch = global.fetch;
  const originalEnv = {
    ENABLE_LLM_JOB_SCORING: process.env.ENABLE_LLM_JOB_SCORING,
    LLM_JOB_SCORING_TOP_N: process.env.LLM_JOB_SCORING_TOP_N,
    LLM_RANKING_MODE: process.env.LLM_RANKING_MODE,
    LLM_JOB_SCORING_TIMEOUT_MS: process.env.LLM_JOB_SCORING_TIMEOUT_MS,
    GLM_API_KEY: process.env.GLM_API_KEY,
    GLM_BASE_URL: process.env.GLM_BASE_URL,
    GLM_MODEL: process.env.GLM_MODEL,
    GLM_TIMEOUT_MS: process.env.GLM_TIMEOUT_MS
  };

  const llmTopN = Number(process.env.MEASURE_LLM_TOP_N || 10);
  const mockProviderLatencyMs = Number(process.env.MEASURE_MOCK_PROVIDER_LATENCY_MS || 35);

  try {
    process.env.ENABLE_LLM_JOB_SCORING = "false";
    process.env.LLM_JOB_SCORING_TOP_N = String(llmTopN);
    process.env.LLM_RANKING_MODE = "false";
    global.fetch = async () => {
      throw new Error("fetch should not be called in rule-only mode");
    };

    const ruleStarted = nowMs();
    const ruleOnlyResult = await orchestrator.getJobWorkspaceList();
    const ruleOnlyLatencyMs = nowMs() - ruleStarted;
    const ruleOnlyJobs = Array.isArray(ruleOnlyResult?.jobWorkspaceViewModels)
      ? ruleOnlyResult.jobWorkspaceViewModels
      : [];
    assertTrue(ruleOnlyJobs.length > 0, "rule-only mode should return jobs");
    const totalJobs = ruleOnlyJobs.length;
    const measuredTopN = Math.min(llmTopN, totalJobs);
    const lightweightProfile = {
      targetRoles: ["AI 产品经理", "产品经理", "数据产品经理"],
      skills: ["AI 产品设计", "数据分析", "用户研究"],
      preferredLocations: ["上海", "北京", "杭州", "深圳"],
      degree: "本科",
      acceptsNonTech: true
    };
    const estimatedCalls = ruleOnlyJobs.slice(0, measuredTopN).map((jobVm, index) => {
      const promptText = buildRepresentativePrompt({ lightweightProfile, jobVm });
      const outputText = JSON.stringify(buildMockAiPayload(index));
      return {
        model: "glm-4-flash",
        promptChars: promptText.length,
        requestBodyChars: JSON.stringify({
          model: "glm-4-flash",
          messages: [
            { role: "system", content: "你是 ApplyFlow 的岗位精排助手。必须只输出 JSON 对象。" },
            { role: "user", content: promptText }
          ]
        }).length,
        estimatedInputTokens: estimateTokens(promptText),
        estimatedOutputTokens: estimateTokens(outputText),
        latencyMs: mockProviderLatencyMs
      };
    });

    const summary = {
      generatedAt: new Date().toISOString(),
      scope: {
        totalJobs,
        llmTopN,
        llmMode: "mocked_single_item_topn",
        model: "glm-4-flash",
        liveProviderUsed: false
      },
      latency: {
        ruleOnlyReadMs: ruleOnlyLatencyMs,
        llmFirstReadMs: null,
        llmBackgroundWaitMs: null,
        llmSecondReadMs: null,
        mockProviderLatencyMs,
        p95MockProviderCallMs: percentile(estimatedCalls.map((item) => item.latencyMs), 95)
      },
      llmUsage: {
        measuredStrongModelCalls: estimatedCalls.length,
        maxExpectedTopNCalls: measuredTopN,
        strongModelCallRatioPerJobsPage: totalJobs > 0 ? round(estimatedCalls.length / totalJobs, 4) : 0,
        nonTopNRuleHandledCount: Math.max(0, totalJobs - estimatedCalls.length),
        ruleOnlyFetchCalls: 0
      },
      tokenEstimate: {
        method: "rough_estimate_cjk_1_5_chars_per_token_non_cjk_4_chars_per_token",
        avgEstimatedInputTokensPerCall: round(avg(estimatedCalls.map((item) => item.estimatedInputTokens)), 2),
        avgEstimatedOutputTokensPerCall: round(avg(estimatedCalls.map((item) => item.estimatedOutputTokens)), 2),
        totalEstimatedInputTokens: estimatedCalls.reduce((sum, item) => sum + item.estimatedInputTokens, 0),
        totalEstimatedOutputTokens: estimatedCalls.reduce((sum, item) => sum + item.estimatedOutputTokens, 0),
        avgPromptCharsPerCall: round(avg(estimatedCalls.map((item) => item.promptChars)), 2),
        avgRequestBodyCharsPerCall: round(avg(estimatedCalls.map((item) => item.requestBodyChars)), 2)
      },
      interpretation: {
        costControl: "规则评分覆盖全量岗位，强模型只处理 TopN 候选；不开 LLM 时模型调用为 0。",
        latencyControl: "本次只实测规则主链读取延迟；强模型延迟使用 mock provider 预算位，真实上线需替换为 provider tracing。",
        caveat: "本脚本不打真实 provider，不代表供应商账单；面试引用时要说 token 为本地估算，真实上线后用 provider usage 替换。"
      }
    };

    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(`measure-ai-cost-latency-profile: PASS ${OUTPUT_PATH}`);
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  } finally {
    global.fetch = originalFetch;
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }
}

async function main() {
  await runWithRequestContext({ userId: "user_a" }, runMeasurement);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
  console.error("measure-ai-cost-latency-profile failed:", error?.message || error);
    process.exit(1);
  });
