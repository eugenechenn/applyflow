"use strict";

const fs = require("fs");
const path = require("path");
const {
  createDiscoveryIntentContract,
  validateDiscoveryIntentContract,
  createJobListingContract,
  validateJobListingContract
} = require("../../src/lib/contracts/job-discovery-contracts");
const {
  createDiscoveryIntent,
  importCandidatesToCanonicalListings,
  normalizeCandidateInput
} = require("../../src/lib/discovery/job-discovery-pipeline");

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

function expectError(label, expectedCode, fn) {
  try {
    fn();
  } catch (error) {
    if (error?.code === expectedCode) return;
    throw new Error(`${label} expected ${expectedCode}, got ${error?.code || "unknown"}`);
  }
  throw new Error(`${label} expected ${expectedCode}, but no error thrown.`);
}

const intentFixture = readFixture("discovery-intent-fixture.json");
const listingFixture = readFixture("job-listing-contract-fixture.json");
const linkImportFixture = readFixture("discovery-link-import-fixture.json");

const validIntent = createDiscoveryIntentContract(intentFixture.valid || {});
assertValid("discoveryIntent.valid", validateDiscoveryIntentContract(validIntent));

(intentFixture.invalidCases || []).forEach((testCase) => {
  const contract = createDiscoveryIntentContract(testCase.intent || {});
  assertInvalid(
    `discoveryIntent.invalid.${testCase.name}`,
    validateDiscoveryIntentContract(contract),
    testCase.expectedErrorContains || ""
  );
});

const validListing = createJobListingContract(listingFixture.valid || {});
assertValid("jobListing.valid", validateJobListingContract(validListing));

(listingFixture.invalidCases || []).forEach((testCase) => {
  const contract = createJobListingContract(testCase.listing || {});
  assertInvalid(
    `jobListing.invalid.${testCase.name}`,
    validateJobListingContract(contract),
    testCase.expectedErrorContains || ""
  );
});

const intent = createDiscoveryIntent(linkImportFixture.intentInput || {});
const imported = importCandidatesToCanonicalListings({
  intentId: intent.intentId,
  userId: intent.userId,
  candidates: linkImportFixture.candidates || []
});

if ((imported.listings || []).length < Number(linkImportFixture.expected?.minListings || 1)) {
  throw new Error("link import did not create expected number of canonical listings.");
}
if (!imported.dedupCandidatePool || typeof imported.dedupCandidatePool !== "object") {
  throw new Error("link import should return dedupCandidatePool.");
}

if (linkImportFixture.expected?.requiresNormalizedUrl) {
  imported.listings.forEach((listing, index) => {
    if (!listing.normalizedUrl || !/^https?:\/\//i.test(listing.normalizedUrl)) {
      throw new Error(`imported listing ${index + 1} missing normalizedUrl`);
    }
  });
}

(linkImportFixture.invalidCases || []).forEach((testCase) => {
  expectError(`linkImport.invalid.${testCase.name}`, "INVALID_JOB_LISTING_CONTRACT", () => {
    const badIntent = createDiscoveryIntent({
      ...linkImportFixture.intentInput,
      intentId: ""
    });
    importCandidatesToCanonicalListings({
      intentId: badIntent.intentId,
      userId: badIntent.userId,
      candidates: [testCase.candidate]
    });
  });
});

const normalizedStringCandidate = normalizeCandidateInput("https://example.com/jobs/abc?utm_source=test");
if (!normalizedStringCandidate.normalizedUrl) {
  throw new Error("normalizeCandidateInput should normalize url string candidate.");
}

console.log("validate-discovery-contracts: discovery intent, canonical listing, and import normalization passed.");
