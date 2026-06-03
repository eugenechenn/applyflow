# ApplyFlow 真实用户产品化上线计划：域名、Auth 与多用户隔离

## 1. 文档目的
本文件是 ApplyFlow 面向真实用户上线的长期对齐文档，用于约束 Codex、主线程与 review 过程，防止在产品化推进中遗忘以下关键边界：
- 域名产品化（非长期 workers.dev）
- 托管 Auth 接入（禁止自研密码体系）
- 多用户数据隔离（后端鉴权 + ownership check）
- production 去测试账号化
- 安全门禁与回归验证闭环

本文件优先级：涉及域名/Auth/多用户隔离任务时，必须先读本文件再执行。

## 2. 当前稳定生产基线
- Production URL：`https://applyflow.applyflow-eugene.workers.dev`
- Production version id：`e0e59c7a-faa3-4483-bff2-43702f698f2f`
- 代码基线：`main == origin/main @ 64839fa`
- 排序与评估基线：
  - `validate:job-scoring-derived-view` PASS
  - `eval:job-preference-ranking:acceptance` PASS
  - `eval:job-preference-ranking:gate` PASS
  - `User Priority Gate` PASS
- UI/主路径基线：
  - `ui runtime production smoke` PASS
  - `ui key-path production smoke` PASS
  - `ui user-flow production smoke` PASS
  - `phase10a production smoke` PASS

说明：上述基线用于确保域名/Auth/隔离改造不误伤当前排序与主流程稳定性。

## 3. 当前问题与目标状态
### 当前问题
- 线上仍是 workers.dev 风格地址，不符合真实产品域名形态
- 登录体系仍偏测试产品账号/测试态
- 用户数据隔离尚未作为真实 SaaS 边界系统化验收
- `data/applyflow.sqlite` 与恢复备份文件存在误提交风险

### 目标状态
- `www` 或独立 landing 域名用于产品介绍
- `app` 子域名用于真实 App
- 登录/注册/退出统一由托管 Auth 提供
- Cloudflare Worker API 严格验证 Auth token/session
- D1 全部用户态数据按 authenticated user 隔离
- demo/test 数据与真实用户数据隔离
- 所有私有 API 未登录返回 `401`
- 生产环境不再依赖测试账号自动登录

## 4. 推荐产品化架构
- `www.apply-flow-use.com`：ApplyFlow 主应用与对外正式入口
- `apply-flow-use.com`：根域名，后续可做 landing 或跳转
- `Cloudflare Worker API`：后端 API + D1 访问
- `Managed Auth`：Clerk 优先，其次 Auth0 / Supabase Auth
- `Cloudflare D1`：公共岗位池 + 用户态数据

数据边界原则：
- 公共 `job pool` 可以共享（公共读）
- 以下数据必须按 `user_id` 严格隔离（私有读写）：
  - preference / profile
  - shortlist
  - tracker
  - feedback
  - materials prep
  - submission audit
  - follow-up
  - resume / autofill
  - user-specific ranking state

## 5. 域名与部署策略
- 不建议生产长期使用 `workers.dev`
- 使用 Cloudflare Custom Domain / Route 承载正式域名
- `app` 子域绑定 Worker（或 Pages+Worker 组合，但 API 鉴权责任仍在后端）
- 需要系统检查：
  - wrangler/Cloudflare 配置
  - CORS 配置
  - redirect URL / callback URL
  - 环境变量与 secret
  - 硬编码域名
- production / staging / local 必须清晰隔离，禁止混用

后续 Codex 域名审计清单：
- 查找 `workers.dev` / `localhost` / 测试域名硬编码
- 查找 CORS allowlist 位置与生效环境
- 查找 OAuth/Auth callback URL 配置位置
- 查找 production env 与 staging env 差异
- 查找部署脚本是否可能误用测试环境变量

## 6. Auth 策略
推荐顺序：
1. Clerk（首选）
2. Auth0（备选）
3. Supabase Auth（备选）

明确禁止：不自研密码登录、session、refresh token、找回密码、邮箱验证、OAuth callback。

Codex 禁止事项：
- 禁止手写密码存储逻辑
- 禁止自制 session token 体系
- 禁止信任前端传入 `userId` 作为授权依据
- 禁止把测试账号逻辑保留在 production
- 禁止只做前端路由保护而跳过后端 API Auth 校验
- 禁止为赶进度绕过 ownership check

后端原则：
- 后端只信任 Auth provider 验证后的 user identity
- 所有用户态读写必须从 `authenticatedUserId` 派生 `user_id`
- 前端传入 `userId` 仅可用于展示，不可用于授权判定

额外约束：
- Codex 不能自由发挥 Auth 安全设计，只能做：
  - 托管 Auth 接入
  - 鉴权验证
  - 数据隔离落地
  - 回归测试补齐
  - 生产配置与门禁检查

