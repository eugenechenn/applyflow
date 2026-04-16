var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node-built-in-modules:async_hooks
import libDefault from "async_hooks";
var require_async_hooks = __commonJS({
  "node-built-in-modules:async_hooks"(exports2, module2) {
    module2.exports = libDefault;
  }
});

// src/server/request-context.js
var require_request_context = __commonJS({
  "src/server/request-context.js"(exports2, module2) {
    var AsyncLocalStorageImpl = null;
    try {
      ({ AsyncLocalStorage: AsyncLocalStorageImpl } = require_async_hooks());
    } catch (error) {
      AsyncLocalStorageImpl = null;
    }
    var requestContextStorage = AsyncLocalStorageImpl ? new AsyncLocalStorageImpl() : null;
    var fallbackContextStack = [];
    function runWithRequestContext2(context, handler) {
      if (requestContextStorage) {
        return requestContextStorage.run(context, handler);
      }
      fallbackContextStack.push(context);
      try {
        return handler();
      } finally {
        fallbackContextStack.pop();
      }
    }
    __name(runWithRequestContext2, "runWithRequestContext");
    function getRequestContext2() {
      if (requestContextStorage) {
        return requestContextStorage.getStore() || {};
      }
      return fallbackContextStack[fallbackContextStack.length - 1] || {};
    }
    __name(getRequestContext2, "getRequestContext");
    module2.exports = {
      runWithRequestContext: runWithRequestContext2,
      getRequestContext: getRequestContext2
    };
  }
});

// src/server/platform/runtime.js
var require_runtime = __commonJS({
  "src/server/platform/runtime.js"(exports2, module2) {
    function detectRuntime() {
      if (process.env.APPLYFLOW_RUNTIME) {
        return String(process.env.APPLYFLOW_RUNTIME).trim().toLowerCase();
      }
      if (typeof WebSocketPair !== "undefined" && typeof caches !== "undefined") {
        return "cloudflare";
      }
      return "node";
    }
    __name(detectRuntime, "detectRuntime");
    function getDatabaseProvider() {
      return String(process.env.APPLYFLOW_DB_PROVIDER || "sqlite").trim().toLowerCase();
    }
    __name(getDatabaseProvider, "getDatabaseProvider");
    function getRuntimeConfig2() {
      const runtime2 = detectRuntime();
      const dbProvider = getDatabaseProvider();
      return {
        runtime: runtime2,
        dbProvider,
        isNodeRuntime: runtime2 === "node",
        isCloudflareRuntime: runtime2 === "cloudflare",
        isSQLiteProvider: dbProvider === "sqlite",
        isD1Provider: dbProvider === "d1",
        publicAssetHost: process.env.PUBLIC_APP_ORIGIN || "",
        d1BindingName: process.env.CLOUDFLARE_D1_BINDING || "APPLYFLOW_DB"
      };
    }
    __name(getRuntimeConfig2, "getRuntimeConfig");
    module2.exports = {
      detectRuntime,
      getDatabaseProvider,
      getRuntimeConfig: getRuntimeConfig2
    };
  }
});

// src/server/store.js
var require_store = __commonJS({
  "src/server/store.js"(exports, module) {
    var { getRequestContext } = require_request_context();
    var { getRuntimeConfig } = require_runtime();
    function runtimeRequire(modulePath) {
      return eval("require")(modulePath);
    }
    __name(runtimeRequire, "runtimeRequire");
    function getRepository() {
      return runtimeRequire("./repositories/applyflow-repository");
    }
    __name(getRepository, "getRepository");
    function getSqliteMeta() {
      return runtimeRequire("./db/sqlite");
    }
    __name(getSqliteMeta, "getSqliteMeta");
    var runtime = getRuntimeConfig();
    var nodeRepository = runtime.isCloudflareRuntime ? null : getRepository();
    var sqliteMeta = runtime.isCloudflareRuntime ? { dataDir: null, sqliteFilePath: null } : getSqliteMeta();
    var DEFAULT_USER_ID = nodeRepository?.DEFAULT_USER_ID || "user_a";
    var storeFilePath = nodeRepository?.storeFilePath || null;
    var migrationStatus = nodeRepository ? nodeRepository.migrateJsonStateIfNeeded() : { migrated: false, source: "worker" };
    function nowIso() {
      return (/* @__PURE__ */ new Date()).toISOString();
    }
    __name(nowIso, "nowIso");
    function getActiveUserId() {
      return getRequestContext().userId || DEFAULT_USER_ID;
    }
    __name(getActiveUserId, "getActiveUserId");
    function getOverrideStore() {
      return getRequestContext().overrideStore || null;
    }
    __name(getOverrideStore, "getOverrideStore");
    function getState() {
      const override = getOverrideStore();
      if (override?.getState) return override.getState();
      return {
        users: listUsers(),
        sessions: getRepository().listSessions(),
        ...getRepository().getWorkspaceState(getActiveUserId())
      };
    }
    __name(getState, "getState");
    function getStateForUser(userId) {
      const override = getOverrideStore();
      if (override?.getStateForUser) return override.getStateForUser(userId);
      return {
        users: listUsers(),
        sessions: getRepository().listSessions().filter((session) => session.userId === userId),
        ...getRepository().getWorkspaceState(userId)
      };
    }
    __name(getStateForUser, "getStateForUser");
    function listUsers() {
      const override = getOverrideStore();
      if (override?.listUsers) return override.listUsers();
      return getRepository().listUsers();
    }
    __name(listUsers, "listUsers");
    function getUser(userId) {
      const override = getOverrideStore();
      if (override?.getUser) return override.getUser(userId);
      return getRepository().getUser(userId);
    }
    __name(getUser, "getUser");
    function findUserByLogin(login) {
      const override = getOverrideStore();
      if (override?.findUserByLogin) return override.findUserByLogin(login);
      return getRepository().findUserByLogin(login);
    }
    __name(findUserByLogin, "findUserByLogin");
    function ensureUser({ email, username }) {
      const override = getOverrideStore();
      if (override?.ensureUser) return override.ensureUser({ email, username });
      const existing = findUserByLogin(email || username);
      if (existing) return existing;
      const user = {
        id: `user_${listUsers().length + 1}`,
        email: email || username,
        username: username || email,
        createdAt: nowIso()
      };
      return getRepository().saveUser(user);
    }
    __name(ensureUser, "ensureUser");
    function createSession(userId) {
      const override = getOverrideStore();
      if (override?.createSession) return override.createSession(userId);
      const ttl = Number(process.env.SESSION_TTL_MS || 1e3 * 60 * 60 * 24 * 14);
      const session = {
        sessionId: `sess_${Math.random().toString(36).slice(2, 10)}`,
        userId,
        createdAt: nowIso(),
        expiresAt: new Date(Date.now() + ttl).toISOString()
      };
      getRepository().deleteSessionsByUserId(userId);
      return getRepository().saveSession(session);
    }
    __name(createSession, "createSession");
    function getSession(sessionId) {
      const override = getOverrideStore();
      if (override?.getSession) return override.getSession(sessionId);
      if (!sessionId) return null;
      const session = getRepository().getSession(sessionId);
      if (!session) return null;
      if (session.expiresAt && new Date(session.expiresAt) <= /* @__PURE__ */ new Date()) {
        deleteSession(sessionId);
        return null;
      }
      return session;
    }
    __name(getSession, "getSession");
    function deleteSession(sessionId) {
      const override = getOverrideStore();
      if (override?.deleteSession) return override.deleteSession(sessionId);
      getRepository().deleteSession(sessionId);
    }
    __name(deleteSession, "deleteSession");
    function getProfile() {
      const override = getOverrideStore();
      if (override?.getProfile) return override.getProfile();
      return getRepository().getProfile(getActiveUserId());
    }
    __name(getProfile, "getProfile");
    function saveProfile(profile) {
      const override = getOverrideStore();
      if (override?.saveProfile) return override.saveProfile(profile);
      return getRepository().saveProfile(getActiveUserId(), { ...profile, userId: getActiveUserId() });
    }
    __name(saveProfile, "saveProfile");
    function getStrategyProfile() {
      const override = getOverrideStore();
      if (override?.getStrategyProfile) return override.getStrategyProfile();
      return getRepository().getStrategyProfile(getActiveUserId());
    }
    __name(getStrategyProfile, "getStrategyProfile");
    function saveStrategyProfile(strategyProfile) {
      const override = getOverrideStore();
      if (override?.saveStrategyProfile) return override.saveStrategyProfile(strategyProfile);
      return getRepository().saveStrategyProfile(getActiveUserId(), { ...strategyProfile, userId: getActiveUserId() });
    }
    __name(saveStrategyProfile, "saveStrategyProfile");
    function getGlobalStrategyPolicy() {
      const override = getOverrideStore();
      if (override?.getGlobalStrategyPolicy) return override.getGlobalStrategyPolicy();
      return getRepository().getGlobalStrategyPolicy(getActiveUserId());
    }
    __name(getGlobalStrategyPolicy, "getGlobalStrategyPolicy");
    function saveGlobalStrategyPolicy(globalStrategyPolicy) {
      const override = getOverrideStore();
      if (override?.saveGlobalStrategyPolicy) return override.saveGlobalStrategyPolicy(globalStrategyPolicy);
      return getRepository().saveGlobalStrategyPolicy(getActiveUserId(), {
        ...globalStrategyPolicy,
        userId: getActiveUserId()
      });
    }
    __name(saveGlobalStrategyPolicy, "saveGlobalStrategyPolicy");
    function listPolicyHistory() {
      const override = getOverrideStore();
      if (override?.listPolicyHistory) return override.listPolicyHistory();
      return getRepository().listPolicyHistory(getActiveUserId());
    }
    __name(listPolicyHistory, "listPolicyHistory");
    function savePolicyHistoryEntry(entry) {
      const override = getOverrideStore();
      if (override?.savePolicyHistoryEntry) return override.savePolicyHistoryEntry(entry);
      return getRepository().savePolicyHistoryEntry(getActiveUserId(), { ...entry, userId: getActiveUserId() });
    }
    __name(savePolicyHistoryEntry, "savePolicyHistoryEntry");
    function listPolicyProposals() {
      const override = getOverrideStore();
      if (override?.listPolicyProposals) return override.listPolicyProposals();
      return getRepository().listPolicyProposals(getActiveUserId());
    }
    __name(listPolicyProposals, "listPolicyProposals");
    function getPolicyProposal(proposalId) {
      const override = getOverrideStore();
      if (override?.getPolicyProposal) return override.getPolicyProposal(proposalId);
      return getRepository().getPolicyProposal(getActiveUserId(), proposalId);
    }
    __name(getPolicyProposal, "getPolicyProposal");
    function savePolicyProposal(proposal) {
      const override = getOverrideStore();
      if (override?.savePolicyProposal) return override.savePolicyProposal(proposal);
      return getRepository().savePolicyProposal(getActiveUserId(), { ...proposal, userId: getActiveUserId() });
    }
    __name(savePolicyProposal, "savePolicyProposal");
    function listPolicyAuditLogs() {
      const override = getOverrideStore();
      if (override?.listPolicyAuditLogs) return override.listPolicyAuditLogs();
      return getRepository().listPolicyAuditLogs(getActiveUserId());
    }
    __name(listPolicyAuditLogs, "listPolicyAuditLogs");
    function savePolicyAuditLog(entry) {
      const override = getOverrideStore();
      if (override?.savePolicyAuditLog) return override.savePolicyAuditLog(entry);
      return getRepository().savePolicyAuditLog(getActiveUserId(), { ...entry, userId: getActiveUserId() });
    }
    __name(savePolicyAuditLog, "savePolicyAuditLog");
    function listJobs() {
      const override = getOverrideStore();
      if (override?.listJobs) return override.listJobs();
      return getRepository().listJobs(getActiveUserId());
    }
    __name(listJobs, "listJobs");
    function getJob(jobId) {
      const override = getOverrideStore();
      if (override?.getJob) return override.getJob(jobId);
      return getRepository().getJob(getActiveUserId(), jobId);
    }
    __name(getJob, "getJob");
    function saveJob(job) {
      const override = getOverrideStore();
      if (override?.saveJob) return override.saveJob(job);
      return getRepository().saveJob(getActiveUserId(), { ...job, userId: getActiveUserId() });
    }
    __name(saveJob, "saveJob");
    function listFitAssessments() {
      const override = getOverrideStore();
      if (override?.listFitAssessments) return override.listFitAssessments();
      return getRepository().listFitAssessments(getActiveUserId());
    }
    __name(listFitAssessments, "listFitAssessments");
    function getFitAssessmentByJobId(jobId) {
      const override = getOverrideStore();
      if (override?.getFitAssessmentByJobId) return override.getFitAssessmentByJobId(jobId);
      return getRepository().getFitAssessmentByJobId(getActiveUserId(), jobId);
    }
    __name(getFitAssessmentByJobId, "getFitAssessmentByJobId");
    function saveFitAssessment(assessment) {
      const override = getOverrideStore();
      if (override?.saveFitAssessment) return override.saveFitAssessment(assessment);
      return getRepository().saveFitAssessment(getActiveUserId(), { ...assessment, userId: getActiveUserId() });
    }
    __name(saveFitAssessment, "saveFitAssessment");
    function getApplicationPrepByJobId(jobId) {
      const override = getOverrideStore();
      if (override?.getApplicationPrepByJobId) return override.getApplicationPrepByJobId(jobId);
      return getRepository().getApplicationPrepByJobId(getActiveUserId(), jobId);
    }
    __name(getApplicationPrepByJobId, "getApplicationPrepByJobId");
    function saveApplicationPrep(prep) {
      const override = getOverrideStore();
      if (override?.saveApplicationPrep) return override.saveApplicationPrep(prep);
      return getRepository().saveApplicationPrep(getActiveUserId(), { ...prep, userId: getActiveUserId() });
    }
    __name(saveApplicationPrep, "saveApplicationPrep");
    function listTasksByJobId(jobId) {
      const override = getOverrideStore();
      if (override?.listTasksByJobId) return override.listTasksByJobId(jobId);
      return getRepository().listTasksByJobId(getActiveUserId(), jobId);
    }
    __name(listTasksByJobId, "listTasksByJobId");
    function listTasks() {
      const override = getOverrideStore();
      if (override?.listTasks) return override.listTasks();
      return getRepository().listTasks(getActiveUserId());
    }
    __name(listTasks, "listTasks");
    function saveTask(task) {
      const override = getOverrideStore();
      if (override?.saveTask) return override.saveTask(task);
      return getRepository().saveTask(getActiveUserId(), { ...task, userId: getActiveUserId() });
    }
    __name(saveTask, "saveTask");
    function getInterviewReflectionByJobId(jobId) {
      const override = getOverrideStore();
      if (override?.getInterviewReflectionByJobId) return override.getInterviewReflectionByJobId(jobId);
      return getRepository().getInterviewReflectionByJobId(getActiveUserId(), jobId);
    }
    __name(getInterviewReflectionByJobId, "getInterviewReflectionByJobId");
    function saveInterviewReflection(reflection) {
      const override = getOverrideStore();
      if (override?.saveInterviewReflection) return override.saveInterviewReflection(reflection);
      return getRepository().saveInterviewReflection(getActiveUserId(), { ...reflection, userId: getActiveUserId() });
    }
    __name(saveInterviewReflection, "saveInterviewReflection");
    function listActivityLogsByJobId(jobId) {
      const override = getOverrideStore();
      if (override?.listActivityLogsByJobId) return override.listActivityLogsByJobId(jobId);
      return getRepository().listActivityLogsByJobId(getActiveUserId(), jobId);
    }
    __name(listActivityLogsByJobId, "listActivityLogsByJobId");
    function listActivityLogs() {
      const override = getOverrideStore();
      if (override?.listActivityLogs) return override.listActivityLogs();
      return getRepository().listActivityLogs(getActiveUserId());
    }
    __name(listActivityLogs, "listActivityLogs");
    function saveActivityLog(log) {
      const override = getOverrideStore();
      if (override?.saveActivityLog) return override.saveActivityLog(log);
      return getRepository().saveActivityLog(getActiveUserId(), { ...log, userId: getActiveUserId() });
    }
    __name(saveActivityLog, "saveActivityLog");
    function listBadCases() {
      const override = getOverrideStore();
      if (override?.listBadCases) return override.listBadCases();
      return getRepository().listBadCases(getActiveUserId());
    }
    __name(listBadCases, "listBadCases");
    function getBadCaseByJobId(jobId) {
      const override = getOverrideStore();
      if (override?.getBadCaseByJobId) return override.getBadCaseByJobId(jobId);
      return getRepository().getBadCaseByJobId(getActiveUserId(), jobId);
    }
    __name(getBadCaseByJobId, "getBadCaseByJobId");
    function saveBadCase(badCase) {
      const override = getOverrideStore();
      if (override?.saveBadCase) return override.saveBadCase(badCase);
      return getRepository().saveBadCase(getActiveUserId(), { ...badCase, userId: getActiveUserId() });
    }
    __name(saveBadCase, "saveBadCase");
    function removeBadCase(jobId) {
      const override = getOverrideStore();
      if (override?.removeBadCase) return override.removeBadCase(jobId);
      return getRepository().removeBadCase(getActiveUserId(), jobId);
    }
    __name(removeBadCase, "removeBadCase");
    module.exports = {
      dataDir: sqliteMeta.dataDir,
      storeFilePath,
      sqliteFilePath: sqliteMeta.sqliteFilePath,
      migrationStatus,
      DEFAULT_USER_ID,
      getState,
      getStateForUser,
      listUsers,
      getUser,
      findUserByLogin,
      ensureUser,
      createSession,
      getSession,
      deleteSession,
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
      getApplicationPrepByJobId,
      saveApplicationPrep,
      listTasksByJobId,
      listTasks,
      saveTask,
      getInterviewReflectionByJobId,
      saveInterviewReflection,
      listActivityLogsByJobId,
      listActivityLogs,
      saveActivityLog,
      listBadCases,
      getBadCaseByJobId,
      saveBadCase,
      removeBadCase
    };
  }
});

// src/lib/utils/id.js
var require_id = __commonJS({
  "src/lib/utils/id.js"(exports2, module2) {
    function createId(prefix) {
      return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
    }
    __name(createId, "createId");
    function nowIso2() {
      return (/* @__PURE__ */ new Date()).toISOString();
    }
    __name(nowIso2, "nowIso");
    module2.exports = { createId, nowIso: nowIso2 };
  }
});

// src/lib/state/job-status.ts
var job_status_exports = {};
__export(job_status_exports, {
  ALLOWED_JOB_TRANSITIONS: () => ALLOWED_JOB_TRANSITIONS,
  JOB_STATUSES: () => JOB_STATUSES,
  canTransitionJobStatus: () => canTransitionJobStatus
});
function canTransitionJobStatus(currentStatus, nextStatus) {
  return ALLOWED_JOB_TRANSITIONS[currentStatus].includes(nextStatus);
}
var JOB_STATUSES, ALLOWED_JOB_TRANSITIONS;
var init_job_status = __esm({
  "src/lib/state/job-status.ts"() {
    JOB_STATUSES = [
      "inbox",
      "evaluating",
      "to_prepare",
      "ready_to_apply",
      "applied",
      "follow_up",
      "interviewing",
      "rejected",
      "offer",
      "archived"
    ];
    ALLOWED_JOB_TRANSITIONS = {
      inbox: ["evaluating", "archived"],
      evaluating: ["to_prepare", "archived"],
      to_prepare: ["ready_to_apply", "archived"],
      ready_to_apply: ["applied", "archived"],
      applied: ["follow_up", "interviewing", "rejected", "archived"],
      follow_up: ["interviewing", "rejected", "archived"],
      interviewing: ["offer", "rejected", "archived"],
      rejected: ["archived"],
      offer: ["archived"],
      archived: []
    };
    __name(canTransitionJobStatus, "canTransitionJobStatus");
  }
});

