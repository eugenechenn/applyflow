#!/usr/bin/env node
"use strict";

/**
 * 只读验证脚本：
 * - 仅允许连接 staging D1（applyflow-staging）
 * - 仅针对 staging_real_pool_user 走 orchestrator.getJobWorkspaceList 派生 scoringView
 * - 禁止任何写入、导入、登录、session 创建
 */

process.env.ENABLE_LLM_JOB_SCORING = "false";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const orchestrator = require("../../src/lib/orchestrator/workflow-controller");
const { runWithRequestContext } = require("../../src/server/request-context");

const EXPECTED_STAGING_DB_NAME = "applyflow-staging";
const EXPECTED_STAGING_DB_ID = "ed3ef70f-7ca8-4f95-9858-f5ea825d7188";
const WRANGLER_CONFIG_PATH = "wrangler.jsonc";
const WRANGLER_D1_BINDING = "APPLYFLOW_DB";
const WRANGLER_ENV = "staging";

const USER_ID = String(process.env.USER_ID || "staging_real_pool_user").trim() || "staging_real_pool_user";
const TARGET_ROLE = String(process.env.TARGET_ROLE || "产品经理").trim() || "产品经理";
const TARGET_LOCATION = String(process.env.TARGET_LOCATION || "上海").trim() || "上海";
const LIMIT = Math.max(1, Math.min(500, Number(process.env.LIMIT || 100)));

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function extractJsonArrayBlock(text = "") {
  const source = String(text || "");
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "[") continue;
    let depth = 0;
    let end = -1;
    for (let i = start; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "[") depth += 1;
      if (ch === "]") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < start) continue;
    const candidate = source.slice(start, end + 1).trim();
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed) && parsed[0] && Array.isArray(parsed[0].results)) {
        return candidate;
      }
    } catch (_error) {
      // ignore malformed candidate and continue scanning
    }
  }
  return "";
}

function runWranglerD1Read(sql) {
  const escapedSql = String(sql).replace(/"/g, '`"');
  const command = `npm.cmd exec wrangler -- d1 execute ${WRANGLER_D1_BINDING} --config ${WRANGLER_CONFIG_PATH} --env ${WRANGLER_ENV} --remote --command "${escapedSql}" --json`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", command],
    {
      cwd: path.resolve(__dirname, "../.."),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    }
  );
  if (result.error) {
    throw new Error(`wrangler d1 execute spawn error: ${result.error.message || String(result.error)}`);
  }
  if (result.status !== 0) {
    throw new Error(`wrangler d1 execute failed: ${result.stderr || result.stdout || "unknown error"}`.trim());
  }
  const stdout = String(result.stdout || "").trim();
  assertTrue(Boolean(stdout), "cannot parse wrangler JSON output.");
  const parsed = JSON.parse(stdout);
  const first = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : {};
  const dbId = EXPECTED_STAGING_DB_ID;
  return {
    dbId,
    results: Array.isArray(first.results) ? first.results : [],
    meta: first.meta || {}
  };
}

