# Phase 10X Evaluation Contract Migration

最后更新：2026-05-01

## 1. 关键节点结论

Phase 10X 的核心目标不是继续调生产排序，而是把评估体系正式迁移到新的用户价值排序合同。

当前 ApplyFlow 排序主合同已经从旧的“标签命中率 / 历史 expected precision”切换为：

```text
用户填写偏好
→ userPriorityScore 五维用户价值分
→ Grade / Verdict
→ 五维雷达图 / Compare
→ Gate / Full Eval
```

Phase 10X 完成后：

- 新 frozen gate：PASS
- full eval：PASS
- acceptance：PASS
- legacy gate：保留为旧标签 reference，不再阻塞新合同
- 生产排序逻辑：本阶段未继续修改

## 2. 背景问题

在 Phase 9X / 9Y 后，生产排序已经完成一次核心收口：

- 新增 `userPriorityScore` 作为唯一用户价值排序源
- 五维固定为：
  - `roleFit`
  - `industryFit`
  - `locationFit`
  - `companyFit`
  - `applicationAccessibilityFit`
- Grade / Verdict / 五维雷达图 / Compare 展示同源
- `opportunityType` 不再主导排序
- bundled、source governance、jobQuality、semantic purity 不再作为主排序惩罚项

但当时仍出现一个关键冲突：

```text
生产排序方向正确
但 frozen gate / full eval 仍使用旧 label precision 合同
```

旧 gate 主要关注：

- 历史 seed 的 label 是否命中
- 旧 expected topN 是否满足
- 旧 role-first precision 假设是否成立

这与新的产品目标不完全一致。新的产品目标是：

```text
用户填写偏好后，岗位必须按五维用户价值排序。
只要单岗或合集符合用户偏好，都可以高排。
低匹配 D/F 不应压过可用 A/B/C。
```

因此，如果继续用旧 label precision 作为 frozen gate，会导致系统被迫回到旧修补方向，反而破坏新排序合同。

## 3. Phase 10X 方针

Phase 10X 的方针是：

1. 不再修改生产排序逻辑
2. 不再调 `roleFit`
3. 不再调 comparator
4. 不再改 Grade 主公式
5. 不再做 bundled penalty patch
6. 只迁移评估合同

硬边界：

- 禁止改 comparator
- 禁止改 `userPriorityScore` 权重
- 禁止改 production ranking
- 禁止改 Grade 主公式
- 禁止让 bundled/source/jobQuality/source governance 回流主排序
- 禁止改 admission / canonical schema
- 禁止 UI 大改

## 4. 新评估合同

新的 frozen gate 不再以旧标签 precision 为唯一主判断，而是检查：

### 4.1 Top5GradeQuality

检查 Top5 的 Grade 质量。

目标：如果候选池中存在 A/B/C，Top5 不应被大量 D/F 占据。

### 4.2 Top10GradeDistribution

检查 Top10 的 Grade 分布。

目标：排序结果应整体呈现用户价值递减，而不是低匹配岗位混在前排。

### 4.3 FalseHighRankRate

检查低价值或低匹配岗位是否错误高排。

目标：低质量混杂、弱角色证据、明显不符偏好的岗位不能虚高。

### 4.4 MixedPostingLeakageRate

检查 low-quality mixed posting 是否泄漏到前排。

注意：Phase 10X 不把所有 bundled 都视为低质量。

区分：

- 高价值方向入口：可以高排，但要解释为“确认子岗位”
- 普通 broad entry：可以保留，但需提示确认职责
- 低质量混杂：不能虚高

### 4.5 UserPriorityOrderingIntegrity

检查 Top 排序是否遵守 `userPriorityScore` 的用户价值顺序。

目标：不能出现 D/F 压过可用 A/B/C 的情况。

### 4.6 RadarGradeConsistency

检查五维雷达图与 Grade 是否一致。

目标：

- 五维图高的岗位不应显示 D/F
- Grade A/B 不应出现五维图大面积内缩

### 4.7 CandidatePoolQualityGapRecognition

当数据池确实缺少高质量候选时，不伪造高分。

目标：系统应识别 `data_pool_quality_gap`，而不是把泛岗包装成推荐。

## 5. 做过的方法

### 5.1 新增新 gate 主路径

在 `scripts/eval-job-preference-ranking.js` 中，将：

```text
npm run eval:job-preference-ranking:gate
```

迁移为新的 userPriorityScore gate。

新 gate 选择：

```text
acceptanceGateTier = acceptance_gate
```

作为 frozen gate core。

### 5.2 保留旧 gate 作为 reference

新增脚本：

```text
npm run eval:job-preference-ranking:legacy-gate
```

旧 gate 仍使用：

```text
coreSet = core22 OR evalTier = gate
```

