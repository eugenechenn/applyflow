#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const { ensureHttpTarget } = require("./_http-target");

const LOGIN_A = String(process.env.BETA_ALLOWED_LOGIN_A || process.env.BETA_ALLOWED_LOGIN || "").trim();
const LOGIN_B = String(process.env.BETA_ALLOWED_LOGIN_B || "").trim();
const DEMO_USER_ID = "demo_user";
const REAL_POOL_USER_ID = "staging_real_pool_user";

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function extractCookie(response) {
  const raw = response.headers.get("set-cookie") || "";
  return String(raw).split(";")[0] || "";
}

async function postJson(baseUrl, pathname, payload, cookie = "") {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(payload || {})
  });
}

async function getJson(baseUrl, pathname, cookie = "") {
  return fetch(`${baseUrl}${pathname}`, {
    method: "GET",
    headers: {
      ...(cookie ? { cookie } : {})
    }
  });
}

async function login(baseUrl, loginValue) {
  const resp = await postJson(baseUrl, "/api/auth/login", { login: loginValue });
  if (resp.status >= 400) {
    const text = await resp.text();
    throw new Error(`login failed (${resp.status}): ${text.slice(0, 220)}`);
  }
  const cookie = extractCookie(resp);
  assertTrue(Boolean(cookie), "missing session cookie after login.");
  const payload = await resp.json();
  const userId = String(payload?.data?.user?.id || "").trim();
  assertTrue(Boolean(userId), "missing user id after login.");
  return { cookie, userId };
}

async function readProfile(baseUrl, cookie) {
  const resp = await getJson(baseUrl, "/api/profile", cookie);
  if (resp.status >= 400) {
    const text = await resp.text();
    throw new Error(`/api/profile failed (${resp.status}): ${text.slice(0, 220)}`);
  }
  const payload = await resp.json();
  return payload?.data?.profile || {};
}

async function listJobs(baseUrl, cookie) {
  const resp = await getJson(baseUrl, "/api/jobs?limit=20&profile=1", cookie);
  if (resp.status >= 400) {
    const text = await resp.text();
    throw new Error(`/api/jobs failed (${resp.status}): ${text.slice(0, 220)}`);
  }
  const payload = await resp.json();
  return Array.isArray(payload?.data?.jobWorkspaceViewModels) ? payload.data.jobWorkspaceViewModels : [];
}

async function createJobIfEmpty(baseUrl, cookie, label) {
  const jobs = await listJobs(baseUrl, cookie);
  if (jobs.length > 0) return String(jobs[0]?.id || "");
  const resp = await postJson(
    baseUrl,
    "/api/jobs/ingest",
    {
      company: `Forge Guard ${label} Co`,
      title: `Forge Guard ${label} Role`,
      location: "上海",
      rawJdText: "forged-userid validation synthetic job"
    },
    cookie
  );
  if (resp.status >= 400) {
    const text = await resp.text();
    throw new Error(`/api/jobs/ingest failed (${resp.status}): ${text.slice(0, 220)}`);
  }
  const payload = await resp.json();
  return String(payload?.data?.job?.id || "").trim();
}

async function assertRejected(response, label) {
  if (response.status === 403) return;
  if (response.status === 400) {
    const payload = await response.json().catch(() => null);
    const code = String(payload?.error?.code || "");
    if (code === "AUTH_FORBIDDEN" || code === "INVALID_JSON" || code === "VALIDATION_ERROR") {
      return;
    }
  }
  const text = await response.text();
  throw new Error(`${label} expected rejection (403/guarded-400), got ${response.status}: ${text.slice(0, 220)}`);
}

