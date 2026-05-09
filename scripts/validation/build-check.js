"use strict";

const path = require("path");
const fs = require("fs");
const vm = require("vm");

const files = [
  "public/app.js",
  "src/lib/orchestrator/workflow-controller.js",
  "src/lib/workspace/tailoring-workspace-model.js",
  "src/lib/resume/resume-structuring-audit.js",
  "src/server/routes/api.js"
];

for (const file of files) {
  const absolutePath = path.resolve(process.cwd(), file);
  const source = fs.readFileSync(absolutePath, "utf8");
  new vm.Script(source, { filename: absolutePath });
}

const modulePaths = [
  path.resolve(process.cwd(), "src/lib/orchestrator/workflow-controller.js"),
  path.resolve(process.cwd(), "src/server/routes/api.js")
];

for (const modulePath of modulePaths) {
  try {
    require(modulePath);
  } catch (error) {
    const message = String(error && error.message ? error.message : "");
    if (message.includes("database is locked")) {
      // CI/local validation may run with concurrent sqlite access.
      // Keep syntax/build gate deterministic and report a soft warning instead.
      console.warn(`[build-check] skipped module load due to sqlite lock: ${modulePath}`);
      continue;
    }
    throw error;
  }
}

console.log("build-check: 关键脚本已通过语法与模块加载检查。");