## 7. 多用户数据隔离模型
必须隔离的数据域：
- user preference / profile
- shortlist
- tracker
- feedback
- materials prep
- submission audit
- follow-up
- resume / profile autofill
- browser apply / Edge autofill
- any user-specific ranking state

目标表结构方向（指导性，不等于立即改造）：
- `jobs`：公共岗位池
- `user_preferences`：`user_id` scoped
- `user_job_states`：`user_id + job_id` scoped
- `user_materials`：`user_id` scoped
- `user_submission_audits`：`user_id` scoped
- `user_followups`：`user_id` scoped

关键语义：
- 同一个 `job_id` 在不同用户下可有不同 `shortlist/tracker/feedback/ranking derived state`
- 不同用户状态必须互不污染、互不可见、互不可改

## 8. 分批实施计划
### Batch 0: 只读审计
目标：
- 明确当前部署形态、登录逻辑、API 保护状态、数据流、测试账号入口、DB/gitignore 风险
允许改动：
- 仅文档与审计报告
禁止改动：
- 业务代码、部署、提交、破坏性命令
验收标准：
- 输出可追溯审计证据（文件/函数/API/表）

### Batch 1: Custom Domain / Env / CORS Readiness
目标：
- 完成正式域名接入前的配置就绪
允许改动：
- 域名/环境变量/CORS/回调地址相关配置与文档
禁止改动：
- 核心业务逻辑、排序逻辑、用户态业务功能扩展
验收标准：
- production/staging/local 环境分离清晰
- 域名与 CORS 策略可验证

### Batch 2: Managed Auth Design
目标：
- 选型并产出托管 Auth 接入设计（优先 Clerk）
允许改动：
- 设计文档、接口约定、路由保护方案、迁移方案
禁止改动：
- 自研 Auth 方案实现
验收标准：
- 明确页面保护/API 保护/identity 映射/失败处理

### Batch 3: Minimal Auth Integration
目标：
- 最小可用登录、注册、退出、当前用户展示
- App 页面保护
- 私有 API 统一 `401`
允许改动：
- Auth 接入点、会话校验、基础 UI 鉴权态
禁止改动：
- 排序合同、核心业务策略、非必要重构
验收标准：
- 未登录访问私有 API 全部返回 `401`

### Batch 4: D1 User Isolation Migration
目标：
- `user_id` 隔离闭环与 ownership check
- 老测试数据隔离/迁移策略
- migration rollback plan
允许改动：
- 用户态表结构与 repository 访问层
禁止改动：
- 无回滚方案的高风险一次性切换
验收标准：
- A/B 用户互不可见、互不可写

### Batch 5: Auth + User Isolation Regression Tests
目标：
- 新增安全与隔离回归脚本
- 覆盖伪造请求与登出访问边界
允许改动：
- validation 脚本、CI 门禁
禁止改动：
- 为通过测试而降低鉴权边界
验收标准：
- 关键脚本全 PASS，且可重复执行

### Batch 6: Production Cutover
目标：
- 正式域名切流
- production secrets 生效
- 关闭测试账号入口
- 小规模真实用户试用与回滚预案
允许改动：
- 发布配置、运营开关、监控告警
禁止改动：
- 无验证直接全量放量
验收标准：
- 切流后关键路径 smoke PASS，出现越权风险可快速回滚

## 9. 必须新增的验证脚本
- 未登录访问私有 API 返回 `401`
- 登录用户只能读取自己的 preference/profile
- A 用户 shortlist 不影响 B 用户
- A 用户 feedback 不影响 B 用户排序
- A 用户 tracker/materials/submission/follow-up 不影响 B 用户
- 伪造 `userId` 请求被拒绝
- 登出后无法访问私有 API
- production env 不使用测试账号自动登录
- demo/test 数据不会进入真实用户账户
- DB backup/sqlite 不会被误提交
- CORS 仅允许正式域名与允许的 staging/local 域名

## 10. 安全边界与 Review 要求
- Auth/多用户隔离属于高风险共享层改动
- 相关 PR 不得只做功能 review，必须做安全边界 review
- review 必须覆盖：
  - correctness
  - authorization
  - data isolation
  - source-of-truth
  - cache/session stale risk
- 未完成安全 review，禁止部署 production
- 发现越权、数据串号、测试账号残留时，状态必须标记为 `Blocked`

## 11. Decision Needed
- 最终正式域名是什么：已确定 `apply-flow-use.com`，当前对外入口为 `www.apply-flow-use.com`
- 是否确认使用 Clerk 作为首选托管 Auth
- 是否保留 demo 模式
- demo 与真实用户数据如何物理/逻辑隔离
- DB 文件是否纳入 git（含 sqlite/bak 策略）
- 本地 sqlite 与 production D1 的关系与切换规则
- 首批真实用户开放范围
- 是否需要 waitlist / invite code

