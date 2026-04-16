const fs = require("fs");
const path = require("path");
const store = require("../src/server/store");

const outputDir = path.join(process.cwd(), "cloudflare", "d1");
const outputJsonFile = path.join(outputDir, "seed.json");
const outputSqlFile = path.join(outputDir, "seed.sql");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const exportState = {
  exportedAt: new Date().toISOString(),
  users: store.listUsers().map((user) => ({
    user,
    workspace: store.getStateForUser(user.id)
  }))
};

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function appendInsert(lines, table, columns, values) {
  lines.push(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.map(sqlValue).join(", ")});`);
}

function buildSeedSql(data) {
  const lines = [
    "-- ApplyFlow D1 seed export",
    `-- exportedAt: ${data.exportedAt}`,
    "DELETE FROM sessions;",
    "DELETE FROM users;",
    "DELETE FROM profiles;",
    "DELETE FROM strategy_profiles;",
    "DELETE FROM global_policies;",
    "DELETE FROM policy_history;",
    "DELETE FROM policy_proposals;",
    "DELETE FROM policy_audit_logs;",
    "DELETE FROM jobs;",
    "DELETE FROM fit_assessments;",
    "DELETE FROM application_preps;",
    "DELETE FROM application_tasks;",
    "DELETE FROM interview_reflections;",
    "DELETE FROM activity_logs;",
    "DELETE FROM bad_cases;"
  ];

  data.users.forEach(({ user, workspace }) => {
    appendInsert(lines, "users", ["id", "email", "username", "created_at", "json_text"], [
      user.id,
      user.email || "",
      user.username || "",
      user.createdAt,
      JSON.stringify(user)
    ]);

    (workspace.sessions || []).forEach((session) => {
      appendInsert(lines, "sessions", ["session_id", "user_id", "created_at", "expires_at", "json_text"], [
        session.sessionId,
        session.userId,
        session.createdAt,
        session.expiresAt || null,
        JSON.stringify(session)
      ]);
    });

    if (workspace.profile) {
      appendInsert(lines, "profiles", ["user_id", "updated_at", "json_text"], [
        user.id,
        workspace.profile.updatedAt || workspace.profile.createdAt || data.exportedAt,
        JSON.stringify(workspace.profile)
      ]);
    }

    if (workspace.strategyProfile) {
      appendInsert(lines, "strategy_profiles", ["user_id", "updated_at", "json_text"], [
        user.id,
        workspace.strategyProfile.updatedAt || workspace.strategyProfile.createdAt || data.exportedAt,
        JSON.stringify(workspace.strategyProfile)
      ]);
    }

    if (workspace.globalStrategyPolicy) {
      appendInsert(lines, "global_policies", ["user_id", "updated_at", "json_text"], [
        user.id,
        workspace.globalStrategyPolicy.updatedAt || workspace.globalStrategyPolicy.createdAt || data.exportedAt,
        JSON.stringify(workspace.globalStrategyPolicy)
      ]);
    }

    const collectionConfigs = [
      ["policyHistory", "policy_history", ["id", "user_id", "created_at", "json_text"], (item) => [item.id, user.id, item.createdAt || data.exportedAt, JSON.stringify(item)]],
      ["policyProposals", "policy_proposals", ["id", "user_id", "status", "created_at", "json_text"], (item) => [item.id, user.id, item.status || "", item.createdAt || data.exportedAt, JSON.stringify(item)]],
      ["policyAuditLogs", "policy_audit_logs", ["id", "user_id", "timestamp", "json_text"], (item) => [item.id, user.id, item.timestamp || item.createdAt || data.exportedAt, JSON.stringify(item)]],
      ["jobs", "jobs", ["id", "user_id", "status", "priority", "updated_at", "json_text"], (item) => [item.id, user.id, item.status || "", item.priority || "", item.updatedAt || item.createdAt || data.exportedAt, JSON.stringify(item)]],
      ["fitAssessments", "fit_assessments", ["id", "user_id", "job_id", "updated_at", "json_text"], (item) => [item.id, user.id, item.jobId, item.updatedAt || item.createdAt || data.exportedAt, JSON.stringify(item)]],
      ["applicationPreps", "application_preps", ["id", "user_id", "job_id", "updated_at", "json_text"], (item) => [item.id, user.id, item.jobId, item.updatedAt || item.createdAt || data.exportedAt, JSON.stringify(item)]],
      ["applicationTasks", "application_tasks", ["id", "user_id", "job_id", "status", "updated_at", "json_text"], (item) => [item.id, user.id, item.jobId || null, item.status || "", item.updatedAt || item.createdAt || data.exportedAt, JSON.stringify(item)]],
      ["interviewReflections", "interview_reflections", ["id", "user_id", "job_id", "updated_at", "json_text"], (item) => [item.id, user.id, item.jobId, item.updatedAt || item.createdAt || data.exportedAt, JSON.stringify(item)]],
      ["activityLogs", "activity_logs", ["id", "user_id", "job_id", "timestamp", "json_text"], (item) => [item.id, user.id, item.jobId || item.entityId || item.metadata?.jobId || null, item.timestamp || item.createdAt || data.exportedAt, JSON.stringify(item)]],
      ["badCases", "bad_cases", ["id", "user_id", "job_id", "updated_at", "json_text"], (item) => [item.id, user.id, item.jobId, item.updatedAt || item.createdAt || data.exportedAt, JSON.stringify(item)]]
    ];

    collectionConfigs.forEach(([key, table, columns, mapFn]) => {
      (workspace[key] || []).forEach((item) => appendInsert(lines, table, columns, mapFn(item)));
    });
  });

  return `${lines.join("\n")}\n`;
}

fs.writeFileSync(outputJsonFile, JSON.stringify(exportState, null, 2), "utf8");
fs.writeFileSync(outputSqlFile, buildSeedSql(exportState), "utf8");
console.log(JSON.stringify({ outputJsonFile, outputSqlFile }, null, 2));
