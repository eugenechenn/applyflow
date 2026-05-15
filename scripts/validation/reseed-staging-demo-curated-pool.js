#!/usr/bin/env node
"use strict";

/**
 * staging 受控 demo reseed：
 * - 仅允许 --env staging
 * - 仅允许目标 D1: ed3ef70f-7ca8-4f95-9858-f5ea825d7188
 * - 仅操作 user_id='demo_user'
 * - 清理后重灌 curated demo pool
 */

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { demoData } = require("../../src/mock/applyflow-demo-data");

const WRANGLER_ENV = "staging";
const WRANGLER_D1_BINDING = "APPLYFLOW_DB";
const WRANGLER_CONFIG_PATH = "wrangler.jsonc";
const EXPECTED_DB_NAME = "applyflow-staging";
const EXPECTED_DB_ID = "ed3ef70f-7ca8-4f95-9858-f5ea825d7188";
const DEMO_USER_ID = "demo_user";
const REAL_POOL_USER_ID = "staging_real_pool_user";
const CHUNK_SIZE = 25;

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function extractJsonArrayBlock(text = "") {
  const source = String(text || "");
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "[") continue;
    let depth = 0;
    let end = -1;
    for (let i = start; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "[") depth += 1;
      if (ch === "]") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < start) continue;
    const candidate = source.slice(start, end + 1).trim();
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return candidate;
    } catch (_error) {
      // ignore and continue
    }
  }
  return "";
}

function escapeSql(value = "") {
  return String(value).replace(/'/g, "''");
}

function runWranglerSql(sql) {
  const escapedSql = String(sql).replace(/"/g, '`"');
  const command = `npm.cmd exec wrangler -- d1 execute ${WRANGLER_D1_BINDING} --config ${WRANGLER_CONFIG_PATH} --env ${WRANGLER_ENV} --remote --command "${escapedSql}" --json`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: path.resolve(__dirname, "../.."),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw new Error(`wrangler execute spawn error: ${result.error.message || result.error}`);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "wrangler d1 execute failed").trim());
  }
  const stdout = String(result.stdout || "");
  const jsonBlock = extractJsonArrayBlock(stdout);
  const parsed = JSON.parse(jsonBlock || "[]");
  const first = Array.isArray(parsed) ? parsed[0] : {};
  return {
    results: Array.isArray(first?.results) ? first.results : [],
    meta: first?.meta || {}
  };
}

function runWranglerSqlFile(sql, filePrefix = "demo-reseed") {
  const rootDir = path.resolve(__dirname, "../..");
  const tmpDir = path.join(rootDir, "tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, `${filePrefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
  fs.writeFileSync(filePath, String(sql), "utf8");
  const command = `npm.cmd exec wrangler -- d1 execute ${WRANGLER_D1_BINDING} --config ${WRANGLER_CONFIG_PATH} --env ${WRANGLER_ENV} --remote --file "${filePath}" --json`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  try {
    if (result.error) throw new Error(`wrangler execute spawn error: ${result.error.message || result.error}`);
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || "wrangler d1 execute failed").trim());
    }
    const stdout = String(result.stdout || "");
    const jsonBlock = extractJsonArrayBlock(stdout);
    const parsed = JSON.parse(jsonBlock || "[]");
    const first = Array.isArray(parsed) ? parsed[0] : {};
    return {
      results: Array.isArray(first?.results) ? first.results : [],
      meta: first?.meta || {}
    };
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch (_error) {
      // ignore cleanup error
    }
  }
}

function querySingleCount(sql) {
  const { results } = runWranglerSql(sql);
  return Number(results?.[0]?.cnt || 0);
}

function formatNow() {
  return new Date().toISOString();
}

function chunkArray(items, chunkSize) {
  const out = [];
  for (let i = 0; i < items.length; i += chunkSize) out.push(items.slice(i, i + chunkSize));
  return out;
}

function buildJobInsertSql(jobsChunk) {
  const now = formatNow();
  const values = jobsChunk
    .map((job) => {
      const normalized = {
        ...job,
        id: String(job?.id || "").trim(),
        userId: DEMO_USER_ID,
        sourceLabel: String(job?.sourceLabel || "applyflow_demo_curated"),
        sourcePlatform: String(job?.sourcePlatform || "demo_curated_pool")
      };
      const id = escapeSql(normalized.id);
      const userId = escapeSql(DEMO_USER_ID);
      const status = escapeSql(String(normalized.status || "new"));
      const priority = escapeSql(String(normalized.priority || "normal"));
      const updatedAt = escapeSql(now);
      const jsonText = escapeSql(JSON.stringify(normalized));
      return `('${id}','${userId}','${status}','${priority}','${updatedAt}','${jsonText}')`;
    })
    .join(",\n");
  return `
INSERT INTO jobs (id, user_id, status, priority, updated_at, json_text)
VALUES
${values}
ON CONFLICT(id) DO UPDATE SET
  user_id=excluded.user_id,
  status=excluded.status,
  priority=excluded.priority,
  updated_at=excluded.updated_at,
  json_text=excluded.json_text;
`;
}

