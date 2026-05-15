# ApplyFlow AI 面试作品集复习手册

最后更新：2026-05-15

## 0. 使用方式

这份文档的目标不是把 ApplyFlow 讲得“很大”，而是帮你在 AI 产品经理、AI 应用工程、Agent 产品/应用岗面试中，把它讲成一个经得起追问的作品集项目。

面试主线只有一句话：

> ApplyFlow 不是一键海投机器人，而是一个把求职从“拍脑袋海投”变成“岗位发现、可解释排序、状态管理、反馈复盘”的半自动求职执行系统。

准备时优先背熟：

1. `30 秒开场`
2. `3 分钟项目叙事`
3. `五个深挖问题`
4. `优势与不足`
5. `演示路径`

## 1. 面试定位

### 1.1 你要应聘的岗位画像

ApplyFlow 最适合支撑这些岗位：

- AI 产品经理：强调业务闭环、需求判断、AI 边界、人机协作。
- AI 应用产品/解决方案：强调从 Demo 到可用系统的工程化、评测、上线边界。
- Agent 产品/应用工程：强调工具调用治理、状态机、工作流、可观测性、回归验证。
- 初级 AI PM / AI Builder：强调能独立把模糊问题拆成产品链路并落地。

不建议把它包装成：

- 纯算法研究项目。
- 大规模 SaaS 已上线项目。
- 全自动投递机器人。
- 重型 RAG 平台。

你最稳的定位是：

> 我做的是一个垂直场景 AI Agent 产品原型，但重点不是炫模型能力，而是把 LLM 的不确定性关进可控流程里，让求职这个真实任务可以被批量处理、解释、确认和复盘。

## 2. 30 秒开场

> ApplyFlow 是一个面向求职者的半自动求职执行系统。用户输入求职意图后，系统会批量导入岗位，做去重、标准化和五维可解释排序，再把高优先级岗位推进到 Shortlist、Compare、投递状态管理和 follow-up 流程。
> 我没有把它做成“自动海投机器人”，因为真实求职里最大的风险不是点不点提交，而是岗位判断不准、流程不可追踪、AI 推荐不可解释和用户数据串号。所以我重点做了三件事：第一，用 `userPriorityScore` 把排序和评估合同统一；第二，用 tracker/feedback 把求职过程做成可复盘状态流；第三，用 demo/beta 隔离和 forged userId 拒绝来保证演示与内测边界。
> 目前它已经有 5001 条 staging 真实岗位池验证、38 条可复现 demo curated pool、A/B 白名单用户隔离验证，以及一套针对排序、UI、Auth 边界的回归脚本。

## 3. 3 分钟项目叙事

### U - User

目标用户是同时管理几十到数百个岗位的求职者，尤其是校招、转行、AI/产品/数据方向候选人。他们不是缺一个“写简历按钮”，而是缺一个持续管理岗位判断、优先级排序和投递进度的执行系统。

### P - Problem

真实痛点有四个：

- 岗位信息太多，手工看 JD 成本高，容易海投。
- 普通 AI 工具常停留在单点生成，不知道这条岗位该不该投。
- LLM 会过度包装或编造经历，需要用户确认边界。
- 演示、测试、真实用户数据容易混用，一旦多用户内测就会变成信任问题。

### S - Solution

ApplyFlow 把求职拆成五段：

- 岗位发现与导入：URL、离线岗位池、飞书记录等来源进入 canonical job。
- 排序决策：根据用户偏好构造 `userPriorityScore`，输出 A-F、go/review/no_go、confidence、hard blockers。
- 状态推进：通过 Shortlist、Compare、tracker、feedback 管理岗位推进过程。
- 人工确认：高风险或信息不足的流程不自动推进，保留用户确认和复盘入口。
- 执行与反馈：tracker、materials、submission audit、follow-up、feedback trace 形成闭环。

### R - Result

当前能讲的结果：

- staging 真实池 `staging_real_pool_user=5001`，四类画像 Top100 全部 A/B 覆盖，`highRoleFitButLowGrade=0`。
- demo curated pool `demo_user=38`，覆盖一线和新一线城市，PM、数据、算法、后端、运营等方向可复现展示偏好差异。
- A/B 白名单用户可登录并互不串扰，登录身份不是 `demo_user`。
- forged `payload.userId` 在 profile、shortlist、tracker、feedback 写路径被拒绝。
- 排序核心、demo、真实池、beta 用户数据有明确隔离边界。

### L - Learning

最大的学习不是“怎么调 Prompt”，而是：

> AI Agent 真正难的是把概率模型放进稳定系统。模型可以负责理解和生成，但系统必须负责 schema、校验、状态、权限、回滚和评测。

## 4. ApplyFlow 如何映射 Agent 六大模块

### 感知模块

ApplyFlow 的感知不是聊天输入，而是岗位、偏好和用户历史：

- `job ingestion` 解析岗位。
- `profile / preference schema` 结构化用户求职偏好。
- `jobPreferenceProfile` 表达用户求职意图。
- offline JSON / 飞书数据 / demo seed 承载岗位来源。

面试说法：

> 我没有把输入直接塞给模型，而是先标准化为 canonical contracts。这样后续 UI、排序和状态管理都不会直接消费 raw text，减少污染。

### 规划模块

规划体现在 workflow controller、stage runner、tracker 状态机：

- 从岗位发现到准入、排序、准备、投递、复盘。
- tracker 状态：`none / saved / prep / applied / interview / rejected / offer`。
- shortlist、compare、submission audit、follow-up 都是可控 metadata，不污染 canonical job。

面试说法：

> 我把 Agent 做成 workflow 加状态机，而不是让模型自由决定下一步。模型输出建议，系统决定能不能进入下一阶段。

### 记忆模块

ApplyFlow 的记忆是结构化的：

