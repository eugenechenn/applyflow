"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const fixturePath = path.join(root, "scripts/fixtures/edge-autofill-regression-fixture.json");
const contentPath = path.join(root, "public/extensions/applyflow-edge-mvp/content.js");
const popupPath = path.join(root, "public/extensions/applyflow-edge-mvp/popup.js");
const appPath = path.join(root, "public/app.js");

function mustInclude(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(`${label} missing required token: ${needle}`);
  }
}

function mustNotInclude(haystack, needle, label) {
  if (haystack.includes(needle)) {
    throw new Error(`${label} contains forbidden token: ${needle}`);
  }
}

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const contentJs = fs.readFileSync(contentPath, "utf8");
const popupJs = fs.readFileSync(popupPath, "utf8");
const appJs = fs.readFileSync(appPath, "utf8");

for (const field of fixture.requiredTargetFields || []) {
  mustInclude(contentJs, `"${field}"`, "content.js TARGET_FIELDS");
  mustInclude(popupJs, `"${field}"`, "popup.js TARGET_FIELDS");
}

for (const controlType of fixture.requiredControlTypes || []) {
  mustInclude(contentJs, `"${controlType}"`, "content.js control types");
}

for (const reason of fixture.requiredReasons || []) {
  mustInclude(contentJs, `"${reason}"`, "content.js status reasons");
}

for (const pattern of fixture.requiredPatterns || []) {
  mustInclude(contentJs, pattern, "content.js field patterns");
}

for (const token of fixture.requiredFlowTokens || []) {
  mustInclude(contentJs, token, "content.js flow tokens");
}

for (const forbidden of fixture.forbiddenTokens || []) {
  mustNotInclude(contentJs, forbidden, "content.js");
}

mustInclude(contentJs, "fillRadioGroup(", "content.js radio fill handler");
mustInclude(contentJs, "getFallbackFieldCandidates(", "content.js fallback candidate strategy");
mustInclude(contentJs, "const selectFallbackOk = await fillSelectLike", "content.js plain->select fallback");
mustInclude(contentJs, "ok = fillPlainInput(candidate.element, value);", "content.js select->plain fallback");
mustInclude(appJs, "name=\"certificate_name\"", "Profile autofill form");
mustInclude(appJs, "name=\"achievement_score\"", "Profile autofill form");

console.log("validate-edge-autofill-regression: passed.");
