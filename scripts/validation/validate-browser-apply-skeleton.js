"use strict";

const fs = require("fs");
const path = require("path");

const {
  createBrowserApplySessionContract,
  validateBrowserApplySessionContract,
  validateBrowserSessionStatusTransition
} = require("../../src/lib/contracts/browser-apply-contracts");
const {
  createSiteAdapterDescriptor,
  validateSiteAdapterImplementation,
  ensureSiteAdapterContract
} = require("../../src/lib/browser/site-adapter-interface");
const {
  createBrowserExecutionBridgeInput,
  validateBrowserExecutionBridgeInput,
  createBrowserExecutionBridgeResult,
  validateBrowserExecutionBridgeResult,
  assertBrowserSubmitEligibility,
  validateBrowserBridgeBoundary
} = require("../../src/lib/browser/browser-apply-bridge");
const { buildBrowserApplyViewModel } = require("../../src/lib/browser/browser-apply-view-model");
const { createExecutionDto } = require("../../src/lib/contracts/execution-contracts");

const fixturePath = path.resolve(process.cwd(), "scripts/fixtures/browser-apply-skeleton-fixture.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function assertValid(label, validation) {
  if (!validation.ok) throw new Error(`${label} failed: ${validation.errors.join("; ")}`);
}

function assertInvalid(label, validation, expectedSubstring) {
  if (validation.ok) throw new Error(`${label} should fail but passed`);
  const joined = validation.errors.join("; ");
  if (!joined.includes(expectedSubstring)) {
    throw new Error(`${label} failed with unexpected errors: ${joined}`);
  }
}

function expectErrorCode(label, expectedCode, fn) {
  try {
    fn();
  } catch (error) {
    if (error && error.code === expectedCode) return;
    throw new Error(`${label} expected ${expectedCode}, got ${error?.code || "unknown"}`);
  }
  throw new Error(`${label} expected ${expectedCode}, but no error was thrown`);
}

function createMockAdapter() {
  return {
    descriptor: createSiteAdapterDescriptor({
      adapterId: "generic_html_form",
      version: "v1",
      capabilities: {
        supportedFieldKeys: ["name", "email", "phone", "resume_upload", "summary"],
        supportsFileUpload: true
      }
    }),
    detect() {
      return { detected: true, confidence: 0.8 };
    },
    mapFields() {
      return { mappedFields: ["name", "email"] };
    },
    fill() {
      return { status: "prefilled" };
    },
    collectEvidence() {
      return { evidenceRefs: ["browser://evidence/mock.json"] };
    }
  };
}

function runSessionContractChecks() {
  const baseSession = createBrowserApplySessionContract({
    ...fixture.sessionBase,
    status: "created",
    gateStatus: "allowed",
    confirmState: "pending"
  });
  assertValid("base session", validateBrowserApplySessionContract(baseSession));

  const validPath = fixture.transitionCases.validPath || [];
  for (let index = 0; index < validPath.length - 1; index += 1) {
    const from = validPath[index];
    const to = validPath[index + 1];
    assertValid(`status transition ${from}->${to}`, validateBrowserSessionStatusTransition(from, to));
  }

  const invalidPath = fixture.transitionCases.invalidFromCreatedToSubmitted || [];
  assertInvalid(
    "invalid status transition created->submitted",
    validateBrowserSessionStatusTransition(invalidPath[0], invalidPath[1]),
    "illegal status transition"
  );
}

function runAdapterInterfaceChecks() {
  const mockAdapter = createMockAdapter();
  assertValid("valid site adapter", validateSiteAdapterImplementation(mockAdapter));
  ensureSiteAdapterContract(mockAdapter);

  const invalidAdapter = {
    descriptor: {
      adapterId: "invalid_adapter",
      version: "v1",
      capabilities: {
        supportedFieldKeys: [],
        supportsFileUpload: true,
        supportsSubmit: true
      }
    },
    detect() {},
    mapFields() {},
    fill() {},
    collectEvidence() {},
    submit() {}
  };
  assertInvalid(
    "invalid site adapter",
    validateSiteAdapterImplementation(invalidAdapter),
    "capabilities.supportsSubmit must be false"
  );
}