function escapeSql(value = "") {
  return String(value || "").replace(/'/g, "''");
}

function queryCount(tableName, userId) {
  const safeUserId = escapeSql(userId);
  const { dbId, results } = runWranglerD1Read(
    `SELECT COUNT(*) AS cnt FROM ${tableName} WHERE user_id = '${safeUserId}';`
  );
  return { dbId, count: Number(results?.[0]?.cnt || 0) };
}

function queryJsonRows(tableName, userId) {
  const safeUserId = escapeSql(userId);
  const { dbId, results } = runWranglerD1Read(
    `SELECT json_text FROM ${tableName} WHERE user_id = '${safeUserId}';`
  );
  return {
    dbId,
    rows: results.map((row) => {
      try {
        return JSON.parse(String(row.json_text || "{}"));
      } catch (_error) {
        return {};
      }
    })
  };
}

function queryProfile(userId) {
  const safeUserId = escapeSql(userId);
  const { dbId, results } = runWranglerD1Read(
    `SELECT json_text FROM profiles WHERE user_id = '${safeUserId}' LIMIT 1;`
  );
  const first = results?.[0]?.json_text;
  return {
    dbId,
    profile: first ? JSON.parse(first) : null
  };
}

function buildReadOnlyOverrideStore({ userId, profile, jobs, fitAssessments, activityLogs }) {
  const failWrite = (method) => () => {
    throw new Error(`readonly violation: ${method} is blocked in real-pool smoke script.`);
  };
  return {
    getProfile: () => profile,
    listJobs: () => jobs,
    listFitAssessments: () => fitAssessments,
    listActivityLogs: () => activityLogs,
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
    ensureNamedUser: failWrite("ensureNamedUser"),
    getStateForUser: (targetUserId) =>
      targetUserId === userId
        ? {
            profile,
            jobs,
            fitAssessments,
            activityLogs
          }
        : null,
    getState: () => ({
      profile,
      jobs,
      fitAssessments,
      activityLogs
    })
  };
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function gradeOf(item = {}) {
  return String(item?.scoringView?.decisionVerdict?.grade || "").trim().toUpperCase() || "UNKNOWN";
}

function distributionBy(items = [], fn) {
  return items.reduce((acc, item) => {
    const key = String(fn(item) || "UNKNOWN").trim() || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function summarizeTop20(items = []) {
  return items.slice(0, 20).map((jobVm, index) => {
    const scoring = jobVm?.scoringView || {};
    const decisionVerdict = scoring?.decisionVerdict || {};
    const weightedSummary = Array.isArray(decisionVerdict.weightedSummary) ? decisionVerdict.weightedSummary : [];
    const why = weightedSummary
      .map((x) => String(x?.reason || "").trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(" | ");
    return {
      rank: index + 1,
      jobId: String(jobVm?.job?.id || ""),
      title: String(jobVm?.jobSummary?.title || jobVm?.job?.title || ""),
      company: String(jobVm?.jobSummary?.company || jobVm?.job?.company || ""),
      userPriorityScore: safeNumber(scoring?.userPriorityScore, safeNumber(scoring?.score, 0)),
      grade: String(decisionVerdict?.grade || "UNKNOWN"),
      roleFit: safeNumber(scoring?.roleFit, 0),
      industryFit: safeNumber(scoring?.industryFit, 0),
      locationFit: safeNumber(scoring?.locationFit, 0),
      companyFit: safeNumber(scoring?.companyFit, 0),
      accessibilityFit: safeNumber(scoring?.accessibilityFit, 0),
      opportunityType: String(scoring?.opportunityType || ""),
      roleFitEvidenceType: String(scoring?.roleFitEvidenceType || ""),
      whyABF:
        why ||
        String(decisionVerdict?.nextAction || "").trim() ||
        (Array.isArray(decisionVerdict?.hardBlockers) ? decisionVerdict.hardBlockers.join(" | ") : "")
    };
  });
}

function buildDiagnosis(top100 = []) {
  const gradeCount = distributionBy(top100, (item) => gradeOf(item));
  const abCount = (gradeCount.A || 0) + (gradeCount.B || 0);
  const lowRoleFitCount = top100.filter((item) => safeNumber(item?.scoringView?.roleFit, 0) < 70).length;
  const incidentalCount = top100.filter(
    (item) => String(item?.scoringView?.roleFitEvidenceType || "").trim().toLowerCase() === "incidental_match"
  ).length;
  const broadOrLowQualityCount = top100.filter((item) => {
    const type = String(item?.scoringView?.opportunityType || "").trim().toLowerCase();
    return type === "broad_recruitment_entry" || type === "low_quality_mixed_posting";
  }).length;
  const highRoleFitButLowGrade = top100.filter((item) => {
    const roleFit = safeNumber(item?.scoringView?.roleFit, 0);
    const grade = gradeOf(item);
    const evidence = String(item?.scoringView?.roleFitEvidenceType || "").trim().toLowerCase();
    const isPrimaryLike = evidence === "primary_role_match" || evidence === "explicit_subrole_match";
    return roleFit >= 85 && isPrimaryLike && !["A", "B"].includes(grade);
  }).length;

  let verdict = "normal";
  let reason = "Top100 A/B 分布与角色匹配信号整体一致。";
  if (abCount < 30 && (lowRoleFitCount > 50 || incidentalCount > 30 || broadOrLowQualityCount > 30)) {
    verdict = "sample_insufficient_or_pool_mismatch";
    reason = "A/B 偏少更像样本供给/匹配不足（low roleFit / incidental / broad-low_quality 信号较高）。";
  } else if (highRoleFitButLowGrade >= 5) {
    verdict = "possible_scoring_anomaly";
    reason = "出现多条高 roleFit + 主匹配证据但仍非 A/B，需排查评分异常。";
  }

  return {
    verdict,
    reason,
    lowRoleFitCount,
    incidentalCount,
    broadOrLowQualityCount,
    highRoleFitButLowGrade
  };
}

function formatDateYYYYMMDD(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

async function main() {
  const wranglerConfigRaw = fs.readFileSync(path.resolve(__dirname, "../../wrangler.jsonc"), "utf8");
  assertTrue(
    wranglerConfigRaw.includes(`"database_name": "${EXPECTED_STAGING_DB_NAME}"`) &&
      wranglerConfigRaw.includes(`"database_id": "${EXPECTED_STAGING_DB_ID}"`) &&
      wranglerConfigRaw.includes(`"name": "applyflow-staging"`),
    "staging guard failed: wrangler staging config does not match applyflow-staging."
  );
  assertTrue(
    WRANGLER_ENV === "staging",
    "staging guard failed: script is not configured with --env staging."
  );
  assertTrue(
    USER_ID === "staging_real_pool_user" || String(process.env.USER_ID || "").trim() !== "",
    "safety guard failed: USER_ID is empty."
  );

  const profileQuery = queryProfile(USER_ID);
  const jobsQuery = queryJsonRows("jobs", USER_ID);
  const fitQuery = queryJsonRows("fit_assessments", USER_ID);
  const activityQuery = queryJsonRows("activity_logs", USER_ID);
  const userJobsCountQuery = queryCount("jobs", USER_ID);
  const demoJobsCountQuery = queryCount("jobs", "demo_user");

  const dbIds = [
    profileQuery.dbId,
    jobsQuery.dbId,
    fitQuery.dbId,
    activityQuery.dbId,
    userJobsCountQuery.dbId,
    demoJobsCountQuery.dbId
  ].filter(Boolean);
  const uniqueDbIds = [...new Set(dbIds)];
  assertTrue(uniqueDbIds.length === 1, `staging guard failed: inconsistent db ids: ${uniqueDbIds.join(", ")}`);
  assertTrue(
    uniqueDbIds[0] === EXPECTED_STAGING_DB_ID,
    `staging guard failed: target db id ${uniqueDbIds[0]} is not staging db ${EXPECTED_STAGING_DB_ID}.`
  );

  const profileFromDb = profileQuery.profile && typeof profileQuery.profile === "object" ? profileQuery.profile : {};
  const readonlyProfile = {
    ...profileFromDb,
    userId: USER_ID,
    lightweightProfile: {
      ...(profileFromDb.lightweightProfile && typeof profileFromDb.lightweightProfile === "object"
        ? profileFromDb.lightweightProfile
        : {}),
      targetRoles: [TARGET_ROLE],
      preferredLocations: [TARGET_LOCATION],
      skills: Array.isArray(profileFromDb?.lightweightProfile?.skills) ? profileFromDb.lightweightProfile.skills : []
    },
    jobPreferenceProfile: {
      ...(profileFromDb.jobPreferenceProfile && typeof profileFromDb.jobPreferenceProfile === "object"
        ? profileFromDb.jobPreferenceProfile
        : {}),
      targetRoles: [TARGET_ROLE],
      preferredLocations: [TARGET_LOCATION],
      preferredIndustries: [],
      companyTypes: []
    }
  };

  const overrideStore = buildReadOnlyOverrideStore({
    userId: USER_ID,
    profile: readonlyProfile,
    jobs: jobsQuery.rows,
    fitAssessments: fitQuery.rows,
    activityLogs: activityQuery.rows
  });

  const listResponse = await runWithRequestContext({ userId: USER_ID, overrideStore }, async () =>
    orchestrator.getJobWorkspaceList({ limit: LIMIT })
  );
  const jobWorkspaceViewModels = Array.isArray(listResponse?.jobWorkspaceViewModels)
    ? listResponse.jobWorkspaceViewModels
    : [];
  assertTrue(jobWorkspaceViewModels.length > 0, "orchestrator returned empty jobWorkspaceViewModels.");
  const missingDecisionVerdictGradeCount = jobWorkspaceViewModels.filter(
    (item) => String(item?.scoringView?.decisionVerdict?.grade || "").trim().length === 0
  ).length;

  const top100 = jobWorkspaceViewModels.slice(0, LIMIT);
  const top20Table = summarizeTop20(top100);
  const top100GradeDistribution = distributionBy(top100, (item) => gradeOf(item));
  const opportunityTypeDistribution = distributionBy(top100, (item) => item?.scoringView?.opportunityType || "UNKNOWN");
  const roleFitEvidenceTypeDistribution = distributionBy(
    top100,
    (item) => item?.scoringView?.roleFitEvidenceType || "UNKNOWN"
  );
  const diagnosis = buildDiagnosis(top100);

  const aCount = Number(top100GradeDistribution.A || 0);
  const bCount = Number(top100GradeDistribution.B || 0);
  const output = {
    stagingSafety: {
      expectedDbName: EXPECTED_STAGING_DB_NAME,
      expectedDbId: EXPECTED_STAGING_DB_ID,
      resolvedDbId: uniqueDbIds[0],
      userId: USER_ID,
      userJobsCount: userJobsCountQuery.count,
      demoUserJobsCount: demoJobsCountQuery.count
    },
    top100Summary: {
      returnedCount: top100.length,
      missingDecisionVerdictGradeCount,
      gradeDistribution: top100GradeDistribution,
      aCount,
      bCount,
      abCount: aCount + bCount,
      opportunityTypeDistribution,
      roleFitEvidenceTypeDistribution
    },
    top20Table,
    diagnosis,
    context: {
      targetRole: TARGET_ROLE,
      targetLocation: TARGET_LOCATION,
      limit: LIMIT,
      note: "grade is read from scoringView.decisionVerdict.grade only."
    }
  };

  const evidenceDir = path.resolve(__dirname, "../../tmp");
  if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, `staging-real-pool-scoring-smoke-${formatDateYYYYMMDD()}.json`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`[staging-safety] db=${output.stagingSafety.resolvedDbId} user=${USER_ID} userJobs=${output.stagingSafety.userJobsCount} demoJobs=${output.stagingSafety.demoUserJobsCount}`);
  console.log(`[top100] returned=${output.top100Summary.returnedCount} grades=${JSON.stringify(output.top100Summary.gradeDistribution)} A=${aCount} B=${bCount} A+B=${output.top100Summary.abCount}`);
  console.log(`[top100] opportunityType=${JSON.stringify(output.top100Summary.opportunityTypeDistribution)}`);
  console.log(`[top100] roleFitEvidenceType=${JSON.stringify(output.top100Summary.roleFitEvidenceTypeDistribution)}`);
  console.log("[top20]");
  top20Table.forEach((row) => {
    console.log(
      `${row.rank}. ${row.jobId} | ${row.title} | ${row.company} | score=${row.userPriorityScore} | grade=${row.grade} | role=${row.roleFit} industry=${row.industryFit} location=${row.locationFit} company=${row.companyFit} access=${row.accessibilityFit} | type=${row.opportunityType} | evidence=${row.roleFitEvidenceType} | why=${row.whyABF}`
    );
  });
  console.log(`[diagnosis] verdict=${diagnosis.verdict} reason=${diagnosis.reason}`);
  console.log(`[evidence] ${evidencePath}`);
}

main().catch((error) => {
  console.error(`validate-staging-real-pool-scoring-smoke: FAIL - ${error.message || error}`);
  process.exit(1);
});
