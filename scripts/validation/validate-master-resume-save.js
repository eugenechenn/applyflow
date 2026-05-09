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
  if (!condition) throw new Error(message);
}

function createOverrideStore({ profile, masterResume = null, resumeDocument = null }) {
  const state = {
    profile: JSON.parse(JSON.stringify(profile)),
    masterResume: masterResume ? JSON.parse(JSON.stringify(masterResume)) : null,
    resumeDocument: resumeDocument ? JSON.parse(JSON.stringify(resumeDocument)) : null,
    savedMasterResumeCalls: 0
  };

  return {
    getProfile: () => state.profile,
    saveProfile: (nextProfile) => {
      state.profile = { ...state.profile, ...nextProfile };
      return state.profile;
    },
    getMasterResume: () => state.masterResume,
    saveMasterResume: (nextMasterResume) => {
      state.masterResume = JSON.parse(JSON.stringify(nextMasterResume));
      state.savedMasterResumeCalls += 1;
      state.profile = {
        ...state.profile,
        masterResumeCanonical: state.masterResume
      };
      return state.masterResume;
    },
    getLatestResumeDocument: () => state.resumeDocument,
    saveActivityLog: () => null,
    getState: () => ({}),
    __state: state
  };
}

const fixture = readFixture("master-resume-read-fixture.json");

const seedStore = createOverrideStore({
  profile: {
    id: "profile_seed",
    fullName: "Alex Chen",
    background: "AI product background"
  },
  masterResume: null,
  resumeDocument: fixture.resumeDocumentSeed
});

const savedFromSeed = runWithRequestContext(
  {
    overrideStore: seedStore
  },
  () =>
    orchestrator.saveMasterResume({
      masterResumeId: "",
      basicInfo: {
        name: "Alex Chen",
        email: "alex@example.com",
        phone: "13800000000",
        location: "Shanghai"
      },
      summary: "Updated summary from master resume editor.",
      workExperience: [
        {
          id: "work_1",
          company: "Seed Company",
          role: "Strategy Analyst",
          timeRange: "2022.01-2024.01",
          bullets: ["Built dashboard workflows."]
        }
      ],
      projectExperience: [],
      education: fixture.resumeDocumentSeed.structuredProfile.educationItems,
      skills: ["Strategy", "Product", "SQL"]
    })
);

assertTrue(seedStore.__state.savedMasterResumeCalls === 1, "saving seeded master resume should persist canonical master resume exactly once");
assertTrue(savedFromSeed.masterResumeMeta.source === "canonical_saved", "after save, master resume should read back from canonical_saved");
assertTrue(savedFromSeed.masterResumeViewModel.summary === "Updated summary from master resume editor.", "saved seed summary should round-trip through view model");

const canonicalStore = createOverrideStore({
  profile: {
    id: "profile_saved",
    fullName: "Alex Chen"
  },
  masterResume: fixture.savedCanonical,
  resumeDocument: fixture.resumeDocumentSeed
});

const updatedCanonical = runWithRequestContext(
  {
    overrideStore: canonicalStore
  },
  () =>
    orchestrator.saveMasterResume({
      ...fixture.savedCanonical,
      summary: "Canonical summary updated again.",
      skills: ["AI Product", "Stakeholder Management", "Prompting"]
    })
);

assertTrue(canonicalStore.__state.savedMasterResumeCalls === 1, "updating existing canonical master resume should not create duplicate saves");
assertTrue(updatedCanonical.masterResumeViewModel.summary === "Canonical summary updated again.", "updated canonical summary should round-trip");
assertTrue(
  updatedCanonical.masterResumeEditDto.skills.includes("Prompting"),
  "updated canonical skills should round-trip through edit dto"
);

let invalidError = null;
try {
  runWithRequestContext(
    {
      overrideStore: canonicalStore
    },
    () =>
      orchestrator.saveMasterResume({
        masterResumeId: fixture.savedCanonical.masterResumeId,
        basicInfo: { name: "Alex Chen" },
        summary: "bad payload",
        workExperience: "invalid"
      })
  );
} catch (error) {
  invalidError = error;
}

assertTrue(Boolean(invalidError), "invalid master resume payload should throw");
assertTrue(invalidError.code === "INVALID_MASTER_RESUME_DTO", "invalid payload should fail with INVALID_MASTER_RESUME_DTO");

console.log(
  "validate-master-resume-save: seeded save, canonical update, round-trip read consistency, and invalid payload guard all passed."
);
