"use strict";

const fs = require("fs");
const path = require("path");
const { createResumeExportContract } = require("../../src/lib/contracts/resume-export-contracts");
const { createTailoredResumeContract } = require("../../src/lib/contracts/tailored-resume-contracts");
const { createPrepDto } = require("../../src/lib/contracts/prep-dto-contracts");
const { normalizeCanonicalResumeContract } = require("../../src/lib/contracts/canonical-resume-contracts");
const { buildExportDtoFromContracts } = require("../../src/lib/resume/export-dto-mapper");

function readFixture(fileName) {
  const filePath = path.resolve(process.cwd(), "scripts/fixtures", fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function expectErrorCode(label, expectedCode, fn) {
  try {
    fn();
  } catch (error) {
    if (error?.code === expectedCode) return;
    throw new Error(`${label} expected ${expectedCode}, got ${error?.code || "unknown"}`);
  }
  throw new Error(`${label} expected ${expectedCode}, but no error thrown.`);
}

const fixture = readFixture("resume-export-mapping-fixture.json");

const valid = fixture.valid || {};
const mapped = buildExportDtoFromContracts({
  resumeExportContract: createResumeExportContract(valid.resumeExportContract || {}),
  canonicalResumeContract: normalizeCanonicalResumeContract(valid.canonicalResumeContract || {}),
  tailoredResumeContract: createTailoredResumeContract(valid.tailoredResumeContract || {}),
  prepDto: createPrepDto(valid.prepDto || {}),
  exportOptions: valid.exportOptions || {}
});

assertTrue(mapped && mapped.exportDto, "mapping must return exportDto.");
assertTrue(Array.isArray(mapped.exportDto.sourceContracts), "exportDto.sourceContracts must be an array.");
["canonical_resume_contract", "tailored_resume_contract", "prep_dto", "export_options"].forEach((source) => {
  assertTrue(mapped.exportDto.sourceContracts.includes(source), `sourceContracts missing ${source}`);
});
assertTrue(!("resumeDocument" in mapped.exportDto), "exportDto must not include resumeDocument");
assertTrue(!("tailoringOutput" in mapped.exportDto), "exportDto must not include tailoringOutput");
assertTrue(!("operationData" in mapped.exportDto), "exportDto must not include operationData");

(fixture.invalidCases || []).forEach((testCase) => {
  expectErrorCode(`exportMapping.invalid.${testCase.name}`, testCase.expectedErrorCode, () => {
    buildExportDtoFromContracts({
      resumeExportContract: createResumeExportContract(valid.resumeExportContract || {}),
      canonicalResumeContract: normalizeCanonicalResumeContract(valid.canonicalResumeContract || {}),
      tailoredResumeContract: createTailoredResumeContract(valid.tailoredResumeContract || {}),
      prepDto:
        testCase.input?.prepDto === null
          ? null
          : createPrepDto(valid.prepDto || {}),
      exportOptions: {
        ...(valid.exportOptions || {}),
        ...(testCase.input?.exportOptions || {})
      }
    });
  });
});

console.log("validate-resume-export-mapping: export dto mapping whitelist and forbidden-source checks passed.");
