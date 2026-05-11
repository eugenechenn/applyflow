#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");

function resolveBaseUrl() {
  return String(process.env.BASE_URL || process.env.UI_SMOKE_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
}

function isLocalUrl(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    return ["127.0.0.1", "localhost"].includes(parsed.hostname);
  } catch (_error) {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReachable(baseUrl, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/`, { method: "GET" });
      if (response.ok || response.status === 404) return true;
    } catch (_error) {
      // keep polling
    }
    await sleep(400);
  }
  return false;
}

function startLocalServer() {
  return spawn("node", ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
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

async function ensureHttpTarget() {
  const baseUrl = resolveBaseUrl();
  const autoStart = String(process.env.AUTO_START_LOCAL_SERVER || "true").trim().toLowerCase() !== "false";
  let server = null;

  const reachable = await waitForReachable(baseUrl, 2500);
  if (!reachable && isLocalUrl(baseUrl) && autoStart) {
    server = startLocalServer();
    const ready = await waitForReachable(baseUrl, 20000);
    if (!ready) {
      if (server && !server.killed) server.kill("SIGTERM");
      throw new Error(
        `HTTP target unreachable at ${baseUrl}. Local server startup failed. ` +
          `You can set BASE_URL or disable auto-start with AUTO_START_LOCAL_SERVER=false.`
      );
    }
  } else if (!reachable) {
    throw new Error(
      `HTTP target unreachable at ${baseUrl}. Please provide a reachable BASE_URL ` +
        `(e.g. http://127.0.0.1:3000 or https://applyflow.applyflow-eugene.workers.dev).`
    );
  }

  return {
    baseUrl,
    cleanup: async () => {
      if (server && !server.killed) {
        server.kill("SIGTERM");
      }
    }
  };
}

module.exports = {
  ensureHttpTarget
};
