#!/usr/bin/env node
"use strict";

const { ensureHttpTarget } = require("./_http-target");

async function main() {
  const { baseUrl, cleanup } = await ensureHttpTarget();
  try {
  const response = await fetch(`${baseUrl}/api/auth/session`, {
    method: "GET",
    headers: { "content-type": "application/json" }
  });
  if (!response.ok) {
    throw new Error(`/api/auth/session responded ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.data?.authenticated === true) {
    throw new Error("unexpected authenticated session without explicit login.");
  }
  console.log("[ok] no implicit auto-demo login session detected.");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`[fail] ${error.message}`);
  process.exit(1);
});
