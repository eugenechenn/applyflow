"use strict";

const PROFILE_KEY = "applyflow_profile_bundle";
const CONTENT_SCRIPT_SCHEMA_VERSION = "2026.04.23.5";
const TARGET_FIELDS = [
  "full_name",
  "email",
  "phone",
  "gender",
  "school_name",
  "first_school_name",
  "degree",
  "major",
  "first_major",
  "birth_date",
  "bachelor_start_date",
  "bachelor_end_date",
  "master_start_date",
  "master_end_date",
  "language_exam_language",
  "language_exam_level",
  "language_name",
  "english_proficiency",
  "english_score",
  "certificate_name",
  "achievement_score",
  "summary"
];
const SUPPORTED_CONTROL_TYPES = new Set(["plain_input", "textarea", "searchable_select", "date_picker", "radio_group"]);

const APPLYFLOW_HOST_PATTERNS = [
  /applyflow-staging\.applyflow-eugene\.workers\.dev$/i,
  /applyflow-eugene\.workers\.dev$/i,
  /localhost$/i,
  /127\.0\.0\.1$/i
];

const FIELD_PATTERNS = {
  full_name: [/full.?name/i, /\bname\b/i, /\u59d3\u540d/i, /first.?name/i, /last.?name/i],
  email: [/e-?mail/i, /\u90ae\u7bb1/i],
  phone: [/phone/i, /mobile/i, /tel/i, /\u7535\u8bdd/i, /\u624b\u673a/i, /\u79fb\u52a8\u7535\u8bdd/i],
  gender: [/gender/i, /sex/i, /\u6027\u522b/i],
  school_name: [/school/i, /university/i, /college/i, /\u5b66\u6821/i, /\u9662\u6821/i, /\u6bd5\u4e1a\u9662\u6821/i],
  first_school_name: [
    /\u7b2c\u4e00\u5b66\u5386\u6bd5\u4e1a\u9662\u6821/i,
    /\u7b2c\u4e00\u5b66\u5386\u5b66\u6821/i,
    /first.?school/i,
    /first.?university/i,
    /\u672c\u79d1\u9662\u6821/i
  ],
  degree: [
    /degree/i,
    /education.?level/i,
    /highest.?degree/i,
    /highest.?education/i,
    /academic.?degree/i,
    /\u5b66\u5386/i,
    /\u5b66\u4f4d/i,
    /\u6700\u9ad8\u5b66\u5386/i,
    /\u6700\u9ad8\u5b66\u4f4d/i,
    /\u7b2c\u4e00\u5b66\u5386/i,
    /\u7b2c\u4e00\u5b66\u4f4d/i,
    /first.?degree/i
  ],
  major: [/major/i, /specialty/i, /\u4e13\u4e1a/i, /\u7814\u7a76\u65b9\u5411/i],
  first_major: [/\u7b2c\u4e00\u5b66\u5386\u4e13\u4e1a/i, /\u672c\u79d1\u4e13\u4e1a/i, /first.?major/i, /\u7b2c\u4e00\u5b66\u4f4d\u4e13\u4e1a/i],
  birth_date: [/birth/i, /birthday/i, /date.?of.?birth/i, /\u51fa\u751f\u65e5\u671f/i, /\u51fa\u751f/i],
  bachelor_start_date: [/\u672c\u79d1\u5f00\u59cb\u65f6\u95f4/i, /\u672c\u79d1\u5165\u5b66\u65f6\u95f4/i, /bachelor.?start/i, /\u5f00\u59cb\u65f6\u95f4/i, /start.?date/i],
  bachelor_end_date: [/\u672c\u79d1\u7ed3\u675f\u65f6\u95f4/i, /\u672c\u79d1\u6bd5\u4e1a\u65f6\u95f4/i, /bachelor.?end/i, /\u7ed3\u675f\u65f6\u95f4/i, /end.?date/i],
  master_start_date: [/\u7814\u7a76\u751f\u5f00\u59cb\u65f6\u95f4/i, /\u7855\u58eb\u5f00\u59cb\u65f6\u95f4/i, /master.?start/i, /graduate.?start/i],
  master_end_date: [/\u7814\u7a76\u751f\u7ed3\u675f\u65f6\u95f4/i, /\u7855\u58eb\u6bd5\u4e1a\u65f6\u95f4/i, /master.?end/i, /graduate.?end/i],
  language_exam_language: [/language.?exam.?language/i, /exam.?language/i, /cet.?language/i, /\u8bed\u8a00\u7b49\u7ea7\u8bed\u79cd/i, /\u8bed\u79cd/i],
  language_exam_level: [/language.?exam.?level/i, /exam.?level/i, /language.?level/i, /\u8bed\u8a00\u7b49\u7ea7/i, /\u82f1\u8bed\u7b49\u7ea7/i, /\u7b49\u7ea7/i],
  language_name: [/language/i, /\u8bed\u79cd/i],
  english_proficiency: [/english.?proficiency/i, /english.?level/i, /\u82f1\u8bed\u6c34\u5e73/i],
  english_score: [/english.?score/i, /cet/i, /toefl/i, /ielts/i, /\u82f1\u8bed\u7b49\u7ea7\/?\u5206\u6570/i, /\u6210\u7ee9\u5f97\u5206/i],
  certificate_name: [/\u8bc1\u4e66\u540d\u79f0/i, /certificate.?name/i, /\u8bc1\u4e66/i],
  achievement_score: [/\u6210\u7ee9\u5f97\u5206/i, /\u5206\u6570/i, /achievement.?score/i, /score/i],
  summary: [/summary/i, /about/i, /profile/i, /self.?intro/i, /\u4e2a\u4eba\u4ecb\u7ecd/i, /\u81ea\u6211\u4ecb\u7ecd/i, /subject/i, /\u81ea\u6211\u8bc4\u4ef7/i]
};

const SEMANTIC_SLOT_DEFINITIONS = [
  { slot: "profile.full_name", aliases: [/full.?name/i, /\u59d3\u540d/i, /\u771f\u5b9e\u59d3\u540d/i] },
  { slot: "profile.email", aliases: [/e-?mail/i, /\u90ae\u7bb1/i] },
  { slot: "profile.phone", aliases: [/phone/i, /mobile/i, /tel/i, /\u7535\u8bdd/i, /\u624b\u673a/i, /\u79fb\u52a8\u7535\u8bdd/i] },
  { slot: "profile.gender", aliases: [/gender/i, /sex/i, /\u6027\u522b/i] },
  { slot: "profile.birth_date", aliases: [/birth/i, /birthday/i, /\u51fa\u751f\u65e5\u671f/i, /\u51fa\u751f/i] },

  {
    slot: "education.first.school_name",
    aliases: [
      /\u7b2c\u4e00\u5b66\u5386\u6bd5\u4e1a\u9662\u6821/i,
      /\u7b2c\u4e00\u5b66\u5386\u5b66\u6821/i,
      /\u7b2c\u4e00\u5b66\u4f4d\u6bd5\u4e1a\u9662\u6821/i,
      /first.?school/i
    ]
  },
  {
    slot: "education.first.major",
    aliases: [
      /\u7b2c\u4e00\u5b66\u5386\u4e13\u4e1a/i,
      /\u7b2c\u4e00\u5b66\u4f4d\u4e13\u4e1a/i,
      /\u8bf7\u9009\u62e9\u4e13\u4e1a/i,
      /\u4e13\u4e1a\u540d\u79f0/i,
      /first.?major/i
    ]
  },
  {
    slot: "education.highest.degree",
    aliases: [
      /\u6700\u9ad8\u5b66\u5386/i,
      /\u6700\u9ad8\u5b66\u4f4d/i,
      /\u5b66\u5386/i,
      /\u5b66\u4f4d/i,
      /highest.?degree/i,
      /highest.?education/i,
      /degree/i
    ]
  },
  { slot: "education.highest.school_name", aliases: [/\u6bd5\u4e1a\u9662\u6821/i, /\u5b66\u6821/i, /school/i, /university/i, /college/i] },
  { slot: "education.highest.major", aliases: [/\u4e13\u4e1a/i, /major/i, /specialty/i] },

  {
    slot: "education.bachelor.start_date",
    aliases: [/\u672c\u79d1\u5f00\u59cb\u65f6\u95f4/i, /\u672c\u79d1\u5165\u5b66\u65f6\u95f4/i, /\u53c2\u52a0\u5de5\u4f5c\u65e5\u671f/i, /bachelor.?start/i]
  },
  { slot: "education.bachelor.end_date", aliases: [/\u672c\u79d1\u7ed3\u675f\u65f6\u95f4/i, /\u672c\u79d1\u6bd5\u4e1a\u65f6\u95f4/i, /bachelor.?end/i] },
  { slot: "education.master.start_date", aliases: [/\u7855\u58eb\u5f00\u59cb\u65f6\u95f4/i, /\u7814\u7a76\u751f\u5f00\u59cb\u65f6\u95f4/i, /master.?start/i] },
  { slot: "education.master.end_date", aliases: [/\u7855\u58eb\u7ed3\u675f\u65f6\u95f4/i, /\u7814\u7a76\u751f\u6bd5\u4e1a\u65f6\u95f4/i, /master.?end/i] }
];

