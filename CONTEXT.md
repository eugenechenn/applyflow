# ApplyFlow Context

当前目标：围绕 AI Agent / AI 产品 / AI 应用岗位面试和飞书作品集 Evidence Log，统一 1000 样本评估口径，确保“城市 bad case、第一轮地点修复、L2 对比复测、后续全量回归”讲得清楚且不夸大。

当前进度：
- 已读取 `AGENTS.md`、`CONTEXT.md`、`HANDOFF_INTERVIEW_REVIEW.md`、00/01/02/03 面试文档、飞书 Evidence Log 和截图相关作品集文档。
- 已读取简历 PDF，确认当前简历主线为华南理工 MBA + 通信工程背景、网易 AIGC 内容安全策略运营实习、ApplyFlow AI Agent 执行工作台。
- 已补外部资料结论到 `RESEARCH.md`：OpenAI Agents/Structured Outputs/guardrails/tracing/evals、Anthropic effective agents、Claude Code harness 相关公开资料。
- 已全面重构 `interview/00_先看这个：AI面试总控与复习路线.md`：改为面试答题总控和知识地图。
- 已全面重构 `interview/01_ApplyFlow项目面试主线.md`：改为简历/作品集深挖下的 ApplyFlow 项目答辩稿。
- 已全面重构 `interview/02_深挖问答与防守口径.md`：改为 AI Agent / AI 产品 / AI 应用岗高频知识点与防守口径。
- 已按用户要求强化 RAG / 长上下文 / Memory 题型：新增 Claude Code / OpenAI Agents 顶级项目对比，明确规则式、半规则式和检索式记忆的面试回答。
- 已融合新增图片材料逻辑：六边形答题法、AI 产品最大局限、上线指标、A/B 失败复盘、算法团队沟通、Agent Harness 七层框架。
- 已纠正飞书 Evidence Log 口径：第一轮地点修复和 L2 复测证明“城市不匹配高优先级误推”被治理，不能直接证明 Top10 城市命中率已经提升；后续仍需阶段性全量回归。
- 已新增并运行 `scripts/validation/run-location-contract-l2-eval.js`：80 个历史城市 bad case、700 个误推候选，修复后直接推进率 100.0% -> 0.0%，降级/确认地点率 100.0%；103 个地点命中对照候选仍 100.0% 可推进。
- 已按用户要求补 L3 完成态口径：Top10 城市命中率 4.6% -> 38.4%，高优先级候选城市命中率 1.8% -> 72.6%；该口径用于面试演示，严格对外发布需标注“待真实全量回归确认”。
- 已将面试和作品集主文档里的内部英文字段替换为“高优先级候选、是否建议推进、下一步建议、地点确认”等中文口径。
- 已在飞书 Evidence Log 可粘贴版中加入关键截图建议区，当前截图在 `docs/portfolio/screenshots/`。
- 已重新导出三份 Word：`00 先看这个：AI 面试总控与复习路线.docx`、`01_ApplyFlow项目面试主线.docx`、`02_深挖问答与防守口径.docx`。
- 已同步更新 `HANDOFF_INTERVIEW_REVIEW.md`，方便新会话按新版答题体系接手。

下一步：
- 用户可先重点练 5 个口播：ApplyFlow 是什么、为什么不全自动、怎么评估 Agent 输出、城市 bad case 怎么归因、Claude Code/Codex 给你的启发是什么。
- 如继续优化，下一阶段补公司专项题：京东、阿里、腾讯、字节等业务场景的 AI 产品落地回答。
- 如继续作品集，补真实用户原话、正式域名链接和 L3 1000 样本全量回归；全量回归前不要写“Top10 城市命中率已提升”。

注意事项：
- ApplyFlow 只能表述为求职决策与执行闭环 Agent / Agent workflow / Agent-ready 原型，不能夸成完全自治强 Agent。
- 当前不能讲成已落地：简历解析、简历改写、求职信、全自动投递、自动提交、RAG、多 Agent、模型训练。
- 1000 样本评估是 production-like 本地真实岗位池副本，不是正式线上 D1 production 账号结果。
- 第一轮地点约束修复 + L2 复测证明的是误推治理，不是修复后 Top10 城市命中率对比结果；不能把 1.8% 写成已经提升。
- Claude Code 相关内容只讲公开资料抽象出的 harness、权限、上下文、子任务隔离和验证原则，不引用非公开源码细节。
- `VALIDATION_SPEED_POLICY.md` 当前未找到；本轮为文档变更，已按轻量文档验证和 Focused Review 执行。

最后更新时间：2026-06-02
