"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeResumeWorkspaceAsset } = require("../../src/lib/workspace/tailoring-workspace-model");

const fixtures = [
  "scripts/fixtures/resume-standard-cn.txt",
  "scripts/fixtures/resume-no-project.txt",
  "scripts/fixtures/resume-compact-mixed.txt"
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

for (const fixture of fixtures) {
  const result = normalizeResumeWorkspaceAsset(buildResumeDocumentFromFixture(fixture), {});

  const workOk =
    Array.isArray(result.workExperience) &&
    result.workExperience.every(
      (entry) =>
        entry &&
        typeof entry.company === "string" &&
        typeof entry.role === "string" &&
        typeof entry.timeRange === "string" &&
        Array.isArray(entry.bullets)
    );

  const projectOk =
    Array.isArray(result.projectExperience) &&
    result.projectExperience.every(
      (entry) =>
        entry &&
        typeof entry.projectName === "string" &&
        typeof entry.role === "string" &&
        typeof entry.timeRange === "string" &&
        Array.isArray(entry.bullets)
    );

  const summaryOk = typeof result.selfSummary === "string";

  if (!workOk || !projectOk || !summaryOk) {
    failed = true;
    console.error(`[validate-workspace-schema] ${fixture}: canonical schema is invalid.`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("validate-workspace-schema: all fixtures passed canonical schema validation.");
}