## 12. 后续 Codex 工作提示模板
在开始任何 Auth/domain/user-isolation 任务前，请先执行并在回复中显式说明：

1. 我已阅读 `docs/PRODUCTIZATION_AUTH_DOMAIN_PLAN.md`。  
2. 本轮任务属于 `Batch X`（填写 0-6）。  
3. 本轮允许改动范围：`...`。  
4. 本轮禁止改动范围：`...`。  
5. 本轮验收标准：`...`。  
6. 若涉及 Auth：默认托管 Auth（Clerk 优先），不自研密码/session/refresh token。  
7. 若涉及用户数据：所有用户态读写必须基于 authenticated user，禁止信任前端 `userId`。  
8. 若涉及 production：必须检查测试账号入口、CORS、callback URL、env 差异与回滚方案。  

附加 DB 风险强制提醒：
- 当前 `data/applyflow.sqlite` 为本地 modified 状态
- `data/applyflow.sqlite.pre-switch.20260509-172733.bak` 为恢复切换备份
- 在未明确 DB 策略前，禁止提交任何 sqlite 或 bak 文件

## 13. 当前只读审计发现的具体风险点

### Blocker
- production 自动 demo 登录
  - 位置：`public/app.js`，`ensureDemoSession` / `DEMO_AUTO_LOGIN_EMAIL` / 未登录自动调用链
  - 风险：真实用户身份边界失效
  - 后续修复方向：production 禁用自动 demo 登录，只保留显式 Auth 登录流
  - 验证脚本：`validate-auth-prod-no-auto-demo-login.js`

- 开放式 `/api/login` 任意邮箱自动建号登录
  - 位置：`src/server/routes/api.js` 的 `/api/login`
  - 风险：非受控注册/登录
  - 后续修复方向：production 关闭，或仅 dev/staging 开启；真实登录交给托管 Auth
  - 验证脚本：未授权调用 production `/api/login` 应返回 `403/404/受控错误`

### High
- `x-dev-user` 身份切换入口
  - 位置：`src/server/auth.js`
  - 风险：若误用于生产或旁路入口，会造成身份伪造
  - 后续修复方向：删除或严格 dev-only 双重门禁
  - 验证脚本：production 环境发送 `x-dev-user` 不生效

- `payload.userId / user_a fallback` 用户污染风险
  - 位置：`workflow-controller / job-discovery-pipeline / feishu-sync-layer / store getActiveUserId` 相关逻辑
  - 风险：导入、发现或流程元数据可能错绑用户
  - 后续修复方向：所有用户态写入从 authenticated request context 派生 `user_id`，不信任 `payload.userId`
  - 验证脚本：`validate-auth-forged-userid-rejected.js`
  - 状态更新（2026-05-15）：beta/staging 写路径已完成第一阶段治理，forged `payload.userId` 拒绝与 `user_a` fallback 收口已通过脚本验证。

- `/api/auth/users` 用户枚举接口
  - 位置：`src/server/routes/api.js`
  - 风险：泄露用户 `email/username/id`
  - 后续修复方向：删除、admin-only，或至少要求 Auth + 权限
  - 验证脚本：未登录访问返回 `401/404`

### Medium
- Edge extension / downloads 硬编码 `workers.dev / staging allowlist`
  - 位置：`public/extensions/applyflow-edge-mvp`、`public/downloads`
  - 风险：正式域名切换后扩展失效或域策略混乱
  - 后续修复方向：配置化 allowed hosts，并覆盖 app 正式域名
  - 验证脚本：正式域名下 Edge autofill smoke

- `CORS / Auth callback / redirect URL` 尚未产品化
  - 风险：接入 Clerk/Auth0 后容易出现回调失败、跨域错配或过宽 Origin
  - 后续修复方向：Batch 1/2 明确定版
  - 验证脚本：Auth callback E2E + CORS allowlist test

### Low
- sqlite / bak 本地 DB 文件误提交风险
  - 位置：`data/applyflow.sqlite`、`data/applyflow.sqlite.pre-switch.20260509-172733.bak`
  - 风险：恢复切换痕迹误提交
  - 后续修复方向：`gitignore + CI guard + 提交前检查`
  - 验证脚本：`validate-db-artifacts-not-committed.js`

## 14. Production Auth Cutover 前必须清零的 Blocker