const SEMANTIC_SLOT_TO_FIELD = {
  "profile.full_name": "full_name",
  "profile.email": "email",
  "profile.phone": "phone",
  "profile.gender": "gender",
  "profile.birth_date": "birth_date",
  "education.highest.degree": "degree",
  "education.highest.school_name": "school_name",
  "education.highest.major": "major",
  "education.first.school_name": "first_school_name",
  "education.first.major": "first_major",
  "education.bachelor.start_date": "bachelor_start_date",
  "education.bachelor.end_date": "bachelor_end_date",
  "education.master.start_date": "master_start_date",
  "education.master.end_date": "master_end_date"
};

const FIELD_TO_SEMANTIC_SLOT = Object.entries(SEMANTIC_SLOT_TO_FIELD).reduce((acc, [slot, field]) => {
  acc[field] = slot;
  return acc;
}, {});

const PASSIVE_ARRAY_MODULES = {
  education: {
    dataKey: "education",
    sectionPatterns: [/\u6559\u80b2\u7ecf\u5386/i, /education/i, /\u5b66\u5386/i, /\u5b66\u4f4d/i],
    fields: [
      { key: "school_name", controlTypes: ["searchable_select", "plain_input"], patterns: [/\u5b66\u6821/i, /\u9662\u6821/i, /\u6bd5\u4e1a\u9662\u6821/i, /school/i, /university/i, /college/i] },
      { key: "major", controlTypes: ["searchable_select", "plain_input"], patterns: [/\u4e13\u4e1a/i, /major/i, /specialty/i] },
      { key: "degree", controlTypes: ["searchable_select", "plain_input"], patterns: [/\u5b66\u5386/i, /\u5b66\u4f4d/i, /\u6700\u9ad8\u5b66\u5386/i, /\u6700\u9ad8\u5b66\u4f4d/i, /degree/i, /education/i] },
      { key: "start_date", controlTypes: ["date_picker", "plain_input"], patterns: [/\u5f00\u59cb\u65f6\u95f4/i, /start/i, /from/i, /\u5165\u5b66/i] },
      { key: "end_date", controlTypes: ["date_picker", "plain_input"], patterns: [/\u7ed3\u675f\u65f6\u95f4/i, /\u6bd5\u4e1a/i, /end/i, /to/i] }
    ]
  },
  work_experience: {
    dataKey: "work_experience",
    sectionPatterns: [/\u5de5\u4f5c\u7ecf\u5386/i, /work/i, /employment/i, /\u804c\u4e1a/i],
    fields: [
      { key: "company_name", controlTypes: ["searchable_select", "plain_input"], patterns: [/\u516c\u53f8/i, /\u5355\u4f4d/i, /company/i, /employer/i] },
      { key: "job_title", controlTypes: ["searchable_select", "plain_input"], patterns: [/\u5c97\u4f4d/i, /\u804c\u4f4d/i, /\u804c\u52a1/i, /title/i, /position/i, /role/i] },
      { key: "work_description", sourceKeys: ["work_description", "description"], controlTypes: ["textarea", "plain_input"], patterns: [/\u5de5\u4f5c\u5185\u5bb9/i, /\u804c\u8d23/i, /\u63cf\u8ff0/i, /description/i, /responsibilit/i] },
      { key: "start_date", controlTypes: ["date_picker", "plain_input"], patterns: [/\u5f00\u59cb\u65f6\u95f4/i, /\u5165\u804c/i, /start/i, /from/i] },
      { key: "end_date", controlTypes: ["date_picker", "plain_input"], patterns: [/\u7ed3\u675f\u65f6\u95f4/i, /\u79bb\u804c/i, /end/i, /to/i] }
    ]
  },
  project_experience: {
    dataKey: "project_experience",
    sectionPatterns: [/\u9879\u76ee\u7ecf\u5386/i, /project/i],
    fields: [
      { key: "project_name", controlTypes: ["searchable_select", "plain_input"], patterns: [/\u9879\u76ee\u540d\u79f0/i, /\u9879\u76ee/i, /project/i] },
      { key: "role", controlTypes: ["searchable_select", "plain_input"], patterns: [/\u89d2\u8272/i, /\u804c\u8d23/i, /role/i, /position/i] },
      { key: "project_description", sourceKeys: ["project_description", "description"], controlTypes: ["textarea", "plain_input"], patterns: [/\u63cf\u8ff0/i, /\u9879\u76ee\u7b80\u4ecb/i, /description/i, /summary/i] },
      { key: "start_date", controlTypes: ["date_picker", "plain_input"], patterns: [/\u5f00\u59cb\u65f6\u95f4/i, /start/i, /from/i] },
      { key: "end_date", controlTypes: ["date_picker", "plain_input"], patterns: [/\u7ed3\u675f\u65f6\u95f4/i, /end/i, /to/i] }
    ]
  },
  family: {
    dataKey: "family",
    sectionPatterns: [/\u5bb6\u5ead/i, /family/i],
    fields: [
      { key: "name", controlTypes: ["plain_input"], patterns: [/\u59d3\u540d/i, /name/i] },
      { key: "relation", controlTypes: ["searchable_select", "plain_input"], patterns: [/\u5173\u7cfb/i, /relation/i] },
      { key: "employer", controlTypes: ["plain_input"], patterns: [/\u5de5\u4f5c\u5355\u4f4d/i, /\u5355\u4f4d/i, /employer/i, /company/i] },
      { key: "position", controlTypes: ["plain_input"], patterns: [/\u804c\u4f4d/i, /\u804c\u52a1/i, /position/i, /title/i] }
    ]
  }
};

function isApplyFlowHost(hostname = "") {
  return APPLYFLOW_HOST_PATTERNS.some((pattern) => pattern.test(hostname || ""));
}

function asText(value = "") {
  return String(value || "").trim();
}

function parseArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function textOf(el) {
  return String(el?.textContent || "").trim();
}

function compactText(value = "", max = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? text.slice(0, max) : text;
}

function collectNearbyLabelHints(el) {
  const hints = [];
  const containers = [
    el?.closest?.("label"),
    el?.closest?.(".form-item"),
    el?.closest?.(".field"),
    el?.closest?.(".input-item"),
    el?.closest?.(".ant-form-item"),
    el?.closest?.(".el-form-item"),
    el?.closest?.(".arco-form-item"),
    el?.closest?.(".ivu-form-item"),
    el?.closest?.(".n-form-item"),
    el?.closest?.(".van-field"),
    el?.closest?.(".weui-cell")
  ].filter(Boolean);

  containers.forEach((node) => {
    hints.push(compactText(textOf(node)));
    const labelLike = node.querySelector?.(
      "label, .label, .form-label, .ant-form-item-label, .el-form-item__label, .arco-form-item-label"
    );
    hints.push(compactText(textOf(labelLike)));
  });

  let sibling = el?.previousElementSibling;
  let depth = 0;
  while (sibling && depth < 2) {
    hints.push(compactText(textOf(sibling)));
    sibling = sibling.previousElementSibling;
    depth += 1;
  }

  const parentPrevious = el?.parentElement?.previousElementSibling;
  if (parentPrevious) {
    hints.push(compactText(textOf(parentPrevious)));
  }

  return hints.filter(Boolean);
}

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom >= 0 &&
    rect.right >= 0
  );
}

function getElementHints(el) {
  const attrs = ["name", "id", "placeholder", "aria-label", "data-testid", "autocomplete"]
    .map((key) => asText(el?.getAttribute?.(key)))
    .filter(Boolean);
  const label = (el?.labels && el.labels[0] && textOf(el.labels[0])) || textOf(el?.closest?.("label")) || "";
  const nearby = collectNearbyLabelHints(el);
  return [label, ...attrs, ...nearby].filter(Boolean).join(" ").toLowerCase();
}

function hasSelectAffordance(el) {
  if (!el) return false;
  const parent = el.parentElement;
  const host = el.closest?.(".select, .selector, .dropdown, .picker, .combobox, .ant-select, .el-select");
  if (host) return true;
  if (el.hasAttribute?.("aria-expanded") || el.hasAttribute?.("aria-controls")) return true;
  if (el.getAttribute?.("aria-haspopup")) return true;
  if (el.readOnly) return true;
  const siblings = [
    parent?.querySelector?.(".icon, .suffix, .arrow, [role='button'], button, i"),
    el.nextElementSibling,
    parent?.nextElementSibling
  ].filter(Boolean);
  return siblings.some((node) => {
    const text = normalizeForMatch(textOf(node));
    const cls = normalizeForMatch(asText(node.className));
    return /arrow|icon|select|picker|dropdown|caret/.test(cls) || /请选择|下拉|展开/.test(text);
  });
}

