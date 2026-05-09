# ApplyFlow 分支与提交（简明版）

## 你当前遇到的问题（结论）
- 当前不是“少量改动”，而是“超大混合改动”：代码、文档、数据库、缓存、嵌套污染目录同时存在。
- 不能把全部未提交内容一次性提交，否则以后很难回滚、很难定位问题。
- 上次误删造成损失的核心原因：有价值改动长期停留在“未提交状态”。

---

## 先记住三句话
1. **有价值改动必须尽快 commit**（最晚当天）。
2. **一个 commit 只做一件事**（功能、修复、文档分开）。
3. **不要在脏工作区继续叠加新需求**，先收口再开发。

---

## 分支到底是什么（白话）
- `main`：稳定主线，像“正式档案”。
- `feature 分支`：你正在做某个任务的工作台。
- 你现在有多个分支，是因为多次恢复/实验留下的“多个工作台”。

分支不是坏事，**坏的是分支目的不清 + 长期不提交**。

---

## 你现在应该怎么做（安全顺序）

### 第 1 步：先做“保护快照提交”
目的：先把当前状态封存，防止再次误操作丢失。

```powershell
git checkout codex/recovery-20260508-restore-snapshot
git add -A
git commit -m "chore: safety snapshot before cleanup triage"
```

### 第 2 步：按主题拆分后续提交
不要再 `git add -A`。按文件分批提交：

- 排序链路一批
- UI 展示一批
- 验证脚本一批
- 文档一批

示例：
```powershell
git add src/lib/jobs/job-scoring-view-model.js src/lib/jobs/job-preference-classifier.js scripts/eval-job-preference-ranking.js
git commit -m "fix(ranking): restore PM bundle role-fit behavior"
```

### 第 3 步：清理临时/污染目录（确认后再做）
例如 `src/src`、`scripts/scripts`、`public/public`、`docs/docs`、`data/data`、`cloudflare/cloudflare`。  
这些目录先人工核对是否有独有文件，再删除重复垃圾。

---

## 以后怎么避免“没提交就丢失”

每次会话结束前固定执行：

```powershell
git status --short
git add <本轮文件>
git commit -m "<本轮明确目的>"
git log --oneline -5
```

规则：
- 最长不超过半天不提交。
- 大改动至少拆成 2~4 个 commit。
- 数据库/缓存文件默认不提交（除非你明确要提交数据资产）。

---

## “主线程协调 + 子线程执行”是什么意思

白话：
- **主线程**：你和我当前这个对话，负责定目标、定边界、验收。
- **子线程**：并行执行某个小任务（例如只跑某一套验证、只做某个模块 review）。

正确用法：
1. 主线程先拆任务（每个任务范围清楚）。
2. 子线程只做“单一职责任务”。
3. 结果回主线程统一验收与提交。

不要让多个子线程同时改同一批文件，否则冲突会很重。

---

## 当前分支建议（按你现在仓库）
- `main`：保持不动，只接收已验证变更。
- `codex/recovery-20260508-restore-snapshot`：作为“恢复现场分支”，先做保护提交。
- `codex-pm-sorting-fix`：只保留 PM 排序相关目的，若已偏离，后续可关闭或重建。

---

## 文档收敛建议
项目里文档很多，建议只保留三层：

1. **现场层**：`CONTEXT.md`（只写当前目标/进度/下一步）
2. **时间层**：`TIMELINE.md`（每次变更一行）
3. **决策层**：`DECISIONS.md`（为什么这样做）

其他专题文档归档到 `docs/`，避免主目录继续膨胀。

---

## 最小工作习惯（你只要执行这 5 条）
1. 开工先看 `CONTEXT.md`。
2. 一次只做一个目标。
3. 完成目标立即 commit。
4. 当天更新 `TIMELINE.md` 一行。
5. 任何删除/清理前先做保护提交。

