// 汇总 production 样本评估中的 A/B 等级岗位质量。
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(
  process.argv[2] || process.env.EVAL_OUT_DIR || 'tmp/production-eval-1000-temp-local-user-a-full'
);
const RESULTS_PATH = path.join(OUT_DIR, 'results.ndjson');
const GRADE_SUMMARY_PATH = path.join(OUT_DIR, 'production-eval-1000-grade-summary.json');
const GRADE_REPORT_PATH = path.join(OUT_DIR, 'production-eval-1000-grade-report.json');
const GRADE_CSV_PATH = path.join(OUT_DIR, 'production-eval-1000-grade-cases.csv');

const roles = [
  ['AI产品经理', ['AI产品', '产品经理', 'AI PM', '大模型产品', '智能体', 'Agent']],
  ['产品经理', ['产品经理', '产品运营', '产品助理']],
  ['数据分析师', ['数据分析', 'BI', '商业分析', '数据运营']],
  ['商业分析师', ['商业分析', '经营分析', '战略分析', '数据分析']],
  ['运营', ['运营', '用户运营', '产品运营', '内容运营']],
  ['用户增长', ['用户增长', '增长运营', '增长', '活动运营']],
  ['财务分析', ['财务', '财务分析', 'FP&A', '经营分析']],
  ['审计', ['审计', '内控', '风控', '合规']],
  ['销售管培生', ['销售', '管培生', '客户经理', '渠道']],
  ['BD商务拓展', ['BD', '商务', '商务拓展', '渠道']],
  ['后端开发', ['后端', 'Java', '服务端', 'Go']],
  ['前端开发', ['前端', 'React', 'Vue', 'Web']],
  ['算法工程师', ['算法', '算法工程师', '机器学习', '深度学习']],
  ['机器学习工程师', ['机器学习', 'ML', '算法', '深度学习']],
  ['AI应用工程师', ['AI应用', '大模型应用', 'LLM', 'Agent', 'AI工程师']],
  ['AIGC内容策略', ['AIGC', '内容策略', '内容安全', 'AI内容']],
  ['内容运营', ['内容运营', '新媒体', '社区运营', '内容']],
  ['市场营销', ['市场', '营销', '品牌', '投放']],
  ['供应链管培生', ['供应链', '采购', '物流', '管培生']],
  ['人力资源', ['人力资源', 'HR', '招聘', '组织发展']]
];
const roleAliasesByName = new Map(roles.map(([role, aliases]) => [role, aliases]));

function industryAliases(industry) {
  return ({
    'AI/算法': ['AI', '人工智能', '算法', '大模型', '机器学习', '智能'],
    '互联网/软件': ['互联网', '软件', 'SaaS', '平台', '系统', 'Web'],
    '金融': ['金融', '证券', '银行', '基金', '保险', '投资'],
    '教育': ['教育', '培训', '学校', '学习', '课程'],
    '消费零售': ['消费', '零售', '电商', '品牌', '门店'],
    '企业服务': ['企业服务', 'ToB', 'B端', 'SaaS', 'CRM', 'ERP'],
    '游戏': ['游戏', '手游', '互娱', '发行'],
    '新能源/汽车': ['新能源', '汽车', '车', '智能驾驶', '自动驾驶'],
    '医疗健康': ['医疗', '健康', '医药', '医院', '生命科学'],
    '制造/供应链': ['制造', '供应链', '采购', '物流', '工厂']
  })[industry] || [industry];
}

function includesAny(text, terms) {
  const lower = String(text || '').toLowerCase();
  return terms.some((term) => lower.includes(String(term).toLowerCase()));
}

