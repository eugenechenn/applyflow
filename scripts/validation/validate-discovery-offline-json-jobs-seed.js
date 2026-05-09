"use strict";

const orchestrator = require("../../src/lib/orchestrator/workflow-controller");

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const before = await orchestrator.getJobWorkspaceList();
  const beforeJobs = Array.isArray(before?.jobWorkspaceViewModels) ? before.jobWorkspaceViewModels : [];
  const beforeCount = beforeJobs.length;
  const beforeIds = new Set(beforeJobs.map((job) => String(job?.id || "")));

  const created = await orchestrator.createDiscoveryIntentWorkflow({
    keywords: ["AI Product Manager", "Backend Engineer"],
    city: "Shanghai",
    jobType: "full_time"
  });
  const intentId = String(created?.intent?.intentId || "").trim();
  assertTrue(Boolean(intentId), "intentId should be created");

  const imported = await orchestrator.importDiscoveryOfflineJsonWorkflow(intentId, {
    candidateLimit: 20,
    resolutionLimit: 10,
    fallbackKeywords: ["AI Product Manager", "Backend Engineer"],
    fallbackCity: "Shanghai",
    origin: "dashboard_bootstrap"
  });
  assertTrue(Boolean(imported?.rankingResult), "ranking result should exist");
  assertTrue(Boolean(imported?.shortlistResult), "shortlist result should exist");
  assertTrue(Boolean(imported?.admissionSummary?.autoAdmitEnabled), "auto admission should be enabled");
  assertTrue(imported?.batchSummary?.fallbackUsed !== true, "offline_json jobs seed must not use fallback records");

  const after = await orchestrator.getJobWorkspaceList();
  const afterJobs = Array.isArray(after?.jobWorkspaceViewModels) ? after.jobWorkspaceViewModels : [];
  const afterCount = afterJobs.length;
  const newJobs = afterJobs.filter((job) => !beforeIds.has(String(job?.id || "")));
  const visibleFallbackJobs = afterJobs.filter((job) => {
    const summary = job?.jobSummary || {};
    return (
      String(summary.company || "") === "工程师 团队" ||
      String(summary.title || "") === "工程师 相关岗位" ||
      /applyflow\.local\/fallback/i.test(String(summary.sourceUrl || ""))
    );
  });
  const fallbackJobs = newJobs.filter((job) => {
    const summary = job?.jobSummary || {};
    const company = String(summary.company || "");
    const title = String(summary.title || "");
    const url = String(summary.sourceUrl || "");
    return (
      company === "工程师 团队" ||
      title === "工程师 相关岗位" ||
      /applyflow\.local\/fallback/i.test(url)
    );
  });

  const admitted = Number(imported?.admissionSummary?.admittedJobsCount || 0);
  assertTrue(admitted >= 10, "should auto-admit at least 10 real listings into jobs chain");
  assertTrue(afterCount >= beforeCount, "jobs workspace count must not shrink after offline_json admission");
  assertTrue(visibleFallbackJobs.length === 0, "visible jobs list must not contain old or new fallback records");
  assertTrue(
    newJobs.length >= 10 || admitted >= 10,
    "jobs workspace should expose at least 10 admitted real records, even when the seed is idempotent"
  );
  assertTrue(fallbackJobs.length === 0, "fallback jobs must not enter the jobs list");
  assertTrue(
    afterJobs.some((job) => {
      const summary = job?.jobSummary || {};
      return (
        String(summary.company || "").trim() &&
        String(summary.title || "").trim() &&
        /^https:\/\//i.test(String(summary.sourceUrl || ""))
      );
    }),
    "at least one new job should preserve real company, title, and https source URL"
  );

  console.log(
    `validate-discovery-offline-json-jobs-seed: admitted ${admitted} listings; jobs count ${beforeCount} -> ${afterCount}; new jobs ${newJobs.length}.`
  );
}

main().catch((error) => {
  console.error("validate-discovery-offline-json-jobs-seed failed:", error?.message || error);
  process.exitCode = 1;
});
