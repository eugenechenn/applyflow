"use strict";

const { spawn } = require("child_process");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../..");
const BASE_URL = process.env.UI_SMOKE_BASE_URL || "http://127.0.0.1:3000";
const ROUTES = ["#/dashboard", "#/jobs", "#/profile", "#/discovery"];

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
  throw new Error(`ui-runtime-smoke: server did not become ready at ${BASE_URL} within ${timeoutMs}ms`);
}

function startServer() {
  const child = spawn("node", ["server.js"], {
    cwd: ROOT,
    stdio: "ignore",
    shell: false
  });
  return child;
}

async function runRouteCheck(page, route) {
  const pageErrors = [];
  const consoleErrors = [];
  const onPageError = (error) => pageErrors.push(String(error?.message || error));
  const onConsole = (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  };

  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  await page.goto(`${BASE_URL}/${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const bodyText = await page.locator("body").innerText();
  page.off("pageerror", onPageError);
  page.off("console", onConsole);

  const runtimeCrash =
    /出现问题/.test(bodyText) ||
    /not defined/i.test(bodyText) ||
    pageErrors.some((item) => /not defined|cannot read properties/i.test(item)) ||
    consoleErrors.some((item) => /not defined|cannot read properties/i.test(item));
  if (runtimeCrash) {
    throw new Error(
      `ui-runtime-smoke: route ${route} has runtime crash. bodyHasErrorCard=${/出现问题/.test(bodyText)} pageErrors=${JSON.stringify(pageErrors)} consoleErrors=${JSON.stringify(consoleErrors)}`
    );
  }
}

async function main() {
  const server = startServer();
  let browser;
  try {
    await waitForServerReady();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    for (const route of ROUTES) {
      await runRouteCheck(page, route);
    }
  } finally {
    if (browser) {
      await browser.close();
    }
    if (server && !server.killed) {
      server.kill("SIGTERM");
    }
  }
}

main()
  .then(() => {
    console.log("validate-ui-runtime-smoke: dashboard/jobs/profile/discovery routes render without runtime crash.");
  })
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
