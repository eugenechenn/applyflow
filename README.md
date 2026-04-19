# ApplyFlow

更新时间：2026-04-18

ApplyFlow 是一个面向真实求职执行闭环的半自动求职工作台。它不是“自动海投机器人”，也不是单点简历润色工具，而是把岗位导入、匹配评估、申请准备、状态推进、反馈回流放进一个可追踪、可解释、可持续迭代的系统里。

## 1. 项目定位

ApplyFlow 当前最准确的定位是：

- 一个可部署、可多用户、具备基础 Agent 编排能力的求职执行系统
- 一个以人机协作为核心的求职工作台，而不是全自动外投工具
- 一个兼顾产品闭环与工程能力的 AI 岗位作品集项目

当前明确不做：

- 全自动海投
- 重型浏览器自动投递
- 复杂 RAG 平台
- 企业级权限系统
- 重型分布式多 Agent 框架

## 2. 当前架构

### 前端 / 主应用

- 前端与 API 主系统运行在 Cloudflare Worker / 静态页面链路上
- 页面包含：Dashboard、Jobs、Job Detail、Prep、Profile、Governance、Interviews
- 前端通过轻量 view-model 层消费 API，不直接耦合后端原始字段

### 数据层

- 数据库：Cloudflare D1
- 持久化对象包括：用户画像、岗位、评估结果、申请准备、策略、提案、审计日志、简历解析结果等
- Worker 端通过 repository / facade 层访问数据，不直接散落 SQL

### 简历解析服务

- 独立运行在 Railway 的 `resume-parser` Node 服务
- 负责 PDF / DOCX 简历文本提取、清洗、结构化与质量评估
- Cloudflare Worker 通过外部解析服务调用，不在 Worker 内做重型文档解析

### LLM 层

- 已支持 OpenAI-compatible provider 配置
- 统一环境变量：`LLM_PROVIDER` / `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`
- Job Ingestion / Fit Evaluation / Prep Generation 均支持 LLM 优先 + fallback

## 3. 当前产品能力

### 已具备的主流程能力

- 用户画像编辑与保存
- New Job / URL 导入岗位
- Job Ingestion
- Fit Evaluation
- Prep 生成与编辑
- Job 状态推进
- Dashboard / Jobs / Job Detail 联动
- Governance / Policy / Audit 展示

### 已具备的简历链路能力

- 用户可上传 PDF / DOCX 原始简历
- 简历解析结果写入数据库并可回显
- 页面优先展示结构化结果与摘要，而不是直接展示原始文本
- 后续申请准备会优先使用简历结构化结果

## 4. 最近已解决的问题

### 已验证通过

- PDF 上传链路已打通：前端 -> Cloudflare Worker -> Railway resume-parser -> D1 -> 页面回显
- 普通文本型 PDF 已可成功解析，并返回真实文本
- 对文本型 PDF，解析方式可返回 `pdf-parse`，状态可达 `success`

### 仓库中已完成，待线上重新部署验证

- 对异常 / Canva-like / 非标准 PDF，已增加多阶段解析 pipeline：
  - Stage A：`pdf-parse`
  - Stage B：`pdfjs-dist`
  - Stage C：低质量回退与清洗
- 已增加清洗逻辑，避免 `%PDF-1.4`、`obj`、`xref`、`trailer` 等 PDF 结构噪音直接进入前端
- 已在 Worker 存取层增加兜底净化：即使解析结果低质量，前端也不应再直接看到 PDF 垃圾原文
- 已把前端简历展示逻辑收紧为：优先结构化结果，其次安全摘要，低质量回退只显示用户提示

### 为什么 Cloudflare 与 Railway 需要分别部署

- Railway：负责 `resume-parser`，承载 Node 文档解析能力
- Cloudflare：负责主应用、前端、API、D1 读写与页面展示
- 因此简历相关线上修复往往需要两边分别部署：
  - Railway 更新解析能力
  - Cloudflare 更新展示逻辑与持久化净化逻辑

## 5. 当前系统边界

### 当前可用边界

- 文本型 PDF：可用
- DOCX：通常更稳定，仍是推荐上传格式
- 非标准 / Canva-like PDF：已有多阶段解析与清洗，但鲁棒性仍需继续提升

### 当前明确未完成

- 扫描型 / 图片型 PDF：仍可能失败
- 当前没有 OCR
- 当前没有“上传后自动二次识别图片型 PDF”的能力

## 6. 当前项目状态判断

当前项目已经不再是纯 demo 页面，而是：

- 一个可继续迭代的产品原型
- 一个具备部署结构、真实外部服务、持久化与多用户边界的候选产品
- 一个在 AI 岗位面试中可讲清楚系统设计、部署拆分、失败兜底和人机边界的工程项目

但它还不是生产级 SaaS，主要差距在：

- 简历解析鲁棒性还未完全覆盖非标准 PDF
- 申请准备输出质量仍需更强的 job-specific 优化
- 多阶段 pipeline 还不是异步队列化执行系统
- 认证、监控、可观测性仍是最小版本

## 7. 本地运行与部署

### 本地开发

```bash
npm install
npm run dev
```

### Railway resume-parser

Start Command:

```bash
npm run start:resume-parser
```

### Cloudflare

```bash
npx wrangler deploy --config wrangler.jsonc
```

## 8. 当前最重要的下一步

### P0

- 完成线上简历链路的最终验收：
  - 普通 PDF 成功解析
  - Canva-like PDF 不再向前端暴露垃圾文本
- 提升申请准备（Resume Tailoring / Explainability）的真实使用价值

### P1

- 强化岗位定制化简历优化
- 强化申请准备包（自我介绍 / 问答 / why me / talking points）
- 让 Prep 更接近真实求职材料工作区

### P2

- OCR fallback
- 异步队列 / retry / replay
- 更强的 pipeline trace UI
- 更完整的可观测性与生产级认证

## 9. 失败治理规则

当项目进入“多轮失败 / 修复回退 / 新旧逻辑混版 / 乱码重新出现”的状态时，不应直接继续补丁式改业务代码。

从现在开始，必须先运行：

- [skills/method-switch-and-recovery/SKILL.md](E:\my-agent\applyflow\skills\method-switch-and-recovery\SKILL.md)

适用场景包括：

- 同类问题连续两轮未解决
- 修复后再次回退
- 页面重新出现乱码
- schema 已变但 UI 仍按旧字段渲染
- 工作区左/右任一侧再次失真或为空

执行顺序：

1. 看 [failure-triggers.md](E:\my-agent\applyflow\skills\method-switch-and-recovery\failure-triggers.md)
2. 看 [decision-matrix.md](E:\my-agent\applyflow\skills\method-switch-and-recovery\decision-matrix.md)
3. 锁定 [validation-gates.md](E:\my-agent\applyflow\skills\method-switch-and-recovery\validation-gates.md)
4. 用 [decision-log-template.md](E:\my-agent\applyflow\skills\method-switch-and-recovery\decision-log-template.md) 记录本轮决策

这样做的目的不是增加流程，而是避免在旧方法已经失效时继续无边界地乱改。
