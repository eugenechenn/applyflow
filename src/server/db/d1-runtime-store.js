const { createId } = require("../../lib/utils/id");

const WORKSPACE_TABLES = [
  { key: "resumeDocuments", table: "resume_documents", idField: "id", timeField: "updated_at", extraFields: ["status"] },
  { key: "policyHistory", table: "policy_history", idField: "id", timeField: "created_at", extraFields: [] },
  { key: "policyProposals", table: "policy_proposals", idField: "id", timeField: "created_at", extraFields: ["status"] },
  { key: "policyAuditLogs", table: "policy_audit_logs", idField: "id", timeField: "timestamp", extraFields: [] },
  { key: "jobs", table: "jobs", idField: "id", timeField: "updated_at", extraFields: ["status", "priority"] },
  { key: "fitAssessments", table: "fit_assessments", idField: "id", timeField: "updated_at", extraFields: ["job_id"] },
  { key: "applicationPreps", table: "application_preps", idField: "id", timeField: "updated_at", extraFields: ["job_id"] },
  { key: "tailoringOutputs", table: "tailoring_outputs", idField: "id", timeField: "updated_at", extraFields: ["job_id"] },
  { key: "applicationTasks", table: "application_tasks", idField: "id", timeField: "updated_at", extraFields: ["job_id", "status"] },
  { key: "interviewReflections", table: "interview_reflections", idField: "id", timeField: "updated_at", extraFields: ["job_id"] },
  { key: "activityLogs", table: "activity_logs", idField: "id", timeField: "timestamp", extraFields: ["job_id"] },
  { key: "badCases", table: "bad_cases", idField: "id", timeField: "updated_at", extraFields: ["job_id"] }
];

