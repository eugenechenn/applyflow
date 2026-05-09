"use strict";

const fs = require("fs");
const path = require("path");
const { buildStructuredProfile } = require("../../src/lib/resume/resume-parser");
const { normalizeResumeWorkspaceAsset } = require("../../src/lib/workspace/tailoring-workspace-model");

const fixtures = [
  { path: "scripts/fixtures/resume-standard-cn.txt", requireProject: true },
  { path: "scripts/fixtures/resume-no-project.txt", requireProject: false },
  { path: "scripts/fixtures/resume-compact-mixed.txt", requireProject: true }
];

const contaminationPattern =
  /@|(?:\+?86[-\s]?)?1[3-9]\d{9}|姓名|电话|手机|邮箱|出生年月|籍贯|建议人工补充确认|岗位描述较少|已从岗位描述中提取基础信息|暂无可展示|未清晰列出/i;
const projectLeakPattern = /(系统搭建|平台搭建|方案设计|方案优化|系统优化|试点|企业诊断|项目报告|方案汇报|课题|小组)/i;

function buildResumeDocumentFromFixture(fixturePath) {
  const rawText = fs.readFileSync(path.resolve(process.cwd(), fixturePath), "utf8");
  const structuredProfile = buildStructuredProfile(rawText);
  return {
    id: fixturePath,
    fileName: path.basename(fixturePath),
    summary: "",
    structuredProfile,
    cleanedText: rawText
  };
}

let failed = false;

for (const fixture of fixtures) {
  const result = normalizeResumeWorkspaceAsset(buildResumeDocumentFromFixture(fixture.path), {});
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
    console.error(`[validate-contamination] ${fixture.path}: contamination detected in structured output.`);
  }

  const leakedProjectBullets = (result.workExperience || [])
    .flatMap((entry) => [entry.company, ...(entry.bullets || [])])
    .filter((item) => projectLeakPattern.test(String(item)));

  if (leakedProjectBullets.length) {
    failed = true;
    console.error(`[validate-contamination] ${fixture.path}: project-like content leaked into workExperience.`);
  }

  if (fixture.requireProject && !(result.projectExperience || []).length) {
    failed = true;
    console.error(`[validate-contamination] ${fixture.path}: expected non-empty projectExperience.`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("validate-contamination: no contamination found in fixture outputs.");
}

