"use strict";

const { createId, nowIso } = require("../utils/id");
const {
  createDiscoveryIntentContract,
  validateDiscoveryIntentContract,
  createJobListingContract,
  validateJobListingContract,
  createLeadRecordContract,
  validateLeadRecordContract,
  createLeadClassificationContract,
  validateLeadClassificationContract,
  createCandidateEligibilityContract,
  validateCandidateEligibilityContract
} = require("../contracts/job-discovery-contracts");
const { deduplicateCanonicalListings } = require("./job-dedup-pipeline");
const { runBatchDecision } = require("./job-batch-decision-pipeline");
const { runExplainableRanking } = require("./job-ranking-pipeline");
const { runShortlistSelection } = require("./job-shortlist-pipeline");
const {
  createShortlistAdmissionContract,
  validateShortlistAdmissionContract
} = require("../contracts/job-shortlist-admission-contracts");
const { cleanLine, uniqueLines } = require("../contracts/canonical-resume-contracts");

const intentStore = new Map();
const listingStore = new Map();
const leadProcessingStore = new Map();
const batchDecisionStore = new Map();
const rankingStore = new Map();
const shortlistStore = new Map();
const admissionStore = new Map();

function asText(value = "", max = 220) {
  return cleanLine(value, max);
}

function parseRequirements(value = "") {
  const text = String(value || "");
  if (!text.trim()) return [];
  return uniqueLines(text.split(/\n|;|。|•|·|▪|●|■|-/), 20, 220);
}

function hasEmailSignal(text = "") {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(String(text || ""));
}

function hasMiniProgramSignal(text = "", images = []) {
  const joined = `${String(text || "")} ${(Array.isArray(images) ? images.map((item) => item?.note || item?.name || "").join(" ") : "")}`;
  return /小程序|mini[\s_-]?program|扫码投递|扫码申请|二维码|qr code/i.test(joined);
}

function hasGatewaySignal(url = "", text = "") {
  const source = `${String(url || "")} ${String(text || "")}`;
  return /career|careers|join us|jobs?$|campus|recruit|招聘官网|官网投递|官网申请/i.test(source);
}

function classifyLeadType(lead = {}) {
  const url = asText(lead.sourceUrl || "", 500);
  const rawText = asText(lead.rawText || "", 5000);
  const lowerText = `${url} ${rawText}`.toLowerCase();
  const signals = [];

  if (hasMiniProgramSignal(lowerText, lead.rawImagesMeta)) signals.push("mini_program_signal");
  if (hasEmailSignal(lowerText)) signals.push("email_signal");
  if (hasGatewaySignal(url, rawText)) signals.push("gateway_signal");
  if (/公告|announcement|招聘信息|招聘简章|招聘公告/i.test(rawText)) signals.push("announcement_signal");
  if (/apply now|立即投递|直接投递|投递链接|职位详情|job description|jd/i.test(rawText)) {
    signals.push("direct_apply_signal");
  }
  if (lead.rawTitle) signals.push("title_present");
  if (lead.rawCompany) signals.push("company_present");
  if (lead.rawLocation) signals.push("location_present");

  let leadType = "incomplete";
  if (signals.includes("mini_program_signal")) leadType = "mini_program_apply";
  else if (signals.includes("email_signal")) leadType = "email_apply";
  else if (signals.includes("gateway_signal")) leadType = "gateway_link";
  else if (signals.includes("announcement_signal")) leadType = "announcement";
  else if (lead.rawTitle && lead.rawCompany && url) leadType = "direct_apply";

  const confidence =
    leadType === "direct_apply"
      ? 0.95
      : leadType === "announcement"
        ? 0.8
        : leadType === "email_apply"
          ? 0.88
          : leadType === "gateway_link"
            ? 0.78
            : leadType === "mini_program_apply"
              ? 0.9
              : 0.55;

  return createLeadClassificationContract({
    leadId: lead.leadId,
    leadType,
    confidence,
    signals,
    classifiedAt: nowIso()
  });
}