function toCamelCase(fieldName = "") {
  return String(fieldName).replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function getExtraFieldValue(item, fieldName) {
  if (!item || !fieldName) return null;
  if (item[fieldName] !== undefined) return item[fieldName];
  const camelCaseField = toCamelCase(fieldName);
  if (item[camelCaseField] !== undefined) return item[camelCaseField];
  return null;
}

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

function createEmptyWorkspaceState() {
  return {
    profile: null,
    resumeDocuments: [],
    strategyProfile: null,
    globalStrategyPolicy: null,
    policyHistory: [],
    policyProposals: [],
    policyAuditLogs: [],
    jobs: [],
    fitAssessments: [],
    applicationPreps: [],
    tailoringOutputs: [],
    applicationTasks: [],
    interviewReflections: [],
    activityLogs: [],
    badCases: []
  };
}

function shouldLoadWorkspaceKey(scope = null, key = "") {
  if (!scope || !Array.isArray(scope.keys) || scope.keys.length === 0) {
    return true;
  }
  return scope.keys.includes(key);
}

async function loadWorkspaceState(db, userId, scope = null) {
  if (!userId) {
    return createEmptyWorkspaceState();
  }

  const state = createEmptyWorkspaceState();

  if (shouldLoadWorkspaceKey(scope, "profile")) {
    state.profile = await selectJsonRow(db, "SELECT json_text FROM profiles WHERE user_id = ?", [userId]);
  }
  if (shouldLoadWorkspaceKey(scope, "strategyProfile")) {
    state.strategyProfile = await selectJsonRow(db, "SELECT json_text FROM strategy_profiles WHERE user_id = ?", [userId]);
  }
  if (shouldLoadWorkspaceKey(scope, "globalStrategyPolicy")) {
    state.globalStrategyPolicy = await selectJsonRow(db, "SELECT json_text FROM global_policies WHERE user_id = ?", [userId]);
  }
  if (shouldLoadWorkspaceKey(scope, "resumeDocuments")) {
    state.resumeDocuments = await selectJsonRows(
      db,
      "SELECT json_text FROM resume_documents WHERE user_id = ? ORDER BY updated_at DESC",
      [userId]
    );
  }
  if (shouldLoadWorkspaceKey(scope, "policyHistory")) {
    state.policyHistory = await selectJsonRows(
      db,
      "SELECT json_text FROM policy_history WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    );
  }
  if (shouldLoadWorkspaceKey(scope, "policyProposals")) {
    state.policyProposals = await selectJsonRows(
      db,
      "SELECT json_text FROM policy_proposals WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    );
  }
  if (shouldLoadWorkspaceKey(scope, "policyAuditLogs")) {
    state.policyAuditLogs = await selectJsonRows(
      db,
      "SELECT json_text FROM policy_audit_logs WHERE user_id = ? ORDER BY timestamp DESC",
      [userId]
    );
  }
  if (shouldLoadWorkspaceKey(scope, "jobs")) {
    if (scope?.jobId) {
      const job = await selectJsonRow(db, "SELECT json_text FROM jobs WHERE user_id = ? AND id = ? LIMIT 1", [userId, scope.jobId]);
      state.jobs = job ? [job] : [];
    } else {
      state.jobs = await selectJsonRows(db, "SELECT json_text FROM jobs WHERE user_id = ? ORDER BY updated_at DESC", [userId]);
    }
  }
  if (shouldLoadWorkspaceKey(scope, "fitAssessments")) {
    state.fitAssessments = await selectJsonRows(
      db,
      "SELECT json_text FROM fit_assessments WHERE user_id = ? ORDER BY updated_at DESC",
      [userId]
    );
  }
  if (shouldLoadWorkspaceKey(scope, "applicationPreps")) {
    state.applicationPreps = await selectJsonRows(
      db,
      "SELECT json_text FROM application_preps WHERE user_id = ? ORDER BY updated_at DESC",
      [userId]
    );
  }
  if (shouldLoadWorkspaceKey(scope, "tailoringOutputs")) {
    state.tailoringOutputs = await selectJsonRows(
      db,
      "SELECT json_text FROM tailoring_outputs WHERE user_id = ? ORDER BY updated_at DESC",
      [userId]
    );
  }
  if (shouldLoadWorkspaceKey(scope, "applicationTasks")) {
    state.applicationTasks = await selectJsonRows(
      db,
      "SELECT json_text FROM application_tasks WHERE user_id = ? ORDER BY updated_at DESC",
      [userId]
    );
  }
  if (shouldLoadWorkspaceKey(scope, "interviewReflections")) {
    state.interviewReflections = await selectJsonRows(
      db,
      "SELECT json_text FROM interview_reflections WHERE user_id = ? ORDER BY updated_at DESC",
      [userId]
    );
  }
  if (shouldLoadWorkspaceKey(scope, "activityLogs")) {
    if (scope?.jobId) {
      state.activityLogs = await selectJsonRows(
        db,
        "SELECT json_text FROM activity_logs WHERE user_id = ? AND job_id = ? ORDER BY timestamp DESC",
        [userId, scope.jobId]
      );
    } else {
      state.activityLogs = await selectJsonRows(
        db,
        "SELECT json_text FROM activity_logs WHERE user_id = ? ORDER BY timestamp DESC",
        [userId]
      );
    }
  }
  if (shouldLoadWorkspaceKey(scope, "badCases")) {
    if (scope?.jobId) {
      const badCase = await selectJsonRow(
        db,
        "SELECT json_text FROM bad_cases WHERE user_id = ? AND job_id = ? LIMIT 1",
        [userId, scope.jobId]
      );
      state.badCases = badCase ? [badCase] : [];
    } else {
      state.badCases = await selectJsonRows(db, "SELECT json_text FROM bad_cases WHERE user_id = ? ORDER BY updated_at DESC", [userId]);
    }
  }

  return state;
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
        ...extraFields.map((field) => getExtraFieldValue(item, field)),
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

function ensureDirtyCollectionMap(state, key) {
  if (!state.collections.has(key)) {
    state.collections.set(key, new Map());
  }
  return state.collections.get(key);
}

function queueCollectionUpsert(dirtyState, key, item, idField = "id") {
  if (!item || !item[idField]) return;
  const map = ensureDirtyCollectionMap(dirtyState, key);
  map.set(item[idField], item);
  const deleted = dirtyState.deletedCollections.get(key);
  if (deleted) {
    deleted.delete(item[idField]);
  }
}

function queueCollectionDelete(dirtyState, key, itemId) {
  if (!itemId) return;
  if (!dirtyState.deletedCollections.has(key)) {
    dirtyState.deletedCollections.set(key, new Set());
  }
  dirtyState.deletedCollections.get(key).add(itemId);
  const map = dirtyState.collections.get(key);
  if (map) {
    map.delete(itemId);
  }
}

async function flushSingleton(db, tableName, userId, value, updatedAtField = "updatedAt") {
  await db.prepare(`DELETE FROM ${tableName} WHERE user_id = ?`).bind(userId).run();
  if (!value) return;
  const updatedAt = value[updatedAtField] || value.createdAt || new Date().toISOString();
  await db.prepare(`INSERT INTO ${tableName} (user_id, updated_at, json_text) VALUES (?, ?, ?)`)
    .bind(userId, updatedAt, JSON.stringify(value))
    .run();
}

async function flushCollectionEntries(db, userId, tableConfig, upsertMap = new Map(), deletedIds = new Set()) {
  const { table, idField, timeField, extraFields } = tableConfig;

  for (const itemId of deletedIds) {
    await db.prepare(`DELETE FROM ${table} WHERE user_id = ? AND ${idField} = ?`).bind(userId, itemId).run();
  }

  for (const item of upsertMap.values()) {
    const columns = [idField, "user_id", ...extraFields, timeField, "json_text"];
    const values = [
      item[idField],
      userId,
      ...extraFields.map((field) => getExtraFieldValue(item, field)),
      item.updatedAt || item.timestamp || item.createdAt || new Date().toISOString(),
      JSON.stringify(item)
    ];
    const placeholders = columns.map(() => "?").join(", ");
    const updateColumns = ["user_id", ...extraFields, timeField, "json_text"]
      .map((column) => `${column} = excluded.${column}`)
      .join(", ");
    await db.prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT(${idField}) DO UPDATE SET ${updateColumns}`
    )
      .bind(...values)
      .run();
  }
}

async function createWorkerOverrideStore({ env, request, resolvedUserId = null, workspaceScope = null }) {
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
  const workspace = await loadWorkspaceState(db, currentUserId, workspaceScope);

  const sessionState = {
    currentSession,
    createdSessions: [],
    deletedSessionIds: new Set()
  };
  const workspaceState = {
    ...workspace,
    dirty: false
  };
  const dirtyState = {
    singletons: new Set(),
    collections: new Map(),
    deletedCollections: new Map()
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
      dirtyState.singletons.add("profile");
      return workspaceState.profile;
    },
    listResumeDocuments() {
      return workspaceState.resumeDocuments;
    },
    getResumeDocument(resumeId) {
      return workspaceState.resumeDocuments.find((item) => item.id === resumeId) || null;
    },
    getLatestResumeDocument() {
      return workspaceState.resumeDocuments[0] || null;
    },
    saveResumeDocument(resumeDocument) {
      markDirty();
      const next = { ...resumeDocument, userId: currentUserId };
      const index = workspaceState.resumeDocuments.findIndex((item) => item.id === next.id);
      if (index >= 0) {
        workspaceState.resumeDocuments[index] = next;
      } else {
        workspaceState.resumeDocuments.unshift(next);
      }
      workspaceState.resumeDocuments.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
      queueCollectionUpsert(dirtyState, "resumeDocuments", next);
      return next;
    },
    getStrategyProfile() {
      return workspaceState.strategyProfile;
    },
    saveStrategyProfile(strategyProfile) {
      markDirty();
      workspaceState.strategyProfile = { ...strategyProfile, userId: currentUserId };
      dirtyState.singletons.add("strategyProfile");
      return workspaceState.strategyProfile;
    },
    getGlobalStrategyPolicy() {
      return workspaceState.globalStrategyPolicy;
    },
    saveGlobalStrategyPolicy(policy) {
      markDirty();
      workspaceState.globalStrategyPolicy = { ...policy, userId: currentUserId };
      dirtyState.singletons.add("globalStrategyPolicy");
      return workspaceState.globalStrategyPolicy;
    },
    listPolicyHistory() {
      return workspaceState.policyHistory;
    },
    savePolicyHistoryEntry(entry) {
      markDirty();
      const next = { ...entry, userId: currentUserId };
      workspaceState.policyHistory.unshift(next);
      queueCollectionUpsert(dirtyState, "policyHistory", next);
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
      const next = policyProposalStore.save({ ...proposal, userId: currentUserId });
      queueCollectionUpsert(dirtyState, "policyProposals", next);
      return next;
    },
    listPolicyAuditLogs() {
      return workspaceState.policyAuditLogs;
    },
    savePolicyAuditLog(entry) {
      markDirty();
      const next = { ...entry, userId: currentUserId };
      workspaceState.policyAuditLogs.unshift(next);
      queueCollectionUpsert(dirtyState, "policyAuditLogs", next);
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
      const next = jobsStore.save({ ...job, userId: currentUserId });
      queueCollectionUpsert(dirtyState, "jobs", next);
      return next;
    },
    listFitAssessments() {
      return workspaceState.fitAssessments;
    },
    getFitAssessmentByJobId(jobId) {
      return workspaceState.fitAssessments.find((item) => item.jobId === jobId) || null;
    },
    saveFitAssessment(assessment) {
      markDirty();
      const next = fitStore.save({ ...assessment, userId: currentUserId });
      queueCollectionUpsert(dirtyState, "fitAssessments", next);
      return next;
    },
    getApplicationPrepByJobId(jobId) {
      return workspaceState.applicationPreps.find((item) => item.jobId === jobId) || null;
    },
    saveApplicationPrep(prep) {
      markDirty();
      const next = prepStore.save({ ...prep, userId: currentUserId });
      queueCollectionUpsert(dirtyState, "applicationPreps", next);
      return next;
    },
    listTailoringOutputs() {
      return workspaceState.tailoringOutputs;
    },
    getTailoringOutputByJobId(jobId) {
      return workspaceState.tailoringOutputs.find((item) => item.jobId === jobId) || null;
    },
    saveTailoringOutput(output) {
      markDirty();
      const existingIndex = workspaceState.tailoringOutputs.findIndex((item) => item.id === output.id || item.jobId === output.jobId);
      const next = { ...output, userId: currentUserId };
      if (existingIndex >= 0) {
        workspaceState.tailoringOutputs[existingIndex] = next;
        queueCollectionUpsert(dirtyState, "tailoringOutputs", next);
        return next;
      }
      workspaceState.tailoringOutputs.unshift(next);
      queueCollectionUpsert(dirtyState, "tailoringOutputs", next);
      return next;
    },
    listTasksByJobId(jobId) {
      return workspaceState.applicationTasks.filter((task) => task.jobId === jobId);
    },
    listTasks() {
      return workspaceState.applicationTasks;
    },
    saveTask(task) {
      markDirty();
      const next = taskStore.save({ ...task, userId: currentUserId });
      queueCollectionUpsert(dirtyState, "applicationTasks", next);
      return next;
    },
    getInterviewReflectionByJobId(jobId) {
      return workspaceState.interviewReflections.find((item) => item.jobId === jobId) || null;
    },
    saveInterviewReflection(reflection) {
      markDirty();
      const next = reflectionStore.save({ ...reflection, userId: currentUserId });
      queueCollectionUpsert(dirtyState, "interviewReflections", next);
      return next;
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
      const next = activityStore.save({
        ...log,
        userId: currentUserId,
        timestamp: log.timestamp || log.createdAt || new Date().toISOString()
      });
      queueCollectionUpsert(dirtyState, "activityLogs", next);
      return next;
    },
    listBadCases() {
      return workspaceState.badCases;
    },
    getBadCaseByJobId(jobId) {
      return workspaceState.badCases.find((item) => item.jobId === jobId) || null;
    },
    saveBadCase(badCase) {
      markDirty();
      const next = badCaseStore.save({ ...badCase, userId: currentUserId });
      queueCollectionUpsert(dirtyState, "badCases", next);
      return next;
    },
    removeBadCase(jobId) {
      markDirty();
      const removed = badCaseStore.removeBy("jobId", jobId);
      if (removed?.id) {
        queueCollectionDelete(dirtyState, "badCases", removed.id);
      }
      return removed;
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
        if (dirtyState.singletons.has("profile")) {
          await flushSingleton(db, "profiles", currentUserId, workspaceState.profile);
        }
        if (dirtyState.singletons.has("strategyProfile")) {
          await flushSingleton(db, "strategy_profiles", currentUserId, workspaceState.strategyProfile);
        }
        if (dirtyState.singletons.has("globalStrategyPolicy")) {
          await flushSingleton(db, "global_policies", currentUserId, workspaceState.globalStrategyPolicy);
        }

        for (const tableConfig of WORKSPACE_TABLES) {
          const upsertMap = dirtyState.collections.get(tableConfig.key) || new Map();
          const deletedIds = dirtyState.deletedCollections.get(tableConfig.key) || new Set();
          if (upsertMap.size === 0 && deletedIds.size === 0) continue;
          await flushCollectionEntries(db, currentUserId, tableConfig, upsertMap, deletedIds);
        }
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
