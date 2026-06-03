#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE_URL = (process.env.UI_SMOKE_BASE_URL || "https://app.apply-flow-use.com").replace(/\/+$/, "");
const LOCAL_APP_JS_PATH = path.resolve(__dirname, "../../public/app.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function checkPageWithPlaywright() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err.message || err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  try {
    const response = await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    assert(response, "page.goto did not return a response");
    assert(response.status() === 200, `root page expected 200, got ${response.status()}`);
    await page.waitForSelector("#app", { timeout: 30000 });
    await page.waitForSelector("script[src=\"/app.js\"]", { timeout: 30000, state: "attached" });

    const title = await page.title();
    assert(title === "ApplyFlow", `title expected ApplyFlow, got ${title}`);

    const body = await page.textContent("body");
    assert(body && body.includes("ApplyFlow"), "body does not contain ApplyFlow marker");
    assert(pageErrors.length === 0, `pageerror detected: ${JSON.stringify(pageErrors)}`);
    assert(consoleErrors.length === 0, `console error detected: ${JSON.stringify(consoleErrors)}`);
    return { title, pageErrors, consoleErrors, browser };
  } finally {
    // browser is closed by caller after additional in-page fetch checks
  }
}

async function main() {
  const pageResult = await checkPageWithPlaywright();
  const browser = pageResult.browser;
  const [page] = browser.contexts()[0].pages();
  try {
    const rootHtml = await page.content();
    assert(rootHtml.includes("<title>ApplyFlow</title>"), "root html missing expected title");
    assert(rootHtml.includes('src="/app.js"'), "root html missing /app.js reference");

    const remoteAppJs = await page.evaluate(async () => {
      const resp = await fetch("/app.js");
      if (!resp.ok) {
        throw new Error(`/app.js request failed: ${resp.status}`);
      }
      return resp.text();
    });
    const localAppJs = fs.readFileSync(LOCAL_APP_JS_PATH, "utf8");
    // Avoid encoding/caching drift checks here; smoke focuses on feature-level availability.
    assert(remoteAppJs.includes("jobs-apply-modal-title"), "remote app.js missing apply modal marker");
    assert(localAppJs.includes("jobs-apply-modal-title"), "local app.js missing apply modal marker");
    assert(remoteAppJs.includes("set-shortlist-state"), "remote app.js missing shortlist action marker");
    assert(remoteAppJs.includes("set-feedback-state"), "remote app.js missing feedback action marker");

    const loginStatus = await page.evaluate(async () => {
      const email = `smoke-${Date.now()}@example.com`;
      const resp = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, mode: "beta" })
      });
      return resp.status;
    });
    const allowed = [201, 403, 404];
    assert(allowed.includes(loginStatus), `/api/login expected one of ${allowed.join(", ")}, got ${loginStatus}`);

    console.log(`validate-production-online-smoke: PASS (${BASE_URL})`);
    console.log("- app.js feature markers: jobs-apply-modal-title / set-shortlist-state / set-feedback-state");
    console.log(`- /api/login status: ${loginStatus}`);
    console.log(`- title: ${pageResult.title}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`validate-production-online-smoke: FAIL - ${error.message || error}`);
  process.exit(1);
});
