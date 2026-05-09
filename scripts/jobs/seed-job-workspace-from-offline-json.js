"use strict";

/**
 * 从 offline_json 标准化岗位中按行业分层补充 jobs 工作台数据池。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const store = require("../../src/server/store");
const { nowIso } = require("../../src/lib/utils/id");
const { classifyJobPreference } = require("../../src/lib/jobs/job-preference-classifier");

const DEFAULT_FILE = "data/standardized_feishu_records.json";
const DEFAULT_LIMIT_PER_INDUSTRY = 50;
const TARGET_INDUSTRIES = ["金融", "教育", "游戏", "AI/算法"];

function readJsonFile(filePath = DEFAULT_FILE) {
  const absolutePath = path.resolve(filePath);
  const payload = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const records = Array.isArray(payload) ? payload : Array.isArray(payload.records) ? payload.records : [];
  return { absolutePath, records };
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  argv.forEach((item) => {
    const [key, ...rest] = String(item || "").split("=");
    if (!key.startsWith("--")) return;
    args[key.slice(2)] = rest.join("=");
  });
  return {
    filePath: args.file || process.env.OFFLINE_JSON_SEED_FILE || DEFAULT_FILE,
    limitPerIndustry: normalizePositiveInt(args.limitPerIndustry || process.env.OFFLINE_JSON_SEED_LIMIT_PER_INDUSTRY, DEFAULT_LIMIT_PER_INDUSTRY),
    dryRun: args.dryRun === "true" || process.env.OFFLINE_JSON_SEED_DRY_RUN === "true"
  };
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(500, Math.floor(parsed)));
}

function normalizeRecord(record = {}) {
  const sourceUrl = String(record.apply_url || record.applyUrl || record.notice_url || record.noticeUrl || "").trim();
  return {
    sourceJobId: String(record.sourceJobId || record.source_job_id || record.id || "").trim(),
    company: String(record.company || "").trim(),
    title: String(record.title || "").trim(),
    location: String(record.location || "").trim(),
    applyUrl: String(record.apply_url || record.applyUrl || "").trim(),
    noticeUrl: String(record.notice_url || record.noticeUrl || "").trim(),
    rawText: String(record.raw_text || record.rawText || record.description || "").trim(),
    sourceUrl,
    routing: String(record.routing || "").trim(),
    fetchMeta: record.fetchMeta && typeof record.fetchMeta === "object" ? record.fetchMeta : {}
  };
}

function isRealRecord(record = {}) {
  return Boolean(record.sourceJobId && record.company && record.title && record.sourceUrl && /^https?:\/\//i.test(record.sourceUrl));
}

function inferIndustry(record = {}) {
  const classification = classifyJobPreference({
    lightweightProfile: {},
    job: {
      company: record.company,
      title: record.title,
      location: record.location,
      raw_text: record.rawText
    }
  });
  return classification.inferredIndustry || "其他";
}

function collectExistingSeedState(jobs = []) {
  const ids = new Set();
  const industryCounts = new Map(TARGET_INDUSTRIES.map((industry) => [industry, 0]));
  (Array.isArray(jobs) ? jobs : []).forEach((job) => {
    [
      job.sourceJobId,
      job.externalId,
      job.importMeta?.sourceJobId,
      job.importMeta?.externalId,
      job.discoveryContext?.sourceJobId
    ].forEach((value) => {
      const id = String(value || "").trim();
      if (id) ids.add(id);
    });
    const seededByThisScript =
      String(job.id || "").startsWith("job_offline_") ||
      job.importMeta?.strategy === "offline_json_workspace_seed" ||
      job.discoveryContext?.source === "offline_json_workspace_seed";
    const industry = String(job.importMeta?.inferredIndustry || "").trim();
    if (seededByThisScript && industryCounts.has(industry)) {
      industryCounts.set(industry, industryCounts.get(industry) + 1);
    }
  });
  return { ids, industryCounts };
}

function buildStableJobId(sourceJobId = "") {
  const digest = crypto.createHash("sha1").update(String(sourceJobId || "")).digest("hex").slice(0, 16);
  return `job_offline_${digest}`;
}

function buildJobDraft(record = {}, inferredIndustry = "") {
  const timestamp = nowIso();
  return {
    id: buildStableJobId(record.sourceJobId),
    sourceJobId: record.sourceJobId,
    externalId: record.sourceJobId,
    company: record.company,
    title: record.title,
    location: record.location,
    priority: "medium",
    status: "inbox",
    sourceLabel: "feishu_offline_json",
    sourcePlatform: "offline_json",
    jobUrl: record.applyUrl || record.noticeUrl,
    sourceUrl: record.noticeUrl || record.applyUrl,
    applyUrl: record.applyUrl,
    noticeUrl: record.noticeUrl,
    jdRaw: record.rawText,
    importMeta: {
      strategy: "offline_json_workspace_seed",
      sourceJobId: record.sourceJobId,
      inferredIndustry,
      routing: record.routing,
      linkResolutionStatus: record.fetchMeta?.link_resolution_status || record.fetchMeta?.linkResolutionStatus || "",
      seedImportedAt: timestamp
    },
    discoveryContext: {
      intentId: "",
      listingId: record.sourceJobId,
      sourceJobId: record.sourceJobId,
      source: "offline_json_workspace_seed"
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function selectRecordsByIndustry(records = [], existingSeedState = {}, limitPerIndustry = DEFAULT_LIMIT_PER_INDUSTRY) {
  const selectedByIndustry = new Map(TARGET_INDUSTRIES.map((industry) => [industry, []]));
  const seen = new Set(existingSeedState.ids || []);
  const existingCounts = existingSeedState.industryCounts || new Map();

  records.map(normalizeRecord).forEach((record) => {
    if (!isRealRecord(record) || seen.has(record.sourceJobId)) return;
    const inferredIndustry = inferIndustry(record);
    if (!selectedByIndustry.has(inferredIndustry)) return;
    const currentIndustryCount =
      Number(existingCounts.get(inferredIndustry) || 0) + selectedByIndustry.get(inferredIndustry).length;
    if (currentIndustryCount >= limitPerIndustry) return;
    const bucket = selectedByIndustry.get(inferredIndustry);
    bucket.push({ record, inferredIndustry });
    seen.add(record.sourceJobId);
  });

  return selectedByIndustry;
}

function main() {
  const options = parseArgs();
  const beforeJobs = store.listJobs();
  const existingSeedState = collectExistingSeedState(beforeJobs);
  const { absolutePath, records } = readJsonFile(options.filePath);
  const selectedByIndustry = selectRecordsByIndustry(records, existingSeedState, options.limitPerIndustry);
  const selected = Array.from(selectedByIndustry.values()).flat();

  if (!options.dryRun) {
    selected.forEach(({ record, inferredIndustry }) => {
      store.saveJob(buildJobDraft(record, inferredIndustry));
    });
  }

  const afterJobs = store.listJobs();
  const summary = {
    sourceFile: absolutePath,
    dryRun: options.dryRun,
    totalSourceRecords: records.length,
    beforeJobs: beforeJobs.length,
    afterJobs: afterJobs.length,
    importedJobs: options.dryRun ? 0 : selected.length,
    selectedJobs: selected.length,
    limitPerIndustry: options.limitPerIndustry,
    existingSeededByIndustry: Object.fromEntries(existingSeedState.industryCounts),
    byIndustry: Object.fromEntries(
      Array.from(selectedByIndustry.entries()).map(([industry, items]) => [industry, items.length])
    )
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();
