# ApplyFlow 工程交付护栏

## 目标
把仓库从“多轮补丁容易污染主链路”的状态，收敛成“单目标改动 + 必过验证 + 明确回滚”的开发环境。

## 适用范围
以下高风险文件必须套用护栏：
- `src/lib/orchestrator/workflow-controller.js`
- `src/lib/resume/resume-structuring-audit.js`
- `src/lib/workspace/tailoring-workspace-model.js`
- `public/app.js`

## 默认执行规则
在 ApplyFlow 仓库中，只要任务涉及以下任一情况，就默认先执行 `delivery-guardrails`，不需要用户每轮重复点名：
- 修改高风险文件
- 调整主链路、schema、workspace、渲染逻辑
- 做“删旧路径 + 接新路径”的结构性修改
- 同类问题连续失败后再次进入修复

默认前置输出必须包含：
1. 本轮唯一目标
2. 允许修改的文件
3. 禁止修改的文件
4. 旧路径清单
5. 删除计划
6. 验收门

## 当前仓库的 5 条硬规则
1. 一轮只改一个主层级：parser / schema / workspace / UI 四选一。
2. 修改前必须列旧路径、目标路径和删除计划。
3. 不允许新旧逻辑并存后无限拖延删除。
4. fallback / 调试文案不得进入用户内容。
5. 所有高风险改动必须通过自动验证脚本后才可交付。

## 最小自动验证
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run validate:schema`
- `npm run validate:contamination`
- `npm run validate:fixtures`

## Branch by Abstraction / Parallel Change
适用场景：
- 替换 workspace schema
- 替换 rendering path
- 替换 parser 输出结构

执行方式：
1. 新建中间抽象层
2. 只让一个主入口接管
3. 验证通过后删除旧路径
4. 删除完成再合并

## GitHub 配置建议
- 主干分支开启保护
- Required checks 绑定：
  - lint
  - build
  - validate:schema
  - validate:contamination
  - validate:fixtures
- 高风险文件启用 CODEOWNERS 审核
