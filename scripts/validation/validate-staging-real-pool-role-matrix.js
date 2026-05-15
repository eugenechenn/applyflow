#!/usr/bin/env node
"use strict";

process.env.ENABLE_LLM_JOB_SCORING = "false";

const fs = require("fs");
const path = require("path");
const orchestrator = require("../../src/lib/orchestrator/workflow-controller");
const { runWithRequestContext } = require("../../src/server/request-context");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const EXPECTED_DB_NAME = "applyflow-staging";
const EXPECTED_DB_ID = "ed3ef70f-7ca8-4f95-9858-f5ea825d7188";
const USER_ID = "staging_real_pool_user";
const LIMIT = 100;
const CASES = [
  { id: "pm_sh", role: "产品经理", location: "上海" },
  { id: "data_sh", role: "数据分析", location: "上海" },
  { id: "algo_sh", role: "算法工程师", location: "上海" },
  { id: "backend_sh", role: "后端开发", location: "上海" }
];

function assertStagingD1Guard() {
  const config = fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
  if (!config.includes(`"database_name": "${EXPECTED_DB_NAME}"`) || !config.includes(`"database_id": "${EXPECTED_DB_ID}"`)) {
    throw new Error("staging D1 guard failed");
  }
}

function runSql(sql) {
  const command = `npm.cmd exec wrangler -- d1 execute applyflow-staging --env staging --remote --config wrangler.jsonc --command "${String(
    sql
  ).replace(/"/g, '`"')}" --json`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "wrangler execute failed").trim());
  const parsed = JSON.parse(String(result.stdout || "[]"));
  const rows = Array.isArray(parsed?.[0]?.results) ? parsed[0].results : [];
  return rows.map((x) => {
    try {
      return JSON.parse(String(x.json_text || "{}"));
    } catch (_error) {
      return {};
    }
  });
}

function safeN(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function distribution(items, pick) {
  return items.reduce((acc, item) => {
    const key = String(pick(item) || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function top20(items) {
  return items.slice(0, 20).map((jobVm, index) => {
    const sv = jobVm?.scoringView || {};
    const verdict = sv?.decisionVerdict || {};
    const whyABF = Array.isArray(verdict.weightedSummary)
      ? verdict.weightedSummary
          .map((x) => String(x?.reason || "").trim())
          .filter(Boolean)
          .slice(0, 2)
          .join(" | ")
      : "";
    return {
      rank: index + 1,
      jobId: String(jobVm?.job?.id || ""),
      title: String(jobVm?.jobSummary?.title || jobVm?.job?.title || ""),
      company: String(jobVm?.jobSummary?.company || jobVm?.job?.company || ""),
      userPriorityScore: safeN(sv?.userPriorityScore ?? sv?.score),
      grade: String(verdict?.grade || "UNKNOWN"),
      roleFit: safeN(sv?.roleFit),
      industryFit: safeN(sv?.industryFit),
      locationFit: safeN(sv?.locationFit),
      companyFit: safeN(sv?.companyFit),
      accessibilityFit: safeN(sv?.accessibilityFit),
      opportunityType: String(sv?.opportunityType || ""),
      roleFitEvidenceType: String(sv?.roleFitEvidenceType || ""),
      whyABF
    };
  });
}

async function runCase(profile, base, rows) {
  const caseProfile = {
    ...base,
    lightweightProfile: {
      ...(base.lightweightProfile && typeof base.lightweightProfile === "object" ? base.lightweightProfile : {}),
      targetRoles: [profile.role],
      preferredLocations: [profile.location],
      skills: []
    },
    jobPreferenceProfile: {
      ...(base.jobPreferenceProfile && typeof base.jobPreferenceProfile === "object" ? base.jobPreferenceProfile : {}),
      targetRoles: [profile.role],
      preferredLocations: [profile.location],
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
  const failWrite = (name) => () => {
    throw new Error(`readonly violation: ${name}`);
  };
  const overrideStore = {
    getProfile: () => caseProfile,
    listJobs: () => rows.jobs,
    listFitAssessments: () => rows.fits,
    listActivityLogs: () => rows.logs,
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
  const res = await runWithRequestContext({ userId: USER_ID, overrideStore }, async () =>
    orchestrator.getJobWorkspaceList({ limit: LIMIT, includeProfiling: true })
  );
  const jobs = Array.isArray(res?.jobWorkspaceViewModels) ? res.jobWorkspaceViewModels : [];
  const top100 = jobs.slice(0, LIMIT);
  const gradeDist = distribution(top100, (x) => x?.scoringView?.decisionVerdict?.grade || "UNKNOWN");
  const opportunityDist = distribution(top100, (x) => x?.scoringView?.opportunityType || "UNKNOWN");
  const evidenceDist = distribution(top100, (x) => x?.scoringView?.roleFitEvidenceType || "UNKNOWN");
  const highRoleFitButLowGrade = top100.filter((x) => {
    const grade = String(x?.scoringView?.decisionVerdict?.grade || "").toUpperCase();
    const roleFit = safeN(x?.scoringView?.roleFit);
    const evidence = String(x?.scoringView?.roleFitEvidenceType || "").toLowerCase();
    const strong = evidence === "primary_role_match" || evidence === "explicit_subrole_match";
    return roleFit >= 85 && strong && !["A", "B"].includes(grade);
  }).length;
  const aCount = Number(gradeDist.A || 0);
  const bCount = Number(gradeDist.B || 0);
  return {
    profile: profile.id,
    role: profile.role,
    location: profile.location,
    top100Count: top100.length,
    gradeDistribution: gradeDist,
    aCount,
    bCount,
    abCount: aCount + bCount,
    opportunityTypeDistribution: opportunityDist,
    roleFitEvidenceTypeDistribution: evidenceDist,
    highRoleFitButLowGrade,
    top20: top20(top100)
  };
}

async function main() {
  assertStagingD1Guard();
  const jobs = runSql(`SELECT json_text FROM jobs WHERE user_id='${USER_ID}'`);
  const fits = runSql(`SELECT json_text FROM fit_assessments WHERE user_id='${USER_ID}'`);
  const logs = runSql(`SELECT json_text FROM activity_logs WHERE user_id='${USER_ID}'`);
  const profileRows = runSql(`SELECT json_text FROM profiles WHERE user_id='${USER_ID}' LIMIT 1`);
  const baseProfile = profileRows[0] && typeof profileRows[0] === "object" ? profileRows[0] : {};

  const rows = { jobs, fits, logs };
  const report = [];
  for (const testCase of CASES) {
    report.push(await runCase(testCase, baseProfile, rows));
  }

  const day = new Date();
  const d = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, "0")}${String(day.getDate()).padStart(2, "0")}`;
  const evidencePath = path.resolve("tmp", `staging-real-pool-role-matrix-${d}.json`);
  fs.writeFileSync(evidencePath, `${JSON.stringify({ userId: USER_ID, limit: LIMIT, cases: report }, null, 2)}\n`, "utf8");

  console.log("validate-staging-real-pool-role-matrix: PASS");
  for (const item of report) {
    console.log(
      `- ${item.profile}: grades=${JSON.stringify(item.gradeDistribution)} A=${item.aCount} B=${item.bCount} A+B=${item.abCount} highRoleFitButLowGrade=${item.highRoleFitButLowGrade}`
    );
  }
  console.log(`[evidence] ${evidencePath}`);
}

main().catch((error) => {
  console.error(`validate-staging-real-pool-role-matrix: FAIL - ${error.message}`);
  process.exit(1);
});
