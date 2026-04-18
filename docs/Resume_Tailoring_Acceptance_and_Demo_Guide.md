# Resume Tailoring Agent 验收与演示说明

## 1. 目标

本轮验收的重点不是“AI 能不能生成一版简历”，而是验证 ApplyFlow 的 `Resume Tailoring Agent` 是否已经形成完整的人机协作闭环：

- 岗位评估之后，系统能生成岗位定制改写建议
- 用户能逐条查看 AI 改了什么、为什么改
- 用户能对每条建议执行 `接受 / 拒绝 / 编辑`
- 后续 `Prep Agent` 只使用 `accepted` 的内容
- 整个过程会被时间线记录下来，便于回放与审计

---

## 2. 三类测试 Case

### Case A：高匹配 JD

建议选择：

- AI Product Manager
- Product Strategy
- Growth Strategy

观察点：

- Tailoring 生成的关键词是否与 JD 高度一致
- 重点经历是否被正确前置
- 改写理由是否能对应到 JD 要求
- 接受 1-2 条建议后，Prep 是否只带入这些 accepted 内容
- 时间线里是否出现：
  - `岗位定制简历已生成`
  - `定制确认结果已保存`
  - `申请准备已保存`

成功标准：

- 改写建议整体合理
- 用户接受后的内容明显进入 Prep
- rejected / pending 内容没有混入 Prep

### Case B：中匹配 JD

建议选择：

- 商业分析 / Strategy Ops / BizOps
- 与用户原始简历只有部分交集的岗位

观察点：

- Tailoring 是否会更保守，而不是强行编造
- `reason` 是否明确说明为什么某段经历只是“可迁移”
- 当用户只接受少量 bullet 时，Prep 是否仍能正常生成，但内容更克制
- 时间线是否能看出人工确认影响了后续结果

成功标准：

- 系统不会过度包装
- accepted 内容进入 Prep，pending / rejected 被隔离
- 页面上能清楚看出 human-in-the-loop 的边界

### Case C：低匹配 JD

建议选择：

- 明显超出用户主方向的岗位
- 技术要求很强、与当前背景不一致的岗位

观察点：

- Tailoring 是否仍然只在真实经历内做重排，而不是生成新经历
- 用户如果全部 reject，Prep 页面是否明确提示“当前没有 accepted 内容”
- 时间线是否仍然保留 review 行为

成功标准：

- 系统不乱写
- 全 reject 时页面不崩
- Prep 不会偷偷带入未确认内容

---

## 3. 重点观察项

### A. Tailoring 是否合理

要看：

- before / after 是否真的围绕 JD 要求变化
- `reason` 是否解释了这次改写
- 是否属于“重排与强化”，而不是“虚构经历”

### B. Accepted 内容是否正确进入 Prep

要看：

- Prep 页面是否明确提示“只使用 accepted bullets”
- 已接受的 bullet 是否出现在 `定制简历要点`
- rejected / pending 是否没有混入

### C. Timeline 是否留痕

要看：

- 是否记录 tailoring 生成
- 是否记录 tailoring review 保存
- 是否能看到 accepted / rejected / pending 数量
- 是否能看出“Prep Agent 只会使用 accepted 内容”

---

## 4. Bad Case 记录建议

### Bad Case 1：改写过头

现象：

- 语气过于夸张
- 超出原始经历能支撑的范围

建议记录：

- 哪条 bullet 被放大过度
- 用户最终是 reject 还是 edit
- 为什么不自然

### Bad Case 2：关键词匹配对，但语义不自然

现象：

- 确实命中了 JD 关键词
- 但表达不符合真实简历语气

建议记录：

- 命中了哪些关键词
- 哪个 `reason` 合理、哪个文案不自然
- 用户是否通过 edit 修正

### Bad Case 3：用户全部 reject

现象：

- 用户认为当前改写不值得采用

系统预期：

- Tailoring review 仍然能保存
- 时间线仍然留痕
- Prep 页面明确提示“当前没有 accepted 内容”
- Prep 不应自动带入任何 AI 改写 bullet

---

## 5. 建议的演示顺序

1. 打开某个已完成评估的岗位详情页
2. 生成岗位定制简历
3. 展开 Diff 区，讲清楚：
   - 原始内容是什么
   - AI 改了什么
   - 为什么这样改
4. 在人工确认区：
   - 接受 1 条
   - 拒绝 1 条
   - 编辑 1 条再接受
5. 保存确认结果
6. 进入 Prep 页面
7. 展示：
   - Prep 只使用 accepted 内容
   - rejected / pending 不会进入
8. 回到 Job Detail 底部时间线
9. 展示系统如何记录这次人机协作

---

## 6. 面试表达重点

可以这样讲：

> ApplyFlow 的 Resume Tailoring Agent 不是“一键改简历”的黑盒工具，而是放在求职执行闭环里的一个中间 Agent。  
> 它先读取岗位 JD、用户画像和原始简历，生成结构化改写建议；然后用户逐条 accept / reject / edit；最后 Prep Agent 只消费被确认过的内容。  
> 这样做的重点不是炫生成能力，而是把 AI 决策、用户确认和后续执行链路真正接起来。