function scoreHintForField(hint = "", field = "") {
  const patterns = FIELD_PATTERNS[field] || [];
  if (!hint || !patterns.length) return 0;
  let score = 0;
  patterns.forEach((pattern) => {
    if (pattern.test(hint)) {
      score += 10;
    }
  });
  return score;
}

function scoreHintForSlot(hint = "", slot = "") {
  const def = SEMANTIC_SLOT_DEFINITIONS.find((item) => item.slot === slot);
  const patterns = def?.aliases || [];
  if (!hint || !patterns.length) return 0;
  let score = 0;
  patterns.forEach((pattern) => {
    if (pattern.test(hint)) {
      score += 12;
    }
  });
  return score;
}

function inferSemanticSlotFromHint(hint = "") {
  if (!hint) return { slot: "", score: 0 };
  const normalizedHint = normalizeForMatch(hint);
  const hasFirstToken = /(\u7b2c\u4e00|first|first-degree|firstdegree)/i.test(normalizedHint);
  const hasHighestToken = /(\u6700\u9ad8|highest|top|max)/i.test(normalizedHint);
  const hasBachelorToken = /(\u672c\u79d1|bachelor|undergraduate)/i.test(normalizedHint);
  const hasMasterToken = /(\u7855\u58eb|\u7814\u7a76\u751f|master|graduate)/i.test(normalizedHint);
  let bestSlot = "";
  let bestScore = 0;
  SEMANTIC_SLOT_DEFINITIONS.forEach((def) => {
    let score = scoreHintForSlot(hint, def.slot);
    if (!score) return;
    if (hasFirstToken) {
      if (def.slot.startsWith("education.first.")) score += 15;
      if (def.slot.startsWith("education.highest.")) score -= 8;
    }
    if (hasHighestToken) {
      if (def.slot.startsWith("education.highest.")) score += 15;
      if (def.slot.startsWith("education.first.")) score -= 6;
    }
    if (hasBachelorToken) {
      if (def.slot.startsWith("education.bachelor.")) score += 12;
      if (def.slot.startsWith("education.master.")) score -= 6;
    }
    if (hasMasterToken) {
      if (def.slot.startsWith("education.master.")) score += 12;
      if (def.slot.startsWith("education.bachelor.")) score -= 6;
    }
    if (score > bestScore) {
      bestSlot = def.slot;
      bestScore = score;
    }
  });
  return { slot: bestSlot, score: bestScore };
}

function inferFieldKey(el) {
  const hint = getElementHints(el);
  if (!hint) return { key: "", score: 0, hint };
  const slotResult = inferSemanticSlotFromHint(hint);
  if (slotResult.slot && slotResult.score > 0) {
    const slotField = SEMANTIC_SLOT_TO_FIELD[slotResult.slot] || "";
    if (slotField) {
      return { key: slotField, score: slotResult.score, hint, semanticSlot: slotResult.slot };
    }
  }
  let bestKey = "";
  let bestScore = 0;
  Object.keys(FIELD_PATTERNS).forEach((field) => {
    const score = scoreHintForField(hint, field);
    if (score > bestScore) {
      bestKey = field;
      bestScore = score;
    }
  });
  return { key: bestKey, score: bestScore, hint, semanticSlot: FIELD_TO_SEMANTIC_SLOT[bestKey] || "" };
}

function classifyControlType(el) {
  if (!el) return "not_found";
  const tag = String(el.tagName || "").toLowerCase();
  const type = asText(el.getAttribute?.("type")).toLowerCase();
  const role = asText(el.getAttribute?.("role")).toLowerCase();
  const isContentEditable = el.isContentEditable || asText(el.getAttribute?.("contenteditable")).toLowerCase() === "true";
  const hint = getElementHints(el);
  const parentCombobox = el.closest?.("[role='combobox'], .ant-select, .el-select, .arco-select, .ivu-select, .n-base-selection");
  const hasPopup = asText(el.getAttribute?.("aria-haspopup")).toLowerCase();
  const className = asText(el.className).toLowerCase();
  const parentClassName = asText(el.parentElement?.className).toLowerCase();
  const mergedClassName = `${className} ${parentClassName}`;
  const isSelectLikeHint =
    /(degree|major|school|university|college|education|language|english|exam|level|\u5b66\u5386|\u5b66\u4f4d|\u5b66\u6821|\u4e13\u4e1a|\u8bed\u79cd|\u82f1\u8bed|\u7b49\u7ea7)/i.test(
      hint
    );
  const isDateLike = /(\u51fa\u751f|\u65e5\u671f|\u5f00\u59cb\u65f6\u95f4|\u7ed3\u675f\u65f6\u95f4|\u8d77\u6b62|date|birth|start|end|month)/i.test(
    hint
  );

  if (tag === "input" && type === "radio") return "radio_group";
  if (isContentEditable) return "rich_text_like";
  if (tag === "textarea") return "textarea";
  if (tag === "input" && ["date", "datetime-local", "month", "week", "time"].includes(type)) return "date_picker";
  if (tag === "input" && isDateLike && (el.readOnly || /date|calendar|picker/.test(mergedClassName))) return "date_picker";
  if (tag === "input" && (hasPopup === "listbox" || hasPopup === "dialog")) return "searchable_select";
  if (tag === "input" && isSelectLikeHint && hasSelectAffordance(el)) {
    return isDateLike ? "date_picker" : "searchable_select";
  }
  if (
    tag === "input" &&
    /(major|\u4e13\u4e1a|degree|\u5b66\u4f4d|\u5b66\u5386|school|\u5b66\u6821|\u9662\u6821)/i.test(hint) &&
    hasSelectAffordance(el)
  ) {
    return "searchable_select";
  }
  if (tag === "input" && /select|picker|dropdown/.test(mergedClassName) && /text|search/.test(type || "text")) {
    return isDateLike ? "date_picker" : "searchable_select";
  }
  if (tag === "input" && parentCombobox) return "searchable_select";
  if (tag === "select" || role === "combobox") return "searchable_select";
  if (tag === "input") return "plain_input";
  return "rich_text_like";
}

function collectFieldCandidates() {
  const selector =
    "input:not([type='hidden']):not([type='checkbox']), textarea, select, [role='combobox'], [contenteditable='true']";
  const elements = Array.from(document.querySelectorAll(selector)).filter(isVisible);
  const map = Object.fromEntries(TARGET_FIELDS.map((field) => [field, []]));

  elements.forEach((el) => {
    const inferred = inferFieldKey(el);
    const key = inferred.key;
    if (!key || !map[key] || inferred.score <= 0) return;
    map[key].push({
      element: el,
      controlType: classifyControlType(el),
      hint: inferred.hint,
      matchScore: inferred.score
    });
  });

  return map;
}

function computeSupportLevel(recognizedFieldCount, fillTargetCount) {
  if (recognizedFieldCount >= 4 && fillTargetCount >= 4) return "high";
  if (recognizedFieldCount >= 2 && fillTargetCount >= 2) return "medium";
  return "low";
}

function triggerInputEvents(el) {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}

function sleep(ms = 80) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNativeValueSetter(el) {
  if (!el) return null;
  const chain = [el, Object.getPrototypeOf(el), HTMLInputElement.prototype, HTMLTextAreaElement.prototype];
  for (const item of chain) {
    if (!item) continue;
    const descriptor = Object.getOwnPropertyDescriptor(item, "value");
    if (descriptor?.set) return descriptor.set;
  }
  return null;
}

function fillPlainInput(el, value) {
  if (!el || el.disabled) return false;
  const target = normalizeForMatch(value);
  const beforeValue = normalizeForMatch(asText(el.value || ""));
  if (beforeValue && target && (beforeValue.includes(target) || target.includes(beforeValue))) {
    return true;
  }
  const wasReadonly = Boolean(el.readOnly);
  el.focus();
  const setter = getNativeValueSetter(el);
  try {
    if (wasReadonly) {
      el.readOnly = false;
      el.removeAttribute?.("readonly");
    }
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
  } catch (_error) {
    if (wasReadonly) {
      el.readOnly = true;
      el.setAttribute?.("readonly", "readonly");
    }
    return false;
  }
  if (wasReadonly) {
    el.readOnly = true;
    el.setAttribute?.("readonly", "readonly");
  }
  triggerInputEvents(el);
  const finalValue = normalizeForMatch(asText(el.value));
  return Boolean(finalValue && target && (finalValue.includes(target) || target.includes(finalValue)));
}

function normalizeGenderValue(value = "") {
  const text = normalizeForMatch(value);
  if (!text) return "";
  if (/(^|\b)(male|man|\u7537)(\b|$)/i.test(text)) return "male";
  if (/(^|\b)(female|woman|\u5973)(\b|$)/i.test(text)) return "female";
  return "";
}

