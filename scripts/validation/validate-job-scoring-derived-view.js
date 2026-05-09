"use strict";

process.env.ENABLE_LLM_JOB_SCORING = "false";

const orchestrator = require("../../src/lib/orchestrator/workflow-controller");
const { buildJobScoringViewModel } = require("../../src/lib/jobs/job-scoring-view-model");

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function isEngineerRole(title = "") {
  const text = String(title || "").toLowerCase();
  return text.includes("工程师") || text.includes("engineer");
}

function buildSyntheticScoring({ id, title, description, profile, baseScoringView = null }) {
  return buildJobScoringViewModel({
    job: {
      id,
      title,
      description,
      location: "上海",
      company: "Synthetic Co"
    },
    lightweightProfile: profile,
    jobPreferenceProfile: {
      targetRoles: Array.isArray(profile?.targetRoles) ? profile.targetRoles : [],
      skills: Array.isArray(profile?.skills) ? profile.skills : [],
      preferredLocations: Array.isArray(profile?.preferredLocations) ? profile.preferredLocations : []
    },
    preferenceSource: "jobPreferenceProfile",
    baseScoringView
  });
}

function validateSyntheticOpportunityBoundaries() {
  const syntheticCases = [
    {
      id: "synthetic_boundary_internship_rotation_high_role_fit",
      title: "算法工程师 全栈工程师 测试工程师 Agent产品经理 AIGC产品经理 AI训练师",
      description: "校招多方向轮岗，入职后根据业务分配算法、全栈、测试或训练师方向。",
      profile: { targetRoles: ["算法工程师"], skills: ["Python"], preferredLocations: ["上海"] },
      baseScoringView: {
        jobFeaturesView: {
          jdBlockStructureType: "internship_rotation",
          roleStructureType: "bundled",
          semanticConfidenceTier: "medium",
          roleSemanticPurity: "medium",
          productionSourceConfidence: "medium",
          sourceCommercialNoiseRisk: 0.2
        }
      },
      shouldBeSingle: false
    },
    {
      id: "synthetic_boundary_bundled_multi_role_high_role_fit",
      title: "数据分析师 / 产品经理 / 运营策略",
      description: "多岗位合集，候选人可投递数据分析、产品或运营策略方向。",
      profile: { targetRoles: ["数据分析"], skills: ["SQL"], preferredLocations: ["上海"] },
      baseScoringView: {
        jobFeaturesView: {
          likelyBundledJD: true,
          jdBlockStructureType: "bundled_multi_role",
          roleStructureType: "bundled",
          semanticConfidenceTier: "medium",
          roleSemanticPurity: "medium",
          productionSourceConfidence: "medium",
          sourceCommercialNoiseRisk: 0.2
        }
      },
      shouldBeSingle: false
    },
    {
      id: "synthetic_boundary_true_single_title",
      title: "数据分析师",
      description: "负责业务数据分析、SQL取数、指标体系建设和报表分析。",
      profile: { targetRoles: ["数据分析"], skills: ["SQL"], preferredLocations: ["上海"] },
      shouldBeSingle: true
    },
    {
      id: "synthetic_boundary_single_with_specialization",
      title: "算法工程师（推荐系统方向）",
      description: "负责推荐算法模型训练、召回排序优化和线上效果分析。",
      profile: { targetRoles: ["算法工程师"], skills: ["Python"], preferredLocations: ["上海"] },
      shouldBeSingle: true
    }
  ];

  syntheticCases.forEach((item) => {
    const scoring = buildSyntheticScoring(item);
    const opportunityType = String(scoring?.opportunityType || "").trim().toLowerCase();
    if (item.shouldBeSingle) {
      assertTrue(opportunityType === "single_role_job", `${item.id} should remain single_role_job`);
    } else {
      assertTrue(opportunityType !== "single_role_job", `${item.id} should not be single_role_job`);
    }
  });
}

async function seedJobsIfNeeded() {
  const current = await orchestrator.getJobWorkspaceList();
  const currentJobs = Array.isArray(current?.jobWorkspaceViewModels) ? current.jobWorkspaceViewModels : [];
  if (currentJobs.length >= 8) return;

  const created = await orchestrator.createDiscoveryIntentWorkflow({
    keywords: ["工程师", "AI Product Manager"],
    city: "Shanghai",
    jobType: "full_time"
  });
  const intentId = String(created?.intent?.intentId || "").trim();
  assertTrue(Boolean(intentId), "intentId should be created");

  await orchestrator.importDiscoveryOfflineJsonWorkflow(intentId, {
    candidateLimit: 20,
    resolutionLimit: 10,
    fallbackKeywords: ["工程师", "AI Product Manager"],
    fallbackCity: "Shanghai",
    origin: "dashboard_bootstrap"
  });
}

