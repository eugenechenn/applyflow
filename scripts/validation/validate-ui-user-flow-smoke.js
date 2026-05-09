"use strict";

const fs = require("fs");
const path = require("path");

const fixturePath = path.resolve(__dirname, "../fixtures/ui-user-flow-smoke-fixture.json");
const appJsPath = path.resolve(__dirname, "../../public/app.js");

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const appSource = fs.readFileSync(appJsPath, "utf8");

function assertContains(source, token, message) {
  if (!source.includes(token)) {
    throw new Error(`${message}: ${token}`);
  }
}

for (const token of fixture.requiredDashboardTokens || []) {
  assertContains(appSource, token, "User flow smoke missing dashboard token");
}

for (const token of fixture.requiredJobsApplyTokens || []) {
  assertContains(appSource, token, "User flow smoke missing jobs/apply token");
}

for (const token of fixture.requiredProfileGuideTokens || []) {
  assertContains(appSource, token, "User flow smoke missing profile guide token");
}

for (const token of fixture.requiredOnboardingFlowTokens || []) {
  assertContains(appSource, token, "User flow smoke missing onboarding flow token");
}

console.log("validate-ui-user-flow-smoke: dashboard->jobs->apply modal->profile path tokens are wired.");