function fillRadioGroup(el, value) {
  const target = normalizeGenderValue(value);
  if (!target) {
    return { ok: false, status: "selector_mismatch", reason: "gender_value_not_supported" };
  }
  const container =
    el.closest?.("fieldset, .form-item, .field, .ant-form-item, .el-form-item, .arco-form-item, .ivu-form-item, .n-form-item") ||
    el.parentElement;
  let radios = Array.from((container || document).querySelectorAll("input[type='radio']")).filter(isVisible);
  if (!radios.length) {
    radios = Array.from(document.querySelectorAll("input[type='radio']")).filter(isVisible);
  }
  if (!radios.length) {
    return { ok: false, status: "not_found", reason: "radio_group_not_found" };
  }

  for (const radio of radios) {
    const hint = getElementHints(radio);
    const nextText = textOf(radio.nextElementSibling);
    const safeRadioId = radio.id && typeof CSS !== "undefined" && CSS.escape ? CSS.escape(radio.id) : radio.id;
    const labelByFor =
      (safeRadioId && textOf(document.querySelector(`label[for='${safeRadioId}']`))) || textOf(radio.closest("label"));
    const radioValue = normalizeGenderValue(`${asText(radio.value)} ${hint} ${labelByFor} ${nextText}`);
    if (radioValue !== target) continue;
    clickElement(radio);
    radio.focus?.();
    radio.checked = true;
    triggerInputEvents(radio);
    radio.dispatchEvent(new Event("click", { bubbles: true }));
    if (radio.checked) {
      return { ok: true, status: "filled", reason: "ok" };
    }
  }
  return { ok: false, status: "selector_mismatch", reason: "radio_option_not_matched" };
}

function normalizeForMatch(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeToken(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s_\-/.():\[\]{}]/g, "")
    .trim();
}

function expandFieldValues(field = "", value = "") {
  const raw = asText(value);
  if (!raw) return [];
  const tokens = new Set([raw]);
  const normalized = normalizeToken(raw);
  if (normalized) tokens.add(normalized);

  if (field === "language_exam_level" || field === "english_proficiency" || field === "english_score") {
    const map = [
      [/英语四级|cet4|cet-4/i, ["英语四级", "CET-4", "cet4", "cet-4"]],
      [/英语六级|cet6|cet-6/i, ["英语六级", "CET-6", "cet6", "cet-6"]],
      [/专业四级|tem4|tem-4/i, ["专业四级", "TEM-4", "tem4", "tem-4"]],
      [/专业八级|tem8|tem-8/i, ["专业八级", "TEM-8", "tem8", "tem-8"]],
      [/雅思|ielts/i, ["雅思", "IELTS", "ielts"]],
      [/托福|toefl/i, ["托福", "TOEFL", "toefl"]],
      [/托业|toeic/i, ["托业", "TOEIC", "toeic"]]
    ];
    map.forEach(([pattern, variants]) => {
      if (pattern.test(raw)) variants.forEach((v) => tokens.add(v));
    });
  }

  if (field === "degree") {
    const map = [
      [/高中/i, ["高中"]],
      [/大专|专科/i, ["大专", "专科"]],
      [/本科|学士/i, ["本科", "学士"]],
      [/硕士|研究生/i, ["硕士", "研究生", "硕士研究生"]],
      [/博士/i, ["博士", "博士研究生"]]
    ];
    map.forEach(([pattern, variants]) => {
      if (pattern.test(raw)) variants.forEach((v) => tokens.add(v));
    });
  }

  if (field === "major" || field === "first_major") {
    ["类", "专业", "方向"].forEach((suffix) => {
      if (raw.endsWith(suffix)) {
        tokens.add(raw.slice(0, -suffix.length));
      } else {
        tokens.add(`${raw}${suffix}`);
      }
    });
  }

  if (field === "school_name" || field === "first_school_name") {
    ["大学", "学院"].forEach((suffix) => {
      if (!raw.endsWith(suffix)) tokens.add(`${raw}${suffix}`);
    });
  }

  if (field === "gender") {
    if (/(male|man|男)/i.test(raw)) ["男", "male", "m", "1"].forEach((v) => tokens.add(v));
    if (/(female|woman|女)/i.test(raw)) ["女", "female", "f", "2"].forEach((v) => tokens.add(v));
  }

  return Array.from(tokens).filter(Boolean);
}

function normalizeDateValue(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const compact = raw.replace(/[./]/g, "-").replace(/\u5e74|\u6708/g, "-").replace(/\u65e5/g, "").replace(/\s+/g, "");
  const match = compact.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const year = match[1];
    const month = String(Number(match[2])).padStart(2, "0");
    const day = String(Number(match[3])).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (/^\d{8}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }
  return "";
}

function normalizeMonthValue(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const compact = raw.replace(/[./]/g, "-").replace(/\u5e74|\u6708/g, "-").replace(/\u65e5/g, "").replace(/\s+/g, "");
  const match = compact.match(/^(\d{4})-(\d{1,2})$/);
  if (match) {
    const year = match[1];
    const month = String(Number(match[2])).padStart(2, "0");
    return `${year}-${month}`;
  }
  if (/^\d{6}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(compact)) {
    return compact.slice(0, 7);
  }
  return "";
}

function isMonthField(field = "") {
  return ["bachelor_start_date", "bachelor_end_date", "master_start_date", "master_end_date"].includes(String(field || ""));
}

function fillDateLike(el, value, field = "") {
  const inputType = String(el?.getAttribute?.("type") || "").toLowerCase();
  const prefersMonth = inputType === "month" || isMonthField(field);
  const monthValue = normalizeMonthValue(value);
  const dateValue = normalizeDateValue(value);
  const normalized = prefersMonth ? monthValue || (dateValue ? dateValue.slice(0, 7) : "") : dateValue;
  if (!normalized) {
    return { ok: false, status: "selector_mismatch", reason: "invalid_date_value" };
  }

  const tag = String(el?.tagName || "").toLowerCase();
  if (tag !== "input") {
    return { ok: false, status: "partial_not_supported", reason: "date_picker_non_input" };
  }

  if (el.disabled) {
    return { ok: false, status: "unsupported_control", reason: "date_picker_disabled" };
  }

  const setter = getNativeValueSetter(el);
  const writeValue = prefersMonth && inputType === "date" ? `${normalized}-01` : normalized;
  const originalReadonly = el.readOnly;
  try {
    el.focus?.();
    if (originalReadonly) {
      el.readOnly = false;
      el.removeAttribute?.("readonly");
    }
    if (setter) {
      setter.call(el, writeValue);
    } else {
      el.value = writeValue;
    }
    triggerInputEvents(el);
  } catch (error) {
    if (originalReadonly) {
      el.readOnly = true;
      el.setAttribute?.("readonly", "readonly");
    }
    return { ok: false, status: "selector_mismatch", reason: "date_picker_setter_failed" };
  }
  if (originalReadonly) {
    el.readOnly = true;
    el.setAttribute?.("readonly", "readonly");
  }

  const rawFinalValue = asText(el.value || "");
  const finalValue = prefersMonth ? normalizeMonthValue(rawFinalValue) : normalizeDateValue(rawFinalValue);
  if (
    finalValue === normalized ||
    (prefersMonth && finalValue === writeValue.slice(0, 7)) ||
    normalizeToken(rawFinalValue).includes(normalizeToken(normalized))
  ) {
    return { ok: true, status: "filled", reason: "ok" };
  }
  return { ok: false, status: "partial_not_supported", reason: "date_picker_value_not_committed" };
}

function scoreOptionText(optionText = "", targetText = "") {
  const option = normalizeForMatch(optionText);
  const optionToken = normalizeToken(optionText);
  const target = normalizeForMatch(targetText);
  const targetToken = normalizeToken(targetText);
  if (!option || !target) return 0;
  if (option === target) return 100;
  if (optionToken && targetToken && optionToken === targetToken) return 95;
  if (option.startsWith(target)) return 80;
  if (option.includes(target)) return 60;
  if (optionToken && targetToken && optionToken.includes(targetToken)) return 58;
  const targetParts = target.split(" ").filter(Boolean);
  const hitCount = targetParts.filter((part) => option.includes(part)).length;
  if (!targetParts.length || !hitCount) return 0;
  return Math.round((hitCount / targetParts.length) * 40);
}

function readOptionText(node) {
  if (!node) return "";
  const aria = asText(node.getAttribute?.("aria-label"));
  if (aria) return aria;
  return textOf(node);
}

function collectVisibleOptionNodes() {
  const selectors = [
    "[role='option']",
    "li[role='option']",
    "li[data-option-index]",
    ".select-option",
    ".ant-select-item-option",
    ".el-select-dropdown__item",
    ".arco-select-option",
    ".ivu-select-item",
    ".n-base-select-option",
    ".dropdown-item",
    ".menu-item",
    "[data-value]",
    "[data-key]"
  ];
  const nodes = Array.from(document.querySelectorAll(selectors.join(","))).filter(isVisible);
  const dedup = [];
  const seen = new Set();
  nodes.forEach((node) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    dedup.push(node);
  });
  return dedup;
}

function findActiveDialogNode() {
  const containers = Array.from(
    document.querySelectorAll(
      "[role='dialog'], .ant-modal, .el-dialog, .arco-modal, .ivu-modal, .n-modal, .modal, .layui-layer, .dialog"
    )
  ).filter(isVisible);
  if (!containers.length) return null;
  return containers
    .slice()
    .sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
}