它只作为历史标签 precision reference，不再阻塞新排序合同。

### 5.3 full eval 改为新合同 PASS/FAIL

full eval 保留以下输出：

- legacy label precision
- diagnostic cases
- opportunityType diagnostics
- source governance diagnostics
- historical hard failed cases

但主 PASS/FAIL 改为新 userPriorityScore gate。

旧 hard failed cases 仍展示，但标注为：

```text
Legacy Label Hard Failed Cases（旧标签口径，仅参考）
```

### 5.4 Seed / Fixture 治理

在 `docs/eval/jobs-preference-eval.seed.json` 中新增/同步：

- `baselineStrategy`
- `evaluationContractMigration`
- `evalTaxonomy`

明确分类：

- `frozen_gate_core`
- `acceptance_gate`
- `diagnostic_only`
- `adversarial_only`
- `legacy_reference`

### 5.5 文档同步

已同步：

- `CONTEXT.md`
- `TIMELINE.md`

本文件作为 Phase 10X 的交接与复盘文档。

## 6. 当前验证状态

已执行并通过：

```text
npm run validate:job-preference-eval-seed
npm run eval:job-preference-ranking:gate
npm run eval:job-preference-ranking:acceptance
npm run eval:job-preference-ranking -- --compact-output
npm run lint
npm run build
npm run validate:ui-user-flow-smoke
npm run validate:jobs-apply-ui
```

legacy gate 也已验证可运行：

```text
npm run eval:job-preference-ranking:legacy-gate
```

说明：legacy gate 旧标签口径仍可能显示 FAIL，这是预期结果。它不再代表新排序失败。

## 7. 指标快照

新 frozen gate 当前状态：PASS

关键指标：

```text
falseHighRankRate = 0.0%
mixedPostingLeakageRate = 0.0%
userPriorityOrderingIntegrity = 100.0%
radarGradeConsistency = 100.0%
```

Acceptance 当前状态：PASS

```text
acceptancePassRate = 100.0%
falseHighRankRate = 0.0%
mixedPostingLeakageRate = 0.0%
```

残余观察指标：

```text
trueSinglePriorityRate 仍需结合数据池质量观察
poolVsSingleDisplacementRate 仍需后续观察
```

这些不是 Phase 10X blocker。

## 8. 当前系统状态

### 8.1 已完成

- 排序合同从旧 label precision 转向 userPriorityScore
- Grade / Verdict / 雷达图 / Compare 与排序同源
- Gate / Full Eval 与新排序合同对齐
- Legacy gate 保留 reference
- Acceptance gate 保持 PASS
- UI smoke / jobs apply UI 保持 PASS

### 8.2 未继续做的事

Phase 10X 没有继续做：

- 调 comparator
- 调 `roleFit`
- 调权重
- 调 Grade
- 重新引入 bundled penalty
- 改 source governance 排序权重
- 改 admission
- 改 canonical schema
- UI 大改

这是有意为之，避免重新走回 patch 膨胀路线。

## 9. 为什么这是关键节点

Phase 10X 解决的是“评估体系与产品合同不一致”的问题。

之前的问题不是单纯某个岗位排序错，而是：

```text
生产排序想做用户价值排序
评估体系却仍用旧标签命中率约束它
```

这会导致两种错误：

1. 明明用户价值排序更合理，却被旧 expected 判失败
2. 为了让旧 gate PASS，又反向修改生产排序，导致用户体验变差

Phase 10X 后，评估体系终于和产品目标一致：

```text
用户偏好 → 五维价值 → 排序 → Grade → 雷达图 → Gate
```

## 10. 后续方向

下一阶段不建议继续围绕旧 label precision 调排序。

建议进入：

```text
UI Execution Workflow Reliability
```

重点处理独立 UI 执行链路问题：

- Dashboard loading
- Jobs trackerFilter 假空
- Playwright skills input 可见性
- Jobs 页面空态与错误态
- 线上主流程稳定性

同时保留两个长期任务：

1. 数据池质量治理
   - 补充高质量单岗数据分析 / BI / 算法 / 产品岗位
   - 不把 curated 数据直接混入 production

2. 旧 diagnostic expected 重标
   - 对旧 label precision 不再反向驱动 production ranking
   - 必要时作为 reference 逐步重标

## 11. 维护边界

后续任何排序相关改动必须遵守：

```text
userPriorityScore 是主排序合同
Grade / Verdict / Radar / Compare 必须同源
opportunityType 只做解释和治理
source governance 只做诊断和治理
jobQuality 不直接回流主排序
bundled 不天然降权
```

如果未来要改主排序，必须同时更新：

- scoring contract
- comparator contract
- Grade contract
- radar mapping contract
- gate contract
- acceptance contract

不能再只改其中一层。