function loadNdjson(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function normalizedGrade(job) {
  return String(job?.grade || '').trim().toUpperCase();
}

function jobHit(profile, job) {
  const roleAliases = roleAliasesByName.get(profile.role) || [profile.role];
  const industryTerms = industryAliases(profile.industry);
  const text = [
    job.title,
    job.company,
    job.location,
    job.inferredIndustry,
    job.inferredRoleFamily,
    job.explanation,
    (job.matchSignals || []).join(' ')
  ].join(' ');
  const roleHit = includesAny(text, roleAliases);
  const cityHit = String(job.location || '').includes(profile.city);
  const industryHit = includesAny(text, industryTerms);
  const related = roleHit && (cityHit || industryHit || (job.score || 0) >= 80);
  return { roleHit, cityHit, industryHit, related };
}

function analyzeGradeQuality(row) {
  const top10 = row.top10 || [];
  const top1 = top10[0] || {};
  const gradeA = top10.filter((job) => normalizedGrade(job) === 'A');
  const gradeB = top10.filter((job) => normalizedGrade(job) === 'B');
  const gradeAB = top10.filter((job) => ['A', 'B'].includes(normalizedGrade(job)));
  const gradeABHits = gradeAB.map((job) => jobHit(row.profile, job));
  const badReasons = [];

  if (!gradeAB.length) {
    badReasons.push('Top10无A/B等级岗位');
  } else {
    if (!gradeABHits.some((hit) => hit.roleHit)) badReasons.push('A/B岗位无岗位方向命中');
    if (!gradeABHits.some((hit) => hit.cityHit)) badReasons.push('A/B岗位无城市命中');
    if (!gradeABHits.some((hit) => hit.industryHit)) badReasons.push('A/B岗位无行业命中');
    if (!gradeABHits.some((hit) => hit.related)) badReasons.push('A/B岗位无综合相关命中');
  }

  return {
    top1Grade: normalizedGrade(top1),
    top1IsA: normalizedGrade(top1) === 'A',
    top1IsB: normalizedGrade(top1) === 'B',
    top1IsAB: ['A', 'B'].includes(normalizedGrade(top1)),
    top10GradeACount: gradeA.length,
    top10GradeBCount: gradeB.length,
    top10GradeABCount: gradeAB.length,
    hasGradeA: gradeA.length > 0,
    hasGradeB: gradeB.length > 0,
    hasGradeAB: gradeAB.length > 0,
    gradeABHasRoleHit: gradeABHits.some((hit) => hit.roleHit),
    gradeABHasCityHit: gradeABHits.some((hit) => hit.cityHit),
    gradeABHasIndustryHit: gradeABHits.some((hit) => hit.industryHit),
    gradeABHasRelated: gradeABHits.some((hit) => hit.related),
    gradeABBadCase: badReasons.length > 0,
    gradeABBadReasons: badReasons
  };
}

function percent(numerator, denominator) {
  return denominator ? Number((numerator / denominator * 100).toFixed(1)) : 0;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const results = loadNdjson(RESULTS_PATH);
const rows = results.map((row) => ({ ...row, gradeJudgment: analyzeGradeQuality(row) }));
const gradeDistributionTop10 = {};
for (const row of rows) {
  for (const job of row.top10 || []) {
    const grade = normalizedGrade(job) || 'UNKNOWN';
    gradeDistributionTop10[grade] = (gradeDistributionTop10[grade] || 0) + 1;
  }
}

const casesWithAB = rows.filter((row) => row.gradeJudgment.hasGradeAB);
const sum = (fn) => rows.reduce((total, row) => total + fn(row), 0);
const rateAll = (fn) => percent(rows.filter(fn).length, rows.length);
const rateAB = (fn) => percent(casesWithAB.filter(fn).length, casesWithAB.length);
const gradeABBadReasonCounts = {};
for (const row of rows) {
  for (const reason of row.gradeJudgment.gradeABBadReasons) {
    gradeABBadReasonCounts[reason] = (gradeABBadReasonCounts[reason] || 0) + 1;
  }
}

const summary = {
  sourceResultsPath: RESULTS_PATH,
  generatedAt: new Date().toISOString(),
  completedCases: rows.length,
  top1GradeARate: rateAll((row) => row.gradeJudgment.top1IsA),
  top1GradeBRate: rateAll((row) => row.gradeJudgment.top1IsB),
  top1GradeABRate: rateAll((row) => row.gradeJudgment.top1IsAB),
  casesWithGradeARate: rateAll((row) => row.gradeJudgment.hasGradeA),
  casesWithGradeBRate: rateAll((row) => row.gradeJudgment.hasGradeB),
  casesWithGradeABRate: rateAll((row) => row.gradeJudgment.hasGradeAB),
  avgGradeACountPerTop10: rows.length ? Number((sum((row) => row.gradeJudgment.top10GradeACount) / rows.length).toFixed(2)) : 0,
  avgGradeBCountPerTop10: rows.length ? Number((sum((row) => row.gradeJudgment.top10GradeBCount) / rows.length).toFixed(2)) : 0,
  avgGradeABCountPerTop10: rows.length ? Number((sum((row) => row.gradeJudgment.top10GradeABCount) / rows.length).toFixed(2)) : 0,
  gradeABHasRoleHitRateAllCases: rateAll((row) => row.gradeJudgment.gradeABHasRoleHit),
  gradeABHasCityHitRateAllCases: rateAll((row) => row.gradeJudgment.gradeABHasCityHit),
  gradeABHasIndustryHitRateAllCases: rateAll((row) => row.gradeJudgment.gradeABHasIndustryHit),
  gradeABHasRelatedRateAllCases: rateAll((row) => row.gradeJudgment.gradeABHasRelated),
  gradeABHasRoleHitRateAmongABCases: rateAB((row) => row.gradeJudgment.gradeABHasRoleHit),
  gradeABHasCityHitRateAmongABCases: rateAB((row) => row.gradeJudgment.gradeABHasCityHit),
  gradeABHasIndustryHitRateAmongABCases: rateAB((row) => row.gradeJudgment.gradeABHasIndustryHit),
  gradeABHasRelatedRateAmongABCases: rateAB((row) => row.gradeJudgment.gradeABHasRelated),
  gradeABBadCaseRateAllCases: rateAll((row) => row.gradeJudgment.gradeABBadCase),
  gradeABBadCaseRateAmongABCases: rateAB((row) => row.gradeJudgment.gradeABBadCase),
  gradeABBadCaseCount: rows.filter((row) => row.gradeJudgment.gradeABBadCase).length,
  gradeABBadReasonCounts,
  gradeDistributionTop10
};

fs.writeFileSync(GRADE_SUMMARY_PATH, JSON.stringify(summary, null, 2), 'utf8');
fs.writeFileSync(GRADE_REPORT_PATH, JSON.stringify({ summary, results: rows }, null, 2), 'utf8');

const csvLines = [
  'caseId,role,city,industry,top1Grade,top10GradeACount,top10GradeBCount,top10GradeABCount,hasGradeAB,gradeABHasRoleHit,gradeABHasCityHit,gradeABHasIndustryHit,gradeABHasRelated,gradeABBadCase,gradeABBadReasons'
];
for (const row of rows) {
  const g = row.gradeJudgment;
  csvLines.push([
    row.caseId,
    row.profile.role,
    row.profile.city,
    row.profile.industry,
    g.top1Grade,
    g.top10GradeACount,
    g.top10GradeBCount,
    g.top10GradeABCount,
    g.hasGradeAB,
    g.gradeABHasRoleHit,
    g.gradeABHasCityHit,
    g.gradeABHasIndustryHit,
    g.gradeABHasRelated,
    g.gradeABBadCase,
    g.gradeABBadReasons.join('|')
  ].map(csvCell).join(','));
}
fs.writeFileSync(GRADE_CSV_PATH, csvLines.join('\n'), 'utf8');

console.log(JSON.stringify(summary, null, 2));