- 用户长期偏好：`jobPreferenceProfile`。
- 行为反馈：`good_fit / bad_fit / misclassified`。
- 申请历史：tracker、timeline、submission audit。
- 但 eval 路径隔离 feedback influence，避免评估被历史反馈污染。

面试说法：

> 记忆不是无限塞 Prompt，而是分成偏好、状态和反馈。哪些能影响排序、哪些只做解释、哪些只做时间线，都有边界。

### 工具调用模块

工具包括：

- JD fetcher / URL import。
- PDF/DOCX export。
- browser apply / Edge autofill。
- Cloudflare D1 / SQLite store。
- LLM structured JSON generation。

面试说法：

> 工具不是直接让 LLM 随便调，而是通过 contract、schema、枚举校验和 control gate 接入。高风险的外部投递只做 dry-run 和人工确认，不自动提交。

### 执行模块

执行不是“点击提交”，而是：

- 申请准备包生成。
- 投递审计。
- follow-up。
- 浏览器辅助预填。
- 人工确认后推进。

面试说法：

> 我刻意放弃默认全自动海投，因为这个场景里全自动不是产品优势，而是风险来源。我的执行层核心是可控、可审计、可回放。

### 反馈优化模块

反馈包括：

- 用户对岗位的反馈状态。
- 用户对岗位的 good_fit / bad_fit / misclassified 反馈。
- Bad case 与 diagnostic cases。
- acceptance/gate/full eval。

面试说法：

> 反馈不是一句“用户觉得好用”，而是进系统：进入 trace、进入 eval、进入下一轮排序解释，但不能绕过 hard blocker。

## 5. ApplyFlow 的核心优势

### 5.1 它不是 LLM Wrapper

普通玩具项目常见形态是“输入 JD，调用大模型，生成简历”。ApplyFlow 的差异是有完整生命周期：

- 求职意图输入。
- 岗位池导入、去重、排序。
- 决策解释。
- 状态管理。
- 人工确认。
- 申请执行。
- 反馈追踪。

可以这样说：

> 我最开始也能做一个“输入岗位、输出建议”的 Demo，但很快发现那不是产品。真正的问题是岗位该不该投、为什么投、后续状态如何管理、反馈如何进入下一轮判断。所以我把它拆成了 contracts、view model、control gate 和 feedback trace。

### 5.2 排序合同清晰

核心证据：

- `userPriorityScore` 五维：role、industry、location、company、accessibility。
- Grade / Verdict / 雷达图 / Compare / Gate 同源。
- `opportunityType`、source governance、job quality 主要做解释与诊断，不回流主排序。
- Phase 10X 把 eval 合同迁移到用户价值排序，不再被旧 label precision 绑架。

面试亮点：

> 我遇到过一个典型 AI 产品问题：生产排序已经面向用户价值，但旧 eval 还在用历史标签命中率判断，这会逼着系统为了通过测试反向伤害用户体验。我后来把评估合同迁移到 `userPriorityScore`，让产品目标、排序、UI 和 gate 对齐。

### 5.3 有真实池和演示池两套证据

真实池：

- `staging_real_pool_user=5001`。
- 四画像 Top100 验收：
  - 产品经理 + 上海：A10/B90。
  - 数据分析 + 上海：A14/B86。
  - 算法工程师 + 上海：A48/B52。
  - 后端开发 + 上海：A16/B84。
- 四组 `highRoleFitButLowGrade=0`。

演示池：

- `demo_user=38` curated pool。
- 覆盖上海、北京、深圳、广州、杭州、成都、南京、苏州、武汉、西安。
- 覆盖 PM、数据、算法、后端、运营与少量入口型岗位。
- 多画像 Top5/Top20 可展示偏好改变后的排序变化。

面试说法：

> 我把 demo pool 和 real pool 分开。demo pool 是小而完整、可复现的面试样例；real pool 用来验证系统在 5000+ 真实岗位上的排序稳定性。两者不互相污染，也不为了演示好看去改排序核心。

### 5.4 状态管理和反馈闭环做得具体

ApplyFlow 不只给岗位打分，还管理用户后续动作：

- Shortlist：把值得继续看的岗位收进候选池。
- Compare：对比多个候选岗位的分数、解释、风险和下一步。
- Tracker：记录 saved / prep / applied / interview / rejected / offer 等状态。
- Feedback：用户可标记 good_fit / bad_fit / misclassified，作为后续排序解释的低风险信号。
- Submission audit / follow-up：记录投递尝试、状态、备注和后续动作。

面试说法：

> 我没有把 ApplyFlow 做成“推荐完就结束”的工具，而是把岗位判断之后的执行动作也纳入状态管理。这样产品不只回答“哪个岗位更好”，还回答“我下一步该怎么推进、推进到哪里、哪些判断需要复盘”。

### 5.5 安全边界有治理

已完成的边界：

- 普通路径不自动 demo 登录。
- demo 与 beta 用户分离。
- A/B 白名单用户互不串扰。
- `/api/auth/users` 非公开。
- `/api/login` 受控。
- forged `payload.userId` 被拒绝。
- 写入路径基于 authenticated user，不信任前端 userId。

面试说法：

> 我在准备内测时发现，单用户 demo 很容易隐藏数据归属问题。所以专门做了 `user_a fallback / payload.userId` 治理，确保 beta/staging 写入不能靠前端传 userId 决定归属。

### 5.6 有工程化验证体系

可提到的验证层：

- `lint / typecheck / build`。
- canonical schema、contamination、fixtures。
- UI runtime、route、user-flow、Playwright key path。
- job preference gate / acceptance。
- demo curated pool ranking。
- real-pool role matrix。
- beta A/B isolation。
- forged userId rejected。

面试说法：

