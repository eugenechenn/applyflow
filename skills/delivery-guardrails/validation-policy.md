# Validation Policy

## 必过检查
1. `npm run lint`
   目标：发现重复定义、旧 helper 泄漏、受保护文件污染。

2. `npm run typecheck`
   当前仓库是 JavaScript 项目，脚本会明确输出“暂未启用 TypeScript”，作为占位检查。

3. `npm run build`
   目标：关键入口文件可解析、可加载。

4. `npm run validate:schema`
   目标：workspace canonical schema 满足结构要求。

5. `npm run validate:contamination`
   目标：个人信息 / 教育信息 / fallback 文案不能污染工作经历、项目经历、自我评价。

6. `npm run validate:fixtures`
   目标：至少 3 份不同格式简历样本都能产出合法结构。

## Schema 最低要求
- `workExperience[] = { company, role, timeRange, bullets[] }`
- `projectExperience[] = { projectName, role, timeRange, bullets[] }`
- `selfSummary` 不能包含邮箱 / 手机 / 学校 / fallback 文案

## 失败即阻断
任何一项失败：
- 本轮不能宣称完成
- 不能继续扩散到别的层级

