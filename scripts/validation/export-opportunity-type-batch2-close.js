"use strict";

/**
 * 导出 Batch2 收口结果：
 * - 6 个对抗 acceptance case（每个 top10）
 * - 6 条 synthetic（含 low_quality_mixed_posting 命中样本）
 * 输出：tmp/opportunity_type_batch2_close.json
 */
process.env.ENABLE_LLM_JOB_SCORING = "false";

const fs = require("node:fs");
const path = require("node:path");
const orchestrator = require("../../src/lib/orchestrator/workflow-controller");
const { buildJobScoringViewModel, attachScoringToJobWorkspaceViewModel } = require("../../src/lib/jobs/job-scoring-view-model");

const SEED_PATH = path.resolve(__dirname, "../../docs/eval/jobs-preference-eval.seed.json");
const OUTPUT_PATH = path.resolve(__dirname, "../../tmp/opportunity_type_batch2_close.json");

const TARGET_CASE_IDS = [
  "acceptance_true_single_data_analyst",
  "acceptance_broad_support_bundle_guard",
  "acceptance_incidental_data_keyword_guard",
  "acceptance_true_single_pm",
  "acceptance_sales_ops_pm_bundle_guard",
  "acceptance_true_single_algorithm"
];

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isBundledLike(scoring = {}) {
  const jdType = String(scoring?.jobFeaturesView?.jdBlockStructureType || "").trim().toLowerCase();
  return Boolean(scoring?.jobFeaturesView?.likelyBundledJD) || ["bundled_multi_role", "broad_recruitment", "internship_rotation", "composite_high_value"].includes(jdType);
}

function isMisRaisedSingle(scoring = {}) {
  return (
    isBundledLike(scoring) &&
    Number(scoring.roleFit || 0) >= 70 &&
    String(scoring.opportunityType || "").trim().toLowerCase() === "single_role_job"
  );
}

function isEvidenceLayeringCorrect(scoring = {}) {
  const evidenceType = String(scoring.roleFitEvidenceType || scoring.roleFitDetails?.evidenceType || "").trim().toLowerCase();
  const detailType = String(scoring.roleFitDetails?.evidenceType || "").trim().toLowerCase();
  if (!evidenceType || !detailType) return false;
  if (isBundledLike(scoring) && evidenceType === "primary_role_match") return false;
  return true;
}

function pickProfileFromCase(seedCase = {}) {
  const pref = seedCase?.userPreference?.jobPreferenceProfile || {};
  return {
    targetRoles: toArray(pref.targetRoles),
    skills: toArray(pref.skills),
    preferredLocations: toArray(pref.preferredLocations),
    degree: "",
    acceptsNonTech: false
  };
}

function summarizeRow(jobVm = {}, index = 0) {
  const scoring = jobVm?.scoringView || {};
  const summary = jobVm?.jobSummary || {};
  const verdict = scoring?.decisionVerdict || {};
  const radar = scoring?.userPriorityDimensions || {};
  const roleFitDetails = scoring?.roleFitDetails && typeof scoring.roleFitDetails === "object" ? scoring.roleFitDetails : {};
  const evidenceType = String(scoring.roleFitEvidenceType || roleFitDetails.evidenceType || "").trim();
  const misRaised = isMisRaisedSingle(scoring);
  return {
    rank: index + 1,
    jobId: String(jobVm?.id || ""),
    title: String(summary.title || ""),
    opportunityType: String(scoring.opportunityType || ""),
    misRaisedSingleRoleJob: misRaised,
    roleFitEvidenceType: evidenceType,
    roleFitDetails: {
      score: Number(roleFitDetails.score ?? scoring.roleFit ?? 0),
      evidenceType: String(roleFitDetails.evidenceType || evidenceType || "").trim()
    },
    userPriorityScore: Number(scoring.userPriorityScore ?? scoring.score ?? 0),
    fiveDimScores: {
      role: Number(radar.role ?? 0),
      industry: Number(radar.industry ?? 0),
      location: Number(radar.location ?? 0),
      company: Number(radar.company ?? 0),
      accessibility: Number(radar.accessibility ?? 0)
    },
    grade: String(verdict.grade || ""),
    verdict: String(verdict.verdict || ""),
    uiDisplay: {
      roleMatchSummary: String(scoring.roleMatchSummary || ""),
      opportunityTypeLabel: String(scoring.opportunityTypeLabel || ""),
      opportunityTypeSummary: String(scoring.opportunityTypeSummary || "")
    },
    compare: {
      roleFit: Number(scoring.roleFit || 0),
      industryFit: Number(scoring.industryFit || 0),
      locationFit: Number(scoring.locationFit || 0),
      companyFit: Number(scoring.companyFit || 0),
      accessibilityFit: Number(scoring.applicationAccessibilityFit || 0),
      score: Number(scoring.score || 0),
      userPriorityScore: Number(scoring.userPriorityScore ?? scoring.score ?? 0),
      grade: String(verdict.grade || ""),
      verdict: String(verdict.verdict || "")
    },
    radar: {
      role: Number(radar.role ?? 0),
      industry: Number(radar.industry ?? 0),
      location: Number(radar.location ?? 0),
      company: Number(radar.company ?? 0),
      accessibility: Number(radar.accessibility ?? 0)
    },
    evidenceLayeringCorrect: isEvidenceLayeringCorrect(scoring),
    notes: misRaised ? ["bundled/internship/multi-role 被误抬为 single_role_job"] : []
  };
}