// src/lib/orchestrator/shared-state-helpers.js
var require_shared_state_helpers = __commonJS({
  "src/lib/orchestrator/shared-state-helpers.js"(exports2, module2) {
    var store = require_store();
    var { nowIso: nowIso2 } = require_id();
    function updateJob(jobId, updater) {
      const job = store.getJob(jobId);
      if (!job) {
        const error = new Error(`Job ${jobId} not found.`);
        error.code = "NOT_FOUND";
        throw error;
      }
      const updated = {
        ...job,
        ...updater(job),
        updatedAt: nowIso2()
      };
      store.saveJob(updated);
      return updated;
    }
    __name(updateJob, "updateJob");
    module2.exports = { updateJob };
  }
});

// src/lib/orchestrator/activity-logger.js
var require_activity_logger = __commonJS({
  "src/lib/orchestrator/activity-logger.js"(exports2, module2) {
    var store = require_store();
    var { createId, nowIso: nowIso2 } = require_id();
    function logActivity({
      entityType,
      entityId,
      action,
      type,
      actor = "system",
      jobId,
      summary,
      metadata,
      agentName,
      inputSummary,
      outputSummary,
      decisionReason,
      policyInfluenceSummary,
      decisionBreakdown,
      activePolicyVersion,
      policyProposalId,
      overrideApplied,
      overrideSummary
    }) {
      const timestamp = nowIso2();
      return store.saveActivityLog({
        id: createId("log"),
        type: type || action,
        entityType,
        entityId,
        action,
        actor,
        jobId: jobId || metadata?.jobId || (entityType === "job" ? entityId : void 0),
        summary,
        agentName: agentName || null,
        inputSummary: inputSummary || null,
        outputSummary: outputSummary || null,
        decisionReason: decisionReason || null,
        policyInfluenceSummary: policyInfluenceSummary || null,
        decisionBreakdown: decisionBreakdown || null,
        activePolicyVersion: activePolicyVersion || null,
        policyProposalId: policyProposalId || null,
        overrideApplied: overrideApplied ?? null,
        overrideSummary: overrideSummary || null,
        metadata,
        createdAt: timestamp,
        timestamp
      });
    }
    __name(logActivity, "logActivity");
    module2.exports = { logActivity };
  }
});

// src/server/platform/logger.js
var require_logger = __commonJS({
  "src/server/platform/logger.js"(exports2, module2) {
    function redact(value) {
      if (!value) return value;
      const text = String(value);
      if (text.length <= 8) return "***";
      return `${text.slice(0, 2)}***${text.slice(-2)}`;
    }
    __name(redact, "redact");
    function baseLog(level, event, payload = {}) {
      const record = {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level,
        event,
        ...payload
      };
      console.log(JSON.stringify(record));
    }
    __name(baseLog, "baseLog");
    function info(event, payload = {}) {
      baseLog("info", event, payload);
    }
    __name(info, "info");
    function warn(event, payload = {}) {
      baseLog("warn", event, payload);
    }
    __name(warn, "warn");
    function error(event, payload = {}) {
      baseLog("error", event, payload);
    }
    __name(error, "error");
    module2.exports = {
      info,
      warn,
      error,
      redact
    };
  }
});

// src/lib/llm/applyflow-llm-service.js
var require_applyflow_llm_service = __commonJS({
  "src/lib/llm/applyflow-llm-service.js"(exports2, module2) {
    var { logActivity } = require_activity_logger();
    var logger2 = require_logger();
    var DEFAULT_PROVIDER = process.env.LLM_PROVIDER || "openai";
    var DEFAULT_BASE_URL = process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    var DEFAULT_MODEL = process.env.LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
    var DEFAULT_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS || 15e3);
    function getLlmConfig() {
      return {
        provider: String(process.env.LLM_PROVIDER || DEFAULT_PROVIDER || "openai").trim().toLowerCase(),
        apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "",
        baseUrl: String(process.env.LLM_BASE_URL || DEFAULT_BASE_URL || "https://api.openai.com/v1").trim(),
        model: String(process.env.LLM_MODEL || DEFAULT_MODEL || "gpt-4o-mini").trim(),
        timeoutMs: Number(process.env.LLM_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS || 15e3)
      };
    }
    __name(getLlmConfig, "getLlmConfig");
    function hasLlmConfig() {
      return Boolean(getLlmConfig().apiKey);
    }
    __name(hasLlmConfig, "hasLlmConfig");
    function clampNumber(value, min, max, fallback) {
      const number = Number(value);
      if (Number.isNaN(number)) return fallback;
      return Math.max(min, Math.min(max, number));
    }
    __name(clampNumber, "clampNumber");
    function normalizeStringArray(value, fallback = []) {
      if (!Array.isArray(value)) return fallback;
      return value.map((item) => String(item || "").trim()).filter(Boolean);
    }
    __name(normalizeStringArray, "normalizeStringArray");
    function extractMessageContent(responseJson) {
      const content = responseJson?.choices?.[0]?.message?.content;
      if (typeof content === "string") {
        return content;
      }
      if (Array.isArray(content)) {
        return content.map((item) => item?.text || item?.content || "").join("").trim();
      }
      return "";
    }
    __name(extractMessageContent, "extractMessageContent");
    function buildChatCompletionsUrl(baseUrl) {
      const normalized = String(baseUrl || "").replace(/\/+$/, "");
      return `${normalized}/chat/completions`;
    }
    __name(buildChatCompletionsUrl, "buildChatCompletionsUrl");
    function isSupportedProvider(provider) {
      return provider === "openai" || provider === "openai-compatible";
    }
    __name(isSupportedProvider, "isSupportedProvider");
    function logLlmTrace({ taskType, provider, model, success, fallbackUsed, latencyMs, errorSummary }) {
      logger2.info("llm.call", {
        taskType,
        provider,
        model,
        success,
        fallbackUsed,
        latencyMs,
        errorSummary: errorSummary || null
      });
      return logActivity({
        type: "llm_trace",
        entityType: "llm_call",
        entityId: `${taskType}:${Date.now()}`,
        action: "llm_trace",
        summary: `${taskType} ${success ? "completed" : "failed"} using ${provider}/${model}${fallbackUsed ? " with fallback" : ""}.`,
        metadata: {
          taskType,
          provider,
          model,
          success,
          fallbackUsed,
          latencyMs,
          errorSummary: errorSummary || null
        },
        agentName: "ApplyFlow LLM Service",
        inputSummary: `Task type: ${taskType}; provider: ${provider}`,
        outputSummary: success ? "Structured response parsed successfully." : "LLM response unavailable; fallback path kept the workflow alive.",
        decisionReason: success ? "The service validated the model output against a stable schema before handing it to the orchestrator." : `The service fell back to heuristic logic because the LLM call was unavailable or invalid${errorSummary ? ` (${errorSummary})` : ""}.`
      });
    }
    __name(logLlmTrace, "logLlmTrace");
    async function callStructuredJson({
      taskType,
      schemaName,
      schema,
      systemPrompt,
      userPrompt,
      normalizer
    }) {
      const startedAt = Date.now();
      const config = getLlmConfig();
      const { provider, apiKey, baseUrl, model, timeoutMs } = config;
      if (!isSupportedProvider(provider)) {
        const result = {
          ok: false,
          fallbackUsed: true,
          provider,
          model,
          latencyMs: Date.now() - startedAt,
          errorSummary: `Unsupported LLM provider: ${provider}.`
        };
        logLlmTrace({ taskType, ...result, success: false });
        return result;
      }
      if (!hasLlmConfig()) {
        const result = {
          ok: false,
          fallbackUsed: true,
          provider,
          model,
          latencyMs: Date.now() - startedAt,
          errorSummary: "LLM_API_KEY is not configured."
        };
        logLlmTrace({ taskType, ...result, success: false });
        return result;
      }
      if (typeof fetch !== "function") {
        const result = {
          ok: false,
          fallbackUsed: true,
          provider,
          model,
          latencyMs: Date.now() - startedAt,
          errorSummary: "Global fetch is not available in this Node runtime."
        };
        logLlmTrace({ taskType, ...result, success: false });
        return result;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(buildChatCompletionsUrl(baseUrl), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            temperature: 0.2,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: schemaName,
                strict: true,
                schema
              }
            }
          })
        });
        const responseJson = await response.json();
        if (!response.ok) {
          throw new Error(responseJson?.error?.message || `LLM request failed with status ${response.status}.`);
        }
        const content = extractMessageContent(responseJson);
        if (!content) {
          throw new Error("LLM response did not contain structured content.");
        }
        const parsed = JSON.parse(content);
        const data = normalizer(parsed);
        const result = {
          ok: true,
          data,
          fallbackUsed: false,
          provider,
          model,
          latencyMs: Date.now() - startedAt,
          errorSummary: null
        };
        logLlmTrace({ taskType, ...result, success: true });
        return result;
      } catch (error) {
        const result = {
          ok: false,
          fallbackUsed: true,
          provider,
          model,
          latencyMs: Date.now() - startedAt,
          errorSummary: error.name === "AbortError" ? "LLM request timed out." : error.message
        };
        logLlmTrace({ taskType, ...result, success: false });
        return result;
      } finally {
        clearTimeout(timeout);
      }
    }
    __name(callStructuredJson, "callStructuredJson");
    async function generateJobIngestion({ payload, fallbackResult }) {
      const schema = {
        type: "object",
        additionalProperties: false,
        properties: {
          company: { type: "string" },
          title: { type: "string" },
          location: { type: "string" },
          summary: { type: "string" },
          responsibilities: { type: "array", items: { type: "string" } },
          requirements: { type: "array", items: { type: "string" } },
          preferredQualifications: { type: "array", items: { type: "string" } },
          riskFlags: { type: "array", items: { type: "string" } }
        },
        required: [
          "company",
          "title",
          "location",
          "summary",
          "responsibilities",
          "requirements",
          "preferredQualifications",
          "riskFlags"
        ]
      };
      const result = await callStructuredJson({
        taskType: "job_ingestion",
        schemaName: "applyflow_job_ingestion",
        schema,
        systemPrompt: "You are a job-ingestion assistant. Extract stable, structured job fields from a job description. Return only factual content that can be safely rendered in a product UI.",
        userPrompt: JSON.stringify({
          manualFields: {
            company: payload.company || "",
            title: payload.title || "",
            location: payload.location || "",
            sourcePlatform: payload.sourcePlatform || payload.sourceLabel || "",
            jobUrl: payload.jobUrl || payload.url || ""
          },
          jdText: payload.rawJdText || payload.jdRaw || ""
        }),
        normalizer(parsed) {
          return {
            company: String(parsed.company || fallbackResult.company || payload.company || "").trim() || "Unknown Company",
            title: String(parsed.title || fallbackResult.title || payload.title || "").trim() || "Untitled Role",
            location: String(parsed.location || fallbackResult.location || payload.location || "").trim() || "Unknown",
            summary: String(parsed.summary || "").trim() || fallbackResult.jdStructured?.summary || "Role details parsed from the provided job description.",
            responsibilities: normalizeStringArray(parsed.responsibilities, fallbackResult.jdStructured?.responsibilities || []).slice(0, 6),
            requirements: normalizeStringArray(parsed.requirements, fallbackResult.jdStructured?.requirements || []).slice(0, 6),
            preferredQualifications: normalizeStringArray(
              parsed.preferredQualifications,
              fallbackResult.jdStructured?.preferredQualifications || []
            ).slice(0, 6),
            riskFlags: normalizeStringArray(parsed.riskFlags, fallbackResult.jdStructured?.riskFlags || []).slice(0, 5)
          };
        }
      });
      return result;
    }
    __name(generateJobIngestion, "generateJobIngestion");
    async function generateFitAssessment({
      job,
      profile,
      strategyProfile,
      globalPolicy,
      fallbackResult
    }) {
      const schema = {
        type: "object",
        additionalProperties: false,
        properties: {
          fitScore: { type: "number" },
          recommendation: { type: "string", enum: ["apply", "cautious", "skip"] },
          whyApply: { type: "array", items: { type: "string" } },
          keyGaps: { type: "array", items: { type: "string" } },
          riskFlags: { type: "array", items: { type: "string" } },
          suggestedAction: { type: "string" },
          strategyDecision: {
            type: "string",
            enum: ["proceed", "cautious_proceed", "deprioritize", "avoid"]
          },
          confidence: { type: "number" },
          decisionSummary: { type: "string" },
          strategyReasoning: { type: "string" },
          historyInfluenceSummary: { type: "string" },
          policyInfluenceSummary: { type: "string" }
        },
        required: [
          "fitScore",
          "recommendation",
          "whyApply",
          "keyGaps",
          "riskFlags",
          "suggestedAction",
          "strategyDecision",
          "confidence",
          "decisionSummary",
          "strategyReasoning",
          "historyInfluenceSummary",
          "policyInfluenceSummary"
        ]
      };
      const result = await callStructuredJson({
        taskType: "fit_evaluation",
        schemaName: "applyflow_fit_evaluation",
        schema,
        systemPrompt: "You are a fit-evaluation assistant for a semi-automatic job search product. Produce a structured assessment that is decisive, concise, and compatible with a stable product schema. Respect the existing policy and history context.",
        userPrompt: JSON.stringify({
          job: {
            company: job.company,
            title: job.title,
            location: job.location,
            summary: job.jdStructured?.summary,
            responsibilities: job.jdStructured?.responsibilities || [],
            requirements: job.jdStructured?.requirements || [],
            preferredQualifications: job.jdStructured?.preferredQualifications || [],
            riskFlags: job.jdStructured?.riskFlags || [],
            keywords: job.jdStructured?.keywords || []
          },
          profile: {
            background: profile.background,
            yearsOfExperience: profile.yearsOfExperience,
            targetRoles: profile.targetRoles || [],
            targetIndustries: profile.targetIndustries || [],
            targetLocations: profile.targetLocations || profile.preferredLocations || [],
            strengths: profile.strengths || [],
            constraints: profile.constraints || []
          },
          history: {
            preferredRoles: strategyProfile?.preferredRoles || [],
            riskyRoles: strategyProfile?.riskyRoles || [],
            successPatterns: strategyProfile?.successPatterns || [],
            failurePatterns: strategyProfile?.failurePatterns || []
          },
          globalPolicy: {
            preferredRoles: globalPolicy?.preferredRoles || [],
            riskyRoles: globalPolicy?.riskyRoles || [],
            focusMode: globalPolicy?.focusMode || "balanced",
            riskTolerance: globalPolicy?.riskTolerance || "medium",
            avoidPatterns: globalPolicy?.avoidPatterns || []
          }
        }),
        normalizer(parsed) {
          const fitScore = clampNumber(parsed.fitScore, 0, 100, fallbackResult.fitScore);
          return {
            fitScore,
            recommendation: parsed.recommendation || fallbackResult.recommendation,
            whyApply: normalizeStringArray(parsed.whyApply, fallbackResult.whyApply || []).slice(0, 4),
            keyGaps: normalizeStringArray(parsed.keyGaps, fallbackResult.keyGaps || []).slice(0, 4),
            riskFlags: normalizeStringArray(parsed.riskFlags, fallbackResult.riskFlags || []).slice(0, 5),
            suggestedAction: String(parsed.suggestedAction || "").trim() || fallbackResult.suggestedAction,
            strategyDecision: parsed.strategyDecision || fallbackResult.strategyDecision,
            confidence: clampNumber(parsed.confidence, 0, 1, fallbackResult.confidence || 0.65),
            decisionSummary: String(parsed.decisionSummary || "").trim() || fallbackResult.decisionSummary,
            strategyReasoning: String(parsed.strategyReasoning || "").trim() || fallbackResult.strategyReasoning,
            historyInfluenceSummary: String(parsed.historyInfluenceSummary || "").trim() || fallbackResult.historyInfluenceSummary,
            policyInfluenceSummary: String(parsed.policyInfluenceSummary || "").trim() || fallbackResult.policyInfluenceSummary
          };
        }
      });
      return result;
    }
    __name(generateFitAssessment, "generateFitAssessment");
    async function generatePrepDraft({ job, profile, fallbackResult }) {
      const schema = {
        type: "object",
        additionalProperties: false,
        properties: {
          targetKeywords: { type: "array", items: { type: "string" } },
          rewriteBullets: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                source: { type: "string" },
                rewritten: { type: "string" }
              },
              required: ["source", "rewritten"]
            }
          },
          selfIntroShort: { type: "string" },
          selfIntroMedium: { type: "string" },
          qaDraft: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                question: { type: "string" },
                draftAnswer: { type: "string" }
              },
              required: ["question", "draftAnswer"]
            }
          },
          coverNote: { type: "string" }
        },
        required: [
          "targetKeywords",
          "rewriteBullets",
          "selfIntroShort",
          "selfIntroMedium",
          "qaDraft",
          "coverNote"
        ]
      };
      const result = await callStructuredJson({
        taskType: "prep_generation",
        schemaName: "applyflow_prep_generation",
        schema,
        systemPrompt: "You are an application-prep assistant. Generate concise but realistic application materials that a user can edit. Keep outputs specific to the job and profile, and return only schema-compliant content.",
        userPrompt: JSON.stringify({
          job: {
            company: job.company,
            title: job.title,
            summary: job.jdStructured?.summary,
            responsibilities: job.jdStructured?.responsibilities || [],
            requirements: job.jdStructured?.requirements || [],
            keywords: job.jdStructured?.keywords || []
          },
          profile: {
            background: profile.background,
            strengths: profile.strengths || [],
            masterResume: profile.masterResume || profile.baseResume || "",
            keyProjects: profile.keyProjects || []
          }
        }),
        normalizer(parsed) {
          const fallbackBullets = fallbackResult.resumeTailoring?.rewriteBullets || [];
          const fallbackQa = fallbackResult.qaDraft || [];
          return {
            targetKeywords: normalizeStringArray(
              parsed.targetKeywords,
              fallbackResult.resumeTailoring?.targetKeywords || []
            ).slice(0, 6),
            rewriteBullets: Array.isArray(parsed.rewriteBullets) && parsed.rewriteBullets.length ? parsed.rewriteBullets.map((item, index) => ({
              source: String(item?.source || fallbackBullets[index]?.source || `Bullet ${index + 1}`).trim(),
              rewritten: String(item?.rewritten || "").trim()
            })).filter((item) => item.rewritten).slice(0, 4) : fallbackBullets,
            selfIntroShort: String(parsed.selfIntroShort || "").trim() || fallbackResult.selfIntro?.short || "",
            selfIntroMedium: String(parsed.selfIntroMedium || "").trim() || fallbackResult.selfIntro?.medium || "",
            qaDraft: Array.isArray(parsed.qaDraft) && parsed.qaDraft.length ? parsed.qaDraft.map((item, index) => ({
              question: String(item?.question || fallbackQa[index]?.question || `Question ${index + 1}`).trim(),
              draftAnswer: String(item?.draftAnswer || "").trim()
            })).filter((item) => item.question && item.draftAnswer).slice(0, 4) : fallbackQa,
            coverNote: String(parsed.coverNote || "").trim() || fallbackResult.coverNote || ""
          };
        }
      });
      return result;
    }
    __name(generatePrepDraft, "generatePrepDraft");
    module2.exports = {
      getLlmConfig,
      hasLlmConfig,
      generateJobIngestion,
      generateFitAssessment,
      generatePrepDraft
    };
  }
});

