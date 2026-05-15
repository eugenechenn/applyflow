#!/usr/bin/env node
"use strict";

/**
 * staging 岗位投递链接完整性验证。
 * 覆盖 demo_user、staging_real_pool_user、beta 用户可见岗位，防止占位链接/空链接进入体验路径。
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const EXPECTED_DB_ID = "ed3ef70f-7ca8-4f95-9858-f5ea825d7188";
const WRANGLER_ENV = "staging";

function extractJsonArrayBlock(text = "") {
  const match = String(text || "").match(/\[\s*\{[\s\S]*\}\s*\]/);
  return match ? match[0] : "[]";
}

function runWranglerSql(sql) {
  const escapedSql = String(sql).replace(/"/g, '`"');
  const command = `npm.cmd exec wrangler -- d1 execute APPLYFLOW_DB --config wrangler.jsonc --env ${WRANGLER_ENV} --remote --command "${escapedSql}" --json`;
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

function isValidUrl(value = "") {
  const text = String(value || "").trim();
  return /^https?:\/\//i.test(text) && !/applyflow\.local|example\.com|curated\.applyflow\.local/i.test(text);
}

function hasUsableLinkFields(job = {}, userId = "") {
  if (userId === "staging_real_pool_user") {
    return isValidUrl(job.applyUrl || job.jobUrl || job.sourceUrl);
  }
  return isValidUrl(job.applyUrl) && isValidUrl(job.jobUrl) && isValidUrl(job.sourceUrl);
}

function isFallbackJob(job = {}) {
  return (
    String(job.company || "") === "工程师 团队" ||
    String(job.title || "") === "工程师 相关岗位" ||
    /applyflow\.local\/fallback/i.test(String(job.jobUrl || job.sourceUrl || job.applyUrl || ""))
  );
}

function main() {
  const config = fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
  if (!config.includes(EXPECTED_DB_ID)) throw new Error("staging D1 guard failed");

  const rows = runWranglerSql("SELECT user_id, id, json_text FROM jobs ORDER BY user_id, id;");
  const scoped = rows.filter((row) => String(row.user_id || "") !== "user_a");
  const bad = [];
  const counts = {};

  scoped.forEach((row) => {
    counts[row.user_id] = (counts[row.user_id] || 0) + 1;
    const job = JSON.parse(row.json_text || "{}");
    const url = String(job.applyUrl || job.jobUrl || job.sourceUrl || "").trim();
    if (!hasUsableLinkFields(job, row.user_id) || isFallbackJob(job)) {
      bad.push({
        userId: row.user_id,
        id: row.id,
        company: job.company || "",
        title: job.title || "",
        url
      });
    }
  });

  const demoCount = counts.demo_user || 0;
  const realPoolCount = counts.staging_real_pool_user || 0;
  if (demoCount !== 38) throw new Error(`demo_user count mismatch: ${demoCount}`);
  if (realPoolCount !== 5001) throw new Error(`staging_real_pool_user count mismatch: ${realPoolCount}`);
  if (bad.length > 0) {
    throw new Error(`bad job links found: ${JSON.stringify(bad.slice(0, 10))}`);
  }

  console.log(
    `validate-staging-job-links-integrity: PASS checked=${scoped.length} demo_user=${demoCount} staging_real_pool_user=${realPoolCount} bad=0`
  );
  console.log(`[counts] ${JSON.stringify(counts)}`);
}

try {
  main();
} catch (error) {
  console.error(`validate-staging-job-links-integrity: FAIL - ${error.message || error}`);
  process.exit(1);
}
