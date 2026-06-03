#!/usr/bin/env node
"use strict";

// 用正式域名跑登录、岗位池、关键页面与投递辅助入口的线上取证。
const fs = require("fs");
const path = require("path");
const { chromium, request } = require("playwright");

const ROOT = path.resolve(__dirname, "../..");
const BASE_URL = String(process.env.BASE_URL || "https://www.apply-flow-use.com").replace(/\/+$/, "");
const LOGIN = String(process.env.BETA_ALLOWED_LOGIN || "eugenec7012@126.com").trim();
const SCREENSHOT_DIR = path.join(ROOT, "docs", "portfolio", "screenshots");
const REPORT_DIR = path.join(ROOT, "tmp", "production-real-pool");

const SCREENSHOTS = {
  dashboard: path.join(SCREENSHOT_DIR, "production-www-dashboard.png"),
  jobs: path.join(SCREENSHOT_DIR, "production-real-pool-jobs-top-candidates.png"),
  applyModal: path.join(SCREENSHOT_DIR, "production-apply-plugin-flow.png"),
  profile: path.join(SCREENSHOT_DIR, "production-profile-autofill.png")
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function capture(page, filePath, options = {}) {
  await page.screenshot({ path: filePath, fullPage: Boolean(options.fullPage) });
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function collectCookieHeader(storageState) {
  return (storageState.cookies || [])
    .filter((cookie) => cookie.name && cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function checkRedirects() {
  const checks = [
    { url: "https://www.apply-flow-use.com/", expectedStatus: 200, expectedUrlPrefix: "https://www.apply-flow-use.com/" },
    { url: "https://apply-flow-use.com/", expectedStatus: 301, expectedLocation: "https://www.apply-flow-use.com/" },
    { url: "https://app.apply-flow-use.com/", expectedStatus: 301, expectedLocation: "https://www.apply-flow-use.com/" }
  ];
  const results = [];
  for (const check of checks) {
    const response = await fetch(check.url, { redirect: "manual" });
    const location = response.headers.get("location") || "";
    if (check.expectedStatus === 200) {
      assert(response.status === 200, `${check.url} expected 200, got ${response.status}`);
      assert(response.url.startsWith(check.expectedUrlPrefix), `${check.url} unexpected final url ${response.url}`);
    } else {
      assert(response.status === check.expectedStatus, `${check.url} expected ${check.expectedStatus}, got ${response.status}`);
      assert(location === check.expectedLocation, `${check.url} expected location ${check.expectedLocation}, got ${location}`);
    }
    results.push({ url: check.url, status: response.status, location });
  }
  return results;
}

async function main() {
  ensureDir(SCREENSHOT_DIR);
  ensureDir(REPORT_DIR);

  const redirects = await checkRedirects();
  const apiContext = await request.newContext({ baseURL: BASE_URL });
  const loginResponse = await apiContext.post("/api/auth/login", {
    data: { login: LOGIN }
  });
  assert(loginResponse.status() === 200, `/api/auth/login expected 200, got ${loginResponse.status()}`);

  const loginPayload = await loginResponse.json();
  const userId = String(loginPayload?.data?.user?.id || "");
  assert(userId && userId !== "demo_user", `login resolved unexpected user id: ${userId || "(empty)"}`);

  const storageState = await apiContext.storageState();
  const cookieHeader = collectCookieHeader(storageState);
  assert(cookieHeader.includes("applyflow_session="), "storage state missing applyflow_session cookie");

  const jobsResponse = await apiContext.get("/api/jobs");
  assert(jobsResponse.status() === 200, `/api/jobs expected 200, got ${jobsResponse.status()}`);
  const jobsPayload = await jobsResponse.json();
  const jobViewModels = Array.isArray(jobsPayload?.data?.jobWorkspaceViewModels)
    ? jobsPayload.data.jobWorkspaceViewModels
    : [];
  assert(jobViewModels.length >= 100, `/api/jobs expected at least 100 visible jobs, got ${jobViewModels.length}`);
  const jobsWithSourceUrl = jobViewModels.filter((jobVm) => String(jobVm?.jobSummary?.sourceUrl || "").trim()).length;
  assert(jobsWithSourceUrl > 0, "visible jobs should include real source URLs");
  const gradeAt = (jobVm) => String(jobVm?.scoringView?.decisionVerdict?.grade || "").trim().toUpperCase();
  const top10 = jobViewModels.slice(0, 10);
  const top50 = jobViewModels.slice(0, 50);
  assert(top10.length >= 10, `/api/jobs expected at least 10 jobs for top10 grade gate, got ${top10.length}`);
  assert(top50.length >= 50, `/api/jobs expected at least 50 jobs for top50 grade gate, got ${top50.length}`);
  const top10NonA = top10
    .map((jobVm, index) => ({ index: index + 1, grade: gradeAt(jobVm), title: jobVm?.jobSummary?.title || "" }))
    .filter((entry) => entry.grade !== "A");
  const top50NonAB = top50
    .map((jobVm, index) => ({ index: index + 1, grade: gradeAt(jobVm), title: jobVm?.jobSummary?.title || "" }))
    .filter((entry) => !["A", "B"].includes(entry.grade));
  assert(top10NonA.length === 0, `top10 grade gate expected all A, got ${JSON.stringify(top10NonA.slice(0, 5))}`);
  assert(top50NonAB.length === 0, `top50 grade gate expected all A/B, got ${JSON.stringify(top50NonAB.slice(0, 5))}`);
  const gradeDistribution = jobViewModels.reduce((acc, jobVm) => {
    const grade = gradeAt(jobVm) || "UNKNOWN";
    acc[grade] = (acc[grade] || 0) + 1;
    return acc;
  }, {});

  const unauthJobs = await fetch(`${BASE_URL}/api/jobs`);
  assert(unauthJobs.status === 401, `/api/jobs without session expected 401, got ${unauthJobs.status}`);

  const pluginDownload = await fetch(`${BASE_URL}/downloads/applyflow-edge-mvp-v11-semantic-slots`, {
    headers: { cookie: cookieHeader },
    redirect: "manual"
  });
  assert(
    [200, 302, 303].includes(pluginDownload.status),
    `plugin download route expected 200/302/303, got ${pluginDownload.status}`
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState,
    viewport: { width: 1440, height: 1100 }
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error.message || error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const screenshotPaths = {};
  try {
    await page.goto("/#/dashboard", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#app", { timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForSelector("text=ApplyFlow", { timeout: 30000 });
    screenshotPaths.dashboard = await capture(page, SCREENSHOTS.dashboard, { fullPage: true });

    await page.goto("/#/jobs", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".jobs-shell", { timeout: 45000 });
    await page.waitForFunction(() => document.querySelectorAll(".jobs-item-card").length > 0, null, {
      timeout: 45000
    });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    const cardCount = await page.locator(".jobs-item-card").count();
    assert(cardCount === jobViewModels.length, `DOM job card count ${cardCount} != API visible job count ${jobViewModels.length}`);
    screenshotPaths.jobs = await capture(page, SCREENSHOTS.jobs);

    const applyButton = page.locator("[data-action='open-apply-modal']").first();
    assert(await applyButton.count(), "no open-apply-modal button found");
    await applyButton.click();
    await page.waitForSelector("#jobs-apply-modal:not(.hidden)", { timeout: 15000 });
    await page.waitForSelector("#jobs-apply-plugin-download", { timeout: 15000 });
    const modalText = await page.locator("#jobs-apply-modal").innerText();
    assert(modalText.includes("不会自动提交"), "apply modal missing no-auto-submit boundary text");
    assert(modalText.includes("下载插件"), "apply modal missing plugin download entry");
    screenshotPaths.applyModal = await capture(page, SCREENSHOTS.applyModal);

    await page.goto("/#/profile?section=autofill-materials-section", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#app", { timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForSelector("text=网申", { timeout: 30000 }).catch(() => {});
    screenshotPaths.profile = await capture(page, SCREENSHOTS.profile, { fullPage: true });
  } finally {
    await browser.close();
    await apiContext.dispose();
  }

  assert(pageErrors.length === 0, `page errors detected: ${JSON.stringify(pageErrors)}`);
  assert(consoleErrors.length === 0, `console errors detected: ${JSON.stringify(consoleErrors)}`);

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    login: LOGIN,
    userId,
    visibleJobs: jobViewModels.length,
    jobsWithSourceUrl,
    gradeDistribution,
    gradeGate: {
      top10AllA: true,
      top50AllAB: true
    },
    firstJob: {
      title: jobViewModels[0]?.jobSummary?.title || "",
      company: jobViewModels[0]?.jobSummary?.company || "",
      sourceUrl: jobViewModels[0]?.jobSummary?.sourceUrl || ""
    },
    redirects,
    unauthJobsStatus: unauthJobs.status,
    pluginDownloadStatus: pluginDownload.status,
    screenshots: screenshotPaths,
    pageErrors,
    consoleErrors,
    note: "线上 D1 当前挂 5001 条真实岗位；/api/jobs 为性能和去重展示 Top 候选岗位视图。"
  };
  const reportPath = path.join(REPORT_DIR, "production-real-pool-flow-playwright-report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("validate-production-real-pool-flow-playwright: PASS");
  console.log(`- baseUrl: ${BASE_URL}`);
  console.log(`- userId: ${userId}`);
  console.log(`- visibleJobs: ${jobViewModels.length}`);
  console.log(`- jobsWithSourceUrl: ${jobsWithSourceUrl}`);
  console.log(`- gradeDistribution: ${JSON.stringify(gradeDistribution)}`);
  console.log("- gradeGate: top10AllA=true top50AllAB=true");
  console.log(`- report: ${path.relative(ROOT, reportPath).replace(/\\/g, "/")}`);
  Object.entries(screenshotPaths).forEach(([key, value]) => console.log(`- screenshot.${key}: ${value}`));
}

main().catch((error) => {
  console.error(`validate-production-real-pool-flow-playwright: FAIL - ${error.message || error}`);
  process.exit(1);
});
