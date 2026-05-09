# ApplyFlow Context

当前目标：完成误删恢复后的全系统巡检，不只验证排序，还覆盖 UI、发现/导入、执行门禁、简历导出、浏览器辅助投递、Edge 自动填充、DB 卫生与真实用户关键路径。

当前进度：
- 主库 `data/applyflow.sqlite` integrity=ok，总岗位 5633，真实池 `sourceLabel=feishu_offline_real_pool` 为 5001 条，PM 严格单岗锚点 `job_real5000_anchor_pm_xiaohongshu_rpt` 存在，已知验证脚本岗位残留为 0。
- 已恢复共享评分链关键口径：明确含目标岗位的合集岗给高 roleFit；显式目标子岗位不再被 mixed cap、行业不匹配或缺失维度压成 C/D；`null`/空地点/空公司不再按 0 分参与主分；`地点未说明` 视为缺失地点；非单岗缺地点最高封顶到 B 区间；产品培训生计划不作为培训岗冲突。
- 已补齐后端/前端岗位族 alias 与相邻关系，覆盖 Java/Golang/服务端/Web 前端/React/Vue 等真实池常见写法。
- 已新增 `validate:real-pool-role-matrix` Top100 门禁：PM、数据、算法、后端、测试、运营、研究、金融研究员均有 100+ 高置信供给且 Top100 全部 A/B；前端真实池高置信供给为 99，99 个全部进入 Top100，Top100 全部 A/B。
- 扩展巡检还覆盖项目经理、产品运营、UI 设计、运维、财务、机械等低供给岗位；这些岗位的高置信供给不足 100，已确认高置信岗位全部排在前面，后续 C/D 属于真实池供给不足，不应硬抬无关岗位。
- PM 画像重放 Top5：舒客电商 A、小红书RPT产品培训生计划 A、从平技术 B、云帐房 B、快仓智能 B；收钱吧恢复为 B/roleFit 96，杉树科技 roleFit 96 且排在无 PM 的墨芯/鼎阳前面。
- 已完成全系统巡检：`validate:all` PASS，覆盖基础构建、schema、fixtures、UI guard/runtime/user-flow、discovery contracts/Feishu/offline_json/dedup/ranking/shortlist/admission/fullchain、execution、browser apply、resume export、master resume、jobs apply UI、profile autofill、layout IA、Edge extension/autofill。
- 非排序真实问题已修复：`force_proceed` 人工覆盖现在只解封 `needs_human_review` 控制门，不绕过 blocked/skip；Jobs 卡片恢复优先级分数、评分解释、原始链接、命中岗位方向 badge，超长合集岗标题摘要从 120 放宽到 240，避免命中子岗位被 UI 截断误解。
- 已验证：lint PASS、typecheck PASS、build PASS、validate:all PASS、validate:job-preference-eval-seed PASS、validate:job-scoring-derived-view PASS、acceptance PASS、gate PASS、validate:real-pool-role-matrix PASS、ui runtime PASS、ui key path PASS、ui user flow PASS、contamination PASS。

下一步：
- 用户可刷新本地页面按真实用户流程验收 Dashboard → Jobs → shortlist → compare/details → materials/profile → submit/dry-run → follow-up/reload/revisit/filter reset。
- 如要部署，仍需单独执行既定部署流程和线上 smoke；本轮未部署。
- 工作区仍有大量历史恢复/污染文件，不可直接整体合并或清理；后续只应围绕本轮 touched 文件做 review/提交。

注意事项：
- 默认权重仍保持 role 35 / industry 25 / location 20 / company 10 / accessibility 10，未迁移 role 50。
- 本轮没有改 comparator、acceptance truth definition、Grade/Verdict 阈值或排序 gate 口径。
- 当前可声明为高可信功能等价恢复；由于历史脏工作区仍在，不能声明字节级原样恢复。

最后更新时间：2026-05-09