function runExecutionBridgeChecks() {
  const executionDto = createExecutionDto(fixture.bridgeFixture.executionDto || {});
  const bridgeInput = createBrowserExecutionBridgeInput({
    executionDto,
    listingId: fixture.sessionBase.listingId
  });
  assertValid("bridge input", validateBrowserExecutionBridgeInput(bridgeInput));

  const readySession = createBrowserApplySessionContract({
    ...fixture.sessionBase,
    status: "ready_for_confirm",
    gateStatus: "allowed",
    confirmState: "pending"
  });
  const readyResult = createBrowserExecutionBridgeResult({
    bridgeInput,
    session: readySession
  });
  assertValid("bridge result ready_for_confirm", validateBrowserExecutionBridgeResult(readyResult));
  assertTrue(!readyResult.submitEligible, "ready_for_confirm must not be submit eligible");
  assertTrue(
    readyResult.nextAction === "request_human_confirm",
    "ready_for_confirm must request human confirm"
  );
  expectErrorCode("submit eligibility should block unconfirmed", "BROWSER_SUBMIT_NOT_ELIGIBLE", () =>
    assertBrowserSubmitEligibility(readyResult)
  );

  const confirmedSession = createBrowserApplySessionContract({
    ...fixture.sessionBase,
    status: "confirmed",
    gateStatus: "allowed",
    confirmState: "confirmed"
  });
  const confirmedResult = createBrowserExecutionBridgeResult({
    bridgeInput: { ...bridgeInput, confirmState: "confirmed", gateStatus: "allowed" },
    session: confirmedSession
  });
  assertValid("bridge result confirmed", validateBrowserExecutionBridgeResult(confirmedResult));
  assertTrue(confirmedResult.submitEligible, "confirmed + allowed must be submit eligible");
  assertTrue(confirmedResult.nextAction === "ready_for_submit", "confirmed should be ready_for_submit");
  assertBrowserSubmitEligibility(confirmedResult);

  const blockedResult = createBrowserExecutionBridgeResult({
    bridgeInput: { ...bridgeInput, gateStatus: "blocked", blockingIssues: ["policy blocked"] },
    session: {
      ...confirmedSession,
      gateStatus: "blocked",
      status: "submit_blocked",
      failureReason: "blocked by gate"
    }
  });
  assertValid("bridge result blocked", validateBrowserExecutionBridgeResult(blockedResult));
  assertTrue(!blockedResult.submitEligible, "blocked gate must not be submit eligible");
  assertTrue(blockedResult.nextAction === "submit_blocked", "blocked gate should force submit_blocked");

  const boundaryValidation = validateBrowserBridgeBoundary({
    bridgeInput,
    session: confirmedSession,
    bridgeResult: confirmedResult
  });
  assertValid("bridge boundary validation", boundaryValidation);
}

function runViewModelChecks() {
  const session = createBrowserApplySessionContract({
    ...fixture.sessionBase,
    status: "ready_for_confirm",
    gateStatus: "allowed",
    confirmState: "pending"
  });
  const bridgeResult = createBrowserExecutionBridgeResult({
    bridgeInput: {
      runId: "run_browser_001",
      jobId: "job_browser_001",
      listingId: "listing_browser_001",
      targetUrl: "https://example.com/apply/123",
      gateStatus: "allowed",
      confirmState: "pending",
      requiredActions: [],
      blockingIssues: []
    },
    session
  });
  const viewModel = buildBrowserApplyViewModel({ session, bridgeResult });
  assertTrue(viewModel.status === "ready_for_confirm", "view model should expose session status");
  assertTrue(Array.isArray(viewModel.fieldSummary.filledFields), "view model should expose field summary");
  assertTrue(!Object.prototype.hasOwnProperty.call(viewModel, "domSnapshot"), "view model must not expose raw DOM fields");
}

runSessionContractChecks();
runAdapterInterfaceChecks();
runExecutionBridgeChecks();
runViewModelChecks();

console.log("validate-browser-apply-skeleton: session contract, adapter interface, execution bridge boundary, and view model checks passed.");

