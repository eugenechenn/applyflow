# Production-like 1000 样本评估输出规范

最后更新：2026-06-02

## 1. 评估目的

本轮评估用于面试和作品集证据链，不用于宣称大规模线上增长。

目标是验证 ApplyFlow 在真实 5000+ 岗位池上的岗位判断能力和坏例分布：

- Top1 / Top10 是否命中岗位方向
- Top1 / Top10 是否命中城市
- Top1 / Top10 是否命中行业
- Top10 中 A/B 等级岗位的覆盖量和命中质量
- 是否存在明显 bad case
- bad case 主要集中在哪类原因

## 2. 当前评估口径

- 入口：本地服务 `http://127.0.0.1:3000`
- 临时公网入口：`https://futures-democrat-automatic-pest.trycloudflare.com`
- 数据库：`data/applyflow-temp-public.sqlite`
- 数据池：`jobs = 5654`，其中 `user_a = 5613` 条真实岗位
- 评估账号：`alex@example.com` / `user_a`
- 样本规模：20 个岗位方向 × 5 个城市 × 10 个行业 = 1000 个组合
- 每个样本拉取：Top10
- 附加等级评估：统计 Top10 内 A/B 等级岗位数量、Top1 是否为 A/B、A/B 岗位是否命中岗位方向/城市/行业

说明：

- `eugenec7012@126.com` 在当前本地临时库里只有 1 条隔离测试岗位，不用于本轮本地真实池评估。
- 本轮是 production-like 本地真实池副本评估，不等同于正式域名 + 线上 D1 的最终 production 结果。

## 3. 当前完成状态

- 输出目录：`tmp/production-eval-1000-temp-local-user-a-full`
- 完整 1000 样本已完成：`completedCases=1000`，`errorCases=0`，`remainingCases=0`。
- `noTenCount=0`，说明每个组合都能返回 Top10，不是账号或岗位池断链。
- A/B 等级汇总已按完整 1000 条生成。

关键结果：

| 指标 | 结果 |
|---|---:|
| Top1 岗位方向命中率 | 88.8% |
| Top10 岗位方向命中率 | 92.4% |
| Top1 城市命中率 | 2.0% |
| Top10 城市命中率 | 4.6% |
| Top1 行业命中率 | 49.0% |
| Top10 行业命中率 | 70.5% |
| Top1 为 A/B 等级 | 90.0% |
| Top10 平均 A/B 岗位数 | 8.25 |
| A/B 岗位方向命中率（有 A/B 的组合内） | 100.0% |
| A/B 岗位城市命中率（有 A/B 的组合内） | 1.8% |

## 4. 必需输出文件

| 文件 | 用途 |
|---|---|
| `results.ndjson` | 每个样本的 Top10、命中判断和 bad case 原因 |
| `errors.ndjson` | 超时、接口失败、脚本异常等错误样本 |
| `production-eval-1000-summary.json` | 面试和作品集最重要的总览指标 |
| `production-eval-1000-report.json` | summary + 全量 results + errors |
| `production-eval-1000-cases.csv` | 可粘贴到表格/作品集的样本明细 |
| `production-eval-1000-grade-summary.json` | A/B 等级岗位覆盖和命中质量总览 |
| `production-eval-1000-grade-report.json` | A/B 等级判断 + 全量结果明细 |
| `production-eval-1000-grade-cases.csv` | 每个组合的 A/B 等级表现明细 |

## 5. Summary 必看指标

| 指标 | 含义 |
|---|---|
| `plannedCases` | 计划样本数，目标为 1000 |
| `completedCases` | 成功完成样本数 |
| `errorCases` | 错误样本数 |
| `top1RoleHitRate` | Top1 岗位方向命中率 |
| `top1CityHitRate` | Top1 城市命中率 |
| `top1IndustryHitRate` | Top1 行业命中率 |
| `top1RelatedRate` | Top1 综合相关率 |
| `top5HasRelatedRate` | Top5 是否至少有一个相关岗位 |
| `top10HasRoleHitRate` | Top10 是否至少命中岗位方向 |
| `top10HasCityHitRate` | Top10 是否至少命中城市 |
| `top10HasIndustryHitRate` | Top10 是否至少命中行业 |
| `badCaseRate` | bad case 占比 |
| `badReasonCounts` | bad case 原因分布 |

## 6. A/B 等级附加指标

本轮新增 A/B 等级评估，用来回答一个更贴近面试官的问题：系统不只是 Top10 里有没有相关岗位，还要看高优先级候选池质量如何。

| 指标 | 含义 |
|---|---|
| `top1GradeABRate` | Top1 是否为 A/B 等级 |
| `casesWithGradeABRate` | Top10 中是否至少有一个 A/B 等级岗位 |
| `avgGradeABCountPerTop10` | 每个 Top10 平均包含多少个 A/B 岗位 |
| `gradeABHasRoleHitRateAllCases` | A/B 岗位是否命中岗位方向 |
| `gradeABHasCityHitRateAllCases` | A/B 岗位是否命中城市 |
| `gradeABHasIndustryHitRateAllCases` | A/B 岗位是否命中行业 |
| `gradeABHasRelatedRateAllCases` | A/B 岗位是否综合相关 |
| `gradeABBadReasonCounts` | A/B 岗位质量 bad case 原因分布 |

