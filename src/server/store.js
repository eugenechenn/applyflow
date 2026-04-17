const { getRequestContext } = require("./request-context");
const { getRuntimeConfig } = require("./platform/runtime");

function runtimeRequire(modulePath) {
  return eval("require")(modulePath);
}

function getRepository() {
  return runtimeRequire("./repositories/applyflow-repository");
}

function getSqliteMeta() {
  return runtimeRequire("./db/sqlite");
}

const runtime = getRuntimeConfig();
const nodeRepository = runtime.isCloudflareRuntime ? null : getRepository();
const sqliteMeta = runtime.isCloudflareRuntime ? { dataDir: null, sqliteFilePath: null } : getSqliteMeta();

const DEFAULT_USER_ID = nodeRepository?.DEFAULT_USER_ID || "user_a";
const storeFilePath = nodeRepository?.storeFilePath || null;
const migrationStatus = nodeRepository ? nodeRepository.migrateJsonStateIfNeeded() : { migrated: false, source: "worker" };

function nowIso() {
  return new Date().toISOString();
}

function trimText(value, max) {
  const text = String(value || "");
  return text.length > max ? text.slice(0, max) : text;
}

function containsPdfGarbage(value = "") {
  const text = String(value || "");
  return /%PDF-|^\d+ \d+ obj$|endobj|xref|trailer|\/Type\s*\/Catalog|<x:xmpmeta|<rdf:RDF/im.test(text);
}

function sanitizeResumeText(value = "", max = 10000) {
  const text = trimText(value, max)
    .replace(/%PDF-[\s\S]*/g, "")
    .replace(/^\d+ \d+ obj$/gim, "")
    .replace(/^endobj$/gim, "")
    .replace(/^xref$/gim, "")
    .replace(/^trailer$/gim, "")
    .replace(/\/Type\s*\/Catalog/gi, "")
    .replace(/<x:xmpmeta[\s\S]*$/gi, "")
    .replace(/<rdf:RDF[\s\S]*$/gi, "")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? text.slice(0, max) : text;
}

function sanitizeResumeDocument(resumeDocument = {}) {
  const structuredProfile = resumeDocument.structuredProfile || {};
  const extractionMethod = String(resumeDocument.extractionMethod || "");
  const parseStatus = String(resumeDocument.parseStatus || resumeDocument.status || "");
  const incomingRawText = sanitizeResumeText(resumeDocument.rawText, 10000);
  const incomingCleanedText = sanitizeResumeText(resumeDocument.cleanedText, 10000);
  const incomingSummary = sanitizeResumeText(resumeDocument.summary, 2000);
  const lowQualityFallback =
    extractionMethod === "fallback_text" ||
    parseStatus === "parse_failed" ||
    (containsPdfGarbage(incomingRawText) && parseStatus !== "parse_success");

  const safeStructuredProfile = {
    ...structuredProfile,
    summary: lowQualityFallback
      ? ""
      : sanitizeResumeText(structuredProfile.summary, 2000),
    experience: Array.isArray(structuredProfile.experience) ? structuredProfile.experience.slice(0, 12).map((item) => trimText(item, 280)) : [],
    projects: Array.isArray(structuredProfile.projects) ? structuredProfile.projects.slice(0, 10).map((item) => trimText(item, 240)) : [],
    skills: Array.isArray(structuredProfile.skills) ? structuredProfile.skills.slice(0, 20).map((item) => trimText(item, 80)) : [],
    education: Array.isArray(structuredProfile.education) ? structuredProfile.education.slice(0, 8).map((item) => trimText(item, 180)) : [],
    achievements: Array.isArray(structuredProfile.achievements) ? structuredProfile.achievements.slice(0, 10).map((item) => trimText(item, 180)) : [],
    certifications: Array.isArray(structuredProfile.certifications) ? structuredProfile.certifications.slice(0, 10).map((item) => trimText(item, 140)) : [],
    sections: Array.isArray(structuredProfile.sections)
      ? structuredProfile.sections.slice(0, 12).map((section) => ({
          key: section?.key || "section",
          heading: trimText(section?.heading, 80),
          content: trimText(section?.content, 600)
        }))
      : []
  };

  return {
    ...resumeDocument,
    rawText: lowQualityFallback ? "" : incomingRawText,
    cleanedText: lowQualityFallback ? incomingCleanedText.slice(0, 400) : incomingCleanedText,
    summary: lowQualityFallback
      ? (incomingCleanedText.slice(0, 200) || "自动解析质量不足，建议上传 DOCX 或手动补充。")
      : incomingSummary,
    parseWarning:
      resumeDocument.parseWarning ||
      (lowQualityFallback ? "自动解析质量不足，建议上传 DOCX 或手动补充关键信息。" : ""),
    structuredProfile: safeStructuredProfile
  };
}

