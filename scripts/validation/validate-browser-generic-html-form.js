"use strict";

const fs = require("fs");
const path = require("path");

const { validateSiteAdapterImplementation } = require("../../src/lib/browser/site-adapter-interface");
const { genericHtmlFormAdapter } = require("../../src/lib/browser/adapters/generic-html-form-adapter");
const { runGenericHtmlFormSession } = require("../../src/lib/browser/browser-apply-session-runner");
const {
  createBrowserExecutionBridgeResult,
  assertBrowserSubmitEligibility
} = require("../../src/lib/browser/browser-apply-bridge");

const fixturePath = path.resolve(process.cwd(), "scripts/fixtures/browser-generic-html-form-fixture.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function assertValid(label, validation) {
  if (!validation.ok) throw new Error(`${label} failed: ${validation.errors.join("; ")}`);
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

function createMockPage(snapshot, options = {}) {
  const calls = [];
  return {
    calls,
    async getFormSnapshot() {
      return snapshot;
    },
    async fillField(selector, value) {
      calls.push({ type: "fillField", selector, value });
      if (options.failSelectors && options.failSelectors.includes(selector)) {
        throw new Error(`Mock fill failure for selector: ${selector}`);
      }
    },
    async uploadFile(selector, filePath) {
      calls.push({ type: "uploadFile", selector, filePath });
      if (!filePath) throw new Error("Mock upload requires filePath");
    },
    async collectEvidence() {
      return {
        currentUrl: snapshot.sourceUrl || "",
        pageTitle: snapshot.pageTitle || "",
        screenshotRefs: ["browser://shots/generic-form.png"],
        evidenceRefs: ["browser://evidence/generic-form.json"],
        notes: ["mock evidence"]
      };
    }
  };
}

function findFieldResult(results = [], fieldKey = "") {
  return (Array.isArray(results) ? results : []).find((entry) => entry.fieldKey === fieldKey) || null;
}

async function runStandardFormCase() {
  const page = createMockPage(fixture.standardFormSnapshot);
  const run = await runGenericHtmlFormSession({
    bridgeInput: fixture.bridgeInput,
    page,
    adapter: genericHtmlFormAdapter
  });

  assertTrue(
    run.session.status === "ready_for_confirm",
    "standard form should reach ready_for_confirm with full whitelist fields"
  );
  assertTrue(Array.isArray(run.session.fieldFillResults), "session.fieldFillResults should be an array");

  const nameResult = findFieldResult(run.session.fieldFillResults, "name");
  const emailResult = findFieldResult(run.session.fieldFillResults, "email");
  const phoneResult = findFieldResult(run.session.fieldFillResults, "phone");
  const resumeResult = findFieldResult(run.session.fieldFillResults, "resume_upload");
  const summaryResult = findFieldResult(run.session.fieldFillResults, "summary");

  assertTrue(nameResult?.outcome === "filled", "name should be filled");
  assertTrue(emailResult?.outcome === "filled", "email should be filled");
  assertTrue(phoneResult?.outcome === "filled", "phone should be filled");
  assertTrue(resumeResult?.outcome === "filled", "resume upload should be filled");
  assertTrue(summaryResult?.outcome === "filled", "summary should be filled");

  const uploadCall = page.calls.find((call) => call.type === "uploadFile");
  assertTrue(Boolean(uploadCall), "resume upload should invoke uploadFile");

  const unsupportedPortfolio = run.session.fieldFillResults.find(
    (entry) => entry.fieldKey === "portfolio_url" || /portfolio/i.test(entry.reason || "")
  );
  assertTrue(!unsupportedPortfolio, "non-whitelist fields should not be mapped as supported keys");

  assertTrue(
    Array.isArray(run.session.artifacts.evidenceRefs) && run.session.artifacts.evidenceRefs.length > 0,
    "evidence refs should exist"
  );

  return run;
}

async function runMissingOrUnsupportedFieldCase() {
  const reducedSnapshot = {
    ...fixture.standardFormSnapshot,
    fields: (fixture.standardFormSnapshot.fields || []).filter((field) => field.name !== "phone")
  };
  const page = createMockPage(reducedSnapshot);
  const run = await runGenericHtmlFormSession({
    bridgeInput: fixture.bridgeInput,
    page,
    adapter: genericHtmlFormAdapter
  });
  assertTrue(run.session.status === "review_required", "missing whitelist fields should require review");
  const phoneResult = findFieldResult(run.session.fieldFillResults, "phone");
  assertTrue(phoneResult?.outcome === "unsupported", "missing phone field should become unsupported");
}

async function runNoFormCase() {
  const page = createMockPage(fixture.noFormSnapshot);
  const run = await runGenericHtmlFormSession({
    bridgeInput: fixture.bridgeInput,
    page,
    adapter: genericHtmlFormAdapter
  });
  assertTrue(run.session.status === "review_required", "no-form case should be review_required");
  assertTrue(/No compatible form detected|No compatible field/.test(run.session.failureReason), "no-form should have reason");
}

async function runBlockedCase() {
  const page = createMockPage(fixture.blockedSnapshot);
  const run = await runGenericHtmlFormSession({
    bridgeInput: fixture.bridgeInput,
    page,
    adapter: genericHtmlFormAdapter
  });
  assertTrue(run.session.status === "review_required", "blocked complexity should be review_required");
  assertTrue(/hasCaptcha|requiresLogin/.test(run.session.failureReason), "blocked reason should include complexity flags");
}

function runSubmitEligibilityGuardCase(sessionFromStandardCase) {
  const bridgeResult = createBrowserExecutionBridgeResult({
    bridgeInput: {
      ...fixture.bridgeInput,
      confirmState: "pending",
      gateStatus: "allowed"
    },
    session: sessionFromStandardCase.session
  });
  assertTrue(bridgeResult.submitEligible === false, "pending confirm must keep submitEligible=false");
  expectErrorCode("bridge guard pending confirm", "BROWSER_SUBMIT_NOT_ELIGIBLE", () =>
    assertBrowserSubmitEligibility(bridgeResult)
  );
}

async function main() {
  assertValid("generic_html_form adapter contract", validateSiteAdapterImplementation(genericHtmlFormAdapter));
  const standardCase = await runStandardFormCase();
  await runMissingOrUnsupportedFieldCase();
  await runNoFormCase();
  await runBlockedCase();
  runSubmitEligibilityGuardCase(standardCase);
  console.log(
    "validate-browser-generic-html-form: detect/map/fill/evidence + no-form/blocked routing + submit guard checks passed."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
