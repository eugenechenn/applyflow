"use strict";

/**
 * 岗位偏好语义匹配层：只生成 derived classification，不写回岗位数据。
 */
const {
  INDUSTRY_TAXONOMY,
  ROLE_FAMILY_TAXONOMY,
  SKILL_TAXONOMY
} = require("./job-preference-taxonomy");
const {
  normalizeJobPreferenceProfile,
  hasExplicitJobPreferenceProfile
} = require("./job-preference-profile");

const COMPANY_TYPE_TAXONOMY = [
  {
    label: "大厂",
    strongCompanyKeywords: ["腾讯", "阿里", "字节", "美团", "京东", "百度", "华为", "小米", "快手", "拼多多", "滴滴", "蚂蚁集团"],
    mediumDomainKeywords: [
      "tencent.com",
      "alibaba.com",
      "aliyun.com",
      "bytedance.com",
      "douyin.com",
      "meituan.com",
      "jd.com",
      "baidu.com",
      "huawei.com",
      "xiaomi.com",
      "kuaishou.com",
      "pinduoduo.com"
    ],
    weakTextKeywords: ["大厂"]
  },
  {
    label: "外企",
    strongCompanyKeywords: [
      "外企",
      "abb",
      "abb中国",
      "apple",
      "苹果",
      "microsoft",
      "微软",
      "google",
      "谷歌",
      "amazon",
      "亚马逊",
      "ibm",
      "oracle",
      "sap",
      "bosch",
      "博世",
      "siemens",
      "西门子",
      "unilever",
      "联合利华"
    ],
    mediumDomainKeywords: [
      "abb.com",
      "apple.com",
      "microsoft.com",
      "google.com",
      "amazon.com",
      "ibm.com",
      "oracle.com",
      "sap.com",
      "bosch.com",
      "siemens.com",
      "unilever.com"
    ],
    weakTextKeywords: ["foreign", "international", "外资"]
  },
  {
    label: "国企",
    strongCompanyKeywords: [
      "国企",
      "央企",
      "国有",
      "中国电科",
      "国家电网",
      "中建",
      "中铁",
      "中交",
      "中核",
      "中船",
      "中石油",
      "中石化",
      "中国移动",
      "中国联通",
      "中国电信"
    ],
    mediumTextKeywords: ["区管国企", "省属国企", "市属国企", "直属国企"],
    weakTextKeywords: ["国资", "国有企业"]
  },
  {
    label: "创业公司",
    strongCompanyKeywords: ["初创公司", "初创团队", "startup", "start-up", "pre-a", "天使轮", "a轮", "b轮", "c轮", "融资"],
    mediumTextKeywords: ["创业公司", "创业团队"],
    weakTextKeywords: ["创业"],
    excludedTextKeywords: ["创新创业", "创业服务", "就业创业", "创业园", "创业指导", "创业教育", "创新创业中心"]
  },
  {
    label: "上市公司",
    strongCompanyKeywords: ["上市公司", "股票代码"],
    mediumTextKeywords: ["港交所", "上交所", "深交所", "纳斯达克", "纽交所"],
    weakTextKeywords: ["股份有限公司"]
  },
  {
    label: "研究院",
    strongCompanyKeywords: ["研究院", "研究所", "设计院", "实验室", "lab"],
    mediumTextKeywords: ["重点实验室", "工程研究中心", "技术研究院"],
    weakTextKeywords: ["科研院所"]
  },
  {
    label: "事业单位",
    strongCompanyKeywords: ["事业单位", "省属事业单位", "市属事业单位", "区属事业单位", "事业编", "公立医院", "高校"],
    strongRegex: [/(?:^|[\s|])[\u4e00-\u9fa5]{1,20}(局|委(?:员会)?|厅)(?:$|[\s|])/i, /人民政府/i, /管理委员会/i, /机关事务/i],
    mediumTextKeywords: ["政府机关", "国家级", "国家机关", "委员会"],
    weakTextKeywords: ["公共机构"]
  }
];

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function includesKeyword(text = "", keyword = "") {
  const source = normalizeText(text);
  const target = normalizeText(keyword);
  return Boolean(source && target && source.includes(target));
}

function includesRoleExclusionKeyword(text = "", keyword = "") {
  const target = String(keyword || "").trim();
  if (!target) return false;
  if (target === "培训") {
    const conflictScope = String(text || "")
      .replace(/(?<!管理)培训生计划/g, "")
      .replace(/(?<!管理)培训生/g, "")
      .replace(/培训项目/g, "");
    return includesKeyword(conflictScope, target);
  }
  return includesKeyword(text, target);
}