> 我没有只靠肉眼点 Demo，而是把关键边界变成脚本。比如伪造 userId、demo pool 是否污染真实池、Top100 是否出现高 roleFit 低 Grade，这些都能自动检查。

## 6. 需要主动承认的不足

面试里不要把 ApplyFlow 吹成已成熟商业 SaaS。更好的策略是主动承认边界，并说明下一步。

### 6.1 还不是 Production Auth Ready

现状：

- 目前是 Internal Beta / Private Preview。
- 可用于面试演示、本人体测、2-user 白名单验证。
- 还不是 50-user beta ready。
- 还没有正式托管 Auth 接入。

说法：

> 我现在不会声称它已经是 production SaaS。当前状态是“面试演示 + 小规模白名单内测候选”。真正扩大用户前，我会接 Clerk 这类托管 Auth，完成所有私有 API 401、CORS、custom domain、D1 user isolation 的完整 cutover。

### 6.2 代码仍有局部大文件风险

证据：

- `public/app.js` 约 7719 行。
- `workflow-controller.js` 约 5602 行。
- `job-scoring-view-model.js` 约 3751 行。
- `routes/api.js` 约 917 行。

说法：

> 这是我现在最想继续治理的工程债。它说明项目确实一路迭代到比较复杂，但也暴露出 orchestration、UI 和 scoring 需要进一步模块化。我已经用 contracts 和 validation 先把行为边界稳住，下一阶段会按功能域拆 controller 和前端状态管理。

### 6.3 评测仍偏规则与离线脚本

现状：

- 排序和安全边界已有大量脚本。
- 但还缺少更正式的线上观测体系，如 P95 latency、token cost、用户转化漏斗、线上错误看板。

说法：

> 目前我的评测更像工程回归和离线 acceptance，还不是完整线上 observability。下一步会加请求链路 trace、LLM fallback rate、P95 latency、单次材料生成成本、用户从 shortlist 到 applied 的转化率。

### 6.4 Browser apply 仍是辅助能力

现状：

- 外部投递链路已降级为浏览器辅助投递 / 提交前检查。
- 不承诺跨站全自动提交。

说法：

> 我主动放弃了全自动投递。外站表单适配不稳定，且涉及用户真实申请风险。我的设计是让系统先做预填和 dry-run，再由用户确认提交。

### 6.5 Demo reset 仍不完整

现状：

- staging demo canonical entry 明确。
- `/api/demo/reset` 仍是 guarded `501`，还没成为完整产品化能力。

说法：

> 当前 demo 数据已经可控，但 reset endpoint 还没有产品化。我现在是通过受控 reseed 和演示前 smoke 保证稳定，后续会做 admin-only reset。

## 7. 面试官五个深挖问题与回答

### Q1：你到底解决了什么真实问题？

答：

> 我解决的是求职中的决策和执行断层。很多工具只做信息展示或内容生成，但求职者真正痛的是岗位太多、不知道该投哪个、投递后也没有追踪。ApplyFlow 用岗位池排序先降低决策成本，再把 Shortlist、Compare、tracker 和 feedback 接起来。

追问时补充：

- 不是找工作搜索引擎。
- 不是一键海投。
- 不是简历润色工具。
- 是 CareerOps 工作台。

### Q2：为什么必须用 AI / Agent，不能传统 workflow？

答：

> 我把系统分成确定性和非确定性两部分。确定性部分，比如状态流转、权限、schema、排序权重、枚举校验，用 rule-based 和 workflow。非确定性部分，比如 JD 语义抽取、岗位意图理解、解释文案和风险摘要，才用 LLM。
> 所以不是所有步骤都用大模型，而是只在需要语义理解和生成的地方用 AI。

可以补一句：

> 这也是我理解的 AI Native PM：不是拿模型当锤子，而是知道哪里该花 token，哪里必须用确定性系统兜住。

### Q3：系统怎么防止 Agent 失控？

答：

> 我用了四层控制：第一，LLM 输出必须走 structured JSON schema；第二，后端 contract 做枚举和字段校验；第三，control gate 决定是否 allow、blocked 或 needs_human_review；第四，高风险执行如外部投递必须人工确认。

如果问工具调用：

> 我不会只靠 Prompt 约束工具调用。Prompt 是软约束，schema 是硬约束，校验失败要 fallback 或重试，超过边界要转人工。

### Q4：上下文和记忆怎么管理？

答：

> 我没有把所有历史都塞进 Prompt。长期偏好在 `jobPreferenceProfile`，岗位状态在 tracker/materials/submission/follow-up，用户反馈在 feedback trace。不同记忆有不同作用域：偏好影响排序，tracker 影响执行状态，feedback 只做低风险 derived 信号，eval 路径还会隔离 feedback influence 防止污染。

可以加：

> 记忆的关键不是“记得多”，而是“该记什么、什么时候忘、什么时候不能影响主决策”。

### Q5：和其他 AI 求职工具比，你的差异是什么？

答：

> 很多工具重心在“生成一份内容”。ApplyFlow 的差异是先做岗位价值判断，再把 Shortlist、Compare、投递状态和反馈复盘接起来。它的核心不是生成能力，而是执行闭环和边界治理。

对比点：

- 普通内容生成工具：生成能力强，但岗位决策和状态管理弱。
- 自动投递工具：执行快，但风险高、解释弱。
- ApplyFlow：排序解释、状态管理、用户反馈、可控执行、回归验证并重。

## 8. 高频 AI 应用岗考点准备

### 系统设计

你要能画出：

```text
Job/Profile Input
→ Canonical Contracts
→ Preference & Scoring
→ JobDecision
→ ControlGate
→ Shortlist / Compare
→ Tracker / Feedback
→ Execution / Audit / Feedback
```

关键句：

> 我把模型层和执行骨架解耦。模型可以生成候选判断，但系统的 schema、gate、状态机和权限检查负责稳定交付。

