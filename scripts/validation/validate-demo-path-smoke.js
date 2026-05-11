#!/usr/bin/env node
"use strict";

const { ensureHttpTarget } = require("./_http-target");

async function main() {
  const { baseUrl, cleanup } = await ensureHttpTarget();
  try {
  const response = await fetch(`${baseUrl}/demo`, { method: "GET" });
  if (!response.ok) {
    throw new Error(`/demo responded with status ${response.status}`);
  }
  const text = await response.text();
  if (!/applyflow|dashboard|jobs/i.test(text)) {
    throw new Error("/demo did not return expected app shell content.");
  }
  console.log(`[ok] demo path reachable: ${baseUrl}/demo`);
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`[fail] ${error.message}`);
  process.exit(1);
});