function buildSyntheticCases() {
  return [
    { jobId: "synthetic_empty_title", title: "", description: "", profile: { targetRoles: ["数据分析"], skills: ["Python"], preferredLocations: ["上海"] } },
    { jobId: "synthetic_incidental_keyword", title: "运营专员（会做数据报表）", description: "负责活动执行与客服协调", profile: { targetRoles: ["数据分析"], skills: ["Python"], preferredLocations: ["上海"] } },
    { jobId: "synthetic_multi_role_bundle", title: "销售 / 客服 / 数据分析", description: "多岗位轮岗", profile: { targetRoles: ["数据分析"], skills: ["SQL"], preferredLocations: ["北京"] } },
    { jobId: "synthetic_internship_rotation", title: "管培生 / 算法工程师 / 产品助理", description: "多方向轮岗", profile: { targetRoles: ["算法工程师"], skills: ["Python"], preferredLocations: ["上海"] } },
    { jobId: "synthetic_duplicate_job_1", title: "数据分析师", description: "负责数据分析与报表", profile: { targetRoles: ["数据分析"], skills: ["SQL"], preferredLocations: ["上海"] } },
    {
      jobId: "synthetic_low_quality_mixed_posting",
      title: "销售 / 客服 / 渠道 / 运营 / 数据报表",
      description: "多岗位混招，职责泛化，商业线索重",
      profile: { targetRoles: ["数据分析"], skills: ["SQL"], preferredLocations: ["上海"] },
      baseScoringView: {
        jobFeaturesView: {
          likelyBundledJD: true,
          isMixedRoleJD: true,
          jdBlockStructureType: "bundled_multi_role",
          sourceCommercialNoiseRisk: 0.95,
          productionSourceConfidence: "low",
          sourceFraudRisk: "high",
          semanticConfidenceTier: "low",
          roleSemanticPurity: "low",
          roleStructureType: "bundled"
        }
      }
    }
  ];
}

async function buildSyntheticRows() {
  const rows = [];
  for (const item of buildSyntheticCases()) {
    const job = {
      id: item.jobId,
      title: item.title,
      description: item.description,
      location: "上海",
      company: "Synthetic Co"
    };
    const scoringView = buildJobScoringViewModel({
      job,
      lightweightProfile: item.profile,
      jobPreferenceProfile: {
        targetRoles: toArray(item.profile.targetRoles),
        skills: toArray(item.profile.skills),
        preferredLocations: toArray(item.profile.preferredLocations)
      },
      preferenceSource: "jobPreferenceProfile",
      baseScoringView: item.baseScoringView || null
    });
    const vm = attachScoringToJobWorkspaceViewModel({
      id: item.jobId,
      jobSummary: { title: String(item.title || ""), company: "Synthetic Co", location: "上海" }
    }, scoringView);
    rows.push(summarizeRow(vm, 0));
  }
  return rows;
}

async function main() {
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
  const cases = toArray(seed.cases).filter((item) => TARGET_CASE_IDS.includes(String(item.id || "")));
  const caseRows = [];

  for (const seedCase of cases) {
    const lightweightProfile = pickProfileFromCase(seedCase);
    await orchestrator.saveProfile({
      lightweightProfile,
      jobPreferenceProfile: seedCase?.userPreference?.jobPreferenceProfile || {}
    });
    const list = await orchestrator.getJobWorkspaceList();
    const top10 = toArray(list?.jobWorkspaceViewModels).slice(0, 10);
    caseRows.push({
      caseId: String(seedCase.id || ""),
      description: String(seedCase.description || ""),
      rows: top10.map((jobVm, idx) => summarizeRow(jobVm, idx))
    });
  }

  const syntheticRows = await buildSyntheticRows();
  const payload = {
    generatedAt: new Date().toISOString(),
    sourceSeed: SEED_PATH,
    cases: caseRows,
    syntheticRows
  };
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`opportunity type closeout exported: ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error("export-opportunity-type-batch2-close failed:", error?.message || error);
  process.exitCode = 1;
});
