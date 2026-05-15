#!/usr/bin/env node
"use strict";

const { ensureHttpTarget } = require("./_http-target");

const LOGIN_A = String(process.env.BETA_ALLOWED_LOGIN_A || "").trim();
const LOGIN_B = String(process.env.BETA_ALLOWED_LOGIN_B || "").trim();
const DEMO_USER_ID = "demo_user";
const REAL_POOL_USER_ID = "staging_real_pool_user";

function assertTrue(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.code = "ASSERT_FAILED";
    throw error;
  }
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
  const response = await postJson(baseUrl, "/api/auth/login", { login: loginValue });
  if (response.status >= 400) {
    const text = await response.text();
    throw new Error(`login failed for candidate (${response.status}): ${text.slice(0, 220)}`);
  }
  const cookie = extractCookie(response);
  assertTrue(cookie.length > 0, "login succeeded but no session cookie returned.");
  const payload = await response.json();
  const userId = String(payload?.data?.user?.id || "").trim();
  assertTrue(userId.length > 0, "login succeeded but missing user id.");
  return { cookie, userId };
}

async function readProfile(baseUrl, cookie) {
  const response = await getJson(baseUrl, "/api/profile", cookie);
  if (response.status >= 400) {
    const text = await response.text();
    throw new Error(`/api/profile failed (${response.status}): ${text.slice(0, 220)}`);
  }
  const payload = await response.json();
  return payload?.data?.profile || {};
}

async function savePreferenceProfile(baseUrl, cookie, role, location) {
  const payload = {
    jobPreferenceProfile: {
      targetRoles: [role],
      preferredLocations: [location],
      preferredIndustries: [],
      excludedIndustries: [],
      excludedRoles: [],
      companyTypes: [],
      avoidCompanyTypes: [],
      skills: [],
      jobType: "不限"
    }
  };
  const response = await postJson(baseUrl, "/api/profile/save", payload, cookie);
  if (response.status >= 400) {
    const text = await response.text();
    throw new Error(`/api/profile/save failed (${response.status}): ${text.slice(0, 220)}`);
  }
}

async function listJobs(baseUrl, cookie) {
  const response = await getJson(baseUrl, "/api/jobs?limit=20&profile=1", cookie);
  if (response.status >= 400) {
    const text = await response.text();
    throw new Error(`/api/jobs failed (${response.status}): ${text.slice(0, 220)}`);
  }
  const payload = await response.json();
  const jobs = Array.isArray(payload?.data?.jobWorkspaceViewModels) ? payload.data.jobWorkspaceViewModels : [];
  return jobs;
}

async function createJobIfEmpty(baseUrl, cookie, label) {
  const jobs = await listJobs(baseUrl, cookie);
  if (jobs.length > 0) return jobs[0]?.id || "";
  const response = await postJson(
    baseUrl,
    "/api/jobs/ingest",
    {
      company: `AB Isolation ${label} Co`,
      title: `AB Isolation ${label} Role`,
      location: "上海",
      rawJdText: "AB isolation validation synthetic job"
    },
    cookie
  );
  if (response.status >= 400) {
    const text = await response.text();
    throw new Error(`/api/jobs/ingest failed (${response.status}): ${text.slice(0, 220)}`);
  }
  const payload = await response.json();
  const createdId = String(payload?.data?.job?.id || "").trim();
  assertTrue(createdId.length > 0, "ingest succeeded but missing job id.");
  return createdId;
}

async function setShortlist(baseUrl, cookie, jobId, state) {
  const response = await postJson(baseUrl, `/api/jobs/${jobId}/shortlist-state`, { nextState: state }, cookie);
  if (response.status >= 400) throw new Error(`shortlist-state failed ${response.status} for ${jobId}`);
}

async function setTracker(baseUrl, cookie, jobId, state) {
  const response = await postJson(baseUrl, `/api/jobs/${jobId}/tracker-state`, { nextState: state }, cookie);
  if (response.status >= 400) throw new Error(`tracker-state failed ${response.status} for ${jobId}`);
}

async function setFeedback(baseUrl, cookie, jobId, state) {
  const response = await postJson(baseUrl, `/api/jobs/${jobId}/feedback-state`, { nextState: state }, cookie);
  if (response.status >= 400) throw new Error(`feedback-state failed ${response.status} for ${jobId}`);
}

function findJobById(items, id) {
  return (Array.isArray(items) ? items : []).find((item) => String(item?.id || "") === String(id || "")) || null;
}