解读方式：

- 如果 `top1GradeABRate` 和 `casesWithGradeABRate` 高，说明排序前排和候选池优先级输出稳定。
- 如果 `gradeABHasRoleHitRateAllCases` 高，说明 A/B 等级主要不是乱给，而是确实围绕岗位方向。
- 如果 `gradeABHasCityHitRateAllCases` 低，说明不是“模型完全没用”，而是地点字段、城市标准化或地点权重存在优化空间。
- 如果 A/B 多但行业命中低，说明行业 taxonomy 或 inferredIndustry 需要治理。

## 7. 面试输出模板

评估完成后，面试里不要只报一堆数字，要按这个结构讲：

```text
我没有只展示 demo，而是做了 production-like 覆盖评估。
这轮用的是 5000+ 真实岗位池的本地副本，构造 20 个岗位方向 × 5 城市 × 10 行业 = 1000 个组合，每个组合拉 Top10。
结果 1000/1000 完成，0 个错误，没有 Top10 不足。岗位方向表现较好，Top1 命中 88.8%，Top10 命中 92.4%；Top1 为 A/B 的比例是 90.0%，Top10 平均有 8.25 个 A/B 岗位。
但最大 bad case 是城市：Top10 城市命中只有 4.6%，A/B 岗位城市命中只有 1.8%。所以我下一轮不是简单调权重，而是治理 location 数据标准化、城市硬/软偏好、A/B 降级和地点确认 nextAction。
这轮结果不是大规模线上增长，而是为了证明我能把 Agent 输出从“看起来合理”变成可量化、可复盘、可继续迭代的 Evidence Log。
```

## 8. 结果解读规则

- 如果岗位方向命中高、城市命中低：优先归因为岗位池 location 缺失或城市字段标准化不足。
- 如果 Top10 命中高但 Top1 命中低：说明召回有相关岗位，但排序前排权重需要优化。
- 如果行业命中低：检查行业 taxonomy、岗位多方向入口、泛岗位标题和 inferredIndustry。
- 如果 A/B 岗位覆盖高但城市命中低：说明等级优先级本身有输出，但地点约束没有被充分体现在高等级候选池里。
- 如果 `Top10不足10条` 增多：优先检查账号是否接到真实池、筛选条件是否过窄、接口是否分页/limit 异常。
- 如果错误样本多：优先查超时、接口 400/401/403、隧道不稳定和服务端日志。

## 9. 当前已知风险

- Quick Tunnel 只作为临时可访问入口，不适合作为正式作品集入口。
- 完整评估建议走本地 URL，公网隧道用于 smoke 和临时展示，因为公网隧道会增加排序请求耗时。
- 本轮使用 `alex@example.com` / `user_a`，后续正式域名和线上 D1 恢复后，应再跑一轮正式 production 账号评估。

## 10. 完成后的回写清单

- 已更新 `docs/portfolio/APPLYFLOW_INTERNAL_BETA_EVIDENCE_LOG_TEMPLATE.md`
- 已新增 `interview/03_ApplyFlow样本评估与Agent迭代面试话术.md`
- 已更新 `interview/01_ApplyFlow项目面试主线.md`
- 已更新 `interview/02_深挖问答与防守口径.md`
- 待后续更新 `docs/APPLYFLOW_PORTFOLIO_ONE_PAGER.md`
- 待后续正式域名 + 线上 D1 恢复后，再跑正式 production 账号评估

## 11. Focused Review 自审记录

Correctness Findings：

- 明确了本轮评估目的、数据口径、输出文件、summary 指标和面试表达模板。
- 补充了 A/B 等级岗位覆盖和命中质量指标，避免只看 Top10 相关性。
- 已把运行状态更新为 1000 样本完成，并补充完整指标。
- 明确区分 production-like 本地真实池副本评估与正式线上 D1 production 结果。

Boundary/Safety Findings：

- 未把临时 Quick Tunnel 写成正式入口。
- 未把本轮评估写成大规模线上增长。
- 未把 `eugenec7012@126.com` 写成本轮本地真实池评估账号。

Adversarial Scenarios Checked：

- 检查账号接错池导致 Top10 不足。
- 检查公网隧道超时导致错误样本。
- 检查城市/行业字段缺失导致命中率低。
- 检查 A/B 等级覆盖高但城市/行业约束未命中的质量错位。

Blast Radius & Adjacent Regression Assessment：

- 本文件仅定义评估输出规范，不修改产品代码、数据库或线上入口；A/B 汇总脚本只读取既有结果并生成派生报告。

Residual Risks：

- 当前结果仍是本地真实池副本口径，不是正式域名 + 线上 D1 production 账号口径。
- 城市命中和 A/B 城市约束尚未修复，需要后续用 location golden set 复测。

Disposition：

- Unblocked。owner：项目作者。待 full run 完成后按本规范整理 Evidence Log。
