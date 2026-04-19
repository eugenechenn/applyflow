# Examples

## Bad Case 1：多轮补丁污染 controller
- 现象：`workflow-controller.js` 同时存在 3 套 `buildTailoringWorkspace`
- 结果：旧路径和新路径并存，页面混版、回退
- 为什么坏：违反“禁止重复函数定义”“禁止旧新路径并存”

## Bad Case 2：schema 变了，UI 还在读旧字段
- 现象：workspace 已切到 canonical schema，但 `public/app.js` 还在读 `rewrittenBullets`
- 结果：右侧定制版仍然建立在脏数据上
- 为什么坏：违反“UI 不能直接消费旧脏字段”

## Good Case 1：单目标 schema 收口
- 目标：只修 `workExperience/projectExperience` 实体建模
- 允许文件：`resume-structuring-audit.js`、`tailoring-workspace-model.js`
- 不动：`app.js`、样式、部署
- 验收：3 个 fixtures 均通过 schema 与 contamination check

## Good Case 2：Parallel Change 替换工作区渲染
- 第一步：新增 workspace view-model
- 第二步：UI 切到新 model
- 第三步：删除旧 render helper
- 验收：`grep` 不再出现旧 helper 引用

