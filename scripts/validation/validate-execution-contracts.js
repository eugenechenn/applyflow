"use strict";

const fs = require("fs");
const path = require("path");
const { runWithRequestContext } = require("../../src/server/request-context");
const orchestrator = require("../../src/lib/orchestrator/workflow-controller");
const {
  createExecutionDto,
  validateExecutionDto,
  createSubmitContract,
  validateSubmitContract
} = require("../../src/lib/contracts/execution-contracts");

const contractFixturePath = path.resolve(process.cwd(), "scripts/fixtures/execution-contract-fixture.json");
const scenarioFixturePath = path.resolve(process.cwd(), "scripts/fixtures/execution-scenarios-fixture.json");

const contractFixture = JSON.parse(fs.readFileSync(contractFixturePath, "utf8"));
const scenariosFixture = JSON.parse(fs.readFileSync(scenarioFixturePath, "utf8"));

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function assertValid(label, validation) {
  if (!validation.ok) {
    throw new Error(`${label} failed: ${validation.errors.join("; ")}`);
  }
}

function assertInvalid(label, validation, expectedSubstring) {
  if (validation.ok) {
    throw new Error(`${label} should fail but passed.`);
  }
  const joined = validation.errors.join("; ");
  if (!joined.includes(expectedSubstring)) {
    throw new Error(`${label} failed with unexpected errors: ${joined}`);
  }
}

function expectErrorCode(label, expectedCode, fn) {
  try {
    fn();
  } catch (error) {
    if (error && error.code === expectedCode) {
      return;
    }
    throw new Error(`${label} expected error code ${expectedCode}, got ${error?.code || "unknown"}`);
  }
  throw new Error(`${label} expected error code ${expectedCode}, but no error was thrown.`);
}

function createInMemoryOverrideStore() {
  const jobsById = new Map();
  const fitByJobId = new Map();

  return {
    getJob(jobId) {
      return jobsById.get(jobId) || null;
    },
    saveJob(job) {
      jobsById.set(job.id, { ...job });
      return jobsById.get(job.id);
    },
    listJobs() {
      return Array.from(jobsById.values());
    },
    getFitAssessmentByJobId(jobId) {
      return fitByJobId.get(jobId) || null;
    },
    saveFitAssessment(fitAssessment) {
      fitByJobId.set(fitAssessment.jobId, { ...fitAssessment });
      return fitByJobId.get(fitAssessment.jobId);
    }
  };
}

function buildGate(status, options = {}) {
  return {
    controlId: options.controlId || `control_${status || "none"}`,
    status: status || "",
    reasons: Array.isArray(options.reasons) ? options.reasons : [],
    blockingIssues: Array.isArray(options.blockingIssues) ? options.blockingIssues : [],
    requiredActions: Array.isArray(options.requiredActions) ? options.requiredActions : [],
    checkedAt: options.checkedAt || "2026-04-20T10:00:00.000Z"
  };
}

function buildExecutionSnapshot({
  jobId,
  gateStatus = "allowed",
  confirmState = "confirmed",
  confirmRequired = false,
  confirmToken = ""
} = {}) {
  return createExecutionDto({
    runId: `run_${jobId}`,
    jobId,
    tailoredResumeId: `tailored_${jobId}`,
    prepDtoId: `prep_${jobId}`,
    prepVersion: 1,
    gateSnapshot: buildGate(gateStatus, {
      reasons: gateStatus === "allowed" ? ["Allowed by control gate."] : ["Needs review or blocked."],
      blockingIssues: gateStatus === "blocked" ? ["blocked"] : [],
      requiredActions: gateStatus === "needs_human_review" ? ["manual review"] : []
    }),
    executionMode: confirmState === "confirmed" ? "live" : "dry-run",
    confirmState: {
      state: confirmState,
      required: confirmRequired,
      confirmToken,
      confirmedBy: confirmState === "confirmed" ? "user" : "",
      confirmedAt: confirmState === "confirmed" ? "2026-04-20T10:01:00.000Z" : null
    },
    targetUrl: "https://example.com/jobs/runtime",
    prefillPayload: {},
    formPayload: {},
    auditContext: {
      actor: "system",
      source: "validate-execution-contracts"
    },
    trace: {
      runId: `run_${jobId}`,
      source: "validate-execution-contracts",
      createdBy: "system"
    },
    createdAt: "2026-04-20T10:00:00.000Z",
    updatedAt: "2026-04-20T10:00:00.000Z"
  });
}

