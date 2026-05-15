# ApplyFlow Portfolio One-Pager

最后更新：2026-05-15

## 一句话定位

ApplyFlow 是一个“先筛后投”的半自动求职执行 Agent：帮助求职者批量处理岗位、可解释排序、管理 Shortlist/Compare 与投递状态，并通过反馈复盘持续优化判断。

它不是自动海投机器人，也不是单点简历润色工具。

## 目标用户与问题

目标用户：

- 同时管理几十到数百个岗位的求职者。
- 需要提高岗位判断质量、机会对比效率和投递流程可控性的人。
- AI / 产品 / 数据等方向需要高频定制申请材料的候选人。

核心问题：

- 岗位太多，手工逐条判断成本高。
- 普通 AI 工具常停留在内容生成，不判断岗位是否值得投。
- LLM 容易过度包装，需要用户确认边界。
- Demo、内测和真实数据如果混用，会影响产品可信度。

## 产品流程

```text
求职意图输入
→ 岗位导入 / 标准化 / 去重
→ 五维可解释排序
→ Shortlist / Compare
→ Tracker / Feedback
→ Submission Audit / Follow-up
→ Feedback Trace
```

## 核心能力

- 五维用户价值排序：role、industry、location、company、accessibility。
- 决策输出：A-F、go/review/no_go、confidence、hard blockers、next action。
- Human-in-the-loop：高风险动作不自动推进，用户反馈进入复盘链路。
- 可控执行：外部投递只做预填、dry-run 和提交前检查，不默认全自动海投。
- 反馈闭环：tracker、materials、submission audit、follow-up、feedback trace 形成求职执行台账。

## 当前证据

- Demo curated pool：`demo_user=38`，覆盖一线和新一线城市，以及 PM、数据、算法、后端、运营等方向。
- Staging real pool：`staging_real_pool_user=5001`。
- 四画像 Top100 验证：
  - 产品经理 + 上海：A10/B90。
  - 数据分析 + 上海：A14/B86。
  - 算法工程师 + 上海：A48/B52。
  - 后端开发 + 上海：A16/B84。
- 四组 `highRoleFitButLowGrade=0`。
- 2-user 白名单登录与隔离验收通过。
- forged `payload.userId` 在 profile、shortlist、tracker、feedback 写路径被拒绝。

## 技术与架构亮点

- Canonical contracts：UI 不直接消费 raw parser 输出，减少污染。
- `userPriorityScore` 排序合同：Grade、Verdict、雷达图、Compare、Gate 同源。
- Control Gate：allowed / blocked / needs_human_review，信息不足或高风险时强制人工确认。
- Structured JSON + schema validation：LLM 输出先校验，再进入业务流程。
- Eval harness：排序 gate、acceptance、real-pool role matrix、demo curated pool ranking、安全边界验证脚本。

## 内测阶段

当前阶段：

- 面试演示可用。
- 本人 dogfooding 可用。
- 3-5 人白名单内测准备阶段。
- 不是公开 SaaS。
- 不是 Production Auth Ready。
- 不是 50-user beta ready。

下一步内测证据：

- 记录朋友试用流程。
- 汇总耗时、shortlist 比例、Tailoring accept / edit / reject 比例。
- 记录 bad case、归因、处理与复测。

## 当前不足

- Production Auth 尚未接入托管 Auth，后续优先 Clerk / Auth0 / Supabase Auth。
- 代码仍存在局部大文件，需要继续拆分前端和 orchestrator。
- 线上观测体系还不完整，后续补充 P95 latency、token cost、fallback rate、用户漏斗。
- Browser apply 仍是辅助能力，不承诺跨站全自动提交。
- Demo reset endpoint 尚未产品化。

## 面试表达

> ApplyFlow 的价值不是“我会调用大模型”，而是我能把概率模型放进真实业务流程里，通过合同、评测、权限和人工确认，让它稳定地产生可用结果。
