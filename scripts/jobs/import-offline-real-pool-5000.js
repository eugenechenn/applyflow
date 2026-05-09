"use strict";

/**
 * 从标准化飞书离线数据中受控导入 5000 条真实岗位候选池。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const store = require("../../src/server/store");
const { nowIso } = require("../../src/lib/utils/id");
const { classifyJobPreference } = require("../../src/lib/jobs/job-preference-classifier");

const DEFAULT_FILE = "data/standardized_feishu_records.json";
const DEFAULT_LIMIT = 5000;
const DEFAULT_SOURCE_VERSION = "offline_real_pool_5000_v20260508";
const STRICT_SINGLE_ROLE_ANCHORS = [
  { key: "pm", role: "产品经理", aliases: ["产品经理", "AI产品经理", "软件产品经理"] },
  { key: "data", role: "数据分析师", aliases: ["数据分析师", "数据分析"] },
  { key: "algorithm", role: "算法工程师", aliases: ["算法工程师", "机器学习算法工程师"] }
];
const MANUAL_ANCHOR_RECORDS = [
  {
    sourceJobId: "manual_pm_anchor_xhs_rpt_20260508",
    company: "小红书RPT产品培训生计划",
    title: "产品经理",
    location: "上海",
    applyUrl: "",
    noticeUrl: "https://www.xiaohongshu.com/",
    sourceUrl: "https://www.xiaohongshu.com/",
    rawText: "小红书RPT产品培训生计划 | 产品经理 | 上海 | 严格单岗锚点，用于真实池 PM 排序验收。",
    routing: "manual_anchor",
    linkResolutionStatus: "notice_only",
    fetchMeta: { snapshotFile: "manual_anchor" },
    manualAnchor: true
  }
];

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  argv.forEach((item) => {
    const [key, ...rest] = String(item || "").split("=");
    if (!key.startsWith("--")) return;
    args[key.slice(2)] = rest.join("=");
  });
  return {
    filePath: args.file || process.env.OFFLINE_REAL_POOL_FILE || DEFAULT_FILE,
    limit: normalizePositiveInt(args.limit || process.env.OFFLINE_REAL_POOL_LIMIT, DEFAULT_LIMIT),
    dryRun: args.dryRun === "true" || process.env.OFFLINE_REAL_POOL_DRY_RUN === "true",
    sourceVersion: String(args.sourceVersion || process.env.OFFLINE_REAL_POOL_SOURCE_VERSION || DEFAULT_SOURCE_VERSION).trim()
  };
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(5000, Math.floor(parsed)));
}

function readRecords(filePath) {
  const absolutePath = path.resolve(filePath);
  const payload = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const records = Array.isArray(payload) ? payload : Array.isArray(payload.records) ? payload.records : [];
  return { absolutePath, records };
}

function toText(value = "") {
  return String(value || "").trim();
}

function normalizeRecord(record = {}) {
  const applyUrl = toText(record.apply_url || record.applyUrl);
  const noticeUrl = toText(record.notice_url || record.noticeUrl);
  const sourceUrl = applyUrl || noticeUrl;
  const normalizedLocation = toText(record.location);
  return {
    sourceJobId: toText(record.sourceJobId || record.source_job_id || record.id),
    company: toText(record.company),
    title: toText(record.title),
    location: /^(地点未说明|未说明|暂无|无|-|—|--)$/i.test(normalizedLocation) ? "" : normalizedLocation,
    applyUrl,
    noticeUrl,
    sourceUrl,
    rawText: toText(record.raw_text || record.rawText || record.description),
    routing: toText(record.routing),
    linkResolutionStatus: toText(record.link_resolution_status || record.linkResolutionStatus),
    fetchMeta: record.fetchMeta && typeof record.fetchMeta === "object" ? record.fetchMeta : {}
  };
}

function isImportable(record = {}) {
  const lowInformationTitle = /^(具体参见官网|详见官网|见官网|官网|招聘岗位|多个岗位|若干岗位|校招岗位|社招岗位)$/i.test(record.title);
  return Boolean(
    record.sourceJobId &&
      record.company &&
      record.title &&
      record.title.length >= 4 &&
      !lowInformationTitle &&
      record.sourceUrl &&
      /^https?:\/\//i.test(record.sourceUrl) &&
      record.rawText.length >= 20
  );
}

function buildStableJobId(sourceJobId = "") {
  const digest = crypto.createHash("sha1").update(String(sourceJobId || "")).digest("hex").slice(0, 18);
  return `job_real5000_${digest}`;
}

function collectExistingIdentity(jobs = []) {
  const sourceIds = new Set();
  const jobIds = new Set();
  const companyTitleKeys = new Set();
  const importedByVersion = [];
  jobs.forEach((job) => {
    const jobId = toText(job.id);
    if (jobId) jobIds.add(jobId);
    const companyTitleKey = `${toText(job.company)}::${toText(job.title)}`;
    if (companyTitleKey !== "::") companyTitleKeys.add(companyTitleKey);
    [
      job.sourceJobId,
      job.externalId,
      job.importMeta?.sourceJobId,
      job.discoveryContext?.sourceJobId,
      job.discoveryContext?.listingId
    ].forEach((value) => {
      const id = toText(value);
      if (id) sourceIds.add(id);
    });
    if (toText(job.importMeta?.sourceVersion) === DEFAULT_SOURCE_VERSION) {
      importedByVersion.push(jobId);
    }
  });
  return { sourceIds, jobIds, companyTitleKeys, importedByVersion };
}

function classifyRecord(record = {}) {
  const classification = classifyJobPreference({
    lightweightProfile: {},
    job: {
      company: record.company,
      title: record.title,
      location: record.location,
      raw_text: record.rawText
    }
  });
  return {
    inferredIndustry: toText(classification.inferredIndustry) || "其他",
    inferredRoleFamily: toText(classification.inferredRoleFamily) || "未知",
    opportunityType: toText(classification.opportunityType) || ""
  };
}

function bucketize(records = [], existing = {}) {
  const buckets = new Map();
  const skipped = {
    invalid: 0,
    duplicateExisting: 0,
    duplicateInput: 0
  };
  const seenInput = new Set();
  records.forEach((rawRecord) => {
    const record = normalizeRecord(rawRecord);
    if (!isImportable(record)) {
      skipped.invalid += 1;
      return;
    }
    const jobId = buildStableJobId(record.sourceJobId);
    if (existing.sourceIds.has(record.sourceJobId) || existing.jobIds.has(jobId)) {
      skipped.duplicateExisting += 1;
      return;
    }
    if (seenInput.has(record.sourceJobId)) {
      skipped.duplicateInput += 1;
      return;
    }
    seenInput.add(record.sourceJobId);
    const classification = classifyRecord(record);
    const bucketKey = classification.inferredIndustry || "其他";
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
    buckets.get(bucketKey).push({ record, classification });
  });
  return { buckets, skipped };
}

function selectRoundRobin(buckets = new Map(), limit = DEFAULT_LIMIT) {
  const bucketEntries = Array.from(buckets.entries()).sort((a, b) => b[1].length - a[1].length);
  const selected = [];
  let cursor = 0;
  while (selected.length < limit && bucketEntries.some(([, items]) => cursor < items.length)) {
    bucketEntries.forEach(([, items]) => {
      if (selected.length >= limit) return;
      if (cursor < items.length) selected.push(items[cursor]);
    });
    cursor += 1;
  }
  return selected;
}

function isStrictSingleRoleAnchor(item = {}, target = {}) {
  const title = toText(item.record?.title);
  const rawText = toText(item.record?.rawText);
  if (!title) return false;
  const aliases = Array.isArray(target.aliases) ? target.aliases : [target.role];
  const titleMatches = aliases.some((alias) => title === alias || title === `${alias}岗` || title === `${alias}岗位`);
  if (!titleMatches) return false;
  if (/[、,，;；/|｜]/.test(title)) return false;
  if (/管培生|管理培训生|综合岗|岗位合集|多岗位/.test(`${title} ${rawText}`)) return false;
  return true;
}

function collectStrictRoleAnchors(selectedCandidates = [], limit = DEFAULT_LIMIT) {
  const anchors = [];
  const anchorIds = new Set();
  STRICT_SINGLE_ROLE_ANCHORS.forEach((target) => {
    const match = selectedCandidates.find((item) => isStrictSingleRoleAnchor(item, target));
    if (!match) return;
    const sourceJobId = toText(match.record?.sourceJobId);
    if (!sourceJobId || anchorIds.has(sourceJobId)) return;
    anchors.push(match);
    anchorIds.add(sourceJobId);
  });
  return anchors.slice(0, Math.max(0, limit));
}

function selectWithStrictRoleAnchors(buckets = new Map(), limit = DEFAULT_LIMIT) {
  const candidates = Array.from(buckets.values()).flat();
  const anchors = collectStrictRoleAnchors(candidates, limit);
  const anchorSourceIds = new Set(anchors.map((item) => toText(item.record?.sourceJobId)).filter(Boolean));
  const regularBuckets = new Map(
    Array.from(buckets.entries()).map(([key, items]) => [
      key,
      items.filter((item) => !anchorSourceIds.has(toText(item.record?.sourceJobId)))
    ])
  );
  return [...anchors, ...selectRoundRobin(regularBuckets, Math.max(0, limit - anchors.length))];
}

function buildManualAnchorItems(existing = {}) {
  return MANUAL_ANCHOR_RECORDS
    .map((record) => normalizeRecord(record))
    .filter((record) => {
      const jobId = buildStableJobId(record.sourceJobId);
      const companyTitleKey = `${toText(record.company)}::${toText(record.title)}`;
      return (
        isImportable(record) &&
        !existing.sourceIds.has(record.sourceJobId) &&
        !existing.jobIds.has(jobId) &&
        !existing.companyTitleKeys.has(companyTitleKey)
      );
    })
    .map((record) => ({ record, classification: classifyRecord(record), manualAnchor: true }));
}

function buildJobDraft(item = {}, sourceVersion = DEFAULT_SOURCE_VERSION) {
  const { record, classification } = item;
  const timestamp = nowIso();
  const id = buildStableJobId(record.sourceJobId);
  return {
    id,
    sourceJobId: record.sourceJobId,
    externalId: record.sourceJobId,
    company: record.company,
    title: record.title,
    location: record.location,
    priority: "medium",
    status: "inbox",
    sourceLabel: "feishu_offline_real_pool",
    sourcePlatform: "offline_json",
    jobUrl: record.applyUrl || record.noticeUrl,
    sourceUrl: record.noticeUrl || record.applyUrl,
    applyUrl: record.applyUrl,
    noticeUrl: record.noticeUrl,
    jdRaw: record.rawText,
    metadata: {
      sourceTag: "offline_real_pool_5000",
      sourceVersion,
      sourceQualityTier: record.applyUrl ? "silver" : "bronze",
      linkResolutionStatus: record.linkResolutionStatus,
      routing: record.routing,
      inferredIndustry: classification.inferredIndustry,
      inferredRoleFamily: classification.inferredRoleFamily,
      opportunityType: classification.opportunityType,
      manualAnchor: Boolean(item.manualAnchor || record.manualAnchor)
    },
    importMeta: {
      strategy: "offline_real_pool_5000_seed",
      sourceJobId: record.sourceJobId,
      sourceVersion,
      inferredIndustry: classification.inferredIndustry,
      inferredRoleFamily: classification.inferredRoleFamily,
      opportunityType: classification.opportunityType,
      linkResolutionStatus: record.linkResolutionStatus,
      routing: record.routing,
      snapshotFile: record.fetchMeta?.snapshotFile || "",
      manualAnchor: Boolean(item.manualAnchor || record.manualAnchor),
      seedImportedAt: timestamp
    },
    discoveryContext: {
      intentId: "",
      listingId: record.sourceJobId,
      sourceJobId: record.sourceJobId,
      source: "offline_real_pool_5000_seed",
      sourceVersion
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function summarizeSelected(selected = []) {
  const byIndustry = {};
  const byRoleFamily = {};
  const bySourceQualityTier = {};
  selected.forEach(({ record, classification }) => {
    byIndustry[classification.inferredIndustry] = (byIndustry[classification.inferredIndustry] || 0) + 1;
    byRoleFamily[classification.inferredRoleFamily] = (byRoleFamily[classification.inferredRoleFamily] || 0) + 1;
    const tier = record.applyUrl ? "silver" : "bronze";
    bySourceQualityTier[tier] = (bySourceQualityTier[tier] || 0) + 1;
  });
  return { byIndustry, byRoleFamily, bySourceQualityTier };
}

function main() {
  const options = parseArgs();
  const beforeJobs = store.listJobs();
  const existing = collectExistingIdentity(beforeJobs);
  const { absolutePath, records } = readRecords(options.filePath);
  const { buckets, skipped } = bucketize(records, existing);
  const selected = selectWithStrictRoleAnchors(buckets, options.limit);
  const manualAnchors = buildManualAnchorItems(existing);
  const selectedWithAnchors = [...selected, ...manualAnchors];
  const drafts = selectedWithAnchors.map((item) => buildJobDraft(item, options.sourceVersion));

  if (!options.dryRun) {
    drafts.forEach((draft) => store.saveJob(draft));
  }

  const afterJobs = store.listJobs();
  const report = {
    sourceFile: absolutePath,
    sourceVersion: options.sourceVersion,
    dryRun: options.dryRun,
    requestedLimit: options.limit,
    totalSourceRecords: records.length,
    beforeJobs: beforeJobs.length,
    afterJobs: afterJobs.length,
    selectedJobs: selected.length,
    manualAnchorJobs: manualAnchors.length,
    importedJobs: options.dryRun ? 0 : drafts.length,
    skipped,
    existingImportedByDefaultVersion: existing.importedByVersion.filter(Boolean).length,
    ...summarizeSelected(selectedWithAnchors),
    sample: drafts.slice(0, 10).map((job) => ({
      id: job.id,
      company: job.company,
      title: job.title,
      location: job.location,
      sourceQualityTier: job.metadata.sourceQualityTier,
      inferredIndustry: job.importMeta.inferredIndustry,
      inferredRoleFamily: job.importMeta.inferredRoleFamily,
      opportunityType: job.importMeta.opportunityType
    }))
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