// src/lib/orchestrator/agents/job-ingestion-agent.js
var require_job_ingestion_agent = __commonJS({
  "src/lib/orchestrator/agents/job-ingestion-agent.js"(exports2, module2) {
    var { createId, nowIso: nowIso2 } = require_id();
    var { generateJobIngestion, getLlmConfig } = require_applyflow_llm_service();
    function splitLines(text) {
      return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    }
    __name(splitLines, "splitLines");
    function stripListMarker(line) {
      return String(line || "").replace(/^[-•*]\s*/, "").replace(/^\d+\.\s*/, "").trim();
    }
    __name(stripListMarker, "stripListMarker");
    function pickFirstMatch(text, patterns) {
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) {
          return match[1].trim();
        }
      }
      return "";
    }
    __name(pickFirstMatch, "pickFirstMatch");
    function extractTitle(lines, fallback) {
      const joined = lines.join("\n");
      return pickFirstMatch(joined, [
        /title[:：]\s*(.+)/i,
        /role[:：]\s*(.+)/i,
        /position[:：]\s*(.+)/i
      ]) || lines.find((line) => /product manager|strategy|analyst|operations|growth|manager/i.test(line)) || fallback || "Untitled Role";
    }
    __name(extractTitle, "extractTitle");
    function extractCompany(lines, fallback) {
      const joined = lines.join("\n");
      return pickFirstMatch(joined, [
        /company[:：]\s*(.+)/i,
        /organization[:：]\s*(.+)/i,
        /employer[:：]\s*(.+)/i
      ]) || fallback || "Unknown Company";
    }
    __name(extractCompany, "extractCompany");
    function extractLocation(lines, fallback) {
      const joined = lines.join("\n");
      return pickFirstMatch(joined, [
        /location[:：]\s*(.+)/i,
        /based in[:：]?\s*(.+)/i,
        /city[:：]\s*(.+)/i
      ]) || lines.find((line) => /shanghai|beijing|shenzhen|hangzhou|remote|hybrid/i.test(line)) || fallback || "Unknown";
    }
    __name(extractLocation, "extractLocation");
    function collectListFromSections(lines, patterns, fallbackCount = 3) {
      const lowered = lines.map((line) => line.toLowerCase());
      const sectionIndex = lowered.findIndex((line) => patterns.some((pattern) => line.includes(pattern)));
      if (sectionIndex >= 0) {
        const collected = [];
        for (let index = sectionIndex + 1; index < lines.length; index += 1) {
          const line = lines[index];
          if (/^[A-Za-z\s]+[:：]$/.test(line) || /responsibilities|requirements|preferred|qualifications/i.test(line)) {
            if (collected.length > 0) {
              break;
            }
          }
          if (/^[-•*]/.test(line) || /^\d+\./.test(line)) {
            collected.push(stripListMarker(line));
          } else if (collected.length > 0) {
            break;
          }
        }
        if (collected.length > 0) {
          return collected;
        }
      }
      return lines.filter((line) => /^[-•*]/.test(line) || /^\d+\./.test(line)).slice(0, fallbackCount).map((line) => stripListMarker(line));
    }
    __name(collectListFromSections, "collectListFromSections");
    function extractKeywords(jdRaw) {
      const keywords = String(jdRaw || "").toLowerCase().match(/[a-z][a-z+/.-]{2,}/g);
      return [...new Set((keywords || []).filter((word) => !["with", "and", "the", "for", "you", "are"].includes(word)))].slice(0, 12);
    }
    __name(extractKeywords, "extractKeywords");
    function detectRiskFlags(jdRaw, title, location) {
      const text = `${title} ${location} ${jdRaw}`.toLowerCase();
      const flags = [];
      if (text.includes("director") || text.includes("head of")) {
        flags.push("Role may be senior relative to many pivoting candidates.");
      }
      if (text.includes("onsite") || text.includes("relocation")) {
        flags.push("Location or work mode may reduce flexibility.");
      }
      if (text.includes("advertising") || text.includes("ad tech")) {
        flags.push("Domain specialization may be narrow.");
      }
      if (String(jdRaw || "").length < 120) {
        flags.push("JD detail is limited, so parsing confidence is lower.");
      }
      return flags;
    }
    __name(detectRiskFlags, "detectRiskFlags");
    function runRuleBasedJobIngestionAgent(payload) {
      const jdRaw = payload.rawJdText || payload.jdRaw || "";
      const lines = splitLines(jdRaw);
      const title = extractTitle(lines, payload.title);
      const company = extractCompany(lines, payload.company);
      const location = extractLocation(lines, payload.location);
      const responsibilities = collectListFromSections(lines, ["responsibilities", "what you will do", "you will"]);
      const requirements = collectListFromSections(lines, ["requirements", "must have", "what we're looking for"]);
      const preferredQualifications = collectListFromSections(lines, ["preferred", "nice to have", "bonus"], 0);
      const keywords = extractKeywords(`${title} ${company} ${jdRaw}`);
      const riskFlags = detectRiskFlags(jdRaw, title, location);
      const summaryParts = [
        title,
        company !== "Unknown Company" ? `at ${company}` : "",
        responsibilities[0] || requirements[0] || "role details parsed from JD"
      ].filter(Boolean);
      return {
        id: createId("job"),
        source: payload.source || "manual",
        sourceLabel: payload.sourcePlatform || payload.sourceLabel || "Manual",
        url: payload.jobUrl || payload.url,
        company,
        title,
        location,
        jdRaw,
        jdStructured: {
          summary: `${summaryParts.join(" - ")}.`,
          responsibilities: responsibilities.length > 0 ? responsibilities : ["Responsibilities were not clearly listed; manual review recommended."],
          requirements: requirements.length > 0 ? requirements : ["Core requirements were not clearly listed; manual review recommended."],
          preferredQualifications,
          keywords,
          riskFlags
        },
        status: "evaluating",
        priority: "medium",
        createdAt: nowIso2(),
        updatedAt: nowIso2()
      };
    }
    __name(runRuleBasedJobIngestionAgent, "runRuleBasedJobIngestionAgent");
    async function runJobIngestionAgent(payload) {
      const fallbackResult = runRuleBasedJobIngestionAgent(payload);
      const llmResult = await generateJobIngestion({ payload, fallbackResult });
      const llmProvider = getLlmConfig().provider;
      if (!llmResult.ok) {
        return {
          ...fallbackResult,
          llmMeta: {
            provider: "heuristic_fallback",
            model: llmResult.model,
            fallbackUsed: true,
            errorSummary: llmResult.errorSummary || null,
            latencyMs: llmResult.latencyMs || null
          }
        };
      }
      return {
        ...fallbackResult,
        company: payload.company || llmResult.data.company || fallbackResult.company,
        title: payload.title || llmResult.data.title || fallbackResult.title,
        location: payload.location || llmResult.data.location || fallbackResult.location,
        jdStructured: {
          ...fallbackResult.jdStructured,
          summary: llmResult.data.summary || fallbackResult.jdStructured.summary,
          responsibilities: llmResult.data.responsibilities.length > 0 ? llmResult.data.responsibilities : fallbackResult.jdStructured.responsibilities,
          requirements: llmResult.data.requirements.length > 0 ? llmResult.data.requirements : fallbackResult.jdStructured.requirements,
          preferredQualifications: llmResult.data.preferredQualifications.length > 0 ? llmResult.data.preferredQualifications : fallbackResult.jdStructured.preferredQualifications,
          riskFlags: llmResult.data.riskFlags.length > 0 ? llmResult.data.riskFlags : fallbackResult.jdStructured.riskFlags
        },
        llmMeta: {
          provider: llmProvider,
          model: llmResult.model,
          fallbackUsed: false,
          latencyMs: llmResult.latencyMs || null,
          errorSummary: null
        }
      };
    }
    __name(runJobIngestionAgent, "runJobIngestionAgent");
    module2.exports = { runJobIngestionAgent, runRuleBasedJobIngestionAgent };
  }
});

// src/lib/orchestrator/agents/fit-evaluation-agent.js
var require_fit_evaluation_agent = __commonJS({
  "src/lib/orchestrator/agents/fit-evaluation-agent.js"(exports2, module2) {
    var { createId, nowIso: nowIso2 } = require_id();
    var store = require_store();
    var { generateFitAssessment, getLlmConfig } = require_applyflow_llm_service();
    function hasAnyKeyword(text, values) {
      return (values || []).some((value) => text.includes(String(value).toLowerCase()));
    }
    __name(hasAnyKeyword, "hasAnyKeyword");
    function deriveRecommendation(score) {
      if (score >= 72) return "apply";
      if (score >= 50) return "cautious";
      return "skip";
    }
    __name(deriveRecommendation, "deriveRecommendation");
    function deriveStrategyDecision({
      score,
      recommendation,
      matchingBadCase,
      roleBias,
      industryBias,
      riskFlags,
      globalPolicy
    }) {
      const negativeBias = Number(roleBias || 0) + Number(industryBias || 0);
      const heavyRisk = riskFlags.length >= 4;
      const lowTolerance = globalPolicy?.riskTolerance === "low";
      const focusedMode = globalPolicy?.focusMode === "focused";
      if (recommendation === "skip" || matchingBadCase || score < 40) {
        return "avoid";
      }
      if (negativeBias <= -5 || heavyRisk || score < 55 || lowTolerance && riskFlags.length >= 3) {
        return "deprioritize";
      }
      if (recommendation === "cautious" || riskFlags.length >= 4 || score < 74 || focusedMode && riskFlags.length >= 3) {
        return "cautious_proceed";
      }
      return "proceed";
    }
    __name(deriveStrategyDecision, "deriveStrategyDecision");
    function runRuleBasedFitEvaluationAgent({ job, profile, strategyProfile, globalPolicy }) {
      const jobText = `${job.title} ${job.company} ${job.location} ${job.jdRaw} ${(job.jdStructured?.keywords || []).join(" ")}`.toLowerCase();
      const roleTargets = profile.targetRoles || [];
      const industryTargets = profile.targetIndustries || [];
      const locationTargets = profile.targetLocations || profile.preferredLocations || [];
      const strengths = profile.strengths || [];
      const constraints = profile.constraints || [];
      const roleBiases = strategyProfile?.scoreBias?.roleBiases || {};
      const industryBiases = strategyProfile?.scoreBias?.industryBiases || {};
      const targetRolesPriority = globalPolicy?.targetRolesPriority || [];
      const preferredIndustries = globalPolicy?.preferredIndustries || [];
      const avoidPatterns = globalPolicy?.avoidPatterns || [];
      let baseScore = 40;
      let historyAdjustment = 0;
      let policyAdjustment = 0;
      const whyApply = [];
      const keyGaps = [];
      const riskFlags = [...job.jdStructured?.riskFlags || []];
      const historyReasons = [];
      const policyReasons = [];
      const matchingBadCase = store.listBadCases().find((badCase) => {
        const corpus = `${badCase.company} ${badCase.title} ${badCase.rawJd || ""}`.toLowerCase();
        return corpus.includes(job.company.toLowerCase()) || corpus.includes(job.title.toLowerCase()) || (job.jdStructured?.keywords || []).some((keyword) => corpus.includes(String(keyword).toLowerCase()));
      });
      if (hasAnyKeyword(jobText, roleTargets)) {
        baseScore += 18;
        whyApply.push("Job title and JD language overlap with target roles.");
      }
      if (/product|pm|roadmap|workflow|agent|ai/.test(jobText)) {
        baseScore += 15;
        whyApply.push("Role includes product or AI-workflow signals aligned with current direction.");
      }
      if (hasAnyKeyword(jobText, industryTargets)) {
        baseScore += 10;
        whyApply.push("Industry context overlaps with preferred target industries.");
      }
      if (hasAnyKeyword(jobText, targetRolesPriority)) {
        policyAdjustment += 6;
        whyApply.push("Global policy is actively prioritizing this role family.");
        policyReasons.push("Boosted because this role family is part of the current global focus.");
      }
      if (hasAnyKeyword(jobText, preferredIndustries)) {
        policyAdjustment += 5;
        whyApply.push("Industry matches the current global policy focus.");
        policyReasons.push("Boosted because similar industries are outperforming in the current pipeline.");
      }
      if (hasAnyKeyword(jobText, locationTargets)) {
        baseScore += 8;
        whyApply.push("Location is within preferred target geography.");
      } else if (locationTargets.length > 0) {
        riskFlags.push("Location is outside the current preferred target list.");
      }
      if (/director|head of|vp/.test(jobText)) {
        baseScore -= 18;
        keyGaps.push("Seniority may be higher than current target positioning.");
      }
      if (/advertising|ad tech|media sales/.test(jobText)) {
        baseScore -= 14;
        keyGaps.push("Domain specialization appears far from current AI PM target path.");
      }
      if (/10\+ years|8\+ years|12\+ years/.test(jobText) && Number(profile.yearsOfExperience || 0) < 8) {
        baseScore -= 12;
        keyGaps.push("Required experience years may exceed current profile.");
      }
      if (strengths.length > 0 && /strategy|stakeholder|execution|cross-functional/.test(jobText)) {
        baseScore += 8;
        whyApply.push("Role values strengths already present in the profile.");
      }
      if (hasAnyKeyword(jobText, constraints)) {
        baseScore -= 20;
        riskFlags.push("Job text overlaps with stated profile constraints.");
      }
      if (hasAnyKeyword(jobText, avoidPatterns)) {
        policyAdjustment -= 10;
        riskFlags.push("Global policy marks this pattern as a pipeline distraction.");
        policyReasons.push("Downranked because the global policy has learned this pattern is usually low leverage.");
      }
      const roleBiasEntry = Object.entries(roleBiases).find(([key]) => jobText.includes(String(key).toLowerCase()));
      const roleBiasValue = roleBiasEntry ? Number(roleBiasEntry[1] || 0) : 0;
      if (roleBiasEntry) {
        historyAdjustment += roleBiasValue;
        if (roleBiasValue !== 0) {
          riskFlags.push(
            roleBiasValue > 0 ? `Historical performance raises confidence for ${roleBiasEntry[0]} roles.` : `Historical performance lowers confidence for ${roleBiasEntry[0]} roles.`
          );
          historyReasons.push(
            roleBiasValue > 0 ? `Boosted due to previous success in ${roleBiasEntry[0]} roles.` : `Reduced because similar ${roleBiasEntry[0]} roles had weak conversion.`
          );
        }
      }
      const industryBiasEntry = Object.entries(industryBiases).find(
        ([key]) => jobText.includes(String(key).toLowerCase())
      );
      const industryBiasValue = industryBiasEntry ? Number(industryBiasEntry[1] || 0) : 0;
      if (industryBiasEntry) {
        historyAdjustment += industryBiasValue;
        if (industryBiasValue !== 0) {
          riskFlags.push(
            industryBiasValue > 0 ? `Past outcomes suggest stronger traction in ${industryBiasEntry[0]} contexts.` : `Past outcomes suggest weaker traction in ${industryBiasEntry[0]} contexts.`
          );
          historyReasons.push(
            industryBiasValue > 0 ? `History is favorable for ${industryBiasEntry[0]} industry roles.` : `History is unfavorable for ${industryBiasEntry[0]} industry roles.`
          );
        }
      }
      if (matchingBadCase) {
        historyAdjustment -= 8;
        riskFlags.push(`Similar to a previous bad case: ${matchingBadCase.company} / ${matchingBadCase.title}.`);
        keyGaps.push("Review prior bad case feedback before investing further effort.");
        historyReasons.push("Lowered because similar jobs previously became bad cases.");
      }
      let score = baseScore + historyAdjustment + policyAdjustment;
      score = Math.max(0, Math.min(score, 95));
      const recommendation = deriveRecommendation(score);
      const strategyDecision = deriveStrategyDecision({
        score,
        recommendation,
        matchingBadCase,
        roleBias: roleBiasValue,
        industryBias: industryBiasValue,
        riskFlags,
        globalPolicy
      });
      const confidence = Math.min(
        0.95,
        0.55 + Math.min((job.jdStructured?.keywords?.length || 0) * 0.02, 0.2)
      );
      return {
        id: createId("fit"),
        jobId: job.id,
        profileId: profile.id,
        fitScore: score,
        recommendation,
        strategyDecision,
        strategyReasoning: strategyDecision === "proceed" ? "This role matches current success patterns closely enough to justify active pursuit." : strategyDecision === "cautious_proceed" ? "This role can move forward, but only with deliberate risk management during prep." : strategyDecision === "deprioritize" ? "This role is not a strong enough strategic bet to enter the active prep queue by default." : "This role conflicts with historical feedback or current global policy enough to avoid active pursuit.",
        historyInfluenceSummary: historyReasons[0] || "History did not materially shift this role beyond the current profile-to-job fit.",
        policyInfluenceSummary: policyReasons[0] || "Global policy did not materially override the default fit judgement for this role.",
        decisionBreakdown: {
          baseScore,
          historyAdjustment,
          policyAdjustment,
          finalScore: score,
          finalDecision: strategyDecision
        },
        confidence,
        decisionSummary: recommendation === "apply" ? "Role aligns well with target direction and is worth preparing for." : recommendation === "cautious" ? "Role is viable but may need tighter prioritization and narrative control." : "Role appears misaligned enough that it is better treated as a skip.",
        whyApply: whyApply.slice(0, 4),
        keyGaps: keyGaps.length > 0 ? keyGaps.slice(0, 4) : recommendation === "apply" ? ["Need tighter examples that show direct product and technical collaboration."] : ["Role fit is not strong enough to justify high effort."],
        riskFlags: [...new Set(
          riskFlags.length > 0 ? riskFlags : recommendation === "cautious" ? ["Proceed only if weekly pipeline needs more volume."] : ["Expected conversion probability is low."]
        )].slice(0, 5),
        suggestedAction: recommendation === "apply" ? "Proceed to application prep and tailor materials for this role." : recommendation === "cautious" ? "Keep as a secondary priority and only prepare if pipeline needs more volume." : "Do not invest more effort now; archive and focus on better-fit jobs.",
        editable: true,
        createdAt: nowIso2(),
        updatedAt: nowIso2()
      };
    }
    __name(runRuleBasedFitEvaluationAgent, "runRuleBasedFitEvaluationAgent");
    async function runFitEvaluationAgent({ job, profile, strategyProfile, globalPolicy }) {
      const fallbackResult = runRuleBasedFitEvaluationAgent({ job, profile, strategyProfile, globalPolicy });
      const llmResult = await generateFitAssessment({
        job,
        profile,
        strategyProfile,
        globalPolicy,
        fallbackResult
      });
      const llmProvider = getLlmConfig().provider;
      if (!llmResult.ok) {
        return {
          ...fallbackResult,
          llmMeta: {
            provider: "heuristic_fallback",
            model: llmResult.model,
            fallbackUsed: true,
            errorSummary: llmResult.errorSummary || null,
            latencyMs: llmResult.latencyMs || null
          }
        };
      }
      return {
        ...fallbackResult,
        fitScore: llmResult.data.fitScore,
        recommendation: llmResult.data.recommendation,
        strategyDecision: llmResult.data.strategyDecision,
        strategyReasoning: llmResult.data.strategyReasoning,
        historyInfluenceSummary: llmResult.data.historyInfluenceSummary,
        policyInfluenceSummary: llmResult.data.policyInfluenceSummary,
        confidence: llmResult.data.confidence,
        decisionSummary: llmResult.data.decisionSummary,
        whyApply: llmResult.data.whyApply.length > 0 ? llmResult.data.whyApply : fallbackResult.whyApply,
        keyGaps: llmResult.data.keyGaps.length > 0 ? llmResult.data.keyGaps : fallbackResult.keyGaps,
        riskFlags: llmResult.data.riskFlags.length > 0 ? llmResult.data.riskFlags : fallbackResult.riskFlags,
        suggestedAction: llmResult.data.suggestedAction || fallbackResult.suggestedAction,
        decisionBreakdown: {
          ...fallbackResult.decisionBreakdown,
          finalScore: llmResult.data.fitScore,
          finalDecision: llmResult.data.strategyDecision
        },
        llmMeta: {
          provider: llmProvider,
          model: llmResult.model,
          fallbackUsed: false,
          latencyMs: llmResult.latencyMs || null,
          errorSummary: null
        }
      };
    }
    __name(runFitEvaluationAgent, "runFitEvaluationAgent");
    module2.exports = { runFitEvaluationAgent, runRuleBasedFitEvaluationAgent };
  }
});

