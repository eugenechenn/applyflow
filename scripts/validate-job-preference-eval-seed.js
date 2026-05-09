"use strict";

/**
 * 校验 jobs preference eval seed 数据质量，防止坏样本进入回归门禁。
 */

const fs = require("fs");
const path = require("path");

const SEED_PATH = path.resolve(__dirname, "../docs/eval/jobs-preference-eval.seed.json");
const VALID_TIERS = new Set(["core", "gate", "diagnostic", "placeholder"]);
const VALID_CASE_MATURITY = new Set(["exploratory", "stable_candidate", "gate_ready", "gate"]);
const VALID_ACCEPTANCE_GATE_TIERS = new Set(["acceptance_gate", "diagnostic_only"]);
const BANNED_TOKENS = ["??", "tbd", "todo", "placeholder text"];

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function includesBannedToken(value = "") {
  const text = normalizeText(value).toLowerCase();
  return BANNED_TOKENS.find((token) => text.includes(token));
}

function hasHardConstraint(expected = {}) {
  return toArray(expected.mustNotAppearInTop3).length > 0 || Boolean(expected.locationShouldNotOverridePrimary);
}

function hasPositiveRankingConstraint(expected = {}) {
  const top5 = Number(expected.top5MinRelevant || 0);
  const top10 = Number(expected.top10MinRelevant || 0);
  return top5 > 0 || top10 > 0;
}

function validateCase(evalCase = {}) {
  const id = normalizeText(evalCase.id);
  const errors = [];
  const warnings = [];

  if (!id) errors.push("missing id");

  const description = normalizeText(evalCase.description);
  const notes = normalizeText(evalCase.notes);
  const tier = normalizeText(evalCase.evalTier);
  const caseMaturity = normalizeText(evalCase.caseMaturity);
  const promotionReason = normalizeText(evalCase.promotionReason);
  const blockingReason = normalizeText(evalCase.blockingReason);
  const requiredStableRuns = Number(evalCase.requiredStableRuns ?? 0);
  const currentStableRuns = Number(evalCase.currentStableRuns ?? 0);
  const lastPromotionReviewAt = normalizeText(evalCase.lastPromotionReviewAt);
  const coverageTags = toArray(evalCase.coverageTags).map((item) => normalizeText(item));
  const acceptanceGateTier = normalizeText(evalCase.acceptanceGateTier);
  const isCuratedCase = coverageTags.some((item) => item.includes("curated"));

  if (!description) errors.push("empty description");
  if (!notes) errors.push("empty notes");
  if (!evalCase.userPreference || typeof evalCase.userPreference !== "object") errors.push("missing userPreference");
  if (!evalCase.expected || typeof evalCase.expected !== "object") errors.push("missing expected");
  if (!tier) errors.push("missing evalTier");
  else if (!VALID_TIERS.has(tier)) errors.push(`invalid evalTier: ${tier}`);
  if (caseMaturity && !VALID_CASE_MATURITY.has(caseMaturity)) {
    errors.push(`invalid caseMaturity: ${caseMaturity}`);
  }
  if (acceptanceGateTier && !VALID_ACCEPTANCE_GATE_TIERS.has(acceptanceGateTier)) {
    errors.push(`invalid acceptanceGateTier: ${acceptanceGateTier}`);
  }
  if (acceptanceGateTier === "acceptance_gate" && tier !== "diagnostic") {
    errors.push("acceptance_gate cases must remain evalTier=diagnostic");
  }
  if (acceptanceGateTier === "acceptance_gate" && !coverageTags.includes("acceptance_gate")) {
    warnings.push("acceptance_gate case should include acceptance_gate coverage tag");
  }

  if (Number.isNaN(requiredStableRuns) || requiredStableRuns < 0) {
    errors.push("requiredStableRuns must be a non-negative number");
  }
  if (Number.isNaN(currentStableRuns) || currentStableRuns < 0) {
    errors.push("currentStableRuns must be a non-negative number");
  }
  if (lastPromotionReviewAt) {
    const parsed = Date.parse(lastPromotionReviewAt);
    if (!Number.isFinite(parsed)) {
      errors.push("lastPromotionReviewAt must be a valid ISO date");
    }
  }

  const bannedInDescription = includesBannedToken(description);
  const bannedInNotes = includesBannedToken(notes);
  if (bannedInDescription) errors.push(`banned token in description: ${bannedInDescription}`);
  if (bannedInNotes) errors.push(`banned token in notes: ${bannedInNotes}`);

  // 深度扫描 case 文本，防止 userPreference/expected 里出现占位脏值
  const serialized = JSON.stringify(evalCase).toLowerCase();
  for (const token of BANNED_TOKENS) {
    if (serialized.includes(token)) {
      errors.push(`banned token in case payload: ${token}`);
      break;
    }
  }

  const expected = evalCase.expected || {};
  if (tier === "core" || tier === "gate") {
    const hasRankingConstraint = hasPositiveRankingConstraint(expected);
    const hasConstraint = hasRankingConstraint || hasHardConstraint(expected);
    if (!hasConstraint) {
      errors.push("core/gate case must define ranking or hard constraint");
    }
  }

  if (tier === "placeholder") {
    if (hasPositiveRankingConstraint(expected) || hasHardConstraint(expected)) {
      warnings.push("placeholder should not define hard ranking constraints");
    }
  }

  if (tier === "diagnostic") {
    if (hasPositiveRankingConstraint(expected) && Number(expected.top5MinRelevant || 0) >= 2) {
      warnings.push("diagnostic case has strong ranking threshold; ensure it should not be gate");
    }
  }

  if (tier === "gate" && caseMaturity && caseMaturity !== "gate") {
    errors.push("evalTier=gate case must use caseMaturity=gate");
  }
  if (tier !== "gate" && caseMaturity === "gate") {
    errors.push("caseMaturity=gate cannot be used outside evalTier=gate");
  }
  if (tier === "diagnostic" && caseMaturity === "gate_ready" && !promotionReason) {
    warnings.push("gate_ready diagnostic case should explain promotionReason");
  }
  if (tier === "diagnostic" && caseMaturity === "exploratory" && !blockingReason) {
    warnings.push("exploratory diagnostic case should explain blockingReason");
  }
  if (tier === "diagnostic" && ["stable_candidate", "gate_ready"].includes(caseMaturity) && requiredStableRuns <= 0) {
    warnings.push("promotion candidate should define requiredStableRuns");
  }
  if (currentStableRuns > requiredStableRuns && requiredStableRuns > 0) {
    warnings.push("currentStableRuns exceeds requiredStableRuns; review metadata");
  }
  if (isCuratedCase && caseMaturity && caseMaturity !== "exploratory") {
    errors.push("curated diagnostic case must remain exploratory");
  }
  if (isCuratedCase && promotionReason) {
    warnings.push("curated diagnostic case should not carry promotionReason");
  }
  if (tier === "diagnostic" && promotionReason && blockingReason) {
    warnings.push("diagnostic case carries both promotionReason and blockingReason; confirm governance intent");
  }

  return { id: id || "(missing-id)", tier: tier || "(missing-tier)", errors, warnings };
}

