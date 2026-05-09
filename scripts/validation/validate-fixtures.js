"use strict";

const fs = require("fs");
const path = require("path");
const { buildStructuredProfile } = require("../../src/lib/resume/resume-parser");
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
  const rawText = fs.readFileSync(path.resolve(process.cwd(), fixture.path), "utf8");
  const structured = buildStructuredProfile(rawText, "fixture");
  const result = normalizeResumeWorkspaceAsset({
    ...buildResumeDocumentFromFixture(fixture.path),
    structuredProfile: structured
  }, {});

  if (!Array.isArray(structured.workExperience) || !Array.isArray(structured.projectExperience) || typeof structured.selfSummary !== "string") {
    failed = true;
    console.error(`[validate-fixtures] ${fixture.path}: parser structured output is missing canonical fields.`);
  }

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

const legacyRawText = fs.readFileSync(path.resolve(process.cwd(), "scripts/fixtures/resume-standard-cn.txt"), "utf8");
const legacyCompatibleResult = normalizeResumeWorkspaceAsset(
  {
    id: "legacy-shape",
    fileName: "legacy.pdf",
    cleanedText: legacyRawText,
    structuredProfile: {
      summary: "具备执行推进、沟通协调与文档整理能力，能在真实业务场景中快速学习并稳定落地。",
      experience: [
        "2025.11-2026.02 广东公诚管理公司 项目管理助理 | 跟进项目进度并协调交付节点，维护项目台账与文档。 | 协助项目经理梳理流程问题，输出复盘记录与改进清单。",
        "2023.10-2024.08 中职通教育科技有限公司 运营管理 | 统筹庞大学员数据库，建立常态化回访机制并推动客户裂变。 | 协助开展校园讲座与市场活动，处理学员投诉并沉淀服务流程。"
      ],
      projects: [
        "2025.03-2025.10 华南理工大学 企业诊断小组组长 | 统筹撰写企业商业诊断报告，并代表团队向企业管理层进行方案汇报。"
      ],
      skills: ["文档整理", "执行推进"],
      cleanedText: legacyRawText
    }
  },
  {}
);

if (!(legacyCompatibleResult.workExperience || []).length || !(legacyCompatibleResult.projectExperience || []).length) {
  failed = true;
  console.error("[validate-fixtures] legacy structuredProfile compatibility failed: workspace model did not recover work/project experience.");
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("validate-fixtures: fixture expectations passed.");
}
