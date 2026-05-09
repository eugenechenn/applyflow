"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const fixturePath = path.join(root, "scripts/fixtures/edge-semantic-slots-fixture.json");
const contentPath = path.join(root, "public/extensions/applyflow-edge-mvp/content.js");

function mustInclude(haystack, needle, label) {
  const unicodeNeedle = Array.from(String(needle))
    .map((char) => {
      const code = char.charCodeAt(0);
      return code > 127 ? `\\u${code.toString(16).padStart(4, "0")}` : char;
    })
    .join("");
  if (!haystack.includes(needle) && !haystack.includes(unicodeNeedle)) {
    throw new Error(`${label} missing required token: ${needle}`);
  }
}

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const contentJs = fs.readFileSync(contentPath, "utf8");

for (const token of fixture.requiredSlotMapEntries || []) {
  mustInclude(contentJs, token, "semantic slot map");
}

for (const token of fixture.requiredAliasTokens || []) {
  mustInclude(contentJs, token, "semantic slot alias");
}

for (const token of fixture.requiredControlTypes || []) {
  mustInclude(contentJs, `"${token}"`, "control type support");
}

for (const token of fixture.requiredFlowTokens || []) {
  mustInclude(contentJs, token, "semantic flow");
}

console.log("validate-edge-semantic-slots: passed.");