### 工程化

要主动提：

- 超时和 fallback。
- schema validation。
- no-op 保存不刷新状态。
- 非法枚举后端 400。
- high-risk / missing-info 进入 human review。
- demo/beta/real-pool 隔离。

### 评测优化

不要只说准确率，说多指标：

- Top100 A/B 分布。
- `highRoleFitButLowGrade`。
- falseHighRankRate。
- mixedPostingLeakageRate。
- userPriorityOrderingIntegrity。
- acceptance pass rate。
- UI smoke。
- A/B isolation。
- forged userId reject。

### 问题定位

Bad case 定位四分法：

- 是数据池质量问题吗？
- 是角色 alias / ontology 问题吗？
- 是评分合同问题吗？
- 是 UI/缓存/用户态隔离问题吗？

例子：

> PM 历史“无 A”不是排序核心异常，而是 demo 小数据和画像导致。我没有急着改 comparator，而是用 real pool Top100 验证和 demo curated pool 补充区分问题来源。

## 9. 简历项目写法

### 推荐项目标题

ApplyFlow - 面向求职执行闭环的 AI Agent 工作台

### 简历 bullet 示例

- 独立设计并实现 ApplyFlow，一个半自动求职执行 Agent，将岗位导入、去重、五维排序、Shortlist/Compare、投递状态管理、反馈复盘和 follow-up 串成完整 CareerOps 流程。
- 设计 `userPriorityScore` 五维排序合同，统一 Grade、Verdict、雷达图、Compare 与 acceptance gate，解决“生产排序目标与旧评估口径不一致”的问题。
- 构建状态管理与反馈闭环，支持 shortlist、tracker、feedback、submission audit、follow-up 等求职执行节点，避免 AI 推荐停留在一次性 Demo。
- 建立 demo/beta/real-pool 隔离机制，完成 `demo_user=38` 演示池与 `staging_real_pool_user=5001` 真实池验证，防止演示数据污染真实用户数据。
- 针对 Internal Beta 完成 A/B 白名单用户隔离和 forged `payload.userId` 拒绝验证，覆盖 profile、shortlist、tracker、feedback 等用户态写路径。

### STAR-L 版本

Situation：

> 求职者同时面对大量岗位，普通 AI 简历工具无法判断岗位优先级，也缺少投递后的执行与复盘闭环。

Task：

> 我负责从 0 到 1 设计并实现一个可演示、可内测、可被回归验证的求职执行 Agent。

Action：

> 我将系统拆成 canonical contracts、scoring、decision、control gate、tracker、feedback、execution 多层，并用验证脚本覆盖排序、UI、用户隔离和安全边界。

Result：

> staging 真实池达到 5001 条岗位，四类画像 Top100 均 A/B 覆盖，demo curated pool 支持多画像演示，A/B 白名单用户隔离和 forged userId 拒绝验证通过。

Learning：

> AI 应用落地的核心不是调 Prompt，而是通过 contracts、状态机、评测和人工确认把概率模型变成稳定系统。

## 10. 演示路径

推荐演示顺序：

1. 打开 staging demo：`https://applyflow-staging.applyflow-eugene.workers.dev/?mode=demo#/dashboard`
2. Dashboard 输入快速求职意图，例如“产品经理 + 上海”。
3. 进入 Jobs，展示 Top5/Top20 排序、Grade、解释、五维分。
4. 切换画像，例如“数据分析 + 北京”或“算法工程师 + 深圳”，展示排序变化。
5. 打开岗位详情，讲 JobDecision 和 explainability。
6. 展示 Shortlist / Compare。
7. 展示 tracker、feedback、submission audit、follow-up。
8. 展示 demo 与 beta 隔离，不自动 demo 登录、不污染真实用户。
9. 展示你准备如何记录朋友试用 Evidence Log。

演示时不要说：

- “它已经可以公开上线。”
- “可以自动帮你投所有岗位。”
- “AI 会保证写出最优简历。”

应该说：

> 当前是面试演示和小规模白名单内测候选状态，我把最关键的排序、材料确认和数据隔离边界先做稳，再逐步进入 Production Auth 和域名 cutover。

## 11. 话题引导技巧

### 当面试官问“你用了什么模型”

先短答，再转系统：

> 模型层我做成 OpenAI-compatible structured JSON 调用，也支持没有 API key 时走 heuristic fallback。但这个项目的重点不是某个模型，而是模型输出后如何进入 schema、gate、人工确认和回归验证。

### 当面试官问“你了解 Agent 框架吗”

转到控制流：

> 我更关注框架背后的控制问题。比如 Tool Calling 不能只靠 Prompt，必须有 schema、参数校验、retry 上限和人工降级。ApplyFlow 里我用 contract 和 control gate 来承担这个执行骨架。

### 当面试官问“长上下文怎么办”

转到记忆外部化：

> 我不依赖无限上下文，而是把长期信息外部化成 profile、job states、feedback trace 和文档化 timeline。复杂任务用文档和验证脚本沉淀状态，避免上下文越堆越乱。

### 当面试官问“你这个是不是玩具项目”

正面接住：

> 如果只是输入 JD 生成简历，那确实是玩具。ApplyFlow 的去玩具化主要体现在三点：有真实池和 demo 池两套数据验证，有排序合同和 acceptance gate，有 multi-user beta 的安全边界治理。

## 12. RAG 相关问题不要硬蹭

ApplyFlow 不是 RAG 项目，不要为了显得 AI 味道更足而强行说“我做了 RAG”。

更好的说法：

> ApplyFlow 当前更像 Agent workflow 和 decision system，不是知识库问答。它会处理岗位和简历文档，但核心挑战不是检索增强生成，而是岗位价值判断、执行状态和人机确认边界。

