"use strict";

/**
 * Phase 8D-1 准入验证：旧 scoring payload explainability 兼容性只读校验。
 */
const fs = require("fs");
const path = require("path");
const { attachScoringToJobWorkspaceViewModel } = require("../../src/lib/jobs/job-scoring-view-model");

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/legacy-explainability-payload-fixture.json");
const TARGET_FIELDS = [
  "recommendationReasonSummary",
  "blockerReasonSummary",
  "sourceRiskSummary",
  "confidenceExplanation",
  "preferenceDriftSummary"
];
const FEEDBACK_TARGET_FIELDS = [
  "feedbackSignalType",
  "feedbackConfidence",
  "feedbackRecencyTier",
  "feedbackConsistency",
  "feedbackConflictRisk"
];
const JOB_FEATURES_LEGACY_REMOVED_FIELDS = ["rolePurity", "sourceFreshnessTier"];

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function readFixture() {
  const raw = fs.readFileSync(FIXTURE_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const cases = Array.isArray(parsed?.cases) ? parsed.cases : [];
  const feedbackCases = Array.isArray(parsed?.feedbackCases) ? parsed.feedbackCases : [];
  const jobFeaturesCases = Array.isArray(parsed?.jobFeaturesCases) ? parsed.jobFeaturesCases : [];
  assertTrue(cases.length > 0, "fixture cases should not be empty");
  assertTrue(feedbackCases.length > 0, "fixture feedbackCases should not be empty");
  assertTrue(jobFeaturesCases.length > 0, "fixture jobFeaturesCases should not be empty");
  return { cases, feedbackCases, jobFeaturesCases };
}

function buildBaseWorkspaceViewModel() {
  return {
    id: "job_fixture_legacy_payload",
    jobSummary: {
      title: "Data Analyst",
      company: "ApplyFlow Fixture Inc",
      location: "Shanghai"
    },
    decisionView: {}
  };
}

function verifyCase(testCase = {}) {
  const baseVm = buildBaseWorkspaceViewModel();
  const normalized = attachScoringToJobWorkspaceViewModel(baseVm, testCase?.scoringView || {});
  const scoring = normalized?.scoringView || {};
  const explainability = scoring?.explainabilityFeatures || {};
  assertTrue(explainability && typeof explainability === "object", `case=${testCase.id} explainabilityFeatures should exist`);

  TARGET_FIELDS.forEach((field) => {
    const expected = String(testCase?.expected?.[field] || "");
    const topLevelValue = String(scoring?.[field] || "");
    const containerValue = String(explainability?.[field] || "");
    assertTrue(containerValue === expected, `case=${testCase.id} container ${field} mismatch`);
    assertTrue(topLevelValue === "", `case=${testCase.id} top-level ${field} should be removed in batch 8d-1 output`);
  });
}

function verifyFeedbackCase(testCase = {}) {
  const baseVm = buildBaseWorkspaceViewModel();
  const normalized = attachScoringToJobWorkspaceViewModel(baseVm, testCase?.scoringView || {});
  const scoring = normalized?.scoringView || {};
  const feedback = scoring?.feedbackGovernanceFeatures || {};
  assertTrue(feedback && typeof feedback === "object", `case=${testCase.id} feedbackGovernanceFeatures should exist`);

  FEEDBACK_TARGET_FIELDS.forEach((field) => {
    const expected = String(testCase?.expected?.[field] || "");
    const topLevelValue = String(scoring?.[field] || "");
    const containerValue = String(feedback?.[field] || "");
    assertTrue(containerValue === expected, `case=${testCase.id} feedback container ${field} mismatch`);
    assertTrue(topLevelValue === "", `case=${testCase.id} feedback top-level ${field} should be removed in batch 8d-2 output`);
  });

  const expectedEvolutionCandidate = Boolean(testCase?.expected?.preferenceEvolutionCandidate);
  assertTrue(
    Boolean(feedback?.preferenceEvolutionCandidate) === expectedEvolutionCandidate,
    `case=${testCase.id} feedback container preferenceEvolutionCandidate mismatch`
  );
  assertTrue(
    String(scoring?.preferenceEvolutionCandidate || "") === "",
    `case=${testCase.id} feedback top-level preferenceEvolutionCandidate should be removed in batch 8d-2 output`
  );
}

function verifyJobFeaturesCase(testCase = {}) {
  const baseVm = buildBaseWorkspaceViewModel();
  const normalized = attachScoringToJobWorkspaceViewModel(baseVm, testCase?.scoringView || {});
  const scoring = normalized?.scoringView || {};
  const features = scoring?.jobFeaturesView || {};
  const modules = features?.featureLayerModules || {};
  const semanticFeatures = modules?.semanticFeatures || {};
  const sourceGovernanceFeatures = modules?.sourceGovernanceFeatures || {};

  assertTrue(features && typeof features === "object", `case=${testCase.id} jobFeaturesView should exist`);
  assertTrue(modules && typeof modules === "object", `case=${testCase.id} featureLayerModules should exist`);
  assertTrue(semanticFeatures && typeof semanticFeatures === "object", `case=${testCase.id} semanticFeatures should exist`);
  assertTrue(sourceGovernanceFeatures && typeof sourceGovernanceFeatures === "object", `case=${testCase.id} sourceGovernanceFeatures should exist`);

  JOB_FEATURES_LEGACY_REMOVED_FIELDS.forEach((field) => {
    const actual = String(features?.[field] || "");
    assertTrue(actual === "", `case=${testCase.id} jobFeaturesView.${field} should be removed in batch 8d-3 output`);
  });

  assertTrue(
    String(semanticFeatures?.rolePurityLegacy || "") === String(testCase?.expected?.semanticRolePurityLegacy || ""),
    `case=${testCase.id} semanticFeatures.rolePurityLegacy mismatch`
  );
  assertTrue(
    String(semanticFeatures?.roleSemanticPurity || "") === String(testCase?.expected?.semanticRoleSemanticPurity || ""),
    `case=${testCase.id} semanticFeatures.roleSemanticPurity mismatch`
  );
  assertTrue(
    String(sourceGovernanceFeatures?.sourceFreshnessTierLegacy || "") === String(testCase?.expected?.sourceFreshnessTierLegacy || ""),
    `case=${testCase.id} sourceGovernanceFeatures.sourceFreshnessTierLegacy mismatch`
  );
  assertTrue(
    String(sourceGovernanceFeatures?.freshnessTier || "") === String(testCase?.expected?.sourceGovernanceFreshnessTier || ""),
    `case=${testCase.id} sourceGovernanceFeatures.freshnessTier mismatch`
  );
}

function main() {
  const { cases, feedbackCases, jobFeaturesCases } = readFixture();
  cases.forEach((testCase) => verifyCase(testCase));
  feedbackCases.forEach((testCase) => verifyFeedbackCase(testCase));
  jobFeaturesCases.forEach((testCase) => verifyJobFeaturesCase(testCase));
  console.log(
    `validate-legacy-explainability-payload-compat: explainability=${cases.length} cases, feedback=${feedbackCases.length} cases, jobFeatures=${jobFeaturesCases.length} cases passed.`
  );
}

try {
  main();
} catch (error) {
  console.error("validate-legacy-explainability-payload-compat failed:", error?.message || error);
  process.exitCode = 1;
}
