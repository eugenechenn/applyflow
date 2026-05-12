#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ensureHttpTarget } = require("./_http-target");

async function postJson(url, body, cookie = "") {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body || {})
  });
  const payload = await response.json();
  return { response, payload };
}

function pickCookie(setCookieHeader = "") {
  return String(setCookieHeader || "").split(";")[0].trim();
}

async function main() {
  const { baseUrl, cleanup } = await ensureHttpTarget();
  try {
    const demoSessionRes = await fetch(`${baseUrl}/api/demo/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "demo" })
    });
    if (!demoSessionRes.ok) {
      throw new Error(`cannot start demo session: ${demoSessionRes.status}`);
    }
    const demoSetCookie = demoSessionRes.headers.get("set-cookie");
    const cookie = pickCookie(demoSetCookie);
    if (!cookie) {
      throw new Error("demo session cookie missing.");
    }

    const quickPayload = {
      lightweightProfile: {
        targetRoles: ["产品经理"],
        preferredLocations: ["上海"],
        skills: []
      },
      jobPreferenceProfile: {
        targetRoles: ["产品经理"],
        preferredLocations: ["上海"],
        preferredIndustries: ["互联网"],
        excludedIndustries: [],
        excludedRoles: [],
        companyTypes: [],
        avoidCompanyTypes: [],
        skills: [],
        jobType: "不限"
      }
    };
    const { response: saveResponse, payload: savePayload } = await postJson(`${baseUrl}/api/profile/save`, quickPayload, cookie);
    if (!saveResponse.ok || !savePayload?.success) {
      throw new Error(`quick preference save failed: ${saveResponse.status} ${savePayload?.error?.message || ""}`.trim());
    }
    const saveMessage = String(savePayload?.error?.message || "");
    if (/Missing required fields:\s*name,\s*background/i.test(saveMessage)) {
      throw new Error("still blocked by required name/background.");
    }

    const jobsRes = await fetch(`${baseUrl}/api/jobs`, {
      method: "GET",
      headers: {
        "content-type": "application/json",
        cookie
      }
    });
    if (!jobsRes.ok) {
      throw new Error(`/api/jobs failed after quick save: ${jobsRes.status}`);
    }
    const jobsPayload = await jobsRes.json();
    if (!jobsPayload?.success) {
      throw new Error("jobs api did not return success payload.");
    }

    const appScript = fs.readFileSync(path.resolve(__dirname, "../../public/app.js"), "utf8");
    if (!/补充姓名和背景可提升材料生成与网申自动填充质量/i.test(appScript)) {
      throw new Error("profile reminder text missing.");
    }

    console.log("[ok] quick preference flow works without name/background blocking.");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`[fail] ${error.message}`);
  process.exit(1);
});