function hasAnnouncementCandidateMinimum(lead = {}) {
  const rawText = String(lead.rawText || "").trim();
  return Boolean(
    lead.rawTitle &&
      lead.rawCompany &&
      (lead.rawLocation || lead.sourceUrl) &&
      rawText.length >= 80
  );
}

function decideCandidateEligibility(lead = {}, classification = {}) {
  const leadType = classification.leadType || "incomplete";
  const warnings = [];
  let eligibleForCandidateInput = false;
  let routing = "manual_enrich_queue";
  let reason = "Lead is incomplete and requires manual enrichment before candidate generation.";

  if (leadType === "direct_apply") {
    eligibleForCandidateInput = Boolean(lead.rawTitle && lead.rawCompany && lead.sourceUrl);
    routing = eligibleForCandidateInput ? "candidate_input" : "manual_enrich_queue";
    reason = eligibleForCandidateInput
      ? "Lead has direct-apply signals with minimum company/title/url fields."
      : "Direct-apply lead is missing minimum company/title/url fields.";
  } else if (leadType === "announcement") {
    eligibleForCandidateInput = hasAnnouncementCandidateMinimum(lead);
    routing = eligibleForCandidateInput ? "candidate_input" : "manual_enrich_queue";
    reason = eligibleForCandidateInput
      ? "Announcement contains sufficient text and minimum fields for candidate generation."
      : "Announcement lacks sufficient text or core fields and must enter manual enrich queue.";
    if (!eligibleForCandidateInput) warnings.push("announcement_text_insufficient");
  } else if (leadType === "email_apply") {
    routing = "email_apply_reserved";
    reason = "Email-apply lead is classified and retained, but does not enter candidate input in phase 1.";
    warnings.push("execution_not_supported_in_phase_1");
  } else if (leadType === "gateway_link") {
    routing = "manual_followup_required";
    reason = "Gateway link requires official apply URL enrichment before candidate generation.";
    warnings.push("gateway_resolution_required");
  } else if (leadType === "mini_program_apply") {
    routing = "manual_followup_required";
    reason = "Mini-program or QR-based lead requires manual follow-up and is blocked from candidate generation.";
    warnings.push("mini_program_not_supported_in_phase_1");
  }

  return createCandidateEligibilityContract({
    leadId: lead.leadId,
    leadType,
    eligibleForCandidateInput,
    routing,
    reason,
    warnings,
    decidedAt: nowIso()
  });
}

function mapLeadRecordToCandidateInput(lead = {}) {
  return normalizeCandidateInput({
    source: lead.source || "feishu",
    sourceUrl: lead.sourceUrl || "",
    sourceJobId: lead.sourceLeadId || lead.leadId || "",
    title: lead.rawTitle || "",
    company: lead.rawCompany || "",
    location: lead.rawLocation || "",
    jdSummary: lead.rawText || "",
    metadata: {
      sourceLabel: "feishu_lead",
      importedBy: "system",
      extractionStrategy: "lead_classification",
      rawPayloadDigest: `${lead.sourceLeadId || lead.leadId || ""}:${lead.fetchMeta?.docName || ""}`,
      applyUrl: lead.fetchMeta?.applyUrl || "",
      noticeUrl: lead.fetchMeta?.noticeUrl || "",
      routing: lead.fetchMeta?.routing || "",
      linkResolutionStatus: lead.fetchMeta?.linkResolutionStatus || "",
      isFallback: Boolean(lead.fetchMeta?.isFallback)
    }
  });
}

