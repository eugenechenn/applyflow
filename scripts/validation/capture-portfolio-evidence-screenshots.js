#!/usr/bin/env node
"use strict";

// 生成飞书作品集可读截图：避免全页长图，按证据点截取清晰局部。
const fs = require("fs");
const path = require("path");
const { chromium, request } = require("playwright");

const ROOT = path.resolve(__dirname, "../..");
const BASE_URL = String(process.env.BASE_URL || "https://www.apply-flow-use.com").replace(/\/+$/, "");
const LOGIN = String(process.env.BETA_ALLOWED_LOGIN || "eugenec7012@126.com").trim();
const OUT_DIR = path.join(ROOT, "docs", "portfolio", "screenshots");

const OUTPUTS = {
  overview: path.join(OUT_DIR, "evidence-01-top-a-overview.png"),
  firstCard: path.join(OUT_DIR, "evidence-02-top-a-card-closeup.png"),
  explanation: path.join(OUT_DIR, "evidence-03-five-dimension-explanation.png"),
  applyModal: path.join(OUT_DIR, "evidence-04-apply-boundary-modal.png")
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function saveLocator(locator, filePath) {
  await locator.screenshot({ path: filePath });
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

async function savePageViewport(page, filePath) {
  await page.screenshot({ path: filePath, fullPage: false });
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const api = await request.newContext({ baseURL: BASE_URL });
  const login = await api.post("/api/auth/login", { data: { login: LOGIN } });
  assert(login.status() === 200, `login expected 200, got ${login.status()}`);
  const storageState = await api.storageState();

  const jobs = await api.get("/api/jobs");
  assert(jobs.status() === 200, `/api/jobs expected 200, got ${jobs.status()}`);
  const payload = await jobs.json();
  const jobViewModels = payload?.data?.jobWorkspaceViewModels || [];
  assert(jobViewModels.length >= 50, `expected at least 50 jobs, got ${jobViewModels.length}`);
  const gradeAt = (jobVm) => String(jobVm?.scoringView?.decisionVerdict?.grade || "").trim().toUpperCase();
  assert(jobViewModels.slice(0, 10).every((jobVm) => gradeAt(jobVm) === "A"), "top10 should be all A for portfolio evidence");
  assert(jobViewModels.slice(0, 50).every((jobVm) => ["A", "B"].includes(gradeAt(jobVm))), "top50 should be all A/B for portfolio evidence");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState,
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: 2
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error.message || error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const saved = {};
  try {
    await page.goto("/#/jobs", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".jobs-shell", { timeout: 45000 });
    await page.waitForFunction(() => document.querySelectorAll(".jobs-item-card").length >= 3, null, {
      timeout: 45000
    });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    saved.overview = await savePageViewport(page, OUTPUTS.overview);

    const firstCard = page.locator(".jobs-item-card").first();
    await firstCard.scrollIntoViewIfNeeded();
    saved.firstCard = await saveLocator(firstCard, OUTPUTS.firstCard);

    const explanationSummary = firstCard.locator("summary", { hasText: "为什么推荐" }).first();
    if (await explanationSummary.count()) {
      await explanationSummary.click();
      await page.waitForTimeout(500);
    }
    saved.explanation = await saveLocator(firstCard, OUTPUTS.explanation);

    const applyButton = page.locator("[data-action='open-apply-modal']").first();
    assert(await applyButton.count(), "open apply modal button not found");
    await applyButton.click();
    await page.waitForSelector("#jobs-apply-modal:not(.hidden)", { timeout: 15000 });
    saved.applyModal = await saveLocator(page.locator("#jobs-apply-modal .apply-modal-card").first(), OUTPUTS.applyModal);
  } finally {
    await browser.close();
    await api.dispose();
  }

  assert(pageErrors.length === 0, `page errors detected: ${JSON.stringify(pageErrors)}`);
  assert(consoleErrors.length === 0, `console errors detected: ${JSON.stringify(consoleErrors)}`);

  console.log("capture-portfolio-evidence-screenshots: PASS");
  console.log(`- baseUrl: ${BASE_URL}`);
  console.log("- gradeGate: top10AllA=true top50AllAB=true");
  Object.entries(saved).forEach(([key, value]) => console.log(`- screenshot.${key}: ${value}`));
}

main().catch((error) => {
  console.error(`capture-portfolio-evidence-screenshots: FAIL - ${error.message || error}`);
  process.exit(1);
});
