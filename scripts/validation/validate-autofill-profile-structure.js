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

function createOverrideStore(profileSeed) {
  const state = {
    profile: JSON.parse(JSON.stringify(profileSeed || {})),
    jobs: [],
    strategyProfile: null,
    globalPolicy: null,
    policyProposals: [],
    policyAudits: [],
    policyHistory: [],
    savedProfiles: 0
  };

  return {
    getProfile: () => state.profile,
    saveProfile: (nextProfile) => {
      state.profile = { ...nextProfile };
      state.savedProfiles += 1;
      return state.profile;
    },
    listJobs: () => state.jobs,
    getApplicationPrepByJobId: () => null,
    listBadCases: () => [],
    getState: () => ({
      interviewReflections: []
    }),
    getStrategyProfile: () => state.strategyProfile,
    saveStrategyProfile: (next) => {
      state.strategyProfile = { ...next };
      return state.strategyProfile;
    },
    getGlobalStrategyPolicy: () => state.globalPolicy,
    saveGlobalStrategyPolicy: (next) => {
      state.globalPolicy = { ...next };
      return state.globalPolicy;
    },
    listPolicyProposals: () => state.policyProposals,
    savePolicyProposal: (proposal) => {
      const index = state.policyProposals.findIndex((item) => item.id === proposal.id);
      if (index >= 0) state.policyProposals[index] = { ...proposal };
      else state.policyProposals.push({ ...proposal });
      return proposal;
    },
    savePolicyAuditLog: (entry) => {
      state.policyAudits.push({ ...entry });
      return entry;
    },
    savePolicyHistoryEntry: (entry) => {
      state.policyHistory.push({ ...entry });
      return entry;
    },
    saveActivityLog: () => null,
    __state: state
  };
}

const fixture = readFixture("autofill-profile-structure-fixture.json");
const overrideStore = createOverrideStore(fixture.currentProfile);

const structuredSavedProfile = runWithRequestContext(
  { userId: "user_autofill_validate", overrideStore },
  () => orchestrator.saveProfile(fixture.structuredPayload)
);

assertTrue(overrideStore.__state.savedProfiles >= 1, "saveProfile should persist profile.");
assertTrue(
  structuredSavedProfile.autofillProfile &&
    typeof structuredSavedProfile.autofillProfile === "object",
  "autofillProfile should exist."
);
assertTrue(
  structuredSavedProfile.autofillProfile.basic?.full_name === "Eugene Chen",
  "autofillProfile.basic.full_name should be saved."
);
assertTrue(
  Array.isArray(structuredSavedProfile.autofillProfile.education) &&
    structuredSavedProfile.autofillProfile.education.length === 2,
  "autofillProfile.education should be structured array."
);
assertTrue(
  structuredSavedProfile.autofillProfile.education[0].start_date === "2015-09",
  "education start_date should normalize to YYYY-MM."
);
assertTrue(
  structuredSavedProfile.autofillProfile.education[1].level === "master",
  "education level should preserve semantic level."
);
assertTrue(
  Array.isArray(structuredSavedProfile.autofillProfile.work_experience) &&
    structuredSavedProfile.autofillProfile.work_experience.length === 1,
  "work_experience should be stored as array."
);
assertTrue(
  Array.isArray(structuredSavedProfile.autofillProfile.project_experience) &&
    structuredSavedProfile.autofillProfile.project_experience.length === 1,
  "project_experience should be stored as array."
);
assertTrue(
  Array.isArray(structuredSavedProfile.autofillProfile.family) &&
    structuredSavedProfile.autofillProfile.family.length === 1,
  "family should be stored as array."
);
assertTrue(
  structuredSavedProfile.autofillProfile.school_name === "Shanghai University",
  "legacy school_name should derive from highest education."
);
assertTrue(
  structuredSavedProfile.autofillProfile.first_school_name === "South China University",
  "legacy first_school_name should derive from bachelor education."
);

const legacySavedProfile = runWithRequestContext(
  { userId: "user_autofill_validate", overrideStore },
  () => orchestrator.saveProfile(fixture.legacyPayload)
);

assertTrue(
  legacySavedProfile.autofillProfile.basic?.full_name === "Legacy Compatible",
  "legacy payload should still populate basic.full_name."
);
assertTrue(
  legacySavedProfile.autofillProfile.basic?.birth_date === "1998-03-02",
  "legacy birth_date should normalize and sync into basic."
);
assertTrue(
  Array.isArray(legacySavedProfile.autofillProfile.education),
  "legacy payload should keep structured education array."
);
assertTrue(
  legacySavedProfile.autofillProfile.education.length >= 1,
  "legacy payload should preserve existing education structure."
);
assertTrue(
  legacySavedProfile.autofillProfile.major === "Product",
  "legacy flat major must remain backward compatible."
);

console.log(
  "validate-autofill-profile-structure: structured autofill profile arrays + backward compatibility passed."
);