function processLeadRecordsToCandidateInputs({ leadRecords = [] } = {}) {
  const classifications = leadRecords.map((lead) => {
    const classification = classifyLeadType(lead);
    const validation = validateLeadClassificationContract(classification);
    if (!validation.ok) {
      const error = new Error(`Invalid lead classification contract: ${validation.errors.join("; ")}`);
      error.code = "INVALID_LEAD_CLASSIFICATION_CONTRACT";
      error.details = { errors: validation.errors, classification };
      throw error;
    }
    return classification;
  });

  const eligibilityDecisions = leadRecords.map((lead, index) => {
    const decision = decideCandidateEligibility(lead, classifications[index]);
    const validation = validateCandidateEligibilityContract(decision);
    if (!validation.ok) {
      const error = new Error(`Invalid candidate eligibility contract: ${validation.errors.join("; ")}`);
      error.code = "INVALID_CANDIDATE_ELIGIBILITY_CONTRACT";
      error.details = { errors: validation.errors, decision };
      throw error;
    }
    return decision;
  });

  const candidateInputs = leadRecords.flatMap((lead, index) =>
    eligibilityDecisions[index].eligibleForCandidateInput ? [mapLeadRecordToCandidateInput(lead)] : []
  );

  return {
    leadRecords,
    classifications,
    eligibilityDecisions,
    candidateInputs,
    blockedLeads: leadRecords.filter((_, index) => !eligibilityDecisions[index].eligibleForCandidateInput)
  };
}

function ingestLeadRecordsToCandidateInputs({
  leads = [],
  source = "feishu",
  fetchMeta = {}
} = {}) {
  const leadRecords = (Array.isArray(leads) ? leads : []).map((lead, index) => {
    const contract = createLeadRecordContract({
      leadId: lead.leadId || createId("lead"),
      source,
      sourceUrl: lead.sourceUrl || lead.jobUrl || lead.url || lead.link || "",
      sourceLeadId: lead.sourceLeadId || lead.recordId || lead.rowId || `${source}_${fetchMeta.docName || "doc"}_${index + 1}`,
      rawTitle: lead.rawTitle || lead.title || "",
      rawCompany: lead.rawCompany || lead.company || "",
      rawLocation: lead.rawLocation || lead.location || "",
      rawText: lead.rawText || lead.description || lead.summary || lead.notes || "",
      rawImagesMeta: lead.rawImagesMeta || [],
      rawAttachmentsMeta: lead.rawAttachmentsMeta || [],
      fetchMeta: {
        provider: source,
        origin: fetchMeta.origin || `${source}_lead_ingestion`,
        docName: fetchMeta.docName || "",
        sourceUrl: lead.sourceUrl || lead.jobUrl || lead.url || lead.link || "",
        rowIndex: Number(lead.rowIndex || index + 1),
        importedAt: fetchMeta.importedAt || nowIso(),
        rawStatus: fetchMeta.rawStatus || "ok"
      },
      createdAt: lead.createdAt || nowIso()
    });
    const validation = validateLeadRecordContract(contract);
    if (!validation.ok) {
      const error = new Error(`Invalid Lead record contract: ${validation.errors.join("; ")}`);
      error.code = "INVALID_LEAD_RECORD_CONTRACT";
      error.details = { errors: validation.errors, contract };
      throw error;
    }
    return contract;
  });

  return processLeadRecordsToCandidateInputs({ leadRecords });
}

function normalizeUrl(url = "") {
  const source = String(url || "").trim();
  if (!source) return "";
  try {
    const parsed = new URL(source);
    parsed.hash = "";

    const keepParams = ["jk", "jobId", "job_id", "positionId", "position_id", "req_id"];
    const nextSearch = new URLSearchParams();
    parsed.searchParams.forEach((value, key) => {
      if (keepParams.includes(key)) nextSearch.set(key, value);
    });
    parsed.search = nextSearch.toString() ? `?${nextSearch.toString()}` : "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");

    return parsed.toString();
  } catch (error) {
    return "";
  }
}

function inferSourceFromUrl(url = "") {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes("linkedin")) return "linkedin";
    if (host.includes("indeed")) return "indeed";
    if (host.includes("zhipin") || host.includes("boss")) return "boss_zhipin";
    if (host.includes("lagou")) return "lagou";
    return "manual_link";
  } catch (error) {
    return "manual_link";
  }
}

function inferCompanyFromUrl(url = "") {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (!host) return "Unknown Company";
    return asText(host.split(".")[0], 80) || "Unknown Company";
  } catch (error) {
    return "Unknown Company";
  }
}

