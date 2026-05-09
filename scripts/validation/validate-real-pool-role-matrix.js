"use strict";

/**
 * 真实岗位池多岗位画像矩阵验证。
 * 覆盖 PM/数据/算法/研发/测试/运营/研究等入口，按 Top100 与供给感知规则防止合集子岗位再次压低真实用户价值排序。
 */
process.env.ENABLE_LLM_JOB_SCORING = "false";

const orchestrator = require("../../src/lib/orchestrator/workflow-controller");

const BASE_LOCATIONS = ["上海", "北京", "深圳"];
const EXCLUDED_ROLES = ["销售", "客服", "行政", "培训"];
const TOP_N = 100;
const HIGH_CONFIDENCE_ROLE_EVIDENCE = new Set(["primary_role_match", "explicit_subrole_match"]);
const CASES = [
  { id: "pm", role: "产品经理", industry: "互联网", skills: ["PRD", "需求分析"], minTop100Grade: "B" },
  { id: "data", role: "数据分析师", industry: "互联网", skills: ["SQL", "Python"], minTop100Grade: "B" },
  { id: "algorithm", role: "算法工程师", industry: "AI/算法", skills: ["Python", "机器学习"], minTop100Grade: "B" },
  { id: "backend", role: "后端开发工程师", industry: "互联网", skills: ["Java", "Go"], minTop100Grade: "B" },
  { id: "frontend", role: "前端开发工程师", industry: "互联网", skills: ["JavaScript", "Vue"], minTop100Grade: "B" },
  { id: "test", role: "测试工程师", industry: "互联网", skills: ["测试", "自动化测试"], minTop100Grade: "B" },
  { id: "operations", role: "运营", industry: "互联网", skills: ["用户运营", "数据分析"], minTop100Grade: "B" },
  { id: "research", role: "研究员", industry: "金融", skills: ["研究", "Python"], minTop100Grade: "B" },
  { id: "finance_research", role: "金融研究员", industry: "金融", skills: ["投研", "量化研究"], minTop100Grade: "B" }
];

const PM_EXPECTED_TOP5 = ["舒客电商", "小红书RPT产品培训生计划", "从平技术", "云帐房", "快仓智能"];

function gradeRank(grade = "") {
  return { A: 5, B: 4, C: 3, D: 2, F: 1 }[String(grade || "").trim().toUpperCase()] || 0;
}

function buildProfile(testCase = {}) {
  return {
    jobPreferenceProfile: {
      targetRoles: [testCase.role],
      excludedRoles: EXCLUDED_ROLES,
      preferredIndustries: [testCase.industry],
      excludedIndustries: [],
      skills: testCase.skills,
      preferredLocations: BASE_LOCATIONS,
      companyTypes: [],
      avoidCompanyTypes: [],
      jobType: "不限"
    }
  };
}

function summarizeJob(jobVm = {}, index = 0) {
  const scoring = jobVm.scoringView || {};
  const summary = jobVm.jobSummary || {};
  return {
    rank: index + 1,
    company: String(summary.company || ""),
    title: String(summary.title || ""),
    score: Number(scoring.userPriorityScore ?? scoring.score ?? 0),
    grade: String(scoring.decisionVerdict?.grade || scoring.grade || ""),
    roleFit: Number(scoring.roleFit || 0),
    roleEvidence: String(scoring.roleFitEvidenceType || ""),
    industryFit: Number(scoring.industryFit || 0),
    locationFit: scoring.locationFit,
    companyFit: scoring.companyFit,
    opportunityType: String(scoring.opportunityType || "")
  };
}

function assertCondition(condition, message, details = {}) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}

function isHighConfidenceRoleMatch(item = {}) {
  return (
    Number(item.roleFit || 0) >= 75 &&
    HIGH_CONFIDENCE_ROLE_EVIDENCE.has(String(item.roleEvidence || "")) &&
    item.opportunityType !== "low_quality_mixed_posting"
  );
}

