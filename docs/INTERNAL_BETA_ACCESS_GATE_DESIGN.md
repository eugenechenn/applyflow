# ApplyFlow Internal Beta Access Gate 设计

## 1. 设计目标
本设计面向 Internal Beta 阶段（3-5 人），目标是用最小复杂度建立可控访问门禁：

- 支持 3-5 个少数内测用户
- 不开放公开注册
- 不依赖正式域名（继续 workers.dev）
- 在暂不接 Clerk 的阶段，也必须限制任意登录
- Beta Mode 与 Demo Mode 分离
- 面试 Demo 不受影响
- 后续可平滑迁移到 Clerk（不推翻当前边界设计）

## 2. 当前登录风险复盘
基于 Beta Batch 1 只读审计：

1. `public/app.js` 的 `ensureDemoSession` 会在未登录时自动 demo 登录  
- 风险：beta 路径被自动越过登录边界。

2. `/api/login` 当前支持任意邮箱 `ensureUser + issueSession`  
- 位置：`src/server/routes/api.js`  
- 风险：可绕过“仅白名单”目标。

3. `/api/auth/login` 当前仅校验“用户存在”  
- 位置：`src/server/routes/api.js`  
- 风险：缺少“beta allowlist”语义，不足以做内测门禁。

4. `/api/auth/users` 未鉴权暴露用户列表  
- 位置：`src/server/routes/api.js`  
- 风险：泄露用户枚举信息。

5. `x-dev-user` 在 Node runtime 有身份伪造风险  
- 位置：`src/server/auth.js`

6. `user_a fallback / payload.userId` 存在错绑风险  
- 位置：`src/server/store.js`、`src/lib/orchestrator/workflow-controller.js`、`src/lib/discovery/*`

## 3. 推荐 Beta Access Gate 方案
最小可用方案（不实现，只设计）：

1. 白名单邮箱门禁  
- 通过白名单控制 beta 用户登录。  
- 白名单来源建议：环境变量或只读配置，如 `BETA_ALLOWED_EMAILS`。

2. `/api/login` 在 beta/prod 禁止任意建号  
- beta/prod 下不允许“任意邮箱自动建号+登录”。  
- 如需保留，仅限 demo/dev 路径使用。

3. `/api/auth/login` 仅允许白名单用户  
- 用户存在不再是唯一条件，必须同时通过 allowlist。

4. 普通 app 路径未登录策略  
- 返回登录提示页或私有 API 返回 401。  
- 禁止未登录自动进入 demo。

5. `/demo` 显式 Demo Mode  
- `/demo` 不走 beta 白名单。  
- 仅进入 demo_user + demo sandbox。

6. demo 与 beta 账户隔离  
- `demo_user` 与 beta 用户数据严格隔离。  
- `alex/taylor` 保留 demo/dev seed，不作为 beta 用户入口。

## 4. 登录入口设计
### Demo Login
- 入口：`/demo`
- 用户：`demo_user`
- 数据：`demo sandbox`
- 支持 reset
- 不要求 beta 白名单

### Beta Login
- 入口：普通 app 路径（非 `/demo`）
- 用户：必须是白名单邮箱
- 不允许自动建号
- 不允许非白名单邮箱登录
- 不允许共享测试账号
- 登录失败返回清晰提示（例如“当前仅限邀请内测”）

## 5. API 访问策略
只设计，不实现：

1. 未登录访问私有 API：`401`
2. 非白名单用户登录：`403` 或受控错误
3. `/api/auth/users`：删除、admin-only，或至少 `auth + admin`
4. `/api/login`：beta/prod 关闭任意建号；若保留，仅 demo/dev
5. `/api/auth/login`：加入白名单 gate
6. `x-dev-user`：beta/prod 不生效
7. `payload.userId`：后端不信任，仅用 authenticated user

## 6. 用户数据隔离策略
- beta 用户数据按 authenticated user 隔离
- demo_user 数据仅存在 demo sandbox
- 同一 `job_id` 在不同 beta 用户下的 `shortlist/tracker/feedback/materials/submission/follow-up` 互不污染
- demo 写入不能影响 beta 用户
- beta 用户不能访问 demo reset

## 7. 环境变量与配置建议
仅建议，不实现。