function normalizeIndustryHint(value = "") {
  const text = String(value || "").trim();
  if (!text || text === "其他") return "";
  if (/互联网|软件|产品|小红书|字节|腾讯|阿里|美团|快手|哔哩|bilibili/i.test(text)) return "互联网/软件";
  if (/AI|人工智能|算法|大模型|机器学习/i.test(text)) return "AI/算法";
  if (/金融|银行|证券|基金|保险|投行/i.test(text)) return "金融";
  if (/游戏|电竞|手游|端游/i.test(text)) return "游戏";
  if (/制造|硬件|芯片|半导体|机器人|汽车/i.test(text)) return "制造/硬件";
  if (/医疗|医药|生物|健康/i.test(text)) return "医疗/生物";
  if (/教育|学校|教师|培训机构/i.test(text)) return "教育";
  if (/咨询|商业|零售|消费|地产|物业/i.test(text)) return "咨询/商业";
  if (/政企|事业单位|国企|政府/i.test(text)) return "政企/事业单位";
  return "";
}

const TITLE_SEGMENT_SPLITTER = /[\/|\-｜（）()]+/g;
const ROLE_ANCHOR_KEYWORDS = ["工程师", "产品经理", "产品", "分析师", "研究员", "运营", "算法", "开发", "测试"];
const SOFT_NEGATIVE_ROLE_KEYWORDS = ["销售", "客服", "管培生", "管理培训生"];
const BROAD_TITLE_SEGMENT_KEYWORDS = ["方向", "岗位", "职位", "类", "综合", "支持", "管理", "业务"];
const ROLE_ALIAS_GROUPS = [
  {
    canonical: "研发工程师",
    aliases: [
      "研发工程师",
      "软件工程师",
      "software engineer"
    ]
  },
  {
    canonical: "后端开发工程师",
    aliases: [
      "后端开发工程师",
      "后端研发工程师",
      "后端开发",
      "后端工程师",
      "服务端开发",
      "服务端工程师",
      "服务端研发",
      "backend engineer",
      "backend developer",
      "server-side engineer",
      "java开发工程师",
      "java开发",
      "golang开发工程师",
      "go开发工程师",
      "go开发",
      "c++开发工程师",
      "c/c++开发工程师",
      "python开发工程师",
      "node.js开发工程师",
      "nodejs开发工程师"
    ]
  },
  {
    canonical: "前端开发工程师",
    aliases: [
      "前端开发工程师",
      "前端研发工程师",
      "前端开发",
      "前端工程师",
      "web前端开发工程师",
      "web前端",
      "大前端",
      "frontend engineer",
      "frontend developer",
      "web developer",
      "javascript开发工程师",
      "js开发工程师",
      "react开发工程师",
      "vue开发工程师"
    ]
  },
  {
    canonical: "算法工程师",
    aliases: [
      "算法工程师",
      "machine learning engineer",
      "ml engineer",
      "ai engineer",
      "algorithm engineer",
      "autonomous driving algorithm",
      "robotics algorithm",
      "自动驾驶算法",
      "机器人算法"
    ]
  },
  {
    canonical: "数据分析",
    aliases: [
      "数据分析",
      "数据分析师",
      "data analyst",
      "bi analyst",
      "business analyst",
      "商业分析",
      "商业智能",
      "strategy analyst",
      "growth analyst",
      "data product",
      "数据产品"
    ]
  },
  {
    canonical: "金融研究",
    aliases: [
      "金融研究",
      "金融研究员",
      "投研",
      "投资研究",
      "量化研究",
      "证券研究员",
      "行业研究员",
      "策略研究员",
      "financial research",
      "investment research",
      "quant"
    ]
  },
  {
    canonical: "产品经理",
    aliases: [
      "产品经理",
      "product manager",
      "data product manager",
      "growth product manager",
      "ai product manager",
      "数据产品经理",
      "增长产品经理",
      "ai产品经理",
      "产品策划"
    ]
  },
  {
    canonical: "游戏策划",
    aliases: ["游戏策划", "game planner", "游戏产品策划", "关卡策划", "数值策划", "系统策划", "剧情策划"]
  }
];
const ROLE_ONTOLOGY_ALIAS_GROUPS = [
  ...ROLE_ALIAS_GROUPS,
  {
    canonical: "金融研究",
    aliases: ["金融研究", "金融研究员", "financial research", "investment research", "quant", "投研", "投资研究", "量化研究", "证券研究员", "行业研究员", "策略研究员"]
  },
  {
    canonical: "教育科研",
    aliases: ["教育科研", "education research", "academic research", "科研助理", "教研"]
  }
];
const ROLE_ONTOLOGY_ADJACENCY = {
  数据分析: {
    adjacent: ["商业分析", "BI分析", "数据产品经理", "增长产品经理"],
    transferable: ["产品经理", "运营", "研究"]
  },
  产品经理: {
    adjacent: ["数据产品经理", "增长产品经理", "AI产品经理"],
    transferable: ["商业分析", "运营", "项目管理"]
  },
  算法工程师: {
    adjacent: ["AI工程师", "ML工程师", "自动驾驶算法", "机器人算法"],
    transferable: ["研发工程师", "数据科学"]
  },
  后端开发工程师: {
    adjacent: ["服务端开发", "软件工程师", "研发工程师", "全栈开发工程师"],
    transferable: ["前端开发工程师", "测试工程师"]
  },
  前端开发工程师: {
    adjacent: ["Web前端", "大前端", "全栈开发工程师", "客户端开发"],
    transferable: ["后端开发工程师", "产品经理"]
  },
  金融研究: {
    adjacent: ["投资研究", "量化研究", "商业分析"],
    transferable: ["数据分析", "产品经理"]
  },
  教育科研: {
    adjacent: ["教育研究", "Academic Research", "EdTech Product"],
    transferable: ["产品经理", "数据分析"]
  }
};

