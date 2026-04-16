const { createId } = require("../../lib/utils/id");

const WORKSPACE_TABLES = [
  { key: "policyHistory", table: "policy_history", idField: "id", timeField: "created_at", extraFields: [] },
  { key: "policyProposals", table: "policy_proposals", idField: "id", timeField: "created_at", extraFields: ["status"] },
  { key: "policyAuditLogs", table: "policy_audit_logs", idField: "id", timeField: "timestamp", extraFields: [] },
  { key: "jobs", table: "jobs", idField: "id", timeField: "updated_at", extraFields: ["status", "priority"] },
  { key: "fitAssessments", table: "fit_assessments", idField: "id", timeField: "updated_at", extraFields: ["job_id"] },
  { key: "applicationPreps", table: "application_preps", idField: "id", timeField: "updated_at", extraFields: ["job_id"] },
  { key: "applicationTasks", table: "application_tasks", idField: "id", timeField: "updated_at", extraFields: ["job_id", "status"] },
  { key: "interviewReflections", table: "interview_reflections", idField: "id", timeField: "updated_at", extraFields: ["job_id"] },
  { key: "activityLogs", table: "activity_logs", idField: "id", timeField: "timestamp", extraFields: ["job_id"] },
  { key: "badCases", table: "bad_cases", idField: "id", timeField: "updated_at", extraFields: ["job_id"] }
];

function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  return header.split(";").reduce((acc, entry) => {
    const [key, ...parts] = entry.trim().split("=");
    if (!key) return acc;
    acc[key] = decodeURIComponent(parts.join("="));
    return acc;
  }, {});
}

async function selectJsonRows(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all();
  return (result.results || []).map((row) => JSON.parse(row.json_text));
}

async function selectJsonRow(db, sql, params = []) {
  const row = await db.prepare(sql).bind(...params).first();
  return row ? JSON.parse(row.json_text) : null;
}

async function loadUsers(db) {
  return selectJsonRows(db, "SELECT json_text FROM users ORDER BY created_at ASC");
}

function getWorkerDbOrThrow(env = {}) {
  const bindingName = env.CLOUDFLARE_D1_BINDING || "APPLYFLOW_DB";
  const db = env[bindingName] || env.APPLYFLOW_DB || env.DB || null;
  if (!db) {
    const error = new Error(
      `Cloudflare D1 binding is missing. Expected env.${bindingName}, env.APPLYFLOW_DB, or env.DB.`
    );
    error.code = "D1_BINDING_MISSING";
    throw error;
  }
  return db;
}

async function loadSessionById(db, sessionId) {
  if (!sessionId) return null;
  return selectJsonRow(db, "SELECT json_text FROM sessions WHERE session_id = ?", [sessionId]);
}

async function loadWorkspaceState(db, userId) {
  if (!userId) {
    return {
      profile: null,
      strategyProfile: null,
      globalStrategyPolicy: null,
      policyHistory: [],
      policyProposals: [],
      policyAuditLogs: [],
      jobs: [],
      fitAssessments: [],
      applicationPreps: [],
      applicationTasks: [],
      interviewReflections: [],
      activityLogs: [],
      badCases: []
    };
  }

  const profile = await selectJsonRow(db, "SELECT json_text FROM profiles WHERE user_id = ?", [userId]);
  const strategyProfile = await selectJsonRow(db, "SELECT json_text FROM strategy_profiles WHERE user_id = ?", [userId]);
  const globalStrategyPolicy = await selectJsonRow(db, "SELECT json_text FROM global_policies WHERE user_id = ?", [userId]);

  const policyHistory = await selectJsonRows(
    db,
    "SELECT json_text FROM policy_history WHERE user_id = ? ORDER BY created_at DESC",
    [userId]
  );
  const policyProposals = await selectJsonRows(
    db,
    "SELECT json_text FROM policy_proposals WHERE user_id = ? ORDER BY created_at DESC",
    [userId]
  );
  const policyAuditLogs = await selectJsonRows(
    db,
    "SELECT json_text FROM policy_audit_logs WHERE user_id = ? ORDER BY timestamp DESC",
    [userId]
  );
  const jobs = await selectJsonRows(db, "SELECT json_text FROM jobs WHERE user_id = ? ORDER BY updated_at DESC", [userId]);
  const fitAssessments = await selectJsonRows(
    db,
    "SELECT json_text FROM fit_assessments WHERE user_id = ? ORDER BY updated_at DESC",
    [userId]
  );
  const applicationPreps = await selectJsonRows(
    db,
    "SELECT json_text FROM application_preps WHERE user_id = ? ORDER BY updated_at DESC",
    [userId]
  );
  const applicationTasks = await selectJsonRows(
    db,
    "SELECT json_text FROM application_tasks WHERE user_id = ? ORDER BY updated_at DESC",
    [userId]
  );
  const interviewReflections = await selectJsonRows(
    db,
    "SELECT json_text FROM interview_reflections WHERE user_id = ? ORDER BY updated_at DESC",
    [userId]
  );
  const activityLogs = await selectJsonRows(
    db,
    "SELECT json_text FROM activity_logs WHERE user_id = ? ORDER BY timestamp DESC",
    [userId]
  );
  const badCases = await selectJsonRows(db, "SELECT json_text FROM bad_cases WHERE user_id = ? ORDER BY updated_at DESC", [userId]);

  return {
    profile,
    strategyProfile,
    globalStrategyPolicy,
    policyHistory,
    policyProposals,
    policyAuditLogs,
    jobs,
    fitAssessments,
    applicationPreps,
    applicationTasks,
    interviewReflections,
    activityLogs,
    badCases
  };
}