function collectDialogOptionNodes(dialogNode) {
  if (!dialogNode) return [];
  const nodes = Array.from(
    dialogNode.querySelectorAll(
      "[role='option'], li, .option, .list-item, .menu-item, .dropdown-item, button, a, [data-value], [data-key]"
    )
  ).filter((node) => {
    if (!isVisible(node)) return false;
    const tag = String(node.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(tag)) return false;
    const text = normalizeForMatch(readOptionText(node));
    if (!text) return false;
    if (text.length > 64) return false;
    return true;
  });
  return nodes;
}

function clickConfirmButton(dialogNode) {
  if (!dialogNode) return false;
  const candidates = Array.from(dialogNode.querySelectorAll("button, [role='button'], a")).filter(isVisible);
  const confirm = candidates.find((node) => /^(选择|确定|确认|ok|yes)$/i.test(normalizeForMatch(textOf(node))));
  if (!confirm) return false;
  clickElement(confirm);
  return true;
}

async function fillViaDialogFallback(triggerEl, value, field = "", options = {}) {
  const desiredValues = expandFieldValues(field, value);
  if (!desiredValues.length) return false;
  const trigger = resolveSearchInput(triggerEl) || triggerEl;
  if (options.allowScroll !== false) {
    trigger.scrollIntoView?.({ block: "center", inline: "nearest" });
  }
  trigger.focus?.();
  clickElement(trigger);
  await sleep(120);

  const dialog = findActiveDialogNode();
  if (!dialog) return false;

  const dialogInput = resolveSearchInput(dialog);
  if (dialogInput) {
    if ("value" in dialogInput) {
      dialogInput.value = "";
      triggerInputEvents(dialogInput);
      await sleep(50);
      dialogInput.value = desiredValues[0];
      triggerInputEvents(dialogInput);
    } else if (dialogInput.isContentEditable) {
      dialogInput.textContent = desiredValues[0];
      triggerInputEvents(dialogInput);
    }
    await sleep(120);
  }

  let bestNode = null;
  let bestScore = 0;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1800) {
    const optionNodes = collectDialogOptionNodes(dialog);
    const best = chooseBestOptionNode(optionNodes, desiredValues);
    if (best?.best && best.bestScore > 0) {
      bestNode = best.best;
      bestScore = best.bestScore;
      break;
    }
    await sleep(120);
  }

  if (!bestNode || bestScore <= 0) return false;
  bestNode.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  clickElement(bestNode);
  await sleep(100);
  clickConfirmButton(dialog);
  await sleep(120);
  return true;
}

function chooseBestOptionNode(optionNodes = [], desiredValues = []) {
  const values = Array.isArray(desiredValues) ? desiredValues.filter(Boolean) : [desiredValues].filter(Boolean);
  if (!values.length) return { best: null, bestScore: 0 };
  let best = null;
  let bestScore = 0;
  optionNodes.forEach((node) => {
    const optionText = readOptionText(node);
    values.forEach((desiredValue) => {
      const score = scoreOptionText(optionText, desiredValue);
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    });
  });
  return { best, bestScore };
}

function clickElement(node) {
  if (!node) return;
  node.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function resolveSearchInput(el) {
  if (!el) return null;
  const tag = String(el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return el;
  const nested = el.querySelector?.("input, textarea, [contenteditable='true']");
  if (nested) return nested;
  return null;
}

function openSelectLikeTrigger(el) {
  if (!el) return;
  const host =
    el.closest?.("[role='combobox'], .ant-select, .el-select, .arco-select, .ivu-select, .n-base-selection, .dropdown, .picker") ||
    el.parentElement;
  const trigger =
    host?.querySelector?.(
      "[role='combobox'], .ant-select-selector, .el-input__suffix, .arco-select-view, .ivu-select-selection, .n-base-selection, .suffix, .arrow, [aria-haspopup]"
    ) || host || el;
  clickElement(trigger);
}

function readCurrentControlText(el) {
  if (!el) return "";
  const tag = String(el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return asText(el.value);
  }
  if (el.isContentEditable || asText(el.getAttribute?.("contenteditable")).toLowerCase() === "true") {
    return textOf(el);
  }
  return textOf(el);
}

async function fillSelectLike(el, value, field = "", options = {}) {
  if (!value) return false;
  const desiredValues = expandFieldValues(field, value);
  if (!desiredValues.length) return false;
  if (el.tagName.toLowerCase() === "select") {
    const options = Array.from(el.options || []);
    const { best } = chooseBestOptionNode(options, desiredValues);
    const matched = best;
    if (!matched) return false;
    el.value = matched.value;
    triggerInputEvents(el);
    return true;
  }

  const queryInput = resolveSearchInput(el) || el;
  if (options.allowScroll !== false) {
    queryInput.scrollIntoView?.({ block: "center", inline: "nearest" });
  }
  queryInput.focus?.();
  openSelectLikeTrigger(queryInput);
  clickElement(queryInput);
  await sleep(80);

  if ("value" in queryInput && !queryInput.readOnly) {
    queryInput.value = "";
    triggerInputEvents(queryInput);
    await sleep(40);
    queryInput.value = desiredValues[0];
    triggerInputEvents(queryInput);
  } else if (queryInput.isContentEditable) {
    queryInput.textContent = desiredValues[0];
    triggerInputEvents(queryInput);
  }
  queryInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  queryInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));

  const startedAt = Date.now();
  let selectedText = "";
  while (Date.now() - startedAt < 1500) {
    const optionNodes = collectVisibleOptionNodes();
    const { best, bestScore } = chooseBestOptionNode(optionNodes, desiredValues);
    if (best && bestScore > 0) {
      selectedText = readOptionText(best);
      best.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      clickElement(best);
      await sleep(120);
      break;
    }
    await sleep(100);
  }

  if (!selectedText) {
    const dialogFilled = await fillViaDialogFallback(el, value, field, options);
    if (dialogFilled) {
      selectedText = desiredValues[0];
    }
  }

  const finalValue = normalizeForMatch(readCurrentControlText(queryInput) || readCurrentControlText(el));
  const target = normalizeForMatch(desiredValues[0]);
  const selected = normalizeForMatch(selectedText);
  const hostText = normalizeForMatch(textOf(el.closest?.("[role='combobox']") || el.parentElement || el));

  return Boolean(
    (target && finalValue && (finalValue.includes(target) || target.includes(finalValue))) ||
      (selected && (selected.includes(target) || target.includes(selected))) ||
      (hostText && target && hostText.includes(target))
  );
}

function buildFieldDetectionResults(candidatesByField = {}) {
  return TARGET_FIELDS.map((field) => {
    const candidates = Array.isArray(candidatesByField[field]) ? candidatesByField[field] : [];
    const selected = candidates
      .slice()
      .sort((a, b) => Number(b?.matchScore || 0) - Number(a?.matchScore || 0))[0] || null;
    const controlType = selected?.controlType || "not_found";
    return {
      field,
      controlType,
      supported: SUPPORTED_CONTROL_TYPES.has(controlType),
      found: Boolean(selected),
      hint: selected?.hint || ""
    };
  });
}

function pickBestFieldCandidate(candidates = []) {
  return (Array.isArray(candidates) ? candidates : [])
    .slice()
    .sort((a, b) => Number(b?.matchScore || 0) - Number(a?.matchScore || 0))[0] || null;
}

function sortFieldCandidates(candidates = []) {
  return (Array.isArray(candidates) ? candidates : [])
    .slice()
    .sort((a, b) => Number(b?.matchScore || 0) - Number(a?.matchScore || 0));
}

function getFallbackFieldCandidates(field = "", candidatesByField = {}) {
  if (field === "first_school_name") return sortFieldCandidates(candidatesByField.school_name || []);
  if (field === "first_major") return sortFieldCandidates(candidatesByField.major || []);
  if (field === "bachelor_start_date") return sortFieldCandidates(candidatesByField.master_start_date || []);
  if (field === "bachelor_end_date") return sortFieldCandidates(candidatesByField.master_end_date || []);
  if (field === "master_start_date") return sortFieldCandidates(candidatesByField.bachelor_start_date || []);
  if (field === "master_end_date") return sortFieldCandidates(candidatesByField.bachelor_end_date || []);
  if (field === "certificate_name") return sortFieldCandidates(candidatesByField.language_exam_level || []);
  if (field === "achievement_score") return sortFieldCandidates(candidatesByField.english_score || []);
  return [];
}

function findFieldCandidateByKeyword(field = "") {
  const selector =
    "input:not([type='hidden']):not([type='checkbox']), textarea, select, [role='combobox'], [contenteditable='true']";
  const elements = Array.from(document.querySelectorAll(selector)).filter(isVisible);
  let best = null;
  let bestScore = 0;
  elements.forEach((el) => {
    const hint = getElementHints(el);
    const score = scoreHintForField(hint, field);
    if (score > bestScore) {
      best = {
        element: el,
        controlType: classifyControlType(el),
        hint,
        matchScore: score
      };
      bestScore = score;
    }
  });
  return bestScore > 0 ? best : null;
}

