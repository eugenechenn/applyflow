const store = require("../store");
const orchestrator = require("../../lib/orchestrator/workflow-controller");
const { getRequestContext } = require("../request-context");
const { issueSession, clearSession } = require("../auth");
const logger = require("../platform/logger");
const { assertObject, ensureEnum, ensureString } = require("../http/validation");

const ALLOWED_OVERRIDE_ACTIONS = ["force_proceed", "ignore_policy", "force_archive"];
const ALLOWED_PROPOSAL_ACTIONS = ["approve", "reject", "revert"];
const ALLOWED_PROFILE_TEXT_FIELDS = ["name", "background"];
const ALLOWED_TRACKER_STATES = ["none", "saved", "prep", "tailored", "applied", "interview", "rejected", "offer"];
const ALLOWED_FEEDBACK_STATES = ["none", "good_fit", "bad_fit", "misclassified"];
const ALLOWED_SHORTLIST_STATES = ["none", "shortlisted"];
const ALLOWED_RESUME_MATERIAL_STATES = ["none", "draft", "tailored", "finalized"];
const ALLOWED_COVER_LETTER_MATERIAL_STATES = ["none", "draft", "tailored", "finalized"];
const ALLOWED_INTERVIEW_PREP_MATERIAL_STATES = ["none", "draft", "ready"];
const ALLOWED_SUBMISSION_AUDIT_STATUSES = ["none", "ready", "submitted", "failed", "needs_review"];
const ALLOWED_SUBMISSION_AUDIT_SOURCES = ["manual", "plugin", "system"];
const ALLOWED_FOLLOW_UP_STATUSES = ["none", "planned", "done", "skipped"];
const ALLOWED_FOLLOW_UP_CHANNELS = ["email", "phone", "linkedin", "other"];

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function success(res, data, statusCode = 200) {
  sendJson(res, statusCode, { success: true, data });
}

function sendBinary(res, statusCode, buffer, headers = {}) {
  res.writeHead(statusCode, headers);
  res.end(buffer);
}

function buildExportSummaryHeader(exported = {}) {
  const contract = exported.exportContract || {};
  const summary = {
    exportId: contract.exportId || "",
    jobId: contract.jobId || "",
    tailoredResumeId: contract.tailoredResumeId || "",
    exportFormat: contract.exportFormat || "",
    exportStatus: contract.exportStatus || "",
    artifactName: contract.artifactName || exported.fileName || "",
    artifactMeta: contract.artifactMeta || {},
    warnings: Array.isArray(contract.warnings) ? contract.warnings : [],
    errors: Array.isArray(contract.errors) ? contract.errors : [],
    trace: contract.trace || {}
  };
  return encodeURIComponent(JSON.stringify(summary));
}

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