function inferSourceJobId(candidate = {}, normalizedUrl = "") {
  const explicit = asText(
    candidate.sourceJobId || candidate.source_id || candidate.positionId || candidate.jobId || "",
    120
  );
  if (explicit) return explicit;
  if (!normalizedUrl) return "";
  try {
    const parsed = new URL(normalizedUrl);
    const idFromQuery =
      parsed.searchParams.get("jk") ||
      parsed.searchParams.get("jobId") ||
      parsed.searchParams.get("job_id") ||
      parsed.searchParams.get("positionId") ||
      parsed.searchParams.get("position_id");
    if (idFromQuery) return asText(idFromQuery, 120);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    return asText(pathParts[pathParts.length - 1] || "", 120);
  } catch (error) {
    return "";
  }
}

function normalizeCandidateInput(candidate = {}) {
  if (typeof candidate === "string") {
    const sourceUrl = candidate;
    return {
      sourceUrl,
      normalizedUrl: normalizeUrl(sourceUrl),
      title: "Untitled Listing",
      company: inferCompanyFromUrl(sourceUrl),
      location: "",
      jobType: "unknown",
      seniority: "unknown",
      compensation: {},
      jdSummary: "",
      requirements: [],
      metadata: {}
    };
  }

  const sourceUrl = asText(
    candidate.sourceUrl || candidate.url || candidate.jobUrl || candidate.link || "",
    500
  );
  const normalizedUrl = normalizeUrl(sourceUrl);
  const requirements = Array.isArray(candidate.requirements)
    ? uniqueLines(candidate.requirements, 20, 220)
    : parseRequirements(candidate.requirements || candidate.rawJdText || "");

  return {
    source: asText(candidate.source || "", 60),
    sourceUrl,
    normalizedUrl,
    sourceJobId: inferSourceJobId(candidate, normalizedUrl),
    title: asText(candidate.title || candidate.jobTitle || "", 160),
    company: asText(candidate.company || candidate.companyName || "", 160),
    location: asText(candidate.location || candidate.city || "", 120),
    jobType: asText(candidate.jobType || candidate.employmentType || "unknown", 40) || "unknown",
    seniority: asText(candidate.seniority || candidate.level || "unknown", 40) || "unknown",
    compensation: {
      min: Number(candidate.compensation?.min ?? candidate.salaryRange?.min ?? 0),
      max: Number(candidate.compensation?.max ?? candidate.salaryRange?.max ?? 0),
      currency: asText(candidate.compensation?.currency || candidate.salaryRange?.currency || "CNY", 16) || "CNY",
      period: asText(candidate.compensation?.period || candidate.salaryRange?.period || "monthly", 16) || "monthly",
      note: asText(candidate.compensation?.note || candidate.salaryNote || "", 220)
    },
    jdSummary: asText(candidate.jdSummary || candidate.summary || "", 500),
    requirements,
    metadata: {
      sourceLabel: asText(candidate.metadata?.sourceLabel || "", 120),
      importedBy: asText(candidate.metadata?.importedBy || "system", 80) || "system",
      extractionStrategy: asText(candidate.metadata?.extractionStrategy || "manual", 60) || "manual",
      importBatchId: asText(candidate.metadata?.importBatchId || "", 80),
      rawPayloadDigest: asText(candidate.metadata?.rawPayloadDigest || "", 120),
      applyUrl: asText(candidate.metadata?.applyUrl || "", 500),
      noticeUrl: asText(candidate.metadata?.noticeUrl || "", 500),
      routing: asText(candidate.metadata?.routing || "", 80),
      linkResolutionStatus: asText(candidate.metadata?.linkResolutionStatus || "", 80),
      isFallback: Boolean(candidate.metadata?.isFallback)
    }
  };
}