function getFormElementDomOrderMap() {
  const selector =
    "input:not([type='hidden']):not([type='checkbox']), textarea, select, [role='combobox'], [contenteditable='true']";
  const elements = Array.from(document.querySelectorAll(selector)).filter(isVisible);
  const orderMap = new Map();
  elements.forEach((el, index) => orderMap.set(el, index));
  return orderMap;
}

function scoreHintByPatterns(hint = "", patterns = []) {
  const text = normalizeForMatch(hint);
  if (!text) return 0;
  let score = 0;
  patterns.forEach((pattern) => {
    if (pattern.test(text)) score += 10;
  });
  return score;
}

function getModuleValueFromRow(row = {}, fieldDef = {}) {
  const sourceKeys = Array.isArray(fieldDef.sourceKeys) && fieldDef.sourceKeys.length ? fieldDef.sourceKeys : [fieldDef.key];
  for (const key of sourceKeys) {
    const value = asText(row?.[key]);
    if (value) return value;
  }
  return "";
}

function collectModuleFieldCandidates(moduleDef, fieldDef, orderMap) {
  const selector =
    "input:not([type='hidden']):not([type='checkbox']), textarea, select, [role='combobox'], [contenteditable='true']";
  const elements = Array.from(document.querySelectorAll(selector)).filter(isVisible);
  const candidates = [];
  elements.forEach((el) => {
    const hint = getElementHints(el);
    const fieldScore = scoreHintByPatterns(hint, fieldDef.patterns || []);
    if (!fieldScore) return;
    const sectionScore = scoreHintByPatterns(hint, moduleDef.sectionPatterns || []);
    const controlType = classifyControlType(el);
    const controlBonus = (fieldDef.controlTypes || []).includes(controlType) ? 5 : 0;
    candidates.push({
      element: el,
      controlType,
      hint,
      matchScore: fieldScore + sectionScore + controlBonus,
      domOrder: orderMap.get(el) ?? Number.MAX_SAFE_INTEGER
    });
  });
  return candidates
    .sort((a, b) => {
      if (a.domOrder !== b.domOrder) return a.domOrder - b.domOrder;
      return Number(b.matchScore || 0) - Number(a.matchScore || 0);
    })
    .filter((candidate, index, array) => array.findIndex((item) => item.element === candidate.element) === index);
}

async function fillByCandidateControl(candidate = null, field = "", value = "", options = {}) {
  const candidateHint = candidate?.hint || "";
  if (!candidate?.element) {
    return { filled: false, controlType: "not_found", supported: false, status: "not_found", reason: "not_found", hint: "" };
  }
  const controlType = candidate.controlType || "not_found";
  if (!SUPPORTED_CONTROL_TYPES.has(controlType)) {
    return {
      filled: false,
      controlType,
      supported: false,
      status: "unsupported_control",
      reason: "unsupported_control",
      hint: candidateHint
    };
  }

  if (controlType === "plain_input" || controlType === "textarea") {
    let ok = fillPlainInput(candidate.element, value);
    if (!ok && controlType === "plain_input") {
      const selectFallbackOk = await fillSelectLike(candidate.element, value, field, options);
      ok = selectFallbackOk;
      if (ok) {
        return { filled: true, controlType: "searchable_select", supported: true, status: "filled", reason: "ok", hint: candidateHint };
      }
    }
    return {
      filled: ok,
      controlType,
      supported: true,
      status: ok ? "filled" : "selector_mismatch",
      reason: ok ? "ok" : "not_filled_yet",
      hint: candidateHint
    };
  }

  if (controlType === "searchable_select") {
    let ok = await fillSelectLike(candidate.element, value, field, options);
    if (!ok) {
      ok = fillPlainInput(candidate.element, value);
    }
    return {
      filled: ok,
      controlType,
      supported: true,
      status: ok ? "filled" : "selector_mismatch",
      reason: ok ? "ok" : "not_filled_yet",
      hint: candidateHint
    };
  }

  if (controlType === "date_picker") {
    const dateResult = fillDateLike(candidate.element, value, field);
    return {
      filled: Boolean(dateResult?.ok),
      controlType,
      supported: dateResult?.status !== "unsupported_control" && dateResult?.status !== "partial_not_supported",
      status: dateResult?.ok ? "filled" : dateResult?.status || "selector_mismatch",
      reason: dateResult?.ok ? "ok" : dateResult?.reason || "not_filled_yet",
      hint: candidateHint
    };
  }

  if (controlType === "radio_group") {
    const radioResult = fillRadioGroup(candidate.element, value);
    return {
      filled: Boolean(radioResult?.ok),
      controlType,
      supported: radioResult?.status !== "unsupported_control" && radioResult?.status !== "partial_not_supported",
      status: radioResult?.ok ? "filled" : radioResult?.status || "selector_mismatch",
      reason: radioResult?.ok ? "ok" : radioResult?.reason || "not_filled_yet",
      hint: candidateHint
    };
  }

  return {
    filled: false,
    controlType,
    supported: false,
    status: "unsupported_control",
    reason: "unsupported_control",
    hint: candidateHint
  };
}

async function fillArraySectionsPassive(profile = {}) {
  const orderMap = getFormElementDomOrderMap();
  const fieldResults = [];
  let filledCount = 0;
  let unsupportedCount = 0;
  let unfilledCount = 0;

  for (const [moduleKey, moduleDef] of Object.entries(PASSIVE_ARRAY_MODULES)) {
    const rows = parseArray(profile[moduleDef.dataKey]).filter((row) => row && typeof row === "object");
    if (!rows.length) continue;

    const fieldCandidates = {};
    moduleDef.fields.forEach((fieldDef) => {
      fieldCandidates[fieldDef.key] = collectModuleFieldCandidates(moduleDef, fieldDef, orderMap);
    });

    moduleDef.fields.forEach((fieldDef) => {
      const candidates = fieldCandidates[fieldDef.key] || [];
      const max = Math.min(rows.length, candidates.length || rows.length);
      for (let index = 0; index < max; index += 1) {
        const value = getModuleValueFromRow(rows[index], fieldDef);
        const resultFieldName = `${moduleKey}[${index}].${fieldDef.key}`;
        if (!value) {
          fieldResults.push({
            field: resultFieldName,
            profileValuePresent: false,
            controlType: candidates[index]?.controlType || "not_found",
            supported: Boolean(candidates[index] && SUPPORTED_CONTROL_TYPES.has(candidates[index].controlType || "")),
            status: "empty_profile_value",
            reason: "empty_profile_value",
            hint: candidates[index]?.hint || ""
          });
          continue;
        }
        const candidate = candidates[index] || null;
        const fillResult = await fillByCandidateControl(candidate, fieldDef.key, value, { allowScroll: false });
        fieldResults.push({
          field: resultFieldName,
          profileValuePresent: true,
          controlType: fillResult.controlType,
          supported: fillResult.supported,
          status: fillResult.status,
          reason: fillResult.reason,
          hint: fillResult.hint || ""
        });
        if (fillResult.status === "filled") filledCount += 1;
        else {
          unfilledCount += 1;
          if (fillResult.status === "unsupported_control" || fillResult.status === "partial_not_supported") {
            unsupportedCount += 1;
          }
        }
      }
    });
  }

  return { filledCount, unsupportedCount, unfilledCount, fieldResults };
}

