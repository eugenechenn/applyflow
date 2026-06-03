# ApplyFlow 产品化上线 Batch 1A：方案 A 最低成本灰度版域名与环境配置落地计划

## 1. 方案 A 目标
本方案用于最低成本灰度上线准备，目标是以最小改动把真实用户入口从 `workers.dev` 迁移到正式域名，同时避免提前引入跨子域 API 和复杂 Auth/CORS 风险。

- 用正式域名替代真实用户入口的 `workers.dev`
- 先不引入独立 `api` 子域
- App 和 API 同源部署在 `app` 子域
- `www` 子域只做 landing/waitlist，不承载业务 session
- `workers.dev` 暂时保留为 staging/fallback

## 2. 目标域名结构
当前正式域名已确定为 `apply-flow-use.com`：

- `https://www.apply-flow-use.com`：Landing / waitlist（可先预留）
- `https://app.apply-flow-use.com`：ApplyFlow App + API（同源）
- `https://applyflow.applyflow-eugene.workers.dev`：仅作为 staging/fallback，不作为真实用户入口

说明：本轮优先绑定 `app.apply-flow-use.com` 到 Worker；`www` 后续可做 landing 或重定向。

## 3. 为什么暂不使用 api 子域
方案 A 阶段不引入 `api.apply-flow-use.com`，原因如下：

- 当前系统主路径更接近同源模型，先保持低风险迁移
- 现状未形成成熟的显式 CORS 治理闭环，提前拆域会放大配置风险
- 当前 session/cookie 行为以 host-only 预期为主，跨子域会带来 domain/sameSite/secure 策略复杂度
- 独立 API 子域会提前引入跨域调用、回调地址、登出跳转、多环境 allowlist 同步问题
- Batch 1A 目标是“先切正式入口”，不是“并行完成域拆分 + Auth 重构”

## 4. Cloudflare 侧操作清单
以下为当前执行清单：

1. 已购买正式域名：`apply-flow-use.com`
2. 域名已在 Cloudflare 购买，DNS 托管默认在 Cloudflare
3. 为当前 Worker 添加 Custom Domain：`app.apply-flow-use.com`
4. 选择是否将 `www.apply-flow-use.com` 绑定为 landing/waitlist（可先静态页）
5. 确认 SSL 证书自动签发并生效
6. 保留 `applyflow.applyflow-eugene.workers.dev` 作为 staging/fallback
7. 明确生产流量入口只对外公布 `app` 正式域名，不再引导真实用户使用 workers.dev

## 5. 需要引入的环境变量模型
本节定义目标变量模型。Batch 1 当前先完成 `app` 正式入口，不引入独立 `api` 子域。

### production
- `APP_BASE_URL=https://app.apply-flow-use.com`
- `PUBLIC_SITE_URL=https://www.apply-flow-use.com`
- `ALLOWED_ORIGINS=https://app.apply-flow-use.com,https://www.apply-flow-use.com`
- `AUTH_PROVIDER=clerk`
- `CLERK_PUBLISHABLE_KEY=pk_live_xxx`
- `CLERK_SECRET_KEY=sk_live_xxx`
- `SIGN_IN_URL=https://app.apply-flow-use.com/sign-in`
- `SIGN_UP_URL=https://app.apply-flow-use.com/sign-up`
- `AFTER_SIGN_IN_URL=https://app.apply-flow-use.com/dashboard`
- `AFTER_SIGN_UP_URL=https://app.apply-flow-use.com/onboarding`
- `SIGN_OUT_REDIRECT_URL=https://www.apply-flow-use.com/`
- `DEMO_AUTO_LOGIN_ENABLED=false`
- `DEV_AUTH_BYPASS_ENABLED=false`
- `EDGE_ALLOWED_HOSTS=app.apply-flow-use.com`

### staging（占位）
- `APP_BASE_URL=https://applyflow.applyflow-eugene.workers.dev`
- `PUBLIC_SITE_URL=https://applyflow.applyflow-eugene.workers.dev`
- `ALLOWED_ORIGINS=https://applyflow.applyflow-eugene.workers.dev`
- `AUTH_PROVIDER=clerk`
- `CLERK_PUBLISHABLE_KEY=pk_test_xxx`
- `CLERK_SECRET_KEY=sk_test_xxx`
- `SIGN_IN_URL=https://applyflow.applyflow-eugene.workers.dev/sign-in`
- `SIGN_UP_URL=https://applyflow.applyflow-eugene.workers.dev/sign-up`
- `AFTER_SIGN_IN_URL=https://applyflow.applyflow-eugene.workers.dev/dashboard`
- `AFTER_SIGN_UP_URL=https://applyflow.applyflow-eugene.workers.dev/onboarding`
- `SIGN_OUT_REDIRECT_URL=https://applyflow.applyflow-eugene.workers.dev/`
- `DEMO_AUTO_LOGIN_ENABLED=false`（建议）
- `DEV_AUTH_BYPASS_ENABLED=false`（建议）
- `EDGE_ALLOWED_HOSTS=applyflow.applyflow-eugene.workers.dev`

### local（占位）
- `APP_BASE_URL=http://localhost:8787`
- `PUBLIC_SITE_URL=http://localhost:8787`
- `ALLOWED_ORIGINS=http://localhost:8787,http://127.0.0.1:8787`
- `AUTH_PROVIDER=clerk`
- `CLERK_PUBLISHABLE_KEY=pk_test_local_xxx`
- `CLERK_SECRET_KEY=sk_test_local_xxx`
- `SIGN_IN_URL=http://localhost:8787/sign-in`
- `SIGN_UP_URL=http://localhost:8787/sign-up`
- `AFTER_SIGN_IN_URL=http://localhost:8787/dashboard`
- `AFTER_SIGN_UP_URL=http://localhost:8787/onboarding`
- `SIGN_OUT_REDIRECT_URL=http://localhost:8787/`
- `DEMO_AUTO_LOGIN_ENABLED=true`（仅本地调试可选）
- `DEV_AUTH_BYPASS_ENABLED=true`（仅本地调试可选）
- `EDGE_ALLOWED_HOSTS=localhost,127.0.0.1`

