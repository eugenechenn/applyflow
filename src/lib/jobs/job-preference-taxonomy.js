"use strict";

/**
 * 岗位偏好轻量 taxonomy：集中维护行业、岗位族与技能关键词。
 * strongKeywords 用于高置信度行业判断，weakKeywords 只能作为弱相关信号。
 */
const INDUSTRY_TAXONOMY = [
  {
    id: "finance",
    label: "金融",
    strongKeywords: ["银行", "证券", "基金", "保险", "投行", "券商", "信托", "期货", "金融科技"],
    mediumKeywords: ["投资银行", "投资研究", "投资交易", "投研", "资产管理", "财富管理", "合规风控", "量化"],
    weakKeywords: ["金融", "财务金融", "金融类"],
    excludedKeywords: ["财务", "会计", "出纳", "审计", "综合职能", "职能管理", "培训生", "管培生", "储备干部"]
  },
  {
    id: "education",
    label: "教育",
    strongKeywords: ["学校", "教师", "老师", "课程", "教研", "培训机构", "教育科技", "讲师", "辅导", "教学"],
    mediumKeywords: ["教育", "班主任", "主讲", "教务", "竞赛教练", "学科教师"],
    weakKeywords: ["培训"],
    excludedKeywords: ["培训生", "管理培训生", "销售培训生", "项目管理培训生", "管培生", "储备干部"]
  },
  {
    id: "game",
    label: "游戏",
    strongKeywords: ["游戏", "手游", "端游", "页游", "电竞", "游戏发行", "游戏运营", "游戏研发", "游戏工作室"],
    mediumKeywords: ["客户端u3d", "技术美术", "场景原画", "角色原画", "玩法策划"],
    weakKeywords: []
  },
  {
    id: "internet_software",
    label: "互联网/软件",
    strongKeywords: ["互联网", "软件", "saas", "平台", "系统", "开发", "前端", "后端", "客户端", "服务端"],
    mediumKeywords: ["测试开发", "技术平台", "web", "全栈"],
    weakKeywords: []
  },
  {
    id: "ai_algorithm",
    label: "AI/算法",
    strongKeywords: ["人工智能", "算法", "机器学习", "大模型", "数据科学", "深度学习", "aigc", "自然语言处理"],
    mediumKeywords: ["ai", "模型训练", "推理优化", "多模态"],
    weakKeywords: []
  },
  {
    id: "manufacturing_hardware",
    label: "制造/硬件",
    strongKeywords: ["制造", "硬件", "电子", "芯片", "半导体", "机械", "射频", "嵌入式"],
    mediumKeywords: ["工艺工程", "结构设计", "电气研发", "产线", "生产制造"],
    weakKeywords: []
  },
  {
    id: "healthcare_bio",
    label: "医疗/生物",
    strongKeywords: ["医疗", "医药", "生物", "制药", "临床", "医院", "药物"],
    mediumKeywords: ["药学", "医学", "基础医学", "口腔医学"],
    weakKeywords: []
  },
  {
    id: "consulting_business",
    label: "咨询/商业",
    strongKeywords: ["咨询", "战略", "商业分析"],
    mediumKeywords: ["行业研究", "企业服务", "商业运营"],
    weakKeywords: ["管培", "管理培训生"]
  },
  {
    id: "public_state",
    label: "政企/事业单位",
    strongKeywords: ["事业单位", "政府", "国企", "研究院", "央企"],
    mediumKeywords: ["区管国企", "事业编", "行政机关"],
    weakKeywords: []
  }
];

const ROLE_FAMILY_TAXONOMY = [
  {
    id: "engineer",
    label: "工程师",
    keywords: [
      "工程师",
      "开发",
      "研发",
      "前端",
      "后端",
      "客户端",
      "测试",
      "developer",
      "software engineer",
      "ai engineer",
      "ml engineer",
      "algorithm engineer"
    ]
  },
  {
    id: "product",
    label: "产品",
    keywords: [
      "产品经理",
      "product manager",
      "product manager",
      "data product manager",
      "growth product manager",
      "ai product manager",
      "产品策划",
      "数据产品",
      "增长产品"
    ]
  },
  {
    id: "operation",
    label: "运营",
    keywords: ["运营", "用户运营", "内容运营", "游戏运营", "商家运营", "运营专员", "growth operations"]
  },
  { id: "sales", label: "销售", keywords: ["销售", "客户经理", "商务", "bd", "sales"] },
  {
    id: "teacher",
    label: "教师",
    keywords: ["教师", "老师", "教研", "课程", "班主任", "讲师", "辅导", "教育研究", "教育科研"]
  },
  {
    id: "research",
    label: "研究",
    keywords: [
      "研究",
      "研究员",
      "行业研究",
      "实验",
      "quant",
      "financial research",
      "investment research",
      "academic research",
      "科研助理"
    ]
  },
  {
    id: "algorithm",
    label: "算法",
    keywords: [
      "算法",
      "机器学习",
      "大模型",
      "深度学习",
      "自然语言处理",
      "autonomous driving algorithm",
      "robotics algorithm",
      "感知算法",
      "规划控制"
    ]
  },
  {
    id: "data",
    label: "数据",
    keywords: [
      "数据分析",
      "数据分析师",
      "data analyst",
      "bi analyst",
      "business analyst",
      "strategy analyst",
      "growth analyst",
      "商业分析",
      "商业智能",
      "数据科学",
      "数据研发",
      "sql",
      "data product"
    ]
  },
  { id: "function", label: "职能", keywords: ["人力", "财务", "法务", "行政", "职能", "非技术岗", "综合支持"] }
];

const SKILL_TAXONOMY = [
  "Python",
  "SQL",
  "机器学习",
  "Java",
  "Golang",
  "数据分析",
  "产品",
  "算法",
  "大模型",
  "AIGC",
  "前端",
  "测试",
  "运营",
  "Tableau",
  "Excel",
  "Power BI"
];

module.exports = {
  INDUSTRY_TAXONOMY,
  ROLE_FAMILY_TAXONOMY,
  SKILL_TAXONOMY
};
