"use strict";

const SKILL_RULESET_ID = "resume-structuring-audit.v6";

const SECTION_KEYS = {
  PERSONAL_INFO: "personal_info",
  WORK_EXPERIENCE: "work_experience",
  PROJECT_EXPERIENCE: "project_experience",
  SELF_SUMMARY: "self_summary",
  EDUCATION: "education",
  SKILLS: "skills",
  OTHER: "other"
};

const HEADING_PATTERNS = {
  personalInfo: [/^(个人信息|基本信息|联系方式|联系信息)$/i],
  workExperience: [/^(工作经历|工作经验|实习经历|任职经历)$/i],
  projectExperience: [/^(项目经历|项目经验|项目实践)$/i],
  selfSummary: [/^(自我评价|个人评价|个人优势|个人简介|个人总结)$/i],
  education: [/^(教育背景|教育经历|学习经历)$/i],
  skills: [/^(技能|专业技能|工具技能|能力标签)$/i]
};

const COMPANY_HINT_PATTERN = /(公司|有限公司|集团|科技|管理|教育|咨询|银行|财富|传媒|通信|中心|研究院|PCCW|Inc|Ltd|Corporation)/i;
const ROLE_HINT_PATTERN = /(助理|经理|运营|分析|专员|顾问|实习|协调|项目|产品|客户|主管|组长|负责人|咨询顾问|项目管理助理|客户关系|业务协同|PM|analyst|manager|lead|intern)/i;
const PROJECT_HINT_PATTERN = /(项目|方案|系统|搭建|优化|诊断|课题|小组|研究|企业诊断|pilot|copilot|project)/i;
const SCHOOL_HINT_PATTERN = /(大学|学院|学校|university|college|school)/i;
const DEGREE_HINT_PATTERN = /(本科|硕士|博士|MBA|学士|专业|学历|学位|毕业)/i;
const SUMMARY_HINT_PATTERN = /(逻辑思维|商业视角|沟通协调|团队协作|学习能力|执行力|分析能力|文字功底|英语水平|责任心|抗压|适应能力)/i;
const SKILL_TEXT_PATTERN = /(sql|python|excel|power bi|tableau|figma|notion|jira|agent|llm|ai|数据分析|流程梳理|文档整理|沟通协调|团队协作)/i;
const TIME_RANGE_PATTERN = /((?:19|20)\d{2}[./-]\d{1,2}\s*(?:[-–—至~]\s*(?:(?:19|20)\d{2}[./-]\d{1,2}|至今|现在|Present))?)/;
const EMAIL_OR_PHONE_PATTERN = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+?86[-\s]?)?1[3-9]\d{9})/i;
const FALLBACK_KEYWORDS = [
  "建议人工补充确认",
  "岗位描述较少",
  "已从岗位描述中提取基础信息",
  "暂无可展示",
  "未清晰列出",
  "自动解析质量不足",
  "岗位职责没有被清晰列出",
  "核心要求没有被清晰列出"
];
const PERSONAL_INFO_KEYWORDS = ["姓名", "电话", "手机", "邮箱", "出生年月", "籍贯", "现居地", "所在地", "微信"];
const PROJECT_KEYWORDS = ["项目", "系统", "搭建", "方案设计", "平台搭建", "系统优化", "方案优化", "试点", "企业诊断"];
const WORK_KEYWORDS = ["客户", "运营", "咨询", "售前", "售后", "服务", "投诉", "回访", "台账", "交付", "流程", "复盘", "协同", "沟通", "数据"];
const SELF_SUMMARY_KEYWORDS = ["自我评价", "个人优势", "个人简介", "个人总结"];
const PROJECT_MANAGEMENT_WORK_PATTERNS = [
  /项目管理/i,
  /项目经理/i,
  /项目助理/i,
  /项目进度/i,
  /项目台账/i,
  /项目交付/i,
  /项目节点/i
];
const STRONG_PROJECT_PATTERNS = [
  /企业诊断/i,
  /方案(设计|汇报|输出)/i,
  /系统(搭建|优化|设计)/i,
  /平台(搭建|试点)/i,
  /课题/i,
  /小组/i,
  /项目报告/i,
  /项目复盘/i
];

