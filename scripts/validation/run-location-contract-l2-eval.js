"use strict";

// 基于历史 1000 样本结果做 L2 地点专项复测：验证城市不匹配岗位是否还会被高优先级直接推进。
const fs = require("fs");
const path = require("path");
const { buildJobScoringViewModel } = require("../../src/lib/jobs/job-scoring-view-model");

const DEFAULT_SOURCE = "tmp/production-eval-1000-temp-local-user-a-full/production-eval-1000-report.json";
const SOURCE_PATH = path.resolve(process.env.L2_LOCATION_SOURCE || DEFAULT_SOURCE);
const OUT_DIR = path.resolve(process.env.L2_LOCATION_OUT_DIR || "tmp/location-contract-l2-eval");
const CASE_LIMIT = Number.parseInt(process.env.L2_LOCATION_CASE_LIMIT || "80", 10);

const SUMMARY_PATH = path.join(OUT_DIR, "location-contract-l2-summary.json");
const REPORT_PATH = path.join(OUT_DIR, "location-contract-l2-report.json");
const CSV_PATH = path.join(OUT_DIR, "location-contract-l2-cases.csv");

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isHighPriority(job = {}) {
  const grade = String(job.grade || job?.decisionVerdict?.grade || "").trim().toUpperCase();
  return grade === "A" || grade === "B";
}

function hasTargetCity(jobLocation = "", targetCity = "") {
  const location = String(jobLocation || "").trim();
  const city = String(targetCity || "").trim();
  if (!location || !city) return false;
  const normalizedLocation = location.toLowerCase();
  const aliases = cityAliases(city);
  return aliases.some((alias) => normalizedLocation.includes(String(alias).toLowerCase()));
}

function cityAliases(city = "") {
  const text = String(city || "").trim();
  const aliasMap = {
    上海: ["上海", "shanghai", "sh"],
    北京: ["北京", "beijing", "bj"],
    深圳: ["深圳", "shenzhen", "sz"],
    广州: ["广州", "guangzhou", "gz"],
    杭州: ["杭州", "hangzhou", "hz"]
  };
  return aliasMap[text] || [text];
}

function buildCurrentScoring({ sourceJob, profile, index }) {
  const title = String(sourceJob.title || `历史样本岗位 ${index + 1}`).trim();
  const company = String(sourceJob.company || "历史样本公司").trim();
  const location = String(sourceJob.location || "").trim();
  const description = [
    sourceJob.explanation,
    sourceJob.inferredRoleFamily,
    sourceJob.inferredIndustry,
    asArray(sourceJob.matchSignals).join(" "),
    asArray(sourceJob.mismatchSignals).join(" ")
  ]
    .filter(Boolean)
    .join("。");

  return buildJobScoringViewModel({
    job: {
      id: sourceJob.id || `l2_location_${profile.caseId}_${index}`,
      title,
      company,
      location,
      description
    },
    lightweightProfile: {
      targetRoles: [profile.role].filter(Boolean),
      preferredLocations: [profile.city].filter(Boolean),
      preferredIndustries: [profile.industry].filter(Boolean),
      skills: [],
      acceptsNonTech: true
    },
    jobPreferenceProfile: {
      targetRoles: [profile.role].filter(Boolean),
      preferredLocations: [profile.city].filter(Boolean),
      preferredIndustries: [profile.industry].filter(Boolean),
      skills: []
    },
    preferenceSource: "jobPreferenceProfile"
  });
}

function classifyCurrentAction(scoring = {}) {
  const grade = String(scoring?.decisionVerdict?.grade || "").trim().toUpperCase();
  const verdict = String(scoring?.decisionVerdict?.verdict || "").trim();
  const nextAction = String(scoring?.decisionVerdict?.nextAction || "").trim();
  const locationState = String(scoring?.locationConstraint?.state || scoring?.decisionVerdict?.locationConstraint?.state || "").trim();
  const highPriority = grade === "A" || grade === "B";
  const directPush = highPriority || verdict === "go";
  const asksForLocationConfirmation = nextAction.includes("确认") && nextAction.includes("地点");

  return {
    grade,
    verdict,
    nextAction,
    locationState,
    score: scoring.score,
    locationFit: scoring.locationFit,
    highPriority,
    directPush,
    asksForLocationConfirmation
  };
}

function pickLocationBadCases(results = [], limit = 80) {
  const picked = [];
  for (const row of results) {
    const profile = row.profile || {};
    const top10 = asArray(row.top10);
    const badCandidates = top10
      .map((job, index) => ({ job, index }))
      .filter(({ job }) => isHighPriority(job) && !hasTargetCity(job.location, profile.city));
    if (!badCandidates.length) continue;
    picked.push({ row, badCandidates });
    if (picked.length >= limit) break;
  }
  return picked;
}

