# ApplyFlow Interview Demo Mode 设计

## 1. 设计目标
本设计面向 Internal Beta 阶段，目标是同时满足“面试演示稳定”与“少数真实用户内测隔离”：

- 面试演示路径必须继续稳定可复现
- Demo Mode 与 Internal Beta Mode 必须分离
- Demo 数据不应污染真实 beta 用户数据
- Demo 入口必须显式，不再依赖全局“未登录自动登录”
- 当前阶段不接 Clerk，不做正式 SaaS Auth

## 2. 当前问题复盘
基于 Beta Batch 1 只读审计，当前存在以下问题：

1. `public/app.js` 存在自动 demo 登录链路  
- `DEMO_AUTO_LOGIN_EMAIL`：`public/app.js`  
- `ensureDemoSession`：`public/app.js`  
- 路由未登录时自动调用 `ensureDemoSession`：`public/app.js`  
- 结果：未登录访问会被自动登录，不符合 beta 白名单准入边界。

2. `/api/login` 允许任意邮箱自动建号并发会话  
- 位置：`src/server/routes/api.js`  
- 行为：`store.findUserByLogin(...) || store.ensureUser(...)` 后 `issueSession(...)`  
- 结果：可绕过“仅白名单内测用户”目标。

3. `/api/auth/users` 未鉴权直接返回用户列表  
- 位置：`src/server/routes/api.js`  
- 返回字段包含 `id/email/username/createdAt`  
- 结果：暴露用户枚举信息。

4. `user_a fallback / payload.userId` 仍存在  
- `getActiveUserId` 默认回退：`src/server/store.js`  
- `payload.userId || ... || "user_a"`：`src/lib/orchestrator/workflow-controller.js`  
- discovery 默认 `user_a`：`src/lib/discovery/job-discovery-pipeline.js`、`src/lib/discovery/feishu-sync-layer.js`  
- 结果：存在错绑与跨用户污染风险。

为什么这些问题“阻止 Internal Beta，但暂时不阻止面试演示”：  
- 面试演示只需稳定单一演示身份，自动登录和 demo 数据反而提升演示确定性。  
- Internal Beta 需要身份边界、白名单和用户隔离，上述行为直接破坏边界，因此在 Beta 前必须收口。

## 3. 推荐 Demo Mode 方案
推荐路线：`demo mode + beta mode 分离`（当前阶段最省事且风险可控）。

设计要点：

1. 显式 demo 入口  
- 建议统一入口：`/demo` 或 `/?mode=demo`（二选一，避免并存歧义）。

2. Demo 用户固定化  
- Demo 仅使用专用 demo user（建议新增 `demo_user`），不复用真实 beta 用户。

3. Session 语义分离  
- Demo session 与 beta session 在服务端语义区分（至少包含 mode 标记）。

4. Demo 默认只读  
- 仅演示读取流程。  
- 若必须写入，写入 demo sandbox（独立 demo 用户域），并支持重置。

5. 数据边界  
- Demo 不可访问 beta 白名单用户数据。  
- Demo 不触发真实外部提交（browser apply / external submit 仅 dry-run）。

6. 演示范围限定  
- Demo 仅用于：`Dashboard -> Jobs -> Shortlist -> Compare -> Profile/Materials -> Submit/Dry-run`

## 4. Demo Mode 只读策略
### 应允许
- 查看 Dashboard
- 查看 Jobs
- 查看 scoring / explanation
- 查看 Profile / Materials 示例
- 查看 Submit / Dry-run 示例

### 应禁止或强制 sandbox
- 修改真实 profile
- 修改真实 shortlist / tracker / feedback
- 上传真实 resume
- 写真实 submission audit
- 触发真实 browser apply
- 调用外部真实提交接口

建议执行规则：  
- Demo 请求默认走只读策略；写操作要么直接拒绝，要么重定向到 demo sandbox。

## 5. Demo 数据来源与重置策略
### 当前状态
- Demo seed：`src/mock/applyflow-demo-data.js`
- 测试用户：`alex/taylor` 在 `src/server/repositories/applyflow-repository.js` 与 `cloudflare/d1/seed.sql`

### 建议
1. 建议创建专用 `demo_user`  
- `alex/taylor` 保留为 demo/dev seed，但不作为 beta 用户。

2. demo data 来源  
- 固定 seed（可版本化），避免每次演示状态漂移。

3. demo reset 机制  
- 建议有 `demo reset endpoint`，用于面试前恢复干净状态。  
- 该 endpoint 仅允许 dev/admin 使用，不对普通用户开放。

4. 面试前恢复流程  
- 演示前执行 reset -> 打开 demo 入口 -> 按 smoke 检查主路径。

## 6. 路由与 API 设计建议
只做设计，不实现。

1. 前端识别 demo mode  
- 通过显式 route/query（如 `/demo` 或 `mode=demo`）设置运行模式。  
- 普通 app 路径未登录时，不再自动 demo 登录。

2. 后端识别 demo session  
- session 中增加 mode 语义（demo/beta）。  
- API 根据 mode 决定只读/可写策略。

3. 登录接口拆分建议  
- `/api/login` 不再承担任意邮箱自动建号。  
- 建议拆为 demo login 与 beta login（或同接口+严格 mode/white-list 校验）。

4. demo 专用接口建议  
- 可选：`/api/demo/session`（显式建立 demo 会话）  
- 可选：`/api/demo/reset`（重置 demo 数据，dev/admin-only）

5. 私有 API 在 demo mode 的行为  
- 读取类：返回 demo 数据（只读视图）  
- 写入类：拒绝或写入 demo sandbox，禁止写入 beta 用户域

## 7. 对现有代码的最小改造建议
以下仅列候选改造点，不改代码。

