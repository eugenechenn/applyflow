"use strict";

const fs = require("fs");
const path = require("path");

const fixturePath = path.resolve(__dirname, "../fixtures/jobs-apply-ui-fixture.json");
const appJsPath = path.resolve(__dirname, "../../public/app.js");
const stylesPath = path.resolve(__dirname, "../../public/styles.css");

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const appSource = fs.readFileSync(appJsPath, "utf8");
const styleSource = fs.readFileSync(stylesPath, "utf8");

function assertContains(source, token, message) {
  if (!source.includes(token)) {
    throw new Error(`${message}: ${token}`);
  }
}

for (const token of fixture.requiredAppTokens || []) {
  assertContains(appSource, token, "Jobs apply UI missing token");
}

for (const token of fixture.requiredProfileHintTokens || []) {
  assertContains(appSource, token, "Profile plugin hint missing token");
}

for (const token of fixture.requiredStyleTokens || []) {
  assertContains(styleSource, token, "Jobs apply modal style missing token");
}

console.log("validate-jobs-apply-ui: jobs apply entry and non-blocking modal are wired.");
