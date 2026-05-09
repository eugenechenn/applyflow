"use strict";

const DEFAULT_SELF_SUMMARY = "Demonstrates strong execution, collaboration, and structured communication in real delivery environments.";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_PATTERN = /(?:\+?86[-\s]?)?1[3-9]\d{9}|(?:\+?\d[\d\s\-()]{7,}\d)/;
const PERSONAL_INFO_PATTERN = /(姓名|电话|手机|邮箱|出生年月|籍贯|现居地|所在地|wechat|微信|email|phone)/i;
const FALLBACK_PHRASES = [
  "建议人工补充确认",
  "岗位描述较少",
  "已从岗位描述中提取基础信息",
  "暂无可展示",
  "未清晰列出",
  "自动解析质量不足",
  "岗位职责没有被清晰列出",
  "核心要求没有被清晰列出",
  "completed with fallback"
];

function normalizeText(value = "") {
  return String(value || "")
    .replace(/\uFFFD+/g, "")
    .replace(/\r/g, "\n")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanLine(value = "", max = 220) {
  let text = normalizeText(value)
    .replace(/^[*+\-]\s*/, "")
    .replace(/[ ]{2,}/g, " ");

  FALLBACK_PHRASES.forEach((phrase) => {
    text = text.replaceAll(phrase, "");
  });

  text = text.trim();
  if (!text) return "";
  return text.length > max ? text.slice(0, max) : text;
}

function hasFallbackText(value = "") {
  const source = String(value || "");
  return FALLBACK_PHRASES.some((phrase) => source.includes(phrase));
}

function containsPersonalInfo(value = "") {
  const source = String(value || "");
  return EMAIL_PATTERN.test(source) || PHONE_PATTERN.test(source) || PERSONAL_INFO_PATTERN.test(source);
}

function uniqueLines(items = [], max = 8, perItemMax = 120) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => cleanLine(item, perItemMax))
    .filter(Boolean)
    .filter((item) => !hasFallbackText(item))
    .filter((item) => !containsPersonalInfo(item))
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

function normalizeWorkEntry(entry = {}, index = 0) {
  return {
    id: entry.id || `work_${index + 1}`,
    company: cleanLine(entry.company || "", 80),
    role: cleanLine(entry.role || "", 60),
    timeRange: cleanLine(entry.timeRange || "", 40),
    bullets: uniqueLines(entry.bullets || [], 6, 220)
  };
}

function normalizeProjectEntry(entry = {}, index = 0) {
  return {
    id: entry.id || `project_${index + 1}`,
    projectName: cleanLine(entry.projectName || entry.name || "", 90),
    role: cleanLine(entry.role || "", 60),
    timeRange: cleanLine(entry.timeRange || "", 40),
    bullets: uniqueLines(entry.bullets || [], 6, 220)
  };
}

function hasCanonicalResumeContent(contract = {}) {
  return Boolean(
    (Array.isArray(contract.workExperience) && contract.workExperience.length > 0) ||
    (Array.isArray(contract.projectExperience) && contract.projectExperience.length > 0)
  );
}

function normalizeCanonicalResumeContract(input = {}) {
  const workExperience = (Array.isArray(input.workExperience) ? input.workExperience : [])
    .map(normalizeWorkEntry)
    .filter((entry) => entry.company || entry.role || entry.bullets.length);

  const projectExperience = (Array.isArray(input.projectExperience) ? input.projectExperience : [])
    .map(normalizeProjectEntry)
    .filter((entry) => entry.projectName || entry.role || entry.bullets.length);

  const selfSummary = cleanLine(input.selfSummary || input.summary || "", 220) || DEFAULT_SELF_SUMMARY;

  return {
    workExperience,
    projectExperience,
    selfSummary,
    skills: uniqueLines(input.skills || [], 12, 80)
  };
}

module.exports = {
  DEFAULT_SELF_SUMMARY,
  normalizeCanonicalResumeContract,
  hasCanonicalResumeContent,
  uniqueLines,
  cleanLine,
  normalizeText,
  hasFallbackText,
  containsPersonalInfo
};