如果面试官追问 RAG，你可以说：

> 未来如果接入企业/岗位知识库，我会先明确 Why RAG：例如岗位信息更新频繁、需要引用来源、需要召回历史 JD 和面试反馈。评估不会只看准确率，还要看 Recall@k、faithfulness、P95 latency 和 token cost。

## 13. 面试官不想只看 Demo 时怎么应对

你记得的观点是对的：很多 AI 岗面试官不太想看一个“理想路径 Demo”，因为 Demo 可以被提前摆拍。他们更想听：

- 真实用户是谁。
- 用户真实跑流程时哪里卡住。
- 你怎么记录 bad case。
- 你根据数据或反馈改了什么。
- 哪些问题你没有改，因为会破坏更重要的边界。

你当前最现实的策略是：把自己当第一个线上真实用户做 dogfooding。注意表达边界：

> 我当前还没有把它包装成大规模用户验证。现在处于 demo + 3-5 人内测准备阶段，所以我先把自己作为首个真实用户，在 staging 线上完整跑求职流程，采集 N=1 的 dogfooding 证据。这个阶段的目标不是证明市场规模，而是验证端到端 workflow、发现 bad case、建立迭代台账。

### 13.1 7 天线上自测计划

第 0 天：建立 baseline

- 记录当前版本、staging URL、demo/real pool 数据状态。
- 记录你的真实求职目标：目标岗位、城市、行业偏好、排除项。
- 设定本轮评价指标，不要只写“好不好用”。

建议指标：

- 从输入偏好到得到 Top20 的耗时。
- Top20 中你愿意投递的数量。
- Top20 中明显误排的数量。
- 每条岗位从判断到进入 shortlist 的平均时间。
- Shortlist 比例、误排数量和解释不清数量。
- tracker / feedback 是否能正确记录用户动作。
- 端到端完成一条申请准备的总耗时。
- 发现的 P0/P1/P2 问题数量。

第 1-3 天：真实流程跑通

- 每天选 10-20 条真实岗位。
- 按真实偏好筛选、shortlist、compare。
- 至少 2 条加入 Shortlist / Compare。
- 至少 1 条走到 tracker / submission audit / follow-up 记录。
- 记录每个 bad case 的触发条件、截图/岗位信息、预期结果、实际结果。

第 4-5 天：改进与复测

- 不要每个问题都立刻改。先分类：
  - 数据池质量问题。
  - 排序合同问题。
  - UI 体验问题。
  - 推荐解释不清问题。
  - Auth/状态/缓存问题。
- 只挑 1-2 个高影响、低风险问题做改进。
- 改完后用同样岗位或同类岗位复测。

第 6-7 天：形成面试证据包

- 总结 3 个最有代表性的 bad case。
- 总结 1 个你决定不改的点，并说明 trade-off。
- 总结 1 个线上体验前后对比。
- 准备一张表：`问题 -> 证据 -> 归因 -> 改动 -> 复测结果 -> 残余风险`。

### 13.2 Dogfooding 证据表模板

面试前准备一张这样的表，哪怕只有 5-10 条也很有用：

| 日期 | 场景 | 发现 | 归因 | 处理 | 复测 | 面试表达 |
|---|---|---|---|---|---|---|
| 2026-xx-xx | PM+上海 Top20 | 某 broad entry 排到前面 | 数据池/岗位类型识别 | 未改排序，只记录为 broad entry 解释优化 | 同类岗位仍 A/B 边界稳定 | 我没有为一个 bad case 盲目调权重 |
| 2026-xx-xx | 推荐解释 | 某条岗位高排但理由不清 | explainability 文案问题 | 调整解释展示/记录为 bad case | 同类岗位复测 | 可解释性比单纯分数更重要 |
| 2026-xx-xx | 申请准备 | 某岗位缺公司信息 | 数据源 completeness 问题 | 标记为 needs review | 不进入自动提交 | 信息不足时系统降级而非硬推 |

### 13.3 面试官问“你有用户数据吗”

推荐回答：

> 现在还没有大规模用户数据，我不会夸大。项目当前在 demo + 3-5 人内测准备阶段，所以我先做了两类证据：第一是 5001 条真实岗位池上的排序回归，验证系统在真实数据规模下不崩；第二是我自己作为真实求职用户在线上 dogfooding，记录完整流程中的 bad case、耗时、accept/reject/edit 比例和迭代决策。
> 这不是统计学意义上的用户增长数据，但它能证明我不是只做摆拍 Demo，而是在用真实任务逼出产品问题。

如果面试官继续追问“为什么不找更多用户”：

> 因为用户数据隔离和 Auth 边界还没有达到 production-ready。我现在宁愿先把 demo、白名单用户和真实池隔离做扎实，再扩大到 3-5 人。AI 产品如果过早放量，数据串号和错误材料生成的代价会比普通工具更高。

### 13.4 你需要立刻做的事

从今天开始，每次线上真实使用都记录四类东西：

1. 输入：你的真实偏好、目标岗位、城市。
2. 输出：Top20、Grade 分布、shortlist 选择。
3. 人工判断：为什么接受、拒绝、编辑。
4. 迭代结论：这个问题要不要改，为什么。

最小证据包：

- 10 条真实岗位筛选记录。
- 3 条 Shortlist / Compare 记录。
- 2 条 tracker / feedback / follow-up 记录。
- 3 个 bad case。
- 1 个你做了复测的改进。
- 1 个你主动不改的 trade-off。

## 14. RAG、Eval Harness、Benchmark 等非项目高频题

ApplyFlow 不要硬包装成 RAG 项目，但你必须能回答 RAG 和 eval harness，因为 AI 应用岗很常问。

### 14.1 如果问 RAG

回答框架：

