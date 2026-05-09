"use strict";

/**
 * 批次5 最终排序真实性验收导出
 * 输出：tmp/final_ranking_truth_batch5_close.json
 */
process.env.ENABLE_LLM_JOB_SCORING = "false";

const fs = require("node:fs");
const path = require("node:path");
const orchestrator = require("../../src/lib/orchestrator/workflow-controller");
const { buildJobScoringViewModel, attachScoringToJobWorkspaceViewModel } = require("../../src/lib/jobs/job-scoring-view-model");

const SEED_PATH = path.resolve(__dirname, "../../docs/eval/jobs-preference-eval.seed.json");
const OUTPUT_PATH = path.resolve(__dirname, "../../tmp/final_ranking_truth_batch5_close.json");
function parseBooleanArg(name = "", fallback = false) {
  const hit = process.argv.find((item) => String(item || "").startsWith(`${name}=`));
  if (!hit) return Boolean(fallback);
  const raw = String(hit.split("=")[1] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

const CASE_IDS = [
  "acceptance_true_single_data_analyst",
  "acceptance_true_single_pm",
  "acceptance_true_single_algorithm",
  "acceptance_broad_support_bundle_guard",
  "acceptance_sales_ops_pm_bundle_guard",
  "acceptance_incidental_algorithm_keyword_guard"
];

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isEntranceType(opportunityType = "") {
  return ["broad_recruitment_entry", "high_value_role_pool"].includes(String(opportunityType || "").trim());
}

function isBundledLike(scoring = {}) {
  const jdType = String(scoring?.jobFeaturesView?.jdBlockStructureType || "").trim().toLowerCase();
  return Boolean(scoring?.jobFeaturesView?.likelyBundledJD) || ["bundled_multi_role", "broad_recruitment", "internship_rotation", "composite_high_value"].includes(jdType);
}

function isEvidenceLayeringCorrect(scoring = {}) {
  const evidenceType = String(scoring.roleFitEvidenceType || scoring.roleFitDetails?.evidenceType || "").trim().toLowerCase();
  const detailType = String(scoring.roleFitDetails?.evidenceType || "").trim().toLowerCase();
  if (!evidenceType || !detailType) return false;
  if (isBundledLike(scoring) && evidenceType === "primary_role_match") return false;
  return true;
}

function isSinglePriorityAligned(row = {}) {
  if (String(row.opportunityType || "") === "single_role_job") return true;
  if (String(row.opportunityType || "") === "high_value_role_pool" && Number(row.roleFitDetails?.score || 0) >= 75) return true;
  return false;
}

function shouldPostpone(row = {}) {
  return isEntranceType(row.opportunityType) && Number(row.roleFitDetails?.score || 0) >= 70;
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
  const row = {
    rank: index + 1,
    jobId: String(jobVm?.id || ""),
    title: String(summary.title || ""),
    opportunityType: String(scoring.opportunityType || ""),
    roleFitEvidenceType: String(scoring.roleFitEvidenceType || roleFitDetails.evidenceType || "").trim(),
    roleFitDetails: {
      score: Number(roleFitDetails.score ?? scoring.roleFit ?? 0),
      evidenceType: String(roleFitDetails.evidenceType || scoring.roleFitEvidenceType || "").trim()
    },
    fiveDimScores: {
      role: Number(radar.role ?? 0),
      industry: Number(radar.industry ?? 0),
      location: Number(radar.location ?? 0),
      company: Number(radar.company ?? 0),
      accessibility: Number(radar.accessibility ?? 0)
    },
    userPriorityScore: Number(scoring.userPriorityScore ?? scoring.score ?? 0),
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
    userPerceivedPriority: isSinglePriorityAligned({ opportunityType: scoring.opportunityType, roleFitDetails }),
    evidenceLayeringCorrect: isEvidenceLayeringCorrect(scoring),
    isEntranceType: isEntranceType(scoring.opportunityType),
    shouldPostpone: shouldPostpone({ opportunityType: scoring.opportunityType, roleFitDetails }),
    misRaisedSingleRoleJob: Boolean(
      isBundledLike(scoring) &&
      Number(scoring.roleFit || 0) >= 70 &&
      String(scoring.opportunityType || "").trim().toLowerCase() === "single_role_job"
    ),
    notes: []
  };
  if (row.misRaisedSingleRoleJob) row.notes.push("高 roleFit 结构化入口岗位被误抬为 single_role_job");
  if (!row.evidenceLayeringCorrect) row.notes.push("evidence 分层异常");
  return row;
}

function buildSyntheticCases() {
  return [
    { jobId: "synthetic_empty", title: "", description: "", profile: { targetRoles: ["数据分析"], skills: ["SQL"], preferredLocations: ["上海"] } },
    { jobId: "synthetic_null", title: null, description: null, profile: { targetRoles: ["产品经理"], skills: ["PRD"], preferredLocations: [] } },
    { jobId: "synthetic_duplicate_1", title: "数据分析师", description: "负责数据分析和报表", profile: { targetRoles: ["数据分析"], skills: ["Python"], preferredLocations: ["上海"] } },
    { jobId: "synthetic_incidental", title: "运营专员（会做数据报表）", description: "活动运营", profile: { targetRoles: ["数据分析"], skills: ["Python"], preferredLocations: ["上海"] } },
    { jobId: "synthetic_multi_role", title: "销售 / 运营 / 数据分析", description: "多岗混招", profile: { targetRoles: ["数据分析"], skills: ["SQL"], preferredLocations: ["北京"] } },
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
    const job = { id: item.jobId, title: item.title, description: item.description, location: "上海", company: "Synthetic Co" };
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
    const vm = attachScoringToJobWorkspaceViewModel({ id: item.jobId, jobSummary: { title: String(item.title || ""), company: "Synthetic Co", location: "上海" } }, scoringView);
    rows.push(summarizeRow(vm, 0));
  }
  return rows;
}

function computeAcceptanceStyleSignals(caseRows = []) {
  const trueSingleCases = caseRows.filter((item) => /^acceptance_true_single_/.test(String(item.caseId || "")));
  const results = trueSingleCases.map((item) => {
    const top10 = toArray(item.rows);
    const firstRank = (type) => {
      const found = top10.find((row) => String(row.opportunityType || "") === type);
      return found ? Number(found.rank || 0) : null;
    };
    const single = firstRank("single_role_job");
    const broad = firstRank("broad_recruitment_entry");
    const high = firstRank("high_value_role_pool");
    return {
      caseId: item.caseId,
      single,
      broad,
      high,
      trueSinglePriority: single !== null && (broad === null || single < broad),
      poolVsSingleDisplacement: single !== null && high !== null && high < single
    };
  });
  const total = results.length || 1;
  return {
    details: results,
    trueSinglePriorityRate: results.filter((item) => item.trueSinglePriority).length / total,
    poolVsSingleDisplacementRate: results.filter((item) => item.poolVsSingleDisplacement).length / total
  };
}

async function main() {
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
  const cases = toArray(seed.cases).filter((item) => CASE_IDS.includes(String(item.id || "")));
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
  const acceptanceSignals = computeAcceptanceStyleSignals(caseRows);

  const coldStartStable = parseBooleanArg("--coldStartStable", false);
  const crossUserProfileStable = parseBooleanArg("--crossUserProfileStable", false);

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceSeed: SEED_PATH,
    coldStartStable,
    crossUserProfileStable,
    acceptanceSignals,
    cases: caseRows,
    syntheticRows
  };
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`final ranking truth exported: ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error("export-final-ranking-truth-batch5-close failed:", error?.message || error);
  process.exitCode = 1;
});
