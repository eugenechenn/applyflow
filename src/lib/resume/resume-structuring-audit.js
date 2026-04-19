"use strict";

const SKILL_RULESET_ID = "resume-structuring-audit.v5";

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

const COMPANY_HINT_PATTERN =
  /(公司|有限公司|集团|科技|管理|教育|咨询|银行|财富|传媒|通信|中心|研究院|PCCW|Inc|Ltd|Corporation)/i;
const ROLE_HINT_PATTERN =
  /(助理|经理|运营|分析|专员|顾问|实习|协调|项目|产品|客户|主管|组长|负责人|咨询顾问|项目管理助理|客户关系|业务协同|PM|analyst|manager|lead|intern)/i;
const PROJECT_HINT_PATTERN =
  /(项目|方案|系统|搭建|优化|诊断|课题|小组|研究|落地|流程|企业诊断)/i;
const SCHOOL_HINT_PATTERN = /(大学|学院|学校|university|college|school)/i;
const DEGREE_HINT_PATTERN = /(本科|硕士|博士|MBA|学士|专业|学历|学位|毕业)/i;
const SUMMARY_HINT_PATTERN =
  /(逻辑思维|商业视角|沟通协调|团队协作|学习能力|执行力|分析能力|文字功底|英语水平|责任心|抗压|适应能力)/i;
const SKILL_TEXT_PATTERN =
  /(sql|python|excel|power bi|tableau|figma|notion|jira|agent|llm|ai|数据分析|流程梳理|文档整理|沟通协调|团队协作)/i;

const TIME_RANGE_PATTERN =
  /((?:19|20)\d{2}[./-]\d{1,2}\s*(?:[-—–至~]\s*(?:(?:19|20)\d{2}[./-]\d{1,2}|至今|现在|Present))?)/;

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

function looksLikeSentence(text = "") {
  const value = String(text || "").trim();
  return /[，。；;！？]/.test(value) || value.length > 80;
}

function isPersonalInfoLine(text = "") {
  const value = String(text || "").trim();
  if (!value) return false;
  return (
    /(姓名|电话|手机|邮箱|微信|城市|所在地|现居地|籍贯|出生年月)[:：]?/i.test(value) ||
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value) ||
    /(?:\+?86[-\s]?)?1[3-9]\d{9}/.test(value)
  );
}

function isEducationLine(text = "") {
  const value = String(text || "").trim();
  if (!value) return false;
  return (
    (SCHOOL_HINT_PATTERN.test(value) && DEGREE_HINT_PATTERN.test(value)) ||
    (TIME_RANGE_PATTERN.test(value) && SCHOOL_HINT_PATTERN.test(value) && DEGREE_HINT_PATTERN.test(value))
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
  if (isPersonalInfoLine(value) || isEducationLine(value) || isWorkLine(value) || isProjectLine(value)) {
    return false;
  }
  return SUMMARY_HINT_PATTERN.test(value) || looksLikeSentence(value);
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
    .replace(/[—–至~]/g, "-")
    .replace(/\s+/g, "")
    .replace(/(\d{4})\.(\d)(?!\d)/g, "$1.0$2");
}

function extractTimeRange(value = "") {
  const match = String(value || "").match(TIME_RANGE_PATTERN);
  return match ? normalizeTimeRange(match[1]) : "";
}

function removeTimeRange(value = "") {
  return normalizeResumeAuditText(String(value || "").replace(TIME_RANGE_PATTERN, ""));
}

function splitRoleTail(text = "") {
  return String(text || "")
    .split(/\s+(?=主导|负责|统筹|参与|推进|搭建|制定|输出|建立)/)[0]
    .trim();
}

function parseWorkHeader(header = "") {
  const timeRange = extractTimeRange(header);
  const rest = removeTimeRange(header);
  if (!rest) return { company: "", role: "", timeRange };

  const explicitMatch = rest.match(
    /^(.*?(?:有限公司|公司|集团|科技|管理|教育|咨询|银行|财富|传媒|通信|中心|研究院|PCCW|Inc|Ltd))\s+(.+)$/
  );
  if (explicitMatch) {
    return {
      company: explicitMatch[1].trim(),
      role: splitRoleTail(explicitMatch[2]),
      timeRange
    };
  }

  const tokens = rest.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    return {
      company: tokens.slice(0, -1).join(" ").trim(),
      role: splitRoleTail(tokens.slice(-1).join(" ").trim()),
      timeRange
    };
  }

  return {
    company: rest,
    role: "",
    timeRange
  };
}

