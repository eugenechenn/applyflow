const fs = require("fs");
const path = require("path");
const { demoData } = require("../../mock/applyflow-demo-data");
const { getDatabaseAdapter } = require("../db");

const DEFAULT_USER_ID = "user_a";
const storeFilePath = path.join(process.cwd(), "data", "store.json");

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeActivityLogs(logs = []) {
  return (logs || []).map((log) => ({
    timestamp: log.timestamp || log.createdAt || nowIso(),
    ...log
  }));
}

function createWorkspaceFromSeed(seed = {}) {
  const seeded = deepClone(seed);
  return {
    profile: seeded.profile || null,
    strategyProfile: seeded.strategyProfile || null,
    globalStrategyPolicy: seeded.globalStrategyPolicy || null,
    policyHistory: seeded.policyHistory || [],
    policyProposals: seeded.policyProposals || [],
    policyAuditLogs: seeded.policyAuditLogs || [],
    jobs: seeded.jobs || [],
    fitAssessments: seeded.fitAssessments || [],
    applicationPreps: seeded.applicationPreps || [],
    applicationTasks: seeded.applicationTasks || [],
    interviewReflections: seeded.interviewReflections || [],
    activityLogs: normalizeActivityLogs(seeded.activityLogs || []),
    badCases: seeded.badCases || []
  };
}

function createUserRecord({ id, email, username }) {
  return {
    id,
    email: email || username,
    username: username || email,
    createdAt: nowIso()
  };
}

