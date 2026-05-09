"use strict";

const { spawn } = require("child_process");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../..");
const BASE_URL = process.env.UI_SMOKE_BASE_URL || "http://127.0.0.1:3000";

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
  return spawn("node", ["server.js"], {
    cwd: ROOT,
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

    // 1. 打开 dashboard
    await page.goto(`${BASE_URL}/#/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#dashboard-preference-form");

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

    // 5. 点击一键网申（兼容可执行与已阻断两种状态）
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
      const blockedApply = page.getByRole("button", { name: /一键网申/ }).first();
      assert(await blockedApply.isVisible(), "ui-key-path-smoke: no one-click apply entry found on jobs page");
      if (await blockedApply.isEnabled()) {
        await blockedApply.click();
      }
    }

    // 7. 跳转 profile（优先弹窗入口，缺失时回退侧栏入口）
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
