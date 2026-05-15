# ApplyFlow Internal Beta 与面试演示稳定计划

## 1. 当前定位
当前目标从“公开正式上线”降级为“少数人内测 + 面试演示稳定”，执行边界如下：

- 不急于绑定正式域名
- 不急于开放 50 人 beta
- 不开放公开注册
- 不做复杂 landing / billing / pricing
- 当前方向是 Internal Beta / Private Preview，不是公开 SaaS
- 仍必须避免测试账号、demo 数据和真实内测用户数据混用

## 2. 两种运行模式
### Interview Demo Mode
用于面试演示，要求如下：

- 固定 demo 数据
- 路径稳定
- 可重复演示
- 不依赖真实用户注册
- 不写入真实用户数据
- 不影响真实 beta 用户

### Internal Beta Mode
用于少数真实用户，要求如下：

- 仅白名单用户
- 每个用户有独立数据
- 不允许共用测试账号
- 不允许公开注册
- 不允许 demo 自动登录污染真实用户

## 3. 当前仍必须处理的内测前 Blocker
基于 [docs/PRODUCTIZATION_AUTH_DOMAIN_PLAN.md](E:\my-agent\applyflow\docs\PRODUCTIZATION_AUTH_DOMAIN_PLAN.md) 与既有审计结论，内测前必须清零：

- [ ] production 自动 demo 登录不能影响 beta 用户
- [ ] `/api/login` 任意邮箱自动建号必须受控或仅限 dev/demo
- [ ] `x-dev-user` 不能在 production/beta 生效
- [ ] `/api/auth/users` 不能公开暴露用户列表
- [ ] 私有 API 需要有明确未登录策略
- [ ] A/B beta 用户数据不能互相污染
- [ ] demo/test 数据必须与 beta 用户数据隔离
- [ ] sqlite/bak 不得误提交
- [ ] 面试 demo 路径必须可重复验证

## 4. 最省事路线
建议采用最低风险、最低成本的推进方式：

- 可以暂时继续使用 `workers.dev` 做内测入口
- 正式域名可以后置
- Clerk 可以后置到真正扩大用户前
- 但 beta 前必须先消除自动 demo 登录和开放式登录风险
- 先支持 3-5 个白名单用户，不直接做 50 人

## 5. 不影响面试演示的原则
所有内测改造必须遵守以下稳定性约束：

- 不破坏当前 `Dashboard -> Jobs -> Shortlist -> Compare -> Profile/Materials -> Submit/Dry-run` 演示主路径
- 排序、评分、`User Priority Gate` 不得被内测登录改造误伤
- demo 数据必须可控、可恢复
- 面试演示入口必须有 smoke test

## 6. 推荐实施批次
### Beta Batch 0: 文档与范围冻结
- 目标：固化边界、范围、禁改项
- 约束：只写文档，不改代码

### Beta Batch 1: 当前 demo/test 登录路径只读审计
- 审计对象：`ensureDemoSession`、`/api/login`、`x-dev-user`、`/api/auth/users`、`user_a fallback`
- 约束：只读审计，不改代码

### Beta Batch 2: Interview Demo Mode 设计
- 目标：明确 demo 路径、demo 数据来源、demo 是否只读、是否允许重置
- 约束：不动真实用户数据

### Beta Batch 3: Internal Beta Access Gate 设计
- 目标：设计白名单邮箱、beta access、禁止公开注册
- 优先方案：
1. 暂时不用完整 Clerk
2. 或如果接 Clerk，只接最小邮箱登录 + allowlist
- 约束：不自研密码系统

### Beta Batch 4: 最小代码改造
仅在 Batch 1/2/3 设计完成后执行：

- 禁用 production 自动 demo 登录
- 限制开放式 `/api/login`
- 禁用 production `x-dev-user`
- 保护 `/api/auth/users`
- 保留 demo mode

### Beta Batch 5: 内测验证脚本
新增并固化以下验证：

- demo path smoke
- beta user A/B isolation
- no auto demo login in beta
- no x-dev-user in beta
- `/api/auth/users` not public
- interview demo flow unaffected

## 7. Decision Needed
需要人工决策的事项：

1. 是否暂时继续用 `workers.dev`
2. 是否买域名后置
3. 内测用户数量：3-5 还是 10
4. 内测用户是否必须白名单邮箱
5. demo mode 是否公开给面试官
6. demo mode 是否只读
7. 是否接 Clerk，还是先做更轻的 beta gate
8. 是否保留旧测试账号 `alex/taylor`

## 8. 当前状态
- 当前不是 Production Auth Ready
- 当前不是 50-user beta ready
- 当前可以进入 Internal Beta 设计
- 任何代码改造前必须先完成 Beta Batch 1 只读审计和 Beta Batch 2/3 设计
- 不得直接大改登录系统

## 9. Batch 4 Close 结论（2026-05）
- 当前仅达到“3-5 人 Internal Beta 候选可验证状态”。
- 当前仍不是 Production Auth Ready。
- 当前仍不是 50-user beta ready。
- `/api/demo/reset` 仍为 guarded `501`，尚未实现 reset。
- `user_a fallback / payload.userId` 全量治理后置，需在后续批次专项收口。