async function main() {
  validateSyntheticOpportunityBoundaries();

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

  const scored = await orchestrator.getJobWorkspaceList();
  const scoredJobs = Array.isArray(scored?.jobWorkspaceViewModels) ? scored.jobWorkspaceViewModels : [];
  assertTrue(scoredJobs.length > 0, "job workspace list should not be empty");

  scoredJobs.forEach((jobVm) => {
    const jdStructure = String(jobVm?.scoringView?.jobFeaturesView?.jdBlockStructureType || "").trim().toLowerCase();
    const isBundledLike =
      Boolean(jobVm?.scoringView?.jobFeaturesView?.likelyBundledJD) ||
      ["bundled_multi_role", "broad_recruitment", "internship_rotation", "composite_high_value"].includes(jdStructure);
    assertTrue(Number.isFinite(Number(jobVm?.scoringView?.score)), "each job should include scoringView.score");
    assertTrue(
      String(jobVm?.scoringView?.roleFitEvidenceType || "").trim().length > 0,
      "each job should include non-empty scoringView.roleFitEvidenceType"
    );
    assertTrue(
      jobVm?.scoringView?.roleFitDetails && typeof jobVm.scoringView.roleFitDetails === "object",
      "each job should include scoringView.roleFitDetails object"
    );
    assertTrue(
      String(jobVm?.scoringView?.roleFitDetails?.evidenceType || "").trim().length > 0,
      "each job should include non-empty scoringView.roleFitDetails.evidenceType"
    );
    assertTrue(
      String(jobVm?.scoringView?.explanation || "").trim().length > 0,
      "each job should include scoringView.explanation"
    );
    if (isBundledLike) {
      assertTrue(
        String(jobVm?.scoringView?.roleFitEvidenceType || "").trim().toLowerCase() !== "primary_role_match",
        "bundled/multi-role/internship/composite jobs should not be labeled as primary_role_match"
      );
      if (Number(jobVm?.scoringView?.roleFit || 0) >= 70) {
        const opportunityType = String(jobVm?.scoringView?.opportunityType || "").trim().toLowerCase();
        const evidenceType = String(jobVm?.scoringView?.roleFitEvidenceType || "").trim().toLowerCase();
        assertTrue(
          !(opportunityType === "single_role_job" && evidenceType === "primary_role_match"),
          "high roleFit bundled/multi-role/internship/composite jobs with primary_role_match should not be labeled as single_role_job"
        );
      }
    }
  });

  const engineerIndex = scoredJobs.findIndex((jobVm) => isEngineerRole(jobVm?.jobSummary?.title));
  const nonEngineerIndex = scoredJobs.findIndex((jobVm) => !isEngineerRole(jobVm?.jobSummary?.title));
  assertTrue(engineerIndex >= 0, "should contain at least one engineer job");
  assertTrue(nonEngineerIndex >= 0, "should contain at least one non-engineer job");

  for (let index = 0; index < scoredJobs.length - 1; index += 1) {
    const currentScore = Number(scoredJobs[index]?.scoringView?.score || 0);
    const nextScore = Number(scoredJobs[index + 1]?.scoringView?.score || 0);
    assertTrue(currentScore >= nextScore, "jobs should be sorted by score desc when preference exists");
  }

  await orchestrator.saveProfile({
    lightweightProfile: {
      targetRoles: [],
      skills: [],
      preferredLocations: [],
      degree: "",
      acceptsNonTech: false
    }
  });
  const fallback = await orchestrator.getJobWorkspaceList();
  const fallbackJobs = Array.isArray(fallback?.jobWorkspaceViewModels) ? fallback.jobWorkspaceViewModels : [];
  assertTrue(fallbackJobs.length > 0, "fallback job list should still be available");
  assertTrue(
    fallbackJobs.every((jobVm) => String(jobVm?.scoringView?.explanation || "").trim().length > 0),
    "fallback mode should still provide explanation without throwing"
  );

  console.log(`validate-job-scoring-derived-view: checked ${scoredJobs.length} jobs with scoring and fallback mode.`);
}

main().catch((error) => {
  console.error("validate-job-scoring-derived-view failed:", error?.message || error);
  process.exitCode = 1;
});
