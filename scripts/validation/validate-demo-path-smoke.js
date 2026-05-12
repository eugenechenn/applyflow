#!/usr/bin/env node
"use strict";

const { ensureHttpTarget } = require("./_http-target");

async function main() {
  const { baseUrl, cleanup } = await ensureHttpTarget();
  try {
    const demoUrl = `${baseUrl}/?mode=demo`;
    const response = await fetch(demoUrl, { method: "GET", redirect: "follow" });
    if (!response.ok) {
      throw new Error(`demo entry responded with status ${response.status}`);
    }
    const finalUrl = new URL(response.url);
    const mode = String(finalUrl.searchParams.get("mode") || "").trim().toLowerCase();
    if (mode !== "demo") {
      throw new Error(`demo entry lost mode=demo marker. finalUrl=${finalUrl.toString()}`);
    }
    const text = await response.text();
    if (!/applyflow|dashboard|jobs/i.test(text)) {
      throw new Error("/demo did not return expected app shell content.");
    }
    console.log(`[ok] demo path reachable: ${demoUrl}`);
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`[fail] ${error.message}`);
  process.exit(1);
});
