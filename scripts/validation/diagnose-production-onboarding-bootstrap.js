"use strict";

// 生产 onboarding bootstrap 诊断脚本：复现 fresh storage 首屏进入流程，并输出会话/画像/路由/控制台取证。
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE_URL = process.env.UI_SMOKE_BASE_URL || "https://applyflow.applyflow-eugene.workers.dev";
const OUTPUT_DIR = path.resolve(__dirname, "../../tmp/production-onboarding-bootstrap");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "report.json");
const WAIT_MS = Number.isFinite(Number(process.env.BOOTSTRAP_WAIT_MS)) ? Math.max(3000, Number(process.env.BOOTSTRAP_WAIT_MS)) : 22000;

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  const page = await context.newPage();
  const report = {
    baseUrl: BASE_URL,
    executedAt: new Date().toISOString(),
    currentUrl: "",
    activeRoute: "",
    localStorage: {},
    sessionStorage: {},
    authSessionResponses: [],
    loginResponses: [],
    profileResponses: [],
    networkWaterfallSummary: [],
    consoleLogs: [],
    pageErrors: [],
    pendingRequests: [],
    domState: {},
    diagnosticState: {}
  };

  await page.addInitScript(() => {
    window.__AF_BOOTSTRAP_DIAG__ = {
      fetchLog: [],
      consoleLog: [],
      errors: [],
      rejections: [],
      hashHistory: [],
      loadingSnapshots: []
    };

    const diag = window.__AF_BOOTSTRAP_DIAG__;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const [input, init = {}] = args;
      const url = typeof input === "string" ? input : input?.url || "";
      const method = String(init?.method || "GET").toUpperCase();
      const startedAt = Date.now();
      const entry = { url, method, startedAt, status: null, ok: null, finishedAt: null, body: "" };
      diag.fetchLog.push(entry);
      try {
        const response = await originalFetch(...args);
        entry.status = response.status;
        entry.ok = response.ok;
        entry.finishedAt = Date.now();
        try {
          const clone = response.clone();
          const text = await clone.text();
          entry.body = String(text || "").slice(0, 500);
        } catch (_error) {
          entry.body = "[unavailable]";
        }
        return response;
      } catch (error) {
        entry.finishedAt = Date.now();
        entry.error = String(error?.message || error);
        throw error;
      }
    };

    const originalConsoleError = console.error.bind(console);
    console.error = (...args) => {
      diag.consoleLog.push({ type: "error", text: args.map((item) => String(item)).join(" ") });
      return originalConsoleError(...args);
    };
    const originalConsoleWarn = console.warn.bind(console);
    console.warn = (...args) => {
      diag.consoleLog.push({ type: "warn", text: args.map((item) => String(item)).join(" ") });
      return originalConsoleWarn(...args);
    };
    const originalConsoleLog = console.log.bind(console);
    console.log = (...args) => {
      diag.consoleLog.push({ type: "log", text: args.map((item) => String(item)).join(" ") });
      return originalConsoleLog(...args);
    };

    window.addEventListener("error", (event) => {
      diag.errors.push({
        message: String(event?.message || ""),
        filename: String(event?.filename || ""),
        lineno: Number(event?.lineno || 0),
        colno: Number(event?.colno || 0)
      });
    });
    window.addEventListener("unhandledrejection", (event) => {
      diag.rejections.push(String(event?.reason?.message || event?.reason || ""));
    });
    window.addEventListener("hashchange", () => {
      diag.hashHistory.push({
        hash: String(window.location.hash || ""),
        at: Date.now()
      });
    });

    const captureLoadingSnapshot = () => {
      const bodyText = document.body?.innerText || "";
      diag.loadingSnapshots.push({
        at: Date.now(),
        hash: String(window.location.hash || ""),
        title: document.querySelector("h3")?.textContent || "",
        bodyText: bodyText.slice(0, 300)
      });
    };

    document.addEventListener("DOMContentLoaded", captureLoadingSnapshot);
    window.setInterval(captureLoadingSnapshot, 1500);
  });

  page.on("console", (message) => {
    report.consoleLogs.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => {
    report.pageErrors.push(String(error?.message || error));
  });

  await page.goto(`${BASE_URL}/#/dashboard`, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(`${BASE_URL}/#/dashboard`, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(WAIT_MS);

  report.currentUrl = page.url();
  report.activeRoute = await page.evaluate(() => String(window.location.hash || ""));
  report.localStorage = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])));
  report.sessionStorage = await page.evaluate(() => Object.fromEntries(Object.keys(sessionStorage).map((key) => [key, sessionStorage.getItem(key)])));
  report.diagnosticState = await page.evaluate(() => window.__AF_BOOTSTRAP_DIAG__ || {});
  report.authSessionResponses = report.diagnosticState.fetchLog.filter((entry) => String(entry.url || "").includes("/api/auth/session"));
  report.loginResponses = report.diagnosticState.fetchLog.filter((entry) => String(entry.url || "").includes("/api/login"));
  report.profileResponses = report.diagnosticState.fetchLog.filter((entry) => String(entry.url || "").includes("/api/profile"));
  report.networkWaterfallSummary = report.diagnosticState.fetchLog.map((entry) => ({
    url: entry.url,
    method: entry.method,
    status: entry.status,
    durationMs: entry.finishedAt && entry.startedAt ? entry.finishedAt - entry.startedAt : null
  }));
  report.pendingRequests = report.diagnosticState.fetchLog.filter((entry) => !entry.finishedAt);
  report.domState = await page.evaluate(() => {
    const bodyText = document.body?.innerText || "";
    return {
      title: document.title,
      bodyPreview: bodyText.slice(0, 500),
      loadingVisible: bodyText.includes("正在同步你当前的轻量用户画像"),
      onboardingFormVisible: Boolean(document.querySelector("#onboarding-form")),
      dashboardFormVisible: Boolean(document.querySelector("#dashboard-preference-form")),
      jobsShellVisible: Boolean(document.querySelector(".jobs-shell")),
      currentHeading: document.querySelector("h1, h2, h3")?.textContent || "",
      currentSubtitle: document.querySelector("p")?.textContent || ""
    };
  });

  await page.screenshot({ path: path.join(OUTPUT_DIR, "dashboard-state.png"), fullPage: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`diagnose-production-onboarding-bootstrap: ${OUTPUT_PATH}`);

  await browser.close();
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
