/**
 * 面试演示专用岗位池（真实来源抽样，链接可直达企业投递页）。
 */

function makeJob({ id, title, company, location, jdRaw, sourceUrl, sourceLabel = "applyflow_demo_curated" }) {
  const normalizedUrl = String(sourceUrl || "").trim();
  return {
    id,
    source: "seed",
    sourceLabel,
    sourcePlatform: "demo_curated_pool",
    url: normalizedUrl,
    jobUrl: normalizedUrl,
    sourceUrl: normalizedUrl,
    applyUrl: normalizedUrl,
    company,
    title,
    location,
    department: "业务招聘",
    employmentType: "Full-time",
    salaryRange: "面议",
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
  makeJob({ id: "demo_real_001", title: "AI产品经理", company: "上海集成电路研发中心(ICRD)", location: "上海", sourceUrl: "https://app.mokahr.com/campus-recruitment/icrd/126587?locale=zh-CN&sessionid=#/jobs", jdRaw: "上海集成电路研发中心(ICRD) | AI产品经理方向，负责产品规划、需求分析与跨团队协作。 | 2026年毕业生 | 招满为止" }),
  makeJob({ id: "demo_real_002", title: "增长产品经理", company: "银行间市场数据报告库(上海)股份有限公司", location: "上海", sourceUrl: "https://yhjscsjbgk.iguopin.com/job", jdRaw: "银行间市场数据报告库(上海)股份有限公司 | 增长产品经理方向，负责数据驱动的产品增长与策略优化。 | 2025届,2026届 | 2026/3/1" }),
  makeJob({ id: "demo_real_003", title: "量化策略研究员 机器学习研究员 算法开发工程师", company: "上海蒙玺投资管理有限公司", location: "上海", sourceUrl: "https://mp.weixin.qq.com/s/RjDIWkbtPY5G8FNdx-ZUUA?scene=1", jdRaw: "上海蒙玺投资管理有限公司 | 量化策略研究员 机器学习研究员 算法开发工程师 | 2026年毕业生 | 招满为止" }),
  makeJob({ id: "demo_real_004", title: "合成生物学科学家 发酵科学家 AI算法科学家", company: "上海锐康生物技术研发有限公司", location: "上海", sourceUrl: "https://kelun.zhiye.com/campus?r=&p=1-1,3-1&c=3100&d=&k=#jlt", jdRaw: "上海锐康生物技术研发有限公司 | 合成生物学科学家 发酵科学家 AI算法科学家 | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_005", title: "运营类实习生（专业不限）", company: "上海迪士尼度假区", location: "上海", sourceUrl: "https://www.moseeker.com/position/index/pid/3286044?wechat_signature=ZjUzZDgyNjNhYTZkOTE3NjI0MDYxZWIyYTFjNDUyYjAyNGI2NjRlMg&custom=&candidate_source=1&moseeker_track_code=qy2==", jdRaw: "上海迪士尼度假区 | 运营类实习生（专业不限） | 2026届 | 2025/10/3" }),
  makeJob({ id: "demo_real_006", title: "数据分析师", company: "北京发那科", location: "北京", sourceUrl: "https://iwhih7is28.jobs.feishu.cn/campus", jdRaw: "北京发那科 | 数据分析师方向，负责业务指标体系、数据分析与策略支持。 | 2025、2026年毕业生 | 招满为止" }),
  makeJob({ id: "demo_real_007", title: "教师类;运营类", company: "北京新东方", location: "北京", sourceUrl: "https://zhaopin.xdf.cn/jobs?activityGuid=209b4396-d3c0-401b-ab03-7b67494b5764", jdRaw: "北京新东方 | 教师类;运营类 | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_008", title: "商业数据分析师", company: "北京高顿", location: "北京", sourceUrl: "https://mp.weixin.qq.com/s/DaLU6lJ0X22I9kGrOqMXfw", jdRaw: "北京高顿 | 商业数据分析师方向，负责经营分析、用户洞察与增长复盘。 | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_009", title: "管理培训生、营销经理、运营支持、金融科技专项", company: "北京银行", location: "北京", sourceUrl: "https://bankofbeijing.zhiye.com/", jdRaw: "北京银行 | 管理培训生、营销经理、运营支持、金融科技专项 | 2026届,2025届 | 2026/3/31" }),
  makeJob({ id: "demo_real_010", title: "气象预报预报算法研发气象预报 智能预报服务技术应用与研发气象综合业务", company: "北京市气象局", location: "北京", sourceUrl: "https://qxj.ywzhaopin.com/LPSC/LEAP/qxj/index.html#/recruit/list", jdRaw: "北京市气象局 | 气象预报预报算法研发气象预报 智能预报服务技术应用与研发气象综合业务 | 2026届 | 2026/2/6" }),
  makeJob({ id: "demo_real_011", title: "推荐算法工程师", company: "深圳波顿集团", location: "深圳", sourceUrl: "https://mp.weixin.qq.com/s/MXdFTHjosASlyUwOHFSJAQ", jdRaw: "深圳波顿集团 | 推荐算法工程师方向，负责模型训练、特征工程与效果评估。 | 2026届（2025年9月-2026年12月毕业） | 招满为止" }),
  makeJob({ id: "demo_real_012", title: "销售管培生 新媒体运营专员（销售）", company: "深圳中原地产", location: "深圳", sourceUrl: "https://wecruit.hotjob.cn/SU630f49b3bef57c317900128d/mc/position/campus", jdRaw: "深圳中原地产 | 销售管培生 新媒体运营专员（销售） | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_013", title: "奢侈品零售运营管培生", company: "深圳市亨吉利世界名表中心有限公司", location: "深圳", sourceUrl: "https://avicsz.zhiye.com/custom/xzzw?hideAll=true&c2=47", jdRaw: "深圳市亨吉利世界名表中心有限公司 | 奢侈品零售运营管培生 | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_014", title: "Amazon运营管培生", company: "深圳市金畅创新", location: "深圳", sourceUrl: "https://mp.weixin.qq.com/s/AAQIkEMf5ldLH_i_FouQyQ", jdRaw: "深圳市金畅创新 | Amazon运营管培生 | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_015", title: "大模型算法工程师", company: "深圳农商银行", location: "深圳", sourceUrl: "https://wecruit.hotjob.cn/SU601ce262bef57c66a91d41fa/pb/school.html", jdRaw: "深圳农商银行 | 大模型算法工程师方向，负责算法开发、推理优化与应用落地。 | 2026届,2025届 | 招满为止" }),
  makeJob({ id: "demo_real_016", title: "运营类品牌类设计类AI类研发类职能类 供应链类;", company: "广州麦和", location: "广州", sourceUrl: "https://maiheinfo1.zhiye.com/campus/jobs", jdRaw: "广州麦和 | 运营类品牌类设计类AI类研发类职能类 供应链类; | 2025届,2026届 | 2026/3/31" }),
  makeJob({ id: "demo_real_017", title: "运输技术 信号技术 通信技术 车辆技术 供电技术 机电技术 工建技术 市场经营 小语种翻译 博士后科研岗 投融资 财务 法务 中文", company: "广州地铁", location: "广州", sourceUrl: "https://gzmetro.zhiye.com/campus", jdRaw: "广州地铁 | 运输技术 信号技术 通信技术 车辆技术 供电技术 机电技术 工建技术 市场经营 小语种翻译 博士后科研岗 投融资 财务 法务 中文 | 2026届 | 2025/10/6" }),
  makeJob({ id: "demo_real_018", title: "角色原画;游戏Ul;数值策划;媒体专员(广州);场景原画;系统策划;产品运营", company: "延趣游戏", location: "广州", sourceUrl: "https://app.mokahr.com/apply/xmyanquhr/74332?sourceToken=738bd890e792d50ef839c10eb44ab4a8#/", jdRaw: "延趣游戏 | 角色原画;游戏Ul;数值策划;媒体专员(广州);场景原画;系统策划;产品运营 | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_019", title: "平台产品经理", company: "杭州智元研究院有限公司", location: "杭州", sourceUrl: "https://csgczhaopin.zhiye.com/campus/jobs", jdRaw: "杭州智元研究院有限公司 | 平台产品经理方向，负责平台能力建设与需求优先级管理。 | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_020", title: "数据产品经理", company: "杭州优云科技股份", location: "杭州", sourceUrl: "https://mp.weixin.qq.com/s/3fIE-qNhMPHoWunVS08A2w", jdRaw: "杭州优云科技股份 | 数据产品经理方向，负责数据产品设计、指标体系与业务协同。 | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_021", title: "总体工程师 算法工程师 飞控工程师 结构工程师 电气工程师 软件工程师 工艺工程师 质量工程师", company: "杭州牧星科技有限公司", location: "杭州", sourceUrl: "https://mp.weixin.qq.com/s/89yiEQklfPS-y_KrOwzahw", jdRaw: "杭州牧星科技有限公司 | 总体工程师 算法工程师 飞控工程师 结构工程师 电气工程师 软件工程师 工艺工程师 质量工程师 | 2025、2026届 | 招满为止" }),
  makeJob({ id: "demo_real_022", title: "量化研究员开发工程师Rust开发工程师后端开发工程师 市场经理", company: "杭州龙旗科技", location: "杭州", sourceUrl: "https://mp.weixin.qq.com/s/vJKWnO2LnT2n15wsAkSEVQ", jdRaw: "杭州龙旗科技 | 量化研究员开发工程师Rust开发工程师后端开发工程师 市场经理 | 2026年毕业生、实习生 | 招满即止" }),
  makeJob({ id: "demo_real_023", title: "小学科学非编教师", company: "杭州市澎汇小学", location: "杭州", sourceUrl: "https://mp.weixin.qq.com/s?__biz=MzI2NzI0MDQ5Mg==&mid=2247618183&idx=1&sn=f162fdeb5e09c1bbe257f3279090fa09&chksm=ebe725dd9c47f67e2f81d99f4ad6133d31e1fe8a70ac3bf50b8dcc8805ef7c7a2de033b87d6b&mpshare=1&scene=1&srcid=1208EUtzooofKfNyuxWI4zBP&sharer_shareinfo=9fa93a6b506e894c4e0ca2e397076c04&sharer_shareinfo_first=9fa93a6b506e894c4e0ca2e397076c04#rd", jdRaw: "杭州市澎汇小学 | 小学科学非编教师 | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_024", title: "运营经理（增长）", company: "成都精灵云", location: "成都", sourceUrl: "https://mp.weixin.qq.com/s/pNa-a3qrC206pmX2XJ0CZA", jdRaw: "成都精灵云 | 运营经理（增长）方向，负责增长策略、渠道运营与转化提升。 | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_025", title: "青少素养教师(英语方向)", company: "成都新东方", location: "成都", sourceUrl: "https://mp.weixin.qq.com/s/sRZ32KAjNzIVFRhZl832tQ", jdRaw: "成都新东方 | 青少素养教师(英语方向) | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_026", title: "业技融合岗", company: "成都银行", location: "成都", sourceUrl: "https://www.bocd.com.cn/zyxxfb/rczp/zhaopingonggao/1209122098073702400.html?sessionid=", jdRaw: "成都银行 | 业技融合岗 | 2024,2025,2026届 | 2026/2/14" }),
  makeJob({ id: "demo_real_027", title: "后端开发工程师", company: "南京创蓝科技", location: "南京", sourceUrl: "https://mp.weixin.qq.com/s/qEHFlR6wOYmKyNi8m8GUUA", jdRaw: "南京创蓝科技 | 后端开发工程师方向，负责服务端开发、接口设计与稳定性优化。 | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_028", title: "计量检测技术岗、机电类特种设备检验技术研究", company: "南京市市场监督管理局所属事业单位", location: "南京", sourceUrl: "https://rsj.nanjing.gov.cn/njsrlzyhshbzj/202512/t20251201_5701604.html", jdRaw: "南京市市场监督管理局所属事业单位 | 计量检测技术岗、机电类特种设备检验技术研究 | 2025和2026届 | 2025.12.15" }),
  makeJob({ id: "demo_real_029", title: "Java后端开发工程师", company: "南京欢乐谷", location: "南京", sourceUrl: "https://mp.weixin.qq.com/s/ZjoeUDwU87KvLtJPou7qzg", jdRaw: "南京欢乐谷 | Java后端开发工程师方向，负责业务系统开发与服务治理。 | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_030", title: "实习班主任 市场实习生 外呼实习生", company: "苏州新东方", location: "苏州", sourceUrl: "https://mp.weixin.qq.com/s/gXpowbTMFoBbiXw3rzhW7A", jdRaw: "苏州新东方 | 实习班主任 市场实习生 外呼实习生 | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_031", title: "管理培训类 金融市场类 金融科技类 业务培训类 柜面运营类 助理研究员（固收） 助理研究员（权益） 销售经理助理", company: "苏州银行", location: "苏州", sourceUrl: "https://suzhoubank.zhiye.com/campus/jobs", jdRaw: "苏州银行 | 管理培训类 金融市场类 金融科技类 业务培训类 柜面运营类 助理研究员（固收） 助理研究员（权益） 销售经理助理 | 2026届 | 2025/10/25" }),
  makeJob({ id: "demo_real_032", title: "大客户经理方向 运营方向 财务方向 项目经理 机械 算法 软件 电气 售前工程师 售后工程师 质量 采购 PMC 工艺 人事", company: "苏州灵猴机器人有限公司", location: "苏州", sourceUrl: "https://bozhon4.zhiye.com/campus", jdRaw: "苏州灵猴机器人有限公司 | 大客户经理方向 运营方向 财务方向 项目经理 机械 算法 软件 电气 售前工程师 售后工程师 质量 采购 PMC 工艺 人事 | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_033", title: "市场营销助理", company: "招商银行武汉分行", location: "武汉", sourceUrl: "https://cmb-recruitment-mobile.paas.cmbchina.com/positionList/school?recruitmentTypeId=DF94FD6D-26D3-4A19-9E69-577C4BA1DE82&orgId=102258&sessionid=", jdRaw: "招商银行武汉分行 | 市场营销助理 | 2026届 | 2025/12/28" }),
  makeJob({ id: "demo_real_034", title: "研发技术类工程技术类质量安全类信息技术类市场类平台支持类", company: "武汉楚兴技术", location: "武汉", sourceUrl: "https://app.mokahr.com/campus-recruitment/cxtwh/54032#/", jdRaw: "武汉楚兴技术 | 研发技术类工程技术类质量安全类信息技术类市场类平台支持类 | 2026年毕业生 | 招满为止" }),
  makeJob({ id: "demo_real_035", title: "三维重建算法工程师 图像算法工程师 深度学习算法工程师 点云算法工程师 C++开发工程师 WebGIS开发工程师 解决方案工程师 技术支持 销售代表", company: "武汉航天远景科技", location: "武汉", sourceUrl: "https://mp.weixin.qq.com/s/OYCePZPs2YDKj71ohHLujw", jdRaw: "武汉航天远景科技 | 三维重建算法工程师 图像算法工程师 深度学习算法工程师 点云算法工程师 C++开发工程师 WebGIS开发工程师 解决方案工程师 技术支持 销售代表 | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_036", title: "光电探测系统工程师 图像信号处理算法工程师 嵌入式软件开发工程师 伺服控制算法工程师 雷达信号处理工程师 光学设计工程师 FPGA开发工程师 硬件工程师 结构研发工程师", company: "西安导引科技有限责任公司", location: "西安", sourceUrl: "https://mp.weixin.qq.com/s/35Q8-a2ZLr9S-1rWBTBjaA?scene=1&click_id=35", jdRaw: "西安导引科技有限责任公司 | 光电探测系统工程师 图像信号处理算法工程师 嵌入式软件开发工程师 伺服控制算法工程师 雷达信号处理工程师 光学设计工程师 FPGA开发工程师 硬件工程师 结构研发工程师 | 2026年毕业生 | 招满为止" }),
  makeJob({ id: "demo_real_037", title: "科研开发岗 工艺技术岗 经营管理类", company: "西安昆仑工业（集团）有限责任公司", location: "西安", sourceUrl: "https://csgczhaopin.zhiye.com/campus/jobs?2=id25label()", jdRaw: "西安昆仑工业（集团）有限责任公司 | 科研开发岗 工艺技术岗 经营管理类 | 2026届 | 招满为止" }),
  makeJob({ id: "demo_real_038", title: "素养教师岗位 智慧学习机教师岗位高中教师岗位", company: "西安新东方", location: "西安", sourceUrl: "https://mp.weixin.qq.com/s/-QLYLWiBYPjJB4Vp-3XufA", jdRaw: "西安新东方 | 素养教师岗位 智慧学习机教师岗位高中教师岗位 | 2026届 | 招满为止" }),
];

module.exports = { demoCuratedJobs };
