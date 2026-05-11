#!/usr/bin/env node
"use strict";

const { ensureHttpTarget } = require("./_http-target");
const betaAllowedLogin = String(process.env.BETA_ALLOWED_LOGIN || "").trim();
const betaDeniedLogin = String(process.env.BETA_DENIED_LOGIN || "not-allowed@example.com").trim();

async function postJson(baseUrl, pathname, payload) {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function main() {
  const { baseUrl, cleanup } = await ensureHttpTarget();
  try {
  const denied = await postJson(baseUrl, "/api/auth/login", { login: betaDeniedLogin });
  if (![401, 403].includes(denied.status)) {
    throw new Error(`non-whitelist login expected 401/403, got ${denied.status}`);
  }

  if (betaAllowedLogin) {
    const allowed = await postJson(baseUrl, "/api/auth/login", { login: betaAllowedLogin });
    if (allowed.status >= 400) {
      throw new Error(`whitelist login expected success, got ${allowed.status}`);
    }
  } else {
    console.log("[warn] BETA_ALLOWED_LOGIN not provided; skipped positive whitelist login probe.");
  }

  console.log("[ok] beta whitelist gate behaves as expected.");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`[fail] ${error.message}`);
  process.exit(1);
});
