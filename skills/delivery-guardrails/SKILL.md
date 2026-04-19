# delivery-guardrails

## 目的
在进入任何代码修改前，先锁定修改边界、删除计划、验证门与回滚方案，防止多轮补丁污染主链路。

## 何时必须使用
- 触及以下高风险文件之一时：
  - `src/lib/orchestrator/workflow-controller.js`
  - `src/lib/resume/resume-structuring-audit.js`
  - `src/lib/workspace/tailoring-workspace-model.js`
  - `public/app.js`
- 同类问题连续 2 轮仍未解决时
- 准备做结构切换、schema 替换、渲染链路替换时
- 涉及“旧路径下线 + 新路径接管”的并行变更时

## ApplyFlow 仓库默认规则
在这个仓库里，上述场景默认视为自动触发，不需要用户每轮显式提到 `$delivery-guardrails`。
也就是说，只要是高风险代码修改，Codex 必须先执行本 skill，再进入编码阶段。

## Codex 行为约束
1. 一轮只能改一个主层级：
   - `parser`
   - `structuring/schema`
   - `workspace/view-model`
   - `render/UI`
2. 修改前必须列出：
   - 旧路径清单
   - 目标路径清单
   - 删除计划
3. 修改后必须列出：
   - 实际删除了哪些旧逻辑
   - 哪些文件未动
   - 验收门
4. 如果同类问题连续 2 轮失败：
   - 禁止继续补丁
   - 必须先触发 `method-switch-and-recovery`
5. 如果属于大改：
   - 必须采用 Branch by Abstraction / Parallel Change
   - 不允许直接在主路径里叠新旧逻辑

## 输入
- 当前唯一目标
- 允许修改的文件列表
- 旧路径/新路径清单
- 预期验收门

## 输出
- 受控修改计划
- 删除计划
- 验证计划
- 回滚说明

## 执行步骤
1. 先读：
   - [change-boundary-checklist.md](./change-boundary-checklist.md)
   - [file-hygiene-rules.md](./file-hygiene-rules.md)
   - [validation-policy.md](./validation-policy.md)
2. 判断本轮是否需要：
   - 小改动
   - Parallel Change
   - 先 recovery 再编码
3. 写出：
   - 本轮唯一目标
   - 允许修改的文件
   - 明确删除的旧路径
4. 编码后必须运行：
   - `npm run lint`
   - `npm run build`
   - `npm run validate:schema`
   - `npm run validate:contamination`
   - `npm run validate:fixtures`
5. 未通过任何一项时，禁止宣称完成