建议变量：
- `INTERNAL_BETA_ENABLED`
- `BETA_ALLOWED_EMAILS`
- `DEMO_MODE_ENABLED`
- `DEMO_USER_ID`
- `DEMO_RESET_TOKEN`
- `DEV_AUTH_BYPASS_ENABLED`
- `DEMO_AUTO_LOGIN_ENABLED`
- `AUTH_PROVIDER=internal_beta`（或 `mock_beta`）
- `FUTURE_AUTH_PROVIDER=clerk`

### local（建议值）
- `INTERNAL_BETA_ENABLED=true`
- `BETA_ALLOWED_EMAILS=you@example.com,friend1@example.com`
- `DEMO_MODE_ENABLED=true`
- `DEMO_USER_ID=demo_user`
- `DEMO_RESET_TOKEN=local-dev-reset-token`
- `DEV_AUTH_BYPASS_ENABLED=true`
- `DEMO_AUTO_LOGIN_ENABLED=false`
- `AUTH_PROVIDER=internal_beta`
- `FUTURE_AUTH_PROVIDER=clerk`

### beta-workers.dev（建议值）
- `INTERNAL_BETA_ENABLED=true`
- `BETA_ALLOWED_EMAILS=<3-5个白名单邮箱>`
- `DEMO_MODE_ENABLED=true`
- `DEMO_USER_ID=demo_user`
- `DEMO_RESET_TOKEN=<强随机token>`
- `DEV_AUTH_BYPASS_ENABLED=false`
- `DEMO_AUTO_LOGIN_ENABLED=false`
- `AUTH_PROVIDER=internal_beta`
- `FUTURE_AUTH_PROVIDER=clerk`

### future-production（建议值）
- `INTERNAL_BETA_ENABLED=false`（或仅灰度阶段 true）
- `BETA_ALLOWED_EMAILS=`（为空或迁移到正式 Auth 规则）
- `DEMO_MODE_ENABLED=按运营策略决定`
- `DEMO_USER_ID=demo_user`
- `DEMO_RESET_TOKEN=<仅内部保管>`
- `DEV_AUTH_BYPASS_ENABLED=false`
- `DEMO_AUTO_LOGIN_ENABLED=false`
- `AUTH_PROVIDER=clerk`（切换时）
- `FUTURE_AUTH_PROVIDER=clerk`

## 8. 后续最小代码改造候选
以下仅列候选，不改代码。

### 1. `public/app.js`
- 当前问题：普通路径未登录自动 `ensureDemoSession`。  
- 建议改法：仅 `/demo` 触发 demo session；普通路径显示 beta 登录。  
- 是否影响 demo：低（显式 `/demo` 更稳定）。  
- 验证方式：`/demo` 可进；普通路径不自动 demo 登录。

### 2. `src/server/routes/api.js`
- 当前问题：`/api/login` 任意建号；`/api/auth/users` 未鉴权。  
- 建议改法：给 `/api/login` 加 mode/env 门禁；`/api/auth/login` 加 allowlist；`/api/auth/users` 收口。  
- 是否影响 demo：低（保留 demo 专用登录）。  
- 验证方式：非白名单登录失败；users 不公开。

### 3. `src/server/auth.js`
- 当前问题：`x-dev-user` 可绕过会话。  
- 建议改法：beta/prod 强制禁用，仅 local/dev 可选。  
- 是否影响 demo：低。  
- 验证方式：beta 环境 header 不生效。

### 4. `src/server/store.js`
- 当前问题：`getActiveUserId` 可回退 `user_a`。  
- 建议改法：beta 写入禁止 fallback；demo 明确写 `demo_user`。  
- 是否影响 demo：中（需验证 demo 数据读写完整性）。  
- 验证方式：A/B 隔离 + demo/beta 分离脚本。

### 5. `src/server/repositories/applyflow-repository.js`
- 当前问题：测试用户语义未与 beta 门禁分层。  
- 建议改法：明确 demo_user、beta seed、alex/taylor 角色。  
- 是否影响 demo：正向。  
- 验证方式：seed 后角色边界清晰。

### 6. `cloudflare/worker-entry.js`
- 当前问题：需在 worker 层显式识别 demo/beta mode 与 session 语义。  
- 建议改法：在 request context 注入 mode，并配合 API 门禁。  
- 是否影响 demo：中（需谨慎避免路由误伤）。  
- 验证方式：demo 与 beta 双路径回归。