// src/lib/orchestrator/agents/application-prep-agent.js
var require_application_prep_agent = __commonJS({
  "src/lib/orchestrator/agents/application-prep-agent.js"(exports2, module2) {
    var { createId, nowIso: nowIso2 } = require_id();
    var { generatePrepDraft, getLlmConfig } = require_applyflow_llm_service();
    function runRuleBasedApplicationPrepAgent({ job, profile }) {
      const firstProject = profile.keyProjects?.[0];
      const secondProject = profile.keyProjects?.[1];
      return {
        id: createId("prep"),
        jobId: job.id,
        profileId: profile.id,
        version: 1,
        resumeTailoring: {
          targetKeywords: job.jdStructured?.keywords?.slice(0, 5) || [],
          rewriteBullets: [
            {
              source: firstProject?.bullets?.[0] || "Add a relevant experience bullet.",
              rewritten: `Position this experience as evidence for ${job.title} through structured problem solving and cross-functional delivery.`
            },
            {
              source: secondProject?.bullets?.[0] || "Add another relevant experience bullet.",
              rewritten: `Emphasize measurable outcomes, prioritization judgment, and why this maps well to ${job.company}.`
            }
          ]
        },
        selfIntro: {
          short: `I bring a mix of strategy, operations, and product execution, and I'm especially motivated by roles like ${job.title} that require turning ambiguity into concrete decisions.`,
          medium: `My background combines business strategy and execution with growing hands-on work in AI-enabled workflows. What stands out about ${job.company} is the opportunity to apply structured product thinking to real execution problems.`
        },
        qaDraft: [
          {
            question: "Why this role?",
            draftAnswer: `It sits at the intersection of my core strengths and the direction I want to build in next: ${job.title}.`
          },
          {
            question: "Why are you a fit?",
            draftAnswer: "I am strongest when I need to frame ambiguous problems, align stakeholders, and convert insights into execution plans."
          }
        ],
        coverNote: `Interested in ${job.company} because the role combines execution, strategy, and a clear opportunity to contribute with high ownership.`,
        checklist: [
          { key: "resume_reviewed", label: "Resume bullets reviewed", completed: true },
          { key: "intro_ready", label: "Self intro prepared", completed: true },
          { key: "qa_ready", label: "Q&A draft prepared", completed: true },
          { key: "submit_ready", label: "Submission path confirmed", completed: false }
        ],
        createdAt: nowIso2(),
        updatedAt: nowIso2()
      };
    }
    __name(runRuleBasedApplicationPrepAgent, "runRuleBasedApplicationPrepAgent");
    async function runApplicationPrepAgent({ job, profile }) {
      const fallbackResult = runRuleBasedApplicationPrepAgent({ job, profile });
      const llmResult = await generatePrepDraft({ job, profile, fallbackResult });
      const llmProvider = getLlmConfig().provider;
      if (!llmResult.ok) {
        return {
          ...fallbackResult,
          llmMeta: {
            provider: "heuristic_fallback",
            model: llmResult.model,
            fallbackUsed: true,
            errorSummary: llmResult.errorSummary || null,
            latencyMs: llmResult.latencyMs || null
          }
        };
      }
      return {
        ...fallbackResult,
        resumeTailoring: {
          ...fallbackResult.resumeTailoring,
          targetKeywords: llmResult.data.targetKeywords.length > 0 ? llmResult.data.targetKeywords : fallbackResult.resumeTailoring.targetKeywords,
          rewriteBullets: llmResult.data.rewriteBullets.length > 0 ? llmResult.data.rewriteBullets : fallbackResult.resumeTailoring.rewriteBullets
        },
        selfIntro: {
          short: llmResult.data.selfIntroShort || fallbackResult.selfIntro.short,
          medium: llmResult.data.selfIntroMedium || fallbackResult.selfIntro.medium
        },
        qaDraft: llmResult.data.qaDraft.length > 0 ? llmResult.data.qaDraft : fallbackResult.qaDraft,
        coverNote: llmResult.data.coverNote || fallbackResult.coverNote,
        llmMeta: {
          provider: llmProvider,
          model: llmResult.model,
          fallbackUsed: false,
          latencyMs: llmResult.latencyMs || null,
          errorSummary: null
        }
      };
    }
    __name(runApplicationPrepAgent, "runApplicationPrepAgent");
    module2.exports = { runApplicationPrepAgent, runRuleBasedApplicationPrepAgent };
  }
});

// src/lib/orchestrator/agents/pipeline-manager-agent.js
var require_pipeline_manager_agent = __commonJS({
  "src/lib/orchestrator/agents/pipeline-manager-agent.js"(exports2, module2) {
    var { createId, nowIso: nowIso2 } = require_id();
    function runPipelineManagerAgent({ job, nextStatus, strategyDecision, fitAssessment, globalPolicy }) {
      if (strategyDecision === "deprioritize" || globalPolicy?.focusMode === "focused" && job.priority === "low") {
        return null;
      }
      const dueSoon = globalPolicy?.focusMode === "focused";
      const cautiousNote = strategyDecision === "cautious_proceed" ? `Proceed carefully. Focus first on these risks: ${(fitAssessment?.riskFlags || []).slice(0, 2).join(" / ") || "review role-specific risks."}` : null;
      const mapping = {
        to_prepare: {
          title: strategyDecision === "cautious_proceed" ? `Prep cautiously for ${job.company}` : `Start prep for ${job.company}`,
          type: "review_fit_assessment",
          note: cautiousNote || "High-priority role. Move into prep while momentum is fresh."
        },
        ready_to_apply: {
          title: `Confirm final materials for ${job.company}`,
          type: "submit_application",
          note: strategyDecision === "cautious_proceed" ? "Final user confirmation required. Recheck strategic risks before submission." : "Final user confirmation required before marking as applied."
        },
        applied: {
          title: `Track follow-up timing for ${job.company}`,
          type: "send_follow_up",
          note: "Check response channel in 5-7 business days."
        },
        follow_up: {
          title: `Review response and prepare interview stories for ${job.company}`,
          type: "log_interview",
          note: "Use follow-up period to tighten interview narrative."
        }
      };
      const taskConfig = mapping[nextStatus];
      if (!taskConfig) {
        return null;
      }
      return {
        id: createId("task"),
        jobId: job.id,
        type: taskConfig.type,
        title: taskConfig.title,
        status: "todo",
        dueAt: dueSoon ? nowIso2() : new Date(Date.now() + 24 * 60 * 60 * 1e3).toISOString(),
        note: taskConfig.note,
        createdAt: nowIso2(),
        updatedAt: nowIso2()
      };
    }
    __name(runPipelineManagerAgent, "runPipelineManagerAgent");
    module2.exports = { runPipelineManagerAgent };
  }
});

// src/lib/orchestrator/agents/interview-reflection-agent.js
var require_interview_reflection_agent = __commonJS({
  "src/lib/orchestrator/agents/interview-reflection-agent.js"(exports2, module2) {
    var { createId, nowIso: nowIso2 } = require_id();
    function runInterviewReflectionAgent({ payload, profile }) {
      const questionsAsked = payload.questionsAsked || [];
      const notes = payload.notes || "";
      const lowerNotes = String(notes || "").toLowerCase();
      const failureReasons = [];
      const successSignals = ["Structured communication landed well."];
      const skillGaps = [];
      if (/technical|engineering|system/.test(lowerNotes)) {
        failureReasons.push("Technical depth was not concrete enough.");
        skillGaps.push("Technical collaboration storytelling");
      }
      if (/product sense|prioritization|roadmap/.test(lowerNotes)) {
        failureReasons.push("Product judgement examples need tighter evidence.");
        skillGaps.push("Prioritization narrative");
      }
      if (/strategy|structure|communication/.test(lowerNotes)) {
        successSignals.push("Structured strategy framing remains a strong signal.");
      }
      if (failureReasons.length === 0 && notes) {
        failureReasons.push(notes);
      }
      if (skillGaps.length === 0) {
        skillGaps.push("Technical collaboration storytelling");
      }
      return {
        id: createId("reflection"),
        jobId: payload.jobId,
        profileId: profile.id,
        roundName: payload.roundName || "Interview Round",
        interviewerType: payload.interviewerType || "Interviewer",
        interviewDate: payload.interviewDate || nowIso2(),
        questionsAsked,
        answerHighlights: [
          "Demonstrated clear structure in responses.",
          "Connected prior experience to target role direction."
        ],
        failureReasons,
        successSignals,
        skillGaps,
        weakSpots: notes ? [notes] : ["Technical collaboration examples still need more specificity."],
        strengthsObserved: ["Clear communication", "Strong business framing"],
        improvementActions: [
          "Prepare one tighter engineering collaboration story.",
          "Add more concrete user problem discovery details."
        ],
        strategyFeedback: [
          "Continue prioritizing AI-native product and strategy roles.",
          "Sharpen technical narrative before deeper panels."
        ],
        summary: "Overall a constructive interview signal with clear strengths in structured thinking and room to improve technical detail.",
        createdAt: nowIso2(),
        updatedAt: nowIso2()
      };
    }
    __name(runInterviewReflectionAgent, "runInterviewReflectionAgent");
    module2.exports = { runInterviewReflectionAgent };
  }
});

// src/lib/orchestrator/agent-registry.js
var require_agent_registry = __commonJS({
  "src/lib/orchestrator/agent-registry.js"(exports2, module2) {
    var { runJobIngestionAgent } = require_job_ingestion_agent();
    var { runFitEvaluationAgent } = require_fit_evaluation_agent();
    var { runApplicationPrepAgent } = require_application_prep_agent();
    var { runPipelineManagerAgent } = require_pipeline_manager_agent();
    var { runInterviewReflectionAgent } = require_interview_reflection_agent();
    var agentRegistry = {
      jobIngestion: runJobIngestionAgent,
      fitEvaluation: runFitEvaluationAgent,
      applicationPrep: runApplicationPrepAgent,
      pipelineManager: runPipelineManagerAgent,
      interviewReflection: runInterviewReflectionAgent
    };
    module2.exports = { agentRegistry };
  }
});