function saveRuntimeJob(overrideStore, scenario) {
  const job = {
    id: scenario.jobId,
    title: "Validation Role",
    company: "ApplyFlow QA",
    location: "Shanghai",
    jobUrl: "https://example.com/jobs/runtime",
    status: scenario.status,
    priority: "medium",
    strategyDecision: "proceed",
    createdAt: "2026-04-20T09:58:00.000Z",
    updatedAt: "2026-04-20T09:58:00.000Z",
    latestExecutionDto: buildExecutionSnapshot({
      jobId: scenario.jobId,
      gateStatus: scenario.gateStatus || "allowed",
      confirmState: scenario.confirmState || "confirmed",
      confirmRequired: scenario.gateStatus === "needs_human_review",
      confirmToken: scenario.confirmState === "pending" ? "confirm_expected_token" : ""
    })
  };

  if (scenario.gateStatus) {
    job.latestControlGateResult = buildGate(scenario.gateStatus, {
      reasons: scenario.gateStatus === "allowed" ? ["allowed"] : ["guarded"],
      blockingIssues: scenario.gateStatus === "blocked" ? ["blocked by policy"] : [],
      requiredActions: scenario.gateStatus === "needs_human_review" ? ["human review"] : []
    });
  }

  overrideStore.saveJob(job);
  overrideStore.saveFitAssessment({
    id: `fit_${scenario.jobId}`,
    jobId: scenario.jobId,
    profileId: "user_validate_execution",
    fitScore: 72,
    recommendation: scenario.gateStatus === "blocked" ? "skip" : "apply",
    strategyDecision: scenario.gateStatus === "needs_human_review" ? "cautious_proceed" : "proceed",
    strategyReasoning: "Validation fit assessment",
    whyApply: ["evidence one"],
    keyGaps: [],
    riskFlags: scenario.gateStatus === "needs_human_review" ? ["high risk"] : [],
    createdAt: "2026-04-20T09:58:00.000Z",
    updatedAt: "2026-04-20T09:58:00.000Z"
  });
}

function runContractFixtureChecks() {
  const executionDto = createExecutionDto(contractFixture.executionDto || {});
  assertValid("executionDto fixture", validateExecutionDto(executionDto));

  const submitContract = createSubmitContract(contractFixture.submitContract || {});
  assertValid("submitContract fixture", validateSubmitContract(submitContract));

  assertTrue(submitContract.runId === executionDto.runId, "submitContract.runId must match executionDto.runId");
  assertTrue(submitContract.jobId === executionDto.jobId, "submitContract.jobId must match executionDto.jobId");
}

function runScenarioContractChecks() {
  const successCase = scenariosFixture.successCase || {};
  const dryRunDto = createExecutionDto(successCase.executionDryRun || {});
  assertValid("successCase.executionDryRun", validateExecutionDto(dryRunDto));

  const confirmDto = createExecutionDto({
    ...dryRunDto,
    executionMode: "live",
    confirmState: {
      ...dryRunDto.confirmState,
      state: "confirmed",
      required: false,
      confirmedBy: "user",
      confirmedAt: "2026-04-20T09:01:30.000Z"
    },
    updatedAt: "2026-04-20T09:01:30.000Z"
  });
  assertValid("successCase.confirmedExecution", validateExecutionDto(confirmDto));

  const submit = createSubmitContract(successCase.submit || {});
  assertValid("successCase.submit", validateSubmitContract(submit));

  const invalidCases = scenariosFixture.invalidContractCases || {};

  assertInvalid(
    "invalidContractCases.executionModeInvalid",
    validateExecutionDto(invalidCases.executionModeInvalid?.dto || {}),
    invalidCases.executionModeInvalid?.expectedErrorContains || "executionMode is invalid"
  );

  assertInvalid(
    "invalidContractCases.missingGateSnapshot",
    validateExecutionDto(invalidCases.missingGateSnapshot?.dto || {}),
    invalidCases.missingGateSnapshot?.expectedErrorContains || "gateSnapshot must be an object"
  );

  assertInvalid(
    "invalidContractCases.submitUnconfirmed",
    validateSubmitContract(invalidCases.submitUnconfirmed?.contract || {}),
    invalidCases.submitUnconfirmed?.expectedErrorContains || "confirmState must be confirmed when outcome is submitted"
  );

  assertInvalid(
    "invalidContractCases.dtoTypeError",
    validateExecutionDto(invalidCases.dtoTypeError?.dto || {}),
    invalidCases.dtoTypeError?.expectedErrorContains || "gateSnapshot.reasons must be an array"
  );
}

