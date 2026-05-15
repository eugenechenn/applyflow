#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const EXPECTED_DEMO_COUNT = Number(process.env.EXPECTED_DEMO_COUNT || 38);
const EXPECTED_REAL_POOL_COUNT = Number(process.env.EXPECTED_REAL_POOL_COUNT || 5001);

function runSql(sql) {
  const command = `npm.cmd exec wrangler -- d1 execute applyflow-staging --env staging --remote --config wrangler.jsonc --command "${String(
    sql
  ).replace(/"/g, '`"')}" --json`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "wrangler execute failed").trim());
  }
  const parsed = JSON.parse(String(result.stdout || "[]"));
  const first = Array.isArray(parsed) ? parsed[0] : null;
  return {
    results: Array.isArray(first?.results) ? first.results : [],
    meta: first?.meta || {}
  };
}

function asCount(row, key = "cnt") {
  return Number(row?.[key] || 0);
}

function main() {
  const counts = runSql(
    "SELECT user_id, COUNT(*) AS cnt FROM jobs WHERE user_id IN ('demo_user','staging_real_pool_user') GROUP BY user_id ORDER BY user_id;"
  ).results;
  const source = runSql(
    "SELECT COUNT(*) AS cnt FROM jobs WHERE user_id='staging_real_pool_user' AND json_extract(json_text,'$.sourceLabel')='feishu_offline_real_pool';"
  ).results;
  const map = Object.fromEntries(counts.map((x) => [String(x.user_id), asCount(x)]));
  const demoCount = Number(map.demo_user || 0);
  const realPoolCount = Number(map.staging_real_pool_user || 0);
  const sourceCount = asCount(source[0]);
  if (demoCount !== EXPECTED_DEMO_COUNT) throw new Error(`demo_user count mismatch: expected ${EXPECTED_DEMO_COUNT} got ${demoCount}`);
  if (realPoolCount !== EXPECTED_REAL_POOL_COUNT) throw new Error(`staging_real_pool_user count mismatch: expected ${EXPECTED_REAL_POOL_COUNT} got ${realPoolCount}`);
  if (sourceCount !== EXPECTED_REAL_POOL_COUNT) throw new Error(`sourceLabel count mismatch: expected ${EXPECTED_REAL_POOL_COUNT} got ${sourceCount}`);
  console.log(
    `validate-staging-real-pool-full-import: PASS demo_user=${demoCount} staging_real_pool_user=${realPoolCount} sourceLabel=${sourceCount}`
  );
}

try {
  main();
} catch (error) {
  console.error(`validate-staging-real-pool-full-import: FAIL - ${error.message}`);
  process.exit(1);
}
