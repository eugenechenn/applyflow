# ApplyFlow 部署状态

更新时间：2026-04-18

本文档只记录部署相关的真实状态、已验证结果、待部署改动与线上验收重点。

## 1. 当前部署结构

### Cloudflare

负责：

- Web 前端页面
- API 路由
- Session / 用户边界
- D1 读写
- Orchestrator / repository facade / 页面数据返回

### Railway

当前至少有两个独立服务：

- `jd-fetcher`
  - 职位 URL 抓取
  - Playwright / Chromium
- `resume-parser`
  - 简历 PDF / DOCX 解析
  - 文本清洗、结构化、质量评估

### D1

负责持久化：

- 用户画像
- 岗位
- 评估结果
- 申请准备
- 审计与治理数据
- 简历解析结果

## 2. 已验证上线能力

### 已验证通过

- Cloudflare Worker / D1 主链路可用
- Railway `jd-fetcher` 已可被 Worker 在线调用
- Railway `resume-parser` 已参与简历上传链路
- 普通文本型 PDF 已验证可成功解析
- 正常 PDF 可返回：
  - `extractionMethod: pdf-parse`
  - `status: success`

## 3. 最近已解决的问题

### 已打通

- PDF 上传主链路已打通
- Worker 与 Railway resume-parser 的调用已打通
- 普通文本型 PDF 不再停留在纯 fallback 级别

### 已在仓库完成，待重新部署后验收

- Canva / 非标准 PDF 的多阶段解析 pipeline
- 低质量 fallback 结果的持久化净化
- 前端对 fallback_text 的防垃圾展示逻辑

## 4. 当前线上风险点

### 当前已知边界

- 文本型 PDF：可用
- 图片型 / 扫描型 PDF：仍可能失败
- 当前没有 OCR

### 当前最关键的线上验收点

- 普通 PDF 上传后，页面应显示真实文本或结构化结果
- Canva-like / 异常 PDF 上传后，即使失败，也不能再向前端暴露 `%PDF-1.4 ...`、`obj`、`xref` 等垃圾内容

## 5. 为什么有些修复需要分别部署

### 只改 Railway resume-parser 就够的情况

- PDF / DOCX 解析能力变化
- 文本提取方式变化
- 文本清洗与质量评估变化

### 必须同时改 Cloudflare 的情况

- 前端展示逻辑变化
- Worker 写入 / 读取 D1 的净化逻辑变化
- 页面如何解释 fallback / partial / failed 变化

因此，涉及“简历解析垃圾内容不再出现在页面”这类问题时，通常需要：

1. Railway 重新部署 parser 服务
2. Cloudflare 重新部署主应用

## 6. 当前待部署 / 待验收改动

以下改动已经在仓库中，但要在线上看到效果，还需要重新部署：

- `src/lib/resume/resume-parser.js`
  - 多阶段 PDF pipeline
  - 质量评估
  - 详细日志
- `src/server/store.js`
  - 低质量 resume 结果写入与读取时的兜底净化
- `public/app.js`
  - 前端对 fallback_text 的友好展示与垃圾文本防泄露

## 7. 当前最重要的线上验收标准

### 验收 1：普通 PDF

上传后应看到：

- `extractionMethod = pdf-parse` 或 `pdfjs-dist`
- `status = success`
- 页面出现真实摘要 / 结构化经历 / 技能等内容

### 验收 2：Canva-like / 异常 PDF

上传后允许：

- `extractionMethod = fallback_text`
- `status = partial` 或 `failed`

但必须满足：

- 页面不再出现 `%PDF-1.4 ...`
- 页面不再出现 `obj` / `xref` / `trailer` 等 PDF 结构垃圾
- 页面只显示安全摘要或用户友好提示

### 验收 3：日志

Railway 日志中至少要能看到：

- 进入 PDF pipeline
- Stage A 结果
- Stage B 结果
- 最终 extractionMethod
- parseStatus
- cleanedTextLength

## 8. 当前推荐部署动作

### 当修改了 resume parser 时

需要：

- `git push`
- Railway redeploy `resume-parser`

### 当修改了 store / 前端展示逻辑时

还需要：

- Cloudflare deploy

## 9. 下一步部署优先级

### P0

- 完成线上简历链路最终验收
- 确认线上页面不再暴露垃圾 PDF 内容

### P1

- 提升 Canva / 非标准 PDF 鲁棒性
- 视真实失败率决定是否引入 OCR fallback

### P2

- 增强日志查询与错误回放
- 完善线上验收与回归清单
