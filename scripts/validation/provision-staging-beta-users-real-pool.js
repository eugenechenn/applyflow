#!/usr/bin/env node
"use strict";

/**
 * staging 白名单用户真实池体验数据复制：
 * - 仅允许 staging D1
 * - source 固定为 staging_real_pool_user
 * - target 必须通过 TARGET_USER_IDS 显式传入
 * - 不触碰 demo_user / staging_real_pool_user / user_a / user_b
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const WRANGLER_ENV = "staging";
const WRANGLER_BINDING = "APPLYFLOW_DB";
const EXPECTED_DB_NAME = "applyflow-staging";
const EXPECTED_DB_ID = "ed3ef70f-7ca8-4f95-9858-f5ea825d7188";
const SOURCE_USER_ID = "staging_real_pool_user";
const DEMO_USER_ID = "demo_user";
const PROTECTED_USERS = new Set([DEMO_USER_ID, SOURCE_USER_ID, "user_a", "user_b"]);
const EXPECTED_SOURCE_COUNT = Number(process.env.EXPECTED_SOURCE_COUNT || 5001);
const EXPECTED_DEMO_COUNT = Number(process.env.EXPECTED_DEMO_COUNT || 38);

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
    let end = -1;
    for (let index = start; index < source.length; index += 1) {
      const ch = source[index];
      if (ch === "[") depth += 1;
      if (ch === "]") {
        depth -= 1;
        if (depth === 0) {
          end = index;
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
      // continue
    }
  }
  return "[]";
}

function runWranglerSql(sql) {
  const escapedSql = String(sql).replace(/"/g, '`"');
  const command = `npm.cmd exec wrangler -- d1 execute ${WRANGLER_BINDING} --config wrangler.jsonc --env ${WRANGLER_ENV} --remote --command "${escapedSql}" --json`;
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

function runWranglerSqlFile(sql, prefix = "beta-real-pool-provision") {
  const tmpDir = path.join(ROOT, "tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
  fs.writeFileSync(filePath, String(sql), "utf8");
  try {
    const command = `npm.cmd exec wrangler -- d1 execute ${WRANGLER_BINDING} --config wrangler.jsonc --env ${WRANGLER_ENV} --remote --file "${filePath}" --json`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024
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

function queryCount(sql) {
  return Number(runWranglerSql(sql).results?.[0]?.cnt || 0);
}

function getTargetUserIds() {
  return String(process.env.TARGET_USER_IDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertStagingGuard() {
  const config = fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
  assertTrue(WRANGLER_ENV === "staging", "refusing to run outside staging");
  assertTrue(
    config.includes(`"name": "applyflow-staging"`) &&
      config.includes(`"database_name": "${EXPECTED_DB_NAME}"`) &&
      config.includes(`"database_id": "${EXPECTED_DB_ID}"`),
    "staging D1 guard failed"
  );
}

function backupTargetJobs(targetUserIds) {
  const tmpDir = path.join(ROOT, "tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}-${Date.now()}`;
  const backupPath = path.join(tmpDir, `staging-beta-users-jobs-backup-before-real-pool-${stamp}.jsonl`);
  const manifestPath = path.join(tmpDir, `staging-beta-users-jobs-backup-before-real-pool-${stamp}.manifest.json`);
  const chunkSize = Number(process.env.BACKUP_CHUNK_SIZE || 200);
  const maxFullBackupRows = Number(process.env.MAX_FULL_BACKUP_ROWS || 1000);
  const counts = Object.fromEntries(
    targetUserIds.map((userId) => [
      userId,
      queryCount(`SELECT COUNT(*) AS cnt FROM jobs WHERE user_id='${escapeSql(userId)}';`)
    ])
  );
  const expectedTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);
  let total = 0;
  fs.writeFileSync(backupPath, "", "utf8");

  targetUserIds.forEach((userId) => {
    const escapedUserId = escapeSql(userId);
    const count = counts[userId];
    if (expectedTotal > maxFullBackupRows) {
      const sampleRows = runWranglerSql(
        `SELECT user_id, id, status, priority, updated_at, json_text FROM jobs WHERE user_id='${escapedUserId}' ORDER BY id LIMIT 5;`
      ).results;
      sampleRows.forEach((row) => {
        fs.appendFileSync(backupPath, `${JSON.stringify({ sampleOnly: true, ...row })}\n`, "utf8");
      });
      total += count;
      return;
    }
    for (let offset = 0; offset < count; offset += chunkSize) {
      const rows = runWranglerSql(
        `SELECT user_id, id, status, priority, updated_at, json_text FROM jobs WHERE user_id='${escapedUserId}' ORDER BY id LIMIT ${chunkSize} OFFSET ${offset};`
      ).results;
      rows.forEach((row) => {
        fs.appendFileSync(backupPath, `${JSON.stringify(row)}\n`, "utf8");
      });
      total += rows.length;
    }
  });

  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        targetUserIds,
        counts,
        count: total,
        backupPath,
        mode: expectedTotal > maxFullBackupRows ? "manifest_with_samples" : "full_jsonl",
        note:
          expectedTotal > maxFullBackupRows
            ? "Large target pools are reproducible from staging_real_pool_user; this manifest records counts and JSONL contains samples only to avoid Wrangler stdout truncation."
            : "JSONL contains full target job backup.",
        createdAt: new Date().toISOString()
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return { backupPath, manifestPath, count: total };
}

function buildProvisionSql(targetUserId, copiedAt) {
  const target = escapeSql(targetUserId);
  const source = escapeSql(SOURCE_USER_ID);
  const copiedAtSql = escapeSql(copiedAt);
  const batch = escapeSql(`beta_real_pool_5001_${copiedAt.slice(0, 10).replace(/-/g, "")}`);
  const linkExpr =
    "COALESCE(NULLIF(json_extract(json_text,'$.applyUrl'),''), NULLIF(json_extract(json_text,'$.jobUrl'),''), NULLIF(json_extract(json_text,'$.sourceUrl'),''), NULLIF(json_extract(json_text,'$.url'),''), '')";
  return `
DELETE FROM jobs WHERE user_id='${target}';

INSERT INTO jobs (id, user_id, status, priority, updated_at, json_text)
SELECT
  '${target}__' || id AS id,
  '${target}' AS user_id,
  status,
  priority,
  '${copiedAtSql}' AS updated_at,
  json_set(
    json_text,
    '$.id', '${target}__' || id,
    '$.userId', '${target}',
    '$.applyUrl', ${linkExpr},
    '$.jobUrl', ${linkExpr},
    '$.sourceUrl', ${linkExpr},
    '$.sourceCopiedFromJobId', id,
    '$.importMeta', json_object(
      'batch', '${batch}',
      'sourceUserId', '${source}',
      'targetUserId', '${target}',
      'copiedAt', '${copiedAtSql}',
      'purpose', 'staging_beta_full_real_pool_experience'
    )
  ) AS json_text
FROM jobs
WHERE user_id='${source}';
`;
}

function main() {
  assertStagingGuard();
  const targetUserIds = getTargetUserIds();
  assertTrue(targetUserIds.length > 0, "TARGET_USER_IDS is required");
  targetUserIds.forEach((userId) => {
    assertTrue(!PROTECTED_USERS.has(userId), `refusing protected target user: ${userId}`);
    assertTrue(/^user_[a-z0-9]+$/i.test(userId), `unexpected target user id: ${userId}`);
  });

  const sourceCount = queryCount(`SELECT COUNT(*) AS cnt FROM jobs WHERE user_id='${escapeSql(SOURCE_USER_ID)}';`);
  const demoBefore = queryCount(`SELECT COUNT(*) AS cnt FROM jobs WHERE user_id='${escapeSql(DEMO_USER_ID)}';`);
  assertTrue(sourceCount === EXPECTED_SOURCE_COUNT, `source count mismatch: expected=${EXPECTED_SOURCE_COUNT} actual=${sourceCount}`);
  assertTrue(demoBefore === EXPECTED_DEMO_COUNT, `demo count mismatch before: expected=${EXPECTED_DEMO_COUNT} actual=${demoBefore}`);

  const beforeCounts = Object.fromEntries(
    targetUserIds.map((userId) => [
      userId,
      queryCount(`SELECT COUNT(*) AS cnt FROM jobs WHERE user_id='${escapeSql(userId)}';`)
    ])
  );
  const backup = backupTargetJobs(targetUserIds);
  console.log(`[backup] path=${backup.backupPath} manifest=${backup.manifestPath} count=${backup.count}`);
  console.log(`[before] source=${sourceCount} demo=${demoBefore} targets=${JSON.stringify(beforeCounts)}`);

  const copiedAt = new Date().toISOString();
  targetUserIds.forEach((targetUserId) => {
    runWranglerSqlFile(buildProvisionSql(targetUserId, copiedAt));
    const count = queryCount(`SELECT COUNT(*) AS cnt FROM jobs WHERE user_id='${escapeSql(targetUserId)}';`);
    assertTrue(count === EXPECTED_SOURCE_COUNT, `target count mismatch for ${targetUserId}: expected=${EXPECTED_SOURCE_COUNT} actual=${count}`);
    console.log(`[target] ${targetUserId} jobs=${count}`);
  });

  const demoAfter = queryCount(`SELECT COUNT(*) AS cnt FROM jobs WHERE user_id='${escapeSql(DEMO_USER_ID)}';`);
  const sourceAfter = queryCount(`SELECT COUNT(*) AS cnt FROM jobs WHERE user_id='${escapeSql(SOURCE_USER_ID)}';`);
  assertTrue(demoAfter === demoBefore, `demo_user changed: before=${demoBefore} after=${demoAfter}`);
  assertTrue(sourceAfter === sourceCount, `source user changed: before=${sourceCount} after=${sourceAfter}`);

  const targetSqlList = targetUserIds.map((id) => `'${escapeSql(id)}'`).join(",");
  const linkBadCount = queryCount(
    `SELECT COUNT(*) AS cnt FROM jobs WHERE user_id IN (${targetSqlList}) AND (json_extract(json_text,'$.sourceUrl') IS NULL OR json_extract(json_text,'$.sourceUrl') NOT LIKE 'http%' OR json_extract(json_text,'$.sourceUrl') LIKE '%example.com%' OR json_extract(json_text,'$.sourceUrl') LIKE '%applyflow.local%');`
  );
  assertTrue(linkBadCount === 0, `bad copied links detected: ${linkBadCount}`);

  console.log(
    `provision-staging-beta-users-real-pool: PASS targets=${targetUserIds.length} perTarget=${EXPECTED_SOURCE_COUNT} demo=${demoAfter} source=${sourceAfter} badLinks=${linkBadCount}`
  );
}

try {
  main();
} catch (error) {
  console.error(`provision-staging-beta-users-real-pool: FAIL - ${error.message}`);
  process.exit(1);
}