function runStagingReadonlyCountSql(sql) {
  const command = `npm.cmd exec wrangler -- d1 execute APPLYFLOW_DB --config wrangler.jsonc --env staging --remote --command "${String(
    sql
  ).replace(/"/g, '`"')}" --json`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "wrangler d1 execute failed").trim());
  }
  const parsed = JSON.parse(String(result.stdout || "[]"));
  const first = Array.isArray(parsed) ? parsed[0] : {};
  return Array.isArray(first?.results) ? first.results : [];
}

function readStagingSafetyCounts() {
  const rows = runStagingReadonlyCountSql(
    "SELECT user_id, COUNT(*) AS cnt FROM jobs WHERE user_id IN ('user_a','demo_user','staging_real_pool_user') GROUP BY user_id ORDER BY user_id;"
  );
  const map = Object.fromEntries(rows.map((r) => [String(r.user_id), Number(r.cnt || 0)]));
  return {
    userAJobs: Number(map.user_a || 0),
    demoJobs: Number(map.demo_user || 0),
    realPoolJobs: Number(map.staging_real_pool_user || 0)
  };
}

async function main() {
  if (!LOGIN_A || !LOGIN_B) {
    throw new Error("请先设置 BETA_ALLOWED_LOGIN_A 与 BETA_ALLOWED_LOGIN_B。");
  }

  const beforeCounts = readStagingSafetyCounts();
  const { baseUrl, cleanup } = await ensureHttpTarget();
  try {
    const a = await login(baseUrl, LOGIN_A);
    const b = await login(baseUrl, LOGIN_B);

    assertTrue(a.userId !== b.userId, "A/B user id must be different.");
    assertTrue(a.userId !== DEMO_USER_ID && b.userId !== DEMO_USER_ID, "A/B cannot be demo_user.");
    assertTrue(
      a.userId !== REAL_POOL_USER_ID && b.userId !== REAL_POOL_USER_ID,
      "A/B cannot be staging_real_pool_user."
    );

    const profileBBefore = await readProfile(baseUrl, b.cookie);

    await assertRejected(
      await postJson(baseUrl, "/api/profile/save", { userId: b.userId, name: "ForgeA", background: "forge" }, a.cookie),
      "profile save forged userId=B"
    );
    await assertRejected(
      await postJson(baseUrl, "/api/profile/save", { userId: DEMO_USER_ID, name: "ForgeDemo" }, a.cookie),
      "profile save forged userId=demo_user"
    );
    await assertRejected(
      await postJson(baseUrl, "/api/profile/save", { userId: REAL_POOL_USER_ID, name: "ForgeRealPool" }, a.cookie),
      "profile save forged userId=staging_real_pool_user"
    );

    const bootstrapProfileResp = await postJson(
      baseUrl,
      "/api/profile/save",
      {
        name: "A-Owner-Bootstrap",
        background: "owner bootstrap",
        jobPreferenceProfile: { targetRoles: ["产品经理"], preferredLocations: ["上海"] }
      },
      a.cookie
    );
    if (bootstrapProfileResp.status >= 400) {
      const text = await bootstrapProfileResp.text();
      throw new Error(`bootstrap profile save failed (${bootstrapProfileResp.status}): ${text.slice(0, 220)}`);
    }

    const jobIdA = await createJobIfEmpty(baseUrl, a.cookie, "A");
    assertTrue(Boolean(jobIdA), "A job id missing.");
    await assertRejected(
      await postJson(baseUrl, `/api/jobs/${jobIdA}/shortlist-state`, { userId: b.userId, nextState: "shortlisted" }, a.cookie),
      "shortlist forged userId=B"
    );
    await assertRejected(
      await postJson(baseUrl, `/api/jobs/${jobIdA}/tracker-state`, { userId: b.userId, nextState: "saved" }, a.cookie),
      "tracker forged userId=B"
    );
    await assertRejected(
      await postJson(baseUrl, `/api/jobs/${jobIdA}/feedback-state`, { userId: b.userId, nextState: "good_fit" }, a.cookie),
      "feedback forged userId=B"
    );

    const ownSaveResp = await postJson(
      baseUrl,
      "/api/profile/save",
      {
        name: "A-Owner",
        background: "owner write without payload userId",
        jobPreferenceProfile: { targetRoles: ["产品经理"], preferredLocations: ["上海"] }
      },
      a.cookie
    );
    if (ownSaveResp.status >= 400) {
      const text = await ownSaveResp.text();
      throw new Error(`own profile save failed (${ownSaveResp.status}): ${text.slice(0, 220)}`);
    }

    const profileBAfter = await readProfile(baseUrl, b.cookie);
    const roleBefore = String((profileBBefore?.jobPreferenceProfile?.targetRoles || [])[0] || "");
    const roleAfter = String((profileBAfter?.jobPreferenceProfile?.targetRoles || [])[0] || "");
    assertTrue(roleBefore === roleAfter, "forged profile write leaked to B.");

    const afterCounts = readStagingSafetyCounts();
    assertTrue(afterCounts.userAJobs === beforeCounts.userAJobs, "user_a jobs count changed unexpectedly.");
    assertTrue(afterCounts.demoJobs === 38, `demo_user jobs should remain 38, got ${afterCounts.demoJobs}`);
    assertTrue(
      afterCounts.realPoolJobs === 5001,
      `staging_real_pool_user jobs should remain 5001, got ${afterCounts.realPoolJobs}`
    );

    console.log(`[ok] forged payload.userId rejected for profile + shortlist/tracker/feedback.`);
    console.log(`[ok] missing payload.userId writes use authenticated owner context.`);
    console.log(
      `[ok] staging safety counts stable: user_a=${afterCounts.userAJobs}, demo_user=${afterCounts.demoJobs}, staging_real_pool_user=${afterCounts.realPoolJobs}`
    );
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`[fail] ${error.message || error}`);
  process.exit(1);
});