## 6. 后续代码改造候选清单
以下基于 Batch 1 审计结论整理，本轮不改动，仅定义后续改造范围。

1. `public/extensions/applyflow-edge-mvp/popup.html`
- 为什么需要改：可能包含当前 host/入口提示，正式域名切换后需同步。
- 建议 Batch：Batch 1（域名 readiness）或 Batch 5（回归补强）。
- 验证方式：Edge 插件手动 smoke，确认从 `app` 正式域名触发流程可用。

2. `public/downloads/popup.html`
- 为什么需要改：下载包中的 UI/文案/链接可能仍指向 workers.dev。
- 建议 Batch：Batch 1。
- 验证方式：重新下载并加载扩展，检查入口链接与提示域名。

3. `public/extensions/applyflow-edge-mvp/content.js`
- 为什么需要改：allowed hosts 或域匹配逻辑需纳入 `app` 正式域名。
- 建议 Batch：Batch 1。
- 验证方式：正式域名页面注入与消息通信 smoke。

4. `public/downloads/content.js`
- 为什么需要改：离线分发版本可能内置旧 host allowlist。
- 建议 Batch：Batch 1。
- 验证方式：下载版扩展在正式域名与 staging 域名双环境验证。

5. `scripts/validation/validate-phase10a-workflow-playwright.js`
- 为什么需要改：验证脚本基准 URL 需支持通过 `BASE_URL` 切换到正式域名。
- 建议 Batch：Batch 1 或 Batch 5。
- 验证方式：同一脚本分别对 `app` 正式域名与 workers.dev 运行并对比结果。

6. `scripts/validation/diagnose-production-onboarding-bootstrap.js`
- 为什么需要改：生产链路诊断可能写死 workers.dev 路径。
- 建议 Batch：Batch 1。
- 验证方式：使用占位/实际生产域名执行诊断，确认无硬编码依赖。

7. `src/server/auth.js`
- 为什么需要改：需确保 production 不接受 dev bypass 头（如 `x-dev-user`）并与托管 Auth 对接设计一致。
- 建议 Batch：Batch 2（设计）与 Batch 3（最小接入）。
- 验证方式：production 环境伪造 dev 头应无效；未登录私有 API 返回 401。

8. `cloudflare/worker-entry.js`
- 为什么需要改：入口层可能涉及 origin/base-url 判定、会话或路由策略，需要与正式域名同源模型对齐。
- 建议 Batch：Batch 1（仅域名/env相关）或 Batch 3（Auth 接入联动）。
- 验证方式：正式域名下主路径与 API 路由回归通过。

9. `.env.example / .dev.vars.example / wrangler docs`
- 为什么需要改：需要把域名、Auth、allowlist、demo/dev 开关变量模型文档化，降低误配风险。
- 建议 Batch：Batch 1、Batch 2。
- 验证方式：按模板生成 env 后，验证脚本可在 production/staging/local 切换运行。

## 7. Cutover 前必须通过的 smoke
以下为 cutover 前最低验证清单：

1. `app` 正式域名首页可访问
2. `https://app.apply-flow-use.com/api/auth/session` 响应正常（状态码与当前阶段预期一致）
3. `dashboard/jobs/profile/materials` 主路径可访问（按当前权限策略表现）
4. 未登录策略符合当前阶段预期（不得出现 production 自动 demo 登录）
5. Edge extension `allowed hosts` 已包含正式 `app` 域名
6. 验证脚本可通过 `BASE_URL` 指向正式域名运行
7. workers.dev 仍可作为 staging/fallback 验证
8. 仓库不新增 `sqlite`/`.bak` 误提交 diff

## 8. Decision Needed
以下事项需人工决策后才能推进：

1. 最终正式域名是什么：已确定 `apply-flow-use.com`
2. 是否选择 `useapplyflow.com` / `getapplyflow.com` / `applyflow.app` / 其他：已不适用
3. `www` 是否先做简单 landing（静态介绍 + waitlist）
4. `workers.dev` 是否长期保留给 staging
5. demo 是否未来放到独立 `demo` 子域
6. 何时进入 Batch 2（Clerk 设计）

## 9. 当前状态
- Batch 1 只读审计已完成
- Batch 1A 已进入正式域名配置阶段：`wrangler.jsonc` 已声明 `app.apply-flow-use.com` Custom Domain
- 2026-06-03 已完成第一阶段部署：`app.apply-flow-use.com` 和 `workers.dev` 均作为 Worker trigger 可访问
- 正式域名已开启 internal beta 门禁：仅 `BETA_ALLOWED_EMAILS` 中的 `eugenec7012@126.com` 可登录，demo 自动登录与 dev bypass 均关闭
- 已完成线上验证：正式域名首页 200、production online smoke PASS、非白名单登录拒绝、白名单账号可登录并通过 `/api/jobs` 拉取当前账号可见岗位
- 当前状态仍不是 Production Auth Ready；只是完成 3-5 人白名单内测前的正式入口和最小门禁
- 下一步是手动体验检查、作品集链接替换，以及后续 Batch 2/3 Auth 方案决策
- 在正式 Auth 方案未决策前，不进入 Batch 3 Auth 实现
