# Internal Beta Dirty Diff Triage

## 发现信息
- 发现时间：2026-05-12
- 发现阶段：Beta Batch 5A staging 前置检查

## 被隔离文件
- `scripts/validation/validate-phase10a-workflow-playwright.js`
- `src/lib/jobs/job-preference-profile.js`
- `src/lib/jobs/job-scoring-view-model.js`

## 风险等级
- `src/lib/jobs/job-scoring-view-model.js`：High
- `src/lib/jobs/job-preference-profile.js`：High
- `scripts/validation/validate-phase10a-workflow-playwright.js`：Medium

## 为什么不能混入 beta staging smoke
- 以上改动不属于 `0508321`（Batch 4 Auth/Beta Gate 提交）。
- `job-scoring-view-model.js` 与 `job-preference-profile.js` 属于排序/偏好核心链路，可能影响 Grade/Verdict 与画像归一化行为。
- 若与 Batch 5 staging smoke 混跑，会污染“仅验证 Internal Beta Gate”的结论归因。

## Patch 归档
- `tmp/dirty-diff-triage/20260509-pre-staging-ranking-profile-phase10a-dirty.patch`

## 后续处理建议
1. 单独开 ranking/profile 专项 review。
2. 明确保留或丢弃这组改动。
3. 若保留，必须单独跑：sorting/acceptance/gate/real-pool-role-matrix。

## 当前决定
- 先隔离 patch，恢复工作区到 `HEAD` 的 Batch 4 语义，再继续 beta staging smoke。
