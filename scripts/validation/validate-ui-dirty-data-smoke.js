"use strict";

const fs = require("fs");
const path = require("path");

const fixturePath = path.resolve(__dirname, "../fixtures/ui-dirty-data-smoke-fixture.json");
const appJsPath = path.resolve(__dirname, "../../public/app.js");

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const appSource = fs.readFileSync(appJsPath, "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

for (const token of fixture.requiredTokens || []) {
  assert(appSource.includes(token), `dirty-data smoke missing required guard token: ${token}`);
}

for (const token of fixture.forbiddenTokens || []) {
  assert(!appSource.includes(token), `dirty-data smoke found forbidden unsafe token: ${token}`);
}

console.log("validate-ui-dirty-data-smoke: join-guard and onboarding-empty protection are in place.");
