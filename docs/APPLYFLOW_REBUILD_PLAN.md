# ApplyFlow Partial Rebuild Plan

更新时间：2026-04-20
状态：Phase 0

## 1. 为什么旧 ApplyFlow 不继续修

旧系统不适合继续 patch 的结构性原因：
1. parser / schema / workspace / UI 边界长期穿透，修一层会回退另一层。
2. 新旧路径并存过久，导致同一数据存在多种来源与组装方式。
3. fallback 与业务内容混杂，用户可见内容容易被污染。
4. 历史数据兼容策略散落，缺少单点 adapter，回归风险高。
5. 产品目标漂移（求职工作台 vs 调试面板）导致需求优先级混乱。
6. 真实验收与 CI 验收存在裂缝（“能跑”但“不好用”）。

## 2. 重构决策

决策：`partial_rebuild`

原因：
- 基础设施可复用（CI、deploy、guardrails）
- 核心业务链路需要重建（而非微调）
- full_rebuild 成本高且会丢失已有工程资产

## 3. 范围定义

### 保留
- GitHub 仓库与工程护栏
- CI / validate / CODEOWNERS / branch protection
- Cloudflare / D1 部署骨架
- Railway 外部服务连接（如需）
- Skills 与治理机制

### 删除（逐步）
- 旧版 workspace 组装路径
- UI 直接消费 raw/脏字段路径
- 旧 fallback 文案进入业务字段路径
- 历史 helper 并行路径（长期并存禁止）

### 重写
- canonical contracts
- legacy adapter
- workspace view-model
- Job pipeline（批量导入/评分/优先级）

## 4. 分阶段计划

### Phase 0（本轮）
目标：文档收敛、边界冻结、删除计划建立
输出：
- README / PROJECT_CONTEXT 重写
- 架构文档
- 删除清单
- 本计划文档

验收：
- 旧目标已被新目标替换
- 重构范围明确
- 每阶段门禁明确

### Phase 1
目标：数据契约收敛（SSOT）
工作：
- 新建 canonical contracts
- 新建 legacy adapter（单点）
- workspace 只消费 canonical
- 新建 Agent 三层 contract（Decision / Control / Feedback）
- 加强 validation（schema + contamination + legacy fixture）

验收：
- UI 不再读 raw text
- fallback 不进核心字段
- legacy 数据可被受控转换
- 决策层输出 recommendation/evidence/gaps/risks/nextAction（可解释）
- 控制层可输出 blocked / needs_human_review（可控）
- 反馈层可记录 override / fail / outcome trace（可优化）

### Phase 2
目标：岗位主链路重建
工作：
- 求职意图输入
- 批量岗位导入与标准化
- 去重、评分、优先级排序
- 岗位详情解释页

验收：
- 列表与详情能稳定解释“为什么投/不投”

### Phase 3
目标：简历与申请执行闭环
工作：
- MasterResume -> TailoredResume
- PDF 导出
- 申请执行页（预填/dry-run/人工确认）

验收：
- 从岗位筛选到申请执行形成可演示闭环

## 5. 每阶段验收标准（统一）

1. validate 全部通过
2. 本阶段范围外文件不被污染
3. 无新旧路径长期并存
4. 用户可见内容无 fallback 污染

## 6. 风险与回滚

### 主要风险
- 迁移期新旧数据混用导致空模块
- 历史字段兼容断裂
- 部署依赖误引导致 Worker 打包失败

### 回滚策略
- 每阶段独立可回滚
- 高风险文件改动必须附带删除计划与回滚点
- 触发连续失败时，先运行 method-switch-and-recovery，再继续开发

## 7. 本计划的执行约束

- 一轮只改一个主层级
- 先 decision 再改代码
- 不允许“边想边重构”
- 不允许 UI 遮丑式修复替代数据层收敛