## 10. Batch 5E Staging Demo 入口结论（2026-05）
- staging demo canonical entry：`https://applyflow-staging.applyflow-eugene.workers.dev/?mode=demo#/dashboard`。
- `/demo` 在 staging 会 `307` 到 `/`，暂不作为面试演示入口。
- 普通路径未登录仍显示 Internal Beta 登录页，不自动 demo。
- 远端自动 smoke 若受执行环境 workers.dev TLS/网络限制，以人工浏览器验收结果为准。
- 当前仍不是 Production Auth Ready，也不是 50-user beta ready。

## 11. Batch UX-1 + UX-2（2026-05）
- Dashboard 定位为“快速求职意图输入”，支持只填“目标岗位 + 地点”先进入排序主链。
- Profile 定位为“可选高级偏好 + 申请材料信息补充”，与 Dashboard 同步同一 `jobPreferenceProfile` SoT。
- `name/background` 不再阻断排序主链保存；缺失时仅提示“会影响材料生成与网申自动填充质量”。
- “偏好行业/偏好公司类型”语义调整为“加分偏好”，明确不是硬过滤；排除项才是更强过滤信号。
- PM 无 A 档问题保持后续专项，本轮不改排序核心口径。

## 12. Staging Final Review（2026-05-14）
- staging final review 结论：当前可用于“面试演示 + 本人 staging 自测”。
- real-pool 验收用户 `staging_real_pool_user` 已完成 Full-5000+（`5001`）导入并通过四画像 Top100 验收：
  - 产品经理+上海：A10/B90
  - 数据分析+上海：A14/B86
  - 算法工程师+上海：A48/B52
  - 后端开发+上海：A16/B84
  - `highRoleFitButLowGrade=0`（四画像）
- `demo_user=12` 维持小数据演示池，未被真实池污染。
- PM 历史“无 A”问题已确认主要来自 demo 小数据/画像，不是评分链异常；不需要改 `userPriorityScore` / comparator / grade 阈值 / opportunityType / acceptance-gate 口径。
- 3-5 人白名单内测前，建议优先完成：
  - A/B 用户隔离端到端验证
  - `user_a fallback / payload.userId` 专项治理
- 当前仍不是 Production Auth Ready，也不是 50-user beta ready。

## 13. 1-user Whitelist Login Acceptance（2026-05-14）
- staging 手工验收结论：1 个白名单用户登录链路通过，可进入下一阶段隔离专项。
- 验收结果：
  - 白名单邮箱登录：PASS
  - 进入 Dashboard：PASS
  - 登录身份不是 `demo_user`：PASS
  - 快速偏好“产品经理 + 上海”保存：PASS
  - Jobs / Profile 页面打开：PASS
  - 退出或清 cookie 后普通路径不自动 demo：PASS
  - 阻断异常：无
- 备注：用户提出 1 个“非阻断 UX polish”优化点，后续独立记录与处理，不阻断本轮 acceptance close。
- 当前状态更新：
  - 可用于“面试演示 + 本人 staging 自测 + 1 用户白名单登录验证”
  - 仍不声明 3-5 人 fully ready
  - 仍不声明 50-user beta ready
  - 仍不声明 Production Auth Ready

## 14. Demo Dataset Enhancement（2026-05-15）
- 目标：将 `demo_user` 演示池从 12 条小样本升级为“可重复、可解释、可展示偏好差异”的 curated pool（约 30-40 条）。
- 实施方式：优先改 repo 内 demo seed（`src/mock/applyflow-demo-data.js` + curated jobs 文件），不改排序核心，不写真实池用户。
- curated pool 覆盖：
  - 城市：上海/北京/深圳/广州 + 杭州/成都/南京/苏州/武汉/西安
  - 岗位：产品经理、数据分析、算法工程师、后端开发/软件工程师、运营/商业分析、少量入口型岗位
- 验证：新增 `scripts/validation/validate-demo-curated-pool-ranking.js`，按多组画像输出 Top20 分布、Top5 结果、机会类型与证据类型分布。
- 边界：不改 `userPriorityScore` / comparator / grade 阈值 / opportunityType / acceptance-gate；不改 `staging_real_pool_user=5001`。
- 状态说明：仓库 seed 已升级；staging 线上 demo_user 若仍为历史 12 条，需要 staging deploy + 受控 reseed 后才会生效。

## 15. user_a / payload.userId Fallback 治理（2026-05-15）
- 范围：仅治理用户归属安全边界，不改排序核心。
- 关键收敛：
  - `store` 在 internal beta / staging / prod-like 写入路径不再允许 `user_a` fallback。
  - API 层对 `payload.userId` 启用 ownership guard：若与 authenticated user 不一致则拒绝（AUTH_FORBIDDEN/guarded reject）。
  - discovery/import/sync 工作流不再从 `payload.userId` 派生用户归属，统一使用 request context authenticated userId。
- 验证：
  - 新增 `validate-auth-forged-userid-rejected.js`，覆盖 profile + shortlist/tracker/feedback forged userId 场景。
  - 验证结果显示 `demo_user=38`、`staging_real_pool_user=5001` 与 `user_a` 计数稳定，未污染真实池与 demo 池。
