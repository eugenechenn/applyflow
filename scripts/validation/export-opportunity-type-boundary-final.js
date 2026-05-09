"use strict";

/**
 * 导出 OpportunityType derived-view 边界最终收口证据。
 * 输出：tmp/opportunity_type_boundary_final.json
 */
process.env.ENABLE_LLM_JOB_SCORING = "false";

const fs = require("node:fs");
const path = require("node:path");
const orchestrator = require("../../src/lib/orchestrator/workflow-controller");
const { buildJobScoringViewModel } = require("../../src/lib/jobs/job-scoring-view-model");

const OUTPUT_PATH = path.resolve(__dirname, "../../tmp/opportunity_type_boundary_final.json");

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function countTitleSegments(title = "", scoring = {}) {
  const text = String(title || "").trim();
  const separatorSegments = text.split(/[\/|｜、，,；;\s]+/).map((item) => item.trim()).filter(Boolean);
  const roleAnchorHits = (text.match(/工程师|产品经理|数据分析师|分析师|运营|销售|客服|AI训练师|测试/g) || []).length;
  const classificationSegments = toArray(scoring.secondaryRoleSegments).length + (String(scoring.dominantRoleSegment || "").trim() ? 1 : 0);
  return Math.max(separatorSegments.length, roleAnchorHits, classificationSegments);
}

function isBundledStructure(scoring = {}) {
  const features = scoring.jobFeaturesView || {};
  const jdBlockStructureType = String(features.jdBlockStructureType || "").trim().toLowerCase();
  const roleStructureType = String(features.roleStructureType || "").trim().toLowerCase();
  return (
    Boolean(features.likelyBundledJD) ||
    ["bundled_multi_role", "broad_recruitment", "internship_rotation", "composite_high_value"].includes(jdBlockStructureType) ||
    ["bundled", "broad"].includes(roleStructureType)
  );
}

function inferBeforeOpportunityType(scoring = {}) {
  const jdBlockStructureType = String(scoring?.jobFeaturesView?.jdBlockStructureType || "").trim().toLowerCase();
  const evidenceType = String(scoring.roleFitEvidenceType || scoring.roleFitDetails?.evidenceType || "").trim().toLowerCase();
  const wasMissedInternshipRotation =
    jdBlockStructureType === "internship_rotation" &&
    Number(scoring.roleFit || 0) >= 70 &&
    ["primary_role_match", "explicit_subrole_match", "adjacent_role_match"].includes(evidenceType);
  if (wasMissedInternshipRotation) return "single_role_job";
  return String(scoring.opportunityType || "");
}

function summarizeRow({ id = "", title = "", scoring = {}, expectedSingle = false, source = "live_workspace" } = {}) {
  const features = scoring.jobFeaturesView || {};
  const after = String(scoring.opportunityType || "");
  const before = inferBeforeOpportunityType(scoring);
  const jdBlockStructureType = String(features.jdBlockStructureType || "").trim();
  const row = {
    source,
    jobId: String(id || ""),
    title: String(title || ""),
    opportunityTypeBefore: before,
    opportunityTypeAfter: after,
    roleFitEvidenceType: String(scoring.roleFitEvidenceType || scoring.roleFitDetails?.evidenceType || ""),
    roleFitDetails: scoring.roleFitDetails || {},
    jdBlockStructureType,
    structureType: String(features.roleStructureType || ""),
    segmentCount: countTitleSegments(title, scoring),
    isBundledStructure: isBundledStructure(scoring),
    isInternshipRotation: jdBlockStructureType.toLowerCase() === "internship_rotation",
    expectedSingleRoleJob: Boolean(expectedSingle),
    matchesExpectation: expectedSingle ? after === "single_role_job" : after !== "single_role_job",
    trueSingleMisclassified: expectedSingle && after !== "single_role_job",
    notes: []
  };
  if (row.isInternshipRotation) row.notes.push("internship_rotation 由 jdBlockStructureType 触发");
  if (before === "single_role_job" && after !== "single_role_job") row.notes.push("pre-fix 会绕过 bundled-like 门禁并进入 single_role_job，当前已收口");
  if (row.trueSingleMisclassified) row.notes.push("true single 被误伤");
  return row;
}

