"use strict";

const { createId } = require("../utils/id");
const {
  createDedupResultContract,
  validateDedupResultContract
} = require("../contracts/job-dedup-contracts");

const TITLE_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "with",
  "at",
  "jr",
  "junior",
  "sr",
  "senior",
  "lead",
  "manager",
  "intern",
  "contract",
  "full",
  "time",
  "part"
]);

function normalizeTokenText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\/(www\.)?/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeTitle(title = "") {
  return normalizeTokenText(title)
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !TITLE_STOP_WORDS.has(item))
    .slice(0, 12);
}

function jaccardSimilarity(left = [], right = []) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (!union.size) return 0;
  let intersectionCount = 0;
  leftSet.forEach((token) => {
    if (rightSet.has(token)) intersectionCount += 1;
  });
  return intersectionCount / union.size;
}

function buildUrlSignature(normalizedUrl = "") {
  const text = String(normalizedUrl || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    const host = normalizeTokenText(parsed.hostname.replace(/^www\./, ""));
    const pathname = normalizeTokenText(parsed.pathname);
    const query = normalizeTokenText(parsed.search || "");
    return `${host}|${pathname}|${query}`;
  } catch (error) {
    return normalizeTokenText(text);
  }
}

function buildCompanySignature(value = "") {
  return normalizeTokenText(value).replace(/\b(inc|llc|ltd|co|corp|limited)\b/g, "").trim();
}

function buildLocationSignature(value = "") {
  return normalizeTokenText(value);
}

function buildTitleSignature(value = "") {
  const tokens = tokenizeTitle(value);
  return tokens.join(" ");
}

function buildDedupKey(listing = {}) {
  const urlSignature = buildUrlSignature(listing.normalizedUrl || "");
  const companySignature = buildCompanySignature(listing.company || "");
  const titleSignature = buildTitleSignature(listing.title || "");
  const locationSignature = buildLocationSignature(listing.location || "");
  return `url=${urlSignature || "na"}::company=${companySignature || "na"}::title=${titleSignature || "na"}::location=${locationSignature || "na"}`;
}

function buildListingFingerprint(listing = {}) {
  return {
    listing,
    urlSignature: buildUrlSignature(listing.normalizedUrl || ""),
    companySignature: buildCompanySignature(listing.company || ""),
    titleTokens: tokenizeTitle(listing.title || ""),
    titleSignature: buildTitleSignature(listing.title || ""),
    locationSignature: buildLocationSignature(listing.location || ""),
    dedupKey: buildDedupKey(listing)
  };
}

function computeMatchScore(base = {}, candidate = {}) {
  const sameUrl = Boolean(base.urlSignature) && base.urlSignature === candidate.urlSignature;
  const sameCompany = Boolean(base.companySignature) && base.companySignature === candidate.companySignature;
  const sameLocation = Boolean(base.locationSignature) && base.locationSignature === candidate.locationSignature;
  const titleSimilarity = jaccardSimilarity(base.titleTokens || [], candidate.titleTokens || []);

  if (sameUrl && sameCompany) {
    return {
      matched: true,
      dedupReason: "url_exact_match",
      confidence: titleSimilarity >= 0.5 || !candidate.titleTokens?.length || !base.titleTokens?.length ? 0.99 : 0.94
    };
  }

  if (sameCompany && sameLocation && titleSimilarity >= 0.72) {
    return {
      matched: true,
      dedupReason: "semantic_match",
      confidence: Number((0.75 + titleSimilarity * 0.2).toFixed(2))
    };
  }

  return { matched: false, dedupReason: "unique_listing", confidence: 0 };
}

function scorePrimaryListing(listing = {}) {
  const requirementScore = Math.min((Array.isArray(listing.requirements) ? listing.requirements.length : 0) * 8, 48);
  const summaryScore = Math.min(String(listing.jdSummary || "").trim().length / 10, 30);
  const compensation = listing.compensation || {};
  const compensationScore = Number(compensation.max || 0) > 0 || Number(compensation.min || 0) > 0 ? 10 : 0;
  const sourceScore = listing.source && listing.source !== "manual_link" ? 6 : 0;
  return requirementScore + summaryScore + compensationScore + sourceScore;
}

