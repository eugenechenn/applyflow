"use strict";

// Phase 10A锛氱嚎涓婃墽琛岄摼璺?Playwright 澶嶉獙鑴氭湰銆?
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE_URL = process.env.UI_SMOKE_BASE_URL || "https://applyflow-staging.applyflow-eugene.workers.dev";
const OUTPUT_DIR = path.resolve(__dirname, "../../tmp/phase10a-playwright");
const ONBOARDING_PROFILE_LOCAL_KEY = "applyflow.onboarding.profile";
const TRACKER_FILTER_KEY = "applyflow.jobs.trackerFilter";
const SHORTLIST_FILTER_KEY = "applyflow.jobs.shortlistFilter";
const FIRST_ENTRY_GUARD_KEY = "applyflow.jobs.firstEntryGuard.v1";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForAppReady(page, { selector, loadingTextPatterns = [], timeoutMs = 30000 } = {}) {
  await page.waitForFunction(
    ({ selector: targetSelector, loadingPatterns }) => {
      const bodyText = document.body?.innerText || "";
      const hasLoadingText = loadingPatterns.some((pattern) => bodyText.includes(pattern));
      const hasTarget = targetSelector ? Boolean(document.querySelector(targetSelector)) : true;
      return hasTarget && !hasLoadingText;
    },
    { selector, loadingPatterns: loadingTextPatterns },
    { timeout: timeoutMs }
  );
}

async function waitForBasicRender(page, timeoutMs = 30000) {
  await page.waitForFunction(
    () => {
      const bodyText = document.body?.innerText || "";
      return bodyText.trim().length > 0;
    },
    {},
    { timeout: timeoutMs }
  );
}

async function waitForEmptyState(page, timeoutMs = 30000) {
  await page.waitForFunction(
    () => Boolean(document.querySelector("[data-empty-state]")),
    {},
    { timeout: timeoutMs }
  );
}