function splitTitleSegments(title = "") {
  return String(title || "")
    .split(TITLE_SEGMENT_SPLITTER)
    .map((item) => String(item || "").trim())
    .filter((item) => item.length >= 2)
    .slice(0, 8);
}

function scoreTitleSegmentRoleSemantics(segment = "", index = 0) {
  const text = String(segment || "").trim();
  if (!text) return 0;
  const anchorHits = ROLE_ANCHOR_KEYWORDS.filter((keyword) => includesKeyword(text, keyword)).length;
  const structuredBonus = /工程师|产品经理|分析师|研究员/.test(text) ? 6 : 0;
  const firstSegmentBonus = index === 0 ? 4 : 0;
  const lengthScore = Math.min(12, text.length / 2);
  const broadPenalty = BROAD_TITLE_SEGMENT_KEYWORDS.some((keyword) => includesKeyword(text, keyword)) ? 8 : 0;
  return anchorHits * 10 + structuredBonus + firstSegmentBonus + lengthScore - broadPenalty;
}

function inferDominantRoleSemantics(title = "", allText = "") {
  const segments = splitTitleSegments(title);
  const fallbackSegment = String(title || "").trim();
  if (segments.length === 0) {
    return {
      titleSegments: fallbackSegment ? [fallbackSegment] : [],
      dominantRoleSegment: fallbackSegment,
      secondaryRoleSegments: [],
      mixedRoleTitle: false,
      dominantNegativeRoleSignals: SOFT_NEGATIVE_ROLE_KEYWORDS.filter((keyword) => includesKeyword(fallbackSegment, keyword)),
      secondaryNegativeRoleSignals: []
    };
  }

  const scored = segments
    .map((segment, index) => ({
      segment,
      score: scoreTitleSegmentRoleSemantics(segment, index),
      index
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const dominantCandidate = scored[0]?.segment || segments[0];
  const dominantScore = Number(scored[0]?.score || 0);
  let dominantRoleSegment = dominantScore >= 12 ? dominantCandidate : segments[0];
  const secondaryRoleSegments = segments.filter((segment) => segment !== dominantRoleSegment);
  const broadDominant = BROAD_TITLE_SEGMENT_KEYWORDS.some((keyword) => includesKeyword(dominantRoleSegment, keyword));
  if (broadDominant && scored[1]?.segment) {
    dominantRoleSegment = scored[1].segment;
  }
  const dominantNegativeRoleSignals = SOFT_NEGATIVE_ROLE_KEYWORDS.filter((keyword) => includesKeyword(dominantRoleSegment, keyword));
  const secondaryNegativeRoleSignals = SOFT_NEGATIVE_ROLE_KEYWORDS.filter((keyword) => {
    return !dominantNegativeRoleSignals.includes(keyword) && secondaryRoleSegments.some((segment) => includesKeyword(segment, keyword));
  });

  return {
    titleSegments: segments,
    dominantRoleSegment,
    secondaryRoleSegments,
    mixedRoleTitle: segments.length > 1,
    dominantNegativeRoleSignals,
    secondaryNegativeRoleSignals
  };
}

function includesAny(text = "", keywords = []) {
  return (Array.isArray(keywords) ? keywords : []).some((keyword) => includesKeyword(text, keyword));
}

function matchRegexAny(text = "", regexList = []) {
  const source = String(text || "");
  return (Array.isArray(regexList) ? regexList : []).some((pattern) => {
    if (!(pattern instanceof RegExp)) return false;
    return pattern.test(source);
  });
}

function extractHostFromUrl(url = "") {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return String(parsed.hostname || "").toLowerCase().replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}

function extractUrlDomains(job = {}) {
  const domains = [
    extractHostFromUrl(job.jobUrl),
    extractHostFromUrl(job.applyUrl),
    extractHostFromUrl(job.sourceUrl),
    extractHostFromUrl(job.noticeUrl)
  ].filter(Boolean);
  return unique(domains);
}

function matchTaxonomyTerm(term = "", taxonomy = []) {
  return taxonomy.filter((entry) => {
    if (includesKeyword(term, entry.label)) return true;
    const strongKeywords = Array.isArray(entry.strongKeywords) ? entry.strongKeywords : [];
    const mediumKeywords = Array.isArray(entry.mediumKeywords) ? entry.mediumKeywords : [];
    const weakKeywords = Array.isArray(entry.weakKeywords) ? entry.weakKeywords : [];
    const genericKeywords = Array.isArray(entry.keywords) ? entry.keywords : [];
    return [...strongKeywords, ...mediumKeywords, ...weakKeywords, ...genericKeywords].some(
      (keyword) => includesKeyword(term, keyword) || includesKeyword(keyword, term)
    );
  });
}

function inferLegacyIndustryPreferenceFromRoles(targetRoles = []) {
  const industryPreference = [];
  const unknownPreference = [];
  (Array.isArray(targetRoles) ? targetRoles : []).forEach((term) => {
    const industryMatches = matchTaxonomyTerm(term, INDUSTRY_TAXONOMY);
    if (industryMatches.length > 0) {
      industryMatches.forEach((entry) => industryPreference.push(entry.label));
      return;
    }
    if (matchTaxonomyTerm(term, ROLE_FAMILY_TAXONOMY).length === 0) {
      unknownPreference.push(term);
    }
  });
  return {
    industryPreference: unique(industryPreference),
    unknownPreference
  };
}

function inferPreferenceProfile({
  lightweightProfile = {},
  jobPreferenceProfile = {},
  preferenceSource = "legacy"
} = {}) {
  const isStrictSource = String(preferenceSource || "").trim().toLowerCase() === "jobpreferenceprofile";
  const normalizedJobPreference = normalizeJobPreferenceProfile(
    {
      lightweightProfile,
      jobPreferenceProfile
    },
    { strict: isStrictSource }
  );
  const targetRoles = normalizeList(normalizedJobPreference.targetRoles);
  const skills = normalizeList(normalizedJobPreference.skills);
  const preferredLocations = normalizeList(normalizedJobPreference.preferredLocations);
  let industryPreference = normalizeList(normalizedJobPreference.preferredIndustries);
  const rolePreference = expandRolePreferenceAliases(targetRoles);
  let unknownPreference = [];

  // 旧数据兼容路径：仅 legacy 模式允许从 targetRoles 反推行业，不属于新模型行为。
  if (!isStrictSource && industryPreference.length === 0) {
    const legacyInferred = inferLegacyIndustryPreferenceFromRoles(targetRoles);
    industryPreference = legacyInferred.industryPreference;
    unknownPreference = legacyInferred.unknownPreference;
  }

  const preferenceType =
    industryPreference.length > 0
      ? "industry"
      : rolePreference.length > 0
        ? "role"
        : skills.length > 0
          ? "skill"
          : preferredLocations.length > 0
            ? "location"
            : "unknown";

  return {
    preferenceType,
    industryPreference: unique(industryPreference),
    excludedIndustries: normalizeList(normalizedJobPreference.excludedIndustries),
    rolePreference: unique(rolePreference),
    excludedRoles: normalizeList(normalizedJobPreference.excludedRoles),
    skillPreference: unique(skills),
    locationPreference: preferredLocations,
    companyPreference: normalizeList(normalizedJobPreference.companyTypes),
    avoidCompanyTypes: normalizeList(normalizedJobPreference.avoidCompanyTypes),
    jobTypePreference: String(normalizedJobPreference.jobType || "不限").trim() || "不限",
    priorityWeights: normalizedJobPreference.priorityWeights || {},
    unknownPreference
  };
}

function expandRolePreferenceAliases(targetRoles = []) {
  const normalizedRoles = normalizeList(targetRoles);
  const expanded = [...normalizedRoles];
  normalizedRoles.forEach((role) => {
    const roleLower = normalizeText(role);
    ROLE_ALIAS_GROUPS.forEach((group) => {
      const aliases = Array.isArray(group.aliases) ? group.aliases : [];
      if (aliases.length === 0) return;
      const matched = aliases.some((alias) => {
        const aliasLower = normalizeText(alias);
        if (!aliasLower) return false;
        const shortAlias = aliasLower.length <= 2;
        if (shortAlias) {
          return roleLower === aliasLower || roleLower.split(/\s+/).includes(aliasLower);
        }
        return roleLower === aliasLower || roleLower.includes(aliasLower) || aliasLower.includes(roleLower);
      });
      if (!matched) return;
      expanded.push(group.canonical);
      aliases.forEach((alias) => expanded.push(alias));
    });
  });
  return unique(expanded);
}

function scoreWeightedKeywordList(text = "", keywords = [], weight = 1) {
  return (Array.isArray(keywords) ? keywords : []).reduce((total, keyword) => {
    return total + (includesKeyword(text, keyword) ? weight : 0);
  }, 0);
}

function hasExcludedKeyword(corpus = {}, entry = {}) {
  const exclusions = Array.isArray(entry.excludedKeywords) ? entry.excludedKeywords : [];
  if (exclusions.length === 0) return false;
  const text = `${corpus.title} ${corpus.company} ${corpus.description}`;
  return exclusions.some((keyword) => includesKeyword(text, keyword));
}

function scoreIndustryEntry(corpus = {}, entry = {}) {
  const title = normalizeText(corpus.title);
  const description = normalizeText(corpus.description);
  const company = normalizeText(corpus.company);

  const strongTitle = scoreWeightedKeywordList(title, entry.strongKeywords, 8);
  const strongDescription = scoreWeightedKeywordList(description, entry.strongKeywords, 4);
  const mediumTitle = scoreWeightedKeywordList(title, entry.mediumKeywords, 5);
  const mediumDescription = scoreWeightedKeywordList(description, entry.mediumKeywords, 3);
  const weakTitle = scoreWeightedKeywordList(title, entry.weakKeywords, 2);
  const weakDescription = scoreWeightedKeywordList(description, entry.weakKeywords, 1);
  const companySignal = scoreWeightedKeywordList(company, entry.strongKeywords, 2) +
    scoreWeightedKeywordList(company, entry.mediumKeywords, 1);
  const labelSignal =
    includesKeyword(title, entry.label) || includesKeyword(description, entry.label)
      ? 2
      : 0;
  const excluded = hasExcludedKeyword(corpus, entry);
  const descriptionOnlySignal =
    strongTitle === 0 &&
    mediumTitle === 0 &&
    weakTitle === 0 &&
    companySignal === 0 &&
    labelSignal === 0 &&
    (strongDescription > 0 || mediumDescription > 0 || weakDescription > 0);

  let score =
    strongTitle +
    strongDescription +
    mediumTitle +
    mediumDescription +
    weakTitle +
    weakDescription +
    companySignal +
    labelSignal -
    (excluded ? 6 : 0);

  if (descriptionOnlySignal) {
    score = Math.min(score, 5);
  }

  let confidence =
    strongTitle > 0 || companySignal >= 2
      ? "high"
      : mediumTitle > 0 || strongDescription > 0 || mediumDescription >= 6 || companySignal > 0
        ? "medium"
        : weakTitle > 0 || weakDescription > 0 || labelSignal > 0
          ? "low"
          : "low";

  if (descriptionOnlySignal) {
    confidence = "low";
  }

  return {
    entry,
    score,
    confidence,
    signalBreakdown: {
      strongTitle,
      strongDescription,
      mediumTitle,
      mediumDescription,
      weakTitle,
      weakDescription,
      companySignal,
      labelSignal,
      excluded
    }
  };
}

function inferIndustry(corpus = {}) {
  const scored = INDUSTRY_TAXONOMY
    .map((entry) => scoreIndustryEntry(corpus, entry))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  return scored[0] || null;
}

function scoreRoleEntry(corpus = {}, entry = {}) {
  const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
  if (keywords.length === 0) return 0;
  const dominantRoleSegment = String(corpus.dominantRoleSegment || corpus.title || "");
  const titleScore = keywords.some((keyword) => includesKeyword(corpus.title, keyword)) ? 6 : 0;
  const dominantScore = keywords.some((keyword) => includesKeyword(dominantRoleSegment, keyword)) ? 8 : 0;
  const descriptionScore = keywords.some((keyword) => includesKeyword(corpus.description, keyword)) ? 3 : 0;
  const companyScore = keywords.some((keyword) => includesKeyword(corpus.company, keyword)) ? 1 : 0;
  const mixedPenalty =
    Number(corpus.titleSegmentCount || 0) >= 4 && dominantScore === 0 && titleScore === 0 ? 2 : 0;
  return titleScore + dominantScore + descriptionScore + companyScore - mixedPenalty;
}

function inferBestRoleFamily(corpus = {}) {
  const scored = ROLE_FAMILY_TAXONOMY
    .map((entry) => ({ entry, score: scoreRoleEntry(corpus, entry) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  const best = scored[0] || null;
  if (!best) return null;
  const confidence =
    best.score >= 10 ? "high" : best.score >= 6 ? "medium" : "low";
  return {
    ...best,
    confidence
  };
}

function resolveRoleOntologyContext({ inferredRoleFamily = "", allText = "", dominantRoleSegment = "", titleSegments = [] } = {}) {
  const candidates = [];
  if (inferredRoleFamily) candidates.push(inferredRoleFamily);
  ROLE_ONTOLOGY_ALIAS_GROUPS.forEach((group) => {
    const aliases = Array.isArray(group.aliases) ? group.aliases : [];
    if (aliases.some((alias) => includesKeyword(allText, alias) || includesKeyword(dominantRoleSegment, alias))) {
      candidates.push(group.canonical);
    }
  });
  const primaryRole = unique(candidates)[0] || inferredRoleFamily || "未知";
  const adjacency = ROLE_ONTOLOGY_ADJACENCY[primaryRole] || { adjacent: [], transferable: [] };
  const titleSegmentCount = Array.isArray(titleSegments) ? titleSegments.length : 0;
  const hasBroadSegment = (Array.isArray(titleSegments) ? titleSegments : []).some((segment) =>
    BROAD_TITLE_SEGMENT_KEYWORDS.some((keyword) => includesKeyword(segment, keyword))
  );
  const hasCrossFamilyBundle = /(客户端|前端|后端|服务端)/.test(allText) && /(测试|产品|运营|销售|教师|研究)/.test(allText);
  const highValueComposite = (
    (includesKeyword(allText, "自动驾驶") && includesKeyword(allText, "算法")) ||
    (includesKeyword(allText, "机器人") && includesKeyword(allText, "算法")) ||
    (includesKeyword(allText, "数据分析") && includesKeyword(allText, "数据产品")) ||
    (includesKeyword(allText, "产品经理") && includesKeyword(allText, "增长产品"))
  );
  let roleStructureType = "single_role";
  if (hasCrossFamilyBundle || (titleSegmentCount >= 4 && hasBroadSegment)) roleStructureType = "bundled_role";
  else if (hasBroadSegment || titleSegmentCount >= 3) roleStructureType = "broad_role";
  else if (highValueComposite || titleSegmentCount === 2) roleStructureType = "high_value_composite";
  return {
    primaryRole,
    adjacentRoles: unique(adjacency.adjacent || []),
    transferableRoles: unique(adjacency.transferable || []),
    roleStructureType
  };
}

function inferSkills(corpusText = "") {
  return SKILL_TAXONOMY.filter((skill) => includesKeyword(corpusText, skill));
}

function scoreCompanyTypeEntry(corpus = {}, entry = {}) {
  const company = normalizeText(corpus.company);
  const title = normalizeText(corpus.title);
  const description = normalizeText(corpus.description);
  const bodyText = `${title} ${description}`;
  const allText = `${company} ${bodyText}`;
  const domains = Array.isArray(corpus.urlDomains) ? corpus.urlDomains : [];

  const excludedTextKeywords = Array.isArray(entry.excludedTextKeywords) ? entry.excludedTextKeywords : [];
  if (includesAny(allText, excludedTextKeywords)) {
    return { score: 0, confidence: "none" };
  }

  const strongCompany = scoreWeightedKeywordList(company, entry.strongCompanyKeywords, 8);
  const strongText = scoreWeightedKeywordList(bodyText, entry.strongCompanyKeywords, 5);
  const strongRegex = matchRegexAny(`${corpus.company || ""} ${corpus.title || ""}`, entry.strongRegex) ? 6 : 0;
  const mediumText = scoreWeightedKeywordList(bodyText, entry.mediumTextKeywords, 3);
  const mediumDomain = domains.reduce((sum, domain) => {
    return sum + scoreWeightedKeywordList(domain, entry.mediumDomainKeywords, 3);
  }, 0);
  const weakText = scoreWeightedKeywordList(bodyText, entry.weakTextKeywords, 1);
  const score = strongCompany + strongText + strongRegex + mediumText + mediumDomain + weakText;

  if (score <= 0) return { score: 0, confidence: "none" };
  if (strongCompany > 0 || strongRegex > 0) return { score, confidence: "high" };
  if (strongText > 0 || mediumText > 0 || mediumDomain > 0) return { score, confidence: "medium" };
  return { score, confidence: "low" };
}

function inferCompanyTypes(corpus = {}) {
  const scored = COMPANY_TYPE_TAXONOMY
    .map((entry) => {
      const result = scoreCompanyTypeEntry(corpus, entry);
      return {
        label: entry.label,
        score: result.score,
        confidence: result.confidence
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  const selected = scored.filter((item) => {
    if (item.confidence === "high") return true;
    if (item.confidence === "medium") return item.score >= 3;
    return item.score >= 2;
  });

  const inferredCompanyTypes = selected.map((item) => item.label);
  const inferredCompanyTypeConfidence = selected.reduce((acc, item) => {
    acc[item.label] = item.confidence;
    return acc;
  }, {});

  return {
    inferredCompanyTypes,
    inferredCompanyTypeConfidence
  };
}

function buildIndustryEvidence(industryMatch = null) {
  if (!industryMatch) return "";
  const { entry, signalBreakdown } = industryMatch;
  if (signalBreakdown.strongTitle > 0) {
    return `${entry.label}强信号出现在岗位标题`;
  }
  if (signalBreakdown.mediumTitle > 0 || signalBreakdown.strongDescription > 0) {
    return `${entry.label}信号主要来自岗位描述`;
  }
  if (signalBreakdown.weakTitle > 0 || signalBreakdown.weakDescription > 0) {
    return `${entry.label}仅有弱关键词信号`;
  }
  return `${entry.label}存在弱相关信号`;
}

function classifyJobPreference({ lightweightProfile = {}, jobPreferenceProfile = {}, preferenceSource = "", job = {} } = {}) {
  const resolvedPreferenceSource =
    String(preferenceSource || "").trim() ||
    (hasExplicitJobPreferenceProfile(jobPreferenceProfile) ? "jobPreferenceProfile" : "legacy");
  const preferenceProfile = inferPreferenceProfile({
    lightweightProfile,
    jobPreferenceProfile,
    preferenceSource: resolvedPreferenceSource
  });
  const metadata = job.metadata && typeof job.metadata === "object" ? job.metadata : {};
  const corpus = {
    title: String(job.title || ""),
    company: String(job.company || ""),
    description: String(
      job.jdRaw ||
        job.jd_raw ||
        job.description ||
        job.rawText ||
        job.raw_text ||
        metadata.rawText ||
        metadata.raw_text ||
        ""
    )
  };
  corpus.urlDomains = extractUrlDomains(job);
  const allText = `${corpus.title} ${corpus.company} ${corpus.description}`;
  const dominantRoleSemantics = inferDominantRoleSemantics(corpus.title, allText);
  corpus.dominantRoleSegment = dominantRoleSemantics.dominantRoleSegment;
  corpus.titleSegmentCount = dominantRoleSemantics.titleSegments.length;
  const industryMatch = inferIndustry(corpus);
  const roleMatch = inferBestRoleFamily(corpus);
  const importMeta = job.importMeta && typeof job.importMeta === "object" ? job.importMeta : {};
  const metadataIndustryHint = normalizeIndustryHint(
    importMeta.inferredIndustry ||
      metadata.inferredIndustry ||
      metadata.industryHint ||
      `${corpus.company} ${corpus.title}`
  );
  const inferredIndustry = industryMatch?.entry?.label || metadataIndustryHint || "其他";
  const inferredIndustryConfidence = industryMatch?.confidence || (metadataIndustryHint ? "medium" : "low");
  const inferredRoleFamily = roleMatch?.entry?.label || null;
  const inferredRoleConfidence = roleMatch?.confidence || "low";
  const roleOntologyContext = resolveRoleOntologyContext({
    inferredRoleFamily: inferredRoleFamily || "",
    allText,
    dominantRoleSegment: dominantRoleSemantics.dominantRoleSegment,
    titleSegments: dominantRoleSemantics.titleSegments
  });
  const inferredSkills = unique(inferSkills(allText));
  const companyTypeResult = inferCompanyTypes(corpus);
  const inferredCompanyTypes = unique(companyTypeResult.inferredCompanyTypes || []);
  const inferredCompanyTypeConfidence = companyTypeResult.inferredCompanyTypeConfidence || {};
  const matchSignals = [];
  const mismatchSignals = [];

  preferenceProfile.industryPreference.forEach((item) => {
    if (item === inferredIndustry && ["high", "medium"].includes(inferredIndustryConfidence)) {
      matchSignals.push(`命中行业偏好：${item}`);
    } else if (item === inferredIndustry && inferredIndustryConfidence === "low") {
      mismatchSignals.push(`行业仅弱相关：${item}`);
    } else {
      mismatchSignals.push(`未命中行业偏好：${item}`);
    }
  });
  preferenceProfile.excludedIndustries.forEach((item) => {
    if (item === inferredIndustry) mismatchSignals.push(`命中排除行业：${item}`);
  });
  preferenceProfile.rolePreference.forEach((item) => {
    if (inferredRoleFamily && (item === inferredRoleFamily || includesKeyword(allText, item))) {
      matchSignals.push(`命中岗位方向：${item}`);
    } else {
      mismatchSignals.push(`未命中岗位方向：${item}`);
    }
  });
  preferenceProfile.excludedRoles.forEach((item) => {
    if (includesRoleExclusionKeyword(dominantRoleSemantics.dominantRoleSegment, item)) {
      mismatchSignals.push(`命中排除岗位（主语义）：${item}`);
    } else if (includesRoleExclusionKeyword(allText, item)) {
      mismatchSignals.push(`命中排除岗位（附带语义）：${item}`);
    }
  });
  preferenceProfile.skillPreference.forEach((item) => {
    if (inferredSkills.some((skill) => includesKeyword(skill, item) || includesKeyword(item, skill))) {
      matchSignals.push(`命中技能：${item}`);
    } else {
      mismatchSignals.push(`未命中技能：${item}`);
    }
  });
  preferenceProfile.companyPreference.forEach((item) => {
    if (inferredCompanyTypes.includes(item)) matchSignals.push(`命中公司类型偏好：${item}`);
    else mismatchSignals.push(`未命中公司类型偏好：${item}`);
  });
  preferenceProfile.avoidCompanyTypes.forEach((item) => {
    if (inferredCompanyTypes.includes(item)) mismatchSignals.push(`命中排除公司类型：${item}`);
  });

  if (industryMatch && inferredIndustryConfidence === "low") {
    mismatchSignals.push(buildIndustryEvidence(industryMatch));
  }

  return {
    preferenceType: preferenceProfile.preferenceType,
    preferenceProfile,
    inferredIndustry,
    inferredIndustryConfidence,
    inferredRoleFamily,
    inferredRoleConfidence,
    primaryRole: roleOntologyContext.primaryRole,
    adjacentRoles: roleOntologyContext.adjacentRoles,
    transferableRoles: roleOntologyContext.transferableRoles,
    roleStructureType: roleOntologyContext.roleStructureType,
    inferredSkills,
    inferredCompanyTypes,
    inferredCompanyTypeConfidence,
    titleSegments: dominantRoleSemantics.titleSegments,
    dominantRoleSegment: dominantRoleSemantics.dominantRoleSegment,
    secondaryRoleSegments: dominantRoleSemantics.secondaryRoleSegments,
    mixedRoleTitle: dominantRoleSemantics.mixedRoleTitle,
    dominantNegativeRoleSignals: dominantRoleSemantics.dominantNegativeRoleSignals,
    secondaryNegativeRoleSignals: dominantRoleSemantics.secondaryNegativeRoleSignals,
    industryEvidence: buildIndustryEvidence(industryMatch),
    matchSignals: unique(matchSignals),
    mismatchSignals: unique(mismatchSignals)
  };
}

function unique(items = []) {
  return Array.from(new Set((Array.isArray(items) ? items : []).filter(Boolean)));
}

module.exports = {
  classifyJobPreference,
  inferPreferenceProfile,
  includesKeyword
};