function createUserBWorkspace() {
  const seed = createWorkspaceFromSeed({});
  seed.profile = {
    id: "profile_user_b",
    fullName: "Taylor Lin",
    headline: "Product strategist exploring AI workflow roles",
    background: "Strategy and analytics lead moving into AI-native product work",
    yearsOfExperience: 4,
    targetRoles: ["Product Strategy", "AI Product Manager"],
    targetIndustries: ["AI SaaS", "Fintech"],
    preferredLocations: ["Remote", "Shanghai"],
    strengths: ["Strategic planning", "Research synthesis"],
    constraints: ["Avoid heavy travel"],
    baseResume: "Taylor Lin base resume content ...",
    masterResume: "Taylor Lin base resume content ...",
    policyPreferences: {
      manualPreferredRoles: [],
      ignoredRiskyRoles: [],
      riskToleranceOverride: ""
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  return seed;
}

function buildInitialState() {
  return {
    users: [
      createUserRecord({ id: "user_a", email: "alex@example.com", username: "alex" }),
      createUserRecord({ id: "user_b", email: "taylor@example.com", username: "taylor" })
    ],
    sessions: [],
    workspaces: {
      user_a: createWorkspaceFromSeed(demoData),
      user_b: createUserBWorkspace()
    }
  };
}

function isLegacySingleUserState(rawState = {}) {
  return !rawState.workspaces;
}

function migrateLegacyState(rawState = {}) {
  const base = buildInitialState();
  base.workspaces.user_a = createWorkspaceFromSeed(rawState);
  return base;
}

function ensureStateShape(rawState = {}) {
  const prepared = isLegacySingleUserState(rawState) ? migrateLegacyState(rawState) : rawState;
  const seeded = buildInitialState();
  const usersById = new Map();
  [...seeded.users, ...(prepared.users || [])].forEach((user) => {
    usersById.set(user.id, {
      ...user,
      email: user.email || user.username,
      username: user.username || user.email,
      createdAt: user.createdAt || nowIso()
    });
  });
  const workspaceUserIds = new Set([
    ...Object.keys(seeded.workspaces || {}),
    ...Object.keys(prepared.workspaces || {}),
    ...usersById.keys()
  ]);
  const workspaces = {};
  workspaceUserIds.forEach((userId) => {
    workspaces[userId] = createWorkspaceFromSeed(
      prepared.workspaces?.[userId] || seeded.workspaces?.[userId] || {}
    );
  });
  return {
    users: [...usersById.values()],
    sessions: (prepared.sessions || []).filter((session) => !session.expiresAt || new Date(session.expiresAt) > new Date()),
    workspaces
  };
}

function parseJson(text) {
  return text ? JSON.parse(text) : null;
}

function rowToJson(row) {
  return row ? parseJson(row.json_text) : null;
}

function rowsToJson(rows = []) {
  return rows.map((row) => rowToJson(row)).filter(Boolean);
}

function getTimestamp(value) {
  return value?.updatedAt || value?.timestamp || value?.createdAt || nowIso();
}

function db() {
  return getDatabaseAdapter();
}

function upsertSingleton(tableName, userId, value) {
  db().run(`
    INSERT INTO ${tableName} (user_id, updated_at, json_text)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      updated_at = excluded.updated_at,
      json_text = excluded.json_text
  `, [userId, getTimestamp(value), JSON.stringify(value)]);
  return value;
}

function getSingleton(tableName, userId) {
  return rowToJson(db().get(`SELECT json_text FROM ${tableName} WHERE user_id = ?`, [userId]));
}

function listCollection(tableName, userId, orderBy) {
  return rowsToJson(db().all(`SELECT json_text FROM ${tableName} WHERE user_id = ? ORDER BY ${orderBy}`, [userId]));
}

function saveById(tableName, userId, item, config = {}) {
  const idField = config.idField || "id";
  const timestamp = getTimestamp(item);
  const id = item[idField];
  const jsonText = JSON.stringify(item);
  const columns = config.columns || [];
  const values = columns.map((column) => {
    if (column === "user_id") return userId;
    if (column === "updated_at" || column === "created_at" || column === "timestamp") return timestamp;
    if (column === "json_text") return jsonText;
    return item[column] === undefined ? null : item[column];
  });

  const insertColumns = [idField, ...columns];
  const placeholders = insertColumns.map(() => "?").join(", ");
  const updateColumns = columns
    .filter((column) => column !== "created_at")
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");

  db().run(`
    INSERT INTO ${tableName} (${insertColumns.join(", ")})
    VALUES (${placeholders})
    ON CONFLICT(${idField}) DO UPDATE SET ${updateColumns}
  `, [id, ...values]);
  return item;
}

function getById(tableName, idField, id) {
  return rowToJson(db().get(`SELECT json_text FROM ${tableName} WHERE ${idField} = ?`, [id]));
}

function getByUserAndField(tableName, userId, fieldName, fieldValue) {
  return rowToJson(db().get(`SELECT json_text FROM ${tableName} WHERE user_id = ? AND ${fieldName} = ? LIMIT 1`, [userId, fieldValue]));
}

function deleteByUserAndField(tableName, userId, fieldName, fieldValue) {
  const existing = getByUserAndField(tableName, userId, fieldName, fieldValue);
  if (!existing) return null;
  db().run(`DELETE FROM ${tableName} WHERE user_id = ? AND ${fieldName} = ?`, [userId, fieldValue]);
  return existing;
}

function migrateJsonStateIfNeeded() {
  const countRow = db().get("SELECT COUNT(*) AS count FROM users");
  if (countRow?.count > 0) {
    return { migrated: false, source: "database" };
  }

  let sourceState = null;
  if (fs.existsSync(storeFilePath)) {
    try {
      sourceState = ensureStateShape(JSON.parse(fs.readFileSync(storeFilePath, "utf8")));
    } catch (error) {
      sourceState = buildInitialState();
    }
  } else {
    sourceState = buildInitialState();
  }

  try {
    db().transaction(() => {
    sourceState.users.forEach((user) => {
      db().run(
        "INSERT INTO users (id, email, username, created_at, json_text) VALUES (?, ?, ?, ?, ?)",
        [user.id, user.email || "", user.username || "", user.createdAt || nowIso(), JSON.stringify(user)]
      );
    });

    sourceState.sessions.forEach((session) => {
      db().run(
        "INSERT INTO sessions (session_id, user_id, created_at, expires_at, json_text) VALUES (?, ?, ?, ?, ?)",
        [session.sessionId, session.userId, session.createdAt || nowIso(), session.expiresAt || null, JSON.stringify(session)]
      );
    });

    Object.entries(sourceState.workspaces || {}).forEach(([userId, workspace]) => {
      if (workspace.profile) {
        db().run("INSERT INTO profiles (user_id, updated_at, json_text) VALUES (?, ?, ?)", [
          userId,
          getTimestamp(workspace.profile),
          JSON.stringify({ ...workspace.profile, userId })
        ]);
      }
      if (workspace.strategyProfile) {
        db().run("INSERT INTO strategy_profiles (user_id, updated_at, json_text) VALUES (?, ?, ?)", [
          userId,
          getTimestamp(workspace.strategyProfile),
          JSON.stringify({ ...workspace.strategyProfile, userId })
        ]);
      }
      if (workspace.globalStrategyPolicy) {
        db().run("INSERT INTO global_policies (user_id, updated_at, json_text) VALUES (?, ?, ?)", [
          userId,
          getTimestamp(workspace.globalStrategyPolicy),
          JSON.stringify({ ...workspace.globalStrategyPolicy, userId })
        ]);
      }

      (workspace.policyHistory || []).forEach((item) => {
        db().run("INSERT INTO policy_history (id, user_id, created_at, json_text) VALUES (?, ?, ?, ?)", [
          item.id,
          userId,
          item.createdAt || nowIso(),
          JSON.stringify({ ...item, userId })
        ]);
      });
      (workspace.policyProposals || []).forEach((item) => {
        db().run("INSERT INTO policy_proposals (id, user_id, status, created_at, json_text) VALUES (?, ?, ?, ?, ?)", [
          item.id,
          userId,
          item.status || "",
          item.createdAt || nowIso(),
          JSON.stringify({ ...item, userId })
        ]);
      });
      (workspace.policyAuditLogs || []).forEach((item) => {
        db().run("INSERT INTO policy_audit_logs (id, user_id, timestamp, json_text) VALUES (?, ?, ?, ?)", [
          item.id,
          userId,
          item.timestamp || item.createdAt || nowIso(),
          JSON.stringify({ ...item, userId })
        ]);
      });
      (workspace.jobs || []).forEach((item) => {
        db().run("INSERT INTO jobs (id, user_id, status, priority, updated_at, json_text) VALUES (?, ?, ?, ?, ?, ?)", [
          item.id,
          userId,
          item.status || "",
          item.priority || "",
          item.updatedAt || item.createdAt || nowIso(),
          JSON.stringify({ ...item, userId })
        ]);
      });
      (workspace.fitAssessments || []).forEach((item) => {
        db().run("INSERT INTO fit_assessments (id, user_id, job_id, updated_at, json_text) VALUES (?, ?, ?, ?, ?)", [
          item.id,
          userId,
          item.jobId,
          item.updatedAt || item.createdAt || nowIso(),
          JSON.stringify({ ...item, userId })
        ]);
      });
      (workspace.applicationPreps || []).forEach((item) => {
        db().run("INSERT INTO application_preps (id, user_id, job_id, updated_at, json_text) VALUES (?, ?, ?, ?, ?)", [
          item.id,
          userId,
          item.jobId,
          item.updatedAt || item.createdAt || nowIso(),
          JSON.stringify({ ...item, userId })
        ]);
      });
      (workspace.applicationTasks || []).forEach((item) => {
        db().run("INSERT INTO application_tasks (id, user_id, job_id, status, updated_at, json_text) VALUES (?, ?, ?, ?, ?, ?)", [
          item.id,
          userId,
          item.jobId || null,
          item.status || "",
          item.updatedAt || item.createdAt || nowIso(),
          JSON.stringify({ ...item, userId })
        ]);
      });
      (workspace.interviewReflections || []).forEach((item) => {
        db().run("INSERT INTO interview_reflections (id, user_id, job_id, updated_at, json_text) VALUES (?, ?, ?, ?, ?)", [
          item.id,
          userId,
          item.jobId,
          item.updatedAt || item.createdAt || nowIso(),
          JSON.stringify({ ...item, userId })
        ]);
      });
      normalizeActivityLogs(workspace.activityLogs || []).forEach((item) => {
        db().run("INSERT INTO activity_logs (id, user_id, job_id, timestamp, json_text) VALUES (?, ?, ?, ?, ?)", [
          item.id,
          userId,
          item.jobId || item.entityId || item.metadata?.jobId || null,
          item.timestamp || nowIso(),
          JSON.stringify({ ...item, userId })
        ]);
      });
      (workspace.badCases || []).forEach((item) => {
        db().run("INSERT INTO bad_cases (id, user_id, job_id, updated_at, json_text) VALUES (?, ?, ?, ?, ?)", [
          item.id,
          userId,
          item.jobId,
          item.updatedAt || item.createdAt || nowIso(),
          JSON.stringify({ ...item, userId })
        ]);
      });
    });
  });
  } catch (error) {
    throw error;
  }
  return { migrated: true, source: fs.existsSync(storeFilePath) ? "store.json" : "seed" };
}

function listUsers() {
  return rowsToJson(db().all("SELECT json_text FROM users ORDER BY created_at ASC"));
}

function getUser(userId) {
  return getById("users", "id", userId);
}

function findUserByLogin(login) {
  const normalized = String(login || "").trim().toLowerCase();
  return listUsers().find((user) => {
    return (
      String(user.email || "").toLowerCase() === normalized ||
      String(user.username || "").toLowerCase() === normalized ||
      String(user.id || "").toLowerCase() === normalized
    );
  });
}

function saveUser(user) {
  const normalized = {
    ...user,
    email: user.email || user.username,
    username: user.username || user.email,
    createdAt: user.createdAt || nowIso()
  };
  db().run(`
    INSERT INTO users (id, email, username, created_at, json_text)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      username = excluded.username,
      json_text = excluded.json_text
  `, [normalized.id, normalized.email || "", normalized.username || "", normalized.createdAt, JSON.stringify(normalized)]);
  return normalized;
}

function listSessions() {
  return rowsToJson(db().all("SELECT json_text FROM sessions ORDER BY created_at DESC"));
}

function saveSession(session) {
  db().run(`
    INSERT INTO sessions (session_id, user_id, created_at, expires_at, json_text)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      user_id = excluded.user_id,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at,
      json_text = excluded.json_text
  `, [session.sessionId, session.userId, session.createdAt || nowIso(), session.expiresAt || null, JSON.stringify(session)]);
  return session;
}

function getSession(sessionId) {
  return getById("sessions", "session_id", sessionId);
}

function deleteSession(sessionId) {
  db().run("DELETE FROM sessions WHERE session_id = ?", [sessionId]);
}

function deleteSessionsByUserId(userId) {
  db().run("DELETE FROM sessions WHERE user_id = ?", [userId]);
}

function getProfile(userId) {
  return getSingleton("profiles", userId);
}

function saveProfile(userId, profile) {
  return upsertSingleton("profiles", userId, profile);
}

function getStrategyProfile(userId) {
  return getSingleton("strategy_profiles", userId);
}

function saveStrategyProfile(userId, profile) {
  return upsertSingleton("strategy_profiles", userId, profile);
}

function getGlobalStrategyPolicy(userId) {
  return getSingleton("global_policies", userId);
}

function saveGlobalStrategyPolicy(userId, policy) {
  return upsertSingleton("global_policies", userId, policy);
}

function listPolicyHistory(userId) {
  return listCollection("policy_history", userId, "created_at DESC");
}

function savePolicyHistoryEntry(userId, entry) {
  return saveById("policy_history", userId, entry, {
    columns: ["user_id", "created_at", "json_text"]
  });
}

function listPolicyProposals(userId) {
  return listCollection("policy_proposals", userId, "created_at DESC");
}

function getPolicyProposal(userId, proposalId) {
  return getByUserAndField("policy_proposals", userId, "id", proposalId);
}

function savePolicyProposal(userId, proposal) {
  return saveById("policy_proposals", userId, proposal, {
    columns: ["user_id", "status", "created_at", "json_text"]
  });
}

function listPolicyAuditLogs(userId) {
  return listCollection("policy_audit_logs", userId, "timestamp DESC");
}

function savePolicyAuditLog(userId, entry) {
  return saveById("policy_audit_logs", userId, entry, {
    columns: ["user_id", "timestamp", "json_text"]
  });
}

function listJobs(userId) {
  return listCollection("jobs", userId, "updated_at DESC");
}

function getJob(userId, jobId) {
  return getByUserAndField("jobs", userId, "id", jobId);
}

function saveJob(userId, job) {
  return saveById("jobs", userId, job, {
    columns: ["user_id", "status", "priority", "updated_at", "json_text"]
  });
}

function listFitAssessments(userId) {
  return listCollection("fit_assessments", userId, "updated_at DESC");
}

function getFitAssessmentByJobId(userId, jobId) {
  return getByUserAndField("fit_assessments", userId, "job_id", jobId);
}

function saveFitAssessment(userId, assessment) {
  return saveById("fit_assessments", userId, assessment, {
    columns: ["user_id", "job_id", "updated_at", "json_text"]
  });
}

function listApplicationPreps(userId) {
  return listCollection("application_preps", userId, "updated_at DESC");
}

function getApplicationPrepByJobId(userId, jobId) {
  return getByUserAndField("application_preps", userId, "job_id", jobId);
}

function saveApplicationPrep(userId, prep) {
  return saveById("application_preps", userId, prep, {
    columns: ["user_id", "job_id", "updated_at", "json_text"]
  });
}

function listTasks(userId) {
  return listCollection("application_tasks", userId, "updated_at DESC");
}

function listTasksByJobId(userId, jobId) {
  return listTasks(userId).filter((task) => task.jobId === jobId);
}

function saveTask(userId, task) {
  return saveById("application_tasks", userId, task, {
    columns: ["user_id", "job_id", "status", "updated_at", "json_text"]
  });
}

function listInterviewReflections(userId) {
  return listCollection("interview_reflections", userId, "updated_at DESC");
}

function getInterviewReflectionByJobId(userId, jobId) {
  return getByUserAndField("interview_reflections", userId, "job_id", jobId);
}

function saveInterviewReflection(userId, reflection) {
  return saveById("interview_reflections", userId, reflection, {
    columns: ["user_id", "job_id", "updated_at", "json_text"]
  });
}

function listActivityLogs(userId) {
  return listCollection("activity_logs", userId, "timestamp DESC");
}

function listActivityLogsByJobId(userId, jobId) {
  return listActivityLogs(userId).filter(
    (item) => item.jobId === jobId || item.entityId === jobId || item.metadata?.jobId === jobId
  );
}

function saveActivityLog(userId, log) {
  const normalized = {
    ...log,
    timestamp: log.timestamp || log.createdAt || nowIso()
  };
  return saveById("activity_logs", userId, normalized, {
    columns: ["user_id", "job_id", "timestamp", "json_text"]
  });
}

function listBadCases(userId) {
  return listCollection("bad_cases", userId, "updated_at DESC");
}

function getBadCaseByJobId(userId, jobId) {
  return getByUserAndField("bad_cases", userId, "job_id", jobId);
}

function saveBadCase(userId, badCase) {
  return saveById("bad_cases", userId, badCase, {
    columns: ["user_id", "job_id", "updated_at", "json_text"]
  });
}

function removeBadCase(userId, jobId) {
  return deleteByUserAndField("bad_cases", userId, "job_id", jobId);
}

function getWorkspaceState(userId) {
  return {
    profile: getProfile(userId),
    strategyProfile: getStrategyProfile(userId),
    globalStrategyPolicy: getGlobalStrategyPolicy(userId),
    policyHistory: listPolicyHistory(userId),
    policyProposals: listPolicyProposals(userId),
    policyAuditLogs: listPolicyAuditLogs(userId),
    jobs: listJobs(userId),
    fitAssessments: listFitAssessments(userId),
    applicationPreps: listApplicationPreps(userId),
    applicationTasks: listTasks(userId),
    interviewReflections: listInterviewReflections(userId),
    activityLogs: listActivityLogs(userId),
    badCases: listBadCases(userId)
  };
}

module.exports = {
  DEFAULT_USER_ID,
  storeFilePath,
  migrateJsonStateIfNeeded,
  listUsers,
  getUser,
  findUserByLogin,
  saveUser,
  listSessions,
  saveSession,
  getSession,
  deleteSession,
  deleteSessionsByUserId,
  getProfile,
  saveProfile,
  getStrategyProfile,
  saveStrategyProfile,
  getGlobalStrategyPolicy,
  saveGlobalStrategyPolicy,
  listPolicyHistory,
  savePolicyHistoryEntry,
  listPolicyProposals,
  getPolicyProposal,
  savePolicyProposal,
  listPolicyAuditLogs,
  savePolicyAuditLog,
  listJobs,
  getJob,
  saveJob,
  listFitAssessments,
  getFitAssessmentByJobId,
  saveFitAssessment,
  listApplicationPreps,
  getApplicationPrepByJobId,
  saveApplicationPrep,
  listTasksByJobId,
  listTasks,
  saveTask,
  listInterviewReflections,
  getInterviewReflectionByJobId,
  saveInterviewReflection,
  listActivityLogsByJobId,
  listActivityLogs,
  saveActivityLog,
  listBadCases,
  getBadCaseByJobId,
  saveBadCase,
  removeBadCase,
  getWorkspaceState
};
