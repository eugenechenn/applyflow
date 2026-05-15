/**
 * 面试演示专用岗位池（小而完整，可重复）。
 * 目标：覆盖一线+新一线城市与核心演示岗位，便于展示“岗位+城市偏好”排序差异。
 */

function makeJob({
  id,
  title,
  company,
  location,
  jdRaw,
  sourceLabel = "applyflow_demo_curated",
  sourceUrl = "https://demo.applyflow.local/job"
}) {
  return {
    id,
    source: "seed",
    sourceLabel,
    sourcePlatform: "demo_curated_pool",
    url: `${sourceUrl}/${id}`,
    sourceUrl: `${sourceUrl}/${id}`,
    company,
    title,
    location,
    department: "业务招聘",
    employmentType: "Full-time",
    salaryRange: "20k-45k / 月",
    jdRaw,
    status: "inbox",
    priority: "medium",
    metadata: {
      sourceTag: "demo_curated_pool_v1",
      sourceVersion: "demo_curated_pool_v20260515"
    },
    createdAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T00:00:00.000Z"
  };
}

const demoCuratedJobs = [
  // 上海 4
  makeJob({ id: "demo_pm_sh_001", title: "AI产品经理", company: "沐星智能", location: "上海", jdRaw: "负责AI产品规划、需求分析、跨团队协作与上线迭代。" }),
  makeJob({ id: "demo_pm_sh_002", title: "增长产品经理", company: "海豚电商", location: "上海", jdRaw: "负责增长漏斗、用户分层策略、实验设计与增长分析。" }),
  makeJob({ id: "demo_be_sh_001", title: "商业分析师", company: "申城云服", location: "上海", jdRaw: "负责经营分析、数据看板、策略复盘与业务诊断。" }),
  makeJob({ id: "demo_pool_sh_001", title: "产品经理 / 数据分析 / 运营管培生", company: "申海数科", location: "上海", jdRaw: "综合入口岗，覆盖产品、运营、数据方向，需轮岗。" }),

  // 北京 4
  makeJob({ id: "demo_da_bj_001", title: "数据分析师", company: "北辰数据", location: "北京", jdRaw: "负责数据建模、指标体系建设、业务分析和复盘。" }),
  makeJob({ id: "demo_da_bj_002", title: "增长数据分析师", company: "京跃互联", location: "北京", jdRaw: "负责增长策略分析、用户行为挖掘、实验评估。" }),
  makeJob({ id: "demo_pm_bj_001", title: "平台产品经理", company: "京桥SaaS", location: "北京", jdRaw: "负责平台产品规划、需求管理、上线与迭代。" }),
  makeJob({ id: "demo_pool_bj_001", title: "商业分析 / 运营 / 产品储备", company: "中枢科技", location: "北京", jdRaw: "多岗位入口，按项目需要分配业务方向。" }),

  // 深圳 4
  makeJob({ id: "demo_algo_sz_001", title: "推荐算法工程师", company: "深智引擎", location: "深圳", jdRaw: "负责推荐算法优化、特征工程、模型训练与线上评估。" }),
  makeJob({ id: "demo_algo_sz_002", title: "大模型算法工程师", company: "鹏城模型", location: "深圳", jdRaw: "负责大模型应用算法、推理优化、评估体系建设。" }),
  makeJob({ id: "demo_be_sz_001", title: "后端开发工程师", company: "深连云", location: "深圳", jdRaw: "负责后端服务开发、性能优化、稳定性建设。" }),
  makeJob({ id: "demo_pool_sz_001", title: "算法 / 后端 / 测试工程师", company: "前湾智能", location: "深圳", jdRaw: "高价值入口岗，按技术方向分流。" }),

  // 广州 3
  makeJob({ id: "demo_pm_gz_001", title: "电商产品经理", company: "粤选电商", location: "广州", jdRaw: "负责电商平台产品规划、商家运营工具设计与转化优化。" }),
  makeJob({ id: "demo_ops_gz_001", title: "用户运营", company: "南城社区", location: "广州", jdRaw: "负责用户增长、留存策略、内容运营与活动策划。" }),
  makeJob({ id: "demo_da_gz_001", title: "商业数据分析师", company: "珠江企服", location: "广州", jdRaw: "负责经营数据分析、业务策略支持和决策洞察。" }),

  // 杭州 4
  makeJob({ id: "demo_pm_hz_001", title: "平台产品经理", company: "杭云平台", location: "杭州", jdRaw: "负责平台能力建设、需求优先级、跨团队交付。" }),
  makeJob({ id: "demo_pm_hz_002", title: "数据产品经理", company: "湖畔数据", location: "杭州", jdRaw: "负责数据产品设计、指标体系、数据服务能力。" }),
  makeJob({ id: "demo_da_hz_001", title: "商业分析师", company: "钱塘增长", location: "杭州", jdRaw: "负责业务分析、增长诊断、策略建议输出。" }),
  makeJob({ id: "demo_pool_hz_001", title: "产品经理 / 商业分析 / 运营", company: "西湖数字", location: "杭州", jdRaw: "综合岗位入口，兼顾产品与商业分析能力。" }),

  // 成都 3
  makeJob({ id: "demo_ops_cd_001", title: "运营经理（增长）", company: "蜀都内容", location: "成都", jdRaw: "负责增长策略、渠道运营、活动转化。" }),
  makeJob({ id: "demo_be_cd_001", title: "后端开发工程师", company: "天府云核", location: "成都", jdRaw: "负责后端系统研发、接口设计、系统优化。" }),
  makeJob({ id: "demo_pool_cd_001", title: "管培生（产品/运营/数据）", company: "蓉创科技", location: "成都", jdRaw: "轮岗培养，按业务需求分流至产品、运营、数据方向。" }),

  // 南京 3
  makeJob({ id: "demo_be_nj_001", title: "后端开发工程师", company: "金陵企服", location: "南京", jdRaw: "负责企业服务后端开发、稳定性与性能优化。" }),
  makeJob({ id: "demo_be_nj_002", title: "Java后端工程师", company: "宁算智能", location: "南京", jdRaw: "负责Java服务开发、中台能力建设与故障治理。" }),
  makeJob({ id: "demo_pm_nj_001", title: "工业互联网产品经理", company: "江宁智造", location: "南京", jdRaw: "负责工业互联网产品需求与交付。" }),

  // 苏州 3
  makeJob({ id: "demo_be_szhou_001", title: "软件工程师（后端）", company: "苏城数字", location: "苏州", jdRaw: "负责后端研发、服务治理、接口性能优化。" }),
  makeJob({ id: "demo_da_szhou_001", title: "供应链数据分析师", company: "吴中供应链", location: "苏州", jdRaw: "负责供应链数据建模、库存优化、履约分析。" }),
  makeJob({ id: "demo_pool_szhou_001", title: "工程师 / 产品 / 运营储备", company: "太湖创新", location: "苏州", jdRaw: "综合入口岗，支持工程、产品、运营方向。" }),

  // 武汉 3
  makeJob({ id: "demo_da_wh_001", title: "数据分析师", company: "江城增长", location: "武汉", jdRaw: "负责增长分析、用户洞察与策略复盘。" }),
  makeJob({ id: "demo_ops_wh_001", title: "商业运营", company: "楚天企服", location: "武汉", jdRaw: "负责商业运营策略与执行落地。" }),
  makeJob({ id: "demo_be_wh_001", title: "后端开发工程师", company: "光谷云算", location: "武汉", jdRaw: "负责云服务后端研发与可用性建设。" }),

  // 西安 3
  makeJob({ id: "demo_algo_xa_001", title: "算法工程师", company: "秦岭智能", location: "西安", jdRaw: "负责机器学习算法开发、评估与部署优化。" }),
  makeJob({ id: "demo_be_xa_001", title: "后端开发工程师", company: "长安软件", location: "西安", jdRaw: "负责后端服务开发、数据接口与平台治理。" }),
  makeJob({ id: "demo_pool_xa_001", title: "技术管培生（算法/后端/测试）", company: "西部数科", location: "西安", jdRaw: "技术方向入口岗，按能力与项目分流。" }),

  // 额外补充 4（提高可区分性）
  makeJob({ id: "demo_pm_sz_002", title: "AI应用产品经理", company: "南海智联", location: "深圳", jdRaw: "负责AI应用产品落地、业务场景抽象与迭代。" }),
  makeJob({ id: "demo_da_bj_003", title: "数据策略分析师", company: "京杭策略", location: "北京", jdRaw: "负责数据策略、经营洞察与决策支持。" }),
  makeJob({ id: "demo_algo_hz_001", title: "机器学习工程师", company: "钱江算法", location: "杭州", jdRaw: "负责机器学习模型训练、实验评估与上线优化。" }),
  makeJob({ id: "demo_be_sh_002", title: "后端开发工程师（SaaS）", company: "浦江企服", location: "上海", jdRaw: "负责SaaS后端研发、多租户能力与稳定性优化。" })
];

module.exports = { demoCuratedJobs };

