"use strict";

const path = require("path");
const { execFileSync } = require("child_process");

const files = [
  "public/app.js",
  "src/lib/orchestrator/workflow-controller.js",
  "src/lib/workspace/tailoring-workspace-model.js",
  "src/lib/resume/resume-structuring-audit.js",
  "src/server/routes/api.js"
];

for (const file of files) {
  execFileSync(process.execPath, ["--check", path.resolve(process.cwd(), file)], {
    stdio: "pipe"
  });
}

require(path.resolve(process.cwd(), "src/lib/orchestrator/workflow-controller.js"));
require(path.resolve(process.cwd(), "src/server/routes/api.js"));

console.log("build-check: 关键脚本已通过语法与模块加载检查。");
