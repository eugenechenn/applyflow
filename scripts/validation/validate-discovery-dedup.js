"use strict";

const fs = require("fs");
const path = require("path");
const {
  deduplicateCanonicalListings,
  buildDedupKey
} = require("../../src/lib/discovery/job-dedup-pipeline");
const {
  createDedupResultContract,
  validateDedupResultContract
} = require("../../src/lib/contracts/job-dedup-contracts");

function readFixture(fileName) {
  const filePath = path.resolve(process.cwd(), "scripts/fixtures", fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

const fixture = readFixture("discovery-dedup-fixture.json");
const listings = fixture.listings || [];
const expected = fixture.expected || {};

const result = deduplicateCanonicalListings(listings);
const summary = result.dedupSummary || {};

assertTrue(summary.totalInput === Number(expected.totalInput), "dedup totalInput mismatch");
assertTrue(summary.totalPrimary === Number(expected.totalPrimary), "dedup totalPrimary mismatch");
assertTrue(summary.totalDuplicates === Number(expected.totalDuplicates), "dedup totalDuplicates mismatch");
assertTrue(summary.duplicateClusterCount === Number(expected.duplicateClusterCount), "dedup duplicateClusterCount mismatch");

const reasons = new Set((result.dedupClusters || []).map((item) => item.dedupReason));
(expected.mustContainReasons || []).forEach((reason) => {
  assertTrue(reasons.has(reason), `dedup reason not found: ${reason}`);
});

const listingToCluster = new Map();
(result.dedupClusters || []).forEach((cluster) => {
  const validation = validateDedupResultContract(cluster);
  if (!validation.ok) {
    throw new Error(`invalid dedup cluster contract: ${validation.errors.join("; ")}`);
  }
  assertTrue(cluster.confidence >= 0 && cluster.confidence <= 1, "cluster confidence out of range");
  (cluster.sourceListings || []).forEach((source) => {
    listingToCluster.set(source.listingId, cluster.clusterId);
  });
});

(expected.mustNotMergePairs || []).forEach((pair) => {
  const left = pair[0];
  const right = pair[1];
  assertTrue(
    listingToCluster.get(left) !== listingToCluster.get(right),
    `pair should not be merged but was merged: ${left} & ${right}`
  );
});

const sampleKey = buildDedupKey(listings[0] || {});
assertTrue(
  /url=.*::company=.*::title=.*::location=.*/.test(sampleKey),
  "dedupKey format is invalid"
);

const manualContract = createDedupResultContract({
  clusterId: "cluster_manual_001",
  primaryListingId: "listing_manual_001",
  duplicateListingIds: ["listing_manual_002"],
  dedupReason: "semantic_match",
  confidence: 0.85,
  dedupKey: "url=na::company=manual::title=pm::location=shanghai",
  sourceListings: [
    {
      listingId: "listing_manual_001",
      source: "manual_link",
      sourceUrl: "https://example.com/jobs/1",
      normalizedUrl: "https://example.com/jobs/1",
      sourceJobId: "1",
      title: "PM",
      company: "Manual",
      location: "Shanghai",
      isPrimary: true
    },
    {
      listingId: "listing_manual_002",
      source: "manual_link",
      sourceUrl: "https://example.com/jobs/2",
      normalizedUrl: "https://example.com/jobs/2",
      sourceJobId: "2",
      title: "PM",
      company: "Manual",
      location: "Shanghai",
      isPrimary: false
    }
  ]
});
const manualValidation = validateDedupResultContract(manualContract);
assertTrue(manualValidation.ok, `manual dedup contract should be valid: ${(manualValidation.errors || []).join("; ")}`);

console.log("validate-discovery-dedup: dedup key, clusters, confidence, and non-merge boundaries passed.");