function parseProjectHeader(header = "") {
  const timeRange = extractTimeRange(header);
  const rest = removeTimeRange(header);
  if (!rest) return { projectName: "", role: "", timeRange };

  const tokens = rest.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const tail = tokens[tokens.length - 1];
    const roleSplitMatch = tail.match(/^(.*?)(组长|负责人|成员|顾问|助理|Leader|lead|owner|PM)$/i);
    if (roleSplitMatch) {
      const rolePrefix = roleSplitMatch[1].trim();
      const role = roleSplitMatch[2];
      return {
        projectName: [...tokens.slice(0, -1), rolePrefix].filter(Boolean).join(" ").trim(),
        role,
        timeRange
      };
    }
  }

  return {
    projectName: rest,
    role: "",
    timeRange
  };
}

function parseEducationHeader(header = "") {
  const timeRange = extractTimeRange(header);
  const rest = removeTimeRange(header)
    .split(/\s+(?=主修|辅修|核心课程)/)[0]
    .trim();
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    return {
      school: tokens[0],
      major: tokens.slice(1).join(" ").trim(),
      timeRange
    };
  }
  return {
    school: rest,
    major: "",
    timeRange
  };
}

function sanitizeBullets(bullets = [], max = 6) {
  return (Array.isArray(bullets) ? bullets : [])
    .map((item) => truncateResumeAuditText(item, 220))
    .filter(Boolean)
    .filter((item) => !isPersonalInfoLine(item))
    .filter((item) => !isEducationLine(item))
    .filter((item) => !hasSectionHeading(item))
    .slice(0, max);
}

function buildStructuredWorkExperience(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const header = normalizeResumeAuditText(entry.header || entry);
      const parsed = parseWorkHeader(header);
      if (!parsed.company && !parsed.role) return null;
      return {
        id: entry.id || `work_${index + 1}`,
        company: parsed.company,
        role: parsed.role,
        timeRange: parsed.timeRange,
        bullets: sanitizeBullets(entry.bullets || []),
        displayTitle: [parsed.company, parsed.role].filter(Boolean).join(" / ")
      };
    })
    .filter(Boolean)
    .filter((item) => item.company || item.role);
}

function buildStructuredProjectExperience(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const header = normalizeResumeAuditText(entry.header || entry);
      const parsed = parseProjectHeader(header);
      if (!parsed.projectName && !parsed.role) return null;
      return {
        id: entry.id || `project_${index + 1}`,
        projectName: parsed.projectName,
        name: parsed.projectName,
        role: parsed.role,
        timeRange: parsed.timeRange,
        bullets: sanitizeBullets(entry.bullets || []),
        displayTitle: [parsed.projectName, parsed.role].filter(Boolean).join(" / ")
      };
    })
    .filter(Boolean)
    .filter((item) => item.projectName || item.role);
}

function buildStructuredEducation(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const header = normalizeResumeAuditText(entry.header || entry);
      const parsed = parseEducationHeader(header);
      if (!parsed.school && !parsed.major) return null;
      return {
        id: entry.id || `education_${index + 1}`,
        school: parsed.school,
        major: parsed.major,
        timeRange: parsed.timeRange,
        displayTitle: [parsed.school, parsed.major].filter(Boolean).join(" / ")
      };
    })
    .filter(Boolean);
}

function extractCanonicalSkillTokens(lines = []) {
  const items = Array.isArray(lines) ? lines : [lines];
  const tokens = [];
  items.forEach((line) => {
    String(line || "")
      .split(/[,/|、，\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => {
        if (isSkillToken(item) && !tokens.includes(item)) tokens.push(item);
      });
  });
  return tokens.slice(0, 12);
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
  isWorkLine,
  isProjectLine,
  isSkillToken,
  isPersonalInfoLine,
  isEducationLine,
  isSelfSummaryLine
};
