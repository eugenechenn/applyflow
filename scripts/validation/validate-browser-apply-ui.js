"use strict";

const fs = require("fs");
const path = require("path");
const { runWithRequestContext } = require("../../src/server/request-context");
const orchestrator = require("../../src/lib/orchestrator/workflow-controller");
const { createExecutionDto } = require("../../src/lib/contracts/execution-contracts");

const fixturePath = path.resolve(process.cwd(), "scripts/fixtures/browser-apply-ui-fixture.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectErrorCode(label, expectedCode, fn) {
  try {
    await fn();
  } catch (error) {
    if (error && error.code === expectedCode) return;
    throw new Error(`${label} expected ${expectedCode}, got ${error?.code || "unknown"}`);
  }
  throw new Error(`${label} expected ${expectedCode}, but no error was thrown`);
}

function createOverrideStore() {
  const jobs = new Map();
  const activityLogs = [];
  return {
    getJob(jobId) {
      return jobs.get(jobId) || null;
    },
    saveJob(job) {
      jobs.set(job.id, { ...job });
      return jobs.get(job.id);
    },
    saveActivityLog(log) {
      activityLogs.push({ ...log });
      return log;
    },
    listActivityLogsByJobId(jobId) {
      return activityLogs.filter((log) => log.jobId === jobId);
    }
  };
}

function seedJob(store, { withExecution = true } = {}) {
  const base = {
    id: fixture.jobId,
    company: "ApplyFlow Labs",
    title: "AI Product Manager",
    location: "Shanghai",
    jobUrl: fixture.targetUrl,
    status: "ready_to_apply",
    priority: "high",
    shortlistAdmission: { listingId: fixture.listingId },
    latestControlGateResult: {
      controlId: "control_browser_ui_001",
      status: "allowed",
      reasons: ["allowed by policy"],
      blockingIssues: [],
      requiredActions: [],
      checkedAt: "2026-04-22T08:00:00.000Z",
      trace: { runId: "run_browser_ui_001", source: "validate-browser-apply-ui" }
    },
    createdAt: "2026-04-22T08:00:00.000Z",
    updatedAt: "2026-04-22T08:00:00.000Z"
  };

  if (withExecution) {
    base.latestExecutionDto = createExecutionDto({
      runId: "run_browser_ui_001",
      jobId: fixture.jobId,
      tailoredResumeId: "tailored_browser_ui_001",
      prepDtoId: "prep_browser_ui_001",
      prepVersion: 1,
      gateSnapshot: {
        controlId: "control_browser_ui_001",
        status: "allowed",
        reasons: ["allowed by policy"],
        blockingIssues: [],
        requiredActions: [],
        checkedAt: "2026-04-22T08:00:00.000Z"
      },
      executionMode: "dry-run",
      confirmState: {
        state: "pending",
        required: true,
        confirmToken: "confirm_browser_ui_001",
        confirmedBy: "",
        confirmedAt: null
      },
      targetUrl: fixture.targetUrl,
      prefillPayload: fixture.prefillPayload,
      formPayload: {},
      admissionContext: {
        listingId: fixture.listingId
      },
      auditContext: {
        actor: "system",
        source: "validate-browser-apply-ui"
      },
      trace: {
        runId: "run_browser_ui_001",
        source: "validate-browser-apply-ui",
        createdBy: "system"
      },
      createdAt: "2026-04-22T08:00:00.000Z",
      updatedAt: "2026-04-22T08:00:00.000Z"
    });
  }

  store.saveJob(base);
}

function assertViewModelBoundary(viewModel = {}) {
  assertTrue(Boolean(viewModel.sessionId), "sessionId should exist");
  assertTrue(Boolean(viewModel.status), "status should exist");
  assertTrue(Boolean(viewModel.supportedAdapter), "supportedAdapter should exist");
  assertTrue(viewModel.fieldSummary && typeof viewModel.fieldSummary === "object", "fieldSummary should exist");
  assertTrue(Array.isArray(viewModel.fieldSummary.filledFields), "filledFields should be array");
  assertTrue(Array.isArray(viewModel.fieldSummary.unfilledFields), "unfilledFields should be array");
  assertTrue(Array.isArray(viewModel.fieldSummary.unsupportedFields), "unsupportedFields should be array");
  assertTrue(
    !Object.prototype.hasOwnProperty.call(viewModel, "snapshot") &&
      !Object.prototype.hasOwnProperty.call(viewModel, "formSnapshot") &&
      !Object.prototype.hasOwnProperty.call(viewModel, "dom"),
    "viewModel must not expose raw browser fields"
  );
}

const overrideStore = createOverrideStore();
seedJob(overrideStore, { withExecution: true });

runWithRequestContext({ userId: "user_validate_browser_ui", overrideStore }, async () => {
  const readyResult = await orchestrator.runBrowserApplySession(fixture.jobId, {
    actor: "user",
    simulationMode: "standard"
  });
  assertTrue(readyResult.browserApplyViewModel.status === "ready_for_confirm", "standard mode should be ready_for_confirm");
  assertViewModelBoundary(readyResult.browserApplyViewModel);

  const reviewResult = await orchestrator.runBrowserApplySession(fixture.jobId, {
    actor: "user",
    simulationMode: "no_form"
  });
  assertTrue(reviewResult.browserApplyViewModel.status === "review_required", "no_form mode should be review_required");
  assertTrue(Boolean(reviewResult.browserApplyViewModel.blockingReason), "review_required should include blocking reason");
  assertViewModelBoundary(reviewResult.browserApplyViewModel);

  const blockedResult = await orchestrator.runBrowserApplySession(fixture.jobId, {
    actor: "user",
    simulationMode: "blocked"
  });
  assertTrue(blockedResult.browserApplyViewModel.status === "review_required", "blocked mode should be review_required");
  assertTrue(
    /Captcha|captcha|unsupported|requires/.test(blockedResult.browserApplyViewModel.blockingReason),
    "blocked mode should include complexity reason"
  );

  const noExecutionStore = createOverrideStore();
  seedJob(noExecutionStore, { withExecution: false });
  await expectErrorCode("missing execution run", "EXECUTION_RUN_REQUIRED", async () => {
    await runWithRequestContext({ userId: "user_validate_browser_ui_2", overrideStore: noExecutionStore }, async () => {
      await orchestrator.runBrowserApplySession(fixture.jobId, { actor: "user", simulationMode: "standard" });
    });
  });

  console.log("validate-browser-apply-ui: BrowserApplyViewModel UI boundary and session states passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
