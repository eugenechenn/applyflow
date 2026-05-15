#!/usr/bin/env node
"use strict";

process.env.ENABLE_LLM_JOB_SCORING = "false";

const fs = require("fs");
const path = require("path");
const orchestrator = require("../../src/lib/orchestrator/workflow-controller");
const { runWithRequestContext } = require("../../src/server/request-context");
const { demoData } = require("../../src/mock/applyflow-demo-data");

const USER_ID = "demo_user";
const LIMIT = 20;
const CASES = [
  { id: "pm_shanghai", role: "产品经理", city: "上海", minTop5AB: 2, minTop5A: 2 },
  { id: "pm_hangzhou", role: "产品经理", city: "杭州", minTop5AB: 2, minTop5A: 1 },
  { id: "algo_shenzhen", role: "算法工程师", city: "深圳", minTop5AB: 2, minTop5A: 0 },
  { id: "data_beijing", role: "数据分析", city: "北京", minTop5AB: 2, minTop5A: 0 },
  { id: "backend_nanjing", role: "后端开发", city: "南京", minTop5AB: 2, minTop5A: 0 },
  { id: "ops_chengdu", role: "运营", city: "成都", minTop5AB: 1, minTop5A: 0 }
];

function safeN(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function dist(items, picker) {
  return items.reduce((acc, item) => {
    const key = String(picker(item) || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function grade(item) {
  return String(item?.scoringView?.decisionVerdict?.grade || "UNKNOWN").toUpperCase();
}

function roleEvidence(item) {
  return String(item?.scoringView?.roleFitEvidenceType || "UNKNOWN");
}

function opportunityType(item) {
  return String(item?.scoringView?.opportunityType || "UNKNOWN");
}

function cityOf(item) {
  return String(item?.jobSummary?.location || item?.job?.location || "UNKNOWN");
}

function top5Summary(top5) {
  return top5.map((item, idx) => ({
    rank: idx + 1,
    title: String(item?.jobSummary?.title || item?.job?.title || ""),
    company: String(item?.jobSummary?.company || item?.job?.company || ""),
    location: cityOf(item),
    grade: grade(item),
    userPriorityScore: safeN(item?.scoringView?.userPriorityScore, safeN(item?.scoringView?.score, 0))
  }));
}

function top20Detail(items) {
  return items.slice(0, 20).map((item, idx) => {
    const scoring = item?.scoringView || {};
    const verdict = scoring?.decisionVerdict || {};
    const whyABF = Array.isArray(verdict?.weightedSummary)
      ? verdict.weightedSummary
          .map((x) => String(x?.reason || "").trim())
          .filter(Boolean)
          .slice(0, 2)
          .join(" | ")
      : "";
    return {
      rank: idx + 1,
      jobId: String(item?.job?.id || ""),
      title: String(item?.jobSummary?.title || item?.job?.title || ""),
      company: String(item?.jobSummary?.company || item?.job?.company || ""),
      location: cityOf(item),
      userPriorityScore: safeN(scoring?.userPriorityScore, safeN(scoring?.score, 0)),
      grade: String(verdict?.grade || "UNKNOWN"),
      roleFit: safeN(scoring?.roleFit),
      industryFit: safeN(scoring?.industryFit),
      locationFit: safeN(scoring?.locationFit),
      companyFit: safeN(scoring?.companyFit),
      accessibilityFit: safeN(scoring?.accessibilityFit),
      opportunityType: opportunityType(item),
      roleFitEvidenceType: roleEvidence(item),
      whyABF
    };
  });
}

async function evaluateCase(testCase, overrideStore) {
  const profile = {
    ...(demoData.profile || {}),
    lightweightProfile: {
      targetRoles: [testCase.role],
      preferredLocations: [testCase.city],
      skills: []
    },
    jobPreferenceProfile: {
      targetRoles: [testCase.role],
      preferredLocations: [testCase.city],
      preferredIndustries: [],
      excludedIndustries: [],
      excludedRoles: [],
      companyTypes: [],
      avoidCompanyTypes: [],
      skills: [],
      jobType: "不限",
      degree: "",
      acceptsNonTech: true
    }
  };

  const scopedStore = {
    ...overrideStore,
    getProfile: () => profile
  };
  const response = await runWithRequestContext({ userId: USER_ID, overrideStore: scopedStore }, async () =>
    orchestrator.getJobWorkspaceList({ limit: LIMIT, includeProfiling: true })
  );
  const jobs = Array.isArray(response?.jobWorkspaceViewModels) ? response.jobWorkspaceViewModels : [];
  const top20 = jobs.slice(0, 20);
  const top5 = top20.slice(0, 5);
  const gradeDist = dist(top20, (x) => grade(x));
  const top5AB = top5.filter((x) => ["A", "B"].includes(grade(x))).length;
  const top5A = top5.filter((x) => grade(x) === "A").length;
  const highRoleFitButLowGrade = top20.filter((x) => {
    const g = grade(x);
    const r = safeN(x?.scoringView?.roleFit);
    const e = roleEvidence(x).toLowerCase();
    const strong = e === "primary_role_match" || e === "explicit_subrole_match";
    return r >= 85 && strong && !["A", "B"].includes(g);
  }).length;
  const targetCityTop5 = top5.filter((x) => cityOf(x).includes(testCase.city)).length;
  const pass = top5AB >= testCase.minTop5AB && top5A >= testCase.minTop5A && targetCityTop5 >= 1;
  return {
    caseId: testCase.id,
    role: testCase.role,
    city: testCase.city,
    returnedCount: jobs.length,
    top20GradeDistribution: gradeDist,
    top5Summary: top5Summary(top5),
    top20CityDistribution: dist(top20, (x) => cityOf(x)),
    top20RoleFitEvidenceTypeDistribution: dist(top20, (x) => roleEvidence(x)),
    top20OpportunityTypeDistribution: dist(top20, (x) => opportunityType(x)),
    highRoleFitButLowGrade,
    checks: {
      minTop5AB: testCase.minTop5AB,
      minTop5A: testCase.minTop5A,
      top5AB,
      top5A,
      targetCityTop5,
      pass
    },
    top20Detail: top20Detail(top20)
  };
}

function summarizeCoverage() {
  const jobs = Array.isArray(demoData.jobs) ? demoData.jobs : [];
  const cityCounts = dist(jobs, (x) => x.location || "UNKNOWN");
  const roleBuckets = {
    pm: 0,
    data: 0,
    algo: 0,
    backend: 0,
    ops: 0,
    broad_pool: 0
  };
  jobs.forEach((job) => {
    const title = String(job.title || "");
    if (/产品经理/.test(title)) roleBuckets.pm += 1;
    if (/数据分析|商业分析/.test(title)) roleBuckets.data += 1;
    if (/算法/.test(title)) roleBuckets.algo += 1;
    if (/后端|软件工程师|Java后端/.test(title)) roleBuckets.backend += 1;
    if (/运营/.test(title)) roleBuckets.ops += 1;
    if (/管培|储备|\/|、/.test(title)) roleBuckets.broad_pool += 1;
  });
  return {
    totalJobs: jobs.length,
    cityCounts,
    roleBuckets
  };
}

async function main() {
  const failWrite = (name) => () => {
    throw new Error(`readonly violation: ${name}`);
  };
  const overrideStore = {
    getProfile: () => demoData.profile || {},
    listJobs: () => demoData.jobs || [],
    listFitAssessments: () => [],
    listActivityLogs: () => [],
    saveProfile: failWrite("saveProfile"),
    saveJob: failWrite("saveJob"),
    saveFitAssessment: failWrite("saveFitAssessment"),
    saveTask: failWrite("saveTask"),
    saveActivityLog: failWrite("saveActivityLog"),
    saveBadCase: failWrite("saveBadCase"),
    saveApplicationPrep: failWrite("saveApplicationPrep"),
    saveTailoringOutput: failWrite("saveTailoringOutput"),
    saveInterviewReflection: failWrite("saveInterviewReflection"),
    createSession: failWrite("createSession"),
    ensureUser: failWrite("ensureUser"),
    ensureNamedUser: failWrite("ensureNamedUser")
  };

  const coverage = summarizeCoverage();
  const results = [];
  for (const testCase of CASES) {
    results.push(await evaluateCase(testCase, overrideStore));
  }
  const allPass = results.every((x) => x.checks.pass && x.highRoleFitButLowGrade === 0);
  const output = {
    generatedAt: new Date().toISOString(),
    userId: USER_ID,
    coverage,
    cases: results,
    verdict: allPass ? "PASS" : "REVIEW"
  };
  const outPath = path.resolve("tmp", "demo-curated-pool-ranking-20260515.json");
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`validate-demo-curated-pool-ranking: ${output.verdict}`);
  console.log(`[coverage] total=${coverage.totalJobs} cities=${JSON.stringify(coverage.cityCounts)}`);
  results.forEach((row) => {
    console.log(
      `- ${row.caseId}: grades=${JSON.stringify(row.top20GradeDistribution)} top5AB=${row.checks.top5AB} top5A=${row.checks.top5A} cityTop5=${row.checks.targetCityTop5} highRoleFitButLowGrade=${row.highRoleFitButLowGrade} pass=${row.checks.pass}`
    );
  });
  console.log(`[evidence] ${outPath}`);
  if (!allPass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`validate-demo-curated-pool-ranking: FAIL - ${error.message || error}`);
  process.exit(1);
});