// src/lib/orchestrator/workflow-controller.js
var require_workflow_controller = __commonJS({
  "src/lib/orchestrator/workflow-controller.js"(exports2, module2) {
    var store = require_store();
    var { createId, nowIso: nowIso2 } = require_id();
    var {
      assertJobStatusTransition,
      getAllowedNextStatuses,
      getRecommendedNextStatuses
    } = (init_job_status(), __toCommonJS(job_status_exports));
    var { updateJob } = require_shared_state_helpers();
    var { logActivity } = require_activity_logger();
    var { agentRegistry } = require_agent_registry();
    function summarizeList(items = [], fallback = "none") {
      return items.length ? items.join(" / ") : fallback;
    }
    __name(summarizeList, "summarizeList");
    function deriveRoleBucket(job) {
      const text = `${job.title} ${job.jdRaw || ""}`.toLowerCase();
      if (/ai product manager|product manager|pm/.test(text)) return "AI Product Manager";
      if (/strategy/.test(text)) return "Product Strategy";
      if (/operations|ops/.test(text)) return "Operations";
      if (/growth/.test(text)) return "Growth";
      return "Other";
    }
    __name(deriveRoleBucket, "deriveRoleBucket");
    function deriveIndustryBucket(job) {
      const text = `${job.company} ${job.title} ${job.jdRaw || ""}`.toLowerCase();
      if (/ai|agent|llm/.test(text)) return "AI";
      if (/enterprise|saas|software/.test(text)) return "Enterprise Software";
      if (/commerce|marketplace|consumer/.test(text)) return "Consumer";
      if (/advertising|media|ad tech/.test(text)) return "Advertising";
      if (/strategy/.test(text)) return "Strategy";
      return "General";
    }
    __name(deriveIndustryBucket, "deriveIndustryBucket");
    function buildBiasMap(seed = {}) {
      return { ...seed };
    }
    __name(buildBiasMap, "buildBiasMap");
    function adjustBias(target, key, delta) {
      if (!key) return;
      target[key] = Math.max(-12, Math.min(12, Number(target[key] || 0) + delta));
    }
    __name(adjustBias, "adjustBias");
    function priorityWeight(priority) {
      return { high: 3, medium: 2, low: 1 }[priority] || 0;
    }
    __name(priorityWeight, "priorityWeight");
    function unique(items = []) {
      return [...new Set(items.filter(Boolean))];
    }
    __name(unique, "unique");
    function listChangedPolicyFields(previous = {}, next = {}) {
      const keys = [
        "preferredRoles",
        "riskyRoles",
        "preferredIndustries",
        "riskyIndustries",
        "preferredLocations",
        "riskyLocations",
        "successPatterns",
        "failurePatterns",
        "focusMode",
        "riskTolerance"
      ];
      return keys.filter((key) => JSON.stringify(previous[key] || null) !== JSON.stringify(next[key] || null));
    }
    __name(listChangedPolicyFields, "listChangedPolicyFields");
    function createPolicyVersion(policy = {}) {
      return `${policy.id || "policy"}@${policy.version || 0}`;
    }
    __name(createPolicyVersion, "createPolicyVersion");
    function diffList(oldItems = [], newItems = []) {
      const oldSet = new Set(oldItems || []);
      const newSet = new Set(newItems || []);
      return {
        added: [...newSet].filter((item) => !oldSet.has(item)),
        removed: [...oldSet].filter((item) => !newSet.has(item))
      };
    }
    __name(diffList, "diffList");
    function buildPolicyDiff(previous = {}, next = {}) {
      const listFields = [
        "preferredRoles",
        "riskyRoles",
        "preferredIndustries",
        "riskyIndustries",
        "preferredLocations",
        "riskyLocations",
        "successPatterns",
        "failurePatterns"
      ];
      const lines = [];
      listFields.forEach((field) => {
        const diff = diffList(previous[field] || [], next[field] || []);
        diff.added.forEach((item) => lines.push(`Added ${item} to ${field}.`));
        diff.removed.forEach((item) => lines.push(`Removed ${item} from ${field}.`));
      });
      if ((previous.focusMode || "") !== (next.focusMode || "")) {
        lines.push(`Changed focus mode from ${previous.focusMode || "unset"} to ${next.focusMode}.`);
      }
      if ((previous.riskTolerance || "") !== (next.riskTolerance || "")) {
        lines.push(
          `Changed risk tolerance from ${previous.riskTolerance || "unset"} to ${next.riskTolerance}.`
        );
      }
      return lines;
    }
    __name(buildPolicyDiff, "buildPolicyDiff");
    function inferProposalReason(triggerType, diffSummary) {
      if (diffSummary.length > 0) return diffSummary.slice(0, 2).join(" ");
      if (triggerType === "interview_reflection") {
        return "Policy adjusted after new interview feedback updated the success and failure patterns.";
      }
      if (triggerType === "bad_case") {
        return "Policy adjusted after a new bad case changed the risk picture.";
      }
      if (triggerType === "profile_update") {
        return "Policy adjusted because the user changed profile-level strategy controls.";
      }
      return "Policy adjusted after a new system-level strategy refresh.";
    }
    __name(inferProposalReason, "inferProposalReason");
    function logPolicyAudit({ eventType, actor = "system", relatedProposalId = null, summary }) {
      return store.savePolicyAuditLog({
        id: createId("audit"),
        timestamp: nowIso2(),
        eventType,
        actor,
        relatedProposalId,
        summary
      });
    }
    __name(logPolicyAudit, "logPolicyAudit");
    function getLatestPendingMatchingProposal(proposedPolicy) {
      return store.listPolicyProposals().find((proposal) => {
        if (proposal.status !== "pending") return false;
        return JSON.stringify(proposal.proposedPolicySnapshot) === JSON.stringify(proposedPolicy);
      });
    }
    __name(getLatestPendingMatchingProposal, "getLatestPendingMatchingProposal");
    function applyPolicySnapshot({
      proposalId,
      oldPolicySnapshot,
      proposedPolicySnapshot,
      actor = "user",
      summary
    }) {
      const appliedPolicy = {
        ...proposedPolicySnapshot,
        appliedProposalId: proposalId || null,
        updatedAt: nowIso2(),
        lastUpdatedAt: nowIso2(),
        version: Number(oldPolicySnapshot?.version || 0) + 1
      };
      store.saveGlobalStrategyPolicy(appliedPolicy);
      store.savePolicyHistoryEntry({
        id: createId("policyhist"),
        proposalId: proposalId || null,
        previousPolicySnapshot: oldPolicySnapshot || null,
        nextPolicySnapshot: appliedPolicy,
        summary: summary || "Applied a new global policy snapshot.",
        createdAt: nowIso2()
      });
      logPolicyAudit({
        eventType: "policy_applied",
        actor,
        relatedProposalId: proposalId || null,
        summary: summary || "Applied a new global policy snapshot."
      });
      return appliedPolicy;
    }
    __name(applyPolicySnapshot, "applyPolicySnapshot");
    function derivePolicyRiskTolerance(metrics, strategyProfile, badCases) {
      if (badCases.length >= 3 || metrics.conversionRate < 0.2) return "low";
      if ((strategyProfile.preferredRoles || []).length >= 2) return "medium";
      return "high";
    }
    __name(derivePolicyRiskTolerance, "derivePolicyRiskTolerance");
    function derivePolicyFocusMode(jobs, strategyProfile) {
      const activeJobs = jobs.filter((job) => !["archived", "rejected"].includes(job.status));
      const roleBuckets = [...new Set(activeJobs.map((job) => deriveRoleBucket(job)))];
      if (roleBuckets.length <= 2 && (strategyProfile.preferredRoles || []).length > 0) return "focused";
      if (roleBuckets.length <= 4) return "balanced";
      return "exploratory";
    }
    __name(derivePolicyFocusMode, "derivePolicyFocusMode");
    function refreshGlobalStrategyPolicy(strategyProfile = store.getStrategyProfile() || refreshStrategyProfile(), options = {}) {
      const jobs = store.listJobs();
      const badCases = store.listBadCases();
      const metrics = getMetricsSummary();
      const profile = store.getProfile() || {};
      const previousPolicy = store.getGlobalStrategyPolicy() || {};
      const preferredRoles = unique([
        ...strategyProfile.preferredRoles || [],
        ...profile.policyPreferences?.manualPreferredRoles || []
      ]).slice(0, 4);
      const riskyRoles = unique(
        (strategyProfile.riskyRoles || []).filter(
          (role) => !(profile.policyPreferences?.ignoredRiskyRoles || []).includes(role)
        )
      ).slice(0, 4);
      const preferredIndustries = Object.entries(strategyProfile.scoreBias?.industryBiases || {}).filter(([, value]) => Number(value) >= 2).sort((a, b) => b[1] - a[1]).map(([key]) => key).slice(0, 3);
      const riskyIndustries = Object.entries(strategyProfile.scoreBias?.industryBiases || {}).filter(([, value]) => Number(value) <= -3).sort((a, b) => a[1] - b[1]).map(([key]) => key).slice(0, 3);
      const preferredLocations = unique(profile.targetLocations || profile.preferredLocations || []).slice(0, 4);
      const riskyLocations = unique(
        jobs.filter(
          (job) => ["rejected", "archived"].includes(job.status) && job.location && preferredLocations.length > 0 && !preferredLocations.includes(job.location)
        ).map((job) => job.location)
      ).slice(0, 3);
      const successPatterns = unique(strategyProfile.successPatterns || []).slice(0, 4);
      const failurePatterns = unique(strategyProfile.failurePatterns || []).slice(0, 4);
      const avoidPatterns = unique([
        ...riskyRoles.map((role) => `${role} roles`),
        ...riskyIndustries.map((industry) => `${industry} industry`),
        ...failurePatterns
      ]).slice(0, 5);
      const riskTolerance = profile.policyPreferences?.riskToleranceOverride || derivePolicyRiskTolerance(metrics, strategyProfile, badCases);
      const focusMode = derivePolicyFocusMode(jobs, strategyProfile);
      const policy = {
        id: previousPolicy.id || "global_policy_main",
        version: Number(previousPolicy.version || 1),
        appliedProposalId: previousPolicy.appliedProposalId || null,
        preferredRoles,
        riskyRoles,
        avoidPatterns,
        preferredIndustries,
        riskyIndustries,
        preferredLocations,
        riskyLocations,
        successPatterns,
        failurePatterns,
        targetRolesPriority: preferredRoles,
        riskTolerance,
        focusMode,
        policySummary: focusMode === "focused" ? `Stay concentrated on ${summarizeList(preferredRoles, "top roles")} and avoid distraction patterns.` : focusMode === "balanced" ? "Keep a balanced pipeline, but continue leaning toward the strongest historical role clusters." : "Pipeline is still broad; continue exploring while tightening around the first strong conversion signals.",
        lastUpdatedAt: nowIso2(),
        updatedAt: nowIso2()
      };
      const changedFields = listChangedPolicyFields(previousPolicy, policy);
      const diffSummary = buildPolicyDiff(previousPolicy, policy);
      const triggerType = options.triggerType || "system_refresh";
      const autoApprove = Boolean(options.autoApprove);
      if (!previousPolicy.id) {
        return applyPolicySnapshot({
          proposalId: null,
          oldPolicySnapshot: null,
          proposedPolicySnapshot: { ...policy, version: 1 },
          actor: "system",
          summary: "Initialized the first active global policy from profile and historical pipeline signals."
        });
      }
      if (changedFields.length === 0) {
        return previousPolicy;
      }
      const existingPending = getLatestPendingMatchingProposal(policy);
      if (existingPending) {
        return previousPolicy;
      }
      const proposal = {
        id: createId("proposal"),
        createdAt: nowIso2(),
        triggerType,
        triggerSourceId: options.triggerSourceId || null,
        oldPolicySnapshot: previousPolicy,
        proposedPolicySnapshot: policy,
        diffSummary,
        reasonSummary: options.reasonSummary || inferProposalReason(triggerType, diffSummary),
        status: autoApprove ? "approved" : "pending",
        reviewerNote: options.reviewerNote || null,
        appliedAt: null,
        revertedAt: null
      };
      store.savePolicyProposal(proposal);
      logPolicyAudit({
        eventType: "proposal_created",
        actor: autoApprove ? "user" : "system",
        relatedProposalId: proposal.id,
        summary: proposal.reasonSummary
      });
      if (!autoApprove) {
        return previousPolicy;
      }
      proposal.status = "applied";
      proposal.appliedAt = nowIso2();
      store.savePolicyProposal(proposal);
      logPolicyAudit({
        eventType: "proposal_approved",
        actor: "user",
        relatedProposalId: proposal.id,
        summary: `Approved proposal ${proposal.id}.`
      });
      return applyPolicySnapshot({
        proposalId: proposal.id,
        oldPolicySnapshot: previousPolicy,
        proposedPolicySnapshot: policy,
        actor: "user",
        summary: `Applied policy proposal ${proposal.id}.`
      });
    }
    __name(refreshGlobalStrategyPolicy, "refreshGlobalStrategyPolicy");
    function refreshStrategyProfile() {
      const jobs = store.listJobs();
      const reflections = store.getState().interviewReflections || [];
      const badCases = store.listBadCases();
      const existing = store.getStrategyProfile() || {};
      const roleBiases = buildBiasMap(existing.scoreBias?.roleBiases || {});
      const industryBiases = buildBiasMap(existing.scoreBias?.industryBiases || {});
      const positiveSignals = [...existing.positiveSignals || []];
      const cautionSignals = [...existing.cautionSignals || []];
      const learnedFromInterviews = [...existing.learnedFromInterviews || []];
      jobs.forEach((job) => {
        const role = deriveRoleBucket(job);
        const industry = deriveIndustryBucket(job);
        if (["interviewing", "offer"].includes(job.status)) {
          adjustBias(roleBiases, role, 4);
          adjustBias(industryBiases, industry, 3);
        }
        if (job.status === "rejected") {
          adjustBias(roleBiases, role, -3);
          adjustBias(industryBiases, industry, -2);
        }
      });
      badCases.forEach((badCase) => {
        const sourceJob = store.getJob(badCase.jobId) || badCase;
        adjustBias(roleBiases, deriveRoleBucket(sourceJob), -4);
        adjustBias(industryBiases, deriveIndustryBucket(sourceJob), -3);
        if (badCase.issueDescription) {
          cautionSignals.push(badCase.issueDescription);
        }
      });
      reflections.forEach((reflection) => {
        (reflection.successSignals || []).forEach((signal) => positiveSignals.push(signal));
        (reflection.failureReasons || []).forEach((signal) => cautionSignals.push(signal));
        (reflection.skillGaps || []).forEach((gap) => learnedFromInterviews.push(gap));
      });
      const profile = {
        id: "strategy_profile_main",
        preferredRoles: Object.entries(roleBiases).filter(([, value]) => Number(value) >= 3).sort((a, b) => b[1] - a[1]).map(([key]) => key).slice(0, 3),
        riskyRoles: Object.entries(roleBiases).filter(([, value]) => Number(value) <= -3).sort((a, b) => a[1] - b[1]).map(([key]) => key).slice(0, 3),
        successPatterns: [...new Set(positiveSignals)].slice(0, 4),
        failurePatterns: [...new Set(cautionSignals)].slice(0, 4),
        scoreBias: {
          roleBiases,
          industryBiases
        },
        positiveSignals: [...new Set(positiveSignals)].slice(0, 6),
        cautionSignals: [...new Set(cautionSignals)].slice(0, 6),
        learnedFromInterviews: [...new Set(learnedFromInterviews)].slice(0, 6),
        updatedAt: nowIso2()
      };
      store.saveStrategyProfile(profile);
      return profile;
    }
    __name(refreshStrategyProfile, "refreshStrategyProfile");
    function getMetricsSummary() {
      const jobs = store.listJobs();
      const applicationPreps = jobs.map((job) => store.getApplicationPrepByJobId(job.id)).filter(Boolean);
      const appliedJobs = jobs.filter(
        (job) => ["applied", "follow_up", "interviewing", "offer", "rejected"].includes(job.status)
      ).length;
      const interviewJobs = jobs.filter(
        (job) => ["interviewing", "offer", "rejected"].includes(job.status)
      ).length;
      const offers = jobs.filter((job) => job.status === "offer").length;
      const rejected = jobs.filter((job) => job.status === "rejected").length;
      const prepCompleted = applicationPreps.filter((prep) => isPrepReady(prep)).length;
      return {
        totalJobs: jobs.length,
        appliedJobs,
        interviewJobs,
        offers,
        rejected,
        conversionRate: appliedJobs === 0 ? 0 : Number((interviewJobs / appliedJobs).toFixed(2)),
        prepCompletionRate: applicationPreps.length === 0 ? 0 : Number((prepCompleted / applicationPreps.length).toFixed(2))
      };
    }
    __name(getMetricsSummary, "getMetricsSummary");
    async function ingestJob(payload) {
      const job = await agentRegistry.jobIngestion(payload);
      store.saveJob(job);
      logActivity({
        type: "job_created",
        entityType: "job",
        entityId: job.id,
        action: "job_created",
        summary: `Created ${job.company} / ${job.title}.`,
        jobId: job.id,
        metadata: {
          sourceLabel: job.sourceLabel,
          llm: job.llmMeta || null
        },
        agentName: "Job Ingestion Agent",
        inputSummary: payload.rawJdText ? `Received JD text (${String(payload.rawJdText).length} chars) with manual overrides.` : "Received manual job fields without a full JD body.",
        outputSummary: `Structured job created with title=${job.title}, company=${job.company}, location=${job.location}${job.llmMeta?.fallbackUsed ? " via heuristic fallback" : " via LLM-assisted extraction"}.`,
        decisionReason: "The agent normalized the incoming role into a shared Job object so downstream evaluation can run on consistent fields."
      });
      const evaluation = await evaluateJob(job.id);
      return {
        job: evaluation.job,
        fitAssessment: evaluation.fitAssessment
      };
    }
    __name(ingestJob, "ingestJob");
    async function evaluateJob(jobId) {
      const job = store.getJob(jobId);
      const profile = store.getProfile();
      if (!job) {
        const error = new Error(`Job ${jobId} not found.`);
        error.code = "NOT_FOUND";
        throw error;
      }
      if (!profile) {
        const error = new Error("Profile is required before evaluation.");
        error.code = "PROFILE_REQUIRED";
        throw error;
      }
      const fitAssessment = await agentRegistry.fitEvaluation({
        job,
        profile,
        strategyProfile: store.getStrategyProfile() || refreshStrategyProfile(),
        globalPolicy: store.getGlobalStrategyPolicy() || refreshGlobalStrategyPolicy(store.getStrategyProfile() || refreshStrategyProfile(), {
          reason: "evaluation_bootstrap",
          triggerType: "system_refresh",
          triggerSource: "fit_evaluation"
        })
      });
      store.saveFitAssessment(fitAssessment);
      const nextStatus = fitAssessment.strategyDecision === "avoid" ? "archived" : fitAssessment.strategyDecision === "deprioritize" ? "inbox" : "to_prepare";
      const nextPriority = fitAssessment.strategyDecision === "proceed" ? "high" : fitAssessment.strategyDecision === "cautious_proceed" ? "medium" : "low";
      const globalPolicy = store.getGlobalStrategyPolicy() || refreshGlobalStrategyPolicy(store.getStrategyProfile() || refreshStrategyProfile(), {
        reason: "evaluation_refresh",
        triggerType: "system_refresh",
        triggerSource: "fit_evaluation"
      });
      const override = job.policyOverride?.active ? job.policyOverride : null;
      let resolvedStatus = nextStatus;
      let resolvedPriority = globalPolicy.focusMode === "focused" && fitAssessment.strategyDecision === "proceed" ? "high" : nextPriority;
      let resolvedDecision = fitAssessment.strategyDecision;
      if (override?.action === "force_proceed") {
        resolvedStatus = "to_prepare";
        resolvedPriority = "high";
        resolvedDecision = "proceed";
      } else if (override?.action === "ignore_policy" && ["avoid", "deprioritize"].includes(fitAssessment.strategyDecision)) {
        resolvedStatus = "to_prepare";
        resolvedPriority = "medium";
      } else if (override?.action === "force_archive") {
        resolvedStatus = "archived";
        resolvedPriority = "low";
        resolvedDecision = "avoid";
      }
      fitAssessment.activePolicyVersion = createPolicyVersion(globalPolicy);
      fitAssessment.policyProposalId = globalPolicy.appliedProposalId || null;
      fitAssessment.overrideApplied = Boolean(override);
      fitAssessment.overrideSummary = override ? `${override.action}${override.reason ? `: ${override.reason}` : ""}` : null;
      store.saveFitAssessment(fitAssessment);
      const updatedJob = updateJob(jobId, () => ({
        fitAssessmentId: fitAssessment.id,
        status: resolvedStatus,
        priority: resolvedPriority,
        strategyDecision: resolvedDecision,
        strategyReasoning: fitAssessment.strategyReasoning
      }));
      const nextTask = agentRegistry.pipelineManager({
        job: updatedJob,
        nextStatus: resolvedStatus,
        strategyDecision: resolvedDecision,
        fitAssessment,
        globalPolicy
      });
      if (nextTask) {
        store.saveTask(nextTask);
      }
      logActivity({
        type: "fit_generated",
        entityType: "fit_assessment",
        entityId: fitAssessment.id,
        action: "fit_generated",
        summary: `Generated ${fitAssessment.recommendation} assessment for ${job.company}.`,
        agentName: "Fit Evaluation Agent",
        inputSummary: `Compared role against profile targets: roles=${summarizeList(profile.targetRoles)}, industries=${summarizeList(profile.targetIndustries)}.`,
        outputSummary: `fitScore=${fitAssessment.fitScore}, recommendation=${fitAssessment.recommendation}, strategyDecision=${resolvedDecision}, nextStatus=${resolvedStatus}${fitAssessment.llmMeta?.fallbackUsed ? " via heuristic fallback" : " via LLM-assisted evaluation"}.`,
        decisionReason: fitAssessment.strategyReasoning,
        policyInfluenceSummary: fitAssessment.policyInfluenceSummary,
        decisionBreakdown: fitAssessment.decisionBreakdown,
        activePolicyVersion: fitAssessment.activePolicyVersion,
        policyProposalId: fitAssessment.policyProposalId,
        overrideApplied: fitAssessment.overrideApplied,
        overrideSummary: fitAssessment.overrideSummary,
        metadata: {
          jobId,
          fitScore: fitAssessment.fitScore,
          recommendation: fitAssessment.recommendation,
          strategyDecision: fitAssessment.strategyDecision,
          llm: fitAssessment.llmMeta || null
        }
      });
      return { job: updatedJob, fitAssessment, nextTask, globalPolicy };
    }
    __name(evaluateJob, "evaluateJob");
    async function prepareJobApplication(jobId) {
      const job = store.getJob(jobId);
      const profile = store.getProfile();
      if (!job) {
        const error = new Error(`Job ${jobId} not found.`);
        error.code = "NOT_FOUND";
        throw error;
      }
      if (!profile) {
        const error = new Error("Profile is required before preparation.");
        error.code = "PROFILE_REQUIRED";
        throw error;
      }
      const applicationPrep = await agentRegistry.applicationPrep({ job, profile });
      store.saveApplicationPrep(applicationPrep);
      let updatedJob = updateJob(jobId, () => ({
        applicationPrepId: applicationPrep.id,
        status: ["inbox", "archived"].includes(job.status) && ["deprioritize", "avoid"].includes(job.strategyDecision) ? "to_prepare" : job.status,
        priority: job.priority === "low" ? "medium" : job.priority
      }));
      logActivity({
        type: "prep_saved",
        entityType: "application_prep",
        entityId: applicationPrep.id,
        action: "prep_saved",
        summary: `Saved application prep for ${job.company}.`,
        metadata: {
          jobId,
          checklistCompleted: isPrepReady(applicationPrep),
          llm: applicationPrep.llmMeta || null
        },
        agentName: "Application Prep Agent",
        inputSummary: `Generated prep draft from job keywords=${summarizeList(applicationPrep.resumeTailoring?.targetKeywords || [])}.`,
        outputSummary: `Prep draft includes ${applicationPrep.resumeTailoring?.rewriteBullets?.length || 0} tailored bullets and ${applicationPrep.qaDraft?.length || 0} Q&A prompts${applicationPrep.llmMeta?.fallbackUsed ? " via heuristic fallback" : " via LLM-assisted generation"}.`,
        decisionReason: ["deprioritize", "avoid"].includes(job.strategyDecision) ? "The user explicitly overrode the strategy policy, so the role was reintroduced into the prep path." : job.strategyDecision === "cautious_proceed" ? "The strategy layer allows prep, but with explicit caution because the role carries higher narrative or outcome risk." : "The prep agent creates a first working draft so the user can review, edit, and keep the final submission inside the human approval boundary.",
        activePolicyVersion: createPolicyVersion(store.getGlobalStrategyPolicy()),
        policyProposalId: store.getGlobalStrategyPolicy()?.appliedProposalId || null,
        overrideApplied: Boolean(job.policyOverride?.active),
        overrideSummary: job.policyOverride?.active ? `${job.policyOverride.action}${job.policyOverride.reason ? `: ${job.policyOverride.reason}` : ""}` : null
      });
      return { job: updatedJob, applicationPrep };
    }
    __name(prepareJobApplication, "prepareJobApplication");
    function saveApplicationPrep2(jobId, payload) {
      const job = store.getJob(jobId);
      const profile = store.getProfile();
      const existing = store.getApplicationPrepByJobId(jobId);
      if (!job) {
        const error = new Error(`Job ${jobId} not found.`);
        error.code = "NOT_FOUND";
        throw error;
      }
      if (!profile) {
        const error = new Error("Profile is required before saving prep.");
        error.code = "PROFILE_REQUIRED";
        throw error;
      }
      const normalizeLines = /* @__PURE__ */ __name((value) => Array.isArray(value) ? value : String(value || "").split("\n").map((item) => item.trim()).filter(Boolean), "normalizeLines");
      const rewriteBullets = normalizeLines(payload.tailoredResumeBullets).map((line, index) => ({
        source: existing?.resumeTailoring?.rewriteBullets?.[index]?.source || `Bullet ${index + 1}`,
        rewritten: line
      }));
      const qaDraft = normalizeLines(payload.qaDraft).map((line, index) => {
        const [question, ...answerParts] = line.split("::");
        return {
          question: (question || `Question ${index + 1}`).trim(),
          draftAnswer: (answerParts.join("::") || "").trim()
        };
      });
      const checklist = (payload.checklist || []).map((item, index) => ({
        key: item.key || `check_${index + 1}`,
        label: item.label || `Checklist item ${index + 1}`,
        completed: Boolean(item.completed)
      }));
      const applicationPrep = {
        id: existing?.id || createId("prep"),
        jobId,
        profileId: profile.id,
        version: (existing?.version || 0) + 1,
        resumeTailoring: {
          targetKeywords: payload.targetKeywords || existing?.resumeTailoring?.targetKeywords || job.jdStructured?.keywords?.slice(0, 5) || [],
          rewriteBullets
        },
        selfIntro: {
          short: payload.selfIntroShort || existing?.selfIntro?.short || "",
          medium: payload.selfIntroMedium || existing?.selfIntro?.medium || ""
        },
        qaDraft,
        coverNote: payload.coverNote || "",
        checklist,
        createdAt: existing?.createdAt || nowIso2(),
        updatedAt: nowIso2()
      };
      store.saveApplicationPrep(applicationPrep);
      const updatedJob = updateJob(jobId, () => ({
        applicationPrepId: applicationPrep.id
      }));
      logActivity({
        type: "prep_saved",
        entityType: "application_prep",
        entityId: applicationPrep.id,
        action: "prep_saved",
        actor: "user",
        jobId,
        summary: `Saved editable prep for ${job.company}.`,
        agentName: "Application Prep Agent",
        inputSummary: `User updated prep fields and ${checklist.filter((item) => item.completed).length}/${checklist.length} checklist items are complete.`,
        outputSummary: `Prep version ${applicationPrep.version} saved with prepReady=${isPrepReady(applicationPrep)}.`,
        decisionReason: "The system preserves user-edited application materials as shared state so the pipeline can safely decide when the role is ready to apply.",
        activePolicyVersion: createPolicyVersion(store.getGlobalStrategyPolicy()),
        policyProposalId: store.getGlobalStrategyPolicy()?.appliedProposalId || null,
        overrideApplied: Boolean(job.policyOverride?.active),
        overrideSummary: job.policyOverride?.active ? `${job.policyOverride.action}${job.policyOverride.reason ? `: ${job.policyOverride.reason}` : ""}` : null
      });
      return {
        job: updatedJob,
        applicationPrep,
        prepReady: isPrepReady(applicationPrep)
      };
    }
    __name(saveApplicationPrep2, "saveApplicationPrep");
    function isPrepReady(applicationPrep) {
      const requiredKeys = ["resume_reviewed", "intro_ready", "qa_ready"];
      const doneKeys = new Set(
        (applicationPrep.checklist || []).filter((item) => item.completed).map((item) => item.key)
      );
      return requiredKeys.every((key) => doneKeys.has(key));
    }
    __name(isPrepReady, "isPrepReady");
    function transitionJobStatus(jobId, nextStatus, options = {}) {
      const job = store.getJob(jobId);
      if (!job) {
        const error = new Error(`Job ${jobId} not found.`);
        error.code = "NOT_FOUND";
        throw error;
      }
      assertJobStatusTransition(job.status, nextStatus);
      if (nextStatus === "ready_to_apply") {
        const prep = store.getApplicationPrepByJobId(jobId);
        if (!prep || !isPrepReady(prep)) {
          const error = new Error(
            "Cannot move to ready_to_apply until prep core checklist is completed."
          );
          error.code = "PREP_NOT_READY";
          error.details = { jobId, requiredChecklist: ["resume_reviewed", "intro_ready", "qa_ready"] };
          throw error;
        }
      }
      const updatedJob = updateJob(jobId, () => ({
        status: nextStatus
      }));
      const globalPolicy = store.getGlobalStrategyPolicy() || refreshGlobalStrategyPolicy(store.getStrategyProfile() || refreshStrategyProfile(), {
        reason: "status_transition",
        triggerType: "metrics_shift",
        triggerSource: "pipeline_manager"
      });
      const nextTask = agentRegistry.pipelineManager({
        job: updatedJob,
        nextStatus,
        strategyDecision: updatedJob.strategyDecision,
        fitAssessment: store.getFitAssessmentByJobId(jobId),
        globalPolicy
      });
      if (nextTask) {
        store.saveTask(nextTask);
      }
      logActivity({
        type: "job_status_changed",
        entityType: "job",
        entityId: jobId,
        action: "job_status_changed",
        actor: options.actor || "user",
        jobId,
        summary: `Moved ${updatedJob.company} to ${nextStatus}.`,
        metadata: { currentStatus: job.status, nextStatus },
        agentName: "Pipeline Manager Agent",
        inputSummary: `Requested status transition from ${job.status} to ${nextStatus}.`,
        outputSummary: nextTask ? `Status updated to ${nextStatus}; created follow-up task ${nextTask.title}.` : `Status updated to ${nextStatus}; no follow-up task generated.`,
        decisionReason: nextStatus === "ready_to_apply" ? "The transition was allowed only after the core prep checklist was complete." : "The transition followed the job lifecycle state machine and updated shared pipeline state.",
        policyInfluenceSummary: `Pipeline executed this transition under focusMode=${globalPolicy.focusMode} with riskTolerance=${globalPolicy.riskTolerance}.`,
        activePolicyVersion: createPolicyVersion(globalPolicy),
        policyProposalId: globalPolicy.appliedProposalId || null,
        overrideApplied: Boolean(updatedJob.policyOverride?.active),
        overrideSummary: updatedJob.policyOverride?.active ? `${updatedJob.policyOverride.action}${updatedJob.policyOverride.reason ? `: ${updatedJob.policyOverride.reason}` : ""}` : null
      });
      const strategyProfile = refreshStrategyProfile();
      refreshGlobalStrategyPolicy(strategyProfile, {
        reason: "status_transition",
        triggerType: "metrics_shift",
        triggerSource: "pipeline_manager"
      });
      return { job: updatedJob, nextTask };
    }
    __name(transitionJobStatus, "transitionJobStatus");
    function saveProfile2(payload) {
      const current = store.getProfile();
      const csvToArray = /* @__PURE__ */ __name((value) => Array.isArray(value) ? value : String(value || "").split(",").map((item) => item.trim()).filter(Boolean), "csvToArray");
      const profile = {
        ...current || {},
        ...payload,
        id: current?.id || createId("profile"),
        fullName: payload.name || payload.fullName || current?.fullName || "",
        name: payload.name || payload.fullName || current?.name || "",
        headline: payload.background || payload.headline || current?.headline || "",
        background: payload.background || payload.headline || current?.background || "",
        yearsOfExperience: Number(payload.yearsOfExperience ?? current?.yearsOfExperience ?? 0),
        targetRoles: csvToArray(payload.targetRoles ?? current?.targetRoles ?? []),
        targetIndustries: csvToArray(payload.targetIndustries ?? current?.targetIndustries ?? []),
        preferredLocations: csvToArray(
          payload.targetLocations ?? payload.preferredLocations ?? current?.preferredLocations ?? []
        ),
        targetLocations: csvToArray(
          payload.targetLocations ?? payload.preferredLocations ?? current?.targetLocations ?? []
        ),
        strengths: csvToArray(payload.strengths ?? current?.strengths ?? []),
        constraints: csvToArray(payload.constraints ?? current?.constraints ?? []),
        baseResume: payload.masterResume || payload.baseResume || current?.baseResume || "",
        masterResume: payload.masterResume || payload.baseResume || current?.masterResume || "",
        policyPreferences: {
          manualPreferredRoles: csvToArray(
            payload.manualPreferredRoles ?? current?.policyPreferences?.manualPreferredRoles ?? []
          ),
          ignoredRiskyRoles: csvToArray(
            payload.ignoredRiskyRoles ?? current?.policyPreferences?.ignoredRiskyRoles ?? []
          ),
          riskToleranceOverride: payload.riskToleranceOverride || current?.policyPreferences?.riskToleranceOverride || ""
        },
        summary: payload.background || payload.summary || current?.summary || payload.headline || "",
        createdAt: current?.createdAt || nowIso2(),
        updatedAt: nowIso2()
      };
      store.saveProfile(profile);
      if (JSON.stringify(current?.policyPreferences || {}) !== JSON.stringify(profile.policyPreferences || {})) {
        logPolicyAudit({
          eventType: "user_override_applied",
          actor: "user",
          summary: "Updated profile-level policy overrides."
        });
      }
      const strategyProfile = refreshStrategyProfile();
      const globalPolicy = refreshGlobalStrategyPolicy(strategyProfile, {
        reason: "profile_updated",
        triggerType: "profile_update",
        triggerSource: "user_profile",
        reasonSummary: "User updated profile-level policy controls.",
        autoApprove: true
      });
      logActivity({
        type: "profile_saved",
        entityType: "profile",
        entityId: profile.id,
        action: "profile_saved",
        actor: "user",
        summary: `Saved profile for ${profile.fullName || "candidate"}.`,
        inputSummary: `Profile updated with targetRoles=${summarizeList(profile.targetRoles)}, targetIndustries=${summarizeList(profile.targetIndustries)}.`,
        outputSummary: `Profile now records ${profile.yearsOfExperience} years experience and ${profile.strengths.length} strengths.`,
        decisionReason: "The profile is the long-lived source of truth used by ingestion, evaluation, and prep.",
        policyInfluenceSummary: `Global policy refreshed with focusMode=${globalPolicy.focusMode} and riskTolerance=${globalPolicy.riskTolerance}.`
      });
      return profile;
    }
    __name(saveProfile2, "saveProfile");
    function reflectInterview(payload) {
      const job = store.getJob(payload.jobId);
      const profile = store.getProfile();
      if (!job) {
        const error = new Error(`Job ${payload.jobId} not found.`);
        error.code = "NOT_FOUND";
        throw error;
      }
      const reflection = agentRegistry.interviewReflection({ payload, profile });
      store.saveInterviewReflection(reflection);
      const updatedJob = updateJob(payload.jobId, () => ({
        latestInterviewReflectionId: reflection.id,
        latestFailureReasons: reflection.failureReasons || [],
        latestSuccessSignals: reflection.successSignals || [],
        latestSkillGaps: reflection.skillGaps || []
      }));
      if (profile) {
        store.saveProfile({
          ...profile,
          learnedStrengths: [
            .../* @__PURE__ */ new Set([...profile.learnedStrengths || [], ...reflection.successSignals || []])
          ].slice(0, 8),
          learnedSkillGaps: [
            .../* @__PURE__ */ new Set([...profile.learnedSkillGaps || [], ...reflection.skillGaps || []])
          ].slice(0, 8),
          successSignals: [
            .../* @__PURE__ */ new Set([...profile.successSignals || [], ...reflection.successSignals || []])
          ].slice(0, 8),
          updatedAt: nowIso2()
        });
      }
      const strategyProfile = refreshStrategyProfile();
      const globalPolicy = refreshGlobalStrategyPolicy(strategyProfile, {
        reason: "interview_reflection",
        triggerType: "interview_reflection",
        triggerSource: "interview_reflection"
      });
      logActivity({
        type: "interview_reflected",
        entityType: "interview_reflection",
        entityId: reflection.id,
        action: "interview_reflected",
        summary: `Logged interview reflection for ${job.company}.`,
        metadata: { jobId: job.id, skillGaps: reflection.skillGaps || [] },
        agentName: "Interview Reflection Agent",
        inputSummary: `Interview notes captured for ${updatedJob.title}.`,
        outputSummary: `Captured ${reflection.successSignals?.length || 0} success signals and ${reflection.skillGaps?.length || 0} skill gaps.`,
        decisionReason: `This reflection now updates future scoring biases and strategy advice. Strategy profile refreshed at ${strategyProfile.updatedAt}; global policy refreshed at ${globalPolicy.updatedAt}.`
      });
      return reflection;
    }
    __name(reflectInterview, "reflectInterview");
    function getJobDetail(jobId) {
      const job = store.getJob(jobId);
      if (!job) {
        const error = new Error(`Job ${jobId} not found.`);
        error.code = "NOT_FOUND";
        throw error;
      }
      const fitAssessment = store.getFitAssessmentByJobId(jobId) ? {
        ...store.getFitAssessmentByJobId(jobId),
        overrideApplied: Boolean(job.policyOverride?.active) || store.getFitAssessmentByJobId(jobId).overrideApplied,
        overrideSummary: job.policyOverride?.active ? `${job.policyOverride.action}${job.policyOverride.reason ? `: ${job.policyOverride.reason}` : ""}` : store.getFitAssessmentByJobId(jobId).overrideSummary || null
      } : null;
      const globalPolicy = store.getGlobalStrategyPolicy() || refreshGlobalStrategyPolicy(store.getStrategyProfile() || refreshStrategyProfile(), {
        reason: "job_detail_view",
        triggerType: "system_refresh",
        triggerSource: "ui"
      });
      return {
        job,
        fitAssessment,
        applicationPrep: store.getApplicationPrepByJobId(jobId) || null,
        tasks: store.listTasksByJobId(jobId),
        activityLogs: store.listActivityLogsByJobId(jobId).sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt)),
        interviewReflection: store.getInterviewReflectionByJobId(jobId) || null,
        badCase: store.getBadCaseByJobId(jobId) || null,
        globalPolicy,
        policyExplanation: buildJobPolicyExplanation(job, fitAssessment, globalPolicy),
        policyProposals: listPolicyProposals2().slice(0, 3),
        policyAuditLogs: listPolicyAuditHistory().slice(0, 5),
        nextAction: getJobNextAction(job),
        allowedNextStatuses: getAllowedNextStatuses(job.status),
        recommendedNextStatuses: getRecommendedNextStatuses(job.status)
      };
    }
    __name(getJobDetail, "getJobDetail");
    function buildJobPolicyExplanation(job, fitAssessment, globalPolicy) {
      const explanation = [];
      if (!fitAssessment) return explanation;
      explanation.push(`Strategy decision: ${fitAssessment.strategyDecision}.`);
      if (fitAssessment.policyInfluenceSummary) {
        explanation.push(fitAssessment.policyInfluenceSummary);
      }
      if (fitAssessment.historyInfluenceSummary) {
        explanation.push(fitAssessment.historyInfluenceSummary);
      }
      if (job.status === "archived" && fitAssessment.strategyDecision === "avoid") {
        explanation.push("The role was archived by default because current policy and historical evidence both indicate low expected leverage.");
      }
      if (job.priority === "high" && globalPolicy.focusMode === "focused") {
        explanation.push("This job is elevated because it fits the current focused pipeline strategy.");
      }
      if (job.strategyDecision === "deprioritize") {
        explanation.push("The system kept this job out of the active prep queue, but you can still override that manually.");
      }
      if (job.policyOverride?.active) {
        explanation.push(
          `A user override is active (${job.policyOverride.action})${job.policyOverride.reason ? `: ${job.policyOverride.reason}` : "."}`
        );
      }
      return explanation;
    }
    __name(buildJobPolicyExplanation, "buildJobPolicyExplanation");
    function getJobNextAction(job) {
      const prep = store.getApplicationPrepByJobId(job.id);
      const fit = store.getFitAssessmentByJobId(job.id);
      const globalPolicy = store.getGlobalStrategyPolicy() || refreshGlobalStrategyPolicy();
      if (job.strategyDecision === "deprioritize" && job.status === "inbox") {
        return {
          tone: "warning",
          title: globalPolicy.focusMode === "focused" ? "This role is deprioritized under the current focus policy" : "This role is currently deprioritized",
          description: fit?.strategyReasoning || (globalPolicy.focusMode === "focused" ? "The global policy is concentrating effort on a narrower set of roles, so this job is held outside the active prep queue unless you override it." : "The strategy layer kept this role out of the active prep queue. Only continue if you want to override the backlog decision."),
          ctaLabel: "Override and prep",
          ctaType: "prepare"
        };
      }
      if (job.status === "archived") {
        return {
          tone: "warning",
          title: "This role is not recommended for active pursuit",
          description: fit?.strategyDecision === "avoid" ? "The strategy policy marked this role as avoid. Keep it archived unless you explicitly want to override the decision." : "This role has been archived from the active pipeline.",
          ctaLabel: fit?.strategyDecision === "avoid" ? "Override and prep" : "Review archived rationale",
          ctaType: fit?.strategyDecision === "avoid" ? "prepare" : "none"
        };
      }
      if (job.status === "evaluating") {
        return {
          tone: "primary",
          title: "Complete the fit evaluation",
          description: "Run the evaluation so the system can decide whether this role is worth preparing for.",
          ctaLabel: "Run evaluation",
          ctaType: "evaluate"
        };
      }
      if (job.status === "to_prepare") {
        if (!prep) {
          return {
            tone: job.strategyDecision === "cautious_proceed" ? "warning" : "primary",
            title: job.strategyDecision === "cautious_proceed" ? "Prepare carefully with the key risks in mind" : "Create the first prep draft",
            description: job.strategyDecision === "cautious_proceed" ? `Move forward carefully. Watch these risks: ${(fit?.riskFlags || []).slice(0, 2).join(" / ") || "review the fit assessment."}` : globalPolicy.focusMode === "focused" && job.priority === "high" ? "This role matches the current global focus. Generate tailored application materials now to keep momentum." : "Generate tailored application materials before deciding whether to invest further.",
            ctaLabel: "Generate prep draft",
            ctaType: "prepare"
          };
        }
        const missing = (prep.checklist || []).filter((item) => !item.completed && ["resume_reviewed", "intro_ready", "qa_ready"].includes(item.key)).map((item) => item.label);
        return {
          tone: missing.length === 0 ? "primary" : "warning",
          title: missing.length === 0 ? "Mark prep as complete" : "Finish the prep checklist",
          description: missing.length === 0 ? "Core prep items are complete. You can now move this role to ready_to_apply." : `Complete these core items first: ${missing.join(" / ")}.`,
          ctaLabel: "Open Prep",
          ctaType: "open_prep"
        };
      }
      if (job.status === "ready_to_apply") {
        return {
          tone: "primary",
          title: globalPolicy.focusMode === "focused" && job.priority === "high" ? "High-priority role is ready to submit" : "Confirm the application has been submitted",
          description: globalPolicy.focusMode === "focused" && job.priority === "high" ? "This role is on-policy and fully prepped. After you apply outside the system, mark it as applied here to keep the focused pipeline moving." : "This role is ready. After you apply outside the system, mark it as applied here.",
          ctaLabel: "Mark as applied",
          ctaType: "status",
          nextStatus: "applied"
        };
      }
      if (job.status === "applied") {
        return {
          tone: "primary",
          title: "Move the role into follow-up",
          description: "Track the response window and prepare your next checkpoint.",
          ctaLabel: "Start follow-up",
          ctaType: "status",
          nextStatus: "follow_up"
        };
      }
      if (job.status === "follow_up") {
        return {
          tone: "warning",
          title: "Wait for response or mark interview progress",
          description: "If the company replies, move this role into interviewing. Otherwise keep tracking the follow-up window.",
          ctaLabel: "Mark interviewing",
          ctaType: "status",
          nextStatus: "interviewing"
        };
      }
      if (job.status === "interviewing") {
        return {
          tone: "primary",
          title: "Capture the interview outcome",
          description: "Once the process moves forward, update the role to offer or rejected.",
          ctaLabel: "Log next outcome",
          ctaType: "none"
        };
      }
      return {
        tone: "neutral",
        title: "Review this role",
        description: "Open the latest details and decide the next manual action.",
        ctaLabel: "Open detail",
        ctaType: "none"
      };
    }
    __name(getJobNextAction, "getJobNextAction");
    function getDashboardSummary() {
      const jobs = store.listJobs();
      const tasks = store.listTasks();
      const globalPolicy = store.getGlobalStrategyPolicy() || refreshGlobalStrategyPolicy();
      const statusCounts = jobs.reduce((acc, job) => {
        acc[job.status] = (acc[job.status] || 0) + 1;
        return acc;
      }, {});
      return {
        statusCounts,
        metrics: getMetricsSummary(),
        strategyInsights: getStrategyInsights(),
        globalPolicy,
        policyHistory: store.listPolicyHistory().slice(0, 3),
        policyProposals: listPolicyProposals2().slice(0, 3),
        policyAuditLogs: listPolicyAuditHistory().slice(0, 5),
        strategyProfile: store.getStrategyProfile() || refreshStrategyProfile(),
        profile: store.getProfile(),
        todoTasks: tasks.filter((task) => task.status === "todo").slice(0, 5),
        recentJobs: [...jobs].sort(
          (a, b) => priorityWeight(b.priority) - priorityWeight(a.priority) || new Date(b.updatedAt) - new Date(a.updatedAt)
        ).slice(0, 5),
        staleJobs: jobs.filter((job) => {
          if (!["to_prepare", "ready_to_apply", "follow_up"].includes(job.status)) return false;
          if (globalPolicy.focusMode === "focused") return job.priority === "high";
          return job.priority !== "low";
        })
      };
    }
    __name(getDashboardSummary, "getDashboardSummary");
    function getPolicyHistory() {
      return store.listPolicyHistory().slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    __name(getPolicyHistory, "getPolicyHistory");
    function getCurrentPolicy() {
      return store.getGlobalStrategyPolicy();
    }
    __name(getCurrentPolicy, "getCurrentPolicy");
    function listPolicyProposals2() {
      return store.listPolicyProposals().slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    __name(listPolicyProposals2, "listPolicyProposals");
    function listPolicyAuditHistory() {
      return store.listPolicyAuditLogs().slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }
    __name(listPolicyAuditHistory, "listPolicyAuditHistory");
    function approvePolicyProposal(proposalId, reviewerNote = "") {
      const proposal = store.getPolicyProposal(proposalId);
      if (!proposal) {
        const error = new Error(`Policy proposal ${proposalId} not found.`);
        error.code = "NOT_FOUND";
        throw error;
      }
      if (!["pending", "approved"].includes(proposal.status)) {
        const error = new Error(`Proposal ${proposalId} cannot be approved from status ${proposal.status}.`);
        error.code = "INVALID_PROPOSAL_STATE";
        throw error;
      }
      proposal.status = "applied";
      proposal.reviewerNote = reviewerNote || proposal.reviewerNote || "";
      proposal.appliedAt = nowIso2();
      store.savePolicyProposal(proposal);
      logPolicyAudit({
        eventType: "proposal_approved",
        actor: "user",
        relatedProposalId: proposalId,
        summary: `Approved policy proposal ${proposalId}.`
      });
      const appliedPolicy = applyPolicySnapshot({
        proposalId,
        oldPolicySnapshot: proposal.oldPolicySnapshot,
        proposedPolicySnapshot: proposal.proposedPolicySnapshot,
        actor: "user",
        summary: `Applied policy proposal ${proposalId}.`
      });
      return { proposal, policy: appliedPolicy };
    }
    __name(approvePolicyProposal, "approvePolicyProposal");
    function rejectPolicyProposal(proposalId, reviewerNote = "") {
      const proposal = store.getPolicyProposal(proposalId);
      if (!proposal) {
        const error = new Error(`Policy proposal ${proposalId} not found.`);
        error.code = "NOT_FOUND";
        throw error;
      }
      if (!["pending", "approved"].includes(proposal.status)) {
        const error = new Error(`Proposal ${proposalId} cannot be rejected from status ${proposal.status}.`);
        error.code = "INVALID_PROPOSAL_STATE";
        throw error;
      }
      proposal.status = "rejected";
      proposal.reviewerNote = reviewerNote || proposal.reviewerNote || "";
      store.savePolicyProposal(proposal);
      logPolicyAudit({
        eventType: "proposal_rejected",
        actor: "user",
        relatedProposalId: proposalId,
        summary: `Rejected policy proposal ${proposalId}.`
      });
      return proposal;
    }
    __name(rejectPolicyProposal, "rejectPolicyProposal");
    function revertCurrentPolicy() {
      const currentPolicy = store.getGlobalStrategyPolicy();
      const previousEntry = getPolicyHistory()[0];
      const targetSnapshot = previousEntry?.previousPolicySnapshot;
      if (!currentPolicy || !targetSnapshot) {
        const error = new Error("No previous policy snapshot is available to revert to.");
        error.code = "NO_REVERT_TARGET";
        throw error;
      }
      const revertedPolicy = applyPolicySnapshot({
        proposalId: null,
        oldPolicySnapshot: currentPolicy,
        proposedPolicySnapshot: targetSnapshot,
        actor: "user",
        summary: "Reverted to the previous active policy snapshot."
      });
      store.savePolicyHistoryEntry({
        id: createId("policyhist"),
        proposalId: null,
        previousPolicySnapshot: currentPolicy,
        nextPolicySnapshot: revertedPolicy,
        summary: "Recorded explicit policy revert action.",
        createdAt: nowIso2(),
        revertedAt: nowIso2()
      });
      logPolicyAudit({
        eventType: "policy_reverted",
        actor: "user",
        relatedProposalId: null,
        summary: `Reverted active policy from ${createPolicyVersion(currentPolicy)} to ${createPolicyVersion(
          revertedPolicy
        )}.`
      });
      return revertedPolicy;
    }
    __name(revertCurrentPolicy, "revertCurrentPolicy");
    function applyJobOverride(jobId, payload = {}) {
      const job = store.getJob(jobId);
      if (!job) {
        const error = new Error(`Job ${jobId} not found.`);
        error.code = "NOT_FOUND";
        throw error;
      }
      const action = payload.action;
      if (!["force_proceed", "ignore_policy", "force_archive"].includes(action)) {
        const error = new Error("Invalid override action.");
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      const override = {
        action,
        active: true,
        reason: payload.reason || "",
        appliedAt: nowIso2()
      };
      let nextPatch = { policyOverride: override };
      if (action === "force_proceed") {
        nextPatch = {
          ...nextPatch,
          strategyDecision: "proceed",
          status: ["archived", "inbox", "evaluating"].includes(job.status) ? "to_prepare" : job.status,
          priority: "high"
        };
      }
      if (action === "ignore_policy") {
        nextPatch = {
          ...nextPatch,
          status: ["archived", "inbox", "evaluating"].includes(job.status) ? "to_prepare" : job.status,
          priority: job.priority === "low" ? "medium" : job.priority
        };
      }
      if (action === "force_archive") {
        nextPatch = {
          ...nextPatch,
          status: "archived",
          priority: "low",
          strategyDecision: "avoid"
        };
      }
      const updatedJob = updateJob(jobId, () => nextPatch);
      logPolicyAudit({
        eventType: "user_override_applied",
        actor: "user",
        relatedProposalId: null,
        summary: `Applied ${action} override to ${job.company} / ${job.title}.`
      });
      logActivity({
        type: "job_override_applied",
        entityType: "job",
        entityId: jobId,
        action: "job_override_applied",
        actor: "user",
        jobId,
        summary: `Applied ${action} override to ${job.company}.`,
        decisionReason: "The user explicitly overrode the current policy-driven job handling.",
        overrideApplied: true,
        overrideSummary: payload.reason || action,
        activePolicyVersion: createPolicyVersion(store.getGlobalStrategyPolicy())
      });
      return updatedJob;
    }
    __name(applyJobOverride, "applyJobOverride");
    function getStrategyInsights() {
      const jobs = store.listJobs();
      const badCases = store.listBadCases();
      const reflections = store.getState().interviewReflections || [];
      const strategyProfile = store.getStrategyProfile() || refreshStrategyProfile();
      const globalPolicy = store.getGlobalStrategyPolicy() || refreshGlobalStrategyPolicy(strategyProfile);
      const roleDistribution = {};
      const industryDistribution = {};
      const successPaths = {};
      const failurePoints = {};
      jobs.forEach((job) => {
        const role = deriveRoleBucket(job);
        const industry = deriveIndustryBucket(job);
        roleDistribution[role] = (roleDistribution[role] || 0) + 1;
        industryDistribution[industry] = (industryDistribution[industry] || 0) + 1;
        if (["interviewing", "offer"].includes(job.status)) {
          successPaths[role] = (successPaths[role] || 0) + 1;
        }
        if (job.status === "rejected") {
          failurePoints[role] = (failurePoints[role] || 0) + 1;
        }
      });
      badCases.forEach((badCase) => {
        const sourceJob = store.getJob(badCase.jobId) || badCase;
        const role = deriveRoleBucket(sourceJob);
        failurePoints[role] = (failurePoints[role] || 0) + 1;
      });
      const topRole = Object.entries(successPaths).sort((a, b) => b[1] - a[1])[0]?.[0];
      const weakRole = Object.entries(failurePoints).sort((a, b) => b[1] - a[1])[0]?.[0];
      const recommendations = [];
      if (topRole) {
        recommendations.push(`You convert best in ${topRole} roles, so keep them in the active pipeline and prep queue.`);
      }
      if (weakRole) {
        recommendations.push(`Reduce ${weakRole} submissions because they cluster in failures or bad cases.`);
      }
      if (strategyProfile.learnedFromInterviews?.length) {
        recommendations.push(`Priority capability gap: ${strategyProfile.learnedFromInterviews[0]}.`);
      }
      if (recommendations.length === 0) {
        recommendations.push("Pipeline is still too small for strong biasing; keep exploring but log outcomes consistently.");
      }
      recommendations.unshift(
        globalPolicy.focusMode === "focused" ? `Stay focused on ${summarizeList(globalPolicy.preferredRoles || globalPolicy.targetRolesPriority || [], "core roles")} and keep lower-signal roles out of the prep queue.` : globalPolicy.focusMode === "exploratory" ? "Pipeline is still broad. Narrow the next wave of applications toward the first role cluster that reaches interviews." : "Pipeline is reasonably balanced. Keep prioritizing the best-converting role clusters."
      );
      return {
        roleDistribution,
        industryDistribution,
        successPaths,
        failurePoints,
        globalPolicy,
        preferredRoles: strategyProfile.preferredRoles || [],
        riskyRoles: strategyProfile.riskyRoles || [],
        successPatterns: strategyProfile.successPatterns || [],
        failurePatterns: strategyProfile.failurePatterns || [],
        interviewThemes: reflections.flatMap((item) => item.skillGaps || []).slice(0, 6),
        recommendations: recommendations.slice(0, 3),
        policySignals: {
          focusMode: globalPolicy.focusMode,
          riskTolerance: globalPolicy.riskTolerance,
          targetRolesPriority: globalPolicy.targetRolesPriority || []
        },
        concentrationScore: Object.keys(roleDistribution).length <= 2 ? "high" : Object.keys(roleDistribution).length <= 4 ? "medium" : "low",
        driftStatus: weakRole && topRole && weakRole !== topRole ? "drifting_from_success_path" : Object.keys(roleDistribution).length > 4 ? "over_distributed" : "aligned",
        strategyHealth: topRole && !weakRole ? "focused" : weakRole && badCases.length > 1 ? "needs_tightening" : "forming"
      };
    }
    __name(getStrategyInsights, "getStrategyInsights");
    function updateBadCase(jobId, payload = {}) {
      const job = store.getJob(jobId);
      if (!job) {
        const error = new Error(`Job ${jobId} not found.`);
        error.code = "NOT_FOUND";
        throw error;
      }
      const existing = store.getBadCaseByJobId(jobId);
      if (payload.isBadCase === false) {
        store.removeBadCase(jobId);
        const strategyProfile2 = refreshStrategyProfile();
        refreshGlobalStrategyPolicy(strategyProfile2, {
          reason: "bad_case_cleared",
          triggerType: "bad_case",
          triggerSource: "feedback_loop"
        });
        logActivity({
          type: "bad_case_cleared",
          entityType: "job",
          entityId: jobId,
          action: "bad_case_cleared",
          actor: "user",
          jobId,
          summary: `Removed bad case flag for ${job.company}.`,
          agentName: "Feedback Loop",
          inputSummary: "User cleared the bad case marker.",
          outputSummary: "Job is no longer tracked as a bad case.",
          decisionReason: "This keeps the failure library aligned with the user's latest judgement."
        });
        return null;
      }
      const badCase = {
        id: existing?.id || createId("badcase"),
        jobId,
        company: job.company,
        title: job.title,
        rawJd: job.jdRaw || "",
        fitAssessment: store.getFitAssessmentByJobId(jobId) || null,
        finalStatus: job.status,
        issueDescription: payload.issueDescription || existing?.issueDescription || "",
        createdAt: existing?.createdAt || nowIso2(),
        updatedAt: nowIso2()
      };
      store.saveBadCase(badCase);
      const strategyProfile = refreshStrategyProfile();
      refreshGlobalStrategyPolicy(strategyProfile, {
        reason: "bad_case_marked",
        triggerType: "bad_case",
        triggerSource: "feedback_loop"
      });
      logActivity({
        type: "bad_case_marked",
        entityType: "job",
        entityId: jobId,
        action: "bad_case_marked",
        actor: "user",
        jobId,
        summary: `Marked ${job.company} as a bad case.`,
        agentName: "Feedback Loop",
        inputSummary: payload.issueDescription ? `User flagged this job with note: ${payload.issueDescription}` : "User flagged this job as a bad case.",
        outputSummary: `Bad case library now contains a replayable record for ${job.company}.`,
        decisionReason: "Bad cases preserve failed or misleading decisions so future evaluations can be audited and improved."
      });
      return badCase;
    }
    __name(updateBadCase, "updateBadCase");
    function listBadCases2() {
      return store.listBadCases().slice().sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    }
    __name(listBadCases2, "listBadCases");
    module2.exports = {
      ingestJob,
      evaluateJob,
      prepareJobApplication,
      saveApplicationPrep: saveApplicationPrep2,
      transitionJobStatus,
      saveProfile: saveProfile2,
      reflectInterview,
      getJobDetail,
      getDashboardSummary,
      getMetricsSummary,
      getCurrentPolicy,
      getStrategyInsights,
      getPolicyHistory,
      listPolicyProposals: listPolicyProposals2,
      listPolicyAuditHistory,
      approvePolicyProposal,
      rejectPolicyProposal,
      revertCurrentPolicy,
      refreshGlobalStrategyPolicy,
      updateBadCase,
      applyJobOverride,
      listBadCases: listBadCases2,
      isPrepReady
    };
  }
});

// src/server/auth.js
var require_auth = __commonJS({
  "src/server/auth.js"(exports2, module2) {
    var store = require_store();
    var logger2 = require_logger();
    var SESSION_COOKIE_NAME2 = process.env.SESSION_COOKIE_NAME || "applyflow_session";
    var SESSION_COOKIE_SAMESITE = process.env.SESSION_COOKIE_SAMESITE || "Lax";
    var SESSION_COOKIE_SECURE = String(process.env.SESSION_COOKIE_SECURE || "").toLowerCase() === "true" || true;
    function parseCookies(req) {
      const header = req.headers.cookie || "";
      return header.split(";").reduce((acc, entry) => {
        const [key, ...parts] = entry.trim().split("=");
        if (!key) return acc;
        acc[key] = decodeURIComponent(parts.join("="));
        return acc;
      }, {});
    }
    __name(parseCookies, "parseCookies");
    function getSessionCookie(req) {
      const cookies = parseCookies(req);
      return cookies[SESSION_COOKIE_NAME2] || null;
    }
    __name(getSessionCookie, "getSessionCookie");
    function resolveUserFromRequest(req) {
      const devUser = req.headers["x-dev-user"];
      if (devUser) {
        return store.findUserByLogin(String(devUser));
      }
      const sessionId = getSessionCookie(req);
      const session = store.getSession(sessionId);
      if (!session) return null;
      return store.getUser(session.userId) || null;
    }
    __name(resolveUserFromRequest, "resolveUserFromRequest");
    function getCurrentUser(req) {
      return resolveUserFromRequest(req);
    }
    __name(getCurrentUser, "getCurrentUser");
    function buildCookieHeader(sessionId, expiresAt) {
      const expires = new Date(expiresAt).toUTCString();
      const securePart = SESSION_COOKIE_SECURE ? "; Secure" : "";
      return `${SESSION_COOKIE_NAME2}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=${SESSION_COOKIE_SAMESITE}; Expires=${expires}${securePart}`;
    }
    __name(buildCookieHeader, "buildCookieHeader");
    function clearCookieHeader() {
      const securePart = SESSION_COOKIE_SECURE ? "; Secure" : "";
      return `${SESSION_COOKIE_NAME2}=; Path=/; HttpOnly; SameSite=${SESSION_COOKIE_SAMESITE}; Expires=Thu, 01 Jan 1970 00:00:00 GMT${securePart}`;
    }
    __name(clearCookieHeader, "clearCookieHeader");
    function issueSession(res, userId) {
      const session = store.createSession(userId);
      res.setHeader("Set-Cookie", buildCookieHeader(session.sessionId, session.expiresAt));
      logger2.info("auth.session_issued", {
        userId,
        sessionId: session.sessionId,
        secureCookie: SESSION_COOKIE_SECURE
      });
      return session;
    }
    __name(issueSession, "issueSession");
    function clearSession(req, res) {
      const sessionId = getSessionCookie(req);
      if (sessionId) {
        store.deleteSession(sessionId);
        logger2.info("auth.session_cleared", { sessionId });
      }
      res.setHeader("Set-Cookie", clearCookieHeader());
    }
    __name(clearSession, "clearSession");
    module2.exports = {
      SESSION_COOKIE_NAME: SESSION_COOKIE_NAME2,
      getCurrentUser,
      resolveUserFromRequest,
      issueSession,
      clearSession
    };
  }
});

// src/server/http/validation.js
var require_validation = __commonJS({
  "src/server/http/validation.js"(exports2, module2) {
    function assertObject(value, fieldName = "payload") {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        const error = new Error(`${fieldName} must be a JSON object.`);
        error.code = "VALIDATION_ERROR";
        throw error;
      }
    }
    __name(assertObject, "assertObject");
    function ensureString(value, fieldName, options = {}) {
      const min = options.min ?? 0;
      const max = options.max ?? 5e3;
      const allowEmpty = options.allowEmpty ?? false;
      const normalized = String(value ?? "").trim();
      if (!allowEmpty && normalized.length < min) {
        const error = new Error(`${fieldName} is required.`);
        error.code = "VALIDATION_ERROR";
        error.details = { field: fieldName };
        throw error;
      }
      if (normalized.length > max) {
        const error = new Error(`${fieldName} is too long.`);
        error.code = "VALIDATION_ERROR";
        error.details = { field: fieldName, max };
        throw error;
      }
      return normalized;
    }
    __name(ensureString, "ensureString");
    function ensureEnum(value, fieldName, allowedValues = []) {
      const normalized = String(value ?? "").trim();
      if (!allowedValues.includes(normalized)) {
        const error = new Error(`${fieldName} must be one of: ${allowedValues.join(", ")}.`);
        error.code = "VALIDATION_ERROR";
        error.details = { field: fieldName, allowedValues };
        throw error;
      }
      return normalized;
    }
    __name(ensureEnum, "ensureEnum");
    function sanitizeStringArray(value, options = {}) {
      const maxItems = options.maxItems ?? 20;
      const maxLength = options.maxLength ?? 200;
      if (!Array.isArray(value)) return [];
      return value.map((item) => String(item ?? "").trim()).filter(Boolean).map((item) => item.slice(0, maxLength)).slice(0, maxItems);
    }
    __name(sanitizeStringArray, "sanitizeStringArray");
    module2.exports = {
      assertObject,
      ensureString,
      ensureEnum,
      sanitizeStringArray
    };
  }
});

