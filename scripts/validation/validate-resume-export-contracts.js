"use strict";

const fs = require("fs");
const path = require("path");
const {
  createResumeExportContract,
  validateResumeExportContract,
  createExportDto,
  validateExportDto,
  EXPORT_DTO_ALLOWED_SOURCES
} = require("../../src/lib/contracts/resume-export-contracts");

function readFixture(fileName) {
  const filePath = path.resolve(process.cwd(), "scripts/fixtures", fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertValid(label, validation) {
  if (!validation.ok) {
    throw new Error(`${label} failed: ${validation.errors.join("; ")}`);
  }
}

function assertInvalid(label, validation, expectedSubstring) {
  if (validation.ok) {
    throw new Error(`${label} should fail but passed.`);
  }
  const joined = validation.errors.join("; ");
  if (!joined.includes(expectedSubstring)) {
    throw new Error(`${label} failed with unexpected errors: ${joined}`);
  }
}

const fixture = readFixture("resume-export-contract-fixture.json");

const validContract = createResumeExportContract(fixture.validContract || {});
assertValid("resumeExportContract.valid", validateResumeExportContract(validContract));

const validDto = createExportDto(fixture.validDto || {});
assertValid("exportDto.valid", validateExportDto(validDto));

(fixture.invalidContractCases || []).forEach((testCase) => {
  const contract = createResumeExportContract(testCase.contract || {});
  assertInvalid(
    `resumeExportContract.invalid.${testCase.name}`,
    validateResumeExportContract(contract),
    testCase.expectedErrorContains || ""
  );
});

(fixture.invalidDtoCases || []).forEach((testCase) => {
  const dto = testCase.validateRaw ? (testCase.dto || {}) : createExportDto(testCase.dto || {});
  assertInvalid(
    `exportDto.invalid.${testCase.name}`,
    validateExportDto(dto),
    testCase.expectedErrorContains || ""
  );
});

if (!Array.isArray(EXPORT_DTO_ALLOWED_SOURCES) || EXPORT_DTO_ALLOWED_SOURCES.length < 3) {
  throw new Error("export dto source whitelist is not initialized correctly.");
}
["canonical_resume_contract", "tailored_resume_contract", "prep_dto"].forEach((source) => {
  if (!EXPORT_DTO_ALLOWED_SOURCES.includes(source)) {
    throw new Error(`missing required export dto source whitelist entry: ${source}`);
  }
});

console.log("validate-resume-export-contracts: export contract + export dto boundary checks passed.");