function createDiscoveryIntent(input = {}) {
  const contract = createDiscoveryIntentContract({
    intentId: input.intentId || createId("intent"),
    userId: input.userId || "user_a",
    keywords: input.keywords || [],
    city: input.city || "",
    jobType: input.jobType || "unknown",
    seniority: input.seniority || "unknown",
    salaryRange: input.salaryRange || {},
    constraints: input.constraints || {},
    riskTolerance: input.riskTolerance || "medium",
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso()
  });
  const validation = validateDiscoveryIntentContract(contract);
  if (!validation.ok) {
    const error = new Error(`Invalid DiscoveryIntent contract: ${validation.errors.join("; ")}`);
    error.code = "INVALID_DISCOVERY_INTENT_CONTRACT";
    error.details = { errors: validation.errors, contract };
    throw error;
  }

  intentStore.set(contract.intentId, contract);
  if (!listingStore.has(contract.intentId)) {
    listingStore.set(contract.intentId, []);
  }
  return contract;
}

function importCandidatesToCanonicalListings({
  intentId = "",
  userId = "user_a",
  candidates = [],
  profile = {}
} = {}) {
  const intent = intentStore.get(intentId);
  if (!intent) {
    const error = new Error(`Discovery intent ${intentId} not found.`);
    error.code = "DISCOVERY_INTENT_NOT_FOUND";
    throw error;
  }

  const normalizedCandidates = (Array.isArray(candidates) ? candidates : []).map(normalizeCandidateInput);
  const createdListings = [];

  normalizedCandidates.forEach((candidate) => {
    const canonical = createJobListingContract({
      listingId: createId("listing"),
      source: candidate.source || inferSourceFromUrl(candidate.sourceUrl),
      sourceJobId: candidate.sourceJobId,
      sourceUrl: candidate.sourceUrl,
      normalizedUrl: candidate.normalizedUrl || normalizeUrl(candidate.sourceUrl),
      title: candidate.title,
      company: candidate.company,
      location: candidate.location || intent.city || "",
      jobType: candidate.jobType || intent.jobType || "unknown",
      seniority: candidate.seniority || intent.seniority || "unknown",
      compensation: candidate.compensation || {},
      jdSummary: candidate.jdSummary || "",
      requirements: candidate.requirements || [],
      metadata: {
        ...candidate.metadata,
        importedBy: candidate.metadata?.importedBy || userId || "system",
        importBatchId: candidate.metadata?.importBatchId || createId("import_batch")
      },
      ingestedAt: nowIso()
    });

    const validation = validateJobListingContract(canonical);
    if (!validation.ok) {
      const error = new Error(`Invalid JobListing contract: ${validation.errors.join("; ")}`);
      error.code = "INVALID_JOB_LISTING_CONTRACT";
      error.details = { errors: validation.errors, contract: canonical };
      throw error;
    }

    createdListings.push(canonical);
  });

  const existing = listingStore.get(intentId) || [];
  listingStore.set(intentId, [...existing, ...createdListings]);
  const allCanonicalListings = listingStore.get(intentId);
  const dedupCandidatePool = deduplicateCanonicalListings(allCanonicalListings);
  let batchDecisionResult = null;
  let rankingResult = null;
  let shortlistResult = null;
  if (dedupCandidatePool.primaryListings.length) {
    batchDecisionResult = runBatchDecision({
      intent,
      dedupCandidatePool,
      profile
    });
    batchDecisionStore.set(intentId, batchDecisionResult);
    rankingResult = runExplainableRanking(batchDecisionResult);
    rankingStore.set(intentId, rankingResult);
    shortlistResult = runShortlistSelection(rankingResult);
    shortlistStore.set(intentId, shortlistResult);
  }

  return {
    intent,
    listings: createdListings,
    totalListings: allCanonicalListings.length,
    dedupCandidatePool,
    batchDecisionResult,
    rankingResult,
    shortlistResult
  };
}