function getActiveUserId() {
  return getRequestContext().userId || DEFAULT_USER_ID;
}

function getOverrideStore() {
  return getRequestContext().overrideStore || null;
}

function getState() {
  const override = getOverrideStore();
  if (override?.getState) return override.getState();
  return {
    users: listUsers(),
    sessions: getRepository().listSessions(),
    ...getRepository().getWorkspaceState(getActiveUserId())
  };
}

function getStateForUser(userId) {
  const override = getOverrideStore();
  if (override?.getStateForUser) return override.getStateForUser(userId);
  return {
    users: listUsers(),
    sessions: getRepository().listSessions().filter((session) => session.userId === userId),
    ...getRepository().getWorkspaceState(userId)
  };
}

function listUsers() {
  const override = getOverrideStore();
  if (override?.listUsers) return override.listUsers();
  return getRepository().listUsers();
}

function getUser(userId) {
  const override = getOverrideStore();
  if (override?.getUser) return override.getUser(userId);
  return getRepository().getUser(userId);
}

function findUserByLogin(login) {
  const override = getOverrideStore();
  if (override?.findUserByLogin) return override.findUserByLogin(login);
  return getRepository().findUserByLogin(login);
}

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

function createSession(userId) {
  const override = getOverrideStore();
  if (override?.createSession) return override.createSession(userId);
  const ttl = Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 14);
  const session = {
    sessionId: `sess_${Math.random().toString(36).slice(2, 10)}`,
    userId,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + ttl).toISOString()
  };
  getRepository().deleteSessionsByUserId(userId);
  return getRepository().saveSession(session);
}

function getSession(sessionId) {
  const override = getOverrideStore();
  if (override?.getSession) return override.getSession(sessionId);
  if (!sessionId) return null;
  const session = getRepository().getSession(sessionId);
  if (!session) return null;
  if (session.expiresAt && new Date(session.expiresAt) <= new Date()) {
    deleteSession(sessionId);
    return null;
  }
  return session;
}

function deleteSession(sessionId) {
  const override = getOverrideStore();
  if (override?.deleteSession) return override.deleteSession(sessionId);
  getRepository().deleteSession(sessionId);
}

function getProfile() {
  const override = getOverrideStore();
  if (override?.getProfile) return override.getProfile();
  return getRepository().getProfile(getActiveUserId());
}

function saveProfile(profile) {
  const override = getOverrideStore();
  if (override?.saveProfile) return override.saveProfile(profile);
  return getRepository().saveProfile(getActiveUserId(), { ...profile, userId: getActiveUserId() });
}

function listResumeDocuments() {
  const override = getOverrideStore();
  if (override?.listResumeDocuments) return override.listResumeDocuments();
  return getRepository().listResumeDocuments(getActiveUserId()).map((resumeDocument) => sanitizeResumeDocument(resumeDocument));
}

function getResumeDocument(resumeId) {
  const override = getOverrideStore();
  if (override?.getResumeDocument) return override.getResumeDocument(resumeId);
  const resumeDocument = getRepository().getResumeDocument(getActiveUserId(), resumeId);
  return resumeDocument ? sanitizeResumeDocument(resumeDocument) : null;
}

function getLatestResumeDocument() {
  const override = getOverrideStore();
  if (override?.getLatestResumeDocument) return override.getLatestResumeDocument();
  const resumeDocument = getRepository().getLatestResumeDocument(getActiveUserId());
  return resumeDocument ? sanitizeResumeDocument(resumeDocument) : null;
}

function saveResumeDocument(resumeDocument) {
  const override = getOverrideStore();
  if (override?.saveResumeDocument) return override.saveResumeDocument(resumeDocument);
  return getRepository().saveResumeDocument(getActiveUserId(), {
    ...sanitizeResumeDocument(resumeDocument),
    userId: getActiveUserId()
  });
}

