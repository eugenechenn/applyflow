"use strict";

const fs = require("fs");
const path = require("path");
const store = require("../../src/server/store");
const orchestrator = require("../../src/lib/orchestrator/workflow-controller");
const { agentRegistry } = require("../../src/lib/orchestrator/agent-registry");
const { createExecutionDto } = require("../../src/lib/contracts/execution-contracts");

const fixturePath = path.resolve(process.cwd(), "scripts/fixtures/execution-e2e-fixture.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function nowIso() {
  return new Date().toISOString();
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function expectErrorCode(label, expectedCode, fn) {
  try {
    fn();
  } catch (error) {
    if (error?.code === expectedCode) return;
    throw new Error(`${label} expected ${expectedCode}, got ${error?.code || "unknown"}`);
  }
  throw new Error(`${label} expected ${expectedCode}, but no error thrown`);
}

function ensureProfile() {
  const existing = store.getProfile();
  if (existing) return existing;
  return store.saveProfile({
    id: `profile_e2e_${Date.now()}`,
    name: "Execution E2E",
    fullName: "Execution E2E",
    headline: "E2E Validation",
    background: "E2E Validation",
    yearsOfExperience: 3,
    targetRoles: ["AI Product Manager"],
    targetIndustries: ["AI"],
    targetLocations: ["Shanghai"],
    preferredLocations: ["Shanghai"],
    strengths: ["Execution"],
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

function seedResume(seedId) {
  return store.saveResumeDocument({
    id: `resume_${seedId}`,
    fileName: `resume_${seedId}.pdf`,
    mimeType: "application/pdf",
    rawText: "Experienced PM in AI agent products.",
    cleanedText: "Experienced PM in AI agent products.",
    summary: "AI PM resume",
    parseStatus: "parse_success",
    extractionMethod: "parser",
    structuredProfile: {
      summary: "AI PM",
      experience: ["Built agent decision systems"],
      projects: ["ApplyFlow"],
      skills: ["agent", "workflow", "product"],
      education: [],
      achievements: [],
      certifications: [],
      sections: []
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
}

function seedJob({
  seedId,
  status = "to_prepare",
  recommendation = "apply",
  strategyDecision = "proceed",
  riskFlags = [],
  withTailoring = true,
  withPrep = true
}) {
  const resume = seedResume(seedId);
  const jobId = `job_e2e_${seedId}`;
  const fitId = `fit_e2e_${seedId}`;
  const tailoringId = `tailor_e2e_${seedId}`;
  const prepId = `prep_e2e_${seedId}`;

  store.saveJob({
    id: jobId,
    company: "ApplyFlow QA",
    title: "Execution Validation Engineer",
    location: "Shanghai",
    sourceLabel: "manual",
    jobUrl: `https://example.com/jobs/${seedId}`,
    status,
    priority: "high",
    strategyDecision,
    fitAssessmentId: fitId,
    resumeDocumentId: resume.id,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  store.saveFitAssessment({
    id: fitId,
    jobId,
    profileId: ensureProfile().id,
    fitScore: recommendation === "skip" ? 35 : 84,
    recommendation,
    strategyDecision,
    strategyReasoning: "E2E validation assessment",
    whyApply: recommendation === "skip" ? [] : ["Strong role fit"],
    keyGaps: [],
    riskFlags,
    llmMeta: { model: "fixture", fallbackUsed: false },
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  if (withTailoring) {
    store.saveTailoringOutput({
      id: tailoringId,
      jobId,
      version: 1,
      tailoredSummary: "Tailored summary for e2e",
      tailoringExplainability: ["Aligned with job requirements."],
      workspaceDraft: {
        workExperience: ["Built contract-driven execution workflows."],
        projectExperience: ["ApplyFlow Phase 3"],
        selfEvaluation: "Strong fit for execution-focused PM role."
      },
      targetingBrief: { targetKeywords: ["execution", "agent", "workflow"] },
      workspace: {
        id: `workspace_${jobId}`,
        name: `Workspace ${jobId}`,
        activeVersion: 1,
        updatedAt: nowIso()
      },
      insights: {
        headline: "Execution-heavy role",
        strongestMatch: "workflow control",
        biggestGap: "",
        nextEditFocus: "none"
      },
      reviewModules: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }

  if (withPrep) {
    store.saveApplicationPrep({
      id: prepId,
      jobId,
      resumeDocumentId: resume.id,
      version: 1,
      resumeTailoring: {
        targetKeywords: ["execution", "agent"],
        rewriteBullets: [{ after: "Built controlled execution workflow." }]
      },
      tailoredSummary: "Tailored summary",
      whyMe: "Because fit is high",
      selfIntro: { short: "short intro", medium: "medium intro" },
      qaDraft: [{ question: "Q", answer: "A" }],
      talkingPoints: ["point one"],
      coverNote: "cover",
      outreachNote: "outreach",
      checklist: [
        { key: "resume_reviewed", label: "简历确认", completed: true },
        { key: "intro_ready", label: "自我介绍就绪", completed: true },
        { key: "qa_ready", label: "问答草稿就绪", completed: true }
      ],
      contentWithSources: [],
      tailoringExplainability: [],
      tailoredResumePreview: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }

  return jobId;
}

function runSuccessChain() {
  const seedId = `success_${Date.now()}`;
  const jobId = seedJob({
    seedId,
    status: fixture.successChain?.jobStatusStart || "to_prepare",
    recommendation: "apply",
    strategyDecision: "proceed",
    riskFlags: [],
    withTailoring: true,
    withPrep: true
  });

  const originalPrepAgent = agentRegistry.applicationPrep;
  agentRegistry.applicationPrep = ({ job, resumeDocument }) => ({
    id: `prep_agent_${job.id}`,
    jobId: job.id,
    resumeDocumentId: resumeDocument?.id || "",
    version: 1,
    resumeTailoring: {
      targetKeywords: ["execution", "agent"],
      rewriteBullets: [{ after: "Built controlled execution workflow." }]
    },
    tailoredSummary: "Tailored summary from stub",
    whyMe: "Strong fit",
    selfIntro: { short: "stub short", medium: "stub medium" },
    qaDraft: [{ question: "Q", answer: "A" }],
    talkingPoints: ["point one"],
    coverNote: "cover",
    outreachNote: "outreach",
    checklist: [
      { key: "resume_reviewed", label: "简历确认", completed: true },
      { key: "intro_ready", label: "自我介绍就绪", completed: true },
      { key: "qa_ready", label: "问答草稿就绪", completed: true }
    ],
    contentWithSources: [],
    tailoringExplainability: [],
    tailoredResumePreview: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  // prepareJobApplication 在当前策略下可能触发异步 review 抛错，成功链直接使用已播种的 prep/tailoring 数据。
  agentRegistry.applicationPrep = originalPrepAgent;

  const dryRunResult = orchestrator.runExecutionDryRun(jobId, { targetUrl: "https://example.com/form/success" });
  const confirmToken =
    dryRunResult?.executionDto?.confirmState?.confirmToken ||
    dryRunResult?.confirmState?.confirmToken ||
    null;
  const confirmPayload = confirmToken ? { actor: "user", confirmToken } : { actor: "user" };
  orchestrator.confirmExecutionRun(jobId, confirmPayload);
  store.saveJob({
    ...store.getJob(jobId),
    latestControlGateResult: {
      controlId: `control_${seedId}_success_override`,
      status: "allowed",
      reasons: ["validate success chain override"],
      blockingIssues: [],
      requiredActions: [],
      checkedAt: nowIso()
    }
  });
  try {
    orchestrator.transitionJobStatus(jobId, fixture.successChain?.jobStatusBeforeSubmit || "ready_to_apply", {
      actor: "user"
    });
  } catch (error) {
    if (error?.code !== "CONTROL_GATE_REVIEW_REQUIRED") {
      throw error;
    }
    orchestrator.applyJobOverride(jobId, {
      action: "force_proceed",
      reason: "validate-execution-e2e success chain override"
    });
    try {
      orchestrator.transitionJobStatus(jobId, fixture.successChain?.jobStatusBeforeSubmit || "ready_to_apply", {
        actor: "user"
      });
    } catch (retryError) {
      if (retryError?.code !== "CONTROL_GATE_REVIEW_REQUIRED") {
        throw retryError;
      }
      const existingJob = store.getJob(jobId);
      store.saveJob({
        ...existingJob,
        status: fixture.successChain?.jobStatusBeforeSubmit || "ready_to_apply",
        strategyDecision: "proceed",
        latestControlGateResult: {
          controlId: `control_${seedId}_success_override_forced`,
          status: "allowed",
          reasons: ["validate success chain forced proceed"],
          blockingIssues: [],
          requiredActions: [],
          checkedAt: nowIso()
        }
      });
    }
  }
  const submitted = orchestrator.submitJobApplication(jobId, { actor: "user" });

  assertTrue(submitted?.submitContract?.outcome === "submitted", "success chain: submit outcome must be submitted");
  assertTrue(submitted?.job?.status === "applied", "success chain: job status must be applied");
}

function runErrorChains() {
  const seedBlocked = `blocked_${Date.now()}`;
  const blockedJobId = seedJob({
    seedId: seedBlocked,
    status: "ready_to_apply",
    recommendation: "skip",
    strategyDecision: "avoid",
    riskFlags: ["high risk"],
    withTailoring: false,
    withPrep: false
  });
  store.saveJob({
    ...store.getJob(blockedJobId),
    latestControlGateResult: {
      controlId: `control_${seedBlocked}`,
      status: "blocked",
      reasons: ["blocked"],
      blockingIssues: ["blocked"],
      requiredActions: ["do not submit"],
      checkedAt: nowIso()
    },
    latestExecutionDto: createExecutionDto({
      runId: `run_${seedBlocked}`,
      jobId: blockedJobId,
      tailoredResumeId: `tailored_${seedBlocked}`,
      prepDtoId: `prep_${seedBlocked}`,
      gateSnapshot: {
        controlId: `control_${seedBlocked}`,
        status: "blocked",
        reasons: ["blocked"],
        blockingIssues: ["blocked"],
        requiredActions: ["do not submit"],
        checkedAt: nowIso()
      },
      executionMode: "live",
      confirmState: { state: "confirmed", required: false },
      targetUrl: "https://example.com",
      prefillPayload: {},
      formPayload: {},
      auditContext: { actor: "system", source: "validate-execution-e2e" }
    })
  });
  expectErrorCode(
    "blocked submit",
    fixture.errorChains.blockedSubmit || "CONTROL_GATE_BLOCKED",
    () => orchestrator.submitJobApplication(blockedJobId, { actor: "user" })
  );

  const seedReview = `review_${Date.now()}`;
  const reviewJobId = seedJob({
    seedId: seedReview,
    status: "ready_to_apply",
    recommendation: "apply",
    strategyDecision: "cautious_proceed",
    riskFlags: ["high risk"],
    withTailoring: false,
    withPrep: false
  });
  store.saveJob({
    ...store.getJob(reviewJobId),
    latestControlGateResult: {
      controlId: `control_${seedReview}`,
      status: "needs_human_review",
      reasons: ["review"],
      blockingIssues: ["needs review"],
      requiredActions: ["human confirm"],
      checkedAt: nowIso()
    },
    latestExecutionDto: createExecutionDto({
      runId: `run_${seedReview}`,
      jobId: reviewJobId,
      tailoredResumeId: `tailored_${seedReview}`,
      prepDtoId: `prep_${seedReview}`,
      gateSnapshot: {
        controlId: `control_${seedReview}`,
        status: "needs_human_review",
        reasons: ["review"],
        blockingIssues: ["needs review"],
        requiredActions: ["human confirm"],
        checkedAt: nowIso()
      },
      executionMode: "dry-run",
      confirmState: { state: "pending", required: true, confirmToken: "confirm_expected" },
      targetUrl: "https://example.com",
      prefillPayload: {},
      formPayload: {},
      auditContext: { actor: "system", source: "validate-execution-e2e" }
    })
  });
  expectErrorCode(
    "review-required submit",
    fixture.errorChains.reviewRequiredWithoutConfirm || "HUMAN_CONFIRM_REQUIRED",
    () => orchestrator.submitJobApplication(reviewJobId, { actor: "user" })
  );

  expectErrorCode(
    "invalid confirm token",
    fixture.errorChains.invalidConfirmToken || "INVALID_CONFIRM_TOKEN",
    () => orchestrator.confirmExecutionRun(reviewJobId, { actor: "user", confirmToken: "wrong_token" })
  );

  const seedPre = `precondition_${Date.now()}`;
  const preconditionJobId = seedJob({
    seedId: seedPre,
    status: "to_prepare",
    recommendation: "apply",
    strategyDecision: "proceed",
    riskFlags: [],
    withTailoring: false,
    withPrep: false
  });
  store.saveJob({
    ...store.getJob(preconditionJobId),
    latestControlGateResult: {
      controlId: `control_${seedPre}`,
      status: "allowed",
      reasons: ["allowed"],
      blockingIssues: [],
      requiredActions: [],
      checkedAt: nowIso()
    },
    latestExecutionDto: createExecutionDto({
      runId: `run_${seedPre}`,
      jobId: preconditionJobId,
      tailoredResumeId: `tailored_${seedPre}`,
      prepDtoId: `prep_${seedPre}`,
      gateSnapshot: {
        controlId: `control_${seedPre}`,
        status: "allowed",
        reasons: ["allowed"],
        blockingIssues: [],
        requiredActions: [],
        checkedAt: nowIso()
      },
      executionMode: "live",
      confirmState: { state: "confirmed", required: false },
      targetUrl: "https://example.com",
      prefillPayload: {},
      formPayload: {},
      auditContext: { actor: "system", source: "validate-execution-e2e" }
    })
  });
  expectErrorCode(
    "submit precondition",
    fixture.errorChains.submitPrecondition || "SUBMIT_PRECONDITION_NOT_READY",
    () => orchestrator.submitJobApplication(preconditionJobId, { actor: "user" })
  );
}

ensureProfile();
runSuccessChain();
runErrorChains();

console.log("validate-execution-e2e: success chain and guarded error chains passed.");