function saveLeadProcessingResult(intentId = "", leadProcessingResult = null) {
  if (!intentId) return null;
  if (!leadProcessingResult) {
    leadProcessingStore.delete(intentId);
    return null;
  }

  const summary = {
    totalLeads: Array.isArray(leadProcessingResult.leadRecords) ? leadProcessingResult.leadRecords.length : 0,
    eligibleLeads: Array.isArray(leadProcessingResult.candidateInputs) ? leadProcessingResult.candidateInputs.length : 0,
    blockedLeads: Array.isArray(leadProcessingResult.blockedLeads) ? leadProcessingResult.blockedLeads.length : 0
  };

  const stored = {
    ...leadProcessingResult,
    summary,
    updatedAt: nowIso()
  };
  leadProcessingStore.set(intentId, stored);
  return stored;
}

function getLeadProcessingResultByIntent(intentId = "") {
  return leadProcessingStore.get(intentId) || null;
}

function getDiscoveryIntent(intentId = "") {
  return intentStore.get(intentId) || null;
}

function listCanonicalListingsByIntent(intentId = "") {
  return listingStore.get(intentId) || [];
}

function getDedupCandidatePoolByIntent(intentId = "") {
  const listings = listCanonicalListingsByIntent(intentId);
  return deduplicateCanonicalListings(listings);
}

function getBatchDecisionResultByIntent(intentId = "", options = {}) {
  if (batchDecisionStore.has(intentId)) {
    return batchDecisionStore.get(intentId);
  }

  const intent = getDiscoveryIntent(intentId);
  if (!intent) return null;

  const dedupCandidatePool = getDedupCandidatePoolByIntent(intentId);
  if (!dedupCandidatePool.primaryListings.length) return null;

  const batchDecisionResult = runBatchDecision({
    intent,
    dedupCandidatePool,
    profile: options.profile || {}
  });
  batchDecisionStore.set(intentId, batchDecisionResult);
  return batchDecisionResult;
}

function getRankingResultByIntent(intentId = "", options = {}) {
  if (rankingStore.has(intentId)) {
    return rankingStore.get(intentId);
  }

  const batchDecisionResult = getBatchDecisionResultByIntent(intentId, options);
  if (!batchDecisionResult) return null;
  const rankingResult = runExplainableRanking(batchDecisionResult);
  rankingStore.set(intentId, rankingResult);
  return rankingResult;
}

function getCanonicalListingByIntentAndListingId(intentId = "", listingId = "") {
  const listings = listCanonicalListingsByIntent(intentId);
  return listings.find((item) => item.listingId === listingId) || null;
}

function findListingInBucket(shortlistResult = {}, bucket = "shortlisted", listingId = "") {
  const items = Array.isArray(shortlistResult?.[bucket]) ? shortlistResult[bucket] : [];
  return items.find((item) => item.listingId === listingId) || null;
}

function resolveShortlistBucket(shortlistResult = {}, listingId = "") {
  const shortlisted = findListingInBucket(shortlistResult, "shortlistedItems", listingId);
  if (shortlisted) return { bucket: "shortlisted", item: shortlisted };
  const hold = findListingInBucket(shortlistResult, "holdItems", listingId);
  if (hold) return { bucket: "hold", item: hold };
  const skipped = findListingInBucket(shortlistResult, "skippedItems", listingId);
  if (skipped) return { bucket: "skipped", item: skipped };
  return { bucket: "unlisted", item: null };
}

function buildAdmissionStatus({
  bucket = "unlisted",
  overrideReason = "",
  allowSkipOverride = false
} = {}) {
  const hasOverride = Boolean(String(overrideReason || "").trim());
  if (bucket === "shortlisted") return "admitted";
  if (bucket === "hold") return hasOverride ? "overridden" : "override_required";
  if (bucket === "skipped") {
    if (!hasOverride) return "blocked";
    return allowSkipOverride ? "overridden" : "blocked";
  }
  return "blocked";
}

