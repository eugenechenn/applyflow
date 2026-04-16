# ApplyFlow 重构迁移说明

日期：2026-04-14

## 仓库现状判断

当前仓库没有发现可执行代码、前端工程或后端服务。现有内容仅包括两份项目笔记：
- `applyflow-project-notes/ApplyFlow_项目重构总结_2026-04-14.md`
- `applyflow-project-notes/ApplyFlow_正式设计_v1_2026-04-14.md`

## 可复用内容

可直接复用为产品和设计输入：
- 项目定位
- 闭环定义
- Agent 角色划分
- 产品边界
- MVP 页面结构

## 旧 Hiring Decision OS 内容判断

当前仓库内未发现旧 `Hiring Decision OS` 的代码实现，因此没有需要直接删除或重命名的历史代码。

但从项目叙事上，需要明确：
- `Hiring Decision OS` 降级为历史参考方向
- 当前主项目统一命名为 `ApplyFlow`
- 所有新文档、代码、API、页面导航均使用 `ApplyFlow`

## 本次迁移动作

本次已完成：
- 新增 `README.md`，统一项目为 ApplyFlow
- 新增 `docs/ApplyFlow_Technical_Design_v1.md`
- 新增 `src/types/applyflow.ts`
- 新增状态机、Orchestrator、mock API、demo 数据、前端页面骨架
- 新增零依赖本地 server，支持 API + 页面 demo

## 后续迁移原则

- 如果后续导入旧 Hiring Decision OS 代码，只保留为参考目录，例如 `legacy/` 或 `references/`
- 不要把旧项目命名、页面、接口直接混入新主路径
- ApplyFlow 的核心对象和状态机应优先于旧 prompt pipeline 结构
