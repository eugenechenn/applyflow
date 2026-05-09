"use strict";

/**
 * 校验 curated 岗位池质量与元信息完整性（不改数据）。
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_FILE = "data/curated_offline_v1.json";
const SINGLE_ROLE_GUARD = /(\/|、|,|，|;|；|\|)/;
const BUNDLED_HINT = /(管培生|培训生|岗位合集|综合支持|研发类|设计类|运营类|市场类)/;
const ALLOWED_TIERS = new Set(["gold", "silver", "bronze"]);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  argv.forEach((item) => {
    const [key, ...rest] = String(item || "").split("=");
    if (!key.startsWith("--")) return;
    args[key.slice(2)] = rest.join("=");
  });
  return {
    filePath: args.file || process.env.CURATED_JOBS_FILE || DEFAULT_FILE
  };
}

function readRecords(filePath) {
  const absolutePath = path.resolve(filePath);
  const payload = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const records = Array.isArray(payload) ? payload : Array.isArray(payload.records) ? payload.records : [];
  return { absolutePath, records };
}

function toText(value) {
  return String(value || "").trim();
}

function validateRecord(record = {}, index = 0) {
  const warnings = [];
  const errors = [];
  const title = toText(record.title);
  const company = toText(record.company);
  const location = toText(record.location);
  const description = toText(record.description);
  const applyUrl = toText(record.applyUrl);
  const tier = toText(record.sourceQualityTier).toLowerCase();

  if (!title) errors.push("title missing");
  if (!company) errors.push("company missing");
  if (!location) errors.push("location missing");
  if (!description) errors.push("description missing");
  if (description.length < 120) warnings.push("description short");
  if (!/^https?:\/\//i.test(applyUrl)) errors.push("applyUrl invalid");
  if (!toText(record.source)) errors.push("source missing");
  if (!ALLOWED_TIERS.has(tier)) errors.push("sourceQualityTier invalid");
  if (!toText(record.sourceTag)) errors.push("sourceTag missing");
  if (!toText(record.sourceVersion)) errors.push("sourceVersion missing");
  if (!toText(record.capturedAt) || Number.isNaN(Date.parse(record.capturedAt))) errors.push("capturedAt invalid");
  if (!toText(record.industryHint)) warnings.push("industryHint missing");
  if (!toText(record.roleHint)) warnings.push("roleHint missing");

  const isMultiRole = Boolean(record.isMultiRole);
  const titleLooksBundled = SINGLE_ROLE_GUARD.test(title) || BUNDLED_HINT.test(title);
  if (titleLooksBundled && !isMultiRole) warnings.push("title may be multi-role but isMultiRole=false");
  if (!titleLooksBundled && isMultiRole) warnings.push("isMultiRole=true but title looks single-role");

  return { index, errors, warnings, title, company, location };
}

function main() {
  const { filePath } = parseArgs();
  const { absolutePath, records } = readRecords(filePath);
  const findings = records.map((item, index) => validateRecord(item, index));
  const invalid = findings.filter((item) => item.errors.length > 0);
  const warnings = findings.filter((item) => item.warnings.length > 0);

  const dedupeMap = new Map();
  const duplicates = [];
  findings.forEach((item) => {
    const key = `${item.title}|${item.company}|${item.location}`;
    if (dedupeMap.has(key)) {
      duplicates.push({ first: dedupeMap.get(key), second: item.index, key });
      return;
    }
    dedupeMap.set(key, item.index);
  });

  const trackCounts = {
    dataBi: 0,
    aiAlgorithm: 0,
    autoRobot: 0,
    pmDataProduct: 0,
    financeResearch: 0,
    educationResearch: 0
  };
  records.forEach((record) => {
    const industry = toText(record.industryHint).toLowerCase();
    const role = toText(record.roleHint).toLowerCase();
    const title = toText(record.title).toLowerCase();
    if ((industry.includes("金融") || industry.includes("finance")) && (role.includes("研究") || role.includes("research"))) trackCounts.financeResearch += 1;
    if ((industry.includes("教育") || industry.includes("education")) && (role.includes("研究") || role.includes("research"))) trackCounts.educationResearch += 1;
    if (role.includes("数据分析") || role.includes("data analyst") || role.includes("data_analyst")) trackCounts.dataBi += 1;
    if (industry.includes("ai/算法") || industry.includes("ai") || role.includes("算法") || role.includes("engineer")) trackCounts.aiAlgorithm += 1;
    if (title.includes("自动驾驶") || title.includes("机器人") || title.includes("autonomous") || title.includes("robot")) trackCounts.autoRobot += 1;
    if (role.includes("产品经理") || role.includes("product manager") || role.includes("product_manager")) trackCounts.pmDataProduct += 1;
  });

  const summary = {
    file: absolutePath,
    totalRecords: records.length,
    invalidCount: invalid.length,
    warningCount: warnings.length,
    duplicateCount: duplicates.length,
    trackCounts
  };

  console.log("\n==== Curated Job Pool Validation ====");
  console.log(JSON.stringify(summary, null, 2));
  if (invalid.length > 0) {
    console.log("\ninvalid samples:");
    invalid.slice(0, 10).forEach((item) => {
      console.log(`- #${item.index + 1} ${item.title}: ${item.errors.join("; ")}`);
    });
  }
  if (warnings.length > 0) {
    console.log("\nwarning samples:");
    warnings.slice(0, 10).forEach((item) => {
      console.log(`- #${item.index + 1} ${item.title}: ${item.warnings.join("; ")}`);
    });
  }
  if (duplicates.length > 0) {
    console.log("\nduplicate samples:");
    duplicates.slice(0, 10).forEach((item) => {
      console.log(`- ${item.key} (first #${item.first + 1}, second #${item.second + 1})`);
    });
  }

  if (invalid.length > 0 || duplicates.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log("\ncurated validation: PASS");
}

main();