async function fillFields(profile = {}) {
  const candidatesByField = collectFieldCandidates();
  const fieldResults = [];
  for (const field of TARGET_FIELDS) {
    const value = asText(profile[field]);
    const primaryCandidates = sortFieldCandidates(candidatesByField[field] || []);
    const fallbackCandidates = getFallbackFieldCandidates(field, candidatesByField);
    const keywordCandidate = findFieldCandidateByKeyword(field);
    const mergedCandidates = [...primaryCandidates, ...fallbackCandidates];
    if (keywordCandidate) {
      mergedCandidates.push(keywordCandidate);
    }
    const dedupCandidates = [];
    const seenElements = new Set();
    for (const item of mergedCandidates) {
      const element = item?.element;
      if (!element || seenElements.has(element)) continue;
      seenElements.add(element);
      dedupCandidates.push(item);
    }

    const firstCandidate = dedupCandidates[0] || null;
    const controlType = firstCandidate?.controlType || "not_found";
    const supported = SUPPORTED_CONTROL_TYPES.has(controlType);

    if (!value) {
      fieldResults.push({
        field,
        profileValuePresent: false,
        controlType,
        supported,
        status: "empty_profile_value",
        reason: "empty_profile_value",
        hint: firstCandidate?.hint || ""
      });
      continue;
    }

    if (!firstCandidate) {
      fieldResults.push({
        field,
        profileValuePresent: true,
        controlType: "not_found",
        supported: false,
        status: "not_found",
        reason: "not_found",
        hint: ""
      });
      continue;
    }

    if (!dedupCandidates.some((candidate) => SUPPORTED_CONTROL_TYPES.has(candidate?.controlType || ""))) {
      fieldResults.push({
        field,
        profileValuePresent: true,
        controlType,
        supported: false,
        status: "unsupported_control",
        reason: "unsupported_control",
        hint: firstCandidate?.hint || ""
      });
      continue;
    }

    try {
      let finalStatus = "selector_mismatch";
      let finalReason = "selector_mismatch";
      let finalControlType = controlType;
      let finalHint = firstCandidate?.hint || "";
      let finalSupported = true;
      let filled = false;

      for (const candidate of dedupCandidates) {
        const fillResult = await fillByCandidateControl(candidate, field, value, { allowScroll: true });
        finalControlType = fillResult.controlType;
        finalHint = fillResult.hint || finalHint;
        finalSupported = fillResult.supported;
        finalStatus = fillResult.status;
        finalReason = fillResult.reason;
        if (fillResult.filled) {
          filled = true;
          break;
        }
      }

      fieldResults.push({
        field,
        profileValuePresent: true,
        controlType: finalControlType,
        supported: finalSupported,
        status: filled ? "filled" : finalStatus,
        reason: filled ? "ok" : finalReason,
        hint: finalHint
      });
    } catch (error) {
      fieldResults.push({
        field,
        profileValuePresent: true,
        controlType,
        supported: true,
        status: "selector_mismatch",
        reason: error?.message || "selector_mismatch",
        hint: firstCandidate?.hint || ""
      });
    }
  }

  const filledCount = fieldResults.filter((item) => item.status === "filled").length;
  const unsupportedCount = fieldResults.filter(
    (item) => item.status === "unsupported_control" || item.status === "partial_not_supported"
  ).length;
  const unfilledCount = fieldResults.filter((item) => item.status !== "filled").length;
  const moduleFillSummary = await fillArraySectionsPassive(profile);
  const mergedFieldResults = [...fieldResults, ...(moduleFillSummary.fieldResults || [])];
  return {
    filledCount: filledCount + Number(moduleFillSummary.filledCount || 0),
    unsupportedCount: unsupportedCount + Number(moduleFillSummary.unsupportedCount || 0),
    unfilledCount: unfilledCount + Number(moduleFillSummary.unfilledCount || 0),
    fieldResults: mergedFieldResults,
    details: mergedFieldResults
  };
}

function showToast(message) {
  const node = document.createElement("div");
  node.className = "af-edge-toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.classList.add("show"), 20);
  setTimeout(() => {
    node.classList.remove("show");
    setTimeout(() => node.remove(), 300);
  }, 2200);
}

function pickFirstEducation(masterResume = {}) {
  const education = parseArray(masterResume.education);
  if (!education.length) return {};
  const first = education[0];
  if (first && typeof first === "object") return first;
  if (typeof first === "string" && first.trim()) return { school: first.trim() };
  return {};
}

function selectField(candidates = []) {
  for (const candidate of candidates) {
    const value = asText(candidate?.value);
    if (value) {
      return { value, source: candidate.source, reason: "ok" };
    }
  }
  return { value: "", source: "", reason: "empty_in_all_sources" };
}

function buildProfileBundle(profile = {}, masterResumeEditDto = {}, masterResumeViewModel = {}) {
  const autofillProfile =
    profile?.autofillProfile && typeof profile.autofillProfile === "object" ? profile.autofillProfile : {};
  const editBasic =
    masterResumeEditDto?.basicInfo && typeof masterResumeEditDto.basicInfo === "object"
      ? masterResumeEditDto.basicInfo
      : {};
  const viewBasic =
    masterResumeViewModel?.basicInfo && typeof masterResumeViewModel.basicInfo === "object"
      ? masterResumeViewModel.basicInfo
      : {};
  const firstEduEdit = pickFirstEducation(masterResumeEditDto);
  const firstEduView = pickFirstEducation(masterResumeViewModel);

  const fullName = selectField([
    { value: autofillProfile.full_name, source: "profile.autofillProfile.full_name" },
    { value: editBasic.name, source: "masterResumeEditDto.basicInfo.name" },
    { value: viewBasic.name, source: "masterResumeViewModel.basicInfo.name" },
    { value: profile.fullName, source: "profile.fullName" },
    { value: profile.name, source: "profile.name" }
  ]);
  const email = selectField([
    { value: autofillProfile.email, source: "profile.autofillProfile.email" },
    { value: editBasic.email, source: "masterResumeEditDto.basicInfo.email" },
    { value: viewBasic.email, source: "masterResumeViewModel.basicInfo.email" },
    { value: profile.email, source: "profile.email" }
  ]);
  const phone = selectField([
    { value: autofillProfile.phone, source: "profile.autofillProfile.phone" },
    { value: editBasic.phone, source: "masterResumeEditDto.basicInfo.phone" },
    { value: viewBasic.phone, source: "masterResumeViewModel.basicInfo.phone" },
    { value: profile.phone, source: "profile.phone" },
    { value: profile.mobile, source: "profile.mobile" }
  ]);
  const gender = selectField([
    { value: autofillProfile.gender, source: "profile.autofillProfile.gender" },
    { value: profile.gender, source: "profile.gender" }
  ]);
  const schoolName = selectField([
    { value: autofillProfile.school_name, source: "profile.autofillProfile.school_name" },
    { value: firstEduEdit.school, source: "masterResumeEditDto.education[0].school" },
    { value: firstEduEdit.schoolName, source: "masterResumeEditDto.education[0].schoolName" },
    { value: firstEduView.school, source: "masterResumeViewModel.education[0].school" },
    { value: firstEduView.schoolName, source: "masterResumeViewModel.education[0].schoolName" }
  ]);
  const firstSchoolName = selectField([
    { value: autofillProfile.first_school_name, source: "profile.autofillProfile.first_school_name" },
    { value: autofillProfile.school_name, source: "profile.autofillProfile.school_name_fallback" },
    { value: firstEduEdit.school, source: "masterResumeEditDto.education[0].school" },
    { value: firstEduView.school, source: "masterResumeViewModel.education[0].school" }
  ]);
  const degree = selectField([
    { value: autofillProfile.degree, source: "profile.autofillProfile.degree" },
    { value: firstEduEdit.degree, source: "masterResumeEditDto.education[0].degree" },
    { value: firstEduView.degree, source: "masterResumeViewModel.education[0].degree" }
  ]);
  const major = selectField([
    { value: autofillProfile.major, source: "profile.autofillProfile.major" },
    { value: firstEduEdit.major, source: "masterResumeEditDto.education[0].major" },
    { value: firstEduView.major, source: "masterResumeViewModel.education[0].major" }
  ]);
  const firstMajor = selectField([
    { value: autofillProfile.first_major, source: "profile.autofillProfile.first_major" },
    { value: autofillProfile.major, source: "profile.autofillProfile.major_fallback" },
    { value: firstEduEdit.major, source: "masterResumeEditDto.education[0].major" },
    { value: firstEduView.major, source: "masterResumeViewModel.education[0].major" }
  ]);
  const birthDate = selectField([{ value: autofillProfile.birth_date, source: "profile.autofillProfile.birth_date" }]);
  const bachelorStartDate = selectField([
    { value: autofillProfile.bachelor_start_date, source: "profile.autofillProfile.bachelor_start_date" }
  ]);
  const bachelorEndDate = selectField([
    { value: autofillProfile.bachelor_end_date, source: "profile.autofillProfile.bachelor_end_date" }
  ]);
  const masterStartDate = selectField([
    { value: autofillProfile.master_start_date, source: "profile.autofillProfile.master_start_date" }
  ]);
  const masterEndDate = selectField([{ value: autofillProfile.master_end_date, source: "profile.autofillProfile.master_end_date" }]);
  const languageExamLanguage = selectField([
    { value: autofillProfile.language_exam_language, source: "profile.autofillProfile.language_exam_language" }
  ]);
  const languageExamLevel = selectField([
    { value: autofillProfile.language_exam_level, source: "profile.autofillProfile.language_exam_level" }
  ]);
  const languageName = selectField([{ value: autofillProfile.language_name, source: "profile.autofillProfile.language_name" }]);
  const englishProficiency = selectField([
    { value: autofillProfile.english_proficiency, source: "profile.autofillProfile.english_proficiency" }
  ]);
  const englishScore = selectField([{ value: autofillProfile.english_score, source: "profile.autofillProfile.english_score" }]);
  const certificateName = selectField([
    { value: autofillProfile.certificate_name, source: "profile.autofillProfile.certificate_name" },
    { value: autofillProfile.language_exam_level, source: "profile.autofillProfile.language_exam_level_fallback" }
  ]);
  const achievementScore = selectField([
    { value: autofillProfile.achievement_score, source: "profile.autofillProfile.achievement_score" },
    { value: autofillProfile.english_score, source: "profile.autofillProfile.english_score_fallback" }
  ]);
  const summary = selectField([
    { value: autofillProfile.summary, source: "profile.autofillProfile.summary" },
    { value: masterResumeEditDto.summary, source: "masterResumeEditDto.summary" },
    { value: masterResumeViewModel.summary, source: "masterResumeViewModel.summary" },
    { value: profile.summary, source: "profile.summary" },
    { value: profile.background, source: "profile.background" },
    { value: profile.headline, source: "profile.headline" }
  ]);

  const toArrayOfObjects = (value) => (Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : []);
  const educationRows = toArrayOfObjects(autofillProfile.education).map((item) => ({
    level: asText(item.level),
    school_name: asText(item.school_name),
    major: asText(item.major),
    degree: asText(item.degree),
    start_date: asText(item.start_date),
    end_date: asText(item.end_date)
  }));
  const workRows = toArrayOfObjects(autofillProfile.work_experience).map((item) => ({
    company_name: asText(item.company_name),
    department: asText(item.department),
    job_title: asText(item.job_title),
    work_description: asText(item.work_description || item.description),
    start_date: asText(item.start_date),
    end_date: asText(item.end_date)
  }));
  const projectRows = toArrayOfObjects(autofillProfile.project_experience).map((item) => ({
    project_name: asText(item.project_name),
    role: asText(item.role),
    project_description: asText(item.project_description || item.description),
    start_date: asText(item.start_date),
    end_date: asText(item.end_date)
  }));
  const familyRows = toArrayOfObjects(autofillProfile.family).map((item) => ({
    name: asText(item.name),
    relation: asText(item.relation),
    employer: asText(item.employer),
    position: asText(item.position)
  }));

  return {
    profile: {
      full_name: fullName.value,
      email: email.value,
      phone: phone.value,
      gender: gender.value,
      school_name: schoolName.value,
      first_school_name: firstSchoolName.value,
      degree: degree.value,
      major: major.value,
      first_major: firstMajor.value,
      birth_date: birthDate.value,
      bachelor_start_date: bachelorStartDate.value,
      bachelor_end_date: bachelorEndDate.value,
      master_start_date: masterStartDate.value,
      master_end_date: masterEndDate.value,
      language_exam_language: languageExamLanguage.value,
      language_exam_level: languageExamLevel.value,
      language_name: languageName.value,
      english_proficiency: englishProficiency.value,
      english_score: englishScore.value,
      certificate_name: certificateName.value,
      achievement_score: achievementScore.value,
      summary: summary.value,
      education: educationRows,
      work_experience: workRows,
      project_experience: projectRows,
      family: familyRows
    },
    updatedAt: new Date().toISOString(),
    source: "applyflow_local_profile_resume",
    debug: {
      syncStatus: "ok",
      syncError: "",
      sourceSummary: {
        lightweightProfile: profile?.lightweightProfile ? "present" : "missing",
        profileApi: "present",
        masterResumeEditDto: Object.keys(masterResumeEditDto || {}).length ? "present" : "missing",
        masterResumeViewModel: Object.keys(masterResumeViewModel || {}).length ? "present" : "missing",
        storage: "chrome.storage.local"
      },
      fieldSources: {
        full_name: fullName.source || "",
        email: email.source || "",
        phone: phone.source || "",
        gender: gender.source || "",
        school_name: schoolName.source || "",
        first_school_name: firstSchoolName.source || "",
        degree: degree.source || "",
        major: major.source || "",
        first_major: firstMajor.source || "",
        birth_date: birthDate.source || "",
        bachelor_start_date: bachelorStartDate.source || "",
        bachelor_end_date: bachelorEndDate.source || "",
        master_start_date: masterStartDate.source || "",
        master_end_date: masterEndDate.source || "",
        language_exam_language: languageExamLanguage.source || "",
        language_exam_level: languageExamLevel.source || "",
        language_name: languageName.source || "",
        english_proficiency: englishProficiency.source || "",
        english_score: englishScore.source || "",
        certificate_name: certificateName.source || "",
        achievement_score: achievementScore.source || "",
        summary: summary.source || ""
      },
      fieldReasons: {
        full_name: fullName.reason,
        email: email.reason,
        phone: phone.reason,
        gender: gender.reason,
        school_name: schoolName.reason,
        first_school_name: firstSchoolName.reason,
        degree: degree.reason,
        major: major.reason,
        first_major: firstMajor.reason,
        birth_date: birthDate.reason,
        bachelor_start_date: bachelorStartDate.reason,
        bachelor_end_date: bachelorEndDate.reason,
        master_start_date: masterStartDate.reason,
        master_end_date: masterEndDate.reason,
        language_exam_language: languageExamLanguage.reason,
        language_exam_level: languageExamLevel.reason,
        language_name: languageName.reason,
        english_proficiency: englishProficiency.reason,
        english_score: englishScore.reason,
        certificate_name: certificateName.reason,
        achievement_score: achievementScore.reason,
        summary: summary.reason
      }
    }
  };
}