function selectPrimaryListing(cluster = []) {
  return [...cluster].sort((left, right) => {
    const scoreDiff = scorePrimaryListing(right) - scorePrimaryListing(left);
    if (scoreDiff !== 0) return scoreDiff;
    const leftTime = new Date(left.ingestedAt || 0).getTime();
    const rightTime = new Date(right.ingestedAt || 0).getTime();
    return leftTime - rightTime;
  })[0];
}

function buildDedupClusterContract(clusterListings = [], dedupReason = "unique_listing", confidence = 1) {
  if (!clusterListings.length) return null;

  const primary = selectPrimaryListing(clusterListings);
  const duplicates = clusterListings
    .filter((item) => item.listingId !== primary.listingId)
    .map((item) => item.listingId);
  const dedupKey = buildDedupKey(primary);

  const contract = createDedupResultContract({
    clusterId: createId("cluster"),
    primaryListingId: primary.listingId,
    duplicateListingIds: duplicates,
    dedupReason: duplicates.length ? dedupReason : "unique_listing",
    confidence: duplicates.length ? confidence : 1,
    dedupKey,
    sourceListings: clusterListings.map((item, index) => ({
      listingId: item.listingId,
      source: item.source,
      sourceUrl: item.sourceUrl,
      normalizedUrl: item.normalizedUrl,
      sourceJobId: item.sourceJobId,
      title: item.title,
      company: item.company,
      location: item.location,
      ingestedAt: item.ingestedAt,
      isPrimary: item.listingId === primary.listingId,
      rankInCluster: index + 1
    }))
  });

  const validation = validateDedupResultContract(contract);
  if (!validation.ok) {
    const error = new Error(`Invalid DedupResult contract: ${validation.errors.join("; ")}`);
    error.code = "INVALID_DEDUP_RESULT_CONTRACT";
    error.details = { errors: validation.errors, contract };
    throw error;
  }

  return contract;
}

function deduplicateCanonicalListings(listings = []) {
  const fingerprints = (Array.isArray(listings) ? listings : []).map(buildListingFingerprint);
  const clusters = [];

  fingerprints.forEach((fingerprint) => {
    let matchedCluster = null;
    let matchedMeta = null;

    clusters.forEach((cluster) => {
      if (matchedCluster) return;
      const baseFingerprint = cluster.primaryFingerprint || buildListingFingerprint(cluster.items[0] || {});
      const match = computeMatchScore(baseFingerprint, fingerprint);
      if (match.matched) {
        matchedCluster = cluster;
        matchedMeta = match;
      }
    });

    if (matchedCluster) {
      matchedCluster.items.push(fingerprint.listing);
      matchedCluster.primaryFingerprint = buildListingFingerprint(selectPrimaryListing(matchedCluster.items));
      if (matchedMeta.confidence > matchedCluster.confidence) {
        matchedCluster.confidence = matchedMeta.confidence;
      }
      if (matchedCluster.dedupReason === "semantic_match" && matchedMeta.dedupReason === "url_exact_match") {
        matchedCluster.dedupReason = "url_exact_match";
      } else if (matchedCluster.dedupReason === "unique_listing") {
        matchedCluster.dedupReason = matchedMeta.dedupReason;
      }
      return;
    }

    clusters.push({
      items: [fingerprint.listing],
      primaryFingerprint: fingerprint,
      dedupReason: "unique_listing",
      confidence: 1
    });
  });

  const dedupClusters = clusters
    .map((cluster) => buildDedupClusterContract(cluster.items, cluster.dedupReason, cluster.confidence))
    .filter(Boolean);
  const primaryListings = dedupClusters
    .map((cluster) => cluster.sourceListings.find((item) => item.isPrimary))
    .filter(Boolean)
    .map((source) => listings.find((listing) => listing.listingId === source.listingId))
    .filter(Boolean);
  const duplicateListings = dedupClusters.flatMap((cluster) =>
    cluster.duplicateListingIds.map((listingId) => listings.find((item) => item.listingId === listingId)).filter(Boolean)
  );

  return {
    primaryListings,
    duplicateListings,
    dedupClusters,
    dedupSummary: {
      totalInput: listings.length,
      totalPrimary: primaryListings.length,
      totalDuplicates: duplicateListings.length,
      duplicateClusterCount: dedupClusters.filter((cluster) => cluster.duplicateListingIds.length > 0).length
    }
  };
}

module.exports = {
  buildDedupKey,
  deduplicateCanonicalListings
};
