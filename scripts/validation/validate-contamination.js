"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeResumeWorkspaceAsset } = require("../../src/lib/workspace/tailoring-workspace-model");

const fixtures = [
  "scripts/fixtures/resume-standard-cn.txt",
  "scripts/fixtures/resume-no-project.txt",
  "scripts/fixtures/resume-compact-mixed.txt"
];

const contaminationPattern =
  /@|(?:\+?86[-\s]?)?1[3-9]\d{9}|姓名|电话|手机|邮箱|出生年月|籍贯|建议人工补充确认|建议人工确认|暂无可展示/i;

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
  const buckets = [
    ...result.workExperience.flatMap((entry) => [entry.company, entry.role, entry.timeRange, ...(entry.bullets || [])]),
    ...result.projectExperience.flatMap((entry) => [
      entry.projectName,
      entry.role,
      entry.timeRange,
      ...(entry.bullets || [])
    ]),
    result.selfSummary
  ].filter(Boolean);

  if (buckets.some((item) => contaminationPattern.test(String(item)))) {
    failed = true;
    console.error(`[validate-contamination] ${fixture}: contamination detected in structured output.`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("validate-contamination: no contamination found in fixture outputs.");
}