- [ ] production 自动 demo 登录已关闭
- [ ] production `/api/login` 任意邮箱自动建号已关闭或受控
- [ ] `x-dev-user` 不可能在 production 生效
- [ ] `/api/auth/users` 不再公开暴露用户列表
- [ ] 所有私有 API 未登录返回 `401`
- [x] 所有用户态写入不信任前端 `userId`（beta/staging 已完成并验证）
- [x] `user_a fallback` 不再用于真实用户生产写入（beta/staging 写路径已完成并验证）
- [ ] demo/test 数据与真实用户数据隔离
- [ ] sqlite/bak 文件不会被误提交
- [ ] 正式域名、CORS、Auth callback/logout URL 已定版

## 15. Batch 0 Close 验收状态
- Batch 0 只读审计已完成
- 当前状态仍不是 Production Auth Ready
- 当前状态应标记为：`Auth/Productization Blocked until Blocker checklist cleared`
- 下一步不是直接接 Clerk，而是先做 Batch 1：`Custom Domain / Env / CORS Readiness`，或先做 Batch 2：`Managed Auth Design`
- 任何进入 Batch 3 `Minimal Auth Integration` 前，必须确认 Batch 1/2 设计已完成

## 16. 三方分工与协作执行协议（长期有效）
本节用于固化“你（产品决策）/架构与风控（方案与审查）/Codex（仓库执行）”的协作边界，避免 Auth 与上线任务被单线程全包推进。

### 16.1 角色分工
- 你（产品负责人）负责：现实世界决策与账号操作，不负责仓库代码实现
- 架构与风控（主线程方案控制）负责：批次判断、任务拆解、提示词编排、风险审查、是否准入下一批
- Codex 负责：仓库内只读审计、文档落地、代码改造、验证脚本与证据输出

### 16.2 你需要决定/操作的事项（非代码）
| 事项 | 你来决定/操作 |
|---|---|
| 正式域名 | 已购买 `apply-flow-use.com`，本轮按用户要求先切 `www.apply-flow-use.com` |
| Cloudflare 账号 | 域名是否接入 Cloudflare DNS，是否可添加 Custom Domain |
| Auth 供应商 | 是否确认 Clerk（建议优先 Clerk） |
| Clerk 账号 | 创建 production app，配置生产域名、OAuth、登录方式 |
| 首批用户范围 | 3-5 人灰度或 waitlist/invite code |
| demo 模式 | 是否保留；若保留是否独立域名/独立数据 |
| 测试账号 | production 是否完全关闭测试账号自动登录（建议关闭） |
| DB 策略 | 本地 sqlite / .bak 是否永不提交（建议不提交） |
| 上线节奏 | 小范围灰度，不直接全量公开 |

### 16.3 不需要你亲自设计的技术细节（交给 Codex）
- password hash
- session token
- refresh token
- OAuth callback
- user_id migration
- API ownership check
- regression scripts

前提：以上实现必须严格遵守本文件边界，且通过安全 review 与分批门禁。

### 16.4 架构与风控职责（主线程）
- 判断当前应执行哪个 Batch（当前已完成 Batch 0 Close）
- 给 Codex 下发受控任务（限定可改范围/禁止改动/验收标准）
- 审核 Codex 输出是否越界（尤其 Auth、自定义 session、userId 信任、生产门禁）
- 决定是否进入下一 Batch，或要求返工

### 16.5 Codex 可做与禁止做
Codex 可做（按 Batch 分阶段）：
- Batch 0：文档化审计结果（只改文档）
- Batch 1：域名/env/CORS/硬编码域名审计与准备
- Batch 2：托管 Auth（Clerk 优先）接入设计
- Batch 3：最小 Auth 集成与私有 API `401`
- Batch 4：D1 多用户隔离与 ownership check
- Batch 5：安全回归脚本与 CI guard
- Batch 6：cutover checklist 与上线前验证

Codex 严禁：
- 自研密码登录体系
- 自研 session/refresh token 体系
- 信任前端传入 `userId` 作为授权依据
- 只保护前端页面，不保护后端 API
- 在 production 保留测试账号自动登录
- 一次性跨 Batch 大改 Auth + DB + UI + 部署
- 未经确认提交 sqlite / bak / DB 文件
- 未经确认直接部署

### 16.6 标准工作流（每轮必须遵守）
`Codex 输出 -> 你提交给架构与风控审查 -> 生成下一轮提示词 -> Codex 执行下一轮`

禁止模式：
- Codex 连续多轮自行推进直至部署，特别是 Auth 与 session 改造链路

### 16.7 当前时点行动建议
- 若 Batch 0 Close 已通过：进入 Batch 1（Custom Domain / Env / CORS Readiness）
- 在 Batch 1 期间，你可并行完成：
  - 正式域名方案决策：已确定 `www.apply-flow-use.com` 作为当前对外入口
  - Auth 供应商决策（建议 Clerk）
  - demo 策略决策（建议保留但与真实用户数据隔离）
  - 首批用户范围决策（建议 3-5 人灰度）
  - DB 文件策略确认（sqlite/bak 不提交）
