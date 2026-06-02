/*
 * 生成 AI 面试复习 XMind/OPML 脑图文件。
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "interview", "mindmap");
const buildDir = path.join(root, "tmp", `interview-xmind-build-${Date.now()}`);

function id(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function topic(title, children = [], notes = "") {
  const node = {
    id: id("topic"),
    class: "topic",
    title,
  };
  if (notes) {
    node.notes = { plain: { content: notes } };
  }
  if (children.length) {
    node.children = { attached: children };
  }
  return node;
}

const tree = topic("AI岗位面试复习地图", [
  topic("三个主场", [
    topic("ApplyFlow：求职执行闭环", [
      topic("岗位浏览→投递清单→插件辅助网申→状态回填→反馈复盘"),
      topic("当前定位：求职决策与执行闭环Agent，不是简历改写型文本生成Agent"),
      topic("可解释排序：userPriorityScore / Grade / Verdict"),
      topic("回答项目、Agent、评估、数据迭代"),
    ]),
    topic("网易AIGC实习：内容安全治理", [
      topic("风险分类：事实性、版权、敏感、低质、诱导"),
      topic("Bad Case台账：输入/输出/风险/归因/复测"),
      topic("回答AIGC vs 人工内容、Prompt边界、人工复核"),
    ]),
    topic("Codex开发流程：AI Coding治理", [
      topic("AGENTS.md：规则和边界"),
      topic("CONTEXT.md / TIMELINE.md：现场和留痕"),
      topic("Smoke Test / Focused Review / 安全边界门禁"),
    ]),
  ]),
  topic("母题合并地图", [
    topic("真实任务闭环", [
      topic("为什么做项目 / 不是玩具 / 普通推荐区别"),
      topic("桥梁：先讲推进了什么真实任务"),
    ]),
    topic("Agent与Workflow分工", [
      topic("Agent vs workflow / 规则 / ReAct / 多Agent / 排序规则算不算Agent"),
      topic("桥梁：如果只看排序函数不是Agent；ApplyFlow体现在Decision/Control/Action/Feedback闭环"),
    ]),
    topic("输出正确性与模型边界", [
      topic("没有LLM文本输出怎么评估 / 为什么不做简历改写"),
      topic("桥梁：内容输出、决策输出、动作/状态输出分别评估"),
      topic("不看文案好坏，改看岗位判断准不准、用户是否采纳、流程有没有推进错"),
      topic("模型是候选判断，不是事实和状态的source-of-truth"),
      topic("基座选型：推理质量、速度、成本、工具调用、上下文、合规"),
    ]),
    topic("系统边界与工具执行", [
      topic("Human-in-the-loop / 全自动海投 / 插件辅助网申 / Tool Calling"),
      topic("桥梁：能动手做事就要讲权限、Schema、状态机、人工确认"),
    ]),
    topic("Harness工程", [
      topic("Prompt/Context/Harness / Agent运行底座 / Codex治理 / eval gate"),
      topic("桥梁：把概率模型放进确定性工程系统"),
    ]),
    topic("数据迭代", [
      topic("用户数据 / 指标提升 / A/B / Bad Case"),
      topic("桥梁：指标看方向，用户原话解释原因"),
    ]),
    topic("工程治理", [
      topic("Codex难点 / AI误改 / Review规范 / 缓存状态错位 / Prompt+Schema"),
      topic("桥梁：把概率模型放进确定性工程门禁"),
    ]),
    topic("上下文与知识管理", [
      topic("RAG / 长上下文 / Memory / OpenClaw / token"),
      topic("桥梁：模型该看什么、从哪里找证据、如何控噪声"),
    ]),
    topic("产品落地与协作", [
      topic("PRD / 成本延迟 / 灰度上线 / 协作"),
      topic("桥梁：用户任务、边界、指标、成本、上线节奏"),
    ]),
  ]),
  topic("面试官主动高频题", [
    topic("自我定位", [
      topic("为什么适合AI产品/AI应用/Agent岗？"),
      topic("接法：落地型候选人，能讲场景、边界、指标、反馈闭环"),
    ]),
    topic("场景判断", [
      topic("怎么判断业务适不适合做AI？"),
      topic("接法：非结构化理解/生成/匹配/多轮决策 + 可验证结果"),
    ]),
    topic("系统设计", [
      topic("给我们业务设计一个AI Agent？"),
      topic("接法：用户任务→AI判断点→workflow→工具→状态→人机边界→指标"),
    ]),
    topic("自动求职Agent完整链路", [
      topic("简历解析→JD分析→Gap→简历改写→草稿→投递→状态→跟进"),
      topic("接法：ApplyFlow先做更可验证的岗位判断/投递清单/状态回填切片"),
    ]),
    topic("输出正确性", [
      topic("没有LLM生成简历怎么判断Agent输出对不对？"),
      topic("接法：固定岗位池验证判断 + 用户采纳看效用 + 流程记录防执行错"),
    ]),
    topic("模型边界感", [
      topic("模型能做什么，不能做什么？"),
      topic("接法：模型做候选判断，规则/工具/状态机/人做确认和验收"),
    ]),
    topic("基座模型选型", [
      topic("不同模型速度/成本/工具调用不同怎么选？"),
      topic("接法：低风险用规则/小模型，高复杂用强模型，工具任务看结构化稳定性"),
    ]),
    topic("Agent基础", [
      topic("Agent、Chatbot、Workflow区别？"),
      topic("接法：Chatbot答，Workflow走固定流程，Agent在边界内调用工具推进任务"),
    ]),
    topic("工具调用", [
      topic("Tool Calling错参/越权怎么办？"),
      topic("接法：Prompt软约束 + Schema/权限/状态/审计硬约束"),
    ]),
    topic("评估与可靠性", [
      topic("怎么评估Agent？上线后答非所问怎么排查？"),
      topic("接法：Harness运行底座 + Bad Case分类 + 回归集"),
    ]),
    topic("ROI与上线", [
      topic("模型效果提升但成本延迟上升怎么办？AI功能ROI怎么算？"),
      topic("接法：收益指标 + 护栏指标 + 分层调用 + 灰度"),
    ]),
    topic("入职计划", [
      topic("入职第一个月怎么做？"),
      topic("接法：先看业务和Bad Case，再找低风险小切口，做小闭环验证"),
    ]),
  ]),
  topic("1 业务场景题", [
    topic("常见问法", [
      topic("为什么做这个项目？"),
      topic("解决了什么真实问题？"),
      topic("AI产品怎么找场景？"),
      topic("基于我们公司业务设计AI系统？"),
      topic("AI招聘助手/客服/审核/知识库怎么设计？"),
    ]),
    topic("万能系统设计框架", [
      topic("业务目标：服务谁，完成什么任务"),
      topic("AI必要性：哪里需要理解/匹配/生成/决策"),
      topic("流程拆解：入口、数据、AI、工具、状态、人工确认"),
      topic("边界：建议/自动执行/人工确认"),
      topic("评估：Task、Transcript、Outcome、Grader"),
      topic("指标：完成率、采纳率、Bad Case、人工介入、成本延迟"),
    ]),
    topic("万能题：企业AI客服/工单Agent", [
      topic("入口：用户问题、订单/产品、截图"),
      topic("AI：意图识别、问题总结、处理建议"),
      topic("工具：查订单、建工单、算退款资格、发通知"),
      topic("边界：退款/补偿/封号必须校验或人工确认"),
      topic("Harness：工具权限、状态验证、典型工单集、轨迹、最终状态、评分器"),
      topic("指标：一次解决率、转人工率、错误退款率、成本延迟"),
    ]),
    topic("ApplyFlow作为方法论样板", [
      topic("业务目标：岗位浏览→有计划投递"),
      topic("AI判断：JD语义理解、偏好匹配、推荐理由"),
      topic("Workflow：投递清单、状态回填、反馈复盘"),
      topic("工具：Edge插件辅助预填官网可识别字段"),
      topic("边界：不做全自动投递，用户确认提交"),
    ]),
    topic("口播", [], "系统设计题我不会硬套ApplyFlow业务，而是迁移方法论：先拆企业业务任务，再判断AI判断点、确定流程、人机边界、评估和指标。"),
  ]),
  topic("2 Agent架构题", [
    topic("常见问法", [
      topic("Agent和workflow有什么区别？"),
      topic("为什么不用普通规则？"),
      topic("ReAct / Plan-and-Execute怎么选？"),
      topic("多Agent和单Agent+多工具怎么选？"),
      topic("完整自动求职Agent怎么拆？为什么没做简历改写？"),
    ]),
    topic("接回ApplyFlow", [
      topic("workflow：岗位导入、排序、投递清单、状态回填"),
      topic("Agent能力：理解JD、生成解释、识别风险、下一步建议"),
      topic("Agent闭环：Decision决策合同 → Control门禁 → Action状态推进 → Feedback回流"),
      topic("当前输出：岗位优先级、推荐解释、动作建议、状态结果"),
      topic("未做：简历解析/简历改写/求职信草稿，原因是高主观、高风险、需评估底座"),
      topic("Memory：用户偏好、岗位状态、反馈记录分开存"),
    ]),
    topic("口播", [], "ApplyFlow不是让模型自由行动，而是把Agent放进workflow里。模型做语义判断，系统决定状态能不能推进。"),
  ]),
  topic("3 系统边界题", [
    topic("常见问法", [
      topic("AI生成错了怎么办？"),
      topic("Prompt注入怎么办？"),
      topic("工具调用参数乱传怎么办？"),
      topic("用户数据怎么隔离？"),
      topic("为什么不做全自动投递？"),
    ]),
    topic("接回ApplyFlow/网易", [
      topic("Prompt是软约束，Schema和权限是硬约束"),
      topic("Edge插件只辅助预填，不自动提交"),
      topic("外部投递不自动提交，用户最终确认"),
      topic("demo、真实池、白名单用户分层隔离"),
      topic("网易实习：生成结果要有风险分类和人工复核"),
    ]),
    topic("口播", [], "我不会把高风险动作交给模型直接执行。AI可以建议岗位，插件可以辅助预填，但加入投递清单、状态回填和真实提交都要有系统边界和用户确认。"),
  ]),
  topic("4 Harness工程：Agent运行底座", [
    topic("常见问法", [
      topic("Prompt Engineering、Context Engineering、Harness Engineering有什么区别？"),
      topic("Agent怎么从demo变成可上线系统？"),
      topic("怎么确保Codex给的代码/方案是正确的？"),
      topic("怎么防止长对话后Codex把代码写乱？"),
      topic("你怎么评估Agent效果？"),
      topic("eval harness怎么搭？"),
      topic("benchmark怎么设计？"),
      topic("Grader怎么组合？"),
      topic("pass@k是什么？"),
      topic("模型升级后怎么防回退？"),
    ]),
    topic("三层区分", [
      topic("Prompt：让模型听懂"),
      topic("Context：让模型看见"),
      topic("Harness：让模型在可控系统里做事"),
      topic("eval harness只是评估组件，不是全部"),
    ]),
    topic("ApplyFlow/Codex最小可用Harness", [
      topic("产品侧：AI建议 + workflow状态 + 插件权限 + 用户确认"),
      topic("开发侧：AGENTS.md + CONTEXT.md + TIMELINE.md"),
      topic("验证侧：smoke test + Focused Review + 安全边界门禁"),
      topic("评估侧：固定画像/岗位池 + 轨迹 + 状态结果 + 人工抽检"),
      topic("边界侧：不自动提交、不信前端userId、不绕过source-of-truth"),
    ]),
    topic("顶级Agent系统五层", [
      topic("Prompt编排：静态规则 + 动态上下文"),
      topic("角色拆分：主Agent计划汇总，子模块专项执行"),
      topic("验证机制：生成不等于完成，最终看真实状态"),
      topic("工具治理：Schema、权限、日志、失败处理"),
      topic("生命周期：状态、checkpoint、恢复、降级、人类接管"),
    ]),
    topic("口播", [], "Prompt让模型听懂，Context让模型看见，Harness让模型在可控系统里做事。ApplyFlow里我用产品边界和开发规程做最小可用Harness，不是只靠模型自觉。"),
  ]),
  topic("5 数据迭代题", [
    topic("常见问法", [
      topic("你有用户数据吗？"),
      topic("指标提升从哪里来？"),
      topic("用户反馈怎么转成迭代？"),
      topic("Bad Case怎么治理？"),
      topic("A/B怎么做？"),
    ]),
    topic("接回Evidence Log", [
      topic("来源：dogfooding + 朋友试用 + 固定测试画像"),
      topic("反馈：点击投递链接后内容混乱"),
      topic("迭代：打开链接、加入投递清单、标记已投递、反馈误判"),
      topic("指标：投递清单候选率 8.8%→16.7%"),
      topic("指标：状态回填率 33.3%→58.8%"),
    ]),
    topic("边界", [], "这是小样本同口径复测，不是大规模线上增长。"),
  ]),
  topic("6 工程落地题", [
    topic("常见问法", [
      topic("用Codex开发遇到什么难点？"),
      topic("怎么防止AI误改代码？"),
      topic("怎么做回归验证？"),
      topic("怎么处理缓存、状态错位、线上问题？"),
      topic("smoke test、review、安全边界门禁是什么？"),
      topic("什么是source-of-truth绕过？"),
    ]),
    topic("接回开发治理", [
      topic("AGENTS.md：读取顺序、不可改边界、验证规则"),
      topic("CONTEXT.md：保持当前工作现场"),
      topic("TIMELINE.md：记录阶段变化"),
      topic("Smoke Test：先确认环境和最小主路径能跑"),
      topic("Focused Review：检查正确性、相邻回归和共享层误伤"),
      topic("安全边界门禁：防权限、状态、缓存、用户确认被绕过"),
      topic("对抗场景：空值、重复项、伪造userId、旧缓存、共享helper误伤"),
      topic("Source-of-truth：状态写入以服务端认证用户和排序合同为准"),
      topic("Disposition：Blocked / Unblocked 和残余风险"),
      topic("验证脚本：production smoke、UI smoke、排序gate"),
    ]),
    topic("ApplyFlow例子", [
      topic("岗位卡片按钮改动：不能误伤投递清单、状态回填、插件入口"),
      topic("排序helper改动：不能破坏Grade、Verdict、雷达图、多岗位对比一致性"),
      topic("插件辅助网申：只能预填，不能自动提交或绕过用户确认"),
      topic("登录白名单：不能信任前端传入userId导致跨用户写入"),
      topic("缓存修复：不能让旧localStorage隐藏真实岗位池"),
    ]),
    topic("口播", [], "我的项目不是只用Codex写代码，而是把Codex当成一个需要治理的Agent。Smoke test看能不能活，review看改得对不对，安全边界门禁看有没有越权或误伤。"),
  ]),
  topic("7 产品协作与上线题", [
    topic("常见问法", [
      topic("AI产品PRD怎么写？"),
      topic("怎么和研发/算法/测试协作？"),
      topic("效果提升但成本延迟上升怎么办？"),
      topic("怎么做灰度和上线复盘？"),
    ]),
    topic("回答框架", [
      topic("用户任务和成功指标"),
      topic("模型能力边界和失败兜底"),
      topic("评估指标和护栏指标"),
      topic("灰度上线和Bad Case回流"),
    ]),
    topic("口播", [], "我不会只写接入大模型，而是写清用户任务、输入输出、边界、指标、灰度、失败兜底和复盘。"),
  ]),
  topic("8 知识盲区题", [
    topic("常见问法", [
      topic("RAG怎么做召回和rerank？"),
      topic("长上下文和RAG怎么选？"),
      topic("Agent记忆系统怎么设计？"),
      topic("OpenClaw类框架记忆和传统Agent区别？"),
      topic("SFT / RLHF / Agentic RL怎么看？"),
      topic("多模态Agent怎么评估？"),
      topic("MCP / LangGraph / AutoGen怎么看？"),
    ]),
    topic("回答公式", [
      topic("承认边界：我没有完整生产落地"),
      topic("项目有关：先理论，再接ApplyFlow"),
      topic("项目无关：直接标准答案，不硬拉"),
      topic("讲清：解决什么、流程、风险、评估"),
    ]),
    topic("短期背诵", [
      topic("RAG：找得到证据"),
      topic("长上下文：放得下材料"),
      topic("二者常结合：RAG先找，长上下文再读"),
      topic("Memory：外部存储 + 按任务检索"),
    ]),
  ]),
  topic("跨类联系：题目之间怎么串", [
    topic("业务场景 → Agent架构", [
      topic("先证明真实任务存在，再说明为什么需要Agent"),
      topic("例：求职不是单次问答，而是持续执行流程"),
    ]),
    topic("Agent架构 → 系统边界", [
      topic("只要Agent能调用工具，就必须讲权限、Schema和人工确认"),
      topic("例：模型推荐岗位，但系统决定能否写状态"),
    ]),
    topic("系统边界 → 评估指标", [
      topic("边界不是口头承诺，要用脚本和Bad Case复测"),
      topic("例：forged userId拒绝、投递状态回填验证"),
    ]),
    topic("评估指标 → 数据迭代", [
      topic("评估发现问题后，要进入Evidence Log和迭代记录"),
      topic("例：投递清单候选率、状态回填率改版前后对比"),
    ]),
    topic("数据迭代 → 工程落地", [
      topic("用户反馈不能只改文案，还要改状态流、缓存和验证"),
      topic("例：投递主路径收敛、localStorage残留修复"),
    ]),
    topic("工程落地 → 知识盲区", [
      topic("没做过的技术也能回答落地思路：先数据、边界、评估"),
      topic("例：RAG/SFT/RL先不硬装，讲未来怎么接入ApplyFlow"),
    ]),
    topic("工程治理 → 系统边界", [
      topic("Review规范本质是在证明边界没有被改坏"),
      topic("例：插件预填、用户隔离、状态写入、缓存一致性"),
    ]),
    topic("工程治理 → Harness工程", [
      topic("Review检查单次改动，Harness/Gate防长期回退"),
      topic("例：production smoke、UI smoke、排序gate、forged userId拒绝"),
    ]),
    topic("工具执行 → 系统边界", [
      topic("插件辅助预填是低风险提效，不是自动提交"),
      topic("例：可识别字段可预填，验证码/附件/最终提交由用户处理"),
    ]),
    topic("产品协作贯穿全程", [
      topic("PRD要写清任务、边界、指标、成本、灰度"),
      topic("研发/算法/测试要围绕同一套评估口径协作"),
    ]),
    topic("万能串法", [], "真实场景决定Agent是否必要；Agent一旦进入流程就必须有系统边界；边界要靠Harness验证；评估发现问题进入数据迭代；迭代最终落到工程治理和产品协作。"),
  ]),
  topic("90分钟复习路线", [
    topic("10分钟：背8类题型和3个锚点"),
    topic("20分钟：背ApplyFlow 30秒、3分钟、五个深挖问题"),
    topic("15分钟：背Prompt/Context/Harness和Codex治理"),
    topic("15分钟：背系统边界和Coding难点"),
    topic("15分钟：背网易实习30秒、AIGC vs 人工内容、Bad Case"),
    topic("15分钟：练5道知识盲区题"),
  ]),
    topic("最小背诵卡", [
    topic("先从真实任务出发，不先堆技术名词"),
    topic("AI能力和确定性系统分开"),
    topic("Prompt是软约束，Schema/校验/日志/人工确认是硬治理"),
    topic("评估看任务结果、执行轨迹和真实系统状态"),
    topic("Harness=规则+上下文+工具+状态+验证+恢复+人机边界"),
    topic("Smoke test看能不能活，Review看改得对不对，安全门禁看有没有越权或误伤"),
    topic("Source-of-truth不能绕过：前端参数、模型输出、缓存都不能替代服务端真实状态"),
    topic("小样本同口径复测，不冒充大规模线上数据"),
    topic("项目无关知识点给标准答案，不硬拉ApplyFlow"),
  ]),
]);

function opmlTopic(node) {
  const children = node.children?.attached || [];
  const text = escapeXml(node.title);
  const note = node.notes?.plain?.content ? ` _note="${escapeXml(node.notes.plain.content)}"` : "";
  if (!children.length) {
    return `<outline text="${text}"${note}/>`;
  }
  return `<outline text="${text}"${note}>${children.map(opmlTopic).join("")}</outline>`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ensureCleanDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

fs.mkdirSync(outDir, { recursive: true });
ensureCleanDir(buildDir);

const sheetId = id("sheet");
const content = [
  {
    id: sheetId,
    class: "sheet",
    title: "AI面试复习地图",
    rootTopic: tree,
    topicPositioning: "fixed",
    extensions: [],
  },
];

fs.writeFileSync(path.join(buildDir, "content.json"), JSON.stringify(content, null, 2), "utf8");
fs.writeFileSync(
  path.join(buildDir, "metadata.json"),
  JSON.stringify(
    {
      creator: { name: "Codex", version: "1.0" },
      activeSheetId: sheetId,
    },
    null,
    2,
  ),
  "utf8",
);
fs.writeFileSync(
  path.join(buildDir, "manifest.json"),
  JSON.stringify(
    {
      "file-entries": {
        "content.json": {},
        "metadata.json": {},
      },
    },
    null,
    2,
  ),
  "utf8",
);

const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>AI岗位面试复习地图</title>
  </head>
  <body>
    ${opmlTopic(tree)}
  </body>
</opml>
`;

const opmlPath = path.join(outDir, "ai-interview-review-map.opml");
const xmindPath = path.join(outDir, "ai-interview-review-map.xmind");
const fallbackXmindPath = path.join(outDir, "ai-interview-review-map-v2.xmind");
const timestampXmindPath = path.join(outDir, `ai-interview-review-map-${Date.now()}.xmind`);
fs.writeFileSync(opmlPath, opml, "utf8");
let targetXmindPath = xmindPath;
try {
  fs.rmSync(xmindPath, { force: true });
} catch (error) {
  if (error.code !== "EPERM" && error.code !== "EACCES") {
    throw error;
  }
  targetXmindPath = fallbackXmindPath;
  try {
    fs.rmSync(fallbackXmindPath, { force: true });
  } catch (fallbackError) {
    if (fallbackError.code !== "EPERM" && fallbackError.code !== "EACCES") {
      throw fallbackError;
    }
    targetXmindPath = timestampXmindPath;
  }
}

execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${buildDir}', '${targetXmindPath}')`,
  ],
  { stdio: "inherit" },
);

console.log(`Generated: ${targetXmindPath}`);
console.log(`Generated: ${opmlPath}`);