function normalizeResumeAuditText(value = "") {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateResumeAuditText(value = "", max = 220) {
  const text = normalizeResumeAuditText(value);
  if (!text) return "";
  return text.length > max ? text.slice(0, max) : text;
}

function splitAuditLines(value = "") {
  return normalizeResumeAuditText(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function containsHeading(text = "", patterns = []) {
  return patterns.some((pattern) => pattern.test(String(text || "").trim()));
}

function hasSectionHeading(line = "") {
  return Object.values(HEADING_PATTERNS).some((patterns) => containsHeading(line, patterns));
}

function containsAnyKeyword(value = "", keywords = []) {
  const normalized = String(value || "").toLowerCase();
  return keywords.some((keyword) => normalized.includes(String(keyword).toLowerCase()));
}

function looksLikeSentence(text = "") {
  const value = String(text || "").trim();
  return /[，。；;！？!?]/.test(value) || value.length > 80;
}

function hasFallbackText(value = "") {
  return containsAnyKeyword(value, FALLBACK_KEYWORDS);
}

function hasProjectSignals(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  if (STRONG_PROJECT_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  if (PROJECT_MANAGEMENT_WORK_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  return containsAnyKeyword(normalized, PROJECT_KEYWORDS);
}

function hasWorkSignals(value = "") {
  return containsAnyKeyword(value, WORK_KEYWORDS);
}

function isPersonalInfoLine(text = "") {
  const value = String(text || "").trim();
  if (!value) return false;
  return EMAIL_OR_PHONE_PATTERN.test(value) || containsAnyKeyword(value, PERSONAL_INFO_KEYWORDS);
}

function isEducationLine(text = "") {
  const value = String(text || "").trim();
  if (!value) return false;
  return (
    (SCHOOL_HINT_PATTERN.test(value) && DEGREE_HINT_PATTERN.test(value)) ||
    (TIME_RANGE_PATTERN.test(value) && SCHOOL_HINT_PATTERN.test(value) && DEGREE_HINT_PATTERN.test(value)) ||
    (TIME_RANGE_PATTERN.test(value) && SCHOOL_HINT_PATTERN.test(value) && !COMPANY_HINT_PATTERN.test(value))
  );
}

function isProjectLine(text = "") {
  const value = String(text || "").trim();
  return Boolean(value) && PROJECT_HINT_PATTERN.test(value) && !isEducationLine(value);
}

function isWorkLine(text = "") {
  const value = String(text || "").trim();
  if (!value || isEducationLine(value) || isProjectLine(value)) return false;
  return TIME_RANGE_PATTERN.test(value) || COMPANY_HINT_PATTERN.test(value) || ROLE_HINT_PATTERN.test(value);
}

function isSkillToken(text = "") {
  const value = String(text || "").trim();
  if (!value || value.length > 40 || looksLikeSentence(value)) return false;
  return SKILL_TEXT_PATTERN.test(value);
}

function isSelfSummaryLine(text = "") {
  const value = String(text || "").trim();
  if (!value) return false;
  if (isPersonalInfoLine(value) || isEducationLine(value) || isWorkLine(value) || isProjectLine(value)) return false;
  return SUMMARY_HINT_PATTERN.test(value) || containsAnyKeyword(value, SELF_SUMMARY_KEYWORDS) || looksLikeSentence(value);
}

function classifyResumeEntry(text = "", { prefer = null } = {}) {
  const value = normalizeResumeAuditText(text);
  if (!value) return SECTION_KEYS.OTHER;
  if (prefer && Object.values(SECTION_KEYS).includes(prefer)) return prefer;
  if (isPersonalInfoLine(value)) return SECTION_KEYS.PERSONAL_INFO;
  if (isEducationLine(value)) return SECTION_KEYS.EDUCATION;
  if (isProjectLine(value)) return SECTION_KEYS.PROJECT_EXPERIENCE;
  if (isWorkLine(value)) return SECTION_KEYS.WORK_EXPERIENCE;
  if (isSkillToken(value)) return SECTION_KEYS.SKILLS;
  if (isSelfSummaryLine(value)) return SECTION_KEYS.SELF_SUMMARY;
  return SECTION_KEYS.OTHER;
}

function normalizeTimeRange(value = "") {
  return String(value || "")
    .replace(/[–—至~]/g, "-")
    .replace(/\s+/g, "")
    .replace(/(\d{4})\.(\d)(?!\d)/g, "$1.0$2");
}

function extractTimeRange(text = "") {
  const match = String(text || "").match(TIME_RANGE_PATTERN);
  return match ? normalizeTimeRange(match[1]) : "";
}

function cleanHeaderText(text = "") {
  return normalizeResumeAuditText(text)
    .replace(TIME_RANGE_PATTERN, " ")
    .replace(/[•·▪◦●]/g, " ")
    .replace(/[|｜]/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

function parseWorkHeader(text = "") {
  const value = String(text || "").trim();
  const timeRange = extractTimeRange(value);
  const body = cleanHeaderText(value);
  const parts = body.split(/[\/]/).map((item) => item.trim()).filter(Boolean);

  let company = "";
  let role = "";

  if (parts.length >= 2) {
    company = parts[0];
    role = parts.slice(1).join(" ");
  } else if (COMPANY_HINT_PATTERN.test(body) && ROLE_HINT_PATTERN.test(body)) {
    const tokens = body.split(/\s+/).filter(Boolean);
    const roleIndex = tokens.findIndex((token) => ROLE_HINT_PATTERN.test(token));
    if (roleIndex > 0) {
      company = tokens.slice(0, roleIndex).join(" ");
      role = tokens.slice(roleIndex).join(" ");
    }
  }

  if (!company && COMPANY_HINT_PATTERN.test(body)) company = body;
  if (!role && ROLE_HINT_PATTERN.test(body) && company && body !== company) {
    role = body.replace(company, "").trim();
  }

  return {
    company: truncateResumeAuditText(company, 80),
    role: truncateResumeAuditText(role, 60),
    timeRange
  };
}

function parseProjectHeader(text = "") {
  const value = String(text || "").trim();
  const timeRange = extractTimeRange(value);
  const body = cleanHeaderText(value);
  const parts = body.split(/[\/]/).map((item) => item.trim()).filter(Boolean);

  let projectName = parts[0] || body;
  let role = parts.length > 1 ? parts.slice(1).join(" ") : "";

  if (!role && /(组长|负责人|lead|owner|manager|intern)/i.test(projectName)) {
    const splitIndex = projectName.search(/(组长|负责人|lead|owner|manager|intern)/i);
    if (splitIndex > 0) {
      role = projectName.slice(splitIndex).trim();
      projectName = projectName.slice(0, splitIndex).trim();
    }
  }

  return {
    projectName: truncateResumeAuditText(projectName, 90),
    role: truncateResumeAuditText(role, 60),
    timeRange
  };
}

function parseEducationHeader(text = "") {
  const value = String(text || "").trim();
  const timeRange = extractTimeRange(value);
  const body = cleanHeaderText(value);
  const schoolMatch = body.match(/([^\s]+(?:大学|学院|学校))/);
  const degreeMatch = body.match(/(本科|硕士|博士|MBA|学士|[\u4e00-\u9fa5A-Za-z]+专业)/);
  return {
    school: truncateResumeAuditText(schoolMatch ? schoolMatch[1] : body, 90),
    degree: truncateResumeAuditText(degreeMatch ? degreeMatch[1] : "", 60),
    timeRange
  };
}

function cleanCanonicalText(value = "", max = 220) {
  let text = normalizeResumeAuditText(String(value || ""))
    .replace(/^[•·▪◦●\-]\s*/, "")
    .replace(/[。]{2,}/g, "。")
    .replace(/[，]{2,}/g, "，")
    .replace(/[；]{2,}/g, "；")
    .trim();
  FALLBACK_KEYWORDS.forEach((keyword) => {
    text = text.replaceAll(keyword, "");
  });
  text = text.trim();
  if (!text) return "";
  return text.length > max ? text.slice(0, max) : text;
}

function extractCanonicalSkillTokens(lines = []) {
  const items = Array.isArray(lines) ? lines : [lines];
  const tokens = [];
  items.forEach((item) => {
    normalizeResumeAuditText(item)
      .split(/[、,，/]/)
      .map((token) => token.trim())
      .filter(Boolean)
      .forEach((token) => {
        if (isSkillToken(token) && !tokens.includes(token)) tokens.push(token);
      });
  });
  return tokens.slice(0, 12);
}

function normalizeCanonicalBullets(bullets = [], max = 6) {
  return (Array.isArray(bullets) ? bullets : [])
    .map((item) => cleanCanonicalText(item, 220))
    .filter(Boolean)
    .filter((item) => !hasFallbackText(item))
    .filter((item) => !isPersonalInfoLine(item))
    .filter((item) => !containsAnyKeyword(item, SELF_SUMMARY_KEYWORDS))
    .filter((item) => !hasSectionHeading(item))
    .filter((item) => !/^(?:19|20)\d{2}[./-]\d{1,2}(?:\s*[-–—至]\s*(?:(?:19|20)\d{2}[./-]\d{1,2}|至今|现在))?/.test(item))
    .filter((item) => item.length >= 8)
    .slice(0, max);
}

function looksLikeProjectHeader(company = "", role = "", bullets = []) {
  const header = `${company} ${role}`.trim();
  if (!header) return false;
  if (COMPANY_HINT_PATTERN.test(company)) return false;
  if (containsAnyKeyword(header, PROJECT_KEYWORDS)) return true;
  const projectBulletCount = (Array.isArray(bullets) ? bullets : []).filter((item) => hasProjectSignals(item)).length;
  const workBulletCount = (Array.isArray(bullets) ? bullets : []).filter((item) => hasWorkSignals(item)).length;
  return projectBulletCount > 0 && projectBulletCount >= workBulletCount;
}

function buildStructuredWorkExperience(entries = []) {
  let previousCompany = "";
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const parsed = parseWorkHeader(entry?.header || entry?.company || "");
      const company = cleanCanonicalText(parsed.company || entry?.company || previousCompany, 80);
      const role = cleanCanonicalText(parsed.role || entry?.role || "", 60);
      const timeRange = cleanCanonicalText(parsed.timeRange || entry?.timeRange || "", 40);
      const bullets = normalizeCanonicalBullets(entry?.bullets || [], 6);
      if (company) previousCompany = company;
      return {
        id: entry?.id || `work_${index + 1}`,
        company: company || previousCompany,
        role,
        timeRange,
        bullets
      };
    })
    .filter((entry) => entry.company || entry.role || (entry.bullets || []).length)
    .filter((entry) => !isPersonalInfoLine(entry.company))
    .filter((entry) => !isEducationLine(entry.company));
}

function buildStructuredProjectExperience(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const parsed = parseProjectHeader(entry?.header || entry?.projectName || "");
      return {
        id: entry?.id || `project_${index + 1}`,
        projectName: cleanCanonicalText(parsed.projectName || entry?.projectName || entry?.name || "", 90),
        role: cleanCanonicalText(parsed.role || entry?.role || "", 60),
        timeRange: cleanCanonicalText(parsed.timeRange || entry?.timeRange || "", 40),
        bullets: normalizeCanonicalBullets(entry?.bullets || [], 6)
      };
    })
    .filter((entry) => entry.projectName || entry.role || (entry.bullets || []).length)
    .filter((entry) => !hasFallbackText(entry.projectName));
}

function buildStructuredEducation(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const parsed = parseEducationHeader(entry?.header || entry?.school || "");
      return {
        id: entry?.id || `education_${index + 1}`,
        school: parsed.school,
        degree: cleanCanonicalText(parsed.degree || entry?.degree || "", 60),
        timeRange: cleanCanonicalText(parsed.timeRange || entry?.timeRange || "", 40)
      };
    })
    .filter((entry) => entry.school || entry.degree || entry.timeRange);
}

function normalizeResumeData(profile = {}) {
  const structured = profile || {};
  const movedProjectEntries = [];
  const existingProjectEntries = Array.isArray(structured.projectExperience) ? structured.projectExperience : [];
  const workExperience = buildStructuredWorkExperience(structured.workExperience || []).flatMap((entry) => {
    if (looksLikeProjectHeader(entry.company, entry.role, entry.bullets)) {
      movedProjectEntries.push({
        projectName: cleanCanonicalText(entry.company || entry.role || "相关项目", 90),
        role: COMPANY_HINT_PATTERN.test(entry.company) ? entry.role : "",
        timeRange: entry.timeRange,
        bullets: entry.bullets
      });
      return [];
    }

    const keptBullets = [];
    (entry.bullets || []).forEach((bullet) => {
      if (hasProjectSignals(bullet) && (existingProjectEntries.length === 0 || STRONG_PROJECT_PATTERNS.some((pattern) => pattern.test(bullet)))) {
        movedProjectEntries.push({
          projectName: cleanCanonicalText(`${entry.company || entry.role || "相关"}项目`, 90),
          role: entry.role,
          timeRange: entry.timeRange,
          bullets: [bullet]
        });
      } else {
        keptBullets.push(bullet);
      }
    });

    return [{ ...entry, bullets: normalizeCanonicalBullets(keptBullets, 6) }];
  });

  const projectExperience = buildStructuredProjectExperience([
    ...existingProjectEntries,
    ...movedProjectEntries.map((entry, index) => ({ id: `moved_project_${index + 1}`, ...entry }))
  ]);

  const selfSummary = cleanCanonicalText(structured.summary || structured.selfSummary || "", 220);
  const safeSelfSummary = !selfSummary || isPersonalInfoLine(selfSummary) || hasFallbackText(selfSummary)
    ? "具备执行推进、沟通协调与文档整理能力，能在真实业务场景中快速学习并稳定落地。"
    : selfSummary;

  return {
    ...structured,
    workExperience,
    projectExperience,
    selfSummary: safeSelfSummary,
    summary: safeSelfSummary,
    experience: workExperience.flatMap((entry) => entry.bullets || []),
    projects: projectExperience.flatMap((entry) => entry.bullets || []),
    educationItems: buildStructuredEducation(structured.educationItems || structured.education || []),
    skills: extractCanonicalSkillTokens(structured.skills || [])
  };
}

module.exports = {
  SKILL_RULESET_ID,
  SECTION_KEYS,
  HEADING_PATTERNS,
  normalizeResumeAuditText,
  truncateResumeAuditText,
  splitAuditLines,
  containsHeading,
  hasSectionHeading,
  classifyResumeEntry,
  extractTimeRange,
  parseWorkHeader,
  parseProjectHeader,
  parseEducationHeader,
  buildStructuredWorkExperience,
  buildStructuredProjectExperience,
  buildStructuredEducation,
  extractCanonicalSkillTokens,
  normalizeResumeData,
  hasFallbackText,
  hasProjectSignals,
  isWorkLine,
  isProjectLine,
  isSkillToken,
  isPersonalInfoLine,
  isEducationLine,
  isSelfSummaryLine
};