> 我不会为了蹭概念把 ApplyFlow 说成 RAG。当前核心是 Agent workflow + decision system。RAG 适合知识更新频繁、需要来源引用、私域知识依赖强的场景。
> 如果 ApplyFlow 后续接 RAG，我会放在三个位置：第一，岗位和公司知识库，帮助判断公司背景与岗位真实性；第二，用户历史申请与面试反馈检索，辅助个性化策略；第三，材料生成时引用已确认经历和 JD 原文，降低幻觉。

评测指标：

- Retrieval：Recall@k、MRR、命中文档覆盖率。
- Generation：faithfulness、引用一致性、幻觉率。
- Product：用户节省时间、采纳率、复访率。
- System：P95 latency、token cost、fallback rate。

### 14.2 如果问 Eval Harness

这里的 harness 可以理解为“评测/回归测试脚手架”：把输入、期望、运行脚本、指标和失败解释固定下来，避免每次靠主观 Demo 判断。

你可以这样答：

> ApplyFlow 现在已经有一个轻量 eval harness。比如排序不是靠我肉眼看 Top5，而是有 gate、acceptance、real-pool role matrix、demo curated pool ranking 等脚本。每个脚本固定输入画像、岗位池、输出指标和失败条件。
> 我理解 eval harness 的价值是把 AI 系统的不稳定输出变成可回归的工程对象：同一批 case，每次改动后都能知道是变好了、变差了，还是只是数据池覆盖不足。

ApplyFlow 可举的 harness 例子：

- `eval:job-preference-ranking:gate`：排序主合同回归。
- `eval:job-preference-ranking:acceptance`：用户价值 acceptance。
- `validate-demo-curated-pool-ranking.js`：demo 多画像演示池回归。
- `validate-staging-real-pool-role-matrix.js`：真实池 Top100 分布。
- `validate-auth-forged-userid-rejected.js`：安全边界回归。

如果面试官问“你的 harness 还缺什么”：

> 还缺线上观测型 harness，比如把真实用户 session 的耗时、fallback rate、用户 accept/reject/edit 行为自动入库，再形成周期报表。目前更多是离线回归脚本，下一步会把 dogfooding 证据逐步结构化成线上指标。

### 14.3 如果问 Benchmark 怎么设计

回答：

> 我会分三层 benchmark。第一层是离线固定样本，用来防止排序、schema、安全边界回退；第二层是真实池抽样，用来发现数据质量和长尾岗位问题；第三层是真实用户流程指标，用来衡量产品价值，比如从发现岗位到完成申请准备的时间、AI 建议采纳率、人工编辑率和 bad case 修复周期。

不要只说“准确率”。更强的说法：

> AI 应用的 benchmark 不能只有 accuracy，因为系统可能准确但太慢、太贵、不可解释或不可控。ApplyFlow 更关注用户价值排序、材料可信度、执行边界和端到端效率。

## 15. 场景题回答逻辑

面试官很可能问场景题，例如“如果要做一个 AI 客服 / AI 招聘助手 / AI 研报助手，你怎么设计”。你不要临场散答，统一套这个框架：

### 15.1 五步框架

1. 用户和任务：谁在什么场景下用，任务成功标准是什么。
2. AI 必要性：哪些步骤必须用 LLM，哪些必须 rule-based。
3. 系统架构：输入、canonical schema、decision、control gate、execution、feedback。
4. 评测和观测：离线 benchmark、线上指标、bad case 归因。
5. 安全边界：权限、数据隔离、人工确认、fallback、不可做的事。

万能开头：

> 我会先把它拆成确定性流程和模型智能两部分。确定性的状态、权限、校验、执行边界交给系统；LLM 只负责语义理解、模糊判断和生成草稿。然后用 eval harness 和用户反馈闭环保证它不是一次性 Demo。

### 15.2 场景题示例：AI 招聘助手

> 如果做 AI 招聘助手，我不会一上来做自动筛人。先定义用户是 HR 还是候选人，任务是提高 JD 匹配效率还是提高候选人体验。
> LLM 可以做简历和 JD 的语义对齐、风险摘要和面试问题草稿；rule-based 必须负责学历/年限等硬条件校验、权限控制和候选人状态流转。
> Control gate 上，任何涉及拒绝候选人、发送正式通知、修改面试结果的操作都必须人工确认。
> 评测上，我会看 TopN 相关性、误拒率、人工复核通过率、处理耗时、候选人申诉 case。
> 这和 ApplyFlow 的思路一致：AI 提升判断效率，但最终执行要可解释、可审计、可人工接管。

### 15.3 场景题示例：AI 研报助手

> 研报助手更适合接 RAG，因为它依赖来源引用和知识更新。架构上我会做文档解析、chunk、hybrid retrieval、rerank、answer generation 和 citation check。
> 但我不会只看回答像不像，而会设计 faithfulness、citation precision、Recall@k、P95 latency 和单次成本。
> 如果用户要把结论用于投资或经营决策，系统必须显示来源、置信度和不确定性，不能让模型直接给高风险建议。

### 15.4 场景题示例：AI 客服

> 客服场景要先区分低风险咨询和高风险操作。FAQ、订单状态解释可以自动化；退款、赔付、账号安全必须 gate 到人工或二次确认。
> LLM 可以理解用户意图和生成回复，但工具调用参数必须 schema 校验，订单和用户权限必须以后端身份为准，不能信任前端输入。
> 指标不只看解决率，还要看转人工率、错误赔付率、平均响应时间、用户满意度和投诉率。

### 15.5 场景题收尾

每个场景题最后都拉回 ApplyFlow：

> 我在 ApplyFlow 里实际做过类似取舍：不是所有步骤都交给 AI，而是让 AI 处理语义和生成，让 workflow、contract、gate 和 validation 负责稳定性。

## 16. 下一阶段产品路线