function getRole(profile = {}) {
  const roles = profile?.jobPreferenceProfile?.targetRoles;
  return Array.isArray(roles) && roles[0] ? String(roles[0]) : "";
}

async function main() {
  if (!LOGIN_A || !LOGIN_B) {
    throw new Error(
      "需要第二个白名单邮箱：请设置 BETA_ALLOWED_LOGIN_A 与 BETA_ALLOWED_LOGIN_B 后再执行。"
    );
  }

  const { baseUrl, cleanup } = await ensureHttpTarget();
  try {
    const a = await login(baseUrl, LOGIN_A);
    const b = await login(baseUrl, LOGIN_B);

    assertTrue(a.userId !== b.userId, "A/B session userId must be different.");
    assertTrue(a.userId !== DEMO_USER_ID && b.userId !== DEMO_USER_ID, "A/B cannot be demo_user.");
    assertTrue(
      a.userId !== REAL_POOL_USER_ID && b.userId !== REAL_POOL_USER_ID,
      "A/B cannot be staging_real_pool_user."
    );

    const aProfileBefore = await readProfile(baseUrl, a.cookie);
    const bProfileBefore = await readProfile(baseUrl, b.cookie);

    await savePreferenceProfile(baseUrl, a.cookie, "产品经理", "上海");
    const aProfileAfter = await readProfile(baseUrl, a.cookie);
    const bProfileAfterAWrite = await readProfile(baseUrl, b.cookie);
    assertTrue(getRole(aProfileAfter) === "产品经理", "A profile role save failed.");
    assertTrue(getRole(bProfileAfterAWrite) === getRole(bProfileBefore), "A profile write leaked to B.");

    await savePreferenceProfile(baseUrl, b.cookie, "数据分析", "上海");
    const bProfileAfter = await readProfile(baseUrl, b.cookie);
    const aProfileAfterBWrite = await readProfile(baseUrl, a.cookie);
    assertTrue(getRole(bProfileAfter) === "数据分析", "B profile role save failed.");
    assertTrue(getRole(aProfileAfterBWrite) === "产品经理", "B profile write leaked to A.");

    const aJobId = await createJobIfEmpty(baseUrl, a.cookie, "A");
    const bJobId = await createJobIfEmpty(baseUrl, b.cookie, "B");

    await setShortlist(baseUrl, a.cookie, aJobId, "shortlisted");
    await setTracker(baseUrl, a.cookie, aJobId, "saved");
    await setFeedback(baseUrl, a.cookie, aJobId, "good_fit");

    await setShortlist(baseUrl, b.cookie, bJobId, "shortlisted");
    await setTracker(baseUrl, b.cookie, bJobId, "saved");
    await setFeedback(baseUrl, b.cookie, bJobId, "good_fit");

    const aJobsAfter = await listJobs(baseUrl, a.cookie);
    const bJobsAfter = await listJobs(baseUrl, b.cookie);
    const aOwn = findJobById(aJobsAfter, aJobId);
    const bOwn = findJobById(bJobsAfter, bJobId);
    const aSeesB = findJobById(aJobsAfter, bJobId);
    const bSeesA = findJobById(bJobsAfter, aJobId);

    assertTrue(Boolean(aOwn), "A should see own job.");
    assertTrue(Boolean(bOwn), "B should see own job.");
    assertTrue(!aSeesB, "A should not see B job.");
    assertTrue(!bSeesA, "B should not see A job.");

    const usersResp = await getJson(baseUrl, "/api/auth/users");
    assertTrue(usersResp.status === 404, "/api/auth/users should remain non-public.");
    const openLoginResp = await postJson(baseUrl, "/api/login", { email: "not-allowed@example.com" });
    assertTrue(openLoginResp.status >= 400, "/api/login must stay guarded.");
    const anonSession = await getJson(baseUrl, "/api/auth/session");
    const anonSessionPayload = await anonSession.json();
    assertTrue(!anonSessionPayload?.data?.authenticated, "anonymous path should not auto-demo login.");

    console.log(`[ok] A user id=${a.userId}`);
    console.log(`[ok] B user id=${b.userId}`);
    console.log("[ok] profile isolation passed.");
    console.log("[ok] shortlist/tracker/feedback isolation passed.");
    console.log("[ok] auth surface guard checks passed.");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`[fail] ${error.message || error}`);
  process.exit(1);
});
