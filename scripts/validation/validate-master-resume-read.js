"use strict";

const fs = require("fs");
const path = require("path");
const { runWithRequestContext } = require("../../src/server/request-context");
const orchestrator = require("../../src/lib/orchestrator/workflow-controller");

function readFixture(fileName) {
  const filePath = path.resolve(process.cwd(), "scripts/fixtures", fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasForbiddenKeys(payload, forbiddenKeys = [], pathPrefix = "root") {
  if (!payload || typeof payload !== "object") return [];

  const findings = [];
  const entries = Array.isArray(payload)
    ? payload.map((value, index) => [String(index), value])
    : Object.entries(payload);

  entries.forEach(([key, value]) => {
    const currentPath = `${pathPrefix}.${key}`;
    if (forbiddenKeys.includes(key)) findings.push(currentPath);
    if (value && typeof value === "object") {
      findings.push(...hasForbiddenKeys(value, forbiddenKeys, currentPath));
    }
  });

  return findings;
}

const fixture = readFixture("master-resume-read-fixture.json");

const savedCanonicalResult = runWithRequestContext(
  {
    overrideStore: {
      getProfile: () => ({
        id: "profile_saved",
        fullName: "Alex Chen",
        masterResumeCanonical: fixture.savedCanonical
      }),
      getMasterResume: () => fixture.savedCanonical,
      getLatestResumeDocument: () => fixture.resumeDocumentSeed
    }
  },
  () => orchestrator.getMasterResumeView()
);

assertTrue(
  savedCanonicalResult.masterResumeMeta.source === "canonical_saved",
  "saved canonical master resume should be preferred over resume document seed"
);
assertTrue(
  savedCanonicalResult.masterResumeViewModel.masterResumeId === fixture.savedCanonical.masterResumeId,
  "saved canonical master resume id should be preserved"
);
assertTrue(
  savedCanonicalResult.masterResumeEditDto.basicInfo.name === fixture.savedCanonical.basicInfo.name,
  "edit dto should expose canonical basicInfo"
);

const seededResult = runWithRequestContext(
  {
    overrideStore: {
      getProfile: () => ({
        id: "profile_seed",
        fullName: "Alex Chen",
        preferredLocations: ["Shanghai"],
        masterResume: "legacy free text should not be read as structured master resume"
      }),
      getMasterResume: () => null,
      getLatestResumeDocument: () => fixture.resumeDocumentSeed
    }
  },
  () => orchestrator.getMasterResumeView()
);

assertTrue(
  seededResult.masterResumeMeta.source === "resume_document_seed",
  "when no saved canonical exists, latest resume document should seed master resume"
);
assertTrue(
  seededResult.masterResumeViewModel.basicInfo.name === "Alex Chen",
  "seeded master resume should carry structured basic info"
);
assertTrue(
  seededResult.masterResumeEditDto.workExperience.length > 0,
  "seeded edit dto should contain work experience"
);

const emptyResult = runWithRequestContext(
  {
    overrideStore: {
      getProfile: () => ({
        id: "profile_empty",
        fullName: "No Resume Yet",
        preferredLocations: ["Remote"],
        masterResume: "legacy text"
      }),
      getMasterResume: () => null,
      getLatestResumeDocument: () => null
    }
  },
  () => orchestrator.getMasterResumeView()
);

assertTrue(
  emptyResult.masterResumeMeta.source === "empty_seed",
  "empty seed should be used when no saved canonical or resume document exists"
);
assertTrue(
  emptyResult.masterResumeViewModel.basicInfo.name === "No Resume Yet",
  "empty seed may use profile identity metadata"
);

const forbiddenFields = hasForbiddenKeys(
  seededResult,
  ["resumeDocument", "structuredProfile", "rawText", "cleanedText", "masterResume"]
);
assertTrue(
  forbiddenFields.length === 0,
  `master resume read payload must not expose raw resume fields: ${forbiddenFields.join(", ")}`
);

console.log(
  "validate-master-resume-read: canonical master resume contract, seed fallback, and controlled read payload all behave as expected."
);
