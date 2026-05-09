"use strict";

const fs = require("fs");
const path = require("path");
const store = require("../../src/server/store");
const orchestrator = require("../../src/lib/orchestrator/workflow-controller");
const { exportTailoredResumeDocx, exportTailoredResumePdf } = require("../../src/lib/resume/resume-exporter");
const {
  createResumeExportContract,
  validateResumeExportContract,
  completeResumeExportContractFailure
} = require("../../src/lib/contracts/resume-export-contracts");

function nowIso() {
  return new Date().toISOString();
}

function readFixture(fileName) {
  const filePath = path.resolve(process.cwd(), "scripts/fixtures", fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectErrorCode(label, expectedCode, fn) {
  try {
    await fn();
  } catch (error) {
    if (error?.code === expectedCode) return error;
    throw new Error(`${label} expected ${expectedCode}, got ${error?.code || "unknown"}`);
  }
  throw new Error(`${label} expected ${expectedCode}, but no error thrown`);
}

function ensureProfile() {
  const existing = store.getProfile();
  if (existing) return existing;
  return store.saveProfile({
    id: `profile_export_e2e_${Date.now()}`,
    name: "Export E2E",
    fullName: "Export E2E",
    headline: "AI PM",
    background: "Export E2E validation",
    yearsOfExperience: 3,
    targetRoles: ["AI Product Manager"],
    targetIndustries: ["AI"],
    targetLocations: ["Shanghai"],
    preferredLocations: ["Shanghai"],
    strengths: ["Execution"],
    constraints: [],
    masterResume: "Master resume baseline",
    baseResume: "Master resume baseline",
    policyPreferences: {
      manualPreferredRoles: [],
      ignoredRiskyRoles: [],
      riskToleranceOverride: ""
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
}

function seedResume(seedId) {
  return store.saveResumeDocument({
    id: `resume_export_e2e_${seedId}`,
    fileName: `resume_export_e2e_${seedId}.pdf`,
    mimeType: "application/pdf",
    rawText: "Experienced AI PM with decision/control/feedback system delivery.",
    cleanedText: "Experienced AI PM with decision/control/feedback system delivery.",
    summary: "AI PM resume for export e2e",
    parseStatus: "parse_success",
    extractionMethod: "parser",
    structuredProfile: {
      summary: "AI PM",
      experience: ["Built contract-first agent architecture"],
      projects: ["ApplyFlow export pipeline"],
      skills: ["Node.js", "agent", "workflow"],
      education: [],
      achievements: [],
      certifications: [],
      sections: []
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
}

function seedJobChain(seedId, fixture = {}) {
  const resume = seedResume(seedId);
  const profile = ensureProfile();
  const jobId = `job_export_e2e_${seedId}`;
  const fitId = `fit_export_e2e_${seedId}`;
  const tailoringId = `tailoring_export_e2e_${seedId}`;
  const prepId = `prep_export_e2e_${seedId}`;

  store.saveJob({
    id: jobId,
    company: fixture.company || "ApplyFlow Labs",
    title: fixture.title || "AI Product Manager",
    location: fixture.location || "Shanghai",
    sourceLabel: "manual",
    sourcePlatform: "manual",
    jobUrl: fixture.jobUrl || "https://example.com/jobs/export-e2e",
    status: "ready_to_apply",
    priority: "high",
    strategyDecision: "proceed",
    fitAssessmentId: fitId,
    resumeDocumentId: resume.id,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  store.saveFitAssessment({
    id: fitId,
    jobId,
    profileId: profile.id,
    fitScore: 88,
    recommendation: "apply",
    strategyDecision: "proceed",
    strategyReasoning: "Export E2E fit assessment",
    whyApply: ["Role aligns with contract-first delivery capability."],
    keyGaps: [],
    riskFlags: [],
    llmMeta: { model: "fixture", fallbackUsed: false },
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  store.saveTailoringOutput({
    id: tailoringId,
    jobId,
    version: 1,
    tailoredSummary: "Built robust export boundary with contractized data flow.",
    tailoringExplainability: ["Emphasized architecture ownership and guardrails."],
    workspaceDraft: {
      workExperience: ["Shipped export contract/DTO refactor."],
      projectExperience: ["ApplyFlow PDF/DOCX unified export chain."],
      selfEvaluation: "Strong fit for architecture-heavy AI PM role."
    },
    targetingBrief: { targetKeywords: ["contract", "export", "pipeline"] },
    workspace: {
      id: `workspace_${jobId}`,
      name: `Workspace ${jobId}`,
      activeVersion: 1,
      updatedAt: nowIso()
    },
    insights: {
      headline: "Export architecture role",
      strongestMatch: "contract/data boundary control",
      biggestGap: "",
      nextEditFocus: "none"
    },
    reviewModules: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  store.saveApplicationPrep({
    id: prepId,
    jobId,
    resumeDocumentId: resume.id,
    version: 1,
    resumeTailoring: {
      targetKeywords: ["contract", "export", "pipeline"],
      rewriteBullets: [{ after: "Unified DOCX/PDF export on one DTO boundary." }]
    },
    tailoredSummary: "Contract-first export path for DOCX and PDF.",
    whyMe: "Strong architecture ownership with validation guardrails.",
    selfIntro: { short: "short intro", medium: "medium intro" },
    qaDraft: [{ question: "Q", answer: "A" }],
    talkingPoints: ["How export status is finalized with artifact meta."],
    coverNote: "Happy to discuss export pipeline design.",
    outreachNote: "Outreach note",
    checklist: [
      { key: "resume_reviewed", label: "resume reviewed", completed: true },
      { key: "intro_ready", label: "intro ready", completed: true },
      { key: "qa_ready", label: "qa ready", completed: true }
    ],
    contentWithSources: [],
    tailoringExplainability: [],
    tailoredResumePreview: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  return { jobId, resumeId: resume.id };
}

async function run() {
  const fixture = readFixture("export-e2e-fixture.json");
  const seedId = Date.now();
  const seeded = seedJobChain(seedId, fixture.seed || {});
  const audit = {};

  const docx = await orchestrator.exportJobTailoringDocx(seeded.jobId);
  assertTrue(Buffer.isBuffer(docx.buffer) && docx.buffer.length > 0, "DOCX success chain: artifact buffer must exist");
  assertTrue(docx.exportContract?.exportStatus === "exported", "DOCX success chain: exportStatus must be exported");
  assertTrue(
    docx.exportContract?.artifactMeta?.mimeType === (fixture.expected?.docxMimeType || ""),
    "DOCX success chain: artifact mimeType mismatch"
  );
  assertTrue(
    docx.exportContract?.artifactMeta?.extension === "docx",
    "DOCX success chain: artifact extension should be docx"
  );
  assertTrue(Array.isArray(docx.exportContract?.warnings), "DOCX success chain: warnings must be an array");
  assertTrue(Array.isArray(docx.exportContract?.errors), "DOCX success chain: errors must be an array");

  const pdf = await orchestrator.exportJobTailoringPdf(seeded.jobId);
  assertTrue(Buffer.isBuffer(pdf.buffer) && pdf.buffer.length > 0, "PDF success chain: artifact buffer must exist");
  assertTrue(pdf.exportContract?.exportStatus === "exported", "PDF success chain: exportStatus must be exported");
  assertTrue(
    pdf.exportContract?.artifactMeta?.mimeType === (fixture.expected?.pdfMimeType || ""),
    "PDF success chain: artifact mimeType mismatch"
  );
  assertTrue(
    pdf.exportContract?.artifactMeta?.extension === "pdf",
    "PDF success chain: artifact extension should be pdf"
  );
  assertTrue(Array.isArray(pdf.exportContract?.warnings), "PDF success chain: warnings must be an array");
  assertTrue(Array.isArray(pdf.exportContract?.errors), "PDF success chain: errors must be an array");

  // D: multi-format consistency on same controlled boundary
  assertTrue(docx.exportDto?.jobId === pdf.exportDto?.jobId, "consistency chain: jobId must match between docx/pdf");
  assertTrue(
    docx.exportDto?.tailoredResumeId === pdf.exportDto?.tailoredResumeId,
    "consistency chain: tailoredResumeId must match between docx/pdf"
  );
  assertTrue(
    Array.isArray(docx.exportDto?.sourceContracts) &&
      Array.isArray(pdf.exportDto?.sourceContracts) &&
      docx.exportDto.sourceContracts.join(",") === pdf.exportDto.sourceContracts.join(","),
    "consistency chain: sourceContracts must match between docx/pdf"
  );

  // C: failure chain using same contract/status mechanism
  const invalidDto = {
    jobId: seeded.jobId,
    tailoredResumeId: "tailored_invalid",
    exportFormat: "docx",
    profile: {},
    sections: {}
  };
  const failureCode = fixture.expected?.failureErrorCode || "INVALID_EXPORT_DTO";
  const docxError = await expectErrorCode("failure chain docx", failureCode, async () => {
    await exportTailoredResumeDocx(invalidDto);
  });
  const pdfError = await expectErrorCode("failure chain pdf", failureCode, async () => {
    await exportTailoredResumePdf({ ...invalidDto, exportFormat: "pdf" });
  });

  const failedBaseContract = createResumeExportContract({
    exportId: `export_failed_${seedId}`,
    jobId: seeded.jobId,
    masterResumeId: seeded.resumeId,
    tailoredResumeId: "tailored_failed",
    exportFormat: "pdf",
    exportStatus: "ready",
    artifactName: "failed.pdf",
    artifactMeta: {
      mimeType: "application/pdf",
      extension: "pdf"
    },
    trace: {
      source: "validate-export-e2e",
      runId: `run_export_failed_${seedId}`
    }
  });
  const failedFinal = completeResumeExportContractFailure(failedBaseContract, {
    message: pdfError.message
  });
  const failedValidation = validateResumeExportContract(failedFinal);
  assertTrue(failedValidation.ok, `failure chain: failed contract invalid: ${failedValidation.errors.join("; ")}`);
  assertTrue(failedFinal.exportStatus === "failed", "failure chain: exportStatus must be failed");
  assertTrue(Array.isArray(failedFinal.errors) && failedFinal.errors.length > 0, "failure chain: errors should be populated");

  audit.docxSuccess = {
    exportId: docx.exportContract?.exportId || "",
    jobId: docx.exportContract?.jobId || "",
    tailoredResumeId: docx.exportContract?.tailoredResumeId || "",
    exportFormat: docx.exportContract?.exportFormat || "",
    exportStatus: docx.exportContract?.exportStatus || "",
    artifactName: docx.exportContract?.artifactName || "",
    artifactMeta: docx.exportContract?.artifactMeta || {},
    warnings: docx.exportContract?.warnings || [],
    errors: docx.exportContract?.errors || [],
    trace: docx.exportContract?.trace || {}
  };
  audit.pdfSuccess = {
    exportId: pdf.exportContract?.exportId || "",
    jobId: pdf.exportContract?.jobId || "",
    tailoredResumeId: pdf.exportContract?.tailoredResumeId || "",
    exportFormat: pdf.exportContract?.exportFormat || "",
    exportStatus: pdf.exportContract?.exportStatus || "",
    artifactName: pdf.exportContract?.artifactName || "",
    artifactMeta: pdf.exportContract?.artifactMeta || {},
    warnings: pdf.exportContract?.warnings || [],
    errors: pdf.exportContract?.errors || [],
    trace: pdf.exportContract?.trace || {}
  };
  audit.failedChain = {
    exportId: failedFinal.exportId,
    jobId: failedFinal.jobId,
    tailoredResumeId: failedFinal.tailoredResumeId,
    exportFormat: failedFinal.exportFormat,
    exportStatus: failedFinal.exportStatus,
    artifactName: failedFinal.artifactName,
    artifactMeta: failedFinal.artifactMeta,
    warnings: failedFinal.warnings,
    errors: failedFinal.errors,
    trace: failedFinal.trace
  };

  [
    "exportId",
    "jobId",
    "tailoredResumeId",
    "exportFormat",
    "exportStatus",
    "artifactName",
    "artifactMeta",
    "warnings",
    "errors",
    "trace"
  ].forEach((key) => {
    assertTrue(Object.prototype.hasOwnProperty.call(audit.docxSuccess, key), `audit docx missing key: ${key}`);
    assertTrue(Object.prototype.hasOwnProperty.call(audit.pdfSuccess, key), `audit pdf missing key: ${key}`);
    assertTrue(Object.prototype.hasOwnProperty.call(audit.failedChain, key), `audit failed missing key: ${key}`);
  });

  console.log("validate-export-e2e: docx/pdf success paths, failure path, and multi-format contract consistency passed.");
  console.log(JSON.stringify({ exportAuditEvidence: audit }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
