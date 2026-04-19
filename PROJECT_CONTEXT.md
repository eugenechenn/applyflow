# ApplyFlow 项目上下文

更新时间：2026-04-18

本文档记录当前仓库最重要的真实状态：已经验证了什么、哪些改动已经写入仓库但尚未完成线上验收、系统边界在哪里，以及下一步最合理的推进方向。

## 1. 项目定位

ApplyFlow 是一个半自动求职执行 Agent 系统，核心目标是把“求职信息处理”推进为“求职执行工作台”。

核心闭环：

`Profile -> New Job / URL Import -> Job Ingestion -> Fit Evaluation -> Prep -> 用户确认推进 -> 状态跟踪 -> Feedback / Reflection`

当前项目的重点不是“自动海投”，而是：

- 让岗位输入、岗位判断、申请准备、状态推进和反馈回流在一个系统中闭环
- 用共享状态、状态机、可解释日志与外部服务拆分体现工程能力
- 在 AI 岗位面试中既能讲产品逻辑，也能讲系统设计与部署取舍

## 2. 当前真实架构

### 主系统

- 前端：静态 Web workspace
- API / 编排层：Cloudflare Worker
- 数据：Cloudflare D1
- 身份边界：最小 demo login + session cookie

### 外部服务

- `jd-fetcher`：Railway 上的 Playwright 抓取服务
- `resume-parser`：Railway 上的简历解析服务

### 核心调用链

#### 岗位 URL 导入

用户 -> ApplyFlow Web -> Worker `/api/jobs/import-url` -> Railway `jd-fetcher` -> Playwright -> 结构化草稿 -> Worker -> 前端展示

#### 简历解析

用户 -> ApplyFlow Web 上传 PDF / DOCX -> Worker `/api/resume/upload` -> Railway `resume-parser` -> 解析结果 -> Worker 写入 D1 -> 页面回显

## 3. 当前已经完成的能力

### 基础产品能力

- Dashboard
- Jobs
- Job Detail
- Prep
- Profile
- Governance
- Interviews（基础版）

### Agent / pipeline 能力

- URL Import Agent
- Job Ingestion Agent
- Fit Evaluation Agent
- Application Prep Agent
- Pipeline Manager Agent
- Workflow Controller / Stage Runner

### 数据与工程能力

- 多用户边界（最小版）
- D1 持久化
- repository / facade 数据隔离层
- LLM provider 抽象 + fallback
- Worker / Railway 分层部署

### 简历链路能力

- 原始简历上传
- PDF / DOCX 解析
- 结构化结果写入与展示
- 简历结果可被后续 Prep 使用

## 4. 最近重要事实更新

### 已完成并已验证

- 普通文本型 PDF 已可通过 parser 服务成功解析
- 正常 PDF 可返回：
  - `extractionMethod: pdf-parse`
  - `status: success`
- PDF 上传主链路已打通：前端 -> Worker -> Railway parser -> D1 -> 页面

### 已完成到仓库，待线上重新部署后验收

- Canva / 非标准 PDF 的多阶段解析 pipeline：
  - Stage A：`pdf-parse`
  - Stage B：`pdfjs-dist`
  - Stage C：`fallback_text` + 清洗 + 质量判定
- Worker 持久化层增加了低质量 PDF 兜底净化
- 前端简历展示层增加了对 `fallback_text` 的保守显示策略

### 当前最重要的线上验收点

- 普通 PDF：应正常显示结构化结果
- Canva-like PDF：即使仍失败，也不应再把 `%PDF-1.4`、`xref`、`obj` 等垃圾内容展示给用户

## 5. 当前系统边界

### 已经可用的能力边界

- 文本型 PDF：可用
- DOCX：更稳定，推荐格式
- 基础简历结构化：可用

### 当前仍然存在的能力边界

- 图片型 / 扫描型 PDF：仍可能失败
- Canva-like PDF：鲁棒性仍不稳定，需要继续验收
- 当前没有 OCR

## 6. 当前遗留问题分类

### 体验问题

- 简历解析后的质量反馈还不够直观
- fallback / partial / failed 的用户提示还可以更清晰
- Prep 的结果虽然可用，但还不够像真实“申请材料工作区”

### 能力问题

- 非标准 PDF 解析鲁棒性还不够强
- 简历结构化结果的稳定度仍可继续提升
- Job-specific Tailoring 仍有明显提升空间

### 工程结构问题

- Worker 与 Railway 双服务部署后，线上问题定位需要更清晰的验收清单
- 当前仍缺 OCR fallback
- 当前 pipeline 仍是同步请求式，未升级为异步任务系统

## 7. 当前项目最像什么类型

当前 ApplyFlow 最像：

- 一个可迭代产品原型
- 一个具备真实部署结构的 AI 求职工作台候选版本
- 一个明显高于本地 demo 的面试作品集项目

它还不是：

- 生产级求职 SaaS
- 高鲁棒性的文档处理平台
- 企业级 Agent 平台

## 8. 当前最合理的下一步方向（结论版）

### P0

- 完成线上简历解析链路最终验收
- 把“岗位定制化简历优化”做成真正有产品价值的能力

### P1

- 强化申请准备包（why me / 自我介绍 / 问答 / talking points）
- 提升 Prep 的解释性与导出价值

### P2

- OCR fallback
- 异步任务队列
- 更强的 pipeline trace / observability
- 更完整认证与生产化治理

## 9. 文档维护原则

后续每一轮只要发生以下任一变化，必须先更新本文再继续推进：

- 架构变化
- 部署变化
- 简历解析能力变化
- 线上已验证结论变化
- 下一步优先级变化

## 10. 失败治理与方法切换

从 2026-04-19 起，ApplyFlow 对以下情况不再允许直接继续补丁式改业务代码：

- 同类问题连续 2 轮未解决
- 修复后出现明显回退
- 乱码重新出现
- 新旧页面逻辑混版
- schema 已变更但前端仍按旧字段渲染
- 工作区左 / 右任一核心模块再次为空

此时必须先运行 skill：

- [skills/method-switch-and-recovery/SKILL.md](E:\my-agent\applyflow\skills\method-switch-and-recovery\SKILL.md)

最小执行顺序：

1. 先看 [failure-triggers.md](E:\my-agent\applyflow\skills\method-switch-and-recovery\failure-triggers.md) 判断是否触发
2. 再看 [decision-matrix.md](E:\my-agent\applyflow\skills\method-switch-and-recovery\decision-matrix.md) 判断是继续补丁、修编码、稳 schema，还是直接换方法
3. 再锁定 [validation-gates.md](E:\my-agent\applyflow\skills\method-switch-and-recovery\validation-gates.md)
4. 最后按 [decision-log-template.md](E:\my-agent\applyflow\skills\method-switch-and-recovery\decision-log-template.md) 记录本轮决策

只有完成这一步之后，才允许进入改代码阶段。
