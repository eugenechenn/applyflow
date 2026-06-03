#!/usr/bin/env node
"use strict";

/**
 * 将本地 5000+ 真实岗位池受控写入 production D1 的指定白名单用户。
 * 会先备份目标用户现有岗位相关表，再分块替换写入，避免一次性 SQL 过大。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { classifyJobPreference } = require("../../src/lib/jobs/job-preference-classifier");

const ROOT = path.resolve(__dirname, "../..");
const WRANGLER_CONFIG = "wrangler.jsonc";
const DB_NAME = "applyflow";
const EXPECTED_DB_ID = "6b1e6220-aaa8-41c5-bdeb-a86e4f37719f";
const DEFAULT_FILE = "data/standardized_feishu_records.json";
const DEFAULT_LIMIT = 5000;
const DEFAULT_SOURCE_VERSION = "production_real_pool_5000_v20260603";
const TARGET_EMAIL = String(process.env.TARGET_EMAIL || "eugenec7012@126.com").trim().toLowerCase();
const TARGET_USER_ID = String(process.env.TARGET_USER_ID || "").trim();
const CHUNK_SIZE = Math.max(1, Math.min(100, Number(process.env.CHUNK_SIZE || 40)));
const MAX_SQL_BYTES = Math.max(10000, Math.min(120000, Number(process.env.MAX_SQL_BYTES || 60000)));
const DRY_RUN = String(process.env.DRY_RUN || "").trim().toLowerCase() === "true";
const RESUME = String(process.env.RESUME || "").trim().toLowerCase() === "true";
const BACKUP_TABLES = [
  { table: "jobs", orderBy: "updated_at DESC" },
  { table: "fit_assessments", orderBy: "updated_at DESC" },
  { table: "application_preps", orderBy: "updated_at DESC" },
  { table: "tailoring_outputs", orderBy: "updated_at DESC" },
  { table: "application_tasks", orderBy: "updated_at DESC" },
  { table: "interview_reflections", orderBy: "updated_at DESC" },
  { table: "activity_logs", orderBy: "timestamp DESC" },
  { table: "bad_cases", orderBy: "updated_at DESC" }
];
const STRICT_SINGLE_ROLE_ANCHORS = [
  { role: "产品经理", aliases: ["产品经理", "AI产品经理", "软件产品经理"] },
  { role: "数据分析师", aliases: ["数据分析师", "数据分析"] },
  { role: "算法工程师", aliases: ["算法工程师", "机器学习算法工程师"] }
];
const MANUAL_ANCHOR_RECORDS = [
  {
    sourceJobId: "manual_pm_anchor_xhs_rpt_20260508",
    company: "小红书RPT产品培训生计划",
    title: "产品经理",
    location: "上海",
    applyUrl: "https://job.xiaohongshu.com/campus/position?campusRecruitTypes=term_regular&themeCode=OHOX2XEEW6SW7K8AF6",
    noticeUrl: "https://mp.weixin.qq.com/s/MQyaEGpID-ZpoiCw3ZjPkw",
    sourceUrl: "https://job.xiaohongshu.com/campus/position?campusRecruitTypes=term_regular&themeCode=OHOX2XEEW6SW7K8AF6",
    rawText: "小红书RPT产品培训生计划 | 产品经理 | 上海 | 严格单岗锚点，用于真实池 PM 排序验收。",
    routing: "manual_anchor",
    linkResolutionStatus: "notice_only",
    fetchMeta: { snapshotFile: "manual_anchor" },
    manualAnchor: true
  }
];

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function escapeSql(value = "") {
  return String(value).replace(/'/g, "''");
}

function extractJsonArrayBlock(text = "") {
  const source = String(text || "");
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "[") continue;
    let depth = 0;
    for (let index = start; index < source.length; index += 1) {
      if (source[index] === "[") depth += 1;
      if (source[index] === "]") {
        depth -= 1;
        if (depth === 0) {
          const candidate = source.slice(start, index + 1).trim();
          try {
            const parsed = JSON.parse(candidate);
            if (Array.isArray(parsed)) return candidate;
          } catch (_error) {
            // continue
          }
        }
      }
    }
  }
  return "[]";
}

function runWranglerSql(sql) {
  const escapedSql = String(sql).replace(/"/g, '`"');
  const command = `npx.cmd wrangler d1 execute ${DB_NAME} --remote --command "${escapedSql}" --json`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024
  });
  if (result.error) throw new Error(`wrangler spawn failed: ${result.error.message || result.error}`);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "wrangler failed").trim());
  const first = JSON.parse(extractJsonArrayBlock(result.stdout))[0] || {};
  return {
    results: Array.isArray(first.results) ? first.results : [],
    meta: first.meta || {}
  };
}

function runWranglerSqlFile(sql, prefix = "prod-real-pool") {
  const tmpDir = path.join(ROOT, "tmp", "production-real-pool");
  fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
  fs.writeFileSync(filePath, String(sql), "utf8");
  const command = `npx.cmd wrangler d1 execute ${DB_NAME} --remote --file "${filePath}" --json`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024
  });
  if (result.error) throw new Error(`wrangler spawn failed: ${result.error.message || result.error}`);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "wrangler failed").trim());
  return filePath;
}

function queryCount(sql) {
  return Number(runWranglerSql(sql).results?.[0]?.cnt || 0);
}

function queryExistingTargetJobIds(targetUserId) {
  const count = queryCount(`SELECT COUNT(*) AS cnt FROM jobs WHERE user_id='${escapeSql(targetUserId)}';`);
  const ids = new Set();
  for (let offset = 0; offset < count; offset += 500) {
    const rows = runWranglerSql(
      `SELECT id FROM jobs WHERE user_id='${escapeSql(targetUserId)}' ORDER BY id LIMIT 500 OFFSET ${offset};`
    ).results;
    rows.forEach((row) => {
      if (row?.id) ids.add(String(row.id));
    });
  }
  return ids;
}

function readRecords(filePath = DEFAULT_FILE) {
  const absolutePath = path.resolve(ROOT, filePath);
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
    fetchMeta: record.fetchMeta && typeof record.fetchMeta === "object" ? record.fetchMeta : {},
    manualAnchor: Boolean(record.manualAnchor)
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

function bucketize(records = []) {
  const buckets = new Map();
  const skipped = { invalid: 0, duplicateInput: 0 };
  const seenInput = new Set();
  records.forEach((rawRecord) => {
    const record = normalizeRecord(rawRecord);
    if (!isImportable(record)) {
      skipped.invalid += 1;
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
  const aliases = Array.isArray(target.aliases) ? target.aliases : [target.role];
  const titleMatches = aliases.some((alias) => title === alias || title === `${alias}岗` || title === `${alias}岗位`);
  return Boolean(titleMatches && !/[、,，;；/|｜]/.test(title) && !/管培生|管理培训生|综合岗|岗位合集|多岗位/.test(`${title} ${rawText}`));
}

function collectStrictRoleAnchors(selectedCandidates = [], limit = DEFAULT_LIMIT) {
  const anchors = [];
  const anchorIds = new Set();
  STRICT_SINGLE_ROLE_ANCHORS.forEach((target) => {
    const match = selectedCandidates.find((item) => isStrictSingleRoleAnchor(item, target));
    const sourceJobId = toText(match?.record?.sourceJobId);
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

function buildManualAnchorItems() {
  return MANUAL_ANCHOR_RECORDS.map((record) => normalizeRecord(record))
    .filter(isImportable)
    .map((record) => ({ record, classification: classifyRecord(record), manualAnchor: true }));
}

function buildJobDraft(item = {}, targetUserId, sourceVersion = DEFAULT_SOURCE_VERSION) {
  const { record, classification } = item;
  const timestamp = new Date().toISOString();
  const sourceId = record.sourceJobId;
  const id = `${targetUserId}__${buildStableJobId(sourceId)}`;
  return {
    id,
    userId: targetUserId,
    sourceJobId: sourceId,
    externalId: sourceId,
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
      strategy: "production_real_pool_5000_seed",
      sourceJobId: sourceId,
      sourceVersion,
      targetUserId,
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
      listingId: sourceId,
      sourceJobId: sourceId,
      source: "production_real_pool_5000_seed",
      sourceVersion
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function resolveTargetUserId() {
  if (TARGET_USER_ID) return TARGET_USER_ID;
  const row = runWranglerSql(
    `SELECT id,email,username FROM users WHERE lower(email)='${escapeSql(TARGET_EMAIL)}' OR lower(username)='${escapeSql(TARGET_EMAIL)}' LIMIT 1;`
  ).results[0];
  assertTrue(row?.id, `target user not found for ${TARGET_EMAIL}`);
  return row.id;
}

function backupTargetRows(targetUserId) {
  const tmpDir = path.join(ROOT, "tmp", "production-real-pool");
  fs.mkdirSync(tmpDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(tmpDir, `backup-before-real-pool-${targetUserId}-${stamp}.jsonl`);
  const manifestPath = path.join(tmpDir, `backup-before-real-pool-${targetUserId}-${stamp}.manifest.json`);
  const manifest = { targetUserId, createdAt: new Date().toISOString(), tables: {} };
  fs.writeFileSync(backupPath, "", "utf8");
  BACKUP_TABLES.forEach(({ table, orderBy }) => {
    const count = queryCount(`SELECT COUNT(*) AS cnt FROM ${table} WHERE user_id='${escapeSql(targetUserId)}';`);
    manifest.tables[table] = count;
    for (let offset = 0; offset < count; offset += 200) {
      const rows = runWranglerSql(
        `SELECT * FROM ${table} WHERE user_id='${escapeSql(targetUserId)}' ORDER BY ${orderBy} LIMIT 200 OFFSET ${offset};`
      ).results;
      rows.forEach((row) => fs.appendFileSync(backupPath, `${JSON.stringify({ table, row })}\n`, "utf8"));
    }
  });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { backupPath, manifestPath, manifest };
}

function buildCleanupSql(targetUserId) {
  const user = escapeSql(targetUserId);
  return `${BACKUP_TABLES.map(({ table }) => `DELETE FROM ${table} WHERE user_id='${user}';`).join("\n")}\n`;
}

function buildInsertSql(jobs = []) {
  const values = jobs.map((job) => {
    const jsonText = JSON.stringify(job);
    return `('${escapeSql(job.id)}','${escapeSql(job.userId)}','${escapeSql(job.status)}','${escapeSql(job.priority)}','${escapeSql(job.updatedAt)}','${escapeSql(jsonText)}')`;
  });
  return `INSERT OR IGNORE INTO jobs (id, user_id, status, priority, updated_at, json_text) VALUES\n${values.join(",\n")};\n`;
}

function buildInsertChunks(jobs = []) {
  const chunks = [];
  let current = [];
  jobs.forEach((job) => {
    const candidate = [...current, job];
    const candidateSql = buildInsertSql(candidate);
    if (current.length > 0 && (candidate.length > CHUNK_SIZE || Buffer.byteLength(candidateSql, "utf8") > MAX_SQL_BYTES)) {
      chunks.push(current);
      current = [job];
    } else {
      current = candidate;
    }
  });
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function summarizeJobs(jobs = []) {
  const byIndustry = {};
  const byRoleFamily = {};
  const bySourceQualityTier = {};
  jobs.forEach((job) => {
    byIndustry[job.importMeta.inferredIndustry] = (byIndustry[job.importMeta.inferredIndustry] || 0) + 1;
    byRoleFamily[job.importMeta.inferredRoleFamily] = (byRoleFamily[job.importMeta.inferredRoleFamily] || 0) + 1;
    bySourceQualityTier[job.metadata.sourceQualityTier] = (bySourceQualityTier[job.metadata.sourceQualityTier] || 0) + 1;
  });
  return { byIndustry, byRoleFamily, bySourceQualityTier };
}

function main() {
  const config = fs.readFileSync(path.join(ROOT, WRANGLER_CONFIG), "utf8");
  assertTrue(config.includes(`"database_name": "${DB_NAME}"`) && config.includes(`"database_id": "${EXPECTED_DB_ID}"`), "production D1 guard failed");
  const targetUserId = resolveTargetUserId();
  assertTrue(/^user_[a-z0-9]+$/i.test(targetUserId), `unexpected target user id: ${targetUserId}`);
  const { absolutePath, records } = readRecords();
  const { buckets, skipped } = bucketize(records);
  const selected = selectWithStrictRoleAnchors(buckets, DEFAULT_LIMIT);
  const jobs = [...selected, ...buildManualAnchorItems()].map((item) => buildJobDraft(item, targetUserId));
  const report = {
    targetEmail: TARGET_EMAIL,
    targetUserId,
    dryRun: DRY_RUN,
    resume: RESUME,
    sourceFile: absolutePath,
    sourceRecords: records.length,
    selectedJobs: selected.length,
    totalJobsToWrite: jobs.length,
    chunkSize: CHUNK_SIZE,
    maxSqlBytes: MAX_SQL_BYTES,
    skipped,
    ...summarizeJobs(jobs),
    sample: jobs.slice(0, 10).map((job) => ({ id: job.id, company: job.company, title: job.title, location: job.location }))
  };
  console.log(JSON.stringify(report, null, 2));
  let jobsToWrite = jobs;
  if (RESUME) {
    const existingIds = queryExistingTargetJobIds(targetUserId);
    jobsToWrite = jobs.filter((job) => !existingIds.has(job.id));
    console.log(`[resume] existing=${existingIds.size} missing=${jobsToWrite.length}`);
  }
  const insertChunks = buildInsertChunks(jobsToWrite);
  console.log(`[chunks] count=${insertChunks.length} maxSqlBytes=${MAX_SQL_BYTES}`);
  if (DRY_RUN) return;

  if (!RESUME) {
    const backup = backupTargetRows(targetUserId);
    console.log(`[backup] path=${backup.backupPath} manifest=${backup.manifestPath}`);
    runWranglerSqlFile(buildCleanupSql(targetUserId), "cleanup");
  } else {
    console.log("[resume] skip backup and cleanup; continue with INSERT OR IGNORE");
  }
  let insertedAttempt = 0;
  for (let index = 0; index < insertChunks.length; index += 1) {
    const chunk = insertChunks[index];
    runWranglerSqlFile(buildInsertSql(chunk), `insert-${String(index).padStart(5, "0")}`);
    insertedAttempt += chunk.length;
    console.log(`[insert] ${insertedAttempt}/${jobsToWrite.length} chunk=${index + 1}/${insertChunks.length}`);
  }
  const finalCount = queryCount(`SELECT COUNT(*) AS cnt FROM jobs WHERE user_id='${escapeSql(targetUserId)}';`);
  const badLinkCount = queryCount(
    `SELECT COUNT(*) AS cnt FROM jobs WHERE user_id='${escapeSql(targetUserId)}' AND (json_extract(json_text,'$.sourceUrl') IS NULL OR json_extract(json_text,'$.sourceUrl') NOT LIKE 'http%' OR json_extract(json_text,'$.sourceUrl') LIKE '%example.com%' OR json_extract(json_text,'$.sourceUrl') LIKE '%applyflow.local%');`
  );
  assertTrue(finalCount === jobs.length, `final count mismatch: expected=${jobs.length} actual=${finalCount}`);
  assertTrue(badLinkCount === 0, `bad copied links detected: ${badLinkCount}`);
  console.log(`provision-production-beta-user-real-pool: PASS target=${targetUserId} jobs=${finalCount} badLinks=${badLinkCount}`);
}

try {
  main();
} catch (error) {
  console.error(`provision-production-beta-user-real-pool: FAIL - ${error.message || error}`);
  process.exit(1);
}
