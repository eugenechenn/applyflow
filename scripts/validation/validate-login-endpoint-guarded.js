#!/usr/bin/env node
"use strict";

const { ensureHttpTarget } = require("./_http-target");

async function main() {
  const { baseUrl, cleanup } = await ensureHttpTarget();
  try {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `random-${Date.now()}@example.com`,
      mode: "beta"
    })
  });
  if (![403, 404].includes(response.status)) {
    throw new Error(`/api/login expected 403/404 in beta/prod gate, got ${response.status}`);
  }
  console.log("[ok] /api/login guarded in beta/prod mode.");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`[fail] ${error.message}`);
  process.exit(1);
});
