#!/usr/bin/env node
"use strict";

const { ensureHttpTarget } = require("./_http-target");

async function main() {
  const { baseUrl, cleanup } = await ensureHttpTarget();
  try {
  const response = await fetch(`${baseUrl}/api/auth/users`, { method: "GET" });
  if (![401, 403, 404].includes(response.status)) {
    throw new Error(`/api/auth/users expected 401/403/404 in beta/prod gate, got ${response.status}`);
  }
  console.log("[ok] /api/auth/users is not publicly exposed.");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`[fail] ${error.message}`);
  process.exit(1);
});
