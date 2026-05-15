"use strict";

const { spawn } = require("child_process");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../..");
const BASE_URL = process.env.UI_SMOKE_BASE_URL || "http://127.0.0.1:3301";
const DEMO_ENTRY_URL = process.env.UI_SMOKE_DEMO_URL || `${BASE_URL}/?mode=demo#/dashboard`;
const BASE = new URL(BASE_URL);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady(timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/`);
      if (response.ok) return;
    } catch (error) {
      // keep polling
    }
    await sleep(500);
  }
  throw new Error(`ui-key-path-smoke: server did not become ready at ${BASE_URL} within ${timeoutMs}ms`);
}

function startServer() {
  const resolvedPort = BASE.port ? Number(BASE.port) : BASE.protocol === "https:" ? 443 : 80;
  return spawn("node", ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: process.env.PORT || String(resolvedPort),
      AUTH_PROVIDER: process.env.AUTH_PROVIDER || "internal_beta",
      NODE_ENV: process.env.NODE_ENV || "development",
      SESSION_COOKIE_SECURE: process.env.SESSION_COOKIE_SECURE || "false",
      INTERNAL_BETA_ENABLED: process.env.INTERNAL_BETA_ENABLED || "true",
      DEMO_MODE_ENABLED: process.env.DEMO_MODE_ENABLED || "true",
      DEMO_USER_ID: process.env.DEMO_USER_ID || "demo_user",
      DEMO_AUTO_LOGIN_ENABLED: process.env.DEMO_AUTO_LOGIN_ENABLED || "false",
      DEV_AUTH_BYPASS_ENABLED: process.env.DEV_AUTH_BYPASS_ENABLED || "false"
    },
    stdio: "ignore",
    shell: false
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasCriticalRuntimeErrors(messages = []) {
  return messages.some((item) => /not defined|cannot read properties|syntaxerror|referenceerror/i.test(item));
}

async function main() {
  const server = startServer();
  let browser;
  const pageErrors = [];
  const consoleErrors = [];

  try {
    await waitForServerReady();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    // 1. 显式走 demo 入口，避免普通路径自动登录被禁后的误判
    await page.goto(DEMO_ENTRY_URL, { waitUntil: "domcontentloaded" });
    const dashboardReady = await page
      .waitForFunction(() => {
        const hasDashboard = Boolean(document.querySelector("#dashboard-preference-form"));
        const hasAuth = Boolean(document.querySelector("#auth-login-form"));
        const hasOnboarding = Boolean(document.querySelector("#onboarding-form"));
        const bodyText = String(document.body?.innerText || "");
        const hasRestrictedHint = bodyText.includes("访问受限") || bodyText.includes("请先登录");
        return hasDashboard || hasAuth || hasOnboarding || hasRestrictedHint;
      }, null, { timeout: 30000 })
      .then(() => true)
      .catch(() => false);

    if (!dashboardReady) {
      const snapshot = await page.evaluate(() => ({
        href: window.location.href,
        hash: window.location.hash,
        hasDashboard: Boolean(document.querySelector("#dashboard-preference-form")),
        hasAuthForm: Boolean(document.querySelector("#auth-login-form")),
        bodyPreview: String(document.body?.innerText || "").slice(0, 220)
      }));
      throw new Error(`ui-key-path-smoke: dashboard not ready in demo mode. snapshot=${JSON.stringify(snapshot)}`);
    }

    const hasDashboardForm = await page.locator("#dashboard-preference-form").count();
    if (!hasDashboardForm) {
      const snapshot = await page.evaluate(() => ({
        href: window.location.href,
        hash: window.location.hash,
        hasOnboardingForm: Boolean(document.querySelector("#onboarding-form")),
        hasAuthForm: Boolean(document.querySelector("#auth-login-form")),
        bodyPreview: String(document.body?.innerText || "").slice(0, 220)
      }));
      if (snapshot.hasOnboardingForm) {
        const industriesInput = page.locator('#onboarding-form input[name="preferredIndustries"]').first();
        if (await industriesInput.isVisible()) {
          await industriesInput.fill("AI");
        }
        const roleCheckedCount = await page.locator('#onboarding-form input[name="targetRoles"]:checked').count();
        if (!roleCheckedCount) {
          const firstRole = page.locator('#onboarding-form input[name="targetRoles"]').first();
          if (await firstRole.count()) await firstRole.check();
        }
        const locationCheckedCount = await page.locator('#onboarding-form input[name="preferredLocations"]:checked').count();
        if (!locationCheckedCount) {
          const firstLocation = page.locator('#onboarding-form input[name="preferredLocations"]').first();
          if (await firstLocation.count()) await firstLocation.check();
        }
        const submitOnboardingButton = page.locator('#onboarding-form button[type="submit"]');
        await submitOnboardingButton.first().click();
        await page.waitForFunction(() => {
          const hash = String(window.location.hash || "");
          return hash.startsWith("#/dashboard") || hash.startsWith("#/jobs");
        });
      } else {
        throw new Error(`ui-key-path-smoke: demo entry did not reach dashboard. snapshot=${JSON.stringify(snapshot)}`);
      }
    }

    if (!(await page.locator("#dashboard-preference-form").count())) {
      await page.goto(`${BASE_URL}/#/dashboard`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#dashboard-preference-form");
    }

    // 2. 填偏好
    // 仅操作可见输入框，避免命中同名隐藏字段导致 fill 超时。
    await page.locator('#dashboard-preference-form input[name="targetRoles"]:visible').first().fill("PM");
    const skillsInput = page.locator('#dashboard-preference-form input[name="skills"]:visible').first();
    if (await skillsInput.count()) {
      await skillsInput.fill("Python");
    }
    const locationsInput = page.locator('#dashboard-preference-form input[name="preferredLocations"]:visible').first();
    if (await locationsInput.count()) {
      await locationsInput.fill("Shanghai");
    }

    // 3. 保存
    const saveButton = page.locator('#dashboard-preference-form button[type="submit"]');
    assert(await saveButton.isVisible(), "ui-key-path-smoke: dashboard save button not visible");
    await saveButton.click();
    await page.waitForTimeout(1000);

    // 4. 跳转 jobs
    const toJobsLink = page.locator('#dashboard-preference-form a[href="#/jobs"]');
    if (await toJobsLink.count()) {
      await toJobsLink.first().click();
    } else {
      await page.goto(`${BASE_URL}/#/jobs`, { waitUntil: "domcontentloaded" });
    }
    await page.waitForURL(/#\/jobs/);
    await page.waitForTimeout(1500);

    // 5. 点击投递链接确认层（兼容有投递链接与无投递链接两种状态）
    const applyButtons = page.locator('[data-action="open-apply-modal"]');
    const applyCount = await applyButtons.count();
    if (applyCount > 0) {
      await applyButtons.first().click();

      // 6. 打开并关闭弹窗
      const modal = page.locator("#jobs-apply-modal");
      await modal.waitFor({ state: "visible" });
      assert(!(await modal.evaluate((el) => el.classList.contains("hidden"))), "ui-key-path-smoke: apply modal did not open");
      const closeButton = page.locator('#jobs-apply-modal button[data-action="close-apply-modal"]');
      assert(await closeButton.first().isVisible(), "ui-key-path-smoke: apply modal close button not visible");
      await closeButton.first().click();
      if (!(await page.evaluate(() => document.getElementById("jobs-apply-modal")?.classList.contains("hidden")))) {
        await page.keyboard.press("Escape");
      }
      await page.waitForFunction(() => {
        const modalEl = document.getElementById("jobs-apply-modal");
        return Boolean(modalEl && modalEl.classList.contains("hidden"));
      });
    } else {
      const addListButton = page.getByRole("button", { name: /加入投递清单/ }).first();
      assert(await addListButton.isVisible(), "ui-key-path-smoke: no apply handoff or add-list entry found on jobs page");
    }

    // 7. 跳转 profile（投递确认层不再承担资料完善入口，回退侧栏入口）
    let toProfileLink = page.locator('#jobs-apply-modal a[href="#/profile"]');
    if (!(await toProfileLink.count()) || !(await toProfileLink.first().isVisible())) {
      toProfileLink = page.locator('a[href="#/profile"]').first();
    }
    assert(await toProfileLink.first().isVisible(), "ui-key-path-smoke: profile link not visible");
    await toProfileLink.first().click();
    await page.waitForURL(/#\/profile/);
    await page.waitForSelector("#profile-form");

    // 8. 返回 jobs
    const backToJobs = page.locator('#profile-form a[href="#/jobs"]');
    if ((await backToJobs.count()) && (await backToJobs.first().isVisible())) {
      await backToJobs.first().click();
    } else {
      await page.goto(`${BASE_URL}/#/jobs`, { waitUntil: "domcontentloaded" });
    }
    await page.waitForURL(/#\/jobs/);

    if (hasCriticalRuntimeErrors(pageErrors) || hasCriticalRuntimeErrors(consoleErrors)) {
      throw new Error(
        `ui-key-path-smoke: runtime crash detected. pageErrors=${JSON.stringify(pageErrors)} consoleErrors=${JSON.stringify(consoleErrors)}`
      );
    }
  } finally {
    if (browser) await browser.close();
    if (server && !server.killed) server.kill("SIGTERM");
  }
}

main()
  .then(() => {
    console.log("validate-ui-key-path-playwright: dashboard -> jobs -> apply modal -> profile -> jobs path passed.");
  })
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