function buildSyncErrorBundle(errorMessage = "sync_failed") {
  return {
    profile: {},
    updatedAt: new Date().toISOString(),
    source: "applyflow_local_profile_resume",
    debug: {
      syncStatus: "failed",
      syncError: asText(errorMessage || "sync_failed"),
      sourceSummary: {
        lightweightProfile: "unknown",
        profileApi: "failed",
        masterResumeEditDto: "failed",
        masterResumeViewModel: "failed",
        storage: "chrome.storage.local"
      },
      fieldSources: Object.fromEntries(TARGET_FIELDS.map((field) => [field, ""])),
      fieldReasons: Object.fromEntries(TARGET_FIELDS.map((field) => [field, "sync_failed"]))
    }
  };
}

async function trySyncFromApplyFlowPage() {
  if (!isApplyFlowHost(window.location.hostname)) return;
  try {
    const [profileRes, masterRes] = await Promise.all([
      fetch("/api/profile", { credentials: "include" }),
      fetch("/api/master-resume", { credentials: "include" })
    ]);
    if (!profileRes.ok || !masterRes.ok) {
      await chrome.storage.local.set({
        [PROFILE_KEY]: buildSyncErrorBundle(`http_error:${profileRes.status || "profile"}:${masterRes.status || "master"}`)
      });
      return;
    }
    const profilePayload = await profileRes.json();
    const masterPayload = await masterRes.json();
    if (!profilePayload?.success || !masterPayload?.success) {
      await chrome.storage.local.set({ [PROFILE_KEY]: buildSyncErrorBundle("api_success_false") });
      return;
    }
    const profile = profilePayload?.data?.profile || {};
    const masterResumeEditDto = masterPayload?.data?.masterResumeEditDto || {};
    const masterResumeViewModel = masterPayload?.data?.masterResumeViewModel || {};
    await chrome.storage.local.set({
      [PROFILE_KEY]: buildProfileBundle(profile, masterResumeEditDto, masterResumeViewModel)
    });
  } catch (error) {
    await chrome.storage.local.set({ [PROFILE_KEY]: buildSyncErrorBundle(error?.message || "sync_exception") });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "AF_EDGE_PING") {
    sendResponse({
      ok: true,
      ready: true,
      frameUrl: window.location.href,
      schemaVersion: CONTENT_SCRIPT_SCHEMA_VERSION,
      targetFields: TARGET_FIELDS
    });
    return false;
  }

  if (message?.type === "AF_EDGE_ANALYZE") {
    const candidatesByField = collectFieldCandidates();
    const fieldDetections = buildFieldDetectionResults(candidatesByField);
    const recognizedFieldCount = fieldDetections.filter((item) => item.found).length;
    const fillTargetCount = Object.values(candidatesByField).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
    sendResponse({
      ok: true,
      recognizedCount: recognizedFieldCount,
      fillTargetCount,
      supportLevel: computeSupportLevel(recognizedFieldCount, fillTargetCount),
      fieldDetections
    });
    return false;
  }

  if (message?.type === "AF_EDGE_FILL") {
    const payload = message?.payload && typeof message.payload === "object" ? message.payload : {};
    fillFields(payload)
      .then((result) => {
        const recognizedCount = result.fieldResults.filter((item) => item.controlType !== "not_found").length;
        sendResponse({
          ok: true,
          ...result,
          supportLevel: computeSupportLevel(recognizedCount, result.fieldResults.length)
        });
        showToast(`ApplyFlow filled ${result.filledCount}, unresolved ${result.unfilledCount}.`);
      })
      .catch((error) => {
        sendResponse({ ok: false, code: "FILL_RUNTIME_ERROR", message: error?.message || "fill_failed" });
      });
    return true;
  }

  if (message?.type === "AF_EDGE_SYNC_PROFILE") {
    if (!isApplyFlowHost(window.location.hostname)) {
      sendResponse({
        ok: false,
        code: "NOT_APPLYFLOW_PAGE",
        message: "Please open ApplyFlow Profile/Resume page to sync profile bundle."
      });
      return false;
    }
    trySyncFromApplyFlowPage()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, code: "SYNC_FAILED", message: error?.message || "sync_failed" }));
    return true;
  }

  return false;
});

trySyncFromApplyFlowPage();