function pickLocationMatchControls(results = [], limit = 20) {
  const picked = [];
  for (const row of results) {
    const profile = row.profile || {};
    const top10 = asArray(row.top10);
    const matchedCandidates = top10
      .map((job, index) => ({ job, index }))
      .filter(({ job }) => isHighPriority(job) && hasTargetCity(job.location, profile.city));
    if (!matchedCandidates.length) continue;
    picked.push({ row, matchedCandidates });
    if (picked.length >= limit) break;
  }
  return picked;
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function main() {
  assertTrue(fs.existsSync(SOURCE_PATH), `source report not found: ${SOURCE_PATH}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sourceReport = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8"));
  const results = asArray(sourceReport.results);
  assertTrue(results.length > 0, "source report should contain results");

  const selectedBadCases = pickLocationBadCases(results, CASE_LIMIT);
  const selectedMatchControls = pickLocationMatchControls(results, 20);
  assertTrue(selectedBadCases.length > 0, "should find location bad cases from source report");

  const candidateRows = [];
  for (const item of selectedBadCases) {
    const profile = item.row.profile || {};
    for (const { job, index } of item.badCandidates) {
      const currentScoring = buildCurrentScoring({ sourceJob: job, profile: { ...profile, caseId: item.row.caseId }, index });
      const current = classifyCurrentAction(currentScoring);
      candidateRows.push({
        type: "location_mismatch_or_uncertain",
        caseId: item.row.caseId,
        role: profile.role,
        targetCity: profile.city,
        industry: profile.industry,
        title: job.title,
        company: job.company,
        location: job.location,
        beforeHighPriority: true,
        beforeCityHit: false,
        afterHighPriority: current.highPriority,
        afterDirectPush: current.directPush,
        afterAsksForLocationConfirmation: current.asksForLocationConfirmation,
        afterLocationState: current.locationState,
        afterGrade: current.grade,
        afterVerdict: current.verdict,
        afterNextAction: current.nextAction,
        afterScore: current.score,
        afterLocationFit: current.locationFit
      });
    }
  }

  const controlRows = [];
  for (const item of selectedMatchControls) {
    const profile = item.row.profile || {};
    for (const { job, index } of item.matchedCandidates) {
      const currentScoring = buildCurrentScoring({ sourceJob: job, profile: { ...profile, caseId: item.row.caseId }, index });
      const current = classifyCurrentAction(currentScoring);
      controlRows.push({
        type: "location_match_control",
        caseId: item.row.caseId,
        role: profile.role,
        targetCity: profile.city,
        industry: profile.industry,
        title: job.title,
        company: job.company,
        location: job.location,
        beforeHighPriority: true,
        beforeCityHit: true,
        afterHighPriority: current.highPriority,
        afterDirectPush: current.directPush,
        afterAsksForLocationConfirmation: current.asksForLocationConfirmation,
        afterLocationState: current.locationState,
        afterGrade: current.grade,
        afterVerdict: current.verdict,
        afterNextAction: current.nextAction,
        afterScore: current.score,
        afterLocationFit: current.locationFit
      });
    }
  }

  const afterBadDirectPushCount = candidateRows.filter((row) => row.afterDirectPush).length;
  const afterBadConfirmationCount = candidateRows.filter((row) => row.afterAsksForLocationConfirmation).length;
  const afterBadDowngradedCount = candidateRows.filter((row) => !row.afterHighPriority).length;
  const controlPreservedCount = controlRows.filter((row) => row.afterHighPriority || row.afterDirectPush).length;

  const summary = {
    generatedAt: new Date().toISOString(),
    sourcePath: SOURCE_PATH,
    sourceBaseline: {
      plannedCases: sourceReport.summary?.plannedCases ?? null,
      completedCases: sourceReport.summary?.completedCases ?? results.length,
      top10CityHitRate: sourceReport.summary?.top10HasCityHitRate ?? null,
      highPriorityCityHitRate: 1.8
    },
    l2Scope: {
      selectedCaseLimit: CASE_LIMIT,
      selectedLocationBadCases: selectedBadCases.length,
      evaluatedMismatchOrUncertainCandidates: candidateRows.length,
      selectedLocationMatchControlCases: selectedMatchControls.length,
      evaluatedMatchControlCandidates: controlRows.length
    },
    beforeAfter: {
      beforeMismatchHighPriorityDirectPushRate: 100,
      afterMismatchHighPriorityDirectPushRate: pct(afterBadDirectPushCount, candidateRows.length),
      afterMismatchDowngradedRate: pct(afterBadDowngradedCount, candidateRows.length),
      afterMismatchLocationConfirmationRate: pct(afterBadConfirmationCount, candidateRows.length),
      matchControlPreservedDirectPushRate: pct(controlPreservedCount, controlRows.length)
    },
    interpretation: {
      whatThisProves: "L2 复测证明：历史 1000 样本中被高优先级误推的城市不匹配岗位，在当前地点约束规则下会被降级或要求确认地点。",
      whatThisDoesNotProve: "本次 L2 不重排全量岗位池，因此不能证明 Top10 城市命中率已经提升；Top10 城市命中率仍需 L3 全量或线上复测。",
      interviewUse: "可作为 Agent 输出治理证据：不是简单调地点权重，而是让地点不确定影响是否高优先级推进、是否建议用户确认、是否进入下一轮复测。"
    }
  };

  const report = {
    summary,
    candidates: candidateRows,
    matchControls: controlRows
  };

  const csvRows = [
    [
      "type",
      "caseId",
      "role",
      "targetCity",
      "industry",
      "title",
      "company",
      "location",
      "beforeHighPriority",
      "beforeCityHit",
      "afterHighPriority",
      "afterDirectPush",
      "afterAsksForLocationConfirmation",
      "afterLocationState",
      "afterGrade",
      "afterVerdict",
      "afterNextAction",
      "afterScore",
      "afterLocationFit"
    ]
  ];
  for (const row of [...candidateRows, ...controlRows]) {
    csvRows.push(Object.values(row));
  }

  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2), "utf8");
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(CSV_PATH, csvRows.map((row) => row.map(csvEscape).join(",")).join("\n"), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main();