优先级从高到低：

1. Production Auth：接 Clerk/Auth0/Supabase Auth，不自研密码系统。
2. Custom Domain：`www` 做产品介绍，`app` 做主应用。
3. D1 user isolation：用户态表结构拆分为 public job pool + user scoped states。
4. Observability：LLM fallback rate、P95 latency、token cost、API error rate、user funnel。
5. Demo reset：admin-only reset endpoint，面试前一键恢复演示状态。
6. Code modularization：拆分 `public/app.js`、`workflow-controller.js`、`job-scoring-view-model.js`。
7. Data quality governance：扩展真实池高质量单岗数据，不用 curated 直接污染 production。

## 17. 你要背下来的金句

- 我不是在做“自动海投”，而是在做“求职执行闭环”。
- AI 的价值不在替用户做所有决定，而在把大量岗位先筛成可解释的优先级。
- 模型负责生成候选答案，系统负责 schema、状态、权限和兜底。
- Human-in-the-loop 不是口号，在 ApplyFlow 里体现为用户确认、状态记录、反馈复盘和高风险动作不自动推进。
- Demo 稳定和真实用户内测是两套边界，不能为了演示方便牺牲用户隔离。
- 我不会把 RAG、Agent、Workflow 当关键词堆砌，而是讲清楚它们在具体业务链路里的必要性。
- 从 Demo 到 Production 的差别，是有没有评测、回归、权限、数据隔离、可观测性和失败恢复。
- N=1 dogfooding 不能证明市场规模，但能证明真实流程、坏例子和迭代判断。
- Eval harness 的价值是把 AI 系统从“看起来不错”变成“每次改动都能回归”。

## 18. 最终面试策略

你的核心人设应该是：

> 一个能用 AI 快速构建产品，但更重视边界、验证和交付稳定性的 AI Native Builder。

面试节奏：

1. 先讲业务闭环，不先讲技术名词。
2. 再讲系统架构，强调 deterministic workflow + LLM intelligence。
3. 接着讲证据，拿真实池、demo 池、A/B 隔离、forged userId。
4. 主动讲不足，展示工程判断。
5. 最后讲下一阶段路线，说明你知道 production 还差什么。

最重要的一句话：

> ApplyFlow 的价值不是“我会调用大模型”，而是我能把一个概率模型放进真实业务流程里，通过合同、评测、权限和人工确认，让它稳定地产生可用结果。

## 19. 按简历项目经历深挖的追问准备

这一节专门对应你 AI 类简历里的 ApplyFlow 项目经历。面试官通常不会只听你念项目描述，而会沿着“为什么做、怎么设计、怎么验证、有什么不足、下一步怎么产品化”一路追问。

### 19.1 30 秒项目开场

> ApplyFlow 是我独立做的 AI 求职执行 Agent。它不是自动海投工具，也不是单点生成工具，而是把求职拆成岗位导入、标准化去重、偏好建模、可解释排序、Shortlist/Compare、投递状态和反馈复盘。我的重点是让 AI 先帮用户从大量岗位里判断优先级，再用状态管理和 Bad Case 记录形成可迭代闭环。

### 19.2 为什么做这个项目？

回答逻辑：

1. 真实问题：求职者面对大量岗位时，不知道先看哪条、为什么投、投后如何复盘。
2. 传统产品不足：多数招聘产品偏信息展示，缺少基于个人偏好的优先级判断。
3. AI 适合点：岗位描述和用户偏好都是半结构化文本，适合用 AI 做语义理解、归纳解释和候选建议。
4. 系统必须补足点：排序、状态、权限、反馈、验证不能完全交给模型，需要确定性 workflow。

可直接说：

> 我做它不是为了炫技，而是因为这个场景有明确的 AI 价值：岗位和个人偏好都不是简单标签匹配，里面有大量语义判断。但我也不希望它变成“模型说什么就是什么”，所以我把它设计成 AI 判断 + 产品流程 + 验证闭环。

### 19.3 你说的 Agent 具体体现在哪里？

不要说“用了大模型所以是 Agent”。要说任务链路：

- 感知输入：读取岗位信息和用户偏好。
- 形成判断：输出匹配理由、风险点、优先级。
- 进入工作流：把岗位放入 Shortlist、Compare 或 tracker 状态。
- 接收反馈：根据用户操作和 Bad Case 记录迭代排序规则与解释口径。
- 保持边界：高风险动作不自动推进，投递和最终决策由用户确认。

一句话：

> 我对 Agent 的理解不是自动替用户做完所有事，而是围绕一个目标持续推进任务，并且每一步都能被用户理解、确认和复盘。

### 19.4 可解释排序怎么做？

回答结构：

1. 先把用户偏好结构化：目标角色、行业、城市、公司类型、排除项、投递可行性。
2. 再把岗位结构化：岗位职责、硬性要求、经验门槛、地点、公司属性、风险信号。
3. 排序不只输出分数，还输出推荐理由、风险点和下一步动作。
4. 验证时看 TopN 结果是否符合用户画像，而不是只看单条回答是否好看。

可直接说：

> 我会避免只给一个 magic score。因为面试官或用户真正关心的是“为什么这条排前面”。所以我把排序结果拆成优先级、命中原因、风险原因和建议动作，这样即使模型判断有偏差，也更容易定位是哪一类规则或解释出了问题。

### 19.5 你怎么验证它不是一个 Demo？

回答结构：

1. 数据证据：使用 5000+ 条真实岗位数据做排序稳定性验证。
2. 回归证据：不同用户画像下检查 TopN 是否稳定、是否出现低质量误排。
3. 用户证据：本人 dogfooding + 朋友白名单试用，记录任务完成率、耗时、卡点、Bad Case。
4. 产品证据：把反馈转成问题归因和迭代优先级，而不是只收集主观好评。

