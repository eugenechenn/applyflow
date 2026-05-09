"use strict";

const fs = require("fs");
const path = require("path");

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

const fixturePath = path.resolve(
  process.cwd(),
  "scripts/fixtures/profile-autofill-enhanced-ui-fixture.json"
);
const appJsPath = path.resolve(process.cwd(), "public/app.js");
const fixture = readJson(fixturePath);
const source = fs.readFileSync(appJsPath, "utf8");

if (fixture.requiredAuxiliaryTitle) {
  assertTrue(
    source.includes(fixture.requiredAuxiliaryTitle),
    `Profile UI is missing auxiliary section title: ${fixture.requiredAuxiliaryTitle}`
  );
}

if (fixture.requiredAuxiliarySectionId) {
  assertTrue(
    source.includes(`id="${fixture.requiredAuxiliarySectionId}"`),
    `Profile UI is missing auxiliary section container: ${fixture.requiredAuxiliarySectionId}`
  );
}

if (fixture.requiredJobsCtaId) {
  assertTrue(
    source.includes(`id="${fixture.requiredJobsCtaId}"`),
    `Profile UI is missing jobs CTA id: ${fixture.requiredJobsCtaId}`
  );
}

if (fixture.requiredSaveScrollTrigger) {
  assertTrue(
    source.includes(fixture.requiredSaveScrollTrigger),
    `Profile save flow is missing scroll trigger token: ${fixture.requiredSaveScrollTrigger}`
  );
}

if (Array.isArray(fixture.requiredProfileSectionTitles)) {
  fixture.requiredProfileSectionTitles.forEach((title) => {
    assertTrue(source.includes(title), `Profile UI is missing core section title: ${title}`);
  });
}

fixture.requiredSectionTitles.forEach((title) => {
  assertTrue(source.includes(title), `Profile UI is missing section title: ${title}`);
});

fixture.requiredDateFieldDefinitions.forEach((entry) => {
  const expectedType = String(entry.type || "date").trim();
  assertTrue(
    source.includes(`fieldPrefix: "${entry.fieldPrefix}"`),
    `Profile module is missing fieldPrefix ${entry.fieldPrefix} for ${entry.module}`
  );
  assertTrue(
    source.includes(`{ key: "${entry.key}"`) || source.includes(`key: "${entry.key}"`),
    `Profile module is missing date key ${entry.key} for ${entry.module}`
  );
  const dateRegex = new RegExp(`key:\\s*"${entry.key}"[\\s\\S]{0,140}type:\\s*"${expectedType}"`);
  assertTrue(
    dateRegex.test(source),
    `Profile module date field ${entry.key} should use input[type=${expectedType}]`
  );
});

assertTrue(
  source.includes("payload.autofillProfile = {") || source.includes("autofillProfile: {"),
  "Profile submit flow must build payload.autofillProfile."
);

fixture.requiredArrayKeys.forEach((arrayKey) => {
  assertTrue(
    source.includes(`${arrayKey}:`) || source.includes(`"${arrayKey}"`),
    `Profile submit flow is missing autofillProfile array key: ${arrayKey}`
  );
});

console.log("validate-profile-autofill-enhanced-ui: Profile enhanced autofill modules are wired.");
