"use strict";

const orchestrator = require("../../src/lib/orchestrator/workflow-controller");

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

async function seedJobsIfNeeded() {
  const current = await orchestrator.getJobWorkspaceList();
  const currentJobs = Array.isArray(current?.jobWorkspaceViewModels) ? current.jobWorkspaceViewModels : [];
  if (currentJobs.length >= 8) return;

  const created = await orchestrator.createDiscoveryIntentWorkflow({
    keywords: ["工程师", "产品经理"],
    city: "Shanghai",
    jobType: "full_time"
  });
  const intentId = String(created?.intent?.intentId || "").trim();
  assertTrue(Boolean(intentId), "intentId should be created");

  await orchestrator.importDiscoveryOfflineJsonWorkflow(intentId, {
    candidateLimit: 20,
    resolutionLimit: 10,
    fallbackKeywords: ["工程师", "产品经理"],
    fallbackCity: "Shanghai",
    origin: "dashboard_bootstrap"
  });
}

async function main() {
  await seedJobsIfNeeded();
  await orchestrator.saveProfile({
    targetRoles: "工程师",
    strengths: "Python,Node.js",
    targetLocations: "上海",
    lightweightProfile: {
      targetRoles: ["工程师"],
      skills: ["Python", "Node.js"],
      preferredLocations: ["上海"],
      degree: "",
      acceptsNonTech: false
    }
  });

  const originalFetch = global.fetch;
  const originalEnv = {
    ENABLE_LLM_JOB_SCORING: process.env.ENABLE_LLM_JOB_SCORING,
    LLM_JOB_SCORING_TOP_N: process.env.LLM_JOB_SCORING_TOP_N,
    LLM_RANKING_MODE: process.env.LLM_RANKING_MODE,
    GLM_API_KEY: process.env.GLM_API_KEY,
    GLM_BASE_URL: process.env.GLM_BASE_URL,
    GLM_MODEL: process.env.GLM_MODEL
  };

  try {
    // 场景 1：LLM 关闭时，必须走规则评分且不调用 fetch。
    process.env.ENABLE_LLM_JOB_SCORING = "false";
    process.env.LLM_JOB_SCORING_TOP_N = "3";
    process.env.LLM_RANKING_MODE = "false";
    let disabledFetchCalls = 0;
    global.fetch = async () => {
      disabledFetchCalls += 1;
      throw new Error("fetch should not be called when ENABLE_LLM_JOB_SCORING=false");
    };
    const disabledResult = await orchestrator.getJobWorkspaceList();
    const disabledJobs = Array.isArray(disabledResult?.jobWorkspaceViewModels)
      ? disabledResult.jobWorkspaceViewModels
      : [];
    assertTrue(disabledJobs.length > 0, "disabled mode should still return jobs");
    assertTrue(disabledFetchCalls === 0, "disabled mode should not call LLM fetch");
    assertTrue(
      disabledJobs.every((jobVm) => String(jobVm?.scoringView?.scoringType || "") === "rule"),
      "disabled mode should keep rule scoring only"
    );

    // 场景 2：LLM 开启仅处理 TopN，且单条失败时回退规则评分。
    process.env.ENABLE_LLM_JOB_SCORING = "true";
    process.env.LLM_JOB_SCORING_TOP_N = "3";
    process.env.LLM_RANKING_MODE = "false";
    process.env.GLM_API_KEY = "test-key";
    process.env.GLM_BASE_URL = "https://glm.mock.local/v4";
    process.env.GLM_MODEL = "glm-4-flash";

    let enabledFetchCalls = 0;
    global.fetch = async () => {
      enabledFetchCalls += 1;
      const payloadByIndex = [
        {
          aiScore: 96,
          aiRecommendation: "apply",
          aiExplanation: "AI 判断该岗位与目标方向高度匹配。",
          aiMatchedSignals: ["岗位名称命中工程师", "技能命中 Python"],
          aiRisks: []
        },
        {
          aiScore: 71,
          aiRecommendation: "consider",
          aiExplanation: "AI 判断匹配度中等，建议先补齐关键信息。",
          aiMatchedSignals: ["地点偏好部分命中"],
          aiRisks: ["职责描述仍有不确定项"]
        }
      ];
      if (enabledFetchCalls === 3) {
        return {
          ok: true,
          async json() {
            return { choices: [{ message: { content: "{invalid_json}" } }] };
          }
        };
      }

      const payload = payloadByIndex[enabledFetchCalls - 1] || payloadByIndex[1];
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: JSON.stringify(payload) } }] };
        }
      };
    };

    const enabledResultFirst = await orchestrator.getJobWorkspaceList();
    const enabledJobsFirst = Array.isArray(enabledResultFirst?.jobWorkspaceViewModels)
      ? enabledResultFirst.jobWorkspaceViewModels
      : [];
    assertTrue(enabledJobsFirst.length > 3, "enabled mode should have enough jobs for TopN check");
    // 非阻塞模式下，第一次请求可能是 pending；等待后台任务后再读一次缓存结果。
    await new Promise((resolve) => setTimeout(resolve, 30));
    const enabledResultSecond = await orchestrator.getJobWorkspaceList();
    const enabledJobs = Array.isArray(enabledResultSecond?.jobWorkspaceViewModels)
      ? enabledResultSecond.jobWorkspaceViewModels
      : [];
    assertTrue(
      enabledFetchCalls >= 3 && enabledFetchCalls <= 6,
      `enabled mode should call LLM within TopN retry budget, got=${enabledFetchCalls}`
    );

    const aiJobs = enabledJobs.filter((jobVm) => String(jobVm?.scoringView?.scoringType || "") === "ai");
    const fallbackJobs = enabledJobs.filter(
      (jobVm) => String(jobVm?.scoringView?.llmMeta?.aiStatus || "") === "fallback"
    );
    assertTrue(aiJobs.length >= 1, "enabled mode second read should include ai scoring jobs from cache");
    assertTrue(fallbackJobs.length >= 1, "single-item LLM parse failure should mark fallback status");
    assertTrue(
      enabledJobs.every((jobVm) => !/applyflow\.local\/fallback/i.test(String(jobVm?.jobSummary?.sourceUrl || ""))),
      "jobs list should not contain fallback fake jobs"
    );

    console.log(
      `validate-job-llm-scoring-layer: disabled and enabled modes passed; TopN calls=${enabledFetchCalls}, aiJobs=${aiJobs.length}, fallbackJobs=${fallbackJobs.length}.`
    );
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

main().catch((error) => {
  console.error("validate-job-llm-scoring-layer failed:", error?.message || error);
  process.exitCode = 1;
});
