"use strict";

const fs = require("fs");
const path = require("path");

const fixturePath = path.resolve(__dirname, "../fixtures/ui-route-smoke-fixture.json");
const appJsPath = path.resolve(__dirname, "../../public/app.js");
const indexPath = path.resolve(__dirname, "../../public/index.html");

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const appSource = fs.readFileSync(appJsPath, "utf8");
const indexSource = fs.readFileSync(indexPath, "utf8");

function assertContains(source, token, message) {
  if (!source.includes(token)) {
    throw new Error(`${message}: ${token}`);
  }
}

for (const route of fixture.requiredNavRoutes || []) {
  assertContains(indexSource, `href="${route}"`, "Route smoke missing nav route");
}

for (const token of fixture.requiredRouteHandlers || []) {
  assertContains(appSource, token, "Route smoke missing route handler token");
}

for (const token of fixture.requiredOnboardingLandingTokens || []) {
  assertContains(appSource, token, "Route smoke missing onboarding landing token");
}

console.log("validate-ui-route-smoke: core routes and onboarding landing path are wired.");