function main() {
  const raw = fs.readFileSync(SEED_PATH, "utf8");
  const seed = JSON.parse(raw);
  const cases = toArray(seed.cases);
  if (cases.length === 0) {
    throw new Error("seed cases should not be empty");
  }

  const results = cases.map(validateCase);
  const invalidCases = results.filter((item) => item.errors.length > 0);
  const warningCases = results.filter((item) => item.warnings.length > 0);
  const tierDistribution = results.reduce(
    (acc, item) => {
      if (VALID_TIERS.has(item.tier)) acc[item.tier] += 1;
      else acc.invalid += 1;
      return acc;
    },
    { core: 0, gate: 0, diagnostic: 0, placeholder: 0, invalid: 0 }
  );

  // 规则 5/6：placeholder 与 diagnostic 不允许影响 PASS/FAIL（通过 tier 约束 + 报告提示加固）
  const summaryWarnings = [];
  const hasTieredGateStrategy =
    normalizeText(seed?.baselineStrategy?.gateBasedOn).toLowerCase().includes("core22") ||
    normalizeText(seed?.baselineStrategy?.gateBasedOn).toLowerCase().includes("gate");
  if (!hasTieredGateStrategy) {
    summaryWarnings.push("baselineStrategy.gateBasedOn missing or not tiered");
  }
  const promotionGovernance = seed?.promotionGovernance && typeof seed.promotionGovernance === "object" ? seed.promotionGovernance : null;
  if (!promotionGovernance) {
    summaryWarnings.push("promotionGovernance missing");
  } else {
    const criteria = toArray(promotionGovernance.criteria);
    if (criteria.length < 8) {
      summaryWarnings.push("promotionGovernance.criteria incomplete");
    }
  }

  console.log("");
  console.log("==== Job Preference Eval Seed Validation ====");
  console.log(`Seed: ${SEED_PATH}`);
  console.log(`total cases: ${cases.length}`);
  console.log(
    `tier distribution: core=${tierDistribution.core}, gate=${tierDistribution.gate}, diagnostic=${tierDistribution.diagnostic}, placeholder=${tierDistribution.placeholder}, invalidTier=${tierDistribution.invalid}`
  );
  console.log(`invalid cases: ${invalidCases.length}`);
  console.log(`warning cases: ${warningCases.length + summaryWarnings.length}`);

  if (invalidCases.length > 0) {
    console.log("");
    console.log("## Invalid Cases");
    invalidCases.forEach((item) => {
      console.log(`- ${item.id}: ${item.errors.join("; ")}`);
    });
  }

  if (warningCases.length > 0 || summaryWarnings.length > 0) {
    console.log("");
    console.log("## Warning Cases");
    warningCases.forEach((item) => {
      console.log(`- ${item.id}: ${item.warnings.join("; ")}`);
    });
    summaryWarnings.forEach((msg) => console.log(`- seed-level: ${msg}`));
  }

  if (invalidCases.length > 0) {
    process.exitCode = 2;
    return;
  }
  console.log("");
  console.log("seed validation: PASS");
}

main();