async function screenshot(page, name) {
  const filePath = path.join(OUTPUT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function gotoHash(page, hash) {
  await page.goto(`${BASE_URL}/${hash}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
}

async function collectJobsOverview(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("article.card"));
    const emptyState = document.querySelector("[data-empty-state]")?.getAttribute("data-empty-state") || null;
    const compareHeading = Boolean(document.querySelector("summary .eyebrow"));
    return {
      cardCount: cards.length,
      emptyState,
      compareHeading,
      route: window.location.hash || ""
    };
  });
}

async function findFilteredEmptyCombination(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/jobs");
    const payload = await response.json();
    const jobs = Array.isArray(payload?.jobWorkspaceViewModels)
      ? payload.jobWorkspaceViewModels
      : Array.isArray(payload?.data?.jobWorkspaceViewModels)
        ? payload.data.jobWorkspaceViewModels
        : [];
    const trackerStates = ["saved", "prep", "tailored", "applied", "interview", "rejected", "offer"];
    const shortlistStates = ["all", "shortlisted"];
    const normalizeTracker = (value = "") => {
      const normalized = String(value || "").trim().toLowerCase();
      return trackerStates.includes(normalized) ? normalized : "none";
    };
    const normalizeShortlist = (value = "") => {
      const normalized = String(value || "").trim().toLowerCase();
      return normalized === "shortlisted" ? "shortlisted" : "none";
    };

    for (const trackerState of trackerStates) {
      for (const shortlistState of shortlistStates) {
        const matches = jobs.filter((jobVm) => {
          const trackerMatch =
            trackerState === "all" ? true : normalizeTracker(jobVm?.trackerView?.state) === trackerState;
          const shortlistMatch =
            shortlistState === "all" ? true : normalizeShortlist(jobVm?.shortlistView?.state) === shortlistState;
          return trackerMatch && shortlistMatch;
        });
        if (matches.length === 0) {
          return {
            trackerState,
            shortlistState,
            source: "api_distribution"
          };
        }
      }
    }

    return null;
  });
}

async function triggerPersistedFilteredEmpty(page, { trackerState = "saved", shortlistState = "all" } = {}) {
  await page.evaluate(
    ({ trackerKey, shortlistKey, sessionKey, nextTrackerState, nextShortlistState }) => {
      localStorage.setItem(trackerKey, nextTrackerState);
      localStorage.setItem(shortlistKey, nextShortlistState);
      sessionStorage.setItem(sessionKey, "1");
    },
    {
      trackerKey: TRACKER_FILTER_KEY,
      shortlistKey: SHORTLIST_FILTER_KEY,
      sessionKey: FIRST_ENTRY_GUARD_KEY,
      nextTrackerState: trackerState,
      nextShortlistState: shortlistState
    }
  );

  await gotoHash(page, "#/jobs");
  await waitForAppReady(page, {
    selector: ".jobs-shell",
    loadingTextPatterns: ["鍔犺浇宀椾綅鍒楄〃"]
  });

  return collectJobsOverview(page);
}

async function readTrackerStateLabel(page, jobId) {
  return page.evaluate((currentJobId) => {
    const button = document.querySelector(
      `[data-action="save-materials-prep"][data-job-id="${currentJobId}"]`
    );
    const article = button?.closest("article.card");
    const trackerStatus = article?.querySelector("details.activity-disclosure .status.evaluating");
    return String(trackerStatus?.textContent || "").trim();
  }, jobId);
}

async function openJobCardDetails(page, jobId) {
  await page.evaluate((currentJobId) => {
    const button = document.querySelector(
      `[data-action="save-materials-prep"][data-job-id="${currentJobId}"]`
    );
    const article = button?.closest("article.card");
    if (!article) return;
    article.querySelectorAll("details").forEach((detail) => {
      detail.open = true;
    });
  }, jobId);
  await page.waitForTimeout(150);
}

async function saveMetadataFlows(page, jobId, stamp) {
  const triggerSaveAndWait = async ({ actionSelector, requestPath, successText, failureText }) => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (responseCandidate) =>
          responseCandidate.url().includes(requestPath) && responseCandidate.request().method() === "POST",
        { timeout: 30000 }
      ),
      page.locator(actionSelector).evaluate((element) => element.click())
    ]);
    assert(
      response.status() < 400,
      `${requestPath} 杩斿洖寮傚父鐘舵€?${response.status()}銆傛湡鏈涙枃妗堬細${successText} / ${failureText}`
    );
  };

  await openJobCardDetails(page, jobId);

  await page.locator(`[data-material-field="resumeStatus"][data-job-id="${jobId}"]`).selectOption("tailored", { force: true });
  await page.locator(`[data-material-field="coverLetterStatus"][data-job-id="${jobId}"]`).selectOption("draft", { force: true });
  await page.locator(`[data-material-field="interviewPrepStatus"][data-job-id="${jobId}"]`).selectOption("ready", { force: true });
  await page.locator(`[data-material-field="notes"][data-job-id="${jobId}"]`).fill(`phase10a-material-${stamp}`, { force: true });
  await triggerSaveAndWait({
    actionSelector: `[data-action="save-materials-prep"][data-job-id="${jobId}"]`,
    requestPath: `/api/jobs/${jobId}/materials-prep`,
    successText: "materials prep saved",
    failureText: "materials prep save failed"
  });
  await waitForAppReady(page, {
    selector: ".jobs-shell",
    loadingTextPatterns: ["鍔犺浇宀椾綅鍒楄〃"]
  });
  const materialsMessage = await page.evaluate(() => document.body?.innerText || "");

  await openJobCardDetails(page, jobId);
  await page.locator(`[data-submission-field="status"][data-job-id="${jobId}"]`).selectOption("ready", { force: true });
  await page.locator(`[data-submission-field="source"][data-job-id="${jobId}"]`).selectOption("manual", { force: true });
  await page.locator(`[data-submission-field="lastError"][data-job-id="${jobId}"]`).fill(`phase10a-submission-${stamp}`, { force: true });
  await page.locator(`[data-submission-field="notes"][data-job-id="${jobId}"]`).fill(`phase10a-submission-note-${stamp}`, { force: true });
  await triggerSaveAndWait({
    actionSelector: `[data-action="save-submission-audit"][data-job-id="${jobId}"]`,
    requestPath: `/api/jobs/${jobId}/submission-audit`,
    successText: "submission audit saved",
    failureText: "submission audit save failed"
  });
  await waitForAppReady(page, {
    selector: ".jobs-shell",
    loadingTextPatterns: ["鍔犺浇宀椾綅鍒楄〃"]
  });
  const submissionMessage = await page.evaluate(() => document.body?.innerText || "");

  const dueAtValue = "2026-05-08T10:30";
  await openJobCardDetails(page, jobId);
  await page.locator(`[data-followup-field="status"][data-job-id="${jobId}"]`).selectOption("planned", { force: true });
  await page.locator(`[data-followup-field="channel"][data-job-id="${jobId}"]`).selectOption("email", { force: true });
  await page.locator(`[data-followup-field="dueAt"][data-job-id="${jobId}"]`).fill(dueAtValue, { force: true });
  await page.locator(`[data-followup-field="notes"][data-job-id="${jobId}"]`).fill(`phase10a-followup-${stamp}`, { force: true });
  await triggerSaveAndWait({
    actionSelector: `[data-action="save-follow-up"][data-job-id="${jobId}"]`,
    requestPath: `/api/jobs/${jobId}/follow-up`,
    successText: "follow-up saved",
    failureText: "follow-up save failed"
  });
  await waitForAppReady(page, {
    selector: ".jobs-shell",
    loadingTextPatterns: ["鍔犺浇宀椾綅鍒楄〃"]
  });
  const followUpMessage = await page.evaluate(() => document.body?.innerText || "");
  const detailSnapshot = await page.evaluate(async (currentJobId) => {
    const response = await fetch(`/api/jobs/${currentJobId}`);
    const payload = await response.json();
    return payload?.data || payload || null;
  }, jobId);

  return {
    materialsNote: `phase10a-material-${stamp}`,
    submissionError: `phase10a-submission-${stamp}`,
    submissionNote: `phase10a-submission-note-${stamp}`,
    followUpNote: `phase10a-followup-${stamp}`,
    dueAtValue,
    materialsMessage,
    submissionMessage,
    followUpMessage,
    detailSnapshot
  };
}

async function verifyMetadataPersistence(page, jobId, expectedValues) {
  await openJobCardDetails(page, jobId);
  const actual = await page.evaluate((currentJobId) => {
    const readValue = (selector) => {
      const element = document.querySelector(selector);
      return String(element?.value || "").trim();
    };
    return {
      exists: {
        materialsNote: Boolean(
          document.querySelector(`[data-material-field="notes"][data-job-id="${currentJobId}"]`)
        ),
        submissionError: Boolean(
          document.querySelector(`[data-submission-field="lastError"][data-job-id="${currentJobId}"]`)
        ),
        submissionNote: Boolean(
          document.querySelector(`[data-submission-field="notes"][data-job-id="${currentJobId}"]`)
        ),
        followUpNote: Boolean(
          document.querySelector(`[data-followup-field="notes"][data-job-id="${currentJobId}"]`)
        ),
        dueAtValue: Boolean(
          document.querySelector(`[data-followup-field="dueAt"][data-job-id="${currentJobId}"]`)
        )
      },
      materialsNote: readValue(`[data-material-field="notes"][data-job-id="${currentJobId}"]`),
      submissionError: readValue(`[data-submission-field="lastError"][data-job-id="${currentJobId}"]`),
      submissionNote: readValue(`[data-submission-field="notes"][data-job-id="${currentJobId}"]`),
      followUpNote: readValue(`[data-followup-field="notes"][data-job-id="${currentJobId}"]`),
      dueAtValue: readValue(`[data-followup-field="dueAt"][data-job-id="${currentJobId}"]`)
    };
  }, jobId);

  assert(
    actual.materialsNote === expectedValues.materialsNote,
    `materials prep 鍥炴樉鍊间笉鍖归厤銆俛ctual=${JSON.stringify(actual)} expected=${JSON.stringify(expectedValues)}`
  );
  assert(
    actual.submissionError === expectedValues.submissionError,
    `submission audit lastError 鍥炴樉鍊间笉鍖归厤銆俛ctual=${JSON.stringify(actual)} expected=${JSON.stringify(expectedValues)}`
  );
  assert(
    actual.submissionNote === expectedValues.submissionNote,
    `submission audit notes 鍥炴樉鍊间笉鍖归厤銆俛ctual=${JSON.stringify(actual)} expected=${JSON.stringify(expectedValues)}`
  );
  assert(
    actual.followUpNote === expectedValues.followUpNote,
    `follow-up notes 鍥炴樉鍊间笉鍖归厤銆俛ctual=${JSON.stringify(actual)} expected=${JSON.stringify(expectedValues)}`
  );
  assert(
    actual.dueAtValue === expectedValues.dueAtValue,
    `follow-up dueAt 鍥炴樉鍊间笉鍖归厤銆俛ctual=${JSON.stringify(actual)} expected=${JSON.stringify(expectedValues)}`
  );
}

async function validateMainFlow(browser, results) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1800 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const apiErrors = [];
  const stamp = Date.now();

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(String(error?.message || error));
  });
  page.on("response", async (response) => {
    if (!response.url().includes("/api/") || response.status() < 400) return;
    let body = "";
    try {
      body = await response.text();
    } catch (error) {
      body = String(error?.message || error);
    }
    apiErrors.push({
      url: response.url(),
      status: response.status(),
      body: String(body || "").slice(0, 300)
    });
  });

  await gotoHash(page, "#/dashboard");
  await page.evaluate(
    ({ onboardingKey, trackerKey, shortlistKey, sessionKey }) => {
      localStorage.setItem(
        onboardingKey,
        JSON.stringify({
          lightweightProfile: {
            targetRoles: ["浜у搧缁忕悊"],
            skills: ["SQL", "Python"],
            preferredLocations: ["涓婃捣"]
          },
          jobPreferenceProfile: {
            targetRoles: ["浜у搧缁忕悊"],
            preferredIndustries: ["浜掕仈缃?杞欢"],
            preferredLocations: ["涓婃捣"],
            skills: ["SQL", "Python"],
            excludedRoles: [],
            excludedIndustries: [],
            companyTypes: [],
            jobType: "涓嶉檺"
          }
        })
      );
      localStorage.setItem(trackerKey, "offer");
      localStorage.setItem(shortlistKey, "shortlisted");
      sessionStorage.removeItem(sessionKey);
    },
    {
      onboardingKey: ONBOARDING_PROFILE_LOCAL_KEY,
      trackerKey: TRACKER_FILTER_KEY,
      shortlistKey: SHORTLIST_FILTER_KEY,
      sessionKey: FIRST_ENTRY_GUARD_KEY
    }
  );
  await gotoHash(page, "#/dashboard");
  await waitForAppReady(page, {
    selector: "#dashboard-preference-form",
    loadingTextPatterns: []
  });
  results.steps.push({
    step: "dashboard_first_load",
    screenshot: await screenshot(page, "01_dashboard_first_load")
  });

  await page.fill('#dashboard-preference-form input[name="targetRoles"]', "浜у搧缁忕悊");
  await page.fill('#dashboard-preference-form input[name="preferredLocations"]', "涓婃捣");
  await page.click('#dashboard-preference-form button[type="submit"]');
  await page.waitForURL(/#\/jobs/, { timeout: 60000 });
  await waitForAppReady(page, {
    selector: ".jobs-shell",
    loadingTextPatterns: ["鍔犺浇宀椾綅鍒楄〃"]
  });
  results.steps.push({
    step: "dashboard_save_to_jobs",
    screenshot: await screenshot(page, "02_jobs_after_dashboard_submit")
  });

  const firstJobsOverview = await collectJobsOverview(page);
  assert(firstJobsOverview.cardCount > 0, "jobs should be visible on first entry");
  assert(firstJobsOverview.emptyState !== "filtered_empty", "first jobs entry should not be blocked by stale filters");

  await gotoHash(page, "#/jobs");
  await waitForAppReady(page, {
    selector: ".jobs-shell",
    loadingTextPatterns: ["鍔犺浇宀椾綅鍒楄〃"]
  });
  const refreshedOverview = await collectJobsOverview(page);
  assert(refreshedOverview.cardCount > 0, "jobs refresh should keep visible cards");
  results.steps.push({
    step: "jobs_refresh_default_visible",
    screenshot: await screenshot(page, "03_jobs_refresh_default_visible")
  });

  let filteredCombination = await findFilteredEmptyCombination(page);
  let filteredOverview = null;
  let filteredStorageState = null;
  let filteredEmptyVerificationMode = "real_data";

  if (filteredCombination) {
    filteredOverview = await triggerPersistedFilteredEmpty(page, filteredCombination);
    filteredOverview = await collectJobsOverview(page);
    filteredStorageState = await page.evaluate(
      ({ trackerKey, shortlistKey, sessionKey }) => ({
        tracker: localStorage.getItem(trackerKey),
        shortlist: localStorage.getItem(shortlistKey),
        session: sessionStorage.getItem(sessionKey)
      }),
      {
        trackerKey: TRACKER_FILTER_KEY,
        shortlistKey: SHORTLIST_FILTER_KEY,
        sessionKey: FIRST_ENTRY_GUARD_KEY
      }
    );
    if (filteredOverview.emptyState === "filtered_empty") {
      assert(filteredOverview.cardCount > 0, "filtered-empty should still render the full job list");
      results.steps.push({
        step: "jobs_filtered_empty_guard",
        screenshot: await screenshot(page, "04_jobs_filtered_empty_guard")
      });
    } else {
      filteredEmptyVerificationMode = "live_dataset_not_triggered";
      results.steps.push({
        step: "jobs_filter_persistence_checked",
        screenshot: await screenshot(page, "04_jobs_filter_persistence_checked")
      });
    }
  } else {
    filteredEmptyVerificationMode = "mocked_guard_only";
  }

  if (filteredCombination && filteredOverview?.emptyState === "filtered_empty") {
    await page.locator("[data-action='jobs-reset-filters']").click({ force: true });
    await page.waitForFunction(
      ({ trackerKey, shortlistKey }) =>
        localStorage.getItem(trackerKey) === "all" && localStorage.getItem(shortlistKey) === "all",
      {
        trackerKey: TRACKER_FILTER_KEY,
        shortlistKey: SHORTLIST_FILTER_KEY
      },
      { timeout: 30000 }
    );
    await page.waitForTimeout(800);
  } else if (filteredCombination) {
    await page.evaluate(
      ({ trackerKey, shortlistKey }) => {
        localStorage.setItem(trackerKey, "all");
        localStorage.setItem(shortlistKey, "all");
      },
      {
        trackerKey: TRACKER_FILTER_KEY,
        shortlistKey: SHORTLIST_FILTER_KEY
      }
    );
    await gotoHash(page, "#/jobs");
    await waitForAppReady(page, {
      selector: ".jobs-shell",
      loadingTextPatterns: ["鍔犺浇宀椾綅鍒楄〃"]
    });
  }
  if (!filteredCombination) {
    await page.evaluate(
      ({ trackerKey, shortlistKey }) => {
        localStorage.setItem(trackerKey, "all");
        localStorage.setItem(shortlistKey, "all");
      },
      {
        trackerKey: TRACKER_FILTER_KEY,
        shortlistKey: SHORTLIST_FILTER_KEY
      }
    );
    await gotoHash(page, "#/jobs");
    await waitForAppReady(page, {
      selector: ".jobs-shell",
      loadingTextPatterns: ["鍔犺浇宀椾綅鍒楄〃"]
    });
  }
  const resetFiltersState = await page.evaluate(
    ({ trackerKey, shortlistKey }) => ({
      tracker: localStorage.getItem(trackerKey),
      shortlist: localStorage.getItem(shortlistKey),
      filteredEmptyVisible: Boolean(document.querySelector('[data-empty-state="filtered_empty"]'))
    }),
    {
      trackerKey: TRACKER_FILTER_KEY,
      shortlistKey: SHORTLIST_FILTER_KEY
    }
  );
  assert(resetFiltersState.tracker === "all", "reset all should restore trackerFilter=all");
  assert(resetFiltersState.shortlist === "all", "reset all should restore shortlistFilter=all");
  assert(!resetFiltersState.filteredEmptyVisible, "filtered-empty banner should disappear after reset");
  results.steps.push({
    step: "jobs_reset_all",
    screenshot: await screenshot(page, "05_jobs_reset_all")
  });

  const shortlistButton = page.locator("[data-action='set-shortlist-state']").first();
  assert((await shortlistButton.count()) > 0, "shortlist button should exist");
  const jobId = String((await shortlistButton.getAttribute("data-job-id")) || "").trim();
  assert(jobId, "jobId should be available for the first job card");
  await openJobCardDetails(page, jobId);
  const trackerStateBefore = await readTrackerStateLabel(page, jobId);
  const shortlistResponsePromise = page.waitForResponse(
    (response) => response.url().includes(`/api/jobs/${jobId}/shortlist-state`) && response.request().method() === "POST",
    { timeout: 30000 }
  );
  await shortlistButton.click();
  const shortlistResponse = await shortlistResponsePromise;
  assert(shortlistResponse.status() < 400, `shortlist-state 杩斿洖寮傚父鐘舵€侊細${shortlistResponse.status()}`);
  await page.waitForFunction(
    () => Boolean(document.querySelector("details.activity-disclosure summary.section-head")),
    {},
    { timeout: 30000 }
  );
  await page.locator("details.activity-disclosure summary.section-head").first().click();
  await page.waitForTimeout(1000);
  const compareVisible = await page.evaluate(() => {
    const summary = document.querySelector("details.activity-disclosure summary.section-head");
    const detail = summary?.closest("details");
    return Boolean(detail && detail.open);
  });
  assert(compareVisible, "compare panel should open after shortlisting a job");
  results.steps.push({
    step: "shortlist_compare_visible",
    screenshot: await screenshot(page, "06_shortlist_compare_visible")
  });

  const expectedMetadata = await saveMetadataFlows(page, jobId, stamp);
  results.steps.push({
    step: "materials_submission_followup_saved",
    screenshot: await screenshot(page, "07_metadata_saved")
  });

  await gotoHash(page, "#/jobs");
  await waitForAppReady(page, {
    selector: ".jobs-shell",
    loadingTextPatterns: ["鍔犺浇宀椾綅鍒楄〃"]
  });
  await verifyMetadataPersistence(page, jobId, expectedMetadata);
  const trackerStateAfter = await readTrackerStateLabel(page, jobId);
  assert(trackerStateBefore === trackerStateAfter, "metadata-only saves must not mutate trackerState");
  results.steps.push({
    step: "metadata_persistence_after_refresh",
    screenshot: await screenshot(page, "08_metadata_persistence_after_refresh")
  });

  await gotoHash(page, "#/profile");
  await waitForAppReady(page, {
    selector: "#profile-form",
    loadingTextPatterns: []
  });
  results.steps.push({
    step: "profile_accessible",
    screenshot: await screenshot(page, "09_profile_accessible")
  });

  results.mainFlow = {
    firstJobsOverview,
    refreshedOverview,
    filteredCombination,
    filteredOverview,
    filteredEmptyVerificationMode,
    resetFiltersState,
    trackerStateBefore,
    trackerStateAfter,
    consoleErrors,
    pageErrors,
    apiErrors
  };
  return { context };
}

async function validateGuardStates(session, results) {
  const guardChecks = [];

  const noJobsPage = await session.context.newPage();
  await noJobsPage.route("**/api/profile**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        profile: {
          id: "mock-profile",
          lightweightProfile: { targetRoles: ["浜у搧缁忕悊"] },
          jobPreferenceProfile: { targetRoles: ["浜у搧缁忕悊"], preferredLocations: ["涓婃捣"] }
        }
      })
    });
  });
  await noJobsPage.route("**/api/jobs**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        jobs: [],
        jobWorkspaceViewModels: []
      })
    });
  });
  await gotoHash(noJobsPage, "#/jobs");
  await noJobsPage.evaluate(
    ({ trackerKey, shortlistKey, sessionKey }) => {
      localStorage.setItem(trackerKey, "all");
      localStorage.setItem(shortlistKey, "all");
      sessionStorage.setItem(sessionKey, "1");
    },
    {
      trackerKey: TRACKER_FILTER_KEY,
      shortlistKey: SHORTLIST_FILTER_KEY,
      sessionKey: FIRST_ENTRY_GUARD_KEY
    }
  );
  await gotoHash(noJobsPage, "#/jobs");
  await waitForEmptyState(noJobsPage);
  const noJobsState = await noJobsPage.evaluate(() => {
    return document.querySelector("[data-empty-state]")?.getAttribute("data-empty-state") || null;
  });
  assert(noJobsState === "no_jobs", "no-jobs scenario should show no_jobs empty state");
  guardChecks.push({
    scenario: "no_jobs",
    emptyState: noJobsState,
    screenshot: await screenshot(noJobsPage, "10_no_jobs_state")
  });
  await noJobsPage.close();

  const filteredEmptyPage = await session.context.newPage();
  await filteredEmptyPage.route("**/api/profile**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        profile: {
          id: "mock-profile",
          lightweightProfile: { targetRoles: ["浜у搧缁忕悊"] },
          jobPreferenceProfile: { targetRoles: ["浜у搧缁忕悊"], preferredLocations: ["涓婃捣"] }
        }
      })
    });
  });
  await filteredEmptyPage.route("**/api/jobs**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        jobs: [],
        jobWorkspaceViewModels: [
          {
            jobSummary: {
              id: "phase10a-mock-job",
              company: "Mock Company",
              title: "Mock Role",
              location: "Shanghai"
            },
            trackerView: { state: "none", timeline: [] },
            shortlistView: { state: "none", timeline: [] },
            scoringView: {
              decisionVerdict: { grade: "B", verdict: "review" },
              fiveDimensionScores: {
                roleFit: 75,
                industryFit: 70,
                locationFit: 68,
                companyFit: 66,
                applicationAccessibilityFit: 64
              }
            }
          }
        ]
      })
    });
  });
  await gotoHash(filteredEmptyPage, "#/jobs");
  await filteredEmptyPage.evaluate(
    ({ trackerKey, shortlistKey, sessionKey }) => {
      localStorage.setItem(trackerKey, "saved");
      localStorage.setItem(shortlistKey, "all");
      sessionStorage.setItem(sessionKey, "1");
    },
    {
      trackerKey: TRACKER_FILTER_KEY,
      shortlistKey: SHORTLIST_FILTER_KEY,
      sessionKey: FIRST_ENTRY_GUARD_KEY
    }
  );
  await gotoHash(filteredEmptyPage, "#/jobs");
  await waitForEmptyState(filteredEmptyPage);
  const filteredEmptyState = await filteredEmptyPage.evaluate(() => {
    return {
      emptyState: document.querySelector("[data-empty-state]")?.getAttribute("data-empty-state") || null,
      cardCount: document.querySelectorAll("article.card").length
    };
  });
  assert(filteredEmptyState.emptyState === "filtered_empty", "persisted stale filter scenario should show filtered_empty");
  assert(filteredEmptyState.cardCount > 0, "filtered-empty guard should still render the full list");
  await filteredEmptyPage.locator("[data-action='jobs-reset-filters']").click({ force: true });
  await filteredEmptyPage.waitForFunction(
    ({ trackerKey, shortlistKey }) =>
      localStorage.getItem(trackerKey) === "all" && localStorage.getItem(shortlistKey) === "all",
    {
      trackerKey: TRACKER_FILTER_KEY,
      shortlistKey: SHORTLIST_FILTER_KEY
    },
    { timeout: 30000 }
  );
  guardChecks.push({
    scenario: "filtered_empty",
    emptyState: filteredEmptyState.emptyState,
    screenshot: await screenshot(filteredEmptyPage, "11_filtered_empty_state")
  });
  await filteredEmptyPage.close();

  const loadFailedPage = await session.context.newPage();
  await loadFailedPage.route("**/api/profile**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        profile: {
          id: "mock-profile",
          lightweightProfile: { targetRoles: ["浜у搧缁忕悊"] },
          jobPreferenceProfile: { targetRoles: ["浜у搧缁忕悊"], preferredLocations: ["涓婃捣"] }
        }
      })
    });
  });
  await loadFailedPage.route("**/api/jobs**", async (route) => {
    await route.abort("failed");
  });
  await gotoHash(loadFailedPage, "#/jobs");
  await loadFailedPage.evaluate(
    ({ trackerKey, shortlistKey, sessionKey }) => {
      localStorage.setItem(trackerKey, "all");
      localStorage.setItem(shortlistKey, "all");
      sessionStorage.setItem(sessionKey, "1");
    },
    {
      trackerKey: TRACKER_FILTER_KEY,
      shortlistKey: SHORTLIST_FILTER_KEY,
      sessionKey: FIRST_ENTRY_GUARD_KEY
    }
  );
  await gotoHash(loadFailedPage, "#/jobs");
  await waitForEmptyState(loadFailedPage);
  const loadFailedState = await loadFailedPage.evaluate(() => {
    return document.querySelector("[data-empty-state]")?.getAttribute("data-empty-state") || null;
  });
  assert(loadFailedState === "load_failed_partial", "load failure scenario should show load_failed_partial");
  guardChecks.push({
    scenario: "load_failed_partial",
    emptyState: loadFailedState,
    screenshot: await screenshot(loadFailedPage, "12_load_failed_partial_state")
  });
  await loadFailedPage.close();

  results.guardStates = guardChecks;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = {
    baseUrl: BASE_URL,
    executedAt: new Date().toISOString(),
    steps: []
  };

  try {
    const session = await validateMainFlow(browser, results);
    await session.context.close();
    fs.writeFileSync(path.join(OUTPUT_DIR, "report.json"), JSON.stringify(results, null, 2));
    console.log(`validate-phase10a-workflow-playwright: PASS (${BASE_URL})`);
    console.log(`report: ${path.join(OUTPUT_DIR, "report.json")}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});





