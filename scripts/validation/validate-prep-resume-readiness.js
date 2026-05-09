"use strict";

const fs = require("fs");
const path = require("path");

const appPath = path.resolve(__dirname, "../../public/app.js");
const source = fs.readFileSync(appPath, "utf8");

function assertContains(pattern, message) {
  if (!pattern.test(source)) {
    throw new Error(message);
  }
}

assertContains(/function buildResumeReadinessViewModel\(/, "Missing buildResumeReadinessViewModel.");
assertContains(/status:\s*"missing"/, "Missing readiness status: missing.");
assertContains(/status:\s*"partial"/, "Missing readiness status: partial.");
assertContains(/status:\s*"ready"/, "Missing readiness status: ready.");
assertContains(/Resume Readiness/, "Prep page readiness card is missing.");
assertContains(/href="#\/profile"/, "Missing jump link to Profile/Resume.");
assertContains(/非阻塞提示/, "Prep readiness must remain non-blocking.");

console.log("validate-prep-resume-readiness: passed.");
