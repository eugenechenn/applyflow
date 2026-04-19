# Resume Structuring Rules

## 目标
把原始简历内容从“句子列表”升级为稳定的结构化结果，供 Tailoring Workspace、Prep Agent 和后续导出链路直接使用。

## 最终结构

### personalInfo
- 只保留：姓名、电话、邮箱、城市
- 不允许混入学校、公司、项目描述、自我评价

### workExperience
```json
[
  {
    "company": "",
    "role": "",
    "timeRange": "",
    "bullets": []
  }
]
```

识别规则：
1. 优先识别时间段，如 `2022.08-2023.10`
2. 再识别公司：
   - 含“公司 / 有限公司 / 集团 / 科技 / 管理 / 教育 / PCCW / Inc / Ltd”
3. 紧跟公司后的职位视为 `role`
4. 该 header 下的行为描述统一进入 `bullets`

禁止：
- 每一句行为描述都单独变成一条工作经历
- 把项目标题误判为公司
- 把教育经历误判为工作经历

### projectExperience
```json
[
  {
    "name": "",
    "role": "",
    "timeRange": "",
    "bullets": []
  }
]
```

识别规则：
1. 优先命中“项目 / 课题 / 方案 / 诊断 / 搭建 / 优化 / 系统 / 平台 / 小组”
2. 有时间段时保留到 `timeRange`
3. 标题下的动作、结果、方法归入 `bullets`

禁止：
- 没有项目经历时虚构项目
- 把公司任职 header 误放到项目经历

### education
```json
[
  {
    "school": "",
    "major": "",
    "timeRange": ""
  }
]
```

识别规则：
1. 只接受学校 + 专业 + 时间
2. 命中“大学 / 学院 / 本科 / 硕士 / 博士 / MBA / 专业”

禁止：
- 把课程描述、项目成果塞进教育背景

### selfEvaluation
- 只允许总结性描述
- 不允许带时间、公司、学校 header
- 不允许混入联系方式

### skills
- 只保留短 token：SQL、Excel、Python、Power BI、Tableau、AI、AI Agent、LLM、数据分析、文档写作、沟通协同、英语六级
- 不允许整句工作内容进入技能区

## 优先级规则
当标题缺失或文本混乱时，按以下顺序判断：
1. 个人信息
2. 教育背景
3. 工作经历
4. 项目经历
5. 技能
6. 自我评价

说明：
- 工作经历优先级高于项目经历，是为了避免“项目管理助理”被误打进项目经历
- 技能永远后置，只接受短 token，避免吞掉整段工作描述

## Fallback 规则
1. 如果存在明确 section 标题，优先按标题切段
2. 如果没有标题，再按时间段 + 关键词启发式建模
3. 如果仍无法确定：
   - 可以留空
   - 不允许编造内容

## 页面使用约束
1. Base Resume 必须消费结构化结果，而不是直接渲染原始句子
2. Tailored Resume 必须建立在结构化 `workExperience / projectExperience / education / selfEvaluation` 之上
3. 不允许把 Why Me、Q&A、Cover Note 混入 Tailored Resume