function main() {
  const wranglerConfig = fs.readFileSync(path.resolve(__dirname, "../../wrangler.jsonc"), "utf8");
  assertTrue(
    wranglerConfig.includes(`"name": "applyflow-staging"`) &&
      wranglerConfig.includes(`"database_name": "${EXPECTED_DB_NAME}"`) &&
      wranglerConfig.includes(`"database_id": "${EXPECTED_DB_ID}"`),
    "staging guard failed: wrangler staging config mismatch."
  );
  assertTrue(WRANGLER_ENV === "staging", "safety guard failed: env is not staging.");

  const curatedJobs = Array.isArray(demoData.jobs) ? demoData.jobs : [];
  assertTrue(curatedJobs.length > 0, "demo curated jobs is empty.");
  curatedJobs.forEach((job, idx) => {
    assertTrue(Boolean(String(job?.id || "").trim()), `job id missing at index ${idx}`);
  });

  const beforeDemoCount = querySingleCount(
    `SELECT COUNT(*) AS cnt FROM jobs WHERE user_id='${escapeSql(DEMO_USER_ID)}';`
  );
  const beforeRealPoolCount = querySingleCount(
    `SELECT COUNT(*) AS cnt FROM jobs WHERE user_id='${escapeSql(REAL_POOL_USER_ID)}';`
  );
  const beforeOtherBetaCount = querySingleCount(
    `SELECT COUNT(*) AS cnt FROM jobs WHERE user_id NOT IN ('${escapeSql(DEMO_USER_ID)}','${escapeSql(REAL_POOL_USER_ID)}');`
  );

  runWranglerSql(`DELETE FROM jobs WHERE user_id='${escapeSql(DEMO_USER_ID)}';`);

  const chunks = chunkArray(curatedJobs, CHUNK_SIZE);
  chunks.forEach((chunk, idx) => {
    const sql = buildJobInsertSql(chunk);
    runWranglerSqlFile(sql, "demo-curated-reseed");
    console.log(`[chunk] ${idx + 1}/${chunks.length} inserted=${chunk.length}`);
  });

  const afterDemoCount = querySingleCount(
    `SELECT COUNT(*) AS cnt FROM jobs WHERE user_id='${escapeSql(DEMO_USER_ID)}';`
  );
  const afterRealPoolCount = querySingleCount(
    `SELECT COUNT(*) AS cnt FROM jobs WHERE user_id='${escapeSql(REAL_POOL_USER_ID)}';`
  );
  const afterOtherBetaCount = querySingleCount(
    `SELECT COUNT(*) AS cnt FROM jobs WHERE user_id NOT IN ('${escapeSql(DEMO_USER_ID)}','${escapeSql(REAL_POOL_USER_ID)}');`
  );
  const curatedLabelCount = querySingleCount(
    `SELECT COUNT(*) AS cnt FROM jobs WHERE user_id='${escapeSql(DEMO_USER_ID)}' AND json_extract(json_text,'$.sourceLabel') IN ('demo_curated_pool','applyflow_demo_curated');`
  );

  assertTrue(afterDemoCount === curatedJobs.length, `demo_user reseed count mismatch: expected=${curatedJobs.length} actual=${afterDemoCount}`);
  assertTrue(afterRealPoolCount === beforeRealPoolCount, `staging_real_pool_user changed: before=${beforeRealPoolCount} after=${afterRealPoolCount}`);
  assertTrue(afterOtherBetaCount === beforeOtherBetaCount, `other beta users changed: before=${beforeOtherBetaCount} after=${afterOtherBetaCount}`);
  assertTrue(curatedLabelCount === curatedJobs.length, `sourceLabel mismatch: expected=${curatedJobs.length} actual=${curatedLabelCount}`);

  console.log(
    `reseed-staging-demo-curated-pool: PASS demo_user ${beforeDemoCount} -> ${afterDemoCount}, staging_real_pool_user=${afterRealPoolCount}, other_beta_unchanged=${afterOtherBetaCount}`
  );
}

try {
  main();
} catch (error) {
  console.error(`reseed-staging-demo-curated-pool: FAIL - ${error.message || error}`);
  process.exit(1);
}
