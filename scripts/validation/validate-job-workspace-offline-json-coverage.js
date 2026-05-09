"use strict";

process.env.ENABLE_LLM_JOB_SCORING = "false";

const orchestrator = require("../../src/lib/orchestrator/workflow-controller");
const store = require("../../src/server/store");

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function countMatches(jobs = []) {
  const counters = {
    financeMatched: 0,
    educationMatched: 0,
    gameMatched: 0,
    aiMatched: 0
  };
  jobs.forEach((jobVm) => {
    const scoring = jobVm?.scoringView || {};
    const title = String(jobVm?.jobSummary?.title || "");
    const industry = String(scoring.inferredIndustry || "");
    if (industry === "金融") counters.financeMatched += 1;
    if (industry === "教育") counters.educationMatched += 1;
    if (industry === "游戏") counters.gameMatched += 1;
    if (industry === "AI/算法" || /AI|人工智能|算法|机器学习|大模型|数据科学/i.test(title)) counters.aiMatched += 1;
  });
  return counters;
}

async function collectForProfile(profile = {}) {
  orchestrator.saveOnboardingProfile(profile);
  const result = await orchestrator.getJobWorkspaceList();
  return Array.isArray(result?.jobWorkspaceViewModels) ? result.jobWorkspaceViewModels : [];
}

async function main() {
  const originalProfile = store.getProfile();

  try {
    const financeJobs = await collectForProfile({
      targetRoles: ["金融研究员"],
      preferredIndustries: ["金融"],
      skills: ["投研", "行业研究"],
      preferredLocations: ["上海", "北京"]
    });
    const coverage = countMatches(financeJobs);
    const financeTop5 = financeJobs.slice(0, 5).filter((job) => job?.scoringView?.inferredIndustry === "金融").length;

    const educationJobs = await collectForProfile({
      targetRoles: ["教师"],
      preferredIndustries: ["教育"],
      skills: ["教研", "课程"],
      preferredLocations: ["上海", "北京"]
    });
    const educationTop5 = educationJobs.slice(0, 5).filter((job) => job?.scoringView?.inferredIndustry === "教育").length;

    assertTrue(financeJobs.length > 871, "jobs workspace count should increase beyond previous 871 baseline");
    assertTrue(coverage.financeMatched > 0, "financeMatched should be > 0");
    assertTrue(coverage.educationMatched > 0, "educationMatched should be > 0");
    assertTrue(coverage.gameMatched > 0, "gameMatched should be > 0");
    assertTrue(coverage.aiMatched > 0, "aiMatched should be > 0");
    assertTrue(financeTop5 >= 3, "preferredIndustries=[金融] should produce at least 3 finance jobs in Top5");
    assertTrue(educationTop5 >= 3, "preferredIndustries=[教育] should produce at least 3 education jobs in Top5");
    assertTrue(
      financeJobs.some((job) => /^https?:\/\//i.test(String(job?.jobSummary?.sourceUrl || ""))),
      "at least one job should preserve real apply/notice URL"
    );

    console.log(
      JSON.stringify(
        {
          totalJobs: financeJobs.length,
          coverage,
          financeTop5,
          educationTop5
        },
        null,
        2
      )
    );
  } finally {
    if (originalProfile) {
      orchestrator.saveOnboardingProfile(originalProfile);
    }
  }
}

main().catch((error) => {
  console.error("validate-job-workspace-offline-json-coverage failed:", error?.message || error);
  process.exitCode = 1;
});