// src/server/routes/api.js
var require_api = __commonJS({
  "src/server/routes/api.js"(exports2, module2) {
    var store = require_store();
    var orchestrator = require_workflow_controller();
    var { getRequestContext: getRequestContext2 } = require_request_context();
    var { issueSession, clearSession } = require_auth();
    var logger2 = require_logger();
    var { assertObject, ensureEnum, ensureString } = require_validation();
    var ALLOWED_OVERRIDE_ACTIONS = ["force_proceed", "ignore_policy", "force_archive"];
    var ALLOWED_PROPOSAL_ACTIONS = ["approve", "reject", "revert"];
    var ALLOWED_PROFILE_TEXT_FIELDS = ["name", "background", "masterResume"];
    function sendJson(res, statusCode, payload) {
      res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(payload));
    }
    __name(sendJson, "sendJson");
    function success(res, data, statusCode = 200) {
      sendJson(res, statusCode, { success: true, data });
    }
    __name(success, "success");
    function failure(res, error, statusCode = 400) {
      sendJson(res, statusCode, {
        success: false,
        error: {
          code: error.code || "UNKNOWN_ERROR",
          message: error.message || "Unexpected error.",
          details: error.details || null
        }
      });
    }
    __name(failure, "failure");
    function sendDebugAuthError(res, error) {
      const context = getRequestContext2();
      const env = context.env || {};
      const stackPreview = String(error?.stack || "").split("\n").slice(0, 6);
      const bindingName = env.CLOUDFLARE_D1_BINDING || "APPLYFLOW_DB";
      const dbBinding = env?.[bindingName] || env?.APPLYFLOW_DB || env?.DB || null;
      sendJson(res, 500, {
        success: false,
        error: {
          code: error.code || "DEBUG_ROUTE_ERROR",
          message: error.message || "Unexpected auth debug error.",
          name: error.name || "Error",
          stackPreview,
          request: {
            method: context.method || null,
            path: context.pathname || null
          },
          runtime: {
            hasApplyflowDbBinding: Boolean(env?.APPLYFLOW_DB),
            hasDbBinding: Boolean(env?.DB),
            configuredD1BindingName: bindingName,
            hasConfiguredD1Binding: Boolean(dbBinding),
            hasSessionSecret: Boolean(env?.SESSION_SECRET)
          }
        }
      });
      return true;
    }
    __name(sendDebugAuthError, "sendDebugAuthError");
    function getCurrentUser() {
      const { userId } = getRequestContext2();
      if (!userId) return null;
      const user = store.getUser(userId);
      if (!user) return null;
      return user;
    }
    __name(getCurrentUser, "getCurrentUser");
    async function readJsonBody(req) {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      if (chunks.length === 0) {
        return {};
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        assertObject(parsed, "request body");
        return parsed;
      } catch (error) {
        if (error.code === "VALIDATION_ERROR") {
          throw error;
        }
        const parseError = new Error("Invalid JSON body.");
        parseError.code = "INVALID_JSON";
        throw parseError;
      }
    }
    __name(readJsonBody, "readJsonBody");
    function validateRequired(fields, body) {
      const missing = fields.filter((field) => !body[field]);
      if (missing.length > 0) {
        const error = new Error(`Missing required fields: ${missing.join(", ")}`);
        error.code = "VALIDATION_ERROR";
        error.details = { missing };
        throw error;
      }
    }
    __name(validateRequired, "validateRequired");
    async function handleApiRequest2(req, res, pathname) {
      try {
        if (req.method === "GET" && pathname === "/api/auth/session") {
          try {
            const { userId } = getRequestContext2();
            return success(res, {
              authenticated: Boolean(userId),
              user: userId ? store.getUser(userId) : null
            });
          } catch (error) {
            return sendDebugAuthError(res, error);
          }
        }
        if (req.method === "GET" && pathname === "/api/auth/users") {
          return success(res, {
            users: store.listUsers().map((user) => ({
              id: user.id,
              email: user.email,
              username: user.username,
              createdAt: user.createdAt
            }))
          });
        }
        if (req.method === "POST" && pathname === "/api/auth/login") {
          const body = await readJsonBody(req);
          validateRequired(["login"], body);
          ensureString(body.login, "login", { min: 1, max: 120 });
          const user = store.findUserByLogin(body.login);
          if (!user) {
            const error = new Error("User not found.");
            error.code = "AUTH_FAILED";
            throw error;
          }
          const session = issueSession(res, user.id);
          return success(res, { authenticated: true, user, sessionId: session.sessionId });
        }
        if (req.method === "POST" && pathname === "/api/login") {
          try {
            const body = await readJsonBody(req);
            validateRequired(["email"], body);
            ensureString(body.email, "email", { min: 3, max: 200 });
            const normalizedEmail = String(body.email).trim().toLowerCase();
            const username = normalizedEmail.split("@")[0] || normalizedEmail;
            const user = store.findUserByLogin(normalizedEmail) || store.ensureUser({
              email: normalizedEmail,
              username
            });
            const session = issueSession(res, user.id);
            return success(
              res,
              {
                authenticated: true,
                user,
                sessionId: session.sessionId
              },
              201
            );
          } catch (error) {
            return sendDebugAuthError(res, error);
          }
        }
        if (req.method === "POST" && pathname === "/api/auth/logout") {
          clearSession(req, res);
          return success(res, { authenticated: false });
        }
        const currentUser = getCurrentUser();
        if (!currentUser) {
          return failure(
            res,
            {
              code: "UNAUTHENTICATED",
              message: "Authentication required."
            },
            401
          );
        }
        if (req.method === "GET" && pathname === "/api/profile") {
          return success(res, { profile: store.getProfile() });
        }
        if (req.method === "POST" && pathname === "/api/profile/save") {
          const body = await readJsonBody(req);
          validateRequired(["name", "background", "masterResume"], body);
          ALLOWED_PROFILE_TEXT_FIELDS.forEach((field) => ensureString(body[field], field, { min: 1, max: 12e3 }));
          const profile = await orchestrator.saveProfile(body);
          return success(res, { profile });
        }
        if (req.method === "GET" && pathname === "/api/jobs") {
          return success(res, {
            jobs: store.listJobs(),
            fitAssessments: store.listFitAssessments()
          });
        }
        if (req.method === "POST" && pathname === "/api/jobs/ingest") {
          const body = await readJsonBody(req);
          if (body.rawJdText) ensureString(body.rawJdText, "rawJdText", { min: 1, max: 3e4 });
          if (body.company) ensureString(body.company, "company", { min: 1, max: 200 });
          if (body.title) ensureString(body.title, "title", { min: 1, max: 200 });
          if (body.location) ensureString(body.location, "location", { min: 1, max: 200 });
          const hasRawJd = Boolean(body.rawJdText || body.jdRaw);
          const hasManualMinimum = Boolean(body.company || body.title || body.location);
          if (!hasRawJd && !hasManualMinimum) {
            const error = new Error(
              "Provide either raw JD text or at least one manual field such as company, title, or location."
            );
            error.code = "VALIDATION_ERROR";
            throw error;
          }
          const result = await orchestrator.ingestJob(body);
          return success(res, result, 201);
        }
        if (req.method === "GET" && /^\/api\/jobs\/[^/]+$/.test(pathname)) {
          const jobId = pathname.split("/")[3];
          return success(res, await orchestrator.getJobDetail(jobId));
        }
        if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/evaluate$/.test(pathname)) {
          const jobId = pathname.split("/")[3];
          return success(res, await orchestrator.evaluateJob(jobId));
        }
        if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/prepare$/.test(pathname)) {
          const jobId = pathname.split("/")[3];
          return success(res, await orchestrator.prepareJobApplication(jobId));
        }
        if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/prep\/save$/.test(pathname)) {
          const jobId = pathname.split("/")[3];
          const body = await readJsonBody(req);
          return success(res, await orchestrator.saveApplicationPrep(jobId, body));
        }
        if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/status$/.test(pathname)) {
          const jobId = pathname.split("/")[3];
          const body = await readJsonBody(req);
          validateRequired(["nextStatus"], body);
          ensureString(body.nextStatus, "nextStatus", { min: 1, max: 64 });
          return success(res, await orchestrator.transitionJobStatus(jobId, body.nextStatus));
        }
        if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/badcase$/.test(pathname)) {
          const jobId = pathname.split("/")[3];
          const body = await readJsonBody(req);
          return success(res, { badCase: await orchestrator.updateBadCase(jobId, body) });
        }
        if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/override$/.test(pathname)) {
          const jobId = pathname.split("/")[3];
          const body = await readJsonBody(req);
          validateRequired(["action"], body);
          ensureEnum(body.action, "action", ALLOWED_OVERRIDE_ACTIONS);
          if (body.reason) ensureString(body.reason, "reason", { min: 0, max: 400, allowEmpty: true });
          return success(res, { job: await orchestrator.applyJobOverride(jobId, body) });
        }
        if (req.method === "POST" && pathname === "/api/interviews/reflect") {
          const body = await readJsonBody(req);
          validateRequired(["jobId", "roundName", "interviewDate"], body);
          const reflection = await orchestrator.reflectInterview(body);
          return success(res, { reflection }, 201);
        }
        if (req.method === "GET" && pathname === "/api/dashboard/summary") {
          return success(res, await orchestrator.getDashboardSummary());
        }
        if (req.method === "GET" && pathname === "/api/metrics/summary") {
          return success(res, await orchestrator.getMetricsSummary());
        }
        if (req.method === "GET" && pathname === "/api/badcases") {
          return success(res, { badCases: await orchestrator.listBadCases() });
        }
        if (req.method === "GET" && pathname === "/api/strategy/insights") {
          return success(res, await orchestrator.getStrategyInsights());
        }
        if (req.method === "GET" && pathname === "/api/policy/history") {
          return success(res, { history: await orchestrator.getPolicyHistory() });
        }
        if (req.method === "GET" && pathname === "/api/policy/current") {
          return success(res, {
            policy: await orchestrator.getCurrentPolicy(),
            auditLogs: await orchestrator.listPolicyAuditHistory()
          });
        }
        if (req.method === "GET" && pathname === "/api/policy/proposals") {
          return success(res, {
            proposals: await orchestrator.listPolicyProposals(),
            auditLogs: await orchestrator.listPolicyAuditHistory()
          });
        }
        if (req.method === "POST" && /^\/api\/policy\/proposals\/[^/]+\/approve$/.test(pathname)) {
          const proposalId = pathname.split("/")[4];
          const body = await readJsonBody(req);
          if (body.reviewerNote) ensureString(body.reviewerNote, "reviewerNote", { min: 0, max: 500, allowEmpty: true });
          logger2.info("policy.action_requested", { action: ALLOWED_PROPOSAL_ACTIONS[0], proposalId });
          return success(res, await orchestrator.approvePolicyProposal(proposalId, body.reviewerNote || ""));
        }
        if (req.method === "POST" && /^\/api\/policy\/proposals\/[^/]+\/reject$/.test(pathname)) {
          const proposalId = pathname.split("/")[4];
          const body = await readJsonBody(req);
          if (body.reviewerNote) ensureString(body.reviewerNote, "reviewerNote", { min: 0, max: 500, allowEmpty: true });
          logger2.info("policy.action_requested", { action: ALLOWED_PROPOSAL_ACTIONS[1], proposalId });
          return success(res, { proposal: await orchestrator.rejectPolicyProposal(proposalId, body.reviewerNote || "") });
        }
        if (req.method === "POST" && pathname === "/api/policy/revert") {
          logger2.info("policy.action_requested", { action: ALLOWED_PROPOSAL_ACTIONS[2] });
          return success(res, { policy: await orchestrator.revertCurrentPolicy() });
        }
        return false;
      } catch (error) {
        logger2.error("api.error", {
          pathname,
          method: req.method,
          errorCode: error.code || "UNKNOWN_ERROR",
          message: error.message
        });
        const statusCode = error.code === "NOT_FOUND" ? 404 : error.code === "UNAUTHENTICATED" ? 401 : error.code === "AUTH_FAILED" ? 403 : 400;
        const safeError = statusCode >= 500 ? { code: "INTERNAL_ERROR", message: "Something went wrong on the server. Please try again." } : error;
        failure(res, safeError, statusCode);
        return true;
      }
    }
    __name(handleApiRequest2, "handleApiRequest");
    module2.exports = { handleApiRequest: handleApiRequest2 };
  }
});

