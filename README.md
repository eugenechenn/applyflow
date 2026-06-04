# ApplyFlow

ApplyFlow 是一个面向求职场景的 AI Agent Workflow 原型：它不是“自动海投机器人”，而是帮助用户从大量岗位中做可解释排序、形成投递清单，并把投递状态持续回填成闭环。

线上体验：[https://www.apply-flow-use.com](https://www.apply-flow-use.com)

## 项目定位

求职者真实痛点不是“不会点投递按钮”，而是岗位太多、优先级难判断、投递后难追踪、AI 建议不可验证。ApplyFlow 的核心目标是把求职从零散操作变成一个可评估、可降级、可复盘的执行系统。

当前项目主链路：

1. 导入和标准化岗位数据。
2. 根据用户求职画像对岗位做规则初筛和 TopN 精排。
3. 输出 Top10、A/B/C 等级、推荐解释、风险提示和 `nextAction`。
4. 用户把岗位加入 shortlist / tracker，并回填投递、面试、拒绝等状态。
5. Edge 插件只做人工触发后的可识别字段预填，最终提交保留给用户确认。

## 为什么这不是玩具 Agent

ApplyFlow 的设计重点不是让模型“多说几句”，而是把 LLM 放进受控工作流里：

- 规则层覆盖全量岗位，保证稳定、便宜、可复测。
- 强模型只处理 Top10 核心候选，用于语义精排、解释、风险和下一步动作。
- 状态机、枚举校验、JSON 输出合同和人工确认用于限制高风险动作。
- AI 生成内容写入 derived view，不污染 canonical job 数据。
- 评估集和 Evidence Log 用于追踪命中率、Bad Case、回归和上线风险。

一句话概括：ApplyFlow 是“LLM 决策 + Workflow/Harness 治理”的求职执行系统，而不是让模型调用越多越高级的演示项目。

## 核心能力

### 岗位排序与解释

- 支持岗位方向、技能、地点、公司、申请摩擦等多维信号。
- 输出 A/B/C 等级、推荐解释、风险提示和 `nextAction`。
- 对地点字段脏数据、软硬偏好、城市不确定性保留降级和确认空间。

### 投递闭环

- `trackerState` 覆盖 saved / prep / tailored / applied / interview / rejected / offer。
- shortlist 和 compare panel 帮助用户把 Top 候选收敛成投递清单。
- feedback 以低权重 derived signal 影响后续排序，不直接改写原始岗位。

### 工程边界

- 单一数据源：官方岗位数据与 AI 衍生判断分离。
- 严格枚举校验：非法状态字段直接返回 `400`，不静默写入。
- Human-in-the-loop：插件只做预填辅助，不自动提交。
- 失败隔离：AI 异常不应破坏基础岗位浏览和状态管理。

### 评测与成本意识

- 使用真实岗位池和样本评估验证排序稳定性。
- 已记录 1000 样本评估、地点约束 Bad Case、L2 修复和复测口径。
- 成本画像脚本使用本地 mock/估算方式衡量 Top10 强模型预算，不消耗真实 API 额度。
- 面试或作品集引用成本数据时，应说明 token 是本地估算，不是供应商账单。

## 当前证据链

作品集证据文档：

- [docs/portfolio/APPLYFLOW_FEISHU_EVIDENCE_LOG_READY.md](docs/portfolio/APPLYFLOW_FEISHU_EVIDENCE_LOG_READY.md)
- [docs/APPLYFLOW_PORTFOLIO_ONE_PAGER.md](docs/APPLYFLOW_PORTFOLIO_ONE_PAGER.md)

核心截图：

- `docs/portfolio/screenshots/evidence-01-top-a-overview.png`
- `docs/portfolio/screenshots/evidence-02-top-a-card-closeup.png`
- `docs/portfolio/screenshots/evidence-03-five-dimension-explanation.png`
- `docs/portfolio/screenshots/evidence-04-apply-boundary-modal.png`

关键口径：

- 线上 D1 挂载 5001 条真实岗位，页面展示 Top 候选以保证稳定性。
- 当前 demo 不声称“全自动投递”，只展示辅助决策、状态闭环和人工确认边界。
- 未完成的 L3 全量复测或供应商账单数据，不应写成已完成事实。

## 技术栈

- Frontend / Worker：Cloudflare Workers + 原生前端页面
- Data：D1 / SQLite 风格数据源
- Validation：Node.js validation scripts + Playwright smoke
- AI 辅助：规则评分主链 + TopN 强模型精排预算位

## 本地运行

```bash
npm install
npm run dev
```

常用验证命令：

```bash
npm run validate:production-real-pool-flow
npm run measure:ai-cost-latency
```

说明：`measure:ai-cost-latency` 默认使用 mock provider，不会调用真实模型，也不会产生真实模型费用。

## 面试官阅读建议

如果只看 3 分钟，建议按这个顺序：

1. 先看线上体验，理解主流程和 Human-in-the-loop 边界。
2. 再看 Evidence Log，重点看排序评估、地点 Bad Case 归因、截图证据和复测口径。
3. 最后看 `scripts/validation/` 和 `src/lib/jobs/`，理解我如何用验证脚本、状态机和 derived view 控制 AI 不确定性。

## 项目边界

ApplyFlow 当前不是：

- 全自动海投系统
- 简历自动改写平台
- 重型 RAG 平台
- 多 Agent 生产调度系统
- 模型训练或微调项目

它的价值在于：围绕一个真实高频业务场景，把 AI 推荐、工程边界、评测闭环和产品转化指标放在同一条可解释链路里。
