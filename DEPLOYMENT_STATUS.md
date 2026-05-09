# ApplyFlow 部署状态（partial_rebuild）

更新时间：2026-04-20

本文档只记录 partial_rebuild 期间的部署基线与约束，不再描述旧产品目标。

## 1. 当前保留的部署基础设施

- Cloudflare Worker（主 API 与前端资产）
- Cloudflare D1（核心数据存储）
- Railway 外部服务（按需保留）
  - jd-fetcher（可选）
  - resume-parser（可选）

## 2. partial_rebuild 阶段策略

当前阶段不是扩功能上线，而是“受控迁移”：
- 先冻结边界
- 再重建核心链路
- 最后切流并删除旧路径

部署目标从“多功能并行可见”切换为“主链路稳定可回归”。

## 3. 环境职责

### Cloudflare
- 主系统入口
- 认证/session
- canonical API 返回
- workspace view-model 输出

### Railway（如继续保留）
- 重型解析任务（PDF/DOCX、抓取）
- 与 Worker 通过明确契约交互

## 4. 部署门禁

任何进入 deploy 的改动必须满足：
1. 通过 CI required check（`validate`）
2. 不引入新旧路径长期并存
3. 不让 fallback 文案进入用户核心字段
4. 能在 fixture 与真实样本上验证主链路

## 5. 迁移期风险控制

- 不允许“边上线边补丁”式改核心模型
- 每次只迁移一个主层级
- 高风险文件改动必须有回滚点
- 出现连续回退时先触发 method-switch-and-recovery

## 6. 当前阶段可验收项

Phase 0 验收：
- 文档基线已切换到新产品定义
- 重构范围、删除计划、阶段门禁明确

Phase 1+ 验收（后续）：
- canonical contracts 生效
- workspace 仅消费 canonical 数据
- UI 不再读取脏字段

## 7. 参考文档

- [docs/APPLYFLOW_REBUILD_PLAN.md](E:\my-agent\applyflow\docs\APPLYFLOW_REBUILD_PLAN.md)
- [docs/APPLYFLOW_ARCHITECTURE.md](E:\my-agent\applyflow\docs\APPLYFLOW_ARCHITECTURE.md)
- [docs/DEPRECATION_AND_REMOVAL_PLAN.md](E:\my-agent\applyflow\docs\DEPRECATION_AND_REMOVAL_PLAN.md)
- [docs/ENGINEERING_GUARDRAILS.md](E:\my-agent\applyflow\docs\ENGINEERING_GUARDRAILS.md)