async function persistWorkspaceState(db, userId, workspaceState) {
  const statements = [];

  statements.push(db.prepare("DELETE FROM profiles WHERE user_id = ?").bind(userId));
  statements.push(db.prepare("DELETE FROM strategy_profiles WHERE user_id = ?").bind(userId));
  statements.push(db.prepare("DELETE FROM global_policies WHERE user_id = ?").bind(userId));

  WORKSPACE_TABLES.forEach(({ table }) => {
    statements.push(db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId));
  });

  if (workspaceState.profile) {
    statements.push(
      db.prepare("INSERT INTO profiles (user_id, updated_at, json_text) VALUES (?, ?, ?)")
        .bind(userId, workspaceState.profile.updatedAt || workspaceState.profile.createdAt || new Date().toISOString(), JSON.stringify(workspaceState.profile))
    );
  }

  if (workspaceState.strategyProfile) {
    statements.push(
      db.prepare("INSERT INTO strategy_profiles (user_id, updated_at, json_text) VALUES (?, ?, ?)")
        .bind(userId, workspaceState.strategyProfile.updatedAt || workspaceState.strategyProfile.createdAt || new Date().toISOString(), JSON.stringify(workspaceState.strategyProfile))
    );
  }

  if (workspaceState.globalStrategyPolicy) {
    statements.push(
      db.prepare("INSERT INTO global_policies (user_id, updated_at, json_text) VALUES (?, ?, ?)")
        .bind(userId, workspaceState.globalStrategyPolicy.updatedAt || workspaceState.globalStrategyPolicy.createdAt || new Date().toISOString(), JSON.stringify(workspaceState.globalStrategyPolicy))
    );
  }

  WORKSPACE_TABLES.forEach(({ key, table, idField, timeField, extraFields }) => {
    (workspaceState[key] || []).forEach((item) => {
      const columns = [idField, "user_id", ...extraFields, timeField, "json_text"];
      const values = [
        item[idField] || createId(table),
        userId,
        ...extraFields.map((field) => item[field] || null),
        item.updatedAt || item.timestamp || item.createdAt || new Date().toISOString(),
        JSON.stringify(item)
      ];
      const placeholders = columns.map(() => "?").join(", ");
      statements.push(db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`).bind(...values));
    });
  });

  if (statements.length > 0) {
    await db.batch(statements);
  }
}

function createArrayStore(list = [], idField = "id") {
  return {
    list,
    getById(id) {
      return list.find((item) => item[idField] === id) || null;
    },
    save(item) {
      const index = list.findIndex((entry) => entry[idField] === item[idField]);
      if (index >= 0) {
        list[index] = item;
      } else {
        list.unshift(item);
      }
      return item;
    },
    removeBy(fieldName, fieldValue) {
      const index = list.findIndex((entry) => entry[fieldName] === fieldValue);
      if (index >= 0) {
        const [removed] = list.splice(index, 1);
        return removed;
      }
      return null;
    }
  };
}

async function createWorkerOverrideStore({ env, request, resolvedUserId = null }) {
  const db = getWorkerDbOrThrow(env);
  const users = await loadUsers(db);
  const userState = {
    list: [...users],
    createdUsers: []
  };
  const sessionCookieName = env.SESSION_COOKIE_NAME || "applyflow_session";
  const cookies = parseCookies(request);
  const sessionId = cookies[sessionCookieName] || null;
  const currentSession = await loadSessionById(db, sessionId);
  const currentUserId = resolvedUserId || currentSession?.userId || null;
  const workspace = await loadWorkspaceState(db, currentUserId);

  const sessionState = {
    currentSession,
    createdSessions: [],
    deletedSessionIds: new Set()
  };
  const workspaceState = {
    ...workspace,
    dirty: false
  };

  const jobsStore = createArrayStore(workspaceState.jobs);
  const fitStore = createArrayStore(workspaceState.fitAssessments);
  const prepStore = createArrayStore(workspaceState.applicationPreps);
  const taskStore = createArrayStore(workspaceState.applicationTasks);
  const reflectionStore = createArrayStore(workspaceState.interviewReflections);
  const policyProposalStore = createArrayStore(workspaceState.policyProposals);
  const activityStore = createArrayStore(workspaceState.activityLogs);
  const badCaseStore = createArrayStore(workspaceState.badCases);

  const markDirty = () => {
    workspaceState.dirty = true;
  };

  function listUsersLocal() {
    return userState.list;
  }

  function getUser(userId) {
    return userState.list.find((user) => user.id === userId) || null;
  }

  function findUserByLogin(login) {
    const normalized = String(login || "").trim().toLowerCase();
    return userState.list.find((user) => {
      return (
        String(user.email || "").toLowerCase() === normalized ||
        String(user.username || "").toLowerCase() === normalized ||
        String(user.id || "").toLowerCase() === normalized
      );
    }) || null;
  }

  function ensureUser({ email, username }) {
    const existing = findUserByLogin(email || username);
    if (existing) return existing;
    const user = {
      id: `user_${Math.random().toString(36).slice(2, 10)}`,
      email: email || username,
      username: username || email,
      createdAt: new Date().toISOString()
    };
    userState.list.push(user);
    userState.createdUsers.push(user);
    return user;
  }

  const overrideStore = {
    listUsers: listUsersLocal,
    getUser,
    findUserByLogin,
    ensureUser,
    getState() {
      return {
        users: userState.list,
        sessions: [
          ...(sessionState.currentSession ? [sessionState.currentSession] : []),
          ...sessionState.createdSessions
        ],
        ...workspaceState
      };
    },
    getStateForUser(userId) {
      if (userId !== currentUserId) return null;
      return {
        users: userState.list,
        sessions: [
          ...(sessionState.currentSession ? [sessionState.currentSession] : []),
          ...sessionState.createdSessions
        ].filter((session) => session.userId === userId),
        ...workspaceState
      };
    },
    createSession(userId) {
      const ttl = Number(env.SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 14);
      const session = {
        sessionId: `sess_${Math.random().toString(36).slice(2, 10)}`,
        userId,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + ttl).toISOString()
      };
      sessionState.createdSessions = sessionState.createdSessions.filter((item) => item.userId !== userId);
      sessionState.createdSessions.unshift(session);
      return session;
    },
    getSession(targetSessionId) {
      if (!targetSessionId) return null;
      if (sessionState.deletedSessionIds.has(targetSessionId)) return null;
      const created = sessionState.createdSessions.find((item) => item.sessionId === targetSessionId);
      if (created) return created;
      if (sessionState.currentSession?.sessionId === targetSessionId) return sessionState.currentSession;
      return null;
    },
    deleteSession(targetSessionId) {
      sessionState.deletedSessionIds.add(targetSessionId);
      sessionState.createdSessions = sessionState.createdSessions.filter((item) => item.sessionId !== targetSessionId);
      if (sessionState.currentSession?.sessionId === targetSessionId) {
        sessionState.currentSession = null;
      }
    },
    getProfile() {
      return workspaceState.profile;
    },
    saveProfile(profile) {
      markDirty();
      workspaceState.profile = { ...profile, userId: currentUserId };
      return workspaceState.profile;
    },
    getStrategyProfile() {
      return workspaceState.strategyProfile;
    },
    saveStrategyProfile(strategyProfile) {
      markDirty();
      workspaceState.strategyProfile = { ...strategyProfile, userId: currentUserId };
      return workspaceState.strategyProfile;
    },
    getGlobalStrategyPolicy() {
      return workspaceState.globalStrategyPolicy;
    },
    saveGlobalStrategyPolicy(policy) {
      markDirty();
      workspaceState.globalStrategyPolicy = { ...policy, userId: currentUserId };
      return workspaceState.globalStrategyPolicy;
    },
    listPolicyHistory() {
      return workspaceState.policyHistory;
    },
    savePolicyHistoryEntry(entry) {
      markDirty();
      workspaceState.policyHistory.unshift({ ...entry, userId: currentUserId });
      return workspaceState.policyHistory[0];
    },
    listPolicyProposals() {
      return workspaceState.policyProposals;
    },
    getPolicyProposal(proposalId) {
      return policyProposalStore.getById(proposalId);
    },
    savePolicyProposal(proposal) {
      markDirty();
      return policyProposalStore.save({ ...proposal, userId: currentUserId });
    },
    listPolicyAuditLogs() {
      return workspaceState.policyAuditLogs;
    },
    savePolicyAuditLog(entry) {
      markDirty();
      workspaceState.policyAuditLogs.unshift({ ...entry, userId: currentUserId });
      return workspaceState.policyAuditLogs[0];
    },
    listJobs() {
      return workspaceState.jobs;
    },
    getJob(jobId) {
      return jobsStore.getById(jobId);
    },
    saveJob(job) {
      markDirty();
      return jobsStore.save({ ...job, userId: currentUserId });
    },
    listFitAssessments() {
      return workspaceState.fitAssessments;
    },
    getFitAssessmentByJobId(jobId) {
      return workspaceState.fitAssessments.find((item) => item.jobId === jobId) || null;
    },
    saveFitAssessment(assessment) {
      markDirty();
      return fitStore.save({ ...assessment, userId: currentUserId });
    },
    getApplicationPrepByJobId(jobId) {
      return workspaceState.applicationPreps.find((item) => item.jobId === jobId) || null;
    },
    saveApplicationPrep(prep) {
      markDirty();
      return prepStore.save({ ...prep, userId: currentUserId });
    },
    listTasksByJobId(jobId) {
      return workspaceState.applicationTasks.filter((task) => task.jobId === jobId);
    },
    listTasks() {
      return workspaceState.applicationTasks;
    },
    saveTask(task) {
      markDirty();
      return taskStore.save({ ...task, userId: currentUserId });
    },
    getInterviewReflectionByJobId(jobId) {
      return workspaceState.interviewReflections.find((item) => item.jobId === jobId) || null;
    },
    saveInterviewReflection(reflection) {
      markDirty();
      return reflectionStore.save({ ...reflection, userId: currentUserId });
    },
    listActivityLogsByJobId(jobId) {
      return workspaceState.activityLogs.filter(
        (item) => item.jobId === jobId || item.entityId === jobId || item.metadata?.jobId === jobId
      );
    },
    listActivityLogs() {
      return workspaceState.activityLogs;
    },
    saveActivityLog(log) {
      markDirty();
      return activityStore.save({
        ...log,
        userId: currentUserId,
        timestamp: log.timestamp || log.createdAt || new Date().toISOString()
      });
    },
    listBadCases() {
      return workspaceState.badCases;
    },
    getBadCaseByJobId(jobId) {
      return workspaceState.badCases.find((item) => item.jobId === jobId) || null;
    },
    saveBadCase(badCase) {
      markDirty();
      return badCaseStore.save({ ...badCase, userId: currentUserId });
    },
    removeBadCase(jobId) {
      markDirty();
      return badCaseStore.removeBy("jobId", jobId);
    },
    async flush() {
      if (sessionState.deletedSessionIds.size > 0) {
        await db.batch(
          [...sessionState.deletedSessionIds].map((targetSessionId) =>
            db.prepare("DELETE FROM sessions WHERE session_id = ?").bind(targetSessionId)
          )
        );
      }

      if (sessionState.createdSessions.length > 0) {
        const createStatements = [];
        sessionState.createdSessions.forEach((session) => {
          createStatements.push(db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(session.userId));
          createStatements.push(
            db.prepare("INSERT INTO sessions (session_id, user_id, created_at, expires_at, json_text) VALUES (?, ?, ?, ?, ?)")
              .bind(session.sessionId, session.userId, session.createdAt, session.expiresAt, JSON.stringify(session))
          );
        });
        await db.batch(createStatements);
      }

      if (userState.createdUsers.length > 0) {
        await db.batch(
          userState.createdUsers.map((user) =>
            db.prepare("INSERT OR REPLACE INTO users (id, email, username, created_at, json_text) VALUES (?, ?, ?, ?, ?)")
              .bind(user.id, user.email || null, user.username || null, user.createdAt, JSON.stringify(user))
          )
        );
      }

      if (workspaceState.dirty && currentUserId) {
        await persistWorkspaceState(db, currentUserId, workspaceState);
      }
    }
  };

  return {
    overrideStore,
    currentUserId,
    currentSession,
    users
  };
}

module.exports = {
  createWorkerOverrideStore,
  parseCookies,
  loadUsers,
  loadSessionById,
  loadWorkspaceState,
  persistWorkspaceState
};
