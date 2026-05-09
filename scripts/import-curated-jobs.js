"use strict";

/**
 * 导入 curated 高质量岗位池（仅追加，不覆盖原有 jobs）。
 * 支持 dry-run 与按 sourceVersion 回滚（删除同版本导入数据）。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const store = require("../src/server/store");
const { nowIso } = require("../src/lib/utils/id");

const DEFAULT_FILE = "data/curated_offline_v1.json";
const ALLOWED_TIERS = new Set(["gold", "silver", "bronze"]);
const ALLOWED_JOB_TYPES = new Set(["不限", "校招", "实习", "社招", "any", "campus", "internship", "fulltime"]);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  argv.forEach((item) => {
    const [key, ...rest] = String(item || "").split("=");
    if (!key.startsWith("--")) return;
    args[key.slice(2)] = rest.join("=");
  });
  return {
    filePath: args.file || process.env.CURATED_JOBS_FILE || DEFAULT_FILE,
    dryRun: args.dryRun === "true" || process.env.CURATED_JOBS_DRY_RUN === "true",
    rollback: args.rollback === "true",
    sourceTag: String(args.sourceTag || process.env.CURATED_SOURCE_TAG || "curated_offline_v1").trim(),
    sourceVersion: String(args.sourceVersion || process.env.CURATED_SOURCE_VERSION || "v202604_batch5b").trim()
  };
}

function readJsonFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const payload = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const records = Array.isArray(payload) ? payload : Array.isArray(payload.records) ? payload.records : [];
  return { absolutePath, records };
}

function normalizeText(value = "", fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function normalizeRecord(record = {}, fallbackTag = "curated_offline_v1", fallbackVersion = "v202604_batch5b") {
  return {
    title: normalizeText(record.title),
    company: normalizeText(record.company),
    location: normalizeText(record.location),
    description: normalizeText(record.description),
    applyUrl: normalizeText(record.applyUrl),
    source: normalizeText(record.source, "curated_manual"),
    sourceQualityTier: normalizeText(record.sourceQualityTier, "gold").toLowerCase(),
    sourceTag: normalizeText(record.sourceTag, fallbackTag),
    sourceVersion: normalizeText(record.sourceVersion, fallbackVersion),
    capturedAt: normalizeText(record.capturedAt, nowIso()),
    industryHint: normalizeText(record.industryHint, "其他"),
    roleHint: normalizeText(record.roleHint, "未知"),
    jobTypeHint: normalizeText(record.jobTypeHint, "不限"),
    isMultiRole: Boolean(record.isMultiRole)
  };
}

function validateRecord(record = {}) {
  const errors = [];
  if (!record.title) errors.push("title missing");
  if (!record.company) errors.push("company missing");
  if (!record.location) errors.push("location missing");
  if (!record.description || record.description.length < 80) errors.push("description too short");
  if (!/^https?:\/\//i.test(record.applyUrl)) errors.push("applyUrl invalid");
  if (!ALLOWED_TIERS.has(record.sourceQualityTier)) errors.push("sourceQualityTier invalid");
  if (!record.sourceTag) errors.push("sourceTag missing");
  if (!record.sourceVersion) errors.push("sourceVersion missing");
  if (!record.capturedAt || Number.isNaN(Date.parse(record.capturedAt))) errors.push("capturedAt invalid");
  if (!ALLOWED_JOB_TYPES.has(record.jobTypeHint)) errors.push("jobTypeHint invalid");
  return errors;
}

function buildStableJobId(record = {}) {
  const raw = `${record.sourceVersion}|${record.sourceTag}|${record.company}|${record.title}|${record.location}|${record.applyUrl}`;
  const digest = crypto.createHash("sha1").update(raw).digest("hex").slice(0, 20);
  return `job_curated_${digest}`;
}

function buildDraft(record = {}) {
  const timestamp = nowIso();
  const id = buildStableJobId(record);
  return {
    id,
    externalId: id,
    sourceJobId: id,
    company: record.company,
    title: record.title,
    location: record.location,
    priority: "medium",
    status: "inbox",
    sourceLabel: record.sourceTag,
    sourcePlatform: "curated_offline",
    jobUrl: record.applyUrl,
    sourceUrl: record.applyUrl,
    applyUrl: record.applyUrl,
    jdRaw: record.description,
    metadata: {
      sourceTag: record.sourceTag,
      sourceVersion: record.sourceVersion,
      sourceQualityTier: record.sourceQualityTier,
      capturedAt: record.capturedAt,
      industryHint: record.industryHint,
      roleHint: record.roleHint,
      jobTypeHint: record.jobTypeHint,
      isMultiRole: record.isMultiRole,
      curatedSource: record.source
    },
    importMeta: {
      strategy: "curated_offline_pool_seed",
      sourceTag: record.sourceTag,
      sourceVersion: record.sourceVersion,
      sourceQualityTier: record.sourceQualityTier,
      seedImportedAt: timestamp,
      inferredIndustry: record.industryHint
    },
    discoveryContext: {
      source: "curated_offline_pool_seed",
      sourceTag: record.sourceTag,
      sourceVersion: record.sourceVersion
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function isFromSourceVersion(job = {}, sourceVersion = "") {
  const version = String(sourceVersion || "").trim();
  if (!version) return false;
  return (
    String(job.importMeta?.sourceVersion || "").trim() === version ||
    String(job.metadata?.sourceVersion || "").trim() === version ||
    String(job.discoveryContext?.sourceVersion || "").trim() === version
  );
}

function importRecords(records = [], options = {}) {
  const existingJobs = store.listJobs();
  const existingIds = new Set(existingJobs.map((job) => String(job.id || "").trim()).filter(Boolean));
  const invalidRecords = [];
  const normalized = [];
  records.forEach((item, index) => {
    const record = normalizeRecord(item, options.sourceTag, options.sourceVersion);
    const errors = validateRecord(record);
    if (errors.length > 0) {
      invalidRecords.push({ index, errors, record });
      return;
    }
    normalized.push(record);
  });

  const drafts = normalized.map(buildDraft);
  const toInsert = drafts.filter((draft) => !existingIds.has(draft.id));
  if (!options.dryRun) {
    toInsert.forEach((draft) => store.saveJob(draft));
  }

  return {
    invalidRecords,
    inputCount: records.length,
    validCount: normalized.length,
    duplicateCount: drafts.length - toInsert.length,
    insertedCount: options.dryRun ? 0 : toInsert.length,
    wouldInsertCount: toInsert.length
  };
}

function rollbackBySourceVersion(options = {}) {
  const userId = store.DEFAULT_USER_ID || "user_a";
  const sqliteAdapter = require("../src/server/db/adapters/sqlite-adapter");
  if (!sqliteAdapter || typeof sqliteAdapter.run !== "function") {
    throw new Error("rollback requires sqlite runtime");
  }
  const allJobs = store.listJobs();
  const targetIds = allJobs.filter((job) => isFromSourceVersion(job, options.sourceVersion)).map((job) => String(job.id || "").trim()).filter(Boolean);
  if (targetIds.length === 0) {
    return { deleted: 0, matched: 0 };
  }
  if (!options.dryRun) {
    targetIds.forEach((id) => {
      sqliteAdapter.run("DELETE FROM jobs WHERE user_id = ? AND id = ?", [userId, id]);
    });
  }
  return {
    deleted: options.dryRun ? 0 : targetIds.length,
    matched: targetIds.length
  };
}

function main() {
  const options = parseArgs();
  const beforeJobs = store.listJobs().length;
  let summary;
  if (options.rollback) {
    const rollbackSummary = rollbackBySourceVersion(options);
    summary = {
      mode: "rollback",
      sourceVersion: options.sourceVersion,
      dryRun: options.dryRun,
      ...rollbackSummary,
      beforeJobs,
      afterJobs: store.listJobs().length
    };
  } else {
    const { absolutePath, records } = readJsonFile(options.filePath);
    const importSummary = importRecords(records, options);
    summary = {
      mode: "import",
      file: absolutePath,
      sourceTag: options.sourceTag,
      sourceVersion: options.sourceVersion,
      dryRun: options.dryRun,
      ...importSummary,
      invalidSamples: importSummary.invalidRecords.slice(0, 5),
      beforeJobs,
      afterJobs: store.listJobs().length
    };
  }
  console.log(JSON.stringify(summary, null, 2));
}

main();