function runRuntimeGuardChecks() {
  const runtimeScenarios = scenariosFixture.runtimeGuardScenarios || {};
  const overrideStore = createInMemoryOverrideStore();

  Object.values(runtimeScenarios).forEach((scenario) => {
    if (scenario && scenario.jobId && scenario.status) {
      saveRuntimeJob(overrideStore, scenario);
    }
  });

  runWithRequestContext(
    {
      userId: "user_validate_execution",
      overrideStore
    },
    () => {
      const blockedSubmit = runtimeScenarios.blockedSubmit;
      expectErrorCode("blockedSubmit", blockedSubmit.expectedErrorCode, () =>
        orchestrator.submitJobApplication(blockedSubmit.jobId, { actor: "user" })
      );

      const reviewRequiredSubmit = runtimeScenarios.reviewRequiredSubmit;
      expectErrorCode("reviewRequiredSubmit", reviewRequiredSubmit.expectedErrorCode, () =>
        orchestrator.submitJobApplication(reviewRequiredSubmit.jobId, { actor: "user" })
      );

      const submitPreconditionError = runtimeScenarios.submitPreconditionError;
      expectErrorCode("submitPreconditionError", submitPreconditionError.expectedErrorCode, () =>
        orchestrator.submitJobApplication(submitPreconditionError.jobId, { actor: "user" })
      );

      const missingGateSnapshot = runtimeScenarios.missingGateSnapshot;
      expectErrorCode("missingGateSnapshot", missingGateSnapshot.expectedErrorCode, () =>
        orchestrator.submitJobApplication(missingGateSnapshot.jobId, { actor: "user" })
      );

      const invalidConfirmToken = runtimeScenarios.invalidConfirmToken;
      const badTokenJob = {
        id: invalidConfirmToken.jobId,
        title: "Validation Role",
        company: "ApplyFlow QA",
        status: invalidConfirmToken.status,
        priority: "medium",
        createdAt: "2026-04-20T10:00:00.000Z",
        updatedAt: "2026-04-20T10:00:00.000Z",
        latestExecutionDto: buildExecutionSnapshot({
          jobId: invalidConfirmToken.jobId,
          gateStatus: "needs_human_review",
          confirmState: "pending",
          confirmRequired: true,
          confirmToken: "confirm_expected_token"
        })
      };
      overrideStore.saveJob(badTokenJob);
      expectErrorCode("invalidConfirmToken", invalidConfirmToken.expectedErrorCode, () =>
        orchestrator.confirmExecutionRun(invalidConfirmToken.jobId, {
          actor: "user",
          confirmToken: "wrong_token"
        })
      );

      const missingSubmitContract = runtimeScenarios.missingSubmitContract;
      const transitionJob = {
        id: missingSubmitContract.jobId,
        title: "Validation Role",
        company: "ApplyFlow QA",
        status: missingSubmitContract.status,
        priority: "medium",
        createdAt: "2026-04-20T10:00:00.000Z",
        updatedAt: "2026-04-20T10:00:00.000Z"
      };
      overrideStore.saveJob(transitionJob);
      expectErrorCode("missingSubmitContract", missingSubmitContract.expectedErrorCode, () =>
        orchestrator.transitionJobStatus(missingSubmitContract.jobId, "applied", {
          source: "submit_contract",
          actor: "user"
        })
      );
    }
  );
}

runContractFixtureChecks();
runScenarioContractChecks();
runRuntimeGuardChecks();

console.log("validate-execution-contracts: contract + runtime scenario guards passed.");