function getStrategyProfile() {
  const override = getOverrideStore();
  if (override?.getStrategyProfile) return override.getStrategyProfile();
  return getRepository().getStrategyProfile(getActiveUserId());
}

function saveStrategyProfile(strategyProfile) {
  const override = getOverrideStore();
  if (override?.saveStrategyProfile) return override.saveStrategyProfile(strategyProfile);
  return getRepository().saveStrategyProfile(getActiveUserId(), { ...strategyProfile, userId: getActiveUserId() });
}

function getGlobalStrategyPolicy() {
  const override = getOverrideStore();
  if (override?.getGlobalStrategyPolicy) return override.getGlobalStrategyPolicy();
  return getRepository().getGlobalStrategyPolicy(getActiveUserId());
}

function saveGlobalStrategyPolicy(globalStrategyPolicy) {
  const override = getOverrideStore();
  if (override?.saveGlobalStrategyPolicy) return override.saveGlobalStrategyPolicy(globalStrategyPolicy);
  return getRepository().saveGlobalStrategyPolicy(getActiveUserId(), {
    ...globalStrategyPolicy,
    userId: getActiveUserId()
  });
}

function listPolicyHistory() {
  const override = getOverrideStore();
  if (override?.listPolicyHistory) return override.listPolicyHistory();
  return getRepository().listPolicyHistory(getActiveUserId());
}

function savePolicyHistoryEntry(entry) {
  const override = getOverrideStore();
  if (override?.savePolicyHistoryEntry) return override.savePolicyHistoryEntry(entry);
  return getRepository().savePolicyHistoryEntry(getActiveUserId(), { ...entry, userId: getActiveUserId() });
}

function listPolicyProposals() {
  const override = getOverrideStore();
  if (override?.listPolicyProposals) return override.listPolicyProposals();
  return getRepository().listPolicyProposals(getActiveUserId());
}

function getPolicyProposal(proposalId) {
  const override = getOverrideStore();
  if (override?.getPolicyProposal) return override.getPolicyProposal(proposalId);
  return getRepository().getPolicyProposal(getActiveUserId(), proposalId);
}

function savePolicyProposal(proposal) {
  const override = getOverrideStore();
  if (override?.savePolicyProposal) return override.savePolicyProposal(proposal);
  return getRepository().savePolicyProposal(getActiveUserId(), { ...proposal, userId: getActiveUserId() });
}

function listPolicyAuditLogs() {
  const override = getOverrideStore();
  if (override?.listPolicyAuditLogs) return override.listPolicyAuditLogs();
  return getRepository().listPolicyAuditLogs(getActiveUserId());
}

function savePolicyAuditLog(entry) {
  const override = getOverrideStore();
  if (override?.savePolicyAuditLog) return override.savePolicyAuditLog(entry);
  return getRepository().savePolicyAuditLog(getActiveUserId(), { ...entry, userId: getActiveUserId() });
}

function listJobs() {
  const override = getOverrideStore();
  if (override?.listJobs) return override.listJobs();
  return getRepository().listJobs(getActiveUserId());
}

function getJob(jobId) {
  const override = getOverrideStore();
  if (override?.getJob) return override.getJob(jobId);
  return getRepository().getJob(getActiveUserId(), jobId);
}

function saveJob(job) {
  const override = getOverrideStore();
  if (override?.saveJob) return override.saveJob(job);
  return getRepository().saveJob(getActiveUserId(), { ...job, userId: getActiveUserId() });
}

function listFitAssessments() {
  const override = getOverrideStore();
  if (override?.listFitAssessments) return override.listFitAssessments();
  return getRepository().listFitAssessments(getActiveUserId());
}

function getFitAssessmentByJobId(jobId) {
  const override = getOverrideStore();
  if (override?.getFitAssessmentByJobId) return override.getFitAssessmentByJobId(jobId);
  return getRepository().getFitAssessmentByJobId(getActiveUserId(), jobId);
}

function saveFitAssessment(assessment) {
  const override = getOverrideStore();
  if (override?.saveFitAssessment) return override.saveFitAssessment(assessment);
  return getRepository().saveFitAssessment(getActiveUserId(), { ...assessment, userId: getActiveUserId() });
}