如果被问“你有用户数据吗”，不要假装大规模数据：

> 目前不是大规模公开产品，所以我不会夸大成 DAU 或商业化数据。现在更准确的说法是 demo 到白名单内测阶段。我准备的证据包括本人线上完整流程 dogfooding、3-5 位朋友试用记录、关键任务完成情况、Bad Case 分类和迭代前后对比。这个阶段我更看重问题发现率和闭环质量，而不是虚假的规模指标。

### 19.6 朋友试用的数据怎么讲？

你需要准备三类材料：

- 定量：完成一个岗位筛选任务用了多久、是否完成 Shortlist/Compare、是否记录投递状态、每人发现几个 Bad Case。
- 定性：用户说哪里不清楚、哪里有帮助、哪里不信任 AI 推荐。
- 迭代：根据反馈改了什么、为什么优先改、改完如何复测。

面试表达：

> 我会把朋友试用当成探索性内测，不会把它包装成成熟增长数据。我的重点是验证核心流程是否跑通：用户能不能理解推荐理由，能不能用 Shortlist/Compare 做决策，能不能在投递后留下反馈。每个 Bad Case 我会记录触发条件、归因、处理方案和复测结果。

### 19.7 为什么不是做简历改写？

这是你必须主动厘清的点：

> 我当前版本没有做简历改写。我选择先做岗位筛选和执行流，是因为求职里的第一层问题不是“写一份更漂亮的简历”，而是“判断哪些机会值得投入时间”。如果前面的岗位优先级错了，后面的材料优化反而会浪费精力。未来可以接入材料生成，但当前项目的核心价值是机会判断、状态管理和反馈复盘。

### 19.8 最大不足是什么？

不要只说“数据还少”。要说具体边界：

- 还不是公开 SaaS，用户规模不足。
- 还没有正式托管 Auth，Production 用户体系仍需补齐。
- 指标还处在内测证据阶段，不能证明商业化增长。
- 排序质量仍需要更多真实用户反馈和长期投递结果验证。

高质量回答：

> 最大不足是它还在 demo 到白名单内测阶段，证据更多来自真实岗位池、回归验证和小样本用户反馈，还没有大规模线上指标。但我认为这个阶段最重要的不是假装成熟，而是把数据隔离、Bad Case、指标口径和迭代闭环先建立起来，这样后面用户量上来时才知道该看什么、怎么改。

### 19.9 如果面试官问技术细节

回答方向：

- LLM 用在语义理解、解释生成、模糊偏好判断。
- 确定性系统负责 schema、状态流转、权限边界、验证脚本。
- RAG 不是当前核心，因为岗位池和用户偏好是结构化/半结构化决策问题；如果扩展到政策、公司资料、面经知识库，才会引入 RAG。
- eval harness 用来固定测试画像和岗位集合，每次改排序逻辑后回归 TopN、误排、解释一致性和边界 case。

### 19.10 如果面试官问“上线后你会看什么指标？”

按漏斗回答：

1. 导入层：岗位导入成功率、解析失败率、重复率。
2. 判断层：TopN 点击率、收藏率、Compare 使用率、推荐理由有用率。
3. 执行层：从 saved 到 applied 的转化、状态更新率、follow-up 记录率。
4. 质量层：Bad Case 率、误排类型、用户手动纠正率。
5. 系统层：LLM fallback rate、P95 latency、API error rate、单次成本。

一句话：

> 我不会只看“用户点了多少”，还会看用户是否真的把 AI 推荐推进到求职动作，以及哪些推荐被用户纠正，因为这才说明系统有没有帮助用户做决策。

## 20. Focused Review 自审记录

Correctness Findings：

- 本文档已覆盖项目核心文档、`interview/` 下 AI 面试方法论、demo/beta/real-pool 资料、排序合同、状态管理/反馈闭环与验证脚本证据。
- 本文档不声称 ApplyFlow 已 Production Ready，避免与当前项目状态冲突。
- 已补充面试官不只看 Demo 时的 N=1 dogfooding 应对策略、RAG/eval harness/benchmark 回答、通用场景题框架。
- 已补充与 AI 类简历项目经历逐条对应的深挖追问，包括 Agent 定义、可解释排序、内测数据、非简历改写边界和上线指标。

Boundary/Safety Findings：

- 明确区分 demo、staging real pool、beta white-list、production auth readiness。
- 明确禁止把全自动投递、公开 SaaS、Production Auth Ready 作为当前卖点。
- 明确 forged userId、A/B isolation、demo contamination 是面试可讲的安全边界证据。
- 明确 N=1 dogfooding 不能冒充大规模用户数据，只能作为线上真实流程与 bad case 证据。

Adversarial Scenarios Checked：

- 空泛 Agent 项目被追问为玩具。
- 被问为什么不用传统 workflow。
- 被问 Tool Calling 乱套和参数幻觉。
- 被问 RAG 但项目不是 RAG。
- 被问 eval harness / benchmark 怎么设计。
- 被问没有上线后用户数据怎么办。
- 被问 AI 客服、AI 招聘助手、AI 研报助手等场景题。
- 被问线上化和多用户安全。
- 被问现有不足和工程债。

Blast Radius & Adjacent Regression Assessment：

- 本轮只新增面试复习文档，不改运行代码、数据、排序核心、Auth 逻辑、部署配置。
- 对产品功能无运行时影响。

Residual Risks：

- 文档中的 staging URL 和在线状态可能随部署变化，需要面试前重新 smoke。
- 真实池与 demo 池数据量是截至 2026-05-15 的项目现场，后续若 reseed 或 deploy，需要同步更新。

Disposition：

- Unblocked。owner：项目作者。解封条件：仅文档交付，不涉及生产风险；面试前需按演示路径做一次人工 smoke。
