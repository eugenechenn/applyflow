"use strict";

const fs = require("fs");
const path = require("path");

const protectedFiles = [
  "src/lib/orchestrator/workflow-controller.js",
  "src/lib/resume/resume-structuring-audit.js",
  "src/lib/workspace/tailoring-workspace-model.js",
  "public/app.js"
];

const bannedPatterns = [
  { pattern: /buildResumeSnapshot|buildTailoredPreview|buildDiffView|buildExplainability/g, message: "workflow 主链路不应继续引用旧 Tailoring helper。" }
];

let failed = false;

for (const relativePath of protectedFiles) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const source = fs.readFileSync(absolutePath, "utf8");

  const functionMatches = [...source.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/g)];
  const counts = new Map();
  functionMatches.forEach((match) => {
    const name = match[1];
    counts.set(name, (counts.get(name) || 0) + 1);
  });

  for (const [name, count] of counts.entries()) {
    if (count > 1) {
      failed = true;
      console.error(`[lint-guardrails] ${relativePath}: 检测到重复函数定义 -> ${name} (${count} 次)`);
    }
  }

  for (const rule of bannedPatterns) {
    if (relativePath.includes("workflow-controller")) {
      if (rule.pattern.test(source)) {
        failed = true;
        console.error(`[lint-guardrails] ${relativePath}: ${rule.message}`);
      }
    }
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("lint-guardrails: 受保护文件通过规则检查。");
}
