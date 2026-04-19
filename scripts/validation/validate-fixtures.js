"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeResumeWorkspaceAsset } = require("../../src/lib/workspace/tailoring-workspace-model");

const fixtureExpectations = [
  {
    path: "scripts/fixtures/resume-standard-cn.txt",
    minWork: 3,
    minProject: 1,
    requireSummary: false
  },
  {
    path: "scripts/fixtures/resume-no-project.txt",
    minWork: 2,
    minProject: 0,
    requireSummary: true
  },
  {
    path: "scripts/fixtures/resume-compact-mixed.txt",
    minWork: 1,
    minProject: 1,
    requireSummary: false
  }
];

function buildResumeDocumentFromFixture(fixturePath) {
  const rawText = fs.readFileSync(path.resolve(process.cwd(), fixturePath), "utf8");
  return {
    id: fixturePath,
    fileName: path.basename(fixturePath),
    summary: "",
    structuredProfile: {
      rawText,
      cleanedText: rawText,
      sections: []
    }
  };
}

let failed = false;

for (const fixture of fixtureExpectations) {
  const result = normalizeResumeWorkspaceAsset(buildResumeDocumentFromFixture(fixture.path), {});

  if ((result.workExperience || []).length < fixture.minWork) {
    failed = true;
    console.error(
      `[validate-fixtures] ${fixture.path}: expected at least ${fixture.minWork} work entries, got ${(result.workExperience || []).length}.`
    );
  }

  if ((result.projectExperience || []).length < fixture.minProject) {
    failed = true;
    console.error(
      `[validate-fixtures] ${fixture.path}: expected at least ${fixture.minProject} project entries, got ${(result.projectExperience || []).length}.`
    );
  }

  if (fixture.requireSummary && !String(result.selfSummary || "").trim()) {
    failed = true;
    console.error(`[validate-fixtures] ${fixture.path}: expected non-empty selfSummary.`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("validate-fixtures: fixture expectations passed.");
}