function buildSyntheticScoring({ id, title, description, profile, baseScoringView = null }) {
  return buildJobScoringViewModel({
    job: { id, title, description, location: "上海", company: "Synthetic Co" },
    lightweightProfile: profile,
    jobPreferenceProfile: {
      targetRoles: toArray(profile.targetRoles),
      skills: toArray(profile.skills),
      preferredLocations: toArray(profile.preferredLocations)
    },
    preferenceSource: "jobPreferenceProfile",
    baseScoringView
  });
}

function buildSyntheticRows() {
  const cases = [
    {
      id: "synthetic_boundary_internship_rotation_high_role_fit",
      title: "算法工程师 / 全栈工程师 / 测试工程师 / AI训练师",
      description: "校招多方向轮岗，入职后根据业务分配算法、全栈、测试或训练师方向。",
      profile: { targetRoles: ["算法工程师"], skills: ["Python"], preferredLocations: ["上海"] },
      expectedSingle: false,
      baseScoringView: {
        jobFeaturesView: {
          jdBlockStructureType: "internship_rotation",
          roleStructureType: "bundled",
          semanticConfidenceTier: "medium",
          roleSemanticPurity: "medium",
          productionSourceConfidence: "medium",
          sourceCommercialNoiseRisk: 0.2
        }
      }
    },
    {
      id: "synthetic_boundary_bundled_multi_role_high_role_fit",
      title: "数据分析师 / 产品经理 / 运营策略",
      description: "多岗位合集，候选人可投递数据分析、产品或运营策略方向。",
      profile: { targetRoles: ["数据分析"], skills: ["SQL"], preferredLocations: ["上海"] },
      expectedSingle: false,
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
      }
    },
    {
      id: "synthetic_boundary_true_single_title",
      title: "数据分析师",
      description: "负责业务数据分析、SQL取数、指标体系建设和报表分析。",
      profile: { targetRoles: ["数据分析"], skills: ["SQL"], preferredLocations: ["上海"] },
      expectedSingle: true
    },
    {
      id: "synthetic_boundary_single_with_specialization",
      title: "算法工程师（推荐系统方向）",
      description: "负责推荐算法模型训练、召回排序优化和线上效果分析。",
      profile: { targetRoles: ["算法工程师"], skills: ["Python"], preferredLocations: ["上海"] },
      expectedSingle: true
    }
  ];

  return cases.map((item) => {
    const scoring = buildSyntheticScoring(item);
    return summarizeRow({
      id: item.id,
      title: item.title,
      scoring,
      expectedSingle: item.expectedSingle,
      source: "synthetic_regression"
    });
  });
}

async function main() {
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
  const list = await orchestrator.getJobWorkspaceList();
  const jobs = toArray(list.jobWorkspaceViewModels);
  const liveRows = jobs
    .filter((jobVm) => {
      const scoring = jobVm.scoringView || {};
      return isBundledStructure(scoring) && Number(scoring.roleFit || 0) >= 70;
    })
    .map((jobVm) => summarizeRow({
      id: jobVm.id,
      title: jobVm.jobSummary?.title,
      scoring: jobVm.scoringView || {},
      expectedSingle: false,
      source: "live_workspace"
    }));

  const syntheticRows = buildSyntheticRows();
  const rows = [...liveRows, ...syntheticRows];
  const payload = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalRows: rows.length,
      mismatches: rows.filter((row) => !row.matchesExpectation).length,
      trueSingleMisclassified: rows.filter((row) => row.trueSingleMisclassified).length,
      internshipSingleRoleAfter: rows.filter((row) => row.isInternshipRotation && row.opportunityTypeAfter === "single_role_job").length
    },
    rows
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`opportunity type boundary exported: ${OUTPUT_PATH}`);
  console.log(JSON.stringify(payload.summary, null, 2));

  await orchestrator.saveProfile({
    lightweightProfile: {
      targetRoles: [],
      skills: [],
      preferredLocations: [],
      degree: "",
      acceptsNonTech: false
    }
  });
}

main().catch((error) => {
  console.error("export-opportunity-type-boundary-final failed:", error?.message || error);
  process.exitCode = 1;
});
