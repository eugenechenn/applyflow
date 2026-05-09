"use strict";

const fs = require("fs");
const path = require("path");

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

const root = path.resolve(__dirname, "../..");
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, "scripts/fixtures/edge-multi-segment-passive-fixture.json"), "utf8")
);
const contentJs = fs.readFileSync(path.join(root, "public/extensions/applyflow-edge-mvp/content.js"), "utf8");

for (const token of fixture.requiredTokens || []) {
  assertTrue(contentJs.includes(token), `content.js missing required token: ${token}`);
}

for (const token of fixture.requiredFieldTokens || []) {
  assertTrue(contentJs.includes(token), `content.js missing passive field token: ${token}`);
}

for (const token of fixture.forbiddenTokens || []) {
  assertTrue(!contentJs.includes(token), `content.js contains forbidden token: ${token}`);
}

console.log("validate-edge-multi-segment-passive: passed.");