async function runCase(testCase = {}) {
  await orchestrator.saveProfile(buildProfile(testCase));
  const result = await orchestrator.getJobWorkspaceList();
  const jobs = Array.isArray(result.jobWorkspaceViewModels) ? result.jobWorkspaceViewModels : [];
  const allJobs = jobs.map(summarizeJob);
  const top100 = allJobs.slice(0, TOP_N);
  const top10 = top100.slice(0, 10);
  const top5 = top100.slice(0, 5);
  const top3 = top100.slice(0, 3);
  const highConfidenceCount = allJobs.filter(isHighConfidenceRoleMatch).length;
  const top100HighConfidenceCount = top100.filter(isHighConfidenceRoleMatch).length;

  assertCondition(top5.length >= 5, `${testCase.id}: top5 不足`, { top5 });
  assertCondition(top100.length >= TOP_N, `${testCase.id}: top100 不足`, { top100Length: top100.length });
  assertCondition(
    top3.every((item) => item.roleFit >= 75),
    `${testCase.id}: Top3 存在低岗位匹配`,
    { top3 }
  );
  assertCondition(
    top3.every((item) => item.opportunityType !== "low_quality_mixed_posting"),
    `${testCase.id}: 低质量 mixed posting 进入 Top3`,
    { top3 }
  );
  assertCondition(
    top100.every((item) => gradeRank(item.grade) >= gradeRank(testCase.minTop100Grade)),
    `${testCase.id}: Top100 等级低于 ${testCase.minTop100Grade}`,
    { highConfidenceCount, top100HighConfidenceCount, top100 }
  );
  assertCondition(
    highConfidenceCount >= TOP_N
      ? top100HighConfidenceCount === TOP_N
      : top100HighConfidenceCount === highConfidenceCount,
    highConfidenceCount >= TOP_N
      ? `${testCase.id}: 高置信岗位供给充足，但 Top100 未全部命中目标岗位`
      : `${testCase.id}: 高置信岗位供给不足 100，但仍有高置信岗位未进入 Top100`,
    { highConfidenceCount, top100HighConfidenceCount, top100 }
  );
  assertCondition(
    top100.every((item) => item.companyFit === null || item.companyFit === undefined || Number(item.companyFit) > 0),
    `${testCase.id}: Top100 缺失公司维度被当作 0 分`,
    { top100 }
  );
  assertCondition(
    top100.every((item) => item.locationFit === null || item.locationFit === undefined || Number(item.locationFit) > 0),
    `${testCase.id}: Top100 缺失地点维度被当作 0 分`,
    { top100 }
  );

  if (testCase.id === "pm") {
    const topCompanies = top5.map((item) => item.company);
    assertCondition(
      PM_EXPECTED_TOP5.every((company, index) => topCompanies[index] === company),
      "pm: Top5 未恢复到 5000 真实池验收候选顺序",
      { expected: PM_EXPECTED_TOP5, actual: topCompanies }
    );
  }

  return {
    id: testCase.id,
    role: testCase.role,
    highConfidenceCount,
    top100HighConfidenceCount,
    supplyStatus: highConfidenceCount >= TOP_N ? "top100_full_supply" : "supply_limited",
    gradeCounts: top100.reduce((counts, item) => {
      counts[item.grade] = (counts[item.grade] || 0) + 1;
      return counts;
    }, {}),
    top5
  };
}

async function main() {
  const report = [];
  try {
    for (const testCase of CASES) {
      report.push(await runCase(testCase));
    }
  } finally {
    await orchestrator.saveProfile(buildProfile(CASES[0]));
  }
  console.log("validate-real-pool-role-matrix: PASS");
  report.forEach((item) => {
    const compactTop5 = item.top5
      .map((job) => `${job.rank}:${job.company}/${job.grade}/${job.roleFit}/${job.opportunityType}`)
      .join(" | ");
    console.log(
      `- ${item.id}(${item.role}): supply=${item.supplyStatus}, highConfidence=${item.highConfidenceCount}, top100HighConfidence=${item.top100HighConfidenceCount}, top100Grades=${JSON.stringify(item.gradeCounts)}, top5=${compactTop5}`
    );
  });
}

main().catch((error) => {
  console.error(`validate-real-pool-role-matrix: FAIL - ${error.message}`);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
});
