---
name: resume-structuring-audit
description: Use this skill when ApplyFlow needs to audit or correct resume section mapping after PDF or DOCX parsing, especially when work experience, project experience, education, self-summary, or personal info are mixed together. This skill is for section remapping, fallback heuristics, and bad-case checking for inconsistent resume layouts.
---

# Resume Structuring Audit

用于把上传后的简历内容稳定映射到 ApplyFlow 的 5 个核心板块：

- 个人信息
- 工作经历
- 项目经历
- 自我评价
- 教育背景

当出现以下情况时必须使用这个 skill：

- 工作经历 / 项目经历 / 教育背景错位
- 自我评价混入工作经历
- 联系方式混入摘要
- PDF 解析后只有松散文本，需要重新分板块
- 同一份简历没有完整标题，需要启发式映射

## 输入

- `rawText`
- `cleanedText`
- `structuredProfile`
- 可选：`parseStatus`、`parseQuality`

## 输出

- 纠偏后的 section mapping
- 明确的空板块保留策略
- 对 bad case 的解释：为什么该内容不能进入某个板块

## 执行步骤

1. 先检查是否存在明确 section 标题。
2. 若存在标题，优先按标题切段。
3. 若标题不完整，再按优先级做启发式映射：
   - 个人信息
   - 教育背景
   - 项目经历
   - 工作经历
   - 技能
   - 自我评价
4. 对每个板块执行“禁止事项”检查：
   - 技能区不能出现整段经历句子
   - 个人信息不能混入项目或教育
   - 项目经历不能因为有年份就误判为工作经历
5. 如果某板块缺失，保留为空，不允许编造。

## 何时读取补充文件

- 规则细节与优先级：读取 [rules.md](./rules.md)
- 典型 good / bad case：读取 [examples.md](./examples.md)

