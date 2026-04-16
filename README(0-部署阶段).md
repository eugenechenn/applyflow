# ApplyFlow 项目完整总结（从 0 到 Cloudflare 上线）

## 一、项目定位

**ApplyFlow = AI 驱动的求职工作流系统（Job Application OS）**

目标不是做一个简单工具，而是：

> 把“找工作”变成一个结构化、可追踪、可决策的工作流系统

核心理念：

* 用户不是“投简历”，而是在**运行一个工作流**
* AI 不只是辅助，而是参与：

  * 判断（fit / strategy）
  * 决策（recommendation）
  * 执行（prep / generation）

---

## 二、系统核心结构

### 1. 前端（当前）

路径：

```
/public
  ├── app.js
  ├── styles.css
  └── index.html
```

特点：

* 单页应用（非 React）
* 由 `renderDashboard / renderJobs / renderJobDetail / renderPrep` 驱动
* 已统一为：

  * Apple 风格设计语言
  * Workbench（工作台）结构

---

### 2. 后端（Cloudflare Worker）

路径：

```
/cloudflare/worker-entry.js
```

作用：

* API 路由（/api/*）
* session / cookie 管理
* 用户隔离（multi-user）
* 调用 LLM
* 调用数据库（D1）

---

### 3. 数据层

#### 本地开发：

```
SQLite
```

#### 线上：

```
Cloudflare D1
```

结构：

```
store → repository → view-model → UI
```

---

### 4. AI / LLM 层

已接入：

* Job Ingestion
* Fit Evaluation
* Prep Generation

支持：

* fallback（失败回退）
* async 调用
* structured output

---

### 5. 多用户系统

已实现：

* session
* user_id 注入（AsyncLocalStorage）
* workspace 隔离

数据隔离：

* jobs
* proposals
* audits
* prep
* reflections

---

## 三、当前功能模块

### 1. Dashboard（工作台首页）

结构：

* Hero（当前 focus / policy）
* Metrics（转化率等）
* Workbench（当前任务）
* Recent Jobs

目标：

> 让用户知道“现在该做什么”

---

### 2. Jobs（岗位列表）

特点：

* 从“数据表” → “决策列表”
* 强调：

  * priority
  * recommendation
  * strategy

---

### 3. Job Detail（决策页）

核心区块：

* Hero Decision Area
* Next Action
* Decision / Recommendation
* Policy explainability
* Timeline

目标：

> 从“信息展示页”变成“决策中枢”

---

### 4. Prep（申请准备）

结构：

* Resume tailoring
* Narrative pack
* Checklist / readiness

目标：

> 从“表单页”变成“执行工作台”

---

### 5. Governance（策略治理）

包含：

* policy version
* proposals
* audit logs
* diff / review

目标：

> 把 AI 行为变成“可治理系统”

---

## 四、设计体系（DESIGN.md）

核心思想：

> 不只是 UI，而是产品表达方式

### 关键原则：

* 黑白灰 + Apple Blue
* 少色彩，强调主操作
* 大块留白
* 信息分层清晰
* Hero + Section 结构
* CTA 明确

---

## 五、架构演进（你已经完成的）

### 阶段 1：单机 demo

* 本地 Node
* SQLite
* 无用户隔离

---

### 阶段 2：多 agent / AI 能力

* ingestion / fit / prep
* policy / governance

---

### 阶段 3：产品化前端

* Apple 风格
* Workbench 结构
* 决策优先 UI

---

### 阶段 4：多用户系统

* session
* user_id 隔离
* workspace

---

### 阶段 5：云部署（你刚完成）

✔ Cloudflare Worker
✔ D1 数据库
✔ Secrets（API Key / Session）
✔ Wrangler 配置
✔ workers.dev 域名

---

## 六、部署架构（当前线上）

```
Browser
   ↓
Cloudflare Worker
   ├── API (/api)
   ├── Session/Auth
   ├── LLM 调用
   └── D1 数据库
   ↓
Static Assets (/public)
```

访问地址：

```
https://applyflow.applyflow-eugene.workers.dev
```

---

## 七、部署流程总结（你必须记住）

### 1. 登录

```
npx wrangler login
```

或 API Token

---

### 2. 创建 D1

```
npx wrangler d1 create applyflow
```

---

### 3. 配置 wrangler.jsonc

```json
{
  "name": "applyflow",
  "main": "cloudflare/worker-entry.js",
  "d1_databases": [...]
}
```

---

### 4. 设置 secrets

```
npx wrangler secret put LLM_API_KEY
npx wrangler secret put SESSION_SECRET
```

---

### 5. 初始化数据库

```
npm run cf:d1:execute:schema
npm run cf:d1:execute:seed
```

---

### 6. 本地预览

```
npm run cf:dev
```

---

### 7. 部署

```
npm run cf:deploy
```

---

## 八、当前真实状态（非常重要）

你现在：

✔ 已上线
✔ 有公开 URL
✔ 有真实后端
✔ 有真实数据库
✔ 有 AI 能力

但：

⚠️ 还不是 production-grade

---

## 九、还没完成的关键部分

### 1. 安全

* auth（登录系统）
* rate limit
* CSRF
* 更安全 session

---

### 2. 数据层

* JSON → 完整 schema
* 索引优化
* migration

---

### 3. 观测

* logs
* error tracking
* metrics

---

### 4. UI/UX

* copy 功能
* loading skeleton
* 空状态设计
* 响应式布局

---

### 5. AI 稳定性

* retry
* fallback 模型
* prompt versioning

---

## 十、你接下来应该做的路线

### 阶段 1（现在）

👉 验证线上功能是否正常

---

### 阶段 2

👉 修 bug + 稳定系统

---

### 阶段 3

👉 引入 Stitch / UI 升级

---

### 阶段 4

👉 做成作品集级项目

---

## 十一、这个项目的价值（面试角度）

你这个项目体现了：

* 多 agent 系统设计
* AI + 产品融合
* 决策系统设计
* 前后端一体
* 云部署能力（Cloudflare）
* 多用户系统
* 数据建模能力

---

## 十二、总结一句话

> ApplyFlow 不是一个“工具”，而是一个 AI 驱动的决策与执行系统（Application Operating System）

---

## 附：你已经做到的最重要的一步

👉 你已经把项目：

**从“本地 demo” → “云上可访问产品”**

这一步，是绝大多数人做不到的。
