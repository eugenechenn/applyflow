#!/usr/bin/env node
"use strict";

/**
 * staging beta 用户岗位链接回填：
 * - 仅允许 staging D1
 * - 不触碰 demo_user / staging_real_pool_user / user_a
 * - 从标准化飞书真实源按 company + title 回填 applyUrl/sourceUrl/jobUrl
 * - 只删除无法对应真实来源的旧 fallback 占位岗位
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const EXPECTED_DB_NAME = "applyflow-staging";
const EXPECTED_DB_ID = "ed3ef70f-7ca8-4f95-9858-f5ea825d7188";
const WRANGLER_ENV = "staging";
const WRANGLER_BINDING = "APPLYFLOW_DB";
const PROTECTED_USERS = new Set(["demo_user", "staging_real_pool_user", "user_a"]);
const SOURCE_PATH = path.join(ROOT, "data", "standardized_feishu_records.json");

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function extractJsonArrayBlock(text = "") {
  const source = String(text || "");
  const match = source.match(/\[\s*\{[\s\S]*\}\s*\]/);
  return match ? match[0] : "[]";
}

function runWranglerSql(sql) {
  const escapedSql = String(sql).replace(/"/g, '`"');
  const command = `npm.cmd exec wrangler -- d1 execute ${WRANGLER_BINDING} --config wrangler.jsonc --env ${WRANGLER_ENV} --remote --command "${escapedSql}" --json`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw new Error(`wrangler spawn failed: ${result.error.message || result.error}`);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "wrangler failed").trim());
  const first = JSON.parse(extractJsonArrayBlock(result.stdout))[0] || {};
  return Array.isArray(first.results) ? first.results : [];
}

function runWranglerSqlFile(sql, prefix = "beta-link-backfill") {
  const tmpDir = path.join(ROOT, "tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, `${prefix}-${Date.now()}.sql`);
  fs.writeFileSync(filePath, String(sql), "utf8");
  try {
    const command = `npm.cmd exec wrangler -- d1 execute ${WRANGLER_BINDING} --config wrangler.jsonc --env ${WRANGLER_ENV} --remote --file "${filePath}" --json`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    if (result.error) throw new Error(`wrangler spawn failed: ${result.error.message || result.error}`);
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || "wrangler failed").trim());
    return true;
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch (_error) {
      // ignore cleanup failure
    }
  }
}

function escapeSql(value = "") {
  return String(value).replace(/'/g, "''");
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value = "") {
  return normalizeText(value).toLowerCase();
}

function isValidUrl(value = "") {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function pickApplyUrl(record = {}) {
  return [record.apply_url, record.applyUrl, record.sourceUrl, record.notice_url, record.noticeUrl]
    .map((value) => String(value || "").trim())
    .find(isValidUrl) || "";
}

function pickNoticeUrl(record = {}) {
  return [record.notice_url, record.noticeUrl, record.sourceUrl, record.apply_url, record.applyUrl]
    .map((value) => String(value || "").trim())
    .find(isValidUrl) || "";
}

function buildSourceIndex() {
  const payload = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8"));
  const records = Array.isArray(payload) ? payload : Array.isArray(payload.records) ? payload.records : [];
  const exact = new Map();
  const byCompany = new Map();
  records.forEach((record) => {
    const applyUrl = pickApplyUrl(record);
    if (!applyUrl) return;
    const company = normalizeText(record.company);
    const title = normalizeText(record.title);
    if (!company || !title) return;
    const indexed = { ...record, applyUrl, noticeUrl: pickNoticeUrl(record) };
    exact.set(`${normalizeKey(company)}\u0001${normalizeKey(title)}`, indexed);
    const companyKey = normalizeKey(company);
    if (!byCompany.has(companyKey)) byCompany.set(companyKey, []);
    byCompany.get(companyKey).push(indexed);
  });
  return { exact, byCompany };
}

function isFallbackJob(job = {}) {
  return (
    String(job.company || "") === "工程师 团队" ||
    String(job.title || "") === "工程师 相关岗位" ||
    /applyflow\.local\/fallback/i.test(String(job.jobUrl || job.sourceUrl || job.applyUrl || "")) ||
    /^fallback_/i.test(String(job.sourceJobId || job.externalId || ""))
  );
}

function matchSource(job = {}, index) {
  const exact = index.exact.get(`${normalizeKey(job.company)}\u0001${normalizeKey(job.title)}`);
  if (exact) return { record: exact, strategy: "exact_company_title" };

  const sameCompany = index.byCompany.get(normalizeKey(job.company)) || [];
  if (sameCompany.length === 1) return { record: sameCompany[0], strategy: "unique_company" };

  const jobTitle = normalizeText(job.title);
  const containsMatch = sameCompany.find((record) => {
    const sourceTitle = normalizeText(record.title);
    return sourceTitle.includes(jobTitle) || jobTitle.includes(sourceTitle);
  });
  if (containsMatch) return { record: containsMatch, strategy: "company_title_contains" };

  return { record: null, strategy: "unmatched" };
}

function updateJobLinks(job = {}, source = {}, strategy = "") {
  const applyUrl = source.applyUrl;
  const noticeUrl = source.noticeUrl || applyUrl;
  return {
    ...job,
    jobUrl: applyUrl,
    sourceUrl: applyUrl,
    applyUrl,
    noticeUrl,
    metadata: {
      ...(job.metadata || {}),
      linkBackfill: {
        source: "standardized_feishu_records",
        strategy,
        backfilledAt: new Date().toISOString()
      }
    }
  };
}

function main() {
  const config = fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
  assertTrue(WRANGLER_ENV === "staging", "refusing to run outside staging");
  assertTrue(
    config.includes(`"database_name": "${EXPECTED_DB_NAME}"`) && config.includes(`"database_id": "${EXPECTED_DB_ID}"`),
    "staging D1 guard failed"
  );

  const rows = runWranglerSql(
    "SELECT user_id, id, status, priority, updated_at, json_text FROM jobs WHERE user_id NOT IN ('demo_user','staging_real_pool_user','user_a') ORDER BY user_id, id;"
  );
  const index = buildSourceIndex();
  const updates = [];
  const deletes = [];
  const unmatched = [];

  rows.forEach((row) => {
    assertTrue(!PROTECTED_USERS.has(String(row.user_id)), `protected user selected: ${row.user_id}`);
    const job = JSON.parse(row.json_text || "{}");
    const matched = matchSource(job, index);
    if (matched.record) {
      updates.push({ row, job: updateJobLinks(job, matched.record, matched.strategy), strategy: matched.strategy });
      return;
    }
    if (isFallbackJob(job)) {
      deletes.push({ row, job, reason: "fallback_without_real_source" });
      return;
    }
    unmatched.push({ userId: row.user_id, id: row.id, company: job.company, title: job.title });
  });

  assertTrue(unmatched.length === 0, `unmatched non-fallback jobs: ${JSON.stringify(unmatched.slice(0, 5))}`);

  const tmpDir = path.join(ROOT, "tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const backupPath = path.join(tmpDir, `staging-beta-job-link-backfill-backup-${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), updates, deletes }, null, 2)}\n`,
    "utf8"
  );

  const updateSql = updates
    .map(({ row, job }) => {
      const jsonText = escapeSql(JSON.stringify(job));
      return `UPDATE jobs SET json_text='${jsonText}', updated_at='${escapeSql(new Date().toISOString())}' WHERE user_id='${escapeSql(row.user_id)}' AND id='${escapeSql(row.id)}';`;
    })
    .join("\n");
  const deleteSql = deletes
    .map(({ row }) => `DELETE FROM jobs WHERE user_id='${escapeSql(row.user_id)}' AND id='${escapeSql(row.id)}';`)
    .join("\n");
  const sql = [updateSql, deleteSql].filter(Boolean).join("\n");
  if (sql.trim()) runWranglerSqlFile(sql);

  console.log(
    `backfill-staging-beta-job-links: PASS updates=${updates.length} deletes=${deletes.length} unmatched=${unmatched.length}`
  );
  console.log(`[backup] ${backupPath}`);
}

try {
  main();
} catch (error) {
  console.error(`backfill-staging-beta-job-links: FAIL - ${error.message || error}`);
  process.exit(1);
}