// src/server/db/d1-runtime-store.js
var require_d1_runtime_store = __commonJS({
  "src/server/db/d1-runtime-store.js"(exports2, module2) {
    var { createId } = require_id();
    var WORKSPACE_TABLES = [
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
    __name(parseCookies, "parseCookies");
    async function selectJsonRows(db, sql, params = []) {
      const result = await db.prepare(sql).bind(...params).all();
      return (result.results || []).map((row) => JSON.parse(row.json_text));
    }
    __name(selectJsonRows, "selectJsonRows");
    async function selectJsonRow(db, sql, params = []) {
      const row = await db.prepare(sql).bind(...params).first();
      return row ? JSON.parse(row.json_text) : null;
    }
    __name(selectJsonRow, "selectJsonRow");
    async function loadUsers(db) {
      return selectJsonRows(db, "SELECT json_text FROM users ORDER BY created_at ASC");
    }
    __name(loadUsers, "loadUsers");
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
    __name(getWorkerDbOrThrow, "getWorkerDbOrThrow");
    async function loadSessionById(db, sessionId) {
      if (!sessionId) return null;
      return selectJsonRow(db, "SELECT json_text FROM sessions WHERE session_id = ?", [sessionId]);
    }
    __name(loadSessionById, "loadSessionById");
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
    __name(loadWorkspaceState, "loadWorkspaceState");
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
          db.prepare("INSERT INTO profiles (user_id, updated_at, json_text) VALUES (?, ?, ?)").bind(userId, workspaceState.profile.updatedAt || workspaceState.profile.createdAt || (/* @__PURE__ */ new Date()).toISOString(), JSON.stringify(workspaceState.profile))
        );
      }
      if (workspaceState.strategyProfile) {
        statements.push(
          db.prepare("INSERT INTO strategy_profiles (user_id, updated_at, json_text) VALUES (?, ?, ?)").bind(userId, workspaceState.strategyProfile.updatedAt || workspaceState.strategyProfile.createdAt || (/* @__PURE__ */ new Date()).toISOString(), JSON.stringify(workspaceState.strategyProfile))
        );
      }
      if (workspaceState.globalStrategyPolicy) {
        statements.push(
          db.prepare("INSERT INTO global_policies (user_id, updated_at, json_text) VALUES (?, ?, ?)").bind(userId, workspaceState.globalStrategyPolicy.updatedAt || workspaceState.globalStrategyPolicy.createdAt || (/* @__PURE__ */ new Date()).toISOString(), JSON.stringify(workspaceState.globalStrategyPolicy))
        );
      }
      WORKSPACE_TABLES.forEach(({ key, table, idField, timeField, extraFields }) => {
        (workspaceState[key] || []).forEach((item) => {
          const columns = [idField, "user_id", ...extraFields, timeField, "json_text"];
          const values = [
            item[idField] || createId(table),
            userId,
            ...extraFields.map((field) => item[field] || null),
            item.updatedAt || item.timestamp || item.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
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
    __name(persistWorkspaceState, "persistWorkspaceState");
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
    __name(createArrayStore, "createArrayStore");
    async function createWorkerOverrideStore2({ env, request, resolvedUserId = null }) {
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
        deletedSessionIds: /* @__PURE__ */ new Set()
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
      const markDirty = /* @__PURE__ */ __name(() => {
        workspaceState.dirty = true;
      }, "markDirty");
      function listUsersLocal() {
        return userState.list;
      }
      __name(listUsersLocal, "listUsersLocal");
      function getUser2(userId) {
        return userState.list.find((user) => user.id === userId) || null;
      }
      __name(getUser2, "getUser");
      function findUserByLogin2(login) {
        const normalized = String(login || "").trim().toLowerCase();
        return userState.list.find((user) => {
          return String(user.email || "").toLowerCase() === normalized || String(user.username || "").toLowerCase() === normalized || String(user.id || "").toLowerCase() === normalized;
        }) || null;
      }
      __name(findUserByLogin2, "findUserByLogin");
      function ensureUser2({ email, username }) {
        const existing = findUserByLogin2(email || username);
        if (existing) return existing;
        const user = {
          id: `user_${Math.random().toString(36).slice(2, 10)}`,
          email: email || username,
          username: username || email,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        userState.list.push(user);
        userState.createdUsers.push(user);
        return user;
      }
      __name(ensureUser2, "ensureUser");
      const overrideStore = {
        listUsers: listUsersLocal,
        getUser: getUser2,
        findUserByLogin: findUserByLogin2,
        ensureUser: ensureUser2,
        getState() {
          return {
            users: userState.list,
            sessions: [
              ...sessionState.currentSession ? [sessionState.currentSession] : [],
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
              ...sessionState.currentSession ? [sessionState.currentSession] : [],
              ...sessionState.createdSessions
            ].filter((session) => session.userId === userId),
            ...workspaceState
          };
        },
        createSession(userId) {
          const ttl = Number(env.SESSION_TTL_MS || 1e3 * 60 * 60 * 24 * 14);
          const session = {
            sessionId: `sess_${Math.random().toString(36).slice(2, 10)}`,
            userId,
            createdAt: (/* @__PURE__ */ new Date()).toISOString(),
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
            timestamp: log.timestamp || log.createdAt || (/* @__PURE__ */ new Date()).toISOString()
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
              [...sessionState.deletedSessionIds].map(
                (targetSessionId) => db.prepare("DELETE FROM sessions WHERE session_id = ?").bind(targetSessionId)
              )
            );
          }
          if (sessionState.createdSessions.length > 0) {
            const createStatements = [];
            sessionState.createdSessions.forEach((session) => {
              createStatements.push(db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(session.userId));
              createStatements.push(
                db.prepare("INSERT INTO sessions (session_id, user_id, created_at, expires_at, json_text) VALUES (?, ?, ?, ?, ?)").bind(session.sessionId, session.userId, session.createdAt, session.expiresAt, JSON.stringify(session))
              );
            });
            await db.batch(createStatements);
          }
          if (userState.createdUsers.length > 0) {
            await db.batch(
              userState.createdUsers.map(
                (user) => db.prepare("INSERT OR REPLACE INTO users (id, email, username, created_at, json_text) VALUES (?, ?, ?, ?, ?)").bind(user.id, user.email || null, user.username || null, user.createdAt, JSON.stringify(user))
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
    __name(createWorkerOverrideStore2, "createWorkerOverrideStore");
    module2.exports = {
      createWorkerOverrideStore: createWorkerOverrideStore2,
      parseCookies,
      loadUsers,
      loadSessionById,
      loadWorkspaceState,
      persistWorkspaceState
    };
  }
});

// cloudflare/worker-entry.js
var import_api = __toESM(require_api());
var import_request_context = __toESM(require_request_context());
var import_auth = __toESM(require_auth());
var import_logger = __toESM(require_logger());
var import_d1_runtime_store = __toESM(require_d1_runtime_store());
var { handleApiRequest } = import_api.default;
var { runWithRequestContext } = import_request_context.default;
var { SESSION_COOKIE_NAME } = import_auth.default;
var logger = import_logger.default;
var { createWorkerOverrideStore } = import_d1_runtime_store.default;
function createDebugErrorResponse({ error, env, request, pathname }) {
  const stackPreview = String(error?.stack || "").split("\n").slice(0, 6);
  const bindingName = env?.CLOUDFLARE_D1_BINDING || "APPLYFLOW_DB";
  const dbBinding = env?.[bindingName] || env?.APPLYFLOW_DB || env?.DB || null;
  return new Response(
    JSON.stringify(
      {
        success: false,
        error: {
          code: "DEBUG_ROUTE_ERROR",
          message: error?.message || "Unknown worker error.",
          name: error?.name || "Error",
          stackPreview,
          request: {
            method: request.method,
            path: pathname
          },
          runtime: {
            hasApplyflowDbBinding: Boolean(env?.APPLYFLOW_DB),
            hasDbBinding: Boolean(env?.DB),
            configuredD1BindingName: bindingName,
            hasConfiguredD1Binding: Boolean(dbBinding),
            hasSessionSecret: Boolean(env?.SESSION_SECRET)
          }
        }
      },
      null,
      2
    ),
    {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" }
    }
  );
}
__name(createDebugErrorResponse, "createDebugErrorResponse");
var FetchRequestShim = class {
  static {
    __name(this, "FetchRequestShim");
  }
  constructor(request) {
    this.method = request.method;
    this.url = request.url;
    this.rawRequest = request;
    this.headers = {};
    request.headers.forEach((value, key) => {
      this.headers[key.toLowerCase()] = value;
    });
  }
  async *[Symbol.asyncIterator]() {
    const buffer = await this.rawRequest.arrayBuffer();
    if (buffer.byteLength > 0) {
      yield Buffer.from(buffer);
    }
  }
};
var FetchResponseShim = class {
  static {
    __name(this, "FetchResponseShim");
  }
  constructor() {
    this.statusCode = 200;
    this.headers = new Headers();
    this.body = "";
    this.finished = false;
    this.finishListeners = [];
  }
  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    Object.entries(headers).forEach(([key, value]) => {
      this.headers.set(key, value);
    });
  }
  setHeader(key, value) {
    if (Array.isArray(value)) {
      value.forEach((entry) => this.headers.append(key, entry));
      return;
    }
    if (key.toLowerCase() === "set-cookie") {
      this.headers.append(key, value);
      return;
    }
    this.headers.set(key, value);
  }
  on(event, listener) {
    if (event === "finish") {
      this.finishListeners.push(listener);
    }
  }
  end(body = "") {
    this.body = body;
    this.finished = true;
    this.finishListeners.forEach((listener) => listener());
  }
  toResponse() {
    return new Response(this.body, {
      status: this.statusCode,
      headers: this.headers
    });
  }
};
async function handleApiFetch(request, env) {
  const requestUrl = new URL(request.url);
  const pathname = requestUrl.pathname;
  try {
    const workerState = await createWorkerOverrideStore({ env, request });
    const reqShim = new FetchRequestShim(request);
    const resShim = new FetchResponseShim();
    const currentUser = workerState.currentSession?.userId ? workerState.users.find((user) => user.id === workerState.currentSession.userId) : null;
    const handled = await runWithRequestContext(
      {
        userId: currentUser?.id || null,
        overrideStore: workerState.overrideStore,
        env,
        pathname,
        method: request.method
      },
      () => handleApiRequest(reqShim, resShim, pathname)
    );
    if (handled === false) {
      resShim.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      resShim.end(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "API route not found." } }));
    }
    await workerState.overrideStore.flush();
    return resShim.toResponse();
  } catch (error) {
    if (pathname === "/api/login" || pathname === "/api/auth/session") {
      return createDebugErrorResponse({ error, env, request, pathname });
    }
    throw error;
  }
}
__name(handleApiFetch, "handleApiFetch");
async function handleAssetFetch(request, env) {
  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status !== 404) {
    return assetResponse;
  }
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return new Response("Not found", { status: 404 });
  }
  return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
}
__name(handleAssetFetch, "handleAssetFetch");
var worker_entry_default = {
  async fetch(request, env, ctx) {
    const startedAt = Date.now();
    const pathname = new URL(request.url).pathname;
    try {
      if (pathname.startsWith("/api/")) {
        const response2 = await handleApiFetch(request, env, ctx);
        logger.info("worker.request", {
          pathname,
          method: request.method,
          statusCode: response2.status,
          durationMs: Date.now() - startedAt,
          runtime: "cloudflare"
        });
        return response2;
      }
      const response = await handleAssetFetch(request, env, ctx);
      logger.info("worker.asset_request", {
        pathname,
        method: request.method,
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
        runtime: "cloudflare"
      });
      return response;
    } catch (error) {
      logger.error("worker.error", {
        pathname,
        method: request.method,
        message: error.message
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "WORKER_RUNTIME_ERROR",
            message: "The Cloudflare worker failed to process the request."
          }
        }),
        {
          status: 500,
          headers: { "content-type": "application/json; charset=utf-8" }
        }
      );
    }
  }
};
export {
  worker_entry_default as default
};
//# sourceMappingURL=worker-entry.js.map