function getApplicationPrepByJobId(jobId) {
  const override = getOverrideStore();
  if (override?.getApplicationPrepByJobId) return override.getApplicationPrepByJobId(jobId);
  return getRepository().getApplicationPrepByJobId(getActiveUserId(), jobId);
}

function saveApplicationPrep(prep) {
  const override = getOverrideStore();
  if (override?.saveApplicationPrep) return override.saveApplicationPrep(prep);
  return getRepository().saveApplicationPrep(getActiveUserId(), { ...prep, userId: getActiveUserId() });
}

function listTailoringOutputs() {
  const override = getOverrideStore();
  if (override?.listTailoringOutputs) return override.listTailoringOutputs();
  return getRepository().listTailoringOutputs(getActiveUserId());
}

function getTailoringOutputByJobId(jobId) {
  const override = getOverrideStore();
  if (override?.getTailoringOutputByJobId) return override.getTailoringOutputByJobId(jobId);
  return getRepository().getTailoringOutputByJobId(getActiveUserId(), jobId);
}

function saveTailoringOutput(output) {
  const override = getOverrideStore();
  if (override?.saveTailoringOutput) return override.saveTailoringOutput(output);
  return getRepository().saveTailoringOutput(getActiveUserId(), { ...output, userId: getActiveUserId() });
}

function listTasksByJobId(jobId) {
  const override = getOverrideStore();
  if (override?.listTasksByJobId) return override.listTasksByJobId(jobId);
  return getRepository().listTasksByJobId(getActiveUserId(), jobId);
}

function listTasks() {
  const override = getOverrideStore();
  if (override?.listTasks) return override.listTasks();
  return getRepository().listTasks(getActiveUserId());
}

function saveTask(task) {
  const override = getOverrideStore();
  if (override?.saveTask) return override.saveTask(task);
  return getRepository().saveTask(getActiveUserId(), { ...task, userId: getActiveUserId() });
}

function getInterviewReflectionByJobId(jobId) {
  const override = getOverrideStore();
  if (override?.getInterviewReflectionByJobId) return override.getInterviewReflectionByJobId(jobId);
  return getRepository().getInterviewReflectionByJobId(getActiveUserId(), jobId);
}

function saveInterviewReflection(reflection) {
  const override = getOverrideStore();
  if (override?.saveInterviewReflection) return override.saveInterviewReflection(reflection);
  return getRepository().saveInterviewReflection(getActiveUserId(), { ...reflection, userId: getActiveUserId() });
}

function listActivityLogsByJobId(jobId) {
  const override = getOverrideStore();
  if (override?.listActivityLogsByJobId) return override.listActivityLogsByJobId(jobId);
  return getRepository().listActivityLogsByJobId(getActiveUserId(), jobId);
}

function listActivityLogs() {
  const override = getOverrideStore();
  if (override?.listActivityLogs) return override.listActivityLogs();
  return getRepository().listActivityLogs(getActiveUserId());
}

function saveActivityLog(log) {
  const override = getOverrideStore();
  if (override?.saveActivityLog) return override.saveActivityLog(log);
  return getRepository().saveActivityLog(getActiveUserId(), { ...log, userId: getActiveUserId() });
}

function listBadCases() {
  const override = getOverrideStore();
  if (override?.listBadCases) return override.listBadCases();
  return getRepository().listBadCases(getActiveUserId());
}

function getBadCaseByJobId(jobId) {
  const override = getOverrideStore();
  if (override?.getBadCaseByJobId) return override.getBadCaseByJobId(jobId);
  return getRepository().getBadCaseByJobId(getActiveUserId(), jobId);
}

function saveBadCase(badCase) {
  const override = getOverrideStore();
  if (override?.saveBadCase) return override.saveBadCase(badCase);
  return getRepository().saveBadCase(getActiveUserId(), { ...badCase, userId: getActiveUserId() });
}

function removeBadCase(jobId) {
  const override = getOverrideStore();
  if (override?.removeBadCase) return override.removeBadCase(jobId);
  return getRepository().removeBadCase(getActiveUserId(), jobId);
}

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
  listResumeDocuments,
  getResumeDocument,
  getLatestResumeDocument,
  saveResumeDocument,
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
  listTailoringOutputs,
  getTailoringOutputByJobId,
  saveTailoringOutput,
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
