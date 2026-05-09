"use strict";

const fs = require("fs");
const path = require("path");
const { exportTailoredResumePdf } = require("../../src/lib/resume/resume-exporter");
const {
  createExportDto,
  createResumeExportContract,
  completeResumeExportContractSuccess,
  completeResumeExportContractFailure,
  validateResumeExportContract
} = require("../../src/lib/contracts/resume-export-contracts");

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
    if (error?.code === expectedCode) return;
    throw new Error(`${label} expected ${expectedCode}, got ${error?.code || "unknown"}`);
  }
  throw new Error(`${label} expected ${expectedCode}, but no error was thrown.`);
}

async function run() {
  const fixture = readFixture("resume-pdf-export-fixture.json");
  const valid = fixture.valid || {};

  const exportDto = createExportDto(valid.exportDto || {});
  const artifact = await exportTailoredResumePdf(exportDto);
  assertTrue(Buffer.isBuffer(artifact.buffer), "pdf artifact buffer must be a Buffer");
  assertTrue(artifact.buffer.length > 0, "pdf artifact buffer must not be empty");
  assertTrue(String(artifact.fileName || "").toLowerCase().endsWith(".pdf"), "artifact fileName must end with .pdf");
  assertTrue(artifact.contentType === "application/pdf", "artifact contentType must be application/pdf");

  const baseContract = createResumeExportContract(valid.resumeExportContract || {});
  const successContract = completeResumeExportContractSuccess(baseContract, artifact);
  const successValidation = validateResumeExportContract(successContract);
  assertTrue(successValidation.ok, `success export contract invalid: ${successValidation.errors.join("; ")}`);
  assertTrue(successContract.exportStatus === "exported", "success contract exportStatus must be exported");
  assertTrue(successContract.artifactMeta.mimeType === artifact.contentType, "artifact mimeType should match exporter output");
  assertTrue(successContract.artifactMeta.sizeBytes === artifact.buffer.length, "artifact sizeBytes should match buffer length");

  const failedContract = completeResumeExportContractFailure(baseContract, {
    message: "mock pdf exporter failure"
  });
  const failedValidation = validateResumeExportContract(failedContract);
  assertTrue(failedValidation.ok, `failed export contract invalid: ${failedValidation.errors.join("; ")}`);
  assertTrue(failedContract.exportStatus === "failed", "failed contract exportStatus must be failed");
  assertTrue(Array.isArray(failedContract.errors) && failedContract.errors.length > 0, "failed contract must include errors");

  await expectErrorCode("invalid.exportDto", fixture.invalid?.expectedErrorCode || "INVALID_EXPORT_DTO", async () => {
    await exportTailoredResumePdf(fixture.invalid?.exportDto || {});
  });

  const exporterSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/resume/resume-exporter.js"),
    "utf8"
  );
  ["resumeDocument", "tailoringOutput", "applicationPrep", "operationData"].forEach((forbidden) => {
    if (exporterSource.includes(forbidden)) {
      throw new Error(`resume-exporter should not reference forbidden legacy input: ${forbidden}`);
    }
  });

  console.log("validate-resume-pdf-export: pdf exporter consumes ExportDTO and contract status lifecycle is consistent.");
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