function sendDebugAuthError(res, error) {
  const context = getRequestContext();
  const env = context.env || {};
  const stackPreview = String(error?.stack || "")
    .split("\n")
    .slice(0, 6);
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

function getCurrentUser() {
  const { userId } = getRequestContext();
  if (!userId) return null;
  const user = store.getUser(userId);
  if (!user) return null;
  return user;
}

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

function validateRequired(fields, body) {
  const missing = fields.filter((field) => !body[field]);
  if (missing.length > 0) {
    const error = new Error(`Missing required fields: ${missing.join(", ")}`);
    error.code = "VALIDATION_ERROR";
    error.details = { missing };
    throw error;
  }
}

async function handleApiRequest(req, res, pathname) {
  try {
    if (req.method === "GET" && pathname === "/api/auth/session") {
      try {
        const { userId } = getRequestContext();
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
        const user =
          store.findUserByLogin(normalizedEmail) ||
          store.ensureUser({
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

    if (req.method === "GET" && pathname === "/api/resume") {
      return success(res, await orchestrator.getCurrentResume());
    }

    if (req.method === "GET" && pathname === "/api/master-resume") {
      return success(res, await orchestrator.getMasterResumeView());
    }

    if (req.method === "POST" && pathname === "/api/master-resume") {
      const body = await readJsonBody(req);
      assertObject(body, "masterResumeEditDto");
      if (body.masterResumeId) ensureString(body.masterResumeId, "masterResumeId", { min: 1, max: 120 });
      assertObject(body.basicInfo || {}, "basicInfo");
      ["name", "email", "phone", "location"].forEach((field) => {
        if (body.basicInfo?.[field] !== undefined) {
          ensureString(body.basicInfo[field], `basicInfo.${field}`, { min: 0, max: 200 });
        }
      });
      if (body.summary !== undefined) ensureString(body.summary, "summary", { min: 0, max: 4000 });
      ["workExperience", "projectExperience", "education", "skills"].forEach((field) => {
        if (body[field] !== undefined && !Array.isArray(body[field])) {
          const error = new Error(`${field} must be an array.`);
          error.code = "VALIDATION_ERROR";
          throw error;
        }
      });
      return success(res, await orchestrator.saveMasterResume(body), 201);
    }

    if (req.method === "POST" && pathname === "/api/resume/upload") {
      const body = await readJsonBody(req);
      validateRequired(["fileName", "mimeType", "base64Data"], body);
      ensureString(body.fileName, "fileName", { min: 1, max: 240 });
      ensureString(body.mimeType, "mimeType", { min: 3, max: 160 });
      ensureString(body.base64Data, "base64Data", { min: 20, max: 30_000_000 });
      return success(res, await orchestrator.uploadResumeDocument(body), 201);
    }

    if (req.method === "POST" && pathname === "/api/profile/save") {
      const body = await readJsonBody(req);
      validateRequired(["name", "background"], body);
      ALLOWED_PROFILE_TEXT_FIELDS.forEach((field) => ensureString(body[field], field, { min: 1, max: 12000 }));
      if (body.autofillProfile !== undefined) {
        assertObject(body.autofillProfile, "autofillProfile");
        if (body.autofillProfile.basic !== undefined) {
          assertObject(body.autofillProfile.basic, "autofillProfile.basic");
        }
        ["education", "work_experience", "project_experience", "family"].forEach((field) => {
          if (body.autofillProfile[field] !== undefined && !Array.isArray(body.autofillProfile[field])) {
            const error = new Error(`autofillProfile.${field} must be an array.`);
            error.code = "VALIDATION_ERROR";
            throw error;
          }
        });
      }
      const profile = await orchestrator.saveProfile(body);
      return success(res, { profile });
    }

    if (req.method === "POST" && pathname === "/api/profile/onboarding") {
      const body = await readJsonBody(req);
      assertObject(body, "onboardingProfile");
      const ensureStringArray = (value, fieldName) => {
        if (value === undefined) return [];
        if (!Array.isArray(value)) {
          const error = new Error(`${fieldName} must be an array.`);
          error.code = "VALIDATION_ERROR";
          throw error;
        }
        value.forEach((item, index) => ensureString(item, `${fieldName}[${index}]`, { min: 1, max: 80 }));
        return value;
      };
      const targetRoles = ensureStringArray(body.targetRoles, "targetRoles");
      const skills = ensureStringArray(body.skills, "skills");
      const preferredLocations = ensureStringArray(body.preferredLocations, "preferredLocations");
      const preferredIndustries = ensureStringArray(body.preferredIndustries, "preferredIndustries");
      const excludedIndustries = ensureStringArray(body.excludedIndustries, "excludedIndustries");
      const excludedRoles = ensureStringArray(body.excludedRoles, "excludedRoles");
      const companyTypes = ensureStringArray(body.companyTypes, "companyTypes");
      const avoidCompanyTypes = ensureStringArray(body.avoidCompanyTypes, "avoidCompanyTypes");
      if (body.jobType !== undefined) ensureString(body.jobType, "jobType", { min: 1, max: 20 });
      if (body.degree !== undefined) ensureString(body.degree, "degree", { min: 1, max: 80 });
      if (body.acceptsNonTech !== undefined && typeof body.acceptsNonTech !== "boolean") {
        const error = new Error("acceptsNonTech must be a boolean.");
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      const profile = await orchestrator.saveOnboardingProfile({
        targetRoles,
        skills,
        preferredLocations,
        preferredIndustries,
        excludedIndustries,
        excludedRoles,
        companyTypes,
        avoidCompanyTypes,
        jobType: body.jobType || "不限",
        degree: body.degree || "",
        acceptsNonTech: Boolean(body.acceptsNonTech)
      });
      return success(res, { profile });
    }

    if (req.method === "GET" && pathname === "/api/jobs") {
      const requestUrl = new URL(req.url, "http://localhost");
      const limitParam = Number(requestUrl.searchParams.get("limit") || "100");
      const profileParam = String(requestUrl.searchParams.get("profile") || "").trim().toLowerCase();
      return success(
        res,
        await orchestrator.getJobWorkspaceList({
          limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100,
          includeProfiling: profileParam === "1" || profileParam === "true"
        })
      );
    }

    if (req.method === "POST" && pathname === "/api/discovery/intents") {
      const body = await readJsonBody(req);
      validateRequired(["keywords"], body);
      if (!Array.isArray(body.keywords)) {
        const error = new Error("keywords must be an array.");
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      body.keywords.forEach((item, index) => ensureString(item, `keywords[${index}]`, { min: 1, max: 80 }));
      if (body.city) ensureString(body.city, "city", { min: 1, max: 80 });
      if (body.jobType) ensureString(body.jobType, "jobType", { min: 1, max: 40 });
      if (body.seniority) ensureString(body.seniority, "seniority", { min: 1, max: 40 });
      if (body.riskTolerance) ensureString(body.riskTolerance, "riskTolerance", { min: 1, max: 40 });
      return success(res, await orchestrator.createDiscoveryIntentWorkflow(body), 201);
    }

    if (req.method === "POST" && /^\/api\/discovery\/intents\/[^/]+\/import-links$/.test(pathname)) {
      const intentId = pathname.split("/")[4];
      const body = await readJsonBody(req);
      if (!Array.isArray(body.candidates) && !Array.isArray(body.jobLinks)) {
        const error = new Error("candidates or jobLinks must be an array.");
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      return success(res, await orchestrator.importDiscoveryCandidatesWorkflow(intentId, body), 201);
    }

    if (req.method === "POST" && /^\/api\/discovery\/intents\/[^/]+\/import-feishu$/.test(pathname)) {
      const intentId = pathname.split("/")[4];
      const body = await readJsonBody(req);
      if (!Array.isArray(body.leads)) {
        const error = new Error("leads must be an array.");
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      if (body.docName) ensureString(body.docName, "docName", { min: 1, max: 200 });
      if (body.origin) ensureString(body.origin, "origin", { min: 1, max: 80 });
      return success(res, await orchestrator.importDiscoveryFeishuLeadsWorkflow(intentId, body), 201);
    }

    if (req.method === "POST" && /^\/api\/discovery\/intents\/[^/]+\/sync-feishu-bitable$/.test(pathname)) {
      const intentId = pathname.split("/")[4];
      const body = await readJsonBody(req);
      validateRequired(["appToken", "tableId", "tenantAccessToken"], body);
      ensureString(body.appToken, "appToken", { min: 1, max: 200 });
      ensureString(body.tableId, "tableId", { min: 1, max: 200 });
      ensureString(body.tenantAccessToken, "tenantAccessToken", { min: 1, max: 500 });
      if (body.viewId) ensureString(body.viewId, "viewId", { min: 1, max: 200 });
      if (body.docName) ensureString(body.docName, "docName", { min: 1, max: 200 });
      return success(res, await orchestrator.syncDiscoveryFeishuBitableWorkflow(intentId, body), 201);
    }

    if (req.method === "POST" && /^\/api\/discovery\/intents\/[^/]+\/import-offline-json$/.test(pathname)) {
      const intentId = pathname.split("/")[4];
      const body = await readJsonBody(req);
      if (body.filePath) ensureString(body.filePath, "filePath", { min: 1, max: 500 });
      if (body.origin) ensureString(body.origin, "origin", { min: 1, max: 120 });
      if (body.docName) ensureString(body.docName, "docName", { min: 1, max: 200 });
      return success(res, await orchestrator.importDiscoveryOfflineJsonWorkflow(intentId, body), 201);
    }

    if (req.method === "GET" && /^\/api\/discovery\/intents\/[^/]+$/.test(pathname)) {
      const intentId = pathname.split("/")[4];
      return success(res, await orchestrator.getDiscoveryIntentView(intentId));
    }

    if (req.method === "POST" && /^\/api\/discovery\/intents\/[^/]+\/shortlist\/[^/]+\/admit$/.test(pathname)) {
      const segments = pathname.split("/");
      const intentId = segments[4];
      const listingId = segments[6];
      const body = await readJsonBody(req);
      if (body.overrideReason) ensureString(body.overrideReason, "overrideReason", { min: 1, max: 500 });
      if (body.actor) ensureString(body.actor, "actor", { min: 1, max: 40 });
      return success(res, await orchestrator.admitDiscoveryListingWorkflow(intentId, listingId, body), 201);
    }

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/shortlist-admission$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      const body = await readJsonBody(req);
      validateRequired(["intentId", "listingId"], body);
      ensureString(body.intentId, "intentId", { min: 1, max: 80 });
      ensureString(body.listingId, "listingId", { min: 1, max: 80 });
      if (body.overrideReason) ensureString(body.overrideReason, "overrideReason", { min: 1, max: 500 });
      if (body.actor) ensureString(body.actor, "actor", { min: 1, max: 40 });
      return success(res, await orchestrator.attachShortlistAdmissionToJobWorkflow(jobId, body), 201);
    }

    if (req.method === "POST" && pathname === "/api/jobs/import-url") {
      const body = await readJsonBody(req);
      validateRequired(["jobUrl"], body);
      const jobUrl = ensureString(body.jobUrl, "jobUrl", { min: 8, max: 2000 });
      if (!/^https?:\/\//i.test(jobUrl)) {
        const error = new Error("jobUrl must start with http:// or https://");
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      if (body.sourcePlatform) ensureString(body.sourcePlatform, "sourcePlatform", { min: 1, max: 200 });
      if (body.company) ensureString(body.company, "company", { min: 1, max: 200 });
      if (body.title) ensureString(body.title, "title", { min: 1, max: 200 });
      if (body.location) ensureString(body.location, "location", { min: 1, max: 200 });

      const result = await orchestrator.importJobDraftFromUrl(body);
      logger.info("job.import_url", {
        jobUrl,
        importerOk: result.importer?.ok,
        strategy: result.draft.importMeta?.strategy || "manual_fallback"
      });
      return success(
        res,
        result,
        result.importer?.ok ? 200 : 202
      );
    }

    if (req.method === "POST" && pathname === "/api/jobs/ingest") {
      const body = await readJsonBody(req);
      if (body.rawJdText) ensureString(body.rawJdText, "rawJdText", { min: 1, max: 30000 });
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
      return success(res, await orchestrator.getJobDetailView(jobId));
    }

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/evaluate$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      return success(res, await orchestrator.evaluateJob(jobId));
    }

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/tailor$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      return success(res, await orchestrator.generateResumeTailoringOutput(jobId));
    }

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/tailor\/save$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      const body = await readJsonBody(req);
      return success(res, await orchestrator.saveResumeTailoringOutput(jobId, body));
    }

    if (req.method === "GET" && /^\/api\/jobs\/[^/]+\/tailoring-workspace$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      return success(res, await orchestrator.getOrBuildTailoringWorkspace(jobId));
    }

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/tailoring-workspace\/save$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      const body = await readJsonBody(req);
      return success(res, await orchestrator.saveTailoringWorkspace(jobId, body));
    }

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/tailoring-workspace\/refine$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      const body = await readJsonBody(req);
      return success(res, await orchestrator.refineTailoringWorkspace(jobId, body));
    }

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/prepare$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      const body = await readJsonBody(req);
      return success(res, await orchestrator.prepareJobApplication(jobId, body));
    }

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/execution\/dry-run$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      const body = await readJsonBody(req);
      return success(res, await orchestrator.runExecutionDryRun(jobId, body));
    }

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/browser-apply\/session$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      const body = await readJsonBody(req);
      if (body.simulationMode) {
        ensureEnum(body.simulationMode, "simulationMode", ["standard", "no_form", "blocked"]);
      }
      return success(res, await orchestrator.runBrowserApplySession(jobId, body), 201);
    }

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/execution\/confirm$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      const body = await readJsonBody(req);
      return success(res, await orchestrator.confirmExecutionRun(jobId, body));
    }

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/execution\/submit$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      const body = await readJsonBody(req);
      return success(res, await orchestrator.submitJobApplication(jobId, body));
    }

    if (req.method === "GET" && /^\/api\/jobs\/[^/]+\/export-docx$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      const exported = await orchestrator.exportJobTailoringDocx(jobId);
      return sendBinary(res, 200, exported.buffer, {
        "Content-Type": exported.contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(exported.fileName)}`,
        "Cache-Control": "no-store",
        "X-ApplyFlow-Export-Summary": buildExportSummaryHeader(exported)
      });
    }

    if (req.method === "GET" && /^\/api\/jobs\/[^/]+\/export-pdf$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      const exported = await orchestrator.exportJobTailoringPdf(jobId);
      return sendBinary(res, 200, exported.buffer, {
        "Content-Type": exported.contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(exported.fileName)}`,
        "Cache-Control": "no-store",
        "X-ApplyFlow-Export-Summary": buildExportSummaryHeader(exported)
      });
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

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/tracker-state$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      const body = await readJsonBody(req);
      validateRequired(["nextState"], body);
      ensureString(body.nextState, "nextState", { min: 1, max: 32 });
      ensureEnum(String(body.nextState || "").trim().toLowerCase(), "nextState", ALLOWED_TRACKER_STATES);
      return success(res, await orchestrator.updateJobTrackerState(jobId, body.nextState));
    }

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/feedback-state$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      const body = await readJsonBody(req);
      validateRequired(["nextState"], body);
      ensureString(body.nextState, "nextState", { min: 1, max: 32 });
      ensureEnum(String(body.nextState || "").trim().toLowerCase(), "nextState", ALLOWED_FEEDBACK_STATES);
      return success(res, await orchestrator.updateJobFeedbackState(jobId, body.nextState));
    }

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/shortlist-state$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      const body = await readJsonBody(req);
      validateRequired(["nextState"], body);
      ensureString(body.nextState, "nextState", { min: 1, max: 32 });
      ensureEnum(String(body.nextState || "").trim().toLowerCase(), "nextState", ALLOWED_SHORTLIST_STATES);
      return success(res, await orchestrator.updateJobShortlistState(jobId, body.nextState));
    }

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/materials-prep$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      const body = await readJsonBody(req);
      assertObject(body, "materialsPrep");
      if (body.resumeStatus !== undefined) {
        ensureEnum(String(body.resumeStatus || "").trim().toLowerCase(), "resumeStatus", ALLOWED_RESUME_MATERIAL_STATES);
      }
      if (body.coverLetterStatus !== undefined) {
        ensureEnum(
          String(body.coverLetterStatus || "").trim().toLowerCase(),
          "coverLetterStatus",
          ALLOWED_COVER_LETTER_MATERIAL_STATES
        );
      }
      if (body.interviewPrepStatus !== undefined) {
        ensureEnum(
          String(body.interviewPrepStatus || "").trim().toLowerCase(),
          "interviewPrepStatus",
          ALLOWED_INTERVIEW_PREP_MATERIAL_STATES
        );
      }
      if (body.notes !== undefined) {
        ensureString(body.notes, "notes", { min: 0, max: 2000, allowEmpty: true });
      }
      return success(res, await orchestrator.updateJobMaterialsPrep(jobId, body));
    }

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/submission-audit$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      const body = await readJsonBody(req);
      assertObject(body, "submissionAudit");
      if (body.status !== undefined) {
        ensureEnum(String(body.status || "").trim().toLowerCase(), "status", ALLOWED_SUBMISSION_AUDIT_STATUSES);
      }
      if (body.source !== undefined) {
        ensureEnum(String(body.source || "").trim().toLowerCase(), "source", ALLOWED_SUBMISSION_AUDIT_SOURCES);
      }
      if (body.lastError !== undefined) {
        ensureString(body.lastError, "lastError", { min: 0, max: 2000, allowEmpty: true });
      }
      if (body.notes !== undefined) {
        ensureString(body.notes, "notes", { min: 0, max: 2000, allowEmpty: true });
      }
      return success(res, await orchestrator.updateJobSubmissionAudit(jobId, body));
    }

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/follow-up$/.test(pathname)) {
      const jobId = pathname.split("/")[3];
      const body = await readJsonBody(req);
      assertObject(body, "followUp");
      if (body.status !== undefined) {
        ensureEnum(String(body.status || "").trim().toLowerCase(), "status", ALLOWED_FOLLOW_UP_STATUSES);
      }
      if (body.channel !== undefined) {
        ensureEnum(String(body.channel || "").trim().toLowerCase(), "channel", ALLOWED_FOLLOW_UP_CHANNELS);
      }
      if (body.dueAt !== undefined) {
        const dueAt = String(body.dueAt || "").trim();
        if (dueAt) {
          ensureString(dueAt, "dueAt", { min: 8, max: 80 });
          const parsed = new Date(dueAt);
          if (Number.isNaN(parsed.getTime())) {
            const error = new Error("dueAt must be a valid ISO datetime or empty.");
            error.code = "VALIDATION_ERROR";
            throw error;
          }
        }
      }
      if (body.notes !== undefined) {
        ensureString(body.notes, "notes", { min: 0, max: 2000, allowEmpty: true });
      }
      return success(res, await orchestrator.updateJobFollowUp(jobId, body));
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
      logger.info("policy.action_requested", { action: ALLOWED_PROPOSAL_ACTIONS[0], proposalId });
      return success(res, await orchestrator.approvePolicyProposal(proposalId, body.reviewerNote || ""));
    }

    if (req.method === "POST" && /^\/api\/policy\/proposals\/[^/]+\/reject$/.test(pathname)) {
      const proposalId = pathname.split("/")[4];
      const body = await readJsonBody(req);
      if (body.reviewerNote) ensureString(body.reviewerNote, "reviewerNote", { min: 0, max: 500, allowEmpty: true });
      logger.info("policy.action_requested", { action: ALLOWED_PROPOSAL_ACTIONS[1], proposalId });
      return success(res, { proposal: await orchestrator.rejectPolicyProposal(proposalId, body.reviewerNote || "") });
    }

    if (req.method === "POST" && pathname === "/api/policy/revert") {
      logger.info("policy.action_requested", { action: ALLOWED_PROPOSAL_ACTIONS[2] });
      return success(res, { policy: await orchestrator.revertCurrentPolicy() });
    }

    return false;
  } catch (error) {
    logger.error("api.error", {
      pathname,
      method: req.method,
      errorCode: error.code || "UNKNOWN_ERROR",
      message: error.message
    });
    const statusCode =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "UNAUTHENTICATED"
          ? 401
          : error.code === "AUTH_FAILED"
            ? 403
            : 400;
    const safeError =
      statusCode >= 500
        ? { code: "INTERNAL_ERROR", message: "Something went wrong on the server. Please try again." }
        : error;
    failure(res, safeError, statusCode);
    return true;
  }
}

module.exports = { handleApiRequest };
