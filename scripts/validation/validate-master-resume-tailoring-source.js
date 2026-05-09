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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createOverrideStore({ profile, masterResume = null, resumeDocument = null, job, fitAssessment }) {
  const state = {
    profile: clone(profile),
    masterResume: masterResume ? clone(masterResume) : null,
    resumeDocument: resumeDocument ? clone(resumeDocument) : null,
    job: clone(job),
    fitAssessment: clone(fitAssessment),
    tailoringOutput: null,
    activityLogs: []
  };

  const policy = {
    id: "policy_validation",
    version: 1,
    focusMode: "focused",
    preferredRoles: ["AI Product Manager"],
    riskyRoles: [],
    preferredIndustries: ["AI"],
    riskyIndustries: [],
    preferredLocations: ["Shanghai"],
    riskyLocations: [],
    successPatterns: [],
    failurePatterns: []
  };

  return {
    getProfile: () => state.profile,
    getMasterResume: () => state.masterResume,
    getLatestResumeDocument: () => state.resumeDocument,
    getResumeDocument: (resumeId) => (state.resumeDocument?.id === resumeId ? state.resumeDocument : null),
    getJob: (jobId) => (state.job.id === jobId ? state.job : null),
    saveJob: (job) => {
      state.job = { ...state.job, ...job };
      return state.job;
    },
    listJobs: () => [state.job],
    getFitAssessmentByJobId: (jobId) => (state.fitAssessment.jobId === jobId ? state.fitAssessment : null),
    getTailoringOutputByJobId: (jobId) => (state.tailoringOutput?.jobId === jobId ? state.tailoringOutput : null),
    saveTailoringOutput: (tailoringOutput) => {
      state.tailoringOutput = clone(tailoringOutput);
      return state.tailoringOutput;
    },
    getApplicationPrepByJobId: () => null,
    listActivityLogsByJobId: () => state.activityLogs,
    saveActivityLog: (log) => {
      state.activityLogs.push(log);
      return log;
    },
    getGlobalStrategyPolicy: () => policy,
    getStrategyProfile: () => ({}),
    listTasksByJobId: () => [],
    getInterviewReflectionByJobId: () => null,
    getBadCaseByJobId: () => null,
    listPolicyProposals: () => [],
    listPolicyAuditHistory: () => [],
    getState: () => ({ interviewReflections: [] }),
    __state: state
  };
}

const fixture = readFixture("master-resume-tailoring-source-fixture.json");

const canonicalStore = createOverrideStore({
  profile: fixture.profile,
  masterResume: fixture.savedCanonical,
  resumeDocument: fixture.resumeDocumentSeed,
  job: fixture.job,
  fitAssessment: fixture.fitAssessment
});

const canonicalOutput = runWithRequestContext(
  { overrideStore: canonicalStore },
  () =>
    orchestrator.saveResumeTailoringOutput(fixture.job.id, {
      workspaceName: "Canonical source validation"
    })
);

assertTrue(canonicalOutput.masterResumeId === fixture.savedCanonical.masterResumeId, "tailoring output should store saved canonical masterResumeId");
assertTrue(canonicalOutput.masterResumeSource === "canonical_saved", "saved canonical MasterResume should be the tailoring source");
assertTrue(
  canonicalOutput.workspaceDraft.selfEvaluation.includes("Canonical AI product leader"),
  "workspace self evaluation should come from saved canonical MasterResume summary"
);
assertTrue(
  !canonicalOutput.workspaceDraft.selfEvaluation.includes("LEGACY FREE TEXT"),
  "legacy profile.masterResume must not drive tailoring when canonical MasterResume exists"
);
assertTrue(
  canonicalOutput.workspaceDraft.selfEvaluation.includes("Canonical AI product leader"),
  "saved tailoring output should keep canonical summary as the draft source"
);

const canonicalWorkspace = runWithRequestContext(
  { overrideStore: canonicalStore },
  () => orchestrator.buildTailoringWorkspace(fixture.job.id)
);
assertTrue(
  canonicalWorkspace.tailoredResumeContract.masterResumeId === fixture.savedCanonical.masterResumeId,
  "TailoredResumeContract should carry canonical masterResumeId"
);
assertTrue(Boolean(canonicalWorkspace.prepDto), "prep DTO should still be created after source switch");
assertTrue(
  canonicalWorkspace.tailoredResumeContract.canonicalTailoredResume.workExperience.some((entry) => entry.company === "Canonical Co"),
  "workspace/contract workExperience should come from saved canonical MasterResume"
);

const seedStore = createOverrideStore({
  profile: fixture.profile,
  masterResume: null,
  resumeDocument: fixture.resumeDocumentSeed,
  job: { ...fixture.job, id: "job_master_source_seed" },
  fitAssessment: { ...fixture.fitAssessment, jobId: "job_master_source_seed" }
});

const seedOutput = runWithRequestContext(
  { overrideStore: seedStore },
  () => orchestrator.saveResumeTailoringOutput("job_master_source_seed", {})
);

assertTrue(seedOutput.masterResumeSource === "resume_document_seed", "resume document seed should be used when no saved canonical exists");
assertTrue(
  seedOutput.masterResumeId === `master_${fixture.resumeDocumentSeed.id}`,
  "seed fallback should create a canonical master resume id from resumeDocument"
);
assertTrue(
  seedOutput.workspaceDraft.selfEvaluation.includes("Seed summary"),
  "seed fallback should keep resumeDocument summary initialization path working"
);

const seedWorkspace = runWithRequestContext(
  { overrideStore: seedStore },
  () => orchestrator.buildTailoringWorkspace("job_master_source_seed")
);
assertTrue(
  seedWorkspace.tailoredResumeContract.canonicalTailoredResume.workExperience.some((entry) => entry.company === "Seed Resume Co"),
  "seed fallback should keep resumeDocument workExperience initialization path working"
);

console.log(
  "validate-master-resume-tailoring-source: canonical MasterResume priority, seed fallback, legacy fallback exclusion, and workspace/prep compatibility all passed."
);