### 1. `public/app.js`
- 当前问题：未登录自动触发 `ensureDemoSession`。  
- 建议改法：改为显式 demo 入口触发；普通路径未登录仅显示登录/提示。  
- 是否影响面试演示：可控（显式 demo 入口更稳定）。  
- 验证方式：demo 入口可进；普通入口不再自动登录。

### 2. `src/server/routes/api.js`
- 当前问题：`/api/login` 任意邮箱建号；`/api/auth/users` 未鉴权暴露。  
- 建议改法：收口 `/api/login` 到 demo/dev 受控场景；`/api/auth/users` 下线或 admin-only。  
- 是否影响面试演示：低（提供专用 demo 登录路径）。  
- 验证方式：未授权访问 users 失败；beta 路径不能任意建号。

### 3. `src/server/auth.js`
- 当前问题：Node 路径可读 `x-dev-user`。  
- 建议改法：仅 dev 可用或移除，beta/production 禁用。  
- 是否影响面试演示：低。  
- 验证方式：beta 环境 `x-dev-user` 不生效。

### 4. `src/server/store.js`
- 当前问题：`getActiveUserId` 可回退 `user_a`。  
- 建议改法：beta 写入必须依赖 authenticated user；demo 模式走 demo_user/sandbox。  
- 是否影响面试演示：中（需确保 demo 读路径稳定）。  
- 验证方式：A/B 用户隔离 + demo 不污染 beta。

### 5. `src/server/repositories/applyflow-repository.js`
- 当前问题：测试用户与初始 workspace 混合在同一初始化逻辑。  
- 建议改法：拆分 demo seed 与 beta seed 语义，保留可重置 demo workspace。  
- 是否影响面试演示：正向（可重复恢复）。  
- 验证方式：demo reset 后状态一致。

### 6. `cloudflare/d1/seed.sql`
- 当前问题：demo 与非 demo 数据边界未显式标记。  
- 建议改法：补充 demo/beta 语义标识或分层 seed 策略。  
- 是否影响面试演示：低。  
- 验证方式：seed 后 demo 与 beta 数据可区分。

### 7. validation scripts
- 当前问题：缺 demo/beta 分离验证。  
- 建议改法：新增 demo path、readonly、隔离、reset 脚本。  
- 是否影响面试演示：低。  
- 验证方式：新增脚本在 workers.dev 可重复通过。

## 8. 面试演示 Smoke Test
建议新增/补充验证清单：

1. `demo path can open`
2. `demo dashboard/jobs/profile/materials visible`
3. `demo submit/dry-run` 不触发真实外部提交
4. demo 操作不污染 beta user
5. demo reset 后数据恢复
6. 现有 `validate:ui-runtime-smoke` / `validate:ui-key-path-playwright` 支持 demo mode 参数（如 `BASE_URL + MODE=demo`）

## 9. 风险与取舍
### Blocker
- 保持当前 auto-login 不变（`public/app.js` 自动 `ensureDemoSession`）  
风险：beta 身份边界失效，无法满足白名单内测。

### High
- demo 写入真实用户数据  
风险：demo 与 beta 串号，影响内测可信度与数据安全。

- demo 与 beta session 混用  
风险：权限策略失效，容易出现越权读取或误写。

### Medium
- demo 改造误伤面试演示路径  
风险：入口变化导致演示当天流程中断。  
缓解：显式 demo 入口 + 演示前 smoke + reset。

### Low
- 严格只读 demo 降低交互真实性  
风险：演示手感略降。  
缓解：提供可控 sandbox 写操作（非真实数据）。

## 10. 下一步进入 Beta Batch 3 的前置条件
- Demo Mode 设计确认后，才能进入 Internal Beta Access Gate 设计
- Beta Access Gate 必须以白名单邮箱为基础
- Beta Mode 不能依赖自动 demo 登录
- Beta Mode 不能依赖任意邮箱 `/api/login`
- Beta Mode 必须保护 `/api/auth/users`

## 11. Batch 4 Close 状态标记
- 当前仅达到“3-5 人 Internal Beta 候选可验证状态”。
- 当前不是 Production Auth Ready，也不是 50-user beta ready。
- Demo 路径已保留为显式入口，但 `/api/demo/reset` 仍为 guarded `501`（未实现）。
- `user_a fallback / payload.userId` 仍属后续专项治理，不在本批次关闭范围内。

## 12. Staging Demo 入口收口（Batch 5E）
- staging（`https://applyflow-staging.applyflow-eugene.workers.dev`）当前 canonical demo 入口为：`/?mode=demo#/dashboard`。
- staging 上 `/demo` 会出现 `307 -> /`，短期不作为面试演示入口。
- 普通路径（`/` 或 `/#/dashboard`）未登录保持 Internal Beta 登录页，不自动 demo 登录。
- 远端自动 smoke 在部分执行环境可能因 workers.dev TLS/网络不可达失败；此时以人工浏览器验收为准。
- 当前状态仍不是 Production Auth Ready，仍不是 50-user beta ready。

## 13. UX/Profile Flow 最小收口（Batch UX-1 + UX-2）
- Dashboard 的角色是“快速输入求职意图”，用于最短路径进入 Jobs/排序决策。
- Profile 的角色是“高级偏好 + 材料信息补充”，用于提高解释质量与网申自动填充完整度。
- `name/background` 不再作为 `/api/profile/save` 的强制阻断字段，避免先填偏好后被强制跳 Profile。
- 缺少 `name/background` 时前端保持非阻断提醒，不把材料完整度误判为已完成。
- 排序核心合同（`userPriorityScore`、`comparator`、acceptance/gate）在本批次保持冻结。
