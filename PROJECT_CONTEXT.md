# ApplyFlow 项目上下文

更新时间：2026-04-24

本文件是 ApplyFlow partial_rebuild 的上下文基线。后续所有开发、评审和验收都应以本文件与重构计划文档为准。

## 1. 项目新定位

ApplyFlow 是一个“先筛后投”的半自动求职执行系统。

核心目标：
- 提高求职筛选效率
- 提升投递判断质量
- 提供可解释的岗位决策
- 在人工确认下执行申请动作

ApplyFlow 不是：
- 默认全自动海投系统
- 单点简历润色工具
- 为炫技而设计的多 Agent 演示壳

## 2. 现阶段判断

当前项目已经具备基础设施，但业务主链路与旧目标混杂，属于“架构可用但产品语义不收敛”的状态。

结论：
- 选择 `partial_rebuild`
- 保留基础设施
- 重建核心业务链路与数据契约

## 3. 必须保留的基础设施

- GitHub 仓库与分支治理（branch protection / CODEOWNERS）
- CI 与 validate 门禁
- skills / guardrails 体系
- Cloudflare Worker + D1 部署链路
- Railway 外部服务连接（如 jd-fetcher / resume-parser）

## 4. 新主链路（产品）

1. 求职意图输入
- 岗位关键词
- 城市偏好
- 校招 / 社招
- 可选：薪资 / 行业

2. 批量岗位获取与导入
- 全网搜集岗位链接
- 用户批量导入 URL

3. 岗位标准化与优先级排序
- 去重
- 结构化
- 评分
- 可解释排序

4. 岗位详情解释
- 匹配度
- 关键要求
- 主要短板
- 风险点
- 下一步建议

5. 简历与材料系统
- PDF 导入
- 结构化与清洗
- 岗位定制材料生成
- 导出

6. 申请执行
- 进入目标网页
- 预填 / dry-run
- 人工确认提交

## 5. 新边界（必做 / 可选 / 暂不做）

### 必做
- 批量岗位导入、去重、评分、优先级解释
- 岗位详情解释页
- master resume -> tailored resume 链路
- 申请执行页（预填 / dry-run / 确认）

### 可选
- 批量任务调度与重试
- 平台规则扩展
- 追踪分析增强

### 暂不做
- 默认全自动海投
- 重型 RAG 架构
- 企业级权限系统
- 大型可视化编辑器

## 6. 架构收敛原则

1. SSOT
- 只有 canonical contracts 可作为业务输入
- UI 只消费 workspace view-model

2. 分层隔离
- parser
- structuring/schema
- workspace/view-model
- render/UI

3. 污染隔离
- fallback 文案不进入用户核心内容字段
- raw text 不直接驱动 UI

4. 旧路径清理
- 不长期并存
- 迁移完成后明确删除

5. Agent 三层闭环
- Decision：输出 recommendation/evidence/gaps/risks/nextAction（必须可解释）
- Control：输出 allow/blocked/needs_human_review（必须可控）
- Feedback：记录 outcome/override/failure trace 并用于下一轮优化（必须可学习）

## 7. 当前阶段定义

### 2026-04-24 当前实际状态

ApplyFlow 已进入最小可用闭环收口与 recovery 阶段。

已完成：
- 前台主入口已收敛为求职工作台、岗位列表、个人资料。
- `offline_json` 已作为真实 Feishu 岗位来源接入，并通过 Worker 静态资产读取 `public/data/standardized_feishu_records.json`。
- fallback 假岗位已隔离，不应进入正式 `/api/jobs`。
- `import-offline-json` 已不再依赖内存 intent；旧 intent 丢失时会自动重建。
- `#/jobs` 已能展示真实岗位。

当前待完成：
- 岗位列表缺少用户偏好相关排序、分数与解释。
- 下一步只做 deterministic scoring view model 骨架，不接 LLM，不改 canonical/admission/offline_json 主链。

当前工程原则：
- scoring 只能作为 derived view 返回给 `/api/jobs` 和 UI。
- 不允许把 score 写回 canonical job 主字段。
- 不允许用 fallback 假岗位补数据。
- 不允许在本轮改插件、parser、ranking 主策略或 discovery 主链。

### Phase 0（当前）
- 文档重写
- 重构边界冻结
- 删除计划建立

### Phase 1（下一阶段）
- canonical contracts + workspace model 收敛
- 旧路径下线

### Phase 2
- 岗位主链路（批量导入/评分/详情）重建

### Phase 3
- 申请执行（预填/dry-run/确认）上线

## 8. 执行规则

- 每轮先 decision 再改代码
- 一轮只改一个主层级
- 同类问题两轮失败必须触发 method-switch-and-recovery
- 所有改动必须通过 validate 门禁

## 9. 参考项目吸收原则

- 学主链路，不抄表面功能
- 学可解释决策，不堆无意义自动化
- 学可控执行，不追求脆弱全自动

参考对象：
- career-ops
- ApplyPilot
- claude-code-job-tailor
- Job-Application-Automator

## 10. 本文件用途

本文件用于：
- 作为后续重构评审基线
- 判断需求是否偏离新定位
- 防止旧目标继续污染后续开发