### 7. `cloudflare/d1/seed.sql`
- 当前问题：demo/beta 数据边界标识弱。  
- 建议改法：引入 demo_user 与 demo-only 数据标记策略。  
- 是否影响 demo：低。  
- 验证方式：reset 后 demo 数据可恢复，beta 数据不受影响。

### 8. `scripts/validation/*`
- 当前问题：缺 beta allowlist 与 demo/beta 分离验证。  
- 建议改法：新增门禁与隔离脚本。  
- 是否影响 demo：低。  
- 验证方式：脚本在 workers.dev 可重复通过。

## 9. 必须新增验证脚本
以下脚本为建议清单（命名可微调）：

1. `validate-demo-path-smoke.js`  
- 验证 `/demo` 可打开，主路径可见。

2. `validate-beta-whitelist-gate.js`  
- 验证仅白名单邮箱可走 beta 登录。

3. `validate-login-endpoint-guarded.js`  
- 验证 beta/prod 下 `/api/login` 不能任意建号。

4. `validate-auth-users-not-public.js`  
- 验证 `/api/auth/users` 未授权不可访问。

5. `validate-no-x-dev-user-in-beta.js`  
- 验证 beta 下 `x-dev-user` 无效。

6. `validate-beta-ab-isolation.js`  
- 验证 A/B beta 用户数据隔离。

7. `validate-demo-beta-data-separation.js`  
- 验证 demo_user 写入不影响 beta 用户。

8. `validate-no-auto-demo-login-in-beta.js`  
- 验证普通路径未登录不自动进入 demo。

9. `validate-demo-reset-guarded.js`  
- 验证 `/api/demo/reset` 仅 dev/admin 或 reset token 可用。

## 10. 风险与取舍
### Blocker
- 自动建号残留（`/api/login` 未收口）  
风险：可绕过白名单，内测门禁失效。

- demo 和 beta session 混用  
风险：权限边界失效，数据可能串号。

### High
- `user_a fallback` 未清理  
风险：写入误落默认用户，破坏多用户隔离。

- 白名单配置泄漏（如环境变量暴露或日志泄漏）  
风险：未授权用户可推测内测名单。

### Medium
- 继续暂不接 Clerk 的短期风险  
风险：自建 beta gate 维护成本上升，但可接受于 3-5 人阶段。

- 面试演示被登录改造误伤  
风险：入口切换导致演示中断；需 `/demo` smoke + reset 保障。

### Low
- 策略切换复杂度提升  
风险：demo/beta 双模式下理解成本增加；可通过文档与脚本缓解。

## 11. 进入 Beta Batch 4 的前置条件
- Demo Mode 设计已确认（`docs/INTERVIEW_DEMO_MODE_DESIGN.md`）
- Beta Access Gate 设计已确认（本文件）
- 白名单邮箱策略已确认
- `/demo` 入口策略已确认
- `/api/login` 在 beta/prod 的行为已确认
- `/api/auth/users` 处理策略已确认
- A/B 用户隔离验证脚本范围已确认
- 仅在 Batch 4 才允许最小代码改造

## 12. Batch 4 Close 状态标记
- 当前仅达到“3-5 人 Internal Beta 候选可验证状态”。
- 当前仍不是 Production Auth Ready。
- 当前仍不是 50-user beta ready。
- `/api/demo/reset` 已加双门禁，但仍返回 guarded `501`，reset 实现后置。
- `user_a fallback / payload.userId` 全量治理未完成，需在后续批次单独治理并补齐验证。

## 13. Ownership Guard Close（2026-05-15）
- 已完成 `user_a / payload.userId` 关键风险收敛：
  - beta/staging/prod-like 用户态写入不再 fallback `user_a`
  - API 不再信任前端 `payload.userId`（与 authenticated user 不一致时拒绝）
  - discovery/import/sync 用户归属改为服务端 request context 派生
- 新增验证：`validate-auth-forged-userid-rejected.js`
  - 覆盖 forged `payload.userId -> B/demo_user/staging_real_pool_user`
  - 覆盖缺失 payload.userId 时写入归属
  - 覆盖 `user_a` 计数不漂移与 demo/real-pool 计数稳定
