"use strict";

const fs = require("fs");
const path = require("path");
const store = require("../../src/server/store");
const orchestrator = require("../../src/lib/orchestrator/workflow-controller");
const { createExecutionDto } = require("../../src/lib/contracts/execution-contracts");
const { createShortlistAdmission } = require("../../src/lib/discovery/job-discovery-pipeline");

function nowIso() {
  return new Date().toISOString();
}

function readFixture(fileName) {
  const filePath = path.resolve(process.cwd(), "scripts/fixtures", fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectErrorCode(label, expectedCode, fn) {
  try {
    await fn();
  } catch (error) {
    if (error?.code === expectedCode) return error;
    throw new Error(`${label} expected ${expectedCode}, got ${error?.code || "unknown"}`);
  }
  throw new Error(`${label} expected ${expectedCode}, but no error thrown`);
}

function ensureProfileAndResume() {
  let profile = store.getProfile();
  if (!profile) {
    profile = store.saveProfile({
      id: `profile_fullchain_${Date.now()}`,
      name: "Fullchain QA",
      fullName: "Fullchain QA",
      headline: "AI PM",
      background: "Fullchain acceptance validation",
      yearsOfExperience: 3,
      targetRoles: ["AI Product Manager"],
      targetIndustries: ["AI"],
      targetLocations: ["Shanghai"],
      preferredLocations: ["Shanghai"],
      strengths: ["Agent orchestration"],
      constraints: [],
      masterResume: "Master resume baseline",
      baseResume: "Master resume baseline",
      policyPreferences: {
        manualPreferredRoles: [],
        ignoredRiskyRoles: [],
        riskToleranceOverride: ""
      },
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }

  let resume = store.getLatestResumeDocument();
  if (!resume) {
    resume = store.saveResumeDocument({
      id: `resume_fullchain_${Date.now()}`,
      fileName: "resume_fullchain.pdf",
      mimeType: "application/pdf",
      rawText: "Experienced AI PM with workflow and LLM delivery track record.",
      cleanedText: "Experienced AI PM with workflow and LLM delivery track record.",
      summary: "AI PM resume",
      parseStatus: "parse_success",
      extractionMethod: "parser",
      structuredProfile: {
        summary: "AI PM",
        experience: ["Built decision-first workflow systems"],
        projects: ["ApplyFlow"],
        skills: ["workflow", "llm", "agent"],
        education: [],
        achievements: [],
        certifications: [],
        sections: []
      },
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }

  return { profile, resume };
}

function pickOne(items = []) {
  return Array.isArray(items) && items.length > 0 ? items[0] : null;
}

function findFeedbackTrace(jobId, runId = "", eventType = "") {
  const logs = store.listActivityLogsByJobId(jobId) || [];
  const traces = logs
    .map((log) => log?.metadata?.feedbackTrace || null)
    .filter(Boolean);
  return traces.find((trace) => {
    if (runId && String(trace?.trace?.runId || "") !== String(runId)) return false;
    if (eventType && String(trace?.eventType || "") !== String(eventType)) return false;
    return true;
  }) || null;
}

async function prepareWithReviewOverride(jobId, reason) {
  try {
    return await orchestrator.prepareJobApplication(jobId, {});
  } catch (error) {
    if (error?.code !== "CONTROL_GATE_REVIEW_REQUIRED") throw error;
    orchestrator.applyJobOverride(jobId, {
      action: "force_proceed",
      reason
    });
    return orchestrator.prepareJobApplication(jobId, {});
  }
}

async function main() {
  ensureProfileAndResume();
  const fixture = readFixture("discovery-fullchain-e2e-fixture.json");
  const expected = fixture.expectedErrors || {};
  const audit = {};

  const intent = orchestrator.createDiscoveryIntentWorkflow(fixture.intentInput || {}).intent;
  const imported = orchestrator.importDiscoveryCandidatesWorkflow(intent.intentId, {
    candidates: fixture.candidates || []
  });

  const shortlist = imported.shortlistResult || orchestrator.getDiscoveryIntentView(intent.intentId).shortlistResult;
  assertTrue(shortlist && typeof shortlist === "object", "shortlistResult is required");

  const shortlistedItem = pickOne(shortlist.shortlistedItems || []);
  const holdItem = pickOne(shortlist.holdItems || []);
  const skippedItem = pickOne(shortlist.skippedItems || []);
  assertTrue(Boolean(shortlistedItem), "fixture must produce one shortlisted item");
  assertTrue(Boolean(holdItem), "fixture must produce one hold item");
  assertTrue(Boolean(skippedItem), "fixture must produce one skipped item");

  audit.intentId = intent.intentId;
  audit.shortlistId = shortlist.shortlistId;

  // A. success chain
  const admitted = await orchestrator.admitDiscoveryListingWorkflow(intent.intentId, shortlistedItem.listingId, {
    actor: "user"
  });
  audit.successAdmission = {
    admissionId: admitted.admission.admissionId,
    admissionStatus: admitted.admission.admissionStatus,
    listingId: admitted.admission.listingId
  };

  const successJobId = admitted.job.id;
  await orchestrator.evaluateJob(successJobId);
  await orchestrator.generateResumeTailoringOutput(successJobId);
  const prepared = await prepareWithReviewOverride(
    successJobId,
    "validate-discovery-fullchain-e2e success chain control gate override"
  );
  orchestrator.saveApplicationPrep(successJobId, {
    checklist: [
      { key: "resume_reviewed", label: "resume reviewed", completed: true },
      { key: "intro_ready", label: "intro ready", completed: true },
      { key: "qa_ready", label: "qa ready", completed: true }
    ]
  });
  const dryRun = orchestrator.runExecutionDryRun(successJobId, { targetUrl: "https://example.com/form/fullchain" });
  const confirmToken = dryRun.executionDto?.confirmState?.confirmToken || "";
  orchestrator.confirmExecutionRun(successJobId, { actor: "user", confirmToken });
  orchestrator.transitionJobStatus(successJobId, "ready_to_apply", { actor: "user" });
  const submitted = orchestrator.submitJobApplication(successJobId, { actor: "user" });

  assertTrue(submitted?.submitContract?.outcome === "submitted", "success chain submit outcome must be submitted");
  audit.successChain = {
    tailoredResumeId: prepared?.tailoredResumeContract?.tailoredResumeId || "",
    runId: dryRun?.executionDto?.runId || "",
    gateStatus: dryRun?.controlGateResult?.status || "",
    confirmState: "confirmed",
    submitOutcome: submitted?.submitContract?.outcome || ""
  };

  // B. hold blocked chain on prepare guard
  const holdAdmission = createShortlistAdmission({
    intentId: intent.intentId,
    listingId: holdItem.listingId,
    actor: "user"
  });
  const holdBlockedJob = store.saveJob({
    id: `job_hold_blocked_${Date.now()}`,
    company: "Hold Candidate",
    title: "AI Product Manager",
    location: "Shanghai",
    sourceLabel: "discovery",
    sourcePlatform: "discovery",
    jobUrl: "https://example.com/hold",
    status: "inbox",
    priority: "medium",
    jdRaw: "hold blocked",
    fitAssessmentId: "",
    resumeDocumentId: store.getLatestResumeDocument()?.id || "",
    shortlistAdmission: holdAdmission,
    discoveryContext: {
      intentId: intent.intentId,
      listingId: holdItem.listingId,
      clusterId: holdAdmission.clusterId,
      shortlistId: holdAdmission.shortlistId,
      source: "discovery_shortlist"
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
  const holdBlockedError = await expectErrorCode(
    "hold chain prepare blocked",
    expected.holdWithoutOverride || "SHORTLIST_OVERRIDE_REQUIRED",
    async () => orchestrator.prepareJobApplication(holdBlockedJob.id, {})
  );
  audit.holdBlocked = {
    admissionId: holdAdmission.admissionId,
    admissionStatus: holdAdmission.admissionStatus,
    failureReason: holdBlockedError.message
  };

  // C. skipped blocked chain on prepare guard
  const skipAdmission = createShortlistAdmission({
    intentId: intent.intentId,
    listingId: skippedItem.listingId,
    actor: "user"
  });
  const skipBlockedJob = store.saveJob({
    id: `job_skip_blocked_${Date.now()}`,
    company: "Skipped Candidate",
    title: "General PM",
    location: "Shanghai",
    sourceLabel: "discovery",
    sourcePlatform: "discovery",
    jobUrl: "https://example.com/skip",
    status: "inbox",
    priority: "low",
    jdRaw: "skip blocked",
    fitAssessmentId: "",
    resumeDocumentId: store.getLatestResumeDocument()?.id || "",
    shortlistAdmission: skipAdmission,
    discoveryContext: {
      intentId: intent.intentId,
      listingId: skippedItem.listingId,
      clusterId: skipAdmission.clusterId,
      shortlistId: skipAdmission.shortlistId,
      source: "discovery_shortlist"
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
  const skipBlockedError = await expectErrorCode(
    "skip chain prepare blocked",
    expected.skipWithoutOverride || "SHORTLIST_ADMISSION_BLOCKED",
    async () => orchestrator.prepareJobApplication(skipBlockedJob.id, {})
  );
  audit.skipBlocked = {
    admissionId: skipAdmission.admissionId,
    admissionStatus: skipAdmission.admissionStatus,
    failureReason: skipBlockedError.message
  };

  // D. hold override success chain
  const holdOverride = await orchestrator.admitDiscoveryListingWorkflow(intent.intentId, holdItem.listingId, {
    actor: "user",
    overrideReason: "Portfolio and domain signal justify manual pass."
  });
  assertTrue(holdOverride.admission.admissionStatus === "overridden", "hold override must be overridden");
  const holdOverrideJobId = holdOverride.job.id;
  await orchestrator.evaluateJob(holdOverrideJobId);
  await orchestrator.generateResumeTailoringOutput(holdOverrideJobId);
  const holdPrepared = await prepareWithReviewOverride(
    holdOverrideJobId,
    "validate-discovery-fullchain-e2e hold override control gate override"
  );
  orchestrator.saveApplicationPrep(holdOverrideJobId, {
    checklist: [
      { key: "resume_reviewed", label: "resume reviewed", completed: true },
      { key: "intro_ready", label: "intro ready", completed: true },
      { key: "qa_ready", label: "qa ready", completed: true }
    ]
  });
  const holdDryRun = orchestrator.runExecutionDryRun(holdOverrideJobId, { targetUrl: "https://example.com/form/hold" });
  const holdConfirmToken = holdDryRun.executionDto?.confirmState?.confirmToken || "";
  orchestrator.confirmExecutionRun(holdOverrideJobId, { actor: "user", confirmToken: holdConfirmToken });
  orchestrator.transitionJobStatus(holdOverrideJobId, "ready_to_apply", { actor: "user" });
  const holdSubmitted = orchestrator.submitJobApplication(holdOverrideJobId, { actor: "user" });
  assertTrue(holdSubmitted?.submitContract?.outcome === "submitted", "hold override chain should submit");

  const overrideTrace = findFeedbackTrace(holdOverrideJobId, holdOverride.admission.admissionId, "user_override");
  audit.holdOverride = {
    admissionId: holdOverride.admission.admissionId,
    admissionStatus: holdOverride.admission.admissionStatus,
    overrideReason: holdOverride.admission.override?.overrideReason || "",
    overrideTraceId: overrideTrace?.trace?.traceId || "",
    runId: holdDryRun.executionDto?.runId || "",
    gateStatus: holdDryRun.controlGateResult?.status || "",
    confirmState: "confirmed",
    submitOutcome: holdSubmitted?.submitContract?.outcome || "",
    tailoredResumeId: holdPrepared?.tailoredResumeContract?.tailoredResumeId || ""
  };

  // E. submit blocked chain
  const submitGuardJob = store.saveJob({
    id: `job_submit_guard_${Date.now()}`,
    company: "Guard Co",
    title: "Guard PM",
    location: "Shanghai",
    sourceLabel: "manual",
    jobUrl: "https://example.com/guard",
    status: "ready_to_apply",
    priority: "high",
    fitAssessmentId: "",
    resumeDocumentId: store.getLatestResumeDocument()?.id || "",
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  await expectErrorCode(
    "submit missing run",
    expected.submitWithoutRun || "EXECUTION_RUN_REQUIRED",
    async () => orchestrator.submitJobApplication(submitGuardJob.id, { actor: "user" })
  );

  const noGateExecution = createExecutionDto({
    runId: `run_no_gate_${Date.now()}`,
    jobId: submitGuardJob.id,
    tailoredResumeId: "tailored_no_gate",
    prepDtoId: "prep_no_gate",
    gateSnapshot: {
      controlId: "control_no_gate",
      status: "allowed",
      reasons: [],
      blockingIssues: [],
      requiredActions: [],
      checkedAt: nowIso()
    },
    executionMode: "live",
    confirmState: { state: "confirmed", required: false },
    targetUrl: "https://example.com",
    prefillPayload: {},
    formPayload: {},
    admissionContext: {
      admissionId: "adm",
      intentId: "intent",
      shortlistId: "shortlist",
      listingId: "listing",
      admissionStatus: "admitted",
      admissionBucket: "shortlisted",
      selectionReason: "ok"
    },
    auditContext: { actor: "system", source: "validate-discovery-fullchain-e2e" }
  });

  store.saveJob({
    ...store.getJob(submitGuardJob.id),
    latestExecutionDto: noGateExecution
  });
  await expectErrorCode(
    "submit missing gate",
    expected.submitWithoutGate || "CONTROL_GATE_REQUIRED",
    async () => orchestrator.submitJobApplication(submitGuardJob.id, { actor: "user" })
  );

  store.saveJob({
    ...store.getJob(submitGuardJob.id),
    latestControlGateResult: {
      controlId: `control_needs_review_${Date.now()}`,
      status: "needs_human_review",
      reasons: ["review"],
      blockingIssues: ["review required"],
      requiredActions: ["confirm first"],
      checkedAt: nowIso()
    },
    latestExecutionDto: createExecutionDto({
      ...noGateExecution,
      runId: `run_needs_confirm_${Date.now()}`,
      confirmState: { state: "pending", required: true, confirmToken: "confirm_expected" }
    })
  });
  await expectErrorCode(
    "submit without confirm",
    expected.submitWithoutConfirm || "HUMAN_CONFIRM_REQUIRED",
    async () => orchestrator.submitJobApplication(submitGuardJob.id, { actor: "user" })
  );

  const preconditionJobId = `job_precondition_${Date.now()}`;
  store.saveJob({
    id: preconditionJobId,
    company: "Precondition Co",
    title: "PM",
    location: "Shanghai",
    sourceLabel: "manual",
    jobUrl: "https://example.com/precondition",
    status: "to_prepare",
    priority: "high",
    fitAssessmentId: "",
    resumeDocumentId: store.getLatestResumeDocument()?.id || "",
    latestControlGateResult: {
      controlId: `control_precondition_${Date.now()}`,
      status: "allowed",
      reasons: [],
      blockingIssues: [],
      requiredActions: [],
      checkedAt: nowIso()
    },
    latestExecutionDto: createExecutionDto({
      runId: `run_precondition_${Date.now()}`,
      jobId: preconditionJobId,
      tailoredResumeId: "tailored_precondition",
      prepDtoId: "prep_precondition",
      gateSnapshot: {
        controlId: `control_precondition_${Date.now()}`,
        status: "allowed",
        reasons: [],
        blockingIssues: [],
        requiredActions: [],
        checkedAt: nowIso()
      },
      executionMode: "live",
      confirmState: { state: "confirmed", required: false },
      targetUrl: "https://example.com",
      prefillPayload: {},
      formPayload: {},
      admissionContext: {
        admissionId: "adm_precondition",
        intentId: "intent_precondition",
        shortlistId: "shortlist_precondition",
        listingId: "listing_precondition",
        admissionStatus: "admitted",
        admissionBucket: "shortlisted",
        selectionReason: "ok"
      },
      auditContext: { actor: "system", source: "validate-discovery-fullchain-e2e" }
    }),
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  const preconditionError = await expectErrorCode(
    "submit precondition",
    expected.submitPrecondition || "SUBMIT_PRECONDITION_NOT_READY",
    async () => orchestrator.submitJobApplication(preconditionJobId, { actor: "user" })
  );
  audit.submitBlocked = {
    runId: store.getJob(submitGuardJob.id)?.latestExecutionDto?.runId || "",
    gateStatus: store.getJob(submitGuardJob.id)?.latestControlGateResult?.status || "",
    confirmState: store.getJob(submitGuardJob.id)?.latestExecutionDto?.confirmState?.state || "",
    submitOutcome: "blocked",
    failureReason: preconditionError?.message || "Submit precondition blocked."
  };

  // fixed evidence checks
  assertTrue(Boolean(audit.intentId), "audit intentId missing");
  assertTrue(Boolean(audit.shortlistId), "audit shortlistId missing");
  assertTrue(Boolean(audit.successAdmission.admissionId), "audit admissionId missing");
  assertTrue(Boolean(audit.successChain.tailoredResumeId), "audit tailoredResumeId missing");
  assertTrue(Boolean(audit.successChain.runId), "audit runId missing");
  assertTrue(Boolean(audit.successChain.gateStatus), "audit gateStatus missing");
  assertTrue(Boolean(audit.successChain.confirmState), "audit confirmState missing");
  assertTrue(Boolean(audit.successChain.submitOutcome), "audit submitOutcome missing");
  assertTrue(Boolean(audit.holdOverride.overrideTraceId), "audit override trace missing");
  assertTrue(Boolean(audit.submitBlocked.failureReason), "audit failureReason missing");

  console.log("validate-discovery-fullchain-e2e: fullchain success, blocked, override, and submit guards passed.");
  console.log(JSON.stringify({ auditEvidence: audit }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