function createShortlistAdmission({
  intentId = "",
  listingId = "",
  actor = "system",
  overrideReason = "",
  allowSkipOverride = false
} = {}) {
  const shortlistResult = getShortlistResultByIntent(intentId, {});
  if (!shortlistResult) {
    const error = new Error(`Shortlist result for intent ${intentId} not found.`);
    error.code = "SHORTLIST_RESULT_NOT_FOUND";
    throw error;
  }
  const listing = getCanonicalListingByIntentAndListingId(intentId, listingId);
  if (!listing) {
    const error = new Error(`Listing ${listingId} not found in intent ${intentId}.`);
    error.code = "LISTING_NOT_FOUND";
    throw error;
  }

  const resolved = resolveShortlistBucket(shortlistResult, listingId);
  const bucketItem = resolved.item || {
    listingId,
    clusterId: `cluster_${listingId}`,
    recommendation: "skip",
    nextAction: "skip",
    selectionReason: "Listing is not part of shortlist output.",
    sourceListingsSummary: [
      {
        listingId: listing.listingId,
        source: listing.source,
        normalizedUrl: listing.normalizedUrl || listing.sourceUrl,
        title: listing.title,
        company: listing.company,
        location: listing.location,
        isPrimary: true
      }
    ]
  };
  const status = buildAdmissionStatus({
    bucket: resolved.bucket,
    overrideReason,
    allowSkipOverride
  });

  const admission = createShortlistAdmissionContract({
    admissionId: createId("admission"),
    intentId,
    shortlistId: shortlistResult.shortlistId,
    listingId: bucketItem.listingId,
    clusterId: bucketItem.clusterId,
    recommendation: bucketItem.recommendation,
    nextAction: bucketItem.nextAction,
    selectionReason: bucketItem.selectionReason,
    sourceListingsSummary: bucketItem.sourceListingsSummary,
    admissionBucket: resolved.bucket,
    admissionStatus: status,
    actor,
    confirmedBy: status === "admitted" || status === "overridden" ? actor : "",
    override: {
      applied: status === "overridden",
      originalBucket: resolved.bucket,
      overrideReason: status === "overridden" ? String(overrideReason || "").trim() : "",
      actor,
      timestamp: status === "overridden" ? nowIso() : null
    },
    requiredActions:
      status === "override_required"
        ? ["Provide explicit override reason to admit hold listing."]
        : status === "blocked"
          ? ["Listing is skipped or unlisted. Override policy is required to continue."]
          : [],
    createdAt: nowIso()
  });
  const validation = validateShortlistAdmissionContract(admission);
  if (!validation.ok) {
    const error = new Error(`Invalid ShortlistAdmission contract: ${validation.errors.join("; ")}`);
    error.code = "INVALID_SHORTLIST_ADMISSION_CONTRACT";
    error.details = { errors: validation.errors, admission };
    throw error;
  }

  const key = `${intentId}:${listingId}`;
  admissionStore.set(key, admission);
  return admission;
}

function getShortlistAdmission(intentId = "", listingId = "") {
  return admissionStore.get(`${intentId}:${listingId}`) || null;
}

function getShortlistResultByIntent(intentId = "", options = {}) {
  if (shortlistStore.has(intentId)) {
    return shortlistStore.get(intentId);
  }

  const rankingResult = getRankingResultByIntent(intentId, options);
  if (!rankingResult) return null;
  const shortlistResult = runShortlistSelection(rankingResult, options);
  shortlistStore.set(intentId, shortlistResult);
  return shortlistResult;
}

module.exports = {
  createDiscoveryIntent,
  classifyLeadType,
  decideCandidateEligibility,
  ingestLeadRecordsToCandidateInputs,
  processLeadRecordsToCandidateInputs,
  importCandidatesToCanonicalListings,
  saveLeadProcessingResult,
  getLeadProcessingResultByIntent,
  getDiscoveryIntent,
  listCanonicalListingsByIntent,
  getDedupCandidatePoolByIntent,
  getBatchDecisionResultByIntent,
  getRankingResultByIntent,
  getShortlistResultByIntent,
  createShortlistAdmission,
  getShortlistAdmission,
  getCanonicalListingByIntentAndListingId,
  mapLeadRecordToCandidateInput,
  normalizeCandidateInput,
  normalizeUrl
};
