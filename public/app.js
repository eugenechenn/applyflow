const app = document.getElementById("app");
const title = document.getElementById("page-title");
const subtitle = document.getElementById("page-subtitle");
const currentUserLabel = document.getElementById("current-user");
const logoutButton = document.getElementById("logout-button");
let selectedPolicyProposalId = null;
let authSession = { authenticated: false, user: null };
const DEMO_AUTO_LOGIN_EMAIL = "eugene@example.com";
let autoLoginAttempted = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildImportWarningsHtml(warnings = []) {
  if (!warnings.length) return "";
  return `
    <div class="draft-warnings">
      ${warnings.map((warning) => `<div class="draft-warning-item">${escapeHtml(warning)}</div>`).join("")}
    </div>
  `;
}

async function api(path, options = {}) {
  try {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
    const data = await response.json();
    if (!data.success) {
      const error = new Error(localizeErrorMessage(data.error?.message || "Request failed"));
      error.code = data.error?.code;
      error.details = data.error?.details;
      error.rawMessage = data.error?.message || "Request failed";
      throw error;
    }
    return data.data;
  } catch (error) {
    if (error instanceof Error && error.code) {
      throw error;
    }
    console.error("API request failed", { path, error });
    throw new Error(localizeErrorMessage(error?.message || "Request failed"));
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("文件读取失败，请重试。"));
    reader.readAsDataURL(file);
  });
}

async function downloadFromApi(path, fallbackFileName) {
  const response = await fetch(path);
  if (!response.ok) {
    let message = "导出失败，请稍后重试。";
    try {
      const payload = await response.json();
      message = localizeErrorMessage(payload.error?.message || message);
    } catch (error) {
      console.error("导出接口返回非 JSON 响应", error);
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const header = response.headers.get("content-disposition") || "";
  const matchedName = header.match(/filename\\*=UTF-8''([^;]+)/i);
  const fileName = matchedName ? decodeURIComponent(matchedName[1]) : fallbackFileName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function fetchAuthSession() {
  const response = await fetch("/api/auth/session", {
    headers: { "Content-Type": "application/json" }
  });
  const payload = await response.json();
  authSession = payload.data || { authenticated: false, user: null };
  updateAuthChrome();
  return authSession;
}

async function ensureDemoSession() {
  if (autoLoginAttempted) {
    return authSession;
  }
  autoLoginAttempted = true;
  renderLoadingState("正在进入系统", "正在创建演示工作台会话...");
  await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ email: DEMO_AUTO_LOGIN_EMAIL })
  });
  return fetchAuthSession();
}

function updateAuthChrome() {
  if (!currentUserLabel || !logoutButton) return;
  if (authSession?.authenticated && authSession.user) {
    currentUserLabel.textContent = `当前身份：${authSession.user.email || authSession.user.username || authSession.user.id}`;
    logoutButton.style.display = "inline-flex";
    return;
  }
  currentUserLabel.textContent = "未登录";
  logoutButton.style.display = "none";
}

function setActiveNav(route) {
  document.querySelectorAll(".nav a").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === route);
  });
}

function getStatusDisplayLabel(status) {
  const labels = {
    inbox: "待处理",
    evaluating: "评估中",
    to_prepare: "待准备",
    ready_to_apply: "可投递",
    applied: "已投递",
    follow_up: "待跟进",
    interviewing: "面试中",
    rejected: "未通过",
    offer: "录用",
    archived: "已归档",
    forming: "形成中"
  };
  return labels[status] || status || "未知状态";
}

function getStageStatusLabel(status) {
  const labels = {
    pending: "等待中",
    completed: "已完成",
    fallback: "回退结果",
    active: "进行中",
    ready: "可执行",
    failed: "失败",
    not_applicable: "不适用"
  };
  return labels[status] || status || "未知状态";
}

function statusBadge(status) {
  return `<span class="status ${status}">${escapeHtml(getStatusDisplayLabel(status))}</span>`;
}

function sectionCard(titleText, body) {
  return `<div class="card"><h3>${escapeHtml(titleText)}</h3>${body}</div>`;
}

function renderNotice(kind, message) {
  return `<div class="notice ${kind}">${escapeHtml(message)}</div>`;
}

function renderLoadingState(titleText = "加载中", bodyText = "正在同步最新的 ApplyFlow 工作台数据...") {
  app.innerHTML = `
    <div class="loading-state">
      <div class="loading-dot"></div>
      <div>
        <h3>${escapeHtml(titleText)}</h3>
        <p>${escapeHtml(bodyText)}</p>
      </div>
    </div>
  `;
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : "暂无";
}

function semanticBadge(label, tone = "") {
  return `<span class="status ${tone}">${escapeHtml(label)}</span>`;
}

function formatPolicyVersion(policyLike) {
  if (!policyLike) return "策略不可用";
  return `策略版本 ${policyLike.version || 1}`;
}

function localizeErrorMessage(message = "") {
  const text = String(message || "").trim();
  if (!text) return "系统处理请求失败，请稍后重试。";
  if (/Cannot read properties|undefined|reading/i.test(text)) return "页面数据加载异常，请刷新后重试。";
  if (/Authentication required|UNAUTHENTICATED|Not signed in|session expired/i.test(text)) return "登录状态已失效，请重新进入系统。";
  if (/Worker|runtime|Internal Server Error/i.test(text)) return "系统处理请求失败，请稍后重试。";
  if (/network|fetch failed|Failed to fetch|ETIMEDOUT|ECONN/i.test(text)) return "网络请求失败，请检查连接后重试。";
  if (/Request failed/i.test(text)) return "请求处理失败，请稍后重试。";
  return text;
}

function humanizeProposalStatus(status) {
  const map = {
    pending: { label: "待审核", tone: "pending" },
    approved: { label: "已批准", tone: "approved" },
    rejected: { label: "已拒绝", tone: "rejected" },
    applied: { label: "已生效", tone: "applied" },
    reverted: { label: "已回滚", tone: "reverted" }
  };
  return map[status] || { label: status || "未知状态", tone: "" };
}

function humanizeStrategyDecision(value) {
  const map = {
    proceed: { label: "建议推进", helper: "这条岗位与当前策略较匹配，建议保留在主推进队列。" },
    cautious_proceed: { label: "谨慎推进", helper: "值得继续，但风险较明显，建议带着问题准备。" },
    deprioritize: { label: "降低优先级", helper: "可以保留观察，但不建议挤占更强机会的时间。" },
    avoid: { label: "建议回避", helper: "系统判断这条岗位不值得优先投入，除非你明确人工覆盖。" }
  };
  return map[value] || { label: value || "待判断", helper: "系统仍在形成这条岗位的策略判断。" };
}

function humanizeRecommendation(value) {
  const map = {
    apply: { label: "建议投递", tone: "applied" },
    cautious: { label: "谨慎投递", tone: "to_prepare" },
    skip: { label: "暂不优先", tone: "archived" }
  };
  return map[value] || { label: value || "待评估", tone: "" };
}

function humanizeTriggerType(value) {
  const map = {
    interview_reflection: "面试复盘",
    bad_case: "失败案例回看",
    metrics_shift: "指标变化",
    manual_review: "人工审核"
  };
  return map[value] || value || "策略提案";
}

function humanizeFocusMode(value) {
  const map = {
    focused: "聚焦推进",
    balanced: "平衡探索",
    exploratory: "探索阶段"
  };
  return map[value] || value || "平衡探索";
}

function humanizeRiskTolerance(value) {
  const map = {
    low: "低",
    medium: "中",
    high: "高"
  };
  return map[value] || value || "中";
}

function humanizeOverride(value) {
  const map = {
    force_proceed: "强制继续推进",
    ignore_policy: "忽略系统策略",
    force_archive: "仍然归档"
  };
  return map[value] || value || "未人工覆盖";
}

function humanizeOverrideSummary(value) {
  const text = String(value || "").trim();
  if (!text) return "已应用人工覆盖";
  const [action, ...rest] = text.split(":");
  const label = humanizeOverride(action.trim());
  const reason = rest.join(":").trim();
  return reason ? `${label}：${reason}` : label;
}

function humanizePriority(value) {
  const map = {
    high: "高优先级",
    medium: "中优先级",
    low: "低优先级"
  };
  return map[value] || value || "未设置";
}

function humanizeAuditEvent(value) {
  const map = {
    proposal_created: "提案已创建",
    proposal_approved: "提案已批准",
    proposal_rejected: "提案已拒绝",
    policy_applied: "策略已应用",
    policy_reverted: "策略已回滚",
    user_override_applied: "人工覆盖已生效",
    tailoring_generated: "岗位定制简历已生成",
    tailoring_review_saved: "定制确认结果已保存",
    prep_saved: "申请准备已保存",
    job_status_changed: "岗位状态已更新"
  };
  return map[value] || value || "审计事件";
}

function createJobViewModel({ job = {}, fitAssessment = null, nextAction = null } = {}) {
  const recommendationMeta = humanizeRecommendation(fitAssessment?.recommendation);
  const strategyMeta = humanizeStrategyDecision(fitAssessment?.strategyDecision || job.strategyDecision);
  const attentionFlags = [];

  if (job.policyOverride?.active) {
    attentionFlags.push({ key: "overridden", label: "人工覆盖中", tone: "offer" });
  }
  if ((fitAssessment?.strategyDecision || job.strategyDecision) === "avoid") {
    attentionFlags.push({ key: "avoid", label: "建议回避", tone: "archived" });
  } else if ((fitAssessment?.strategyDecision || job.strategyDecision) === "deprioritize") {
    attentionFlags.push({ key: "deprioritized", label: "降低优先级", tone: "evaluating" });
  } else if (job.priority === "high") {
    attentionFlags.push({ key: "boost", label: "策略加权", tone: "ready_to_apply" });
  }

  return {
    id: job.id,
    company: job.company || "未知公司",
    title: job.title || "未命名岗位",
    location: job.location || "地点未说明",
    sourceLabel: job.sourceLabel || job.sourcePlatform || job.source || "手动录入",
    displayStatus: getStatusDisplayLabel(job.status),
    statusTone: job.status || "",
    priorityLabel: humanizePriority(job.priority),
    recommendationLabel: recommendationMeta.label,
    recommendationTone: recommendationMeta.tone,
    strategyLabel: strategyMeta.label,
    strategyHelper: strategyMeta.helper,
    fitScore: fitAssessment?.fitScore ?? job.fitScore ?? null,
    attentionFlags,
    nextActionSummary:
      nextAction?.title ||
      fitAssessment?.suggestedAction ||
      job.nextActionSummary ||
      "当前没有明确的下一步建议。",
    updatedAtText: job.updatedAt ? new Date(job.updatedAt).toLocaleString() : "暂无更新时间",
    overrideSummary: job.policyOverride?.active
      ? `${humanizeOverride(job.policyOverride.action)}${job.policyOverride.reason ? ` · ${job.policyOverride.reason}` : ""}`
      : "",
    raw: job
  };
}

function createProposalViewModel(proposal = {}) {
  const statusMeta = humanizeProposalStatus(proposal.status);
  return {
    id: proposal.id,
    statusLabel: statusMeta.label,
    statusTone: statusMeta.tone,
    triggerLabel: humanizeTriggerType(proposal.triggerType),
    reasonText: proposal.reasonSummary || "暂无提案原因说明。",
    diffSummaryText: (proposal.diffSummary || []).slice(0, 2).join(" ") || "暂无策略变更摘要。",
    createdAtText: proposal.createdAt ? new Date(proposal.createdAt).toLocaleString() : "暂无",
    reviewerNoteText: proposal.reviewerNote || "暂无审核备注。",
    isActionable: proposal.status === "pending",
    oldPolicySnapshot: proposal.oldPolicySnapshot || {},
    proposedPolicySnapshot: proposal.proposedPolicySnapshot || {},
    diffSummary: proposal.diffSummary || [],
    triggerSourceId: proposal.triggerSourceId || "未提供",
    raw: proposal
  };
}

function createPolicyViewModel(policy = {}) {
  return {
    version: formatPolicyVersion(policy),
    focusModeLabel: humanizeFocusMode(policy.focusMode),
    riskToleranceLabel: humanizeRiskTolerance(policy.riskTolerance),
    preferredRolesSummary: (policy.preferredRoles || []).join(", ") || "还在学习中",
    riskyRolesSummary: (policy.riskyRoles || []).join(", ") || "暂无",
    shortSummaryText: policy.policySummary || "当前暂无可展示的全局策略摘要。",
    preferredRolesCount: (policy.preferredRoles || []).length,
    riskyRolesCount: (policy.riskyRoles || []).length,
    lastUpdatedText: policy.lastUpdatedAt ? new Date(policy.lastUpdatedAt).toLocaleString() : "暂无",
    raw: policy
  };
}

function createAuditEventViewModel(event = {}) {
  return {
    id: event.id,
    eventLabel: humanizeAuditEvent(event.eventType || event.type || event.action),
    timeText: event.timestamp || event.createdAt ? new Date(event.timestamp || event.createdAt).toLocaleString() : "暂无",
    actorLabel: event.actor || event.agentName || "系统",
    summaryText: event.summary || "暂无可展示的审计摘要。",
    relatedProposalId: event.relatedProposalId || event.policyProposalId || "",
    raw: event
  };
}

function createPrepViewModel({ prep = null, fitAssessment = null } = {}) {
  const checklist = prep?.checklist || [];
  const completedCount = checklist.filter((item) => item.completed).length;
  const isReady = completedCount >= 3;
  const usedBullets = prep?.resumeTailoring?.usedBullets || prep?.resumeTailoring?.rewriteBullets || [];
  const unusedBullets = prep?.resumeTailoring?.unusedBullets || [];
  return {
    completionStatus: isReady ? "complete" : "in_progress",
    readinessLabel: isReady ? "可进入投递" : "准备中",
    checklistProgress: `${completedCount}/${checklist.length}`,
    warningText: isReady
      ? ""
      : "请先完成简历、自我介绍和问答草稿三项核心清单，再标记准备完成。",
    riskHint:
      fitAssessment?.strategyDecision === "cautious_proceed"
        ? `建议谨慎推进：${(fitAssessment.riskFlags || []).slice(0, 2).join(" / ") || "请优先核对关键风险"}`
        : "",
    usedBullets,
    unusedBullets,
    completedCount,
    checklistCount: checklist.length,
    raw: prep
  };
}

function getFitLevel(fitAssessment = null) {
  if (!fitAssessment) return "unknown";
  if (fitAssessment.recommendation === "apply" || Number(fitAssessment.fitScore || 0) >= 75) return "high_fit";
  if (fitAssessment.recommendation === "cautious" || Number(fitAssessment.fitScore || 0) >= 50) return "medium_fit";
  return "low_fit";
}

function createFitToTailoringGuidance(fitAssessment = null) {
  const fitLevel = getFitLevel(fitAssessment);
  const map = {
    high_fit: {
      tone: "success",
      title: "建议立即进入岗位定制工作区",
      description: "这条岗位与当前背景较匹配，建议直接开始定制简历，把最相关的经历前置并尽快进入申请准备。"
    },
    medium_fit: {
      tone: "warning",
      title: "建议先优化 2-3 条关键经历，再决定是否继续",
      description: "这条岗位有一定潜力，但需要更谨慎地选择与强化关键经历。先完成最重要的几条改写，再判断是否投入更多时间。"
    },
    low_fit: {
      tone: "archived",
      title: "建议暂不投入时间，可保留或手动覆盖",
      description: "当前匹配度较低，系统不建议优先投入精力。你仍然可以进入工作区手动覆盖判断，但更建议先处理更强机会。"
    },
    unknown: {
      tone: "",
      title: "请先完成岗位评估，再决定是否进入定制工作区",
      description: "系统还没有形成明确判断。先完成 Fit Evaluation，再决定是否值得围绕这个岗位继续优化简历。"
    }
  };
  return {
    fitLevel,
    ...(map[fitLevel] || map.unknown)
  };
}

function createResumeViewModel(resumeDocument = null) {
  const statusMap = {
    parse_success: "已完成解析",
    parse_partial: "部分解析",
    parse_failed: "解析失败",
    parsed: "已完成解析",
    partial: "部分解析",
    failed: "解析失败",
    missing: "未上传"
  };
  const qualityLabelMap = {
    high: "高",
    medium: "中",
    low: "低"
  };
  const extractionMethodMap = {
    "mammoth_docx": "DOCX 解析",
    "pdf-parse": "PDF 解析",
    "pdfjs-dist": "PDF 回退解析",
    "fallback_text": "低质量文本回退",
    "ocr_pending": "待 OCR 处理",
    "service_failed": "解析服务失败"
  };
  const looksLikePdfGarbage = (value) => /%PDF-|endobj|xref|trailer|\/Type\s*\/Catalog|<x:xmpmeta|<rdf:RDF/i.test(String(value || ""));
  const structuredProfile = resumeDocument?.structuredProfile || resumeDocument?.structured || {};
  const extractionMethod = resumeDocument?.extractionMethod || "未解析";
  const isFallbackText = extractionMethod === "fallback_text";
  const summaryCandidate = structuredProfile.summary || resumeDocument?.summary || "";
  const fallbackSummaryCandidate = String(resumeDocument?.summary || resumeDocument?.cleanedText || "");
  const safeSummary =
    isFallbackText || looksLikePdfGarbage(summaryCandidate)
      ? (looksLikePdfGarbage(fallbackSummaryCandidate)
          ? "自动解析质量不足，建议上传 DOCX 或手动补充。"
          : fallbackSummaryCandidate.slice(0, 200) || "自动解析质量不足，建议上传 DOCX 或手动补充。")
      : summaryCandidate;
  const safeCleanedTextPreview = looksLikePdfGarbage(resumeDocument?.cleanedText)
    ? ""
    : String(resumeDocument?.cleanedText || "").slice(0, 600);
  return {
    exists: Boolean(resumeDocument),
    id: resumeDocument?.id || "",
    fileName: resumeDocument?.fileName || "未上传原始简历",
    parseStatusCode: resumeDocument?.parseStatus || resumeDocument?.status || "missing",
    statusLabel: statusMap[resumeDocument?.parseStatus || resumeDocument?.status] || "未上传",
    uploadedAtText: formatDateTime(resumeDocument?.updatedAt || resumeDocument?.createdAt || ""),
    extractionMethod,
    extractionMethodLabel: extractionMethodMap[extractionMethod] || extractionMethod,
    parseQualityLabel: qualityLabelMap[resumeDocument?.parseQuality?.label] || "未知",
    parseQualityScore: Number(resumeDocument?.parseQuality?.score || 0),
    parseWarning:
      resumeDocument?.parseWarning ||
      (isFallbackText ? "自动解析质量不足，建议上传 DOCX 或手动补充关键信息。" : ""),
    cleanedTextLength: String((resumeDocument?.cleanedText || "").length),
    summary:
      safeSummary ||
      "上传 PDF 或 DOCX 后，系统会提取简历文本并为后续岗位定制申请准备提供真实素材。",
    skills: structuredProfile.skills || [],
    highlights: structuredProfile.highlights || structuredProfile.achievements || [],
    experience: structuredProfile.experience || [],
    education: structuredProfile.education || [],
    cleanedTextPreview: safeCleanedTextPreview,
    isFallbackText
  };
}

function humanizeTailoringDecisionStatus(value) {
  const map = {
    pending: "待确认",
    accepted: "已接受",
    rejected: "已拒绝"
  };
  return map[value] || value || "待确认";
}

function humanizeDiffType(value) {
  const map = {
    modified: "已修改",
    added: "已新增",
    deleted: "已删除"
  };
  return map[value] || value || "有变更";
}

function createTailoringBulletViewModel(item = {}, index = 0) {
  return {
    bulletId: item.bulletId || `tailored_bullet_${index + 1}`,
    before: item.before || item.source || "",
    suggestion: item.suggestion || item.after || item.rewritten || "",
    status: item.status || "pending",
    reason: item.reason || "系统认为这条经历与 JD 更相关，因此建议强化。",
    jdRequirement: item.jdRequirement || "",
    type: item.type || "modified"
  };
}

function getTailoringAcceptedBullets(tailoringOutput = null) {
  return (tailoringOutput?.rewrittenBullets || []).filter((item) => item.status === "accepted");
}

function setButtonPending(button, pending, loadingLabel = "处理中...") {
  if (!button) return;
  if (pending) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add("is-pending");
    button.setAttribute("aria-busy", "true");
    button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${escapeHtml(loadingLabel)}</span>`;
    return;
  }
  button.disabled = false;
  button.classList.remove("is-pending");
  button.removeAttribute("aria-busy");
  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
  }
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function priorityWeight(priority) {
  return { high: 3, medium: 2, low: 1 }[priority] || 0;
}

function getStatusActionLabel(status) {
  const labels = {
    evaluating: "开始评估",
    to_prepare: "进入准备",
    ready_to_apply: "标记准备完成",
    applied: "标记已投递",
    follow_up: "进入跟进",
    interviewing: "进入面试中",
    rejected: "标记拒绝",
    offer: "标记录用",
    archived: "归档"
  };
  return labels[status] || status;
}

function humanizeImportPath(value) {
  const map = {
    jd_fetcher_service: "浏览器抓取服务",
    fallback_importer: "回退导入器"
  };
  return map[value] || value || "回退导入器";
}

function humanizeExtractor(value) {
  const map = {
    playwright: "浏览器抽取",
    json_ld: "结构化元数据抽取",
    html_fallback: "网页文本回退抽取",
    manual_fallback: "手动回退草稿"
  };
  return map[value] || value || "手动回退草稿";
}

function localizeDisplayContent(value, kind = "generic") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/[\u4e00-\u9fff]/.test(text)) return text;

  let result = text;
  const replacements = [
    [/\bcross-functional\b/gi, "跨团队"],
    [/\bstakeholders?\b/gi, "干系人"],
    [/\bexecution\b/gi, "执行"],
    [/\bstrategy\b/gi, "策略"],
    [/\bproduct\b/gi, "产品"],
    [/\bworkflow\b/gi, "工作流"],
    [/\broadmap\b/gi, "路线图"],
    [/\bprioritization\b/gi, "优先级判断"],
    [/\banalytics?\b/gi, "分析"],
    [/\bmetrics?\b/gi, "指标"],
    [/\boperations?\b/gi, "运营"],
    [/\bgrowth\b/gi, "增长"],
    [/\bmarket\b/gi, "市场"],
    [/\buser research\b/gi, "用户研究"],
    [/\bresearch\b/gi, "研究"],
    [/\bcollaborat(?:e|ion)\b/gi, "协作"],
    [/\bpartner(?:ing)?\b/gi, "协同"],
    [/\bdesign\b/gi, "设计"],
    [/\bdevelop\b/gi, "开发"],
    [/\bbuild\b/gi, "建设"],
    [/\blaunch\b/gi, "上线"],
    [/\bmanage\b/gi, "管理"],
    [/\blead\b/gi, "主导"],
    [/\bdrive\b/gi, "推动"],
    [/\bdefine\b/gi, "定义"],
    [/\bimprove\b/gi, "优化"],
    [/\bteam\b/gi, "团队"],
    [/\bengineering\b/gi, "工程"],
    [/\bbusiness\b/gi, "业务"],
    [/\bcommunication\b/gi, "沟通"],
    [/\brequirements?\b/gi, "要求"],
    [/\bresponsibilities\b/gi, "职责"],
    [/\bqualification[s]?\b/gi, "任职条件"],
    [/\bpreferred\b/gi, "加分项"],
    [/\brisk\b/gi, "风险"],
    [/\bsummary\b/gi, "摘要"]
  ];

  replacements.forEach(([pattern, replacement]) => {
    result = result.replace(pattern, replacement);
  });

  if (/[A-Za-z]{4,}/.test(result)) {
    const fallbackMap = {
      summary: "已提取岗位原文摘要，建议结合原始岗位描述进一步确认。",
      responsibility: "已提取一条岗位职责原文，建议在编辑时进一步确认细节。",
      requirement: "已提取一条任职要求原文，建议在编辑时进一步确认细节。",
      preferred: "已提取一条加分项原文，建议在编辑时进一步确认细节。",
      risk: "已提取一条风险提示原文，建议结合上下文进一步确认。",
      fit: "系统已提取评估原文内容，建议结合上下文确认。",
      prep: "系统已生成原文准备内容，建议在编辑区继续润色为中文。",
      timeline: "系统已记录一条英文活动内容，建议结合上下文确认。"
    };
    return fallbackMap[kind] || "已提取英文原始内容，建议结合上下文进一步确认。";
  }

  return result;
}

function buildPrepDraft(prep) {
  if (!prep) {
    return {
      targetKeywords: [],
      tailoredResumeBullets: "",
      tailoredSummary: "",
      whyMe: "",
      selfIntroShort: "",
      selfIntroMedium: "",
      qaDraft: "",
      coverNote: "",
      talkingPoints: "",
      outreachNote: "",
      checklist: [
        { key: "resume_reviewed", label: "简历改写已确认", completed: false },
        { key: "intro_ready", label: "自我介绍已确认", completed: false },
        { key: "qa_ready", label: "问答草稿已确认", completed: false },
        { key: "talking_points_ready", label: "面试要点已确认", completed: false },
        { key: "submit_ready", label: "投递路径已确认", completed: false }
      ],
      contentWithSources: []
    };
  }

  return {
    targetKeywords: prep.resumeTailoring?.targetKeywords || [],
    tailoredResumeBullets: (prep.resumeTailoring?.rewriteBullets || [])
      .map((item) => item.rewritten)
      .join("\n"),
    tailoredSummary: prep.tailoredSummary || "",
    whyMe: prep.whyMe || "",
    selfIntroShort: prep.selfIntro?.short || "",
    selfIntroMedium: prep.selfIntro?.medium || "",
    qaDraft: (prep.qaDraft || [])
      .map((item) => `${item.question} :: ${item.draftAnswer}`)
      .join("\n"),
    coverNote: prep.coverNote || "",
    talkingPoints: (prep.talkingPoints || []).join("\n"),
    outreachNote: prep.outreachNote || "",
    checklist: prep.checklist || [],
    contentWithSources: prep.contentWithSources || []
  };
}

function renderLoginScreen(message = "", errorMessage = "", users = []) {
  setActiveNav("");
  title.textContent = "登录";
  subtitle.textContent = "选择一个测试身份，进入当前用户自己的工作台。";
  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    <div class="card">
      <div class="section-head">
        <div>
          <div class="eyebrow">身份验证</div>
          <h3>进入工作台</h3>
        </div>
      </div>
      <form id="login-form" class="stack">
        <label>邮箱或用户名
          <input name="login" placeholder="alex@example.com / taylor@example.com" />
        </label>
        <div class="toolbar">
          <button class="button primary" type="submit">进入系统</button>
        </div>
      </form>
      <div class="stack" style="margin-top:16px;">
        ${
          users.length
            ? users
                .map(
                  (user) => `
                    <button class="button" type="button" data-dev-login="${escapeHtml(user.email || user.username || user.id)}">
                      使用 ${escapeHtml(user.email || user.username || user.id)}
                    </button>
                  `
                )
                .join("")
            : `<div class="empty">当前没有可用的测试用户。</div>`
        }
      </div>
    </div>
  `;

  const submitLogin = async (login) => {
    try {
      const button = document.querySelector('#login-form button[type="submit"]');
      setButtonPending(button, true, "登录中...");
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ login })
      });
      await fetchAuthSession();
      window.location.hash = "#/dashboard";
      await renderDashboard("登录成功。");
    } catch (error) {
      renderLoginScreen("", error.message, users);
    }
  };

  document.getElementById("login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    await submitLogin(String(formData.get("login") || ""));
  });

  document.querySelectorAll("[data-dev-login]").forEach((button) => {
    button.addEventListener("click", async () => {
      await submitLogin(button.getAttribute("data-dev-login"));
    });
  });
}

async function renderUnauthenticatedWorkspace(errorMessage = "") {
  app.innerHTML = `
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    <div class="panel">
      <h3>请先登录</h3>
      <p>系统需要先建立工作台会话，才能加载你的个人数据。</p>
    </div>
  `;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildPolicyDelta(label, oldValues, newValues) {
  const previous = ensureArray(oldValues);
  const next = ensureArray(newValues);
  const added = next.filter((item) => !previous.includes(item));
  const removed = previous.filter((item) => !next.includes(item));

  if (!added.length && !removed.length) {
    return "";
  }

  return `
    <div class="panel">
      <strong>${escapeHtml(label)}</strong>
      ${added.length ? `<div class="muted">新增：${escapeHtml(added.join(", "))}</div>` : ""}
      ${removed.length ? `<div class="muted">移除：${escapeHtml(removed.join(", "))}</div>` : ""}
    </div>
  `;
}

async function renderDashboard(message = "", errorMessage = "") {
  setActiveNav("#/dashboard");
  title.textContent = "工作台";
  subtitle.textContent = "从待办、状态和优先级快速查看当前求职推进情况。";
  renderLoadingState("加载工作台", "正在汇总岗位队列、策略信号与最近活动...");
  const data = await api("/api/dashboard/summary");
  const policyVm = createPolicyViewModel(data.globalPolicy);
  const proposalVms = (data.policyProposals || []).map((proposal) => createProposalViewModel(proposal));
  const auditVms = (data.policyAuditLogs || []).map((entry) => createAuditEventViewModel(entry));
  const recentJobVms = (data.recentJobs || []).map((job) =>
    createJobViewModel({
      job,
      fitAssessment: {
        fitScore: job.fitScore,
        recommendation: job.recommendation,
        strategyDecision: job.strategyDecision
      }
    })
  );

  const statusCards = Object.entries(data.statusCounts)
    .map(
      ([key, value]) => `
        <div class="metric-card">
          <div class="metric-label">${escapeHtml(getStatusDisplayLabel(key))}</div>
          <div class="metric">${value}</div>
          <div class="metric-support">岗位状态分布</div>
        </div>
      `
    )
    .join("");
  const metricsCards = [
    { label: "岗位总数", value: data.metrics.totalJobs },
    { label: "已投递", value: data.metrics.appliedJobs },
    { label: "进入面试", value: data.metrics.interviewJobs },
    { label: "录用", value: data.metrics.offers },
    { label: "转化率", value: formatPercent(data.metrics.conversionRate) },
    { label: "准备完成率", value: formatPercent(data.metrics.prepCompletionRate) }
  ]
    .map(
      (metric) => `
        <div class="metric-card">
          <div class="metric-label">${escapeHtml(metric.label)}</div>
          <div class="metric">${escapeHtml(metric.value)}</div>
          <div class="metric-support">实时指标</div>
        </div>
      `
    )
    .join("");

  const priorityRoles =
    data.globalPolicy?.preferredRoles ||
    data.globalPolicy?.targetRolesPriority ||
    data.strategyInsights?.policySignals?.targetRolesPriority ||
    [];
  const strategyRecommendations = (data.strategyInsights?.recommendations || []).slice(0, 2);
  const pendingProposals = (data.policyProposals || []).filter((proposal) => proposal.status === "pending").length;
  const primaryTodo = data.todoTasks[0];
  const staleJob = data.staleJobs[0];

  const todoList =
    data.todoTasks.length === 0
      ? `<div class="empty">当前没有待办任务。</div>`
      : `<div class="stack">${data.todoTasks
          .slice(0, 4)
          .map((task) => `
              <div class="panel">
                <strong>${escapeHtml(task.title)}</strong>
                <div class="muted">${escapeHtml(task.note || "")}</div>
              </div>
            `)
          .join("")}</div>`;

  const recentJobs =
    recentJobVms.length === 0
      ? `<div class="empty">暂无岗位。</div>`
      : `<table class="table">
          <thead><tr><th>公司</th><th>岗位</th><th>状态</th><th>匹配度</th><th>更新时间</th><th></th></tr></thead>
          <tbody>
            ${recentJobVms
              .map(
                (jobVm) => `
                  <tr>
                    <td>${escapeHtml(jobVm.company)}</td>
                    <td>${escapeHtml(jobVm.title)}</td>
                    <td>${statusBadge(jobVm.raw.status)}</td>
                    <td>${escapeHtml(jobVm.fitScore ?? "-")}</td>
                    <td>${escapeHtml(jobVm.updatedAtText)}</td>
                    <td><a class="button" href="#/jobs/${jobVm.id}">查看</a></td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>`;

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    <div class="dashboard-shell">
      <section class="dashboard-hero">
        <div class="hero-copy">
            <div class="eyebrow">求职工作台</div>
          <h3 class="hero-title">让今天的求职推进更清楚，而不是更分散。</h3>
          <p class="hero-subtitle">这个工作台把待办、策略和最近岗位收束到同一屏，让你先处理最该推进的下一步。</p>
          <div class="hero-meta">
            ${statusBadge(data.strategyInsights?.strategyHealth || "forming")}
            <span class="status">聚焦模式 · ${escapeHtml(policyVm.focusModeLabel)}</span>
            <span class="status">风险偏好 · ${escapeHtml(policyVm.riskToleranceLabel)}</span>
            <span class="status">策略版本 · ${escapeHtml(policyVm.version)}</span>
          </div>
          <div class="toolbar">
            <a class="button primary" href="#/jobs/new">新增岗位</a>
            <a class="button" href="#/jobs">查看岗位</a>
            <a class="button" href="#/profile">我的画像</a>
          </div>
        </div>
        <div class="stack">
          <div class="card surface-dark">
            <div class="eyebrow">今天优先处理</div>
            <h4>${escapeHtml(primaryTodo?.title || "当前没有紧急待办")}</h4>
            <p class="muted">${escapeHtml(primaryTodo?.note || "你可以利用这段空档补画像、查看策略或新增岗位。")}</p>
          </div>
          <div class="split-metrics">
            <div class="metric-card">
              <div class="metric-label">待审核提案</div>
              <div class="metric">${pendingProposals}</div>
              <div class="metric-support">策略治理</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">当前优先方向</div>
              <div class="metric">${escapeHtml(priorityRoles.slice(0, 2).join(", ") || "学习中")}</div>
              <div class="metric-support">全局策略信号</div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div class="section-head">
          <div>
            <div class="eyebrow">指标概览</div>
            <h3>当前推进快照</h3>
          </div>
        </div>
        <div class="grid cards-3">${metricsCards}</div>
      </section>

      <section>
        <div class="section-head">
          <div>
            <div class="eyebrow">今日工作区</div>
            <h3>今天最该做什么</h3>
          </div>
        </div>
        <div class="workbench-grid">
          <div class="stack">
            <div class="card">
              <div class="section-head">
                <div>
                  <div class="eyebrow">待办队列</div>
                  <h3>当前推进中的事项</h3>
                </div>
              </div>
              ${todoList}
            </div>
            <div class="card">
              <div class="section-head">
                <div>
                  <div class="eyebrow">需要跟进</div>
                  <h3>不要卡住的岗位</h3>
                </div>
              </div>
              ${
                data.staleJobs.length
                  ? `<div class="stack">${data.staleJobs
                      .slice(0, 4)
                      .map(
                        (job) => `
                          <div class="panel">
                            <strong>${escapeHtml(job.company)} · ${escapeHtml(job.title)}</strong>
                            <div class="inline-meta">
                              ${statusBadge(job.status)}
                              <span class="muted">${new Date(job.updatedAt).toLocaleString()}</span>
                            </div>
                          </div>
                        `
                      )
                      .join("")}</div>`
                  : `<div class="empty">当前没有卡住的关键岗位。</div>`
              }
              ${
                staleJob
                  ? `<div class="notice warning">建议优先处理 ${escapeHtml(staleJob.company)} / ${escapeHtml(staleJob.title)}，它已经在队列里停留较久。</div>`
                  : ""
              }
            </div>
          </div>

          <div class="stack">
            <div class="card">
              <div class="section-head">
                <div>
                  <div class="eyebrow">全局策略</div>
                  <h3>当前聚焦方向</h3>
                </div>
              </div>
              ${
                strategyRecommendations.length
                  ? `<div class="stack">${strategyRecommendations
                      .map((item) => `<div class="panel"><strong>建议</strong><div class="muted">${escapeHtml(item)}</div></div>`)
                      .join("")}</div>`
                  : `<div class="empty">随着更多结果回流，这里会出现更明确的策略建议。</div>`
              }
              <div class="panel">
                <strong>策略摘要</strong>
                <div class="muted">${escapeHtml(data.globalPolicy?.policySummary || "系统仍在学习更合适的岗位推进策略。")}</div>
                <div class="muted">集中度：${escapeHtml(data.strategyInsights?.concentrationScore || "中")}</div>
                <div class="muted">偏移情况：${escapeHtml(data.strategyInsights?.driftStatus || "基本对齐")}</div>
              </div>
              <div class="panel">
                <strong>优先 / 谨慎方向</strong>
                <div class="muted">优先：${escapeHtml((data.strategyInsights?.preferredRoles || []).join(", ") || "还在学习中")}</div>
                <div class="muted">减少：${escapeHtml((data.strategyInsights?.riskyRoles || []).join(", ") || "暂无")}</div>
              </div>
            </div>

            <div class="card">
              <div class="section-head">
                <div>
                  <div class="eyebrow">治理</div>
                  <h3>策略审阅</h3>
                </div>
              </div>
              <div class="panel">
                <strong>当前生效策略</strong>
              <div class="muted">版本：${escapeHtml(formatPolicyVersion(data.globalPolicy || {}))}</div>
                <div class="muted">${escapeHtml(policyVm.shortSummaryText)}</div>
                <div class="toolbar" style="margin-top:8px;">
                  <button class="button" id="policy-revert-btn">回滚当前策略</button>
                </div>
              </div>
              ${
                proposalVms.length
                  ? proposalVms
                      .slice(0, 3)
                      .map(
                        (proposalVm) => `
                          <div class="panel">
                            <strong>${escapeHtml(proposalVm.triggerLabel)}</strong>
                            <div class="inline-meta">
                              ${semanticBadge(proposalVm.statusLabel, proposalVm.statusTone)}
                              <span class="muted">${escapeHtml(proposalVm.createdAtText)}</span>
                            </div>
                            <div class="muted">${escapeHtml(proposalVm.reasonText)}</div>
                            <div class="muted">${escapeHtml(proposalVm.diffSummaryText)}</div>
                            <div class="toolbar" style="margin-top:8px;">
                              ${
                                proposalVm.isActionable
                                  ? `
                                    <button class="button" data-proposal-action="approve" data-proposal-id="${proposalVm.id}">批准</button>
                                    <button class="button" data-proposal-action="reject" data-proposal-id="${proposalVm.id}">拒绝</button>
                                  `
                                  : `<span class="muted">当前状态：${escapeHtml(proposalVm.statusLabel)}</span>`
                              }
                            </div>
                          </div>
                        `
                      )
                      .join("")
                  : `<div class="empty">当前没有待审核的策略提案。</div>`
              }
              <div class="panel">
                <strong>最近审计记录</strong>
                ${
                  auditVms.length
                    ? auditVms
                        .slice(0, 3)
                        .map((entryVm) => `<div class="muted">${escapeHtml(entryVm.eventLabel)} · ${escapeHtml(entryVm.summaryText)}</div>`)
                        .join("")
                    : '<div class="muted">暂无策略审计记录。</div>'
                }
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div class="section-head">
          <div>
            <div class="eyebrow">最近岗位</div>
            <h3>最近推进动态</h3>
          </div>
        </div>
        <div class="card table-shell">${recentJobs}</div>
      </section>

      <section>
        <div class="section-head">
          <div>
            <div class="eyebrow">状态分布</div>
            <h3>岗位队列分布</h3>
          </div>
        </div>
        <div class="grid cards-3">${statusCards}</div>
      </section>
    </div>
  `;

  const revertBtn = document.getElementById("policy-revert-btn");
  if (revertBtn) {
    revertBtn.addEventListener("click", async () => {
      if (!window.confirm("确认回滚当前生效策略吗？")) {
        return;
      }
      try {
        setButtonPending(revertBtn, true, "回滚中...");
        await api("/api/policy/revert", { method: "POST" });
        renderDashboard("策略已回滚。");
      } catch (error) {
        setButtonPending(revertBtn, false);
        renderDashboard("", error.message);
      }
    });
  }

  document.querySelectorAll("[data-proposal-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const proposalId = button.getAttribute("data-proposal-id");
      const action = button.getAttribute("data-proposal-action");
      const confirmed = window.confirm(`${action === "approve" ? "确认批准这条策略提案？" : "确认拒绝这条策略提案？"}`);
      if (!confirmed) return;
      const reviewerNote = window.prompt("审核备注（可选）", "") || "";
      try {
        setButtonPending(button, true, action === "approve" ? "批准中..." : "拒绝中...");
        await api(`/api/policy/proposals/${proposalId}/${action}`, {
          method: "POST",
          body: JSON.stringify({ reviewerNote })
        });
        renderDashboard(`策略提案已${action === "approve" ? "批准" : "拒绝"}。`);
      } catch (error) {
        setButtonPending(button, false);
        renderDashboard("", error.message);
      }
    });
  });
}

async function renderGovernance(message = "", errorMessage = "") {
  setActiveNav("#/governance");
  title.textContent = "策略治理";
  subtitle.textContent = "查看当前策略、审核提案，并追踪治理历史。";
  renderLoadingState("加载策略治理", "正在刷新策略、提案与审计记录...");

  const [currentData, proposalData, historyData] = await Promise.all([
    api("/api/policy/current"),
    api("/api/policy/proposals"),
    api("/api/policy/history")
  ]);

  const policyVm = createPolicyViewModel(currentData.policy || {});
  const auditVms = (currentData.auditLogs || proposalData.auditLogs || []).map((entry) => createAuditEventViewModel(entry));
  const proposalVms = [...(proposalData.proposals || []).map((proposal) => createProposalViewModel(proposal))].sort(
    (a, b) => new Date(b.raw.createdAt) - new Date(a.raw.createdAt)
  );
  const pendingProposals = proposalVms.filter((proposal) => proposal.raw.status === "pending");
  const reviewProposals = pendingProposals.length ? pendingProposals : proposalVms;

  if (!selectedPolicyProposalId || !reviewProposals.some((proposal) => proposal.id === selectedPolicyProposalId)) {
    selectedPolicyProposalId = reviewProposals[0]?.id || proposalVms[0]?.id || null;
  }

  const selectedProposal =
    proposalVms.find((proposal) => proposal.id === selectedPolicyProposalId) ||
    proposalVms[0] ||
    null;
  const previousPolicy = createPolicyViewModel(selectedProposal?.oldPolicySnapshot || {});
  const proposedPolicy = createPolicyViewModel(selectedProposal?.proposedPolicySnapshot || {});
  const changedFocusMode = previousPolicy.focusModeLabel !== proposedPolicy.focusModeLabel;
  const changedRiskTolerance = previousPolicy.riskToleranceLabel !== proposedPolicy.riskToleranceLabel;

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    <div class="governance-shell">
      <section class="governance-hero">
        <div class="hero-copy">
          <div class="eyebrow">当前策略</div>
          <h3 class="hero-title">${escapeHtml(policyVm.version)}</h3>
          <p class="hero-subtitle">${escapeHtml(policyVm.shortSummaryText)}</p>
          <div class="hero-meta">
            <span class="status">聚焦模式 · ${escapeHtml(policyVm.focusModeLabel)}</span>
            <span class="status">风险偏好 · ${escapeHtml(policyVm.riskToleranceLabel)}</span>
            <span class="status">优先方向 · ${escapeHtml(policyVm.preferredRolesCount)}</span>
            <span class="status">谨慎方向 · ${escapeHtml(policyVm.riskyRolesCount)}</span>
          </div>
          <div class="toolbar">
            <button class="button" id="policy-revert-btn">回滚当前策略</button>
          </div>
        </div>
        <div class="stack">
          <div class="panel">
            <strong>优先 / 谨慎方向</strong>
            <div class="muted">优先：${escapeHtml(policyVm.preferredRolesSummary)}</div>
            <div class="muted">减少：${escapeHtml(policyVm.riskyRolesSummary)}</div>
          </div>
          <div class="panel">
            <strong>治理概览</strong>
            <div class="muted">待审核提案：${pendingProposals.length}</div>
            <div class="muted">最近更新：${escapeHtml(policyVm.lastUpdatedText)}</div>
            <div class="muted">最近策略演化：${historyData.history?.length || 0}</div>
          </div>
        </div>
      </section>

      <section class="governance-main">
        <div class="card">
          <div class="section-head">
            <div>
              <div class="eyebrow">待审核提案</div>
              <h3>审核队列</h3>
            </div>
            <div class="muted">${pendingProposals.length ? `当前有 ${pendingProposals.length} 条待审核提案` : "当前没有待审核提案，正在展示最近变更"}</div>
          </div>
          ${
            proposalVms.length
              ? `<div class="proposal-list">${reviewProposals
                  .map(
                    (proposalVm) => `
                      <div class="proposal-item ${proposalVm.id === selectedPolicyProposalId ? "selected" : ""}" data-select-proposal="${proposalVm.id}" tabindex="0" role="button" aria-label="打开提案 ${escapeHtml(proposalVm.id)}">
                        <div class="proposal-topline">
                          <strong>${escapeHtml(proposalVm.triggerLabel)}</strong>
                          ${semanticBadge(proposalVm.statusLabel, proposalVm.statusTone)}
                        </div>
                        <div class="muted">${escapeHtml(proposalVm.createdAtText)}</div>
                        <div>${escapeHtml(proposalVm.reasonText)}</div>
                        <div class="muted">${escapeHtml(proposalVm.diffSummaryText)}</div>
                        <div class="toolbar proposal-actions">
                          <span class="text-link">查看变更</span>
                          ${
                            proposalVm.isActionable
                              ? `
                                <button type="button" class="button primary" data-proposal-action="approve" data-proposal-id="${proposalVm.id}">批准</button>
                                <button type="button" class="button" data-proposal-action="reject" data-proposal-id="${proposalVm.id}">拒绝</button>
                              `
                              : `<span class="muted">当前状态：${escapeHtml(proposalVm.statusLabel)}</span>`
                          }
                        </div>
                      </div>
                    `
                  )
                  .join("")}</div>`
              : `<div class="empty">当前还没有策略提案记录。</div>`
          }
        </div>

        <div class="card">
          <div class="section-head">
            <div>
              <div class="eyebrow">策略差异</div>
              <h3>变更解释</h3>
            </div>
            ${selectedProposal ? `<div class="muted">当前查看：${escapeHtml(selectedProposal.id)}</div>` : ""}
          </div>
          ${
            selectedProposal
              ? `
                <div class="panel">
                  <strong>${escapeHtml(selectedProposal.reasonText || "策略变更提案")}</strong>
                  <div class="muted">触发来源：${escapeHtml(selectedProposal.triggerLabel || "人工审核")} · 关联对象：${escapeHtml(selectedProposal.triggerSourceId || "未提供")}</div>
                  <div class="muted">${escapeHtml(selectedProposal.reviewerNoteText)}</div>
                </div>
                <div class="info-grid">
                  <div class="panel">
                    <strong>变更前策略</strong>
                    <div class="muted">${escapeHtml(previousPolicy.version)}</div>
                    <div class="muted">聚焦模式：${escapeHtml(previousPolicy.focusModeLabel || "未设置")}</div>
                    <div class="muted">风险偏好：${escapeHtml(previousPolicy.riskToleranceLabel || "未设置")}</div>
                  </div>
                  <div class="panel">
                    <strong>提议后的策略</strong>
                    <div class="muted">${escapeHtml(proposedPolicy.version)}</div>
                    <div class="muted">聚焦模式：${escapeHtml(proposedPolicy.focusModeLabel || "未设置")}</div>
                    <div class="muted">风险偏好：${escapeHtml(proposedPolicy.riskToleranceLabel || "未设置")}</div>
                  </div>
                </div>
                <div class="stack">
                  ${buildPolicyDelta("优先岗位方向", previousPolicy.raw.preferredRoles, proposedPolicy.raw.preferredRoles)}
                  ${buildPolicyDelta("高风险岗位方向", previousPolicy.raw.riskyRoles, proposedPolicy.raw.riskyRoles)}
                  ${buildPolicyDelta("成功模式", previousPolicy.raw.successPatterns, proposedPolicy.raw.successPatterns)}
                  ${buildPolicyDelta("失败模式", previousPolicy.raw.failurePatterns, proposedPolicy.raw.failurePatterns)}
                  ${buildPolicyDelta("回避模式", previousPolicy.raw.avoidPatterns, proposedPolicy.raw.avoidPatterns)}
                  ${
                    changedFocusMode
                      ? `<div class="panel"><strong>聚焦模式</strong><div class="muted">已从 ${escapeHtml(previousPolicy.focusModeLabel || "未设置")} 调整为 ${escapeHtml(proposedPolicy.focusModeLabel || "未设置")}。</div></div>`
                      : ""
                  }
                  ${
                    changedRiskTolerance
                      ? `<div class="panel"><strong>风险偏好</strong><div class="muted">已从 ${escapeHtml(previousPolicy.riskToleranceLabel || "未设置")} 调整为 ${escapeHtml(proposedPolicy.riskToleranceLabel || "未设置")}。</div></div>`
                      : ""
                  }
                  <div class="panel">
                    <strong>为什么会提出这次变更</strong>
                    ${(selectedProposal.diffSummary || [])
                      .map((item) => `<div class="muted">${escapeHtml(item)}</div>`)
                      .join("") || '<div class="muted">当前还没有可读的差异解释。</div>'}
                  </div>
                </div>
              `
              : `<div class="empty">请选择一条策略提案查看变更和原因。</div>`
          }
        </div>
      </section>

      <section class="card">
        <div class="section-head">
          <div>
            <div class="eyebrow">审计历史</div>
            <h3>治理时间线</h3>
          </div>
          <div class="muted">最近的策略操作与人工覆盖记录</div>
        </div>
        ${
          auditVms.length
            ? `<div class="timeline">${auditVms
                .slice()
                .sort((a, b) => new Date(b.raw.timestamp || b.raw.createdAt) - new Date(a.raw.timestamp || a.raw.createdAt))
                .map(
                  (entryVm) => `
                    <div class="timeline-item">
                      <div class="timeline-dot"></div>
                      <div class="timeline-content">
                        <div class="timeline-meta">
                          <strong>${escapeHtml(entryVm.eventLabel)}</strong>
                          <span class="muted">${escapeHtml(entryVm.timeText)}</span>
                        </div>
                        <div>${escapeHtml(entryVm.summaryText)}</div>
                        <div class="inline-meta">
                          <span class="muted">执行方 · ${escapeHtml(entryVm.actorLabel)}</span>
                          ${entryVm.relatedProposalId ? `<span class="muted">提案 · ${escapeHtml(entryVm.relatedProposalId)}</span>` : ""}
                        </div>
                      </div>
                    </div>
                  `
                )
                .join("")}</div>`
            : `<div class="empty">当前还没有审计历史。</div>`
        }
      </section>
    </div>
  `;

  const revertBtn = document.getElementById("policy-revert-btn");
  if (revertBtn) {
    revertBtn.addEventListener("click", async () => {
      const confirmed = window.confirm("确认将当前策略回滚到上一个版本吗？");
      if (!confirmed) return;
      try {
        setButtonPending(revertBtn, true, "回滚中...");
        await api("/api/policy/revert", { method: "POST" });
        renderGovernance("策略已回滚。");
      } catch (error) {
        setButtonPending(revertBtn, false);
        renderGovernance("", error.message);
      }
    });
  }

  document.querySelectorAll("[data-select-proposal]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const actionTarget = event.target.closest("[data-proposal-action]");
      if (actionTarget) {
        return;
      }
      selectedPolicyProposalId = button.getAttribute("data-select-proposal");
      renderGovernance(message, errorMessage);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectedPolicyProposalId = button.getAttribute("data-select-proposal");
      renderGovernance(message, errorMessage);
    });
  });

  document.querySelectorAll("[data-proposal-action]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const proposalId = button.getAttribute("data-proposal-id");
      const action = button.getAttribute("data-proposal-action");
      const confirmed = window.confirm(`${action === "approve" ? "确认批准这条策略提案？" : "确认拒绝这条策略提案？"}`);
      if (!confirmed) return;
      const reviewerNote = window.prompt("审核备注（可选）", "") || "";
      try {
        setButtonPending(button, true, action === "approve" ? "批准中..." : "拒绝中...");
        await api(`/api/policy/proposals/${proposalId}/${action}`, {
          method: "POST",
          body: JSON.stringify({ reviewerNote })
        });
        selectedPolicyProposalId = proposalId;
        renderGovernance(`策略提案已${action === "approve" ? "批准" : "拒绝"}。`);
      } catch (error) {
        setButtonPending(button, false);
        renderGovernance("", error.message);
      }
    });
  });
}

async function renderJobs(message = "") {
  setActiveNav("#/jobs");
  title.textContent = "岗位";
  subtitle.textContent = "集中查看岗位、匹配分、状态和更新时间。";
  renderLoadingState("加载岗位列表", "正在刷新岗位队列与最新评估结果...");
  const data = await api("/api/jobs");
  const jobs = [...data.jobs].sort(
    (a, b) => priorityWeight(b.priority) - priorityWeight(a.priority) || new Date(b.updatedAt) - new Date(a.updatedAt)
  );
  const activeJobs = jobs.filter((job) => job.status !== "archived").length;
  const boostedJobs = jobs.filter((job) => job.priority === "high" && job.strategyDecision !== "avoid").length;
  const deprioritizedJobs = jobs.filter((job) => job.strategyDecision === "deprioritize" || job.strategyDecision === "avoid").length;

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    <div class="jobs-shell">
      <section class="jobs-hero">
        <div class="hero-copy">
          <div class="eyebrow">岗位队列</div>
          <h3 class="hero-title">把岗位列表变成一个可扫描、可取舍的推进队列。</h3>
          <p class="hero-subtitle">先看最值得推进的岗位，再识别被策略加权、降级或建议回避的对象。</p>
          <div class="toolbar">
            <a class="button primary" href="#/jobs/new">新增岗位</a>
          </div>
        </div>
        <div class="split-metrics">
          <div class="metric-card">
            <div class="metric-label">活跃岗位</div>
            <div class="metric">${activeJobs}</div>
            <div class="metric-support">仍在队列中</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">策略加权</div>
            <div class="metric">${boostedJobs}</div>
            <div class="metric-support">优先推进岗位</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">已降优先级</div>
            <div class="metric">${deprioritizedJobs}</div>
            <div class="metric-support">需要谨慎处理</div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="section-head">
          <div>
            <div class="eyebrow">队列</div>
            <h3>按优先级排序的岗位列表</h3>
          </div>
          <div class="muted">按优先级和最近更新时间排序</div>
        </div>
        <div class="table-shell jobs-table-shell">
          <table class="table jobs-table">
            <thead>
              <tr>
                <th>岗位</th>
                <th>状态</th>
                <th>优先级</th>
                <th>匹配度</th>
                <th>推荐结论</th>
                <th>策略判断</th>
                <th>更新时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${jobs
                .map((job) => {
                  const fit = data.fitAssessments.find((item) => item.jobId === job.id);
                  const recommendation = humanizeRecommendation(fit?.recommendation);
                  const strategy = humanizeStrategyDecision(fit?.strategyDecision || job.strategyDecision);
                  const attentionBadge =
                    job.policyOverride?.active
                      ? '<span class="status offer">人工覆盖中</span>'
                      : job.strategyDecision === "avoid"
                        ? '<span class="status archived">建议回避</span>'
                        : job.strategyDecision === "deprioritize"
                          ? '<span class="status evaluating">降低优先级</span>'
                          : job.priority === "high"
                            ? '<span class="status ready_to_apply">策略加权</span>'
                            : "";

                  return `
                    <tr class="jobs-row">
                      <td>
                        <div class="job-primary">
                          <strong>${escapeHtml(job.company)}</strong>
                          <div>${escapeHtml(job.title)}</div>
                          <div class="inline-meta">
                            <span class="muted">${escapeHtml(job.location)}</span>
                            ${attentionBadge}
                          </div>
                        </div>
                      </td>
                      <td>${statusBadge(job.status)}</td>
                      <td><span class="status">${escapeHtml(humanizePriority(job.priority))}</span></td>
                      <td><strong>${fit ? fit.fitScore : "-"}</strong></td>
                      <td>${fit ? semanticBadge(recommendation.label, recommendation.tone) : '<span class="muted">等待评估</span>'}</td>
                      <td><span title="${escapeHtml(strategy.helper)}">${escapeHtml(strategy.label)}</span></td>
                      <td><span class="muted">${new Date(job.updatedAt).toLocaleString()}</span></td>
                      <td><a class="button" href="#/jobs/${job.id}">查看详情</a></td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

async function renderNewJob() {
  setActiveNav("#/jobs");
  title.textContent = "新增岗位";
  subtitle.textContent = "先导入或填写岗位草稿，再确认创建并自动进入评估。";
  app.innerHTML = `
    <div class="panel">
      <div class="draft-header">
        <div>
          <div class="eyebrow">岗位录入</div>
          <h3>从岗位描述文本或职位链接开始，先拿到一个可编辑草稿。</h3>
          <p class="muted">系统会尽量从职位链接提取结构化内容；如果失败，你仍然可以补字段或粘贴岗位描述继续创建。</p>
          <p class="muted">提示：评估结果会读取你的用户画像；如果你还没完善，先去 <a href="#/profile">个人画像</a> 更新会更准确。</p>
        </div>
      </div>
      <form id="new-job-form" class="stack">
        <div class="split">
          <label>公司<input name="company" /></label>
          <label>岗位名称<input name="title" /></label>
        </div>
        <div class="split">
          <label>地点<input name="location" /></label>
          <label>来源平台<input name="sourcePlatform" value="手动录入" /></label>
        </div>
        <label>职位链接<input name="jobUrl" /></label>
        <label>岗位描述原文<textarea name="rawJdText" placeholder="可直接粘贴岗位描述；如果内容不完整，也可以只填基础字段后继续。"></textarea></label>
        <div class="toolbar">
          <button class="button" type="button" id="import-job-url">从职位链接导入草稿</button>
          <button class="button primary" type="submit">确认创建并评估岗位</button>
        </div>
      </form>
      <div id="job-draft-preview"></div>
      <div id="page-feedback"></div>
    </div>
  `;

  const formElement = document.getElementById("new-job-form");
  const feedback = document.getElementById("page-feedback");
  const preview = document.getElementById("job-draft-preview");
  const importButton = document.getElementById("import-job-url");

  importButton.addEventListener("click", async () => {
    feedback.innerHTML = "";
    preview.innerHTML = "";
    try {
      setButtonPending(importButton, true, "导入中...");
      const formData = new FormData(formElement);
      const payload = Object.fromEntries(formData.entries());
      if (!String(payload.jobUrl || "").trim()) {
        throw new Error("请先输入职位链接。");
      }
      const data = await api("/api/jobs/import-url", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const draft = data.draft || {};
      const draftFields = ["company", "title", "location", "sourceLabel", "jobUrl", "rawJdText"];
      draftFields.forEach((field) => {
        const targetName = field === "sourceLabel" ? "sourcePlatform" : field;
        const input = formElement.elements.namedItem(targetName);
        if (input && draft[field] != null) {
          input.value = draft[field];
        }
      });
      preview.innerHTML = `
        <div class="draft-preview">
          <div class="draft-preview-head">
            <div>
              <div class="eyebrow">导入草稿</div>
              <h3>${escapeHtml(draft.title || "已导入岗位草稿")}</h3>
              <p class="muted">${escapeHtml(draft.company || "未知公司")} · ${escapeHtml(draft.location || "地点未说明")}</p>
            </div>
            <span class="status ${data.importer?.ok ? "ready_to_apply" : "evaluating"}">${escapeHtml(
              data.importPath === "jd_fetcher_service" ? "浏览器抓取成功" : data.importer?.ok ? "回退草稿已生成" : "回退草稿"
            )}</span>
          </div>
          <p class="muted">导入方式：${escapeHtml(humanizeImportPath(data.importPath || "fallback_importer"))} · 抽取策略：${escapeHtml(
            humanizeExtractor(data.extractor || draft.importMeta?.strategy || "manual_fallback")
          )} · 预览长度：${escapeHtml(
            draft.importMeta?.textLength || 0
          )} 字</p>
          ${data.warning ? `<p class="muted">提示：${escapeHtml(data.warning)}</p>` : ""}
          ${buildImportWarningsHtml(draft.importMeta?.warnings || [])}
          ${data.pipelinePreview?.length ? `<div style="margin-top:16px;">${renderPipelineStages(data.pipelinePreview)}</div>` : ""}
          <p class="muted">确认创建前，你可以继续修改上面的任意字段。</p>
        </div>
      `;
      feedback.innerHTML = renderNotice(
        data.importer?.ok ? "success" : "warning",
        data.importer?.ok
          ? data.importPath === "jd_fetcher_service"
            ? "浏览器抓取成功，请确认字段后再创建岗位。"
            : "已通过回退导入器生成草稿，请确认字段后再创建岗位。"
          : data.importer?.errorSummary || "职位链接导入未完全成功，已回退为可手动编辑草稿。"
      );
    } catch (error) {
      feedback.innerHTML = renderNotice("error", error.message);
    } finally {
      setButtonPending(importButton, false);
    }
  });

  formElement.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback.innerHTML = "";
    const submitButton = event.target.querySelector('button[type="submit"]');
    try {
      setButtonPending(submitButton, true, "正在创建并评估...");
      feedback.innerHTML = renderNotice("info", "正在创建岗位、写入系统并生成评估，请稍候…");
      const formData = new FormData(event.target);
      const payload = Object.fromEntries(formData.entries());
      payload.source = payload.jobUrl ? "url" : "manual";
      const data = await api("/api/jobs/ingest", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      window.location.hash = `#/jobs/${data.job.id}`;
    } catch (error) {
      setButtonPending(submitButton, false);
      feedback.innerHTML = renderNotice("error", error.message);
    }
  });
}

function renderStatusButtons(job, allowedNextStatuses, recommendedNextStatuses) {
  if (!allowedNextStatuses?.length) {
    return `<div class="empty">当前状态没有可继续推进的流转。</div>`;
  }

  const recommendedStatuses = Array.isArray(recommendedNextStatuses) ? recommendedNextStatuses : [];

  return `
    <div class="toolbar">
      ${allowedNextStatuses
        .map((status) => {
          const emphasized = recommendedStatuses.includes(status) ? "primary" : "";
          return `<button class="button ${emphasized}" data-next-status="${status}">${getStatusActionLabel(status)}</button>`;
        })
        .join("")}
    </div>
  `;
}

function prepSnapshot(prep) {
  if (!prep) {
    return `<div class="empty">尚未生成或保存准备材料。</div>`;
  }

  const checklist = Array.isArray(prep.checklist) ? prep.checklist : [];
  const targetKeywords = prep.resumeTailoring?.targetKeywords || [];
  const rewriteBullets = Array.isArray(prep.resumeTailoring?.rewriteBullets) ? prep.resumeTailoring.rewriteBullets : [];
  const contentWithSources = Array.isArray(prep.contentWithSources) ? prep.contentWithSources : [];
  const selfIntroShort = prep.selfIntro?.short || "";
  const talkingPoints = Array.isArray(prep.talkingPoints) ? prep.talkingPoints : [];
  const completedCount = checklist.filter((item) => item.completed).length;
  return `
    <p><strong>关键词：</strong>${escapeHtml(targetKeywords.join(", ") || "暂无")}</p>
    <p><strong>已采纳的简历改写：</strong>${escapeHtml(String(rewriteBullets.length))} 条</p>
    ${prep.tailoredSummary ? `<p><strong>定制摘要：</strong>${escapeHtml(localizeDisplayContent(prep.tailoredSummary, "prep"))}</p>` : ""}
    ${prep.whyMe ? `<p><strong>为什么适合我：</strong>${escapeHtml(localizeDisplayContent(prep.whyMe, "prep"))}</p>` : ""}
    <p>${escapeHtml(localizeDisplayContent(selfIntroShort, "prep"))}</p>
    ${
      rewriteBullets.length
        ? `<p><strong>当前使用的确认内容：</strong>${escapeHtml(localizeDisplayContent(rewriteBullets.slice(0, 2).map((item) => item.after || item.rewritten || item.suggestion || "").join(" / "), "resume"))}</p>`
        : `<p class="muted">当前申请准备还没有带入任何已确认的简历改写内容。</p>`
    }
    ${
      contentWithSources.length
        ? `<p><strong>可解释来源：</strong>${escapeHtml(contentWithSources[0].title || "已生成内容")} 基于 ${escapeHtml((contentWithSources[0].sources || []).map((item) => item.label).join(" / ") || "已确认内容")} 生成</p>`
        : ""
    }
    ${talkingPoints.length ? `<p><strong>沟通重点：</strong>${escapeHtml(localizeDisplayContent(talkingPoints.slice(0, 2).join(" / "), "prep"))}</p>` : ""}
    <p class="muted">准备清单：已完成 ${completedCount}/${checklist.length}</p>
    <a class="button" href="#/prep/${prep.jobId}">进入申请准备编辑</a>
  `;
}

function recommendationTone(recommendation) {
  if (recommendation === "apply") return "success";
  if (recommendation === "cautious") return "warning";
  return "error";
}

function renderNextAction(nextAction) {
  if (!nextAction) {
    return `<div class="empty">当前没有明确的下一步建议，你可以手动检查岗位信息或稍后再回来处理。</div>`;
  }

  return `
    <div class="next-action ${nextAction.tone || "neutral"}">
      <div class="next-action-copy">
        <div class="next-action-label">下一步建议</div>
        <h3>${escapeHtml(nextAction.title)}</h3>
        <p>${escapeHtml(nextAction.description)}</p>
      </div>
      <div class="next-action-controls">
        ${
          nextAction.ctaType === "open_prep"
            ? `<a class="button primary" href="#/prep/${nextAction.jobId}">${escapeHtml(nextAction.ctaLabel)}</a>`
            : nextAction.ctaType === "tailor"
              ? `<a class="button primary" href="#/jobs/${nextAction.jobId}/tailoring">${escapeHtml(nextAction.ctaLabel)}</a>`
            : nextAction.ctaType === "prepare"
              ? `<button class="button primary" id="next-action-prepare">${escapeHtml(nextAction.ctaLabel)}</button>`
              : nextAction.ctaType === "evaluate"
                ? `<button class="button primary" id="next-action-evaluate">${escapeHtml(nextAction.ctaLabel)}</button>`
                : nextAction.ctaType === "status"
                  ? `<button class="button primary" id="next-action-status" data-next-status="${nextAction.nextStatus}">${escapeHtml(nextAction.ctaLabel)}</button>`
                  : `<span class="muted">${escapeHtml(nextAction.ctaLabel || "手动查看")}</span>`
        }
      </div>
    </div>
  `;
}

function renderTimeline(logs) {
  if (!logs.length) {
    return `<div class="empty">当前还没有活动记录。</div>`;
  }

  return `
    <div class="timeline">
      ${logs
        .map(
          (log) => `
            <div class="timeline-item">
              <div class="timeline-dot"></div>
              <div class="timeline-content">
                <div class="timeline-meta">
                  <strong>${escapeHtml(log.eventLabel || humanizeAuditEvent(log.type || log.action))}</strong>
                  <span class="muted">${escapeHtml(log.timeText || new Date(log.timestamp || log.createdAt).toLocaleString())}</span>
                </div>
                <div>${escapeHtml(localizeDisplayContent(log.summary, "timeline"))}</div>
                ${log.agentName ? `<div class="muted">执行阶段：${escapeHtml(log.actorLabel || log.agentName)}</div>` : ""}
                ${
                  log.metadata?.acceptedCount !== undefined || log.metadata?.rejectedCount !== undefined
                    ? `<div class="trace-detail"><strong>人工确认结果</strong><span>已接受 ${escapeHtml(String(log.metadata?.acceptedCount || 0))} 条 / 已拒绝 ${escapeHtml(String(log.metadata?.rejectedCount || 0))} 条 / 待确认 ${escapeHtml(String(log.metadata?.pendingCount || 0))} 条</span></div>`
                    : ""
                }
                ${
                  log.metadata?.prepWillUseAcceptedOnly
                    ? `<div class="trace-detail"><strong>后续影响</strong><span>Prep Agent 只会使用这些已接受的改写内容，未接受内容不会进入申请准备。</span></div>`
                    : ""
                }
                ${log.inputSummary ? `<div class="trace-detail"><strong>系统看到的信息</strong><span>${escapeHtml(localizeDisplayContent(log.inputSummary, "timeline"))}</span></div>` : ""}
                ${log.outputSummary ? `<div class="trace-detail"><strong>系统产出的结果</strong><span>${escapeHtml(localizeDisplayContent(log.outputSummary, "timeline"))}</span></div>` : ""}
                ${log.decisionReason ? `<div class="trace-detail"><strong>为什么这样判断</strong><span>${escapeHtml(localizeDisplayContent(log.decisionReason, "timeline"))}</span></div>` : ""}
                ${log.policyInfluenceSummary ? `<div class="trace-detail"><strong>策略影响</strong><span>${escapeHtml(localizeDisplayContent(log.policyInfluenceSummary, "timeline"))}</span></div>` : ""}
                ${log.activePolicyVersion ? `<div class="trace-detail"><strong>生效策略版本</strong><span>${escapeHtml(log.activePolicyVersion)}</span></div>` : ""}
                ${log.policyProposalId ? `<div class="trace-detail"><strong>关联提案</strong><span>${escapeHtml(log.policyProposalId)}</span></div>` : ""}
                ${log.overrideApplied ? `<div class="trace-detail"><strong>人工覆盖</strong><span>${escapeHtml(humanizeOverrideSummary(log.overrideSummary))}</span></div>` : ""}
                ${
                  log.decisionBreakdown
                    ? `<div class="trace-detail"><strong>决策拆解</strong><span>基础 ${escapeHtml(log.decisionBreakdown.baseScore)} / 历史 ${escapeHtml(log.decisionBreakdown.historyAdjustment)} / 策略 ${escapeHtml(log.decisionBreakdown.policyAdjustment)} / 最终 ${escapeHtml(log.decisionBreakdown.finalScore)} -> ${escapeHtml(humanizeStrategyDecision(log.decisionBreakdown.finalDecision).label)}</span></div>`
                    : ""
                }
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderPipelineStages(stages = []) {
  if (!stages.length) {
    return `<div class="empty">当前还没有明确的流程阶段记录。</div>`;
  }

  return `
    <div class="pipeline-stage-list">
      ${stages
        .map((stage) => {
          const tone =
            stage.status === "completed"
              ? "ready_to_apply"
              : stage.status === "fallback"
                ? "to_prepare"
                : stage.status === "active" || stage.status === "ready"
                  ? "evaluating"
                  : stage.status === "failed"
                    ? "archived"
                    : "";
          return `
            <div class="pipeline-stage-item">
              <div class="pipeline-stage-top">
                <strong>${escapeHtml(stage.label)}</strong>
                <span class="status ${tone}">${escapeHtml(getStageStatusLabel(stage.status))}</span>
              </div>
              <div class="muted">${escapeHtml(stage.summary || "当前没有阶段摘要。")}</div>
              ${stage.timestamp ? `<div class="muted">${escapeHtml(new Date(stage.timestamp).toLocaleString())}</div>` : ""}
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

async function renderJobDetail(jobId, message = "", errorMessage = "") {
  setActiveNav("#/jobs");
  title.textContent = "岗位详情";
  subtitle.textContent = "围绕单个岗位展示评估、申请准备、状态推进与活动记录。";
  renderLoadingState("加载岗位详情", "正在拉取评估、申请准备与活动记录...");
  const data = await api(`/api/jobs/${jobId}`);
  console.log("DEBUG job detail payload", data);
  const {
    job,
    fitAssessment,
    applicationPrep,
    tailoringOutput,
    resumeDocument,
    tasks,
    activityLogs,
    interviewReflection,
    badCase,
    globalPolicy,
    policyExplanation,
    pipelineStages,
    policyProposals,
    policyAuditLogs,
    allowedNextStatuses,
    recommendedNextStatuses,
    nextAction
  } = data;

  if (!job) {
    console.error("DEBUG job detail payload missing job", data);
    app.innerHTML = `
      ${message ? renderNotice("success", message) : ""}
      ${errorMessage ? renderNotice("error", errorMessage) : ""}
      ${renderNotice("error", "岗位详情缺少主 Job 对象，暂时无法展示完整详情。")}
      <div class="panel">
        <h3>岗位详情暂不可用</h3>
        <p class="muted">接口没有返回岗位主对象，请回到岗位列表后重新打开该岗位。</p>
        <div class="toolbar">
          <a class="button" href="#/jobs">返回岗位列表</a>
        </div>
      </div>
    `;
    return;
  }

  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const safeActivityLogs = Array.isArray(activityLogs) ? activityLogs : [];
  const safePolicyExplanation = Array.isArray(policyExplanation) ? policyExplanation : [];
  const safePolicyAuditLogs = Array.isArray(policyAuditLogs) ? policyAuditLogs : [];
  const safeAllowedNextStatuses = Array.isArray(allowedNextStatuses) ? allowedNextStatuses : [];
  const safeRecommendedNextStatuses = Array.isArray(recommendedNextStatuses) ? recommendedNextStatuses : [];
  const safeChecklist = Array.isArray(applicationPrep?.checklist) ? applicationPrep.checklist : [];
  if (!Array.isArray(allowedNextStatuses) || !Array.isArray(recommendedNextStatuses)) {
    console.log("DEBUG job detail status transitions fallback", {
      allowedNextStatuses,
      recommendedNextStatuses
    });
  }

  const enhancedNextAction = nextAction ? { ...nextAction, jobId: job.id } : null;
  const jobVm = createJobViewModel({ job, fitAssessment, nextAction: enhancedNextAction });
  const policyVm = createPolicyViewModel(globalPolicy);
  const prepVm = createPrepViewModel({ prep: applicationPrep, fitAssessment });
  const resumeVm = createResumeViewModel(resumeDocument);
  const proposalVms = (policyProposals || []).map((proposal) => createProposalViewModel(proposal));
  const timelineEntries = safeActivityLogs.map((log) => ({ ...createAuditEventViewModel(log), ...log }));
  const recommendationClass = fitAssessment ? recommendationTone(fitAssessment.recommendation) : "neutral";
  const completedCount = applicationPrep ? safeChecklist.filter((item) => item.completed).length : 0;
  const prepReady = applicationPrep && completedCount >= 3;
  const policyVersion = fitAssessment?.activePolicyVersion || policyVm.version;
  const policySummaryText =
    fitAssessment?.policyInfluenceSummary ||
    safePolicyExplanation[0] ||
    "当前还没有记录到明确的策略影响。";
  const recommendationMeta = humanizeRecommendation(fitAssessment?.recommendation);
  const strategyMeta = humanizeStrategyDecision(fitAssessment?.strategyDecision || job.strategyDecision);
  const fitToTailoringGuidance = createFitToTailoringGuidance(fitAssessment);
  const tailoringExplainability = Array.isArray(tailoringOutput?.tailoringExplainability)
    ? tailoringOutput.tailoringExplainability
    : Array.isArray(applicationPrep?.tailoringExplainability)
      ? applicationPrep.tailoringExplainability
      : [];
  const tailoringBulletVms = (tailoringOutput?.rewrittenBullets || []).map((item, index) =>
    createTailoringBulletViewModel(item, index)
  );
  const acceptedTailoringCount = tailoringBulletVms.filter((item) => item.status === "accepted").length;
  const pendingTailoringCount = tailoringBulletVms.filter((item) => item.status === "pending").length;
  const diffEntries = tailoringOutput?.diff || tailoringOutput?.diffView?.diff || [];

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    <div class="detail-shell">
      <section class="detail-hero ${recommendationClass}">
        <div class="hero-copy">
          <div class="eyebrow">岗位判断</div>
          <h3 class="hero-title">${escapeHtml(jobVm.title)}</h3>
          <p class="hero-subtitle">${escapeHtml(jobVm.company)} · ${escapeHtml(jobVm.location)} · 来源 ${escapeHtml(jobVm.sourceLabel)} · 更新于 ${escapeHtml(jobVm.updatedAtText)}</p>
          <div class="hero-meta">
            ${statusBadge(jobVm.raw?.status || job.status || "inbox")}
            ${
              fitAssessment
                ? `${semanticBadge(`${recommendationMeta.label} · ${fitAssessment.fitScore}`, recommendationMeta.tone)}
                   <span class="status">${escapeHtml(jobVm.strategyLabel)}</span>`
                : `<span class="status">等待评估</span>`
            }
            <span class="status">优先级 · ${escapeHtml(jobVm.priorityLabel)}</span>
            <span class="status">策略版本 · ${escapeHtml(policyVersion)}</span>
          </div>
          <p>${escapeHtml(localizeDisplayContent(fitAssessment?.decisionSummary || job.strategyReasoning || "重新评估后，这里会展示系统对该岗位的整体判断摘要。", "fit"))}</p>
          ${
            job.policyOverride?.active
              ? `<div class="notice warning">当前存在人工覆盖：${escapeHtml(humanizeOverride(job.policyOverride.action))}${job.policyOverride.reason ? ` · ${escapeHtml(job.policyOverride.reason)}` : ""}</div>`
              : ""
          }
        </div>
        <div class="stack">
          <div class="metric-card">
            <div class="metric-label">推荐结论</div>
            <div class="metric">${escapeHtml(jobVm.recommendationLabel)}</div>
            <div class="metric-support">${escapeHtml(localizeDisplayContent(fitAssessment?.suggestedAction || "先完成评估，再给出下一步建议。", "fit"))}</div>
          </div>
          <div class="split-metrics">
            <div class="metric-card">
              <div class="metric-label">匹配度评分</div>
              <div class="metric">${escapeHtml(fitAssessment?.fitScore ?? "-")}</div>
              <div class="metric-support">判断把握度 ${Math.round((fitAssessment?.confidence || 0) * 100)}%</div>
            </div>
            <div class="metric-card">
            <div class="metric-label">准备进度</div>
            <div class="metric">${escapeHtml(prepVm.checklistProgress)}</div>
            <div class="metric-support">${escapeHtml(prepVm.readinessLabel)}</div>
          </div>
          </div>
          <div class="card surface-dark">
            <div class="eyebrow">策略影响</div>
            <h4>${escapeHtml(jobVm.strategyLabel)}</h4>
            <p class="muted">${escapeHtml(localizeDisplayContent(policySummaryText, "fit"))}</p>
          </div>
        </div>
      </section>

      <section>
        ${renderNextAction(enhancedNextAction)}
        <div class="toolbar" style="margin-top:12px;">
          <button class="button" id="evaluate-btn">重新评估</button>
          <button class="button" id="prepare-btn">${
            !resumeVm.exists
              ? "先上传原始简历"
              : tailoringOutput
                ? "生成申请准备包"
                : "进入岗位定制工作区"
          }</button>
          <a class="button primary" href="#/jobs/${job.id}/tailoring">进入岗位定制工作区</a>
        </div>
        ${
          resumeVm.exists
            ? `<div class="muted" style="margin-top:10px;">当前使用的原始简历：${escapeHtml(resumeVm.fileName)} · ${escapeHtml(resumeVm.statusLabel)} · 解析质量 ${escapeHtml(resumeVm.parseQualityLabel)}</div>`
            : `<div class="notice warning" style="margin-top:10px;">你还没有上传原始简历，系统暂时只能依赖主简历文本。建议先去个人画像上传 PDF / DOCX，再生成岗位定制申请内容。<a class="text-link" href="#/profile">前往上传</a></div>`
        }
      </section>

      <section class="detail-main">
        <div class="stack">
          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">流程阶段</div>
                <h3>执行流程</h3>
              </div>
            </div>
            ${renderPipelineStages(pipelineStages || [])}
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">岗位摘要</div>
                <h3>结构化岗位信息</h3>
              </div>
            </div>
            <p>${escapeHtml(localizeDisplayContent(job.jdStructured.summary || "当前还没有岗位摘要。", "summary"))}</p>
            <div class="info-grid">
              <div class="panel">
                <strong>核心职责</strong>
                <ul class="list list-tight">${job.jdStructured.responsibilities.map((item) => `<li>${escapeHtml(localizeDisplayContent(item, "responsibility"))}</li>`).join("") || "<li>暂无职责信息。</li>"}</ul>
              </div>
              <div class="panel">
                <strong>任职要求</strong>
                <ul class="list list-tight">${job.jdStructured.requirements.map((item) => `<li>${escapeHtml(localizeDisplayContent(item, "requirement"))}</li>`).join("") || "<li>暂无要求信息。</li>"}</ul>
              </div>
              <div class="panel">
                <strong>加分项</strong>
                <ul class="list list-tight">${(job.jdStructured.preferredQualifications || [])
                  .map((item) => `<li>${escapeHtml(localizeDisplayContent(item, "preferred"))}</li>`)
                  .join("") || "<li>暂无明确加分项。</li>"}</ul>
              </div>
              <div class="panel">
                <strong>岗位风险</strong>
                <ul class="list list-tight">${job.jdStructured.riskFlags.map((item) => `<li>${escapeHtml(localizeDisplayContent(item, "risk"))}</li>`).join("") || "<li>暂无明显岗位风险。</li>"}</ul>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">评估结果</div>
                <h3>推荐结论与原因</h3>
              </div>
            </div>
            ${fitAssessment
              ? `
                  <div class="panel">
                    <strong>${escapeHtml(jobVm.recommendationLabel)}</strong>
                    <div class="muted">${escapeHtml(jobVm.strategyLabel)} · ${escapeHtml(localizeDisplayContent(fitAssessment.suggestedAction, "fit"))}</div>
                    <div class="muted">${escapeHtml(localizeDisplayContent(fitAssessment.strategyReasoning || job.strategyReasoning || "系统尚未补充完整原因说明。", "fit"))}</div>
                  </div>
                  <div class="info-grid">
                    <div class="panel">
                      <strong>为什么建议这样做</strong>
                      <div class="muted">基础判断：${escapeHtml(fitAssessment.decisionBreakdown?.baseScore ?? "-")}</div>
                      <div class="muted">历史修正：${escapeHtml(fitAssessment.decisionBreakdown?.historyAdjustment ?? "-")}</div>
                      <div class="muted">策略修正：${escapeHtml(fitAssessment.decisionBreakdown?.policyAdjustment ?? "-")}</div>
                      <div class="muted">最终结果：${escapeHtml(fitAssessment.decisionBreakdown?.finalScore ?? fitAssessment.fitScore)} -> ${escapeHtml(humanizeStrategyDecision(fitAssessment.decisionBreakdown?.finalDecision || fitAssessment.strategyDecision).label)}</div>
                      ${fitAssessment.policyProposalId ? `<div class="muted">关联提案：${escapeHtml(fitAssessment.policyProposalId)}</div>` : ""}
                      ${fitAssessment.overrideApplied ? `<div class="muted">人工覆盖：${escapeHtml(humanizeOverrideSummary(fitAssessment.overrideSummary))}</div>` : ""}
                    </div>
                    <div class="panel">
                      <strong>为什么值得投</strong>
                      <ul class="list list-tight">${fitAssessment.whyApply.map((item) => `<li>${escapeHtml(localizeDisplayContent(item, "fit"))}</li>`).join("") || "<li>当前没有明显的投递理由。</li>"}</ul>
                    </div>
                    <div class="panel">
                      <strong>关键短板</strong>
                      <ul class="list list-tight">${fitAssessment.keyGaps.map((item) => `<li>${escapeHtml(localizeDisplayContent(item, "fit"))}</li>`).join("") || "<li>当前没有明显短板。</li>"}</ul>
                    </div>
                    <div class="panel">
                      <strong>关键风险</strong>
                      <ul class="list list-tight">${fitAssessment.riskFlags.map((item) => `<li>${escapeHtml(localizeDisplayContent(item, "risk"))}</li>`).join("") || "<li>当前没有明显风险。</li>"}</ul>
                    </div>
                  </div>
                `
              : `<div class="empty">尚未生成评估结果。</div>`}
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">下一步动作</div>
                <h3>Fit → Tailoring 引导</h3>
              </div>
            </div>
            <div class="fit-guidance-card ${fitToTailoringGuidance.tone || ""}">
              <div class="fit-guidance-copy">
                <strong>${escapeHtml(fitToTailoringGuidance.title)}</strong>
                <p>${escapeHtml(fitToTailoringGuidance.description)}</p>
              </div>
              <div class="fit-guidance-actions">
                <a class="button primary" href="#/jobs/${job.id}/tailoring">进入岗位定制工作区</a>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">策略解释</div>
                <h3>系统为什么这样判断</h3>
              </div>
            </div>
            <div class="panel">
              <strong>全局策略上下文</strong>
              <div class="muted">聚焦模式 ${escapeHtml(policyVm.focusModeLabel)} · 风险偏好 ${escapeHtml(policyVm.riskToleranceLabel)}</div>
              <div class="muted">${escapeHtml(localizeDisplayContent(policyVm.shortSummaryText, "fit"))}</div>
            </div>
            <div class="info-grid">
              <div class="panel">
                <strong>策略影响</strong>
                <div class="muted">${escapeHtml(localizeDisplayContent(fitAssessment?.policyInfluenceSummary || "当前还没有明确的策略影响说明。", "fit"))}</div>
              </div>
              <div class="panel">
                <strong>历史影响</strong>
                <div class="muted">${escapeHtml(localizeDisplayContent(fitAssessment?.historyInfluenceSummary || "当前还没有历史修正说明。", "fit"))}</div>
              </div>
            </div>
            <ul class="list list-tight">
              ${safePolicyExplanation.map((item) => `<li>${escapeHtml(localizeDisplayContent(item, "fit"))}</li>`).join("") || "<li>当前还没有更多策略解释。</li>"}
            </ul>
          </div>

          ${interviewReflection
            ? `
              <div class="card">
                <div class="section-head">
                  <div>
                    <div class="eyebrow">面试复盘</div>
                    <h3>面试反馈</h3>
                  </div>
                </div>
                <p>${escapeHtml(localizeDisplayContent(interviewReflection.summary, "fit"))}</p>
                <ul class="list list-tight">${interviewReflection.improvementActions.map((item) => `<li>${escapeHtml(localizeDisplayContent(item, "fit"))}</li>`).join("")}</ul>
              </div>
            `
            : ""}
        </div>

        <div class="stack">
          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">申请准备</div>
                <h3>准备摘要</h3>
              </div>
            </div>
            ${prepSnapshot(applicationPrep)}
            ${applicationPrep ? `<p class="muted">核心清单完成情况：${escapeHtml(prepVm.checklistProgress)}</p>` : ""}
            ${
              job.strategyDecision === "cautious_proceed"
                ? `<div class="notice warning">这是一条“谨慎推进”岗位。准备材料时请优先处理这些风险：${escapeHtml((fitAssessment?.riskFlags || []).slice(0, 2).join(" / ") || "请先核对关键风险")}</div>`
                : ""
            }
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">原始简历</div>
                <h3>简历输入状态</h3>
              </div>
            </div>
            <div class="panel">
              <strong>${escapeHtml(resumeVm.fileName)}</strong>
              <div class="muted">${escapeHtml(resumeVm.statusLabel)} · ${escapeHtml(resumeVm.uploadedAtText)}</div>
              <div class="muted">${escapeHtml(resumeVm.summary)}</div>
            </div>
            ${resumeVm.parseWarning ? `<div class="notice warning">${escapeHtml(resumeVm.parseWarning)}</div>` : ""}
            <div class="toolbar">
              <a class="button" href="#/profile">${resumeVm.exists ? "更新原始简历" : "上传原始简历"}</a>
              ${
                resumeVm.exists
                  ? `<span class="status">清洗后正文 ${escapeHtml(resumeVm.cleanedTextLength)} 字</span>`
                  : ""
              }
            </div>
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">岗位定制简历</div>
                <h3>定制结果、差异与人工确认</h3>
              </div>
            </div>
            ${
              tailoringOutput
                ? `
                  <div class="panel">
                    <strong>定制摘要</strong>
                    <div class="muted">${escapeHtml(localizeDisplayContent(tailoringOutput.tailoredSummary || tailoringOutput.tailoredResumePreview?.summary || "暂无定制摘要。", "resume"))}</div>
                  </div>
                  <div class="info-grid">
                    <div class="panel">
                      <strong>为什么适合我</strong>
                      <div class="muted">${escapeHtml(localizeDisplayContent(tailoringOutput.whyMe || "暂无 why me 说明。", "fit"))}</div>
                    </div>
                    <div class="panel">
                      <strong>重点关键词</strong>
                      <div class="muted">${escapeHtml((tailoringOutput.targetingBrief?.targetKeywords || []).join(" / ") || "暂无关键词")}</div>
                    </div>
                    <div class="panel">
                      <strong>选择策略</strong>
                      <div class="muted">优先经历 ${escapeHtml(String((tailoringOutput.selectionPlan?.selectedExperienceIds || []).length))} 条 · 项目 ${escapeHtml(String((tailoringOutput.selectionPlan?.selectedProjectIds || []).length))} 条</div>
                    </div>
                    <div class="panel">
                      <strong>差异摘要</strong>
                      <div class="muted">改写 ${escapeHtml(String(tailoringOutput.diffView?.changedBulletCount || tailoringOutput.rewrittenBullets?.length || 0))} 条 · 已接受 ${escapeHtml(String(acceptedTailoringCount))} 条 · 待确认 ${escapeHtml(String(pendingTailoringCount))} 条</div>
                    </div>
                  </div>
                  <details class="activity-disclosure" ${diffEntries.length ? "" : ""}>
                    <summary>查看原始简历与定制版差异</summary>
                    <div class="stack tailoring-diff-stack" style="margin-top:12px;">
                      ${
                        diffEntries.length
                          ? diffEntries
                              .map(
                                (item, index) => `
                                  <div class="panel tailoring-diff-card">
                                    <div class="tailoring-review-head">
                                      <strong>${escapeHtml(humanizeDiffType(item.type))} ${index + 1}</strong>
                                      <span class="status">${escapeHtml(item.section === "summary" ? "摘要" : item.section === "why_me" ? "Why Me" : "经历")}</span>
                                    </div>
                                    <div class="tailoring-diff-grid">
                                      <div class="tailoring-diff-side">
                                        <div class="eyebrow">改动前</div>
                                        <div class="muted">${escapeHtml(localizeDisplayContent(item.before || "暂无原始内容。", "resume"))}</div>
                                      </div>
                                      <div class="tailoring-diff-side">
                                        <div class="eyebrow">改动后</div>
                                        <div class="muted">${escapeHtml(localizeDisplayContent(item.after || "暂无改写内容。", "resume"))}</div>
                                      </div>
                                    </div>
                                    <div class="muted">原因：${escapeHtml(localizeDisplayContent(item.reason || "暂无解释。", "fit"))}</div>
                                  </div>
                                `
                              )
                              .join("")
                          : `<div class="empty">当前还没有可展示的差异项。</div>`
                      }
                    </div>
                  </details>
                  <form id="tailoring-review-form" class="stack" style="margin-top:16px;">
                    <div class="section-head">
                      <div>
                        <div class="eyebrow">Human in the loop</div>
                        <h3>逐条确认 AI 改写建议</h3>
                      </div>
                    </div>
                    ${
                      tailoringBulletVms.length && !acceptedTailoringCount
                        ? `<div class="notice warning">你还没有接受任何改写建议。后续 Prep Agent 不会自动使用这些内容，建议至少确认 1-2 条最关键的经历改写。</div>`
                        : ""
                    }
                    ${
                      tailoringBulletVms.length
                        ? tailoringBulletVms
                            .map(
                              (item, index) => `
                                <div class="panel tailoring-review-card">
                                  <input type="hidden" name="bulletId_${index}" value="${escapeHtml(item.bulletId)}" />
                                  <div class="tailoring-review-head">
                                    <strong>改写建议 ${index + 1}</strong>
                                    <span class="status ${item.status === "accepted" ? "offer" : item.status === "rejected" ? "archived" : "pending"}">${escapeHtml(humanizeTailoringDecisionStatus(item.status))}</span>
                                  </div>
                                  <div class="tailoring-diff-grid">
                                    <div class="tailoring-diff-side">
                                      <div class="eyebrow">原始内容</div>
                                      <div class="muted">${escapeHtml(localizeDisplayContent(item.before || "暂无原始内容。", "resume"))}</div>
                                    </div>
                                    <div class="tailoring-diff-side">
                                      <div class="eyebrow">AI 建议</div>
                                      <div class="muted">${escapeHtml(localizeDisplayContent(item.suggestion || "暂无改写建议。", "resume"))}</div>
                                    </div>
                                  </div>
                                  <div class="muted">对应 JD：${escapeHtml(localizeDisplayContent(item.jdRequirement || "暂无对应要求。", "fit"))}</div>
                                  <label>AI 改写建议
                                    <textarea name="suggestion_${index}" rows="3">${escapeHtml(item.suggestion)}</textarea>
                                  </label>
                                  <label>决策
                                    <select name="status_${index}">
                                      <option value="pending" ${item.status === "pending" ? "selected" : ""}>待确认</option>
                                      <option value="accepted" ${item.status === "accepted" ? "selected" : ""}>接受</option>
                                      <option value="rejected" ${item.status === "rejected" ? "selected" : ""}>拒绝</option>
                                    </select>
                                  </label>
                                  <div class="muted">为什么这样改：${escapeHtml(localizeDisplayContent(item.reason, "fit"))}</div>
                                </div>
                              `
                            )
                            .join("")
                        : `<div class="empty">还没有生成可确认的改写建议。</div>`
                    }
                    ${
                      tailoringBulletVms.length
                        ? `<div class="toolbar"><button class="button" type="submit" id="save-tailoring-review-btn">保存简历定制确认结果</button><a class="button primary" href="#/jobs/${job.id}/tailoring">进入完整工作区</a></div>`
                        : ""
                    }
                  </form>
                `
                : `<div class="empty">还没有生成岗位定制简历。建议从岗位详情进入完整的岗位定制工作区，在那里生成第一版并继续人工确认。<div class="toolbar" style="margin-top:12px;"><a class="button primary" href="#/jobs/${job.id}/tailoring">进入岗位定制工作区</a></div></div>`
            }
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">改写理由</div>
                <h3>为什么这样改</h3>
              </div>
            </div>
            ${
              tailoringExplainability.length
                ? `<div class="stack">${tailoringExplainability
                    .slice(0, 4)
                    .map(
                      (item) => `
                        <div class="panel">
                          <strong>${escapeHtml(item.title || "改写建议")}</strong>
                          <div class="muted">对应岗位要求：${escapeHtml(localizeDisplayContent(item.jdRequirement || "暂无对应要求。", "fit"))}</div>
                          <div class="muted">改动前：${escapeHtml(localizeDisplayContent(item.before || "暂无原始内容。", "resume"))}</div>
                          <div class="muted">改动后：${escapeHtml(localizeDisplayContent(item.after || "暂无改写内容。", "resume"))}</div>
                          <div class="muted">原因：${escapeHtml(localizeDisplayContent(item.reason || "暂无解释。", "fit"))}</div>
                        </div>
                      `
                    )
                    .join("")}</div>`
                : `<div class="empty">还没有可展示的改写理由。生成岗位定制申请包后，这里会展示每条关键修改的原因。</div>`
            }
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">状态推进</div>
                <h3>下一步可执行动作</h3>
              </div>
            </div>
            <p class="muted">当前状态只展示合法流转，推荐动作会高亮。</p>
            ${renderStatusButtons(job, safeAllowedNextStatuses, safeRecommendedNextStatuses)}
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">人工控制</div>
                <h3>人工覆盖</h3>
              </div>
            </div>
            <label>覆盖原因
              <input id="job-override-reason" value="${escapeHtml(job.policyOverride?.reason || "")}" placeholder="可选：说明为什么要人工覆盖系统判断" />
            </label>
            <div class="toolbar">
              <button class="button" data-job-override="force_proceed">强制推进</button>
              <button class="button" data-job-override="ignore_policy">忽略策略</button>
              <button class="button" data-job-override="force_archive">强制归档</button>
            </div>
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">失败案例</div>
                <h3>失败样本</h3>
              </div>
            </div>
            <p class="muted">
              ${badCase ? "这条岗位已经被记录为失败案例，后续会用于回看与策略修正。" : "如果这条岗位判断失真或实际价值较低，可以标记为失败案例，帮助系统保留失败记忆。"}
            </p>
            <label>问题说明
              <textarea id="badcase-note" placeholder="为什么这条岗位应该被记为失败案例？">${escapeHtml(badCase?.issueDescription || "")}</textarea>
            </label>
            <div class="toolbar">
              <button class="button ${badCase ? "" : "primary"}" id="toggle-badcase">
                ${badCase ? "取消失败案例" : "标记为失败案例"}
              </button>
            </div>
            ${
              badCase
                ? `
                  <div class="info-grid">
                    <div class="panel">
                      <strong>最终状态</strong>
                      <div class="muted">${escapeHtml(getStatusDisplayLabel(badCase.finalStatus))}</div>
                    </div>
                    <div class="panel">
                      <strong>记录快照</strong>
                      <div class="muted">${escapeHtml(badCase.company)} / ${escapeHtml(badCase.title)}</div>
                    </div>
                  </div>
                `
                : ""
            }
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">策略治理</div>
                <h3>治理摘要</h3>
              </div>
            </div>
            ${
              proposalVms.length
                ? `<div class="stack">${proposalVms
                    .slice(0, 3)
                    .map(
                      (proposalVm) => `
                        <div class="panel">
                          <strong>${escapeHtml(proposalVm.triggerLabel)}</strong>
                          <div class="muted">状态：${escapeHtml(proposalVm.statusLabel)}</div>
                          <div class="muted">${escapeHtml(proposalVm.diffSummaryText || proposalVm.reasonText)}</div>
                        </div>
                      `
                    )
                    .join("")}</div>`
                : `<div class="empty">当前没有最近的策略提案。</div>`
            }
            ${
              safePolicyAuditLogs.length
                ? `<div class="stack" style="margin-top:12px;">${safePolicyAuditLogs
                    .slice(0, 3)
                    .map(
                      (log) => `
                        <div class="panel">
                <strong>${escapeHtml(humanizeAuditEvent(log.eventType))}</strong>
                          <div class="muted">${escapeHtml(log.summary)}</div>
                        </div>
                      `
                    )
                    .join("")}</div>`
                : ""
            }
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">执行备注</div>
                <h3>任务备注</h3>
              </div>
            </div>
            ${safeTasks.length
              ? `<div class="stack">${safeTasks
                  .map(
                    (task) => `
                      <div class="panel">
                        <strong>${escapeHtml(task.title)}</strong>
                        <div class="muted">${escapeHtml(task.note || "")}</div>
                      </div>
                    `
                  )
                  .join("")}</div>`
              : `<div class="empty">暂无任务。</div>`}
          </div>
        </div>
      </section>

      <section class="detail-bottom">
          <details class="activity-disclosure">
            <summary>查看活动记录与决策链</summary>
            <div class="card activity-card">
              <div class="section-head">
                <div>
                  <div class="eyebrow">活动记录</div>
                  <h3>系统过程记录</h3>
                </div>
              </div>
              ${renderTimeline(timelineEntries)}
            </div>
          </details>
      </section>
    </div>
  `;

  document.getElementById("evaluate-btn").addEventListener("click", async () => {
    const button = document.getElementById("evaluate-btn");
    try {
      setButtonPending(button, true, "重新评估中...");
      await api(`/api/jobs/${job.id}/evaluate`, { method: "POST" });
      renderJobDetail(job.id, "评估已更新。");
    } catch (error) {
      setButtonPending(button, false);
      renderJobDetail(job.id, "", error.message);
    }
  });

  document.getElementById("prepare-btn").addEventListener("click", async () => {
    const button = document.getElementById("prepare-btn");
    if (!resumeVm.exists) {
      window.location.hash = "#/profile";
      return;
    }
    try {
      if (tailoringOutput) {
        setButtonPending(button, true, "生成申请包中...");
        await api(`/api/jobs/${job.id}/prepare`, { method: "POST" });
        renderJobDetail(job.id, "岗位定制申请包已生成，可继续进入申请准备页编辑与导出。");
      } else {
        window.location.hash = `#/jobs/${job.id}/tailoring`;
        return;
      }
    } catch (error) {
      setButtonPending(button, false);
      renderJobDetail(job.id, "", error.message);
    }
  });

  const tailoringReviewForm = document.getElementById("tailoring-review-form");
  if (tailoringReviewForm) {
    tailoringReviewForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitButton = document.getElementById("save-tailoring-review-btn");
      try {
        setButtonPending(submitButton, true, "保存中...");
        const formData = new FormData(event.target);
        const rewrittenBullets = tailoringBulletVms.map((item, index) => ({
          bulletId: String(formData.get(`bulletId_${index}`) || item.bulletId),
          before: item.before,
          suggestion: String(formData.get(`suggestion_${index}`) || item.suggestion || "").trim(),
          after: String(formData.get(`suggestion_${index}`) || item.suggestion || "").trim(),
          rewritten: String(formData.get(`suggestion_${index}`) || item.suggestion || "").trim(),
          status: String(formData.get(`status_${index}`) || item.status || "pending"),
          reason: item.reason,
          jdRequirement: item.jdRequirement,
          type: item.type
        }));
        const result = await api(`/api/jobs/${job.id}/tailor/save`, {
          method: "POST",
          body: JSON.stringify({
            tailoredSummary: tailoringOutput?.tailoredSummary || "",
            whyMe: tailoringOutput?.whyMe || "",
            rewrittenBullets
          })
        });
        renderJobDetail(
          job.id,
          `已保存简历定制确认结果：接受 ${result.acceptedCount} 条，待确认 ${result.pendingCount} 条。`
        );
      } catch (error) {
        setButtonPending(submitButton, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  }

  const nextActionEvaluate = document.getElementById("next-action-evaluate");
  if (nextActionEvaluate) {
    nextActionEvaluate.addEventListener("click", async () => {
      try {
        setButtonPending(nextActionEvaluate, true, "重新评估中...");
        await api(`/api/jobs/${job.id}/evaluate`, { method: "POST" });
        renderJobDetail(job.id, "评估已更新。");
      } catch (error) {
        setButtonPending(nextActionEvaluate, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  }

  const nextActionTailor = document.getElementById("next-action-tailor");
  if (nextActionTailor) {
    nextActionTailor.addEventListener("click", async () => {
      if (!resumeVm.exists) {
        renderJobDetail(job.id, "", "请先在个人画像中上传原始简历，再生成岗位定制简历。");
        return;
      }
      try {
        setButtonPending(nextActionTailor, true, "生成定制简历中...");
        await api(`/api/jobs/${job.id}/tailor`, { method: "POST" });
        renderJobDetail(job.id, "岗位定制简历已生成。");
      } catch (error) {
        setButtonPending(nextActionTailor, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  }

  const nextActionPrepare = document.getElementById("next-action-prepare");
  if (nextActionPrepare) {
    nextActionPrepare.addEventListener("click", async () => {
      if (!resumeVm.exists) {
        renderJobDetail(job.id, "", "请先在个人画像中上传原始简历，再生成岗位定制申请内容。");
        return;
      }
      try {
        setButtonPending(nextActionPrepare, true, "生成申请包中...");
        await api(`/api/jobs/${job.id}/prepare`, { method: "POST" });
        renderJobDetail(job.id, "岗位定制申请包已生成，可继续进入申请准备页编辑与导出。");
      } catch (error) {
        setButtonPending(nextActionPrepare, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  }

  const nextActionStatus = document.getElementById("next-action-status");
  if (nextActionStatus) {
    nextActionStatus.addEventListener("click", async () => {
      const nextStatus = nextActionStatus.getAttribute("data-next-status");
      try {
        setButtonPending(nextActionStatus, true, "更新状态中...");
        await api(`/api/jobs/${job.id}/status`, {
          method: "POST",
          body: JSON.stringify({ nextStatus })
        });
        renderJobDetail(job.id, `状态已更新为 ${getStatusDisplayLabel(nextStatus)}。`);
      } catch (error) {
        setButtonPending(nextActionStatus, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  }

  document.querySelectorAll("[data-next-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextStatus = button.getAttribute("data-next-status");
      const needsConfirm = nextStatus === "archived" || nextStatus === "rejected";
      if (needsConfirm && !window.confirm(`确认将岗位状态更新为“${getStatusDisplayLabel(nextStatus)}”吗？`)) {
        return;
      }
      try {
        setButtonPending(button, true, "更新状态中...");
        await api(`/api/jobs/${job.id}/status`, {
          method: "POST",
          body: JSON.stringify({ nextStatus })
        });
        renderJobDetail(job.id, `状态已更新为 ${getStatusDisplayLabel(nextStatus)}。`);
      } catch (error) {
        setButtonPending(button, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  });

  const badCaseButton = document.getElementById("toggle-badcase");
  if (badCaseButton) {
    badCaseButton.addEventListener("click", async () => {
      const issueDescription = document.getElementById("badcase-note")?.value || "";
      try {
        setButtonPending(badCaseButton, true, badCase ? "取消记录中..." : "保存记录中...");
        await api(`/api/jobs/${job.id}/badcase`, {
          method: "POST",
          body: JSON.stringify({
            isBadCase: !badCase,
            issueDescription
          })
        });
        renderJobDetail(job.id, badCase ? "失败案例已取消。" : "岗位已记录为失败案例。");
      } catch (error) {
        setButtonPending(badCaseButton, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  }

  document.querySelectorAll("[data-job-override]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.getAttribute("data-job-override");
      const actionLabel = humanizeOverride(action);
      if ((action === "force_archive" || action === "ignore_policy") && !window.confirm(`确认执行：${actionLabel}？`)) {
        return;
      }
      const reason = document.getElementById("job-override-reason")?.value || "";
      try {
        setButtonPending(button, true, "应用中...");
        await api(`/api/jobs/${job.id}/override`, {
          method: "POST",
          body: JSON.stringify({ action, reason })
        });
        renderJobDetail(job.id, `${actionLabel} 已生效。`);
      } catch (error) {
        setButtonPending(button, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  });
}

async function renderTailoringWorkspace(jobId, message = "", errorMessage = "") {
  setActiveNav("#/jobs");
  title.textContent = "岗位定制工作区";
  subtitle.textContent = "围绕单个岗位管理 base resume、AI 定制结果、人工确认与后续申请准备。";
  renderLoadingState("加载岗位定制工作区", "正在同步原始简历、定制结果与人工确认状态...");
  const data = await api(`/api/jobs/${jobId}/tailoring-workspace`);
  const { job, fitAssessment, tailoringOutput, applicationPrep, resumeDocument, workspace, workspaceActivity } = data;

  if (!job) {
    app.innerHTML = `
      ${message ? renderNotice("success", message) : ""}
      ${errorMessage ? renderNotice("error", errorMessage) : ""}
      ${renderNotice("error", "岗位不存在，暂时无法打开岗位定制工作区。")}
      <div class="panel">
        <div class="toolbar">
          <a class="button" href="#/jobs">返回岗位列表</a>
        </div>
      </div>
    `;
    return;
  }

  const jobVm = createJobViewModel({ job, fitAssessment, nextAction: workspace?.nextAction });
  const resumeVm = createResumeViewModel(resumeDocument);
  const workspaceName = workspace?.name || `${job.company || "目标公司"} ${job.title || "岗位"}定制版`;
  const baseResume = workspace?.baseResumeAsset || {};
  const bulletVms = (tailoringOutput?.rewrittenBullets || []).map((item, index) => createTailoringBulletViewModel(item, index));
  const acceptedCount = bulletVms.filter((item) => item.status === "accepted").length;
  const rejectedCount = bulletVms.filter((item) => item.status === "rejected").length;
  const pendingCount = bulletVms.filter((item) => item.status === "pending").length;
  const diffEntries = tailoringOutput?.diffView?.bulletDiffs || tailoringOutput?.diff || [];
  const keyRequirements = workspace?.jobSummary?.keyRequirements || [];
  const targetKeywords = workspace?.jobSummary?.targetKeywords || [];
  const explainability = Array.isArray(tailoringOutput?.tailoringExplainability)
    ? tailoringOutput.tailoringExplainability
    : [];

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    <div class="tailoring-workspace-shell">
      <section class="tailoring-workspace-hero">
        <div class="hero-copy">
          <div class="eyebrow">Job-driven Tailoring Workspace</div>
          <h3 class="hero-title">${escapeHtml(jobVm.title)}</h3>
          <p class="hero-subtitle">${escapeHtml(jobVm.company)} · ${escapeHtml(jobVm.location)} · ${escapeHtml(jobVm.displayStatus)}</p>
          <div class="hero-meta">
            ${statusBadge(job.status)}
            ${fitAssessment ? semanticBadge(`匹配度 ${fitAssessment.fitScore}`, humanizeRecommendation(fitAssessment.recommendation).tone) : '<span class="status">待评估</span>'}
            <span class="status">${escapeHtml(jobVm.strategyLabel)}</span>
            <span class="status">版本 ${escapeHtml(String(workspace?.activeVersion || tailoringOutput?.version || 1))}</span>
          </div>
          <div class="panel">
            <strong>岗位重点</strong>
            <div class="muted">${escapeHtml(localizeDisplayContent(job.jdStructured?.summary || "当前还没有岗位摘要。", "summary"))}</div>
            <div class="inline-meta">
              <span>关键词：${escapeHtml(targetKeywords.join(" / ") || "暂无")}</span>
              <span>核心要求：${escapeHtml(keyRequirements.slice(0, 3).join(" / ") || "暂无")}</span>
            </div>
          </div>
        </div>
        <div class="stack">
          <div class="metric-card">
            <div class="metric-label">工作区名称</div>
            <div class="metric workspace-name">${escapeHtml(workspaceName)}</div>
            <div class="metric-support">每个岗位维护一份 job-specific 定制版本</div>
          </div>
          <div class="split-metrics">
            <div class="metric-card">
              <div class="metric-label">已接受</div>
              <div class="metric">${escapeHtml(String(acceptedCount))}</div>
              <div class="metric-support">将进入 Prep</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">待确认</div>
              <div class="metric">${escapeHtml(String(pendingCount))}</div>
              <div class="metric-support">需人工审核</div>
            </div>
          </div>
          ${
            !resumeVm.exists
              ? `<div class="notice warning">你还没有上传 Base Resume。请先前往个人画像上传 PDF 或 DOCX，再生成岗位定制内容。<a class="text-link" href="#/profile">前往上传</a></div>`
              : `<div class="card workspace-side-note"><div class="eyebrow">Base Resume</div><h4>${escapeHtml(resumeVm.fileName)}</h4><p class="muted">${escapeHtml(resumeVm.statusLabel)} · ${escapeHtml(resumeVm.extractionMethodLabel)} · 质量 ${escapeHtml(resumeVm.parseQualityLabel)}</p></div>`
          }
        </div>
      </section>

      <section class="card workspace-trust-note">
        <div class="section-head">
          <div>
            <div class="eyebrow">使用边界</div>
            <h3>这一步为什么值得做</h3>
          </div>
        </div>
        <div class="info-grid">
          <div class="panel">
            <strong>左侧是你的 Base Resume</strong>
            <div class="muted">它属于全局资产，只提供素材参考，不会因为当前岗位被直接改写。</div>
          </div>
          <div class="panel">
            <strong>右侧是当前岗位专属版本</strong>
            <div class="muted">这里的摘要、经历重排和改写建议，只服务这一个岗位，不会影响其他岗位版本。</div>
          </div>
          <div class="panel">
            <strong>只有你接受的内容才会进入申请准备</strong>
            <div class="muted">待确认或已拒绝的内容不会进入 Prep，系统会严格按你的确认结果往下游生成。</div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="section-head">
          <div>
            <div class="eyebrow">工作区控制</div>
            <h3>定制版本与 AI refine</h3>
          </div>
        </div>
        <form id="tailoring-refine-form" class="stack">
          <div class="split">
            <label>工作区名称
              <input name="workspaceName" value="${escapeHtml(workspaceName)}" maxlength="120" />
            </label>
            <div class="panel">
              <strong>当前规则</strong>
              <div class="muted">Base Resume 是全局资产；这里维护当前岗位的定制版本。后续 Prep 只会使用你已接受的改写内容。</div>
            </div>
          </div>
          <label>补充 refine 指令
            <textarea name="refinePrompt" placeholder="例如：更强调 AI PM 经验；语气更简洁；把增长案例前置；参考这个岗位更重视跨团队协作。">${escapeHtml(workspace?.lastRefinePrompt || "")}</textarea>
          </label>
          <div class="toolbar">
            <button class="button primary" type="submit" id="workspace-refine-btn">${tailoringOutput ? "基于当前岗位重新定制" : "生成岗位定制简历"}</button>
            <a class="button" href="#/jobs/${job.id}">返回岗位详情</a>
            <a class="button" href="#/prep/${job.id}">进入申请准备</a>
          </div>
        </form>
      </section>

      <section class="tailoring-workspace-main">
        <div class="card">
          <div class="section-head">
            <div>
              <div class="eyebrow">左栏</div>
              <h3>Base Resume 结构化内容</h3>
            </div>
          </div>
          <div class="stack">
            <div class="panel">
              <strong>摘要</strong>
              <div class="muted">${escapeHtml(localizeDisplayContent(baseResume.summary || resumeVm.summary || "暂无 Base Resume 摘要。", "resume"))}</div>
            </div>
            <div class="workspace-column-block">
              <strong>经历</strong>
              <ul class="list list-tight">${(baseResume.experience || []).slice(0, 8).map((item) => `<li>${escapeHtml(localizeDisplayContent(item, "resume"))}</li>`).join("") || "<li>暂无结构化经历。</li>"}</ul>
            </div>
            <div class="workspace-column-block">
              <strong>项目</strong>
              <ul class="list list-tight">${(baseResume.projects || []).slice(0, 5).map((item) => `<li>${escapeHtml(localizeDisplayContent(item, "resume"))}</li>`).join("") || "<li>暂无结构化项目。</li>"}</ul>
            </div>
            <div class="workspace-column-block">
              <strong>技能与教育</strong>
              <div class="muted">技能：${escapeHtml((baseResume.skills || []).slice(0, 10).join(" / ") || "暂无")}</div>
              <div class="muted">教育：${escapeHtml((baseResume.education || []).slice(0, 3).join(" / ") || "暂无")}</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="section-head">
            <div>
              <div class="eyebrow">右栏</div>
              <h3>Tailored Resume 内容</h3>
            </div>
          </div>
          ${
            tailoringOutput
              ? `
                <div class="stack">
                  <div class="panel">
                    <strong>定制摘要</strong>
                    <div class="muted">${escapeHtml(localizeDisplayContent(tailoringOutput.tailoredSummary || "暂无定制摘要。", "resume"))}</div>
                  </div>
                  <div class="panel">
                    <strong>Why Me</strong>
                    <div class="muted">${escapeHtml(localizeDisplayContent(tailoringOutput.whyMe || "暂无岗位适配叙事。", "fit"))}</div>
                  </div>
                  <div class="workspace-column-block">
                    <strong>定制后经历表达</strong>
                    <ul class="list list-tight">${(tailoringOutput.tailoredResumePreview?.experienceBullets || []).slice(0, 6).map((item) => `<li>${escapeHtml(localizeDisplayContent(item, "resume"))}</li>`).join("") || "<li>还没有生成定制后的经历内容。</li>"}</ul>
                  </div>
                  <div class="workspace-column-block">
                    <strong>目标关键词</strong>
                    <div class="muted">${escapeHtml((tailoringOutput.targetingBrief?.targetKeywords || []).join(" / ") || "暂无关键词")}</div>
                  </div>
                </div>
              `
              : `<div class="empty">当前还没有该岗位的定制结果。你可以先填写补充要求，然后生成第一版岗位定制简历。</div>`
          }
        </div>
      </section>

      <section class="card">
        <div class="section-head">
          <div>
            <div class="eyebrow">差异与审核</div>
            <h3>Original vs Tailored</h3>
          </div>
          <div class="muted">AI 改了什么、为什么改、你确认了什么，都在这里完成。</div>
        </div>
        ${
          !tailoringOutput
            ? `<div class="empty">先生成岗位定制简历，这里才会出现逐条 diff 与人工确认。</div>`
            : `
              <form id="tailoring-workspace-save-form" class="stack">
                <input type="hidden" name="workspaceName" value="${escapeHtml(workspaceName)}" />
                <div class="workspace-review-summary">
                  <span class="status offer">已接受 ${escapeHtml(String(acceptedCount))}</span>
                  <span class="status archived">已拒绝 ${escapeHtml(String(rejectedCount))}</span>
                  <span class="status to_prepare">待确认 ${escapeHtml(String(pendingCount))}</span>
                </div>
                <div class="stack tailoring-diff-stack">
                  ${bulletVms.length
                    ? bulletVms
                        .map(
                          (item, index) => `
                            <div class="panel tailoring-review-card workspace-review-card">
                              <div class="tailoring-review-head">
                                <strong>改写建议 ${index + 1}</strong>
                                <span class="status ${item.status === "accepted" ? "offer" : item.status === "rejected" ? "archived" : "to_prepare"}">${escapeHtml(humanizeTailoringDecisionStatus(item.status))}</span>
                              </div>
                              <div class="tailoring-diff-grid">
                                <div class="tailoring-diff-side">
                                  <div class="eyebrow">原始表达</div>
                                  <div class="muted">${escapeHtml(localizeDisplayContent(item.before || "暂无原始表达。", "resume"))}</div>
                                </div>
                                <div class="tailoring-diff-side">
                                  <div class="eyebrow">AI 定制表达</div>
                                  <textarea name="bullet_after_${index}">${escapeHtml(item.suggestion || "暂无建议。")}</textarea>
                                </div>
                              </div>
                              <div class="workspace-review-meta">
                                <div class="muted">对应 JD：${escapeHtml(localizeDisplayContent(item.jdRequirement || "暂无对应要求。", "fit"))}</div>
                                <div class="muted">原因：${escapeHtml(localizeDisplayContent(item.reason || "暂无改写原因。", "fit"))}</div>
                              </div>
                              <div class="split">
                                <label>确认状态
                                  <select name="bullet_status_${index}">
                                    <option value="pending" ${item.status === "pending" ? "selected" : ""}>待确认</option>
                                    <option value="accepted" ${item.status === "accepted" ? "selected" : ""}>接受</option>
                                    <option value="rejected" ${item.status === "rejected" ? "selected" : ""}>拒绝</option>
                                  </select>
                                </label>
                                <label>原始内容（只读参考）
                                  <input name="bullet_before_${index}" value="${escapeHtml(item.before || "")}" readonly />
                                </label>
                              </div>
                              <input type="hidden" name="bullet_id_${index}" value="${escapeHtml(item.bulletId)}" />
                              <input type="hidden" name="bullet_reason_${index}" value="${escapeHtml(item.reason || "")}" />
                              <input type="hidden" name="bullet_requirement_${index}" value="${escapeHtml(item.jdRequirement || "")}" />
                            </div>
                          `
                        )
                        .join("")
                    : `<div class="empty">当前没有逐条改写建议。</div>`}
                </div>
                <div class="toolbar">
                  <button class="button primary" type="submit" id="workspace-save-btn">保存人工确认结果</button>
                  <a class="button" href="#/prep/${job.id}">用已接受内容进入 Prep</a>
                </div>
              </form>
            `
        }
      </section>

      <section class="card">
        <div class="section-head">
          <div>
            <div class="eyebrow">Explainability</div>
            <h3>为什么这样改</h3>
          </div>
        </div>
        ${
          explainability.length
            ? `<div class="stack">${explainability
                .map(
                  (item) => `
                    <div class="panel">
                      <strong>${escapeHtml(item.title || "改写理由")}</strong>
                      <div class="muted">改动前：${escapeHtml(localizeDisplayContent(item.before || "暂无", "resume"))}</div>
                      <div class="muted">改动后：${escapeHtml(localizeDisplayContent(item.after || "暂无", "resume"))}</div>
                      <div class="muted">对应要求：${escapeHtml(localizeDisplayContent(item.jdRequirement || "暂无", "fit"))}</div>
                      <div class="muted">理由：${escapeHtml(localizeDisplayContent(item.reason || "暂无", "fit"))}</div>
                    </div>
                  `
                )
                .join("")}</div>`
            : `<div class="empty">当前还没有可展示的定制解释。生成或保存一次岗位定制结果后，这里会显示清晰的 JD → Resume 映射。</div>`
        }
      </section>

      <details class="activity-disclosure">
        <summary>查看工作区活动记录</summary>
        <div class="card activity-card">
          ${renderTimeline((workspaceActivity || []).map((log) => ({ ...createAuditEventViewModel(log), ...log })))}
        </div>
      </details>
    </div>
  `;

  const refineForm = document.getElementById("tailoring-refine-form");
  refineForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = document.getElementById("workspace-refine-btn");
    try {
      setButtonPending(submitButton, true, tailoringOutput ? "重新定制中..." : "生成中...");
      const formData = new FormData(event.target);
      await api(`/api/jobs/${job.id}/tailoring-workspace/refine`, {
        method: "POST",
        body: JSON.stringify({
          workspaceName: String(formData.get("workspaceName") || ""),
          refinePrompt: String(formData.get("refinePrompt") || "")
        })
      });
      renderTailoringWorkspace(job.id, tailoringOutput ? "岗位定制版本已更新。" : "第一版岗位定制简历已生成。");
    } catch (error) {
      setButtonPending(submitButton, false);
      renderTailoringWorkspace(job.id, "", error.message);
    }
  });

  const saveForm = document.getElementById("tailoring-workspace-save-form");
  saveForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = document.getElementById("workspace-save-btn");
    try {
      setButtonPending(submitButton, true, "保存中...");
      const formData = new FormData(event.target);
      const rewrittenBullets = bulletVms.map((item, index) => ({
        bulletId: String(formData.get(`bullet_id_${index}`) || item.bulletId),
        before: String(formData.get(`bullet_before_${index}`) || item.before || ""),
        suggestion: String(formData.get(`bullet_after_${index}`) || item.suggestion || ""),
        after: String(formData.get(`bullet_after_${index}`) || item.suggestion || ""),
        rewritten: String(formData.get(`bullet_after_${index}`) || item.suggestion || ""),
        status: String(formData.get(`bullet_status_${index}`) || item.status || "pending"),
        reason: String(formData.get(`bullet_reason_${index}`) || item.reason || ""),
        jdRequirement: String(formData.get(`bullet_requirement_${index}`) || item.jdRequirement || "")
      }));
      await api(`/api/jobs/${job.id}/tailoring-workspace/save`, {
        method: "POST",
        body: JSON.stringify({
          workspaceName: String(formData.get("workspaceName") || workspaceName),
          rewrittenBullets,
          tailoredSummary: tailoringOutput?.tailoredSummary || "",
          whyMe: tailoringOutput?.whyMe || "",
          refinePrompt: workspace?.lastRefinePrompt || ""
        })
      });
      renderTailoringWorkspace(job.id, "岗位定制工作区已保存。");
    } catch (error) {
      setButtonPending(submitButton, false);
      renderTailoringWorkspace(job.id, "", error.message);
    }
  });
}

async function renderPrep(jobId, message = "", errorMessage = "") {
  setActiveNav("#/prep");
  title.textContent = "申请准备";
  subtitle.textContent = "编辑申请材料并保存，再回到岗位详情推进状态。";

  if (!jobId) {
    app.innerHTML = `<div class="empty">请从某个岗位详情进入申请准备页面。</div>`;
    return;
  }

  renderLoadingState("加载申请准备", "正在同步最新草稿与准备状态...");
  const data = await api(`/api/jobs/${jobId}`);
  const { job, applicationPrep, tailoringOutput, resumeDocument, fitAssessment } = data;
  console.log("DEBUG prep payload", data);
  if (!job) {
    console.error("DEBUG prep payload missing job", data);
    app.innerHTML = `
      ${message ? renderNotice("success", message) : ""}
      ${errorMessage ? renderNotice("error", errorMessage) : ""}
      ${renderNotice("error", "申请准备页面缺少主 Job 对象，暂时无法加载。")}
      <div class="panel">
        <h3>申请准备暂不可用</h3>
        <p class="muted">接口没有返回岗位主对象，请回到岗位列表后重新打开。</p>
        <div class="toolbar">
          <a class="button" href="#/jobs">返回岗位列表</a>
        </div>
      </div>
    `;
    return;
  }
  const draft = buildPrepDraft(applicationPrep);
  const prepVm = createPrepViewModel({ prep: applicationPrep, fitAssessment });
  const jobVm = createJobViewModel({ job, fitAssessment });
  const resumeVm = createResumeViewModel(resumeDocument);
  const explainability = Array.isArray(tailoringOutput?.tailoringExplainability)
    ? tailoringOutput.tailoringExplainability
    : Array.isArray(applicationPrep?.tailoringExplainability)
      ? applicationPrep.tailoringExplainability
      : [];
  const acceptedTailoringBullets = getTailoringAcceptedBullets(tailoringOutput);
  if (!applicationPrep && acceptedTailoringBullets.length) {
    draft.tailoredResumeBullets = acceptedTailoringBullets.map((item) => item.after || item.rewritten || "").join("\n");
  }
  const tailoredPreview = tailoringOutput?.tailoredResumePreview || applicationPrep?.tailoredResumePreview || null;
  const contentWithSources = Array.isArray(applicationPrep?.contentWithSources) ? applicationPrep.contentWithSources : [];
  const prepRiskNote =
    job.strategyDecision === "cautious_proceed"
      ? `这条岗位带有谨慎推进标记，建议优先处理 ${(fitAssessment?.riskFlags || []).slice(0, 2).join(" / ") || "关键风险项"}.`
      : "";
  const sourceUsageSummary = contentWithSources.reduce(
    (acc, item) => {
      const title = String(item.title || "");
      if (/摘要|summary/i.test(title)) acc.summary += 1;
      else if (/问答|qa|q&a/i.test(title)) acc.qa += 1;
      else if (/自我介绍|intro/i.test(title)) acc.intro += 1;
      else acc.other += 1;
      return acc;
    },
    { summary: 0, qa: 0, intro: 0, other: 0 }
  );
  const prepSourceHeadline = acceptedTailoringBullets.length
    ? `本申请材料基于你已确认的 ${acceptedTailoringBullets.length} 条经历生成。`
    : "当前还没有已确认的简历改写内容，因此这份申请材料主要依赖手动内容或原始简历信息。";
  const prepSourceDetail = acceptedTailoringBullets.length
    ? `其中 ${sourceUsageSummary.summary} 条用于摘要，${sourceUsageSummary.qa} 条用于问答${sourceUsageSummary.intro ? `，${sourceUsageSummary.intro} 条用于自我介绍` : ""}${prepVm.unusedBullets.length ? `，另有 ${prepVm.unusedBullets.length} 条未被使用` : ""}，未确认内容未被使用。`
    : "请先在岗位定制工作区接受至少一条改写建议，再生成更可信的申请材料。";

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    <div class="prep-shell">
      <section class="prep-hero">
        <div class="hero-copy">
          <div class="eyebrow">申请准备工作区</div>
          <h3 class="hero-title">${escapeHtml(jobVm.company)} / ${escapeHtml(jobVm.title)}</h3>
          <p class="hero-subtitle">${escapeHtml(jobVm.location)} · 当前状态 ${escapeHtml(jobVm.displayStatus)}</p>
          <div class="hero-meta">
            ${statusBadge(jobVm.raw?.status || job?.status || "inbox")}
            <span class="status">${escapeHtml(jobVm.strategyLabel)}</span>
            <span class="status">${escapeHtml(prepVm.readinessLabel)}</span>
            <span class="status">原始简历 · ${escapeHtml(resumeVm.statusLabel)}</span>
          </div>
          ${
            prepRiskNote
              ? `<div class="notice warning">${escapeHtml(prepRiskNote)}</div>`
              : `<div class="muted">把这条岗位的申请材料整理成可直接提交的状态，再回到岗位详情推进流程。</div>`
          }
          ${
            !resumeVm.exists
              ? `<div class="notice warning">你还没有上传原始简历，当前无法生成高质量的岗位定制申请内容。请先前往个人画像上传 PDF / DOCX。<a class="text-link" href="#/profile">前往上传</a></div>`
              : ""
          }
        </div>
        <div class="split-metrics">
          <div class="metric-card">
            <div class="metric-label">清单进度</div>
            <div class="metric">${escapeHtml(prepVm.checklistProgress)}</div>
            <div class="metric-support">${escapeHtml(prepVm.readinessLabel)}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">关键词</div>
            <div class="metric">${escapeHtml(String(draft.targetKeywords.length))}</div>
            <div class="metric-support">简历定制锚点</div>
          </div>
        </div>
      </section>

      <section class="card prep-source-summary">
        <div class="section-head">
          <div>
            <div class="eyebrow">来源确认</div>
            <h3>当前申请材料如何使用你确认的内容</h3>
          </div>
        </div>
        <div class="panel">
          <strong>${escapeHtml(prepSourceHeadline)}</strong>
          <div class="muted">${escapeHtml(prepSourceDetail)}</div>
        </div>
        ${
          acceptedTailoringBullets.length
            ? `<div class="muted">已确认内容：${escapeHtml(
                acceptedTailoringBullets
                  .slice(0, 3)
                  .map((item) => localizeDisplayContent(item.after || item.rewritten || item.suggestion || "", "resume"))
                  .join(" / ") || "暂无"
              )}</div>`
            : `<div class="notice warning">请先前往岗位定制工作区确认改写建议，再回来生成更可信的申请材料。</div>`
        }
      </section>

      <form id="prep-form" class="stack">
        <section class="card">
          <div class="section-head">
            <div>
              <div class="eyebrow">原始简历</div>
              <h3>简历输入与解析状态</h3>
            </div>
          </div>
          <div class="info-grid">
            <div class="panel">
              <strong>文件名</strong>
              <div class="muted">${escapeHtml(resumeVm.fileName)}</div>
            </div>
            <div class="panel">
              <strong>解析状态</strong>
              <div class="muted">${escapeHtml(resumeVm.statusLabel)} · ${escapeHtml(resumeVm.parseStatusCode)}</div>
            </div>
            <div class="panel">
              <strong>上传时间</strong>
              <div class="muted">${escapeHtml(resumeVm.uploadedAtText)}</div>
            </div>
            <div class="panel">
              <strong>提取方式</strong>
              <div class="muted">${escapeHtml(resumeVm.extractionMethodLabel)}</div>
            </div>
            <div class="panel">
              <strong>解析质量</strong>
              <div class="muted">${escapeHtml(resumeVm.parseQualityLabel)}（${escapeHtml(String(resumeVm.parseQualityScore))}）</div>
            </div>
          </div>
          ${resumeVm.parseWarning ? `<div class="notice warning">${escapeHtml(resumeVm.parseWarning)}</div>` : ""}
          <div class="toolbar">
            <a class="button" href="#/profile">${resumeVm.exists ? "更新原始简历" : "上传原始简历"}</a>
            ${
              !applicationPrep && resumeVm.exists
                ? `<button class="button primary" type="button" id="generate-tailoring-btn">${tailoringOutput ? "生成申请准备包" : "生成岗位定制简历"}</button>`
                : ""
            }
          </div>
        </section>

        <section class="card">
          <div class="section-head">
            <div>
              <div class="eyebrow">简历定制</div>
              <h3>确认内容与引用关系</h3>
            </div>
          </div>
          <div class="stack">
            <label>目标关键词
              <input name="targetKeywords" value="${escapeHtml(draft.targetKeywords.join(", "))}" />
            </label>
            ${
              tailoringOutput
                ? acceptedTailoringBullets.length
                  ? `<div class="notice success">当前有 ${escapeHtml(String(acceptedTailoringBullets.length))} 条已接受的简历改写，Prep Agent 只会使用这些内容。</div>
                     <div class="panel">
                       <strong>当前已进入 Prep 的确认内容</strong>
                       <ul class="list list-tight">${acceptedTailoringBullets
                         .map((item) => `<li>${escapeHtml(localizeDisplayContent(item.after || item.rewritten || item.suggestion || "", "resume"))}</li>`)
                         .join("")}</ul>
                       ${
                         prepVm.unusedBullets.length
                           ? `<div class="muted" style="margin-top:10px;">未进入 Prep 的内容：${escapeHtml(String(prepVm.unusedBullets.length))} 条（包含待确认或已拒绝项）</div>`
                           : ""
                       }
                     </div>`
                  : `<div class="notice warning">你还没有接受任何一条简历改写建议。当前申请准备不会自动带入 AI 改写内容，请先回到岗位详情逐条确认。</div>`
                : ""
            }
            <label>定制简历要点
              <textarea name="tailoredResumeBullets">${escapeHtml(draft.tailoredResumeBullets)}</textarea>
            </label>
          </div>
          ${
            tailoredPreview
              ? `
                <div class="panel">
                  <strong>定制版简历预览</strong>
                  <div class="muted">${escapeHtml(localizeDisplayContent(tailoredPreview.summary || "暂无定制摘要。", "resume"))}</div>
                  <ul class="list list-tight">
                    ${(tailoredPreview.experienceBullets || [])
                      .slice(0, 4)
                      .map((item) => `<li>${escapeHtml(localizeDisplayContent(item, "resume"))}</li>`)
                      .join("") || "<li>暂无定制后的经历预览。</li>"}
                  </ul>
                </div>
              `
              : ""
          }
          ${
            tailoringOutput?.diffView
              ? `
                <div class="panel">
                  <strong>与原始简历的差异</strong>
                  <div class="muted">改写条数：${escapeHtml(String(tailoringOutput.diffView.changedBulletCount || 0))}</div>
                  <div class="muted">重排顺序：${escapeHtml((tailoringOutput.selectionPlan?.orderingPlan || tailoringOutput.diffView.reorderedSections || []).join(" -> ") || "未调整")}</div>
                </div>
              `
              : ""
          }
        </section>

        <section class="card">
          <div class="section-head">
            <div>
              <div class="eyebrow">叙事材料包</div>
          <h3>摘要、为什么适合我、自我介绍与问答草稿</h3>
            </div>
          </div>
          ${
            contentWithSources.length
              ? `
                <div class="panel">
                  <strong>当前申请材料基于你确认的内容生成</strong>
                  <div class="stack" style="margin-top:12px;">
                    ${contentWithSources
                      .map(
                        (item) => `
                          <div class="panel prep-source-card">
                            <div class="tailoring-review-head">
                              <strong>${escapeHtml(item.title || "生成内容")}</strong>
                              <span class="status offer">已绑定来源</span>
                            </div>
                            <div class="muted">${escapeHtml(localizeDisplayContent(String(item.text || "").slice(0, 180) || "暂无内容。", "prep"))}</div>
                            <div class="muted">基于：${escapeHtml((item.sources || []).map((source) => source.label).join(" / ") || "已确认内容")}</div>
                          </div>
                        `
                      )
                      .join("")}
                  </div>
                </div>
              `
              : tailoringOutput
                ? `<div class="notice warning">当前还没有可解释的引用关系。通常这是因为你还没有接受任何简历改写建议，或尚未生成申请准备包。</div>`
                : ""
          }
          <div class="stack">
            <label>定制摘要
              <textarea name="tailoredSummary">${escapeHtml(draft.tailoredSummary)}</textarea>
            </label>
            <label>为什么是我
              <textarea name="whyMe">${escapeHtml(draft.whyMe)}</textarea>
            </label>
            <div class="split">
              <label>自我介绍（短版）
                <textarea name="selfIntroShort">${escapeHtml(draft.selfIntroShort)}</textarea>
              </label>
              <label>自我介绍（中版）
                <textarea name="selfIntroMedium">${escapeHtml(draft.selfIntroMedium)}</textarea>
              </label>
            </div>
            <label>问答草稿
              <textarea name="qaDraft">${escapeHtml(draft.qaDraft)}</textarea>
            </label>
            <label>沟通重点
              <textarea name="talkingPoints">${escapeHtml(draft.talkingPoints)}</textarea>
            </label>
            <label>投递附言
              <textarea name="coverNote">${escapeHtml(draft.coverNote)}</textarea>
            </label>
            <label>外联附言
              <textarea name="outreachNote">${escapeHtml(draft.outreachNote)}</textarea>
            </label>
          </div>
        </section>

        <section class="card prep-checklist-card">
          <div class="section-head">
            <div>
              <div class="eyebrow">准备状态</div>
              <h3>检查清单与投递准备</h3>
            </div>
            <div class="muted">${prepVm.completionStatus === "complete" ? "已达到继续推进条件" : "完成核心项后才能进入可投递状态"}</div>
          </div>
          ${
            prepVm.completionStatus === "complete"
              ? `<div class="notice success">核心清单已达到准备完成标准，现在可以标记为“可投递”。</div>`
              : `<div class="notice warning">${escapeHtml(prepVm.warningText)}</div>`
          }
          <div class="stack">
            ${draft.checklist
              .map(
                (item, index) => `
                  <label class="checkbox-row prep-checklist-row ${item.completed ? "completed" : ""}">
                    <input type="checkbox" name="checklist_completed_${index}" ${item.completed ? "checked" : ""} />
                    <input type="hidden" name="checklist_key_${index}" value="${escapeHtml(item.key)}" />
                    <input type="text" name="checklist_label_${index}" value="${escapeHtml(item.label)}" />
                  </label>
                `
              )
              .join("")}
          </div>
        </section>

        <section class="card">
          <div class="section-head">
            <div>
              <div class="eyebrow">为什么这样改</div>
              <h3>定制理由与 JD 对齐</h3>
            </div>
          </div>
          ${
            explainability.length
              ? `<div class="stack">${explainability
                  .map(
                    (item) => `
                      <div class="panel">
                        <strong>${escapeHtml(item.title || "改写建议")}</strong>
                        <div class="muted">对应岗位要求：${escapeHtml(localizeDisplayContent(item.jdRequirement || "暂无对应岗位要求。", "fit"))}</div>
                        <div class="muted">改动前：${escapeHtml(localizeDisplayContent(item.before || "暂无原始表述。", "resume"))}</div>
                        <div class="muted">改动后：${escapeHtml(localizeDisplayContent(item.after || "暂无改写表述。", "resume"))}</div>
                        <div class="muted">原因：${escapeHtml(localizeDisplayContent(item.reason || "暂无解释。", "fit"))}</div>
                      </div>
                    `
                  )
                  .join("")}</div>`
              : `<div class="empty">还没有可展示的改写理由。先生成岗位定制申请包，这里会告诉你每一条为什么这样改。</div>`
          }
        </section>

        <section class="prep-actions">
          <div class="toolbar">
            <button class="button primary" type="submit">保存申请准备</button>
            <button class="button" type="button" id="mark-prep-ready">标记准备完成</button>
            ${applicationPrep ? `<button class="button" type="button" id="export-docx-btn">导出 DOCX</button>` : ""}
            <a class="text-link" href="#/jobs/${job.id}/tailoring">返回岗位定制工作区</a>
            <a class="text-link" href="#/jobs/${job.id}">返回岗位详情</a>
          </div>
        </section>
      </form>
    </div>
  `;

  document.getElementById("prep-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = event.target.querySelector('button[type="submit"]');
    try {
      setButtonPending(submitButton, true, "保存中...");
      const formData = new FormData(event.target);
      const checklist = draft.checklist.map((_, index) => ({
        key: String(formData.get(`checklist_key_${index}`) || ""),
        label: String(formData.get(`checklist_label_${index}`) || ""),
        completed: Boolean(formData.get(`checklist_completed_${index}`))
      }));
      const payload = {
        targetKeywords: String(formData.get("targetKeywords") || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        tailoredResumeBullets: formData.get("tailoredResumeBullets"),
        tailoredSummary: formData.get("tailoredSummary"),
        whyMe: formData.get("whyMe"),
        selfIntroShort: formData.get("selfIntroShort"),
        selfIntroMedium: formData.get("selfIntroMedium"),
        qaDraft: formData.get("qaDraft"),
        talkingPoints: formData.get("talkingPoints"),
        coverNote: formData.get("coverNote"),
        outreachNote: formData.get("outreachNote"),
        checklist
      };
      await api(`/api/jobs/${job.id}/prep/save`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      renderPrep(job.id, "申请准备已保存。");
    } catch (error) {
      setButtonPending(submitButton, false);
      renderPrep(job.id, "", error.message);
    }
  });

  const generateTailoringButton = document.getElementById("generate-tailoring-btn");
  if (generateTailoringButton) {
    generateTailoringButton.addEventListener("click", async () => {
      try {
        if (tailoringOutput) {
          setButtonPending(generateTailoringButton, true, "生成申请包中...");
          await api(`/api/jobs/${job.id}/prepare`, { method: "POST" });
          renderPrep(job.id, "岗位定制申请包已生成。");
        } else {
          setButtonPending(generateTailoringButton, true, "生成定制简历中...");
          await api(`/api/jobs/${job.id}/tailor`, { method: "POST" });
          renderPrep(job.id, "岗位定制简历已生成，可继续编辑并生成申请准备包。");
        }
      } catch (error) {
        setButtonPending(generateTailoringButton, false);
        renderPrep(job.id, "", error.message);
      }
    });
  }

  document.getElementById("mark-prep-ready").addEventListener("click", async () => {
    const button = document.getElementById("mark-prep-ready");
    try {
      setButtonPending(button, true, "检查中...");
      const formData = new FormData(document.getElementById("prep-form"));
      const checklist = draft.checklist.map((_, index) => ({
        key: String(formData.get(`checklist_key_${index}`) || ""),
        label: String(formData.get(`checklist_label_${index}`) || ""),
        completed: Boolean(formData.get(`checklist_completed_${index}`))
      }));

      const payload = {
        targetKeywords: String(formData.get("targetKeywords") || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        tailoredResumeBullets: formData.get("tailoredResumeBullets"),
        tailoredSummary: formData.get("tailoredSummary"),
        whyMe: formData.get("whyMe"),
        selfIntroShort: formData.get("selfIntroShort"),
        selfIntroMedium: formData.get("selfIntroMedium"),
        qaDraft: formData.get("qaDraft"),
        talkingPoints: formData.get("talkingPoints"),
        coverNote: formData.get("coverNote"),
        outreachNote: formData.get("outreachNote"),
        checklist
      };

      const saved = await api(`/api/jobs/${job.id}/prep/save`, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      if (!saved.prepReady) {
        setButtonPending(button, false);
        renderPrep(job.id, "", "请先完成简历、自我介绍和问答草稿三项核心清单。");
        return;
      }

      await api(`/api/jobs/${job.id}/status`, {
        method: "POST",
        body: JSON.stringify({ nextStatus: "ready_to_apply" })
      });
      renderJobDetail(job.id, "申请准备已完成，岗位已进入“可投递”状态。");
    } catch (error) {
      setButtonPending(button, false);
      renderPrep(job.id, "", error.message);
    }
  });

  const exportDocxButton = document.getElementById("export-docx-btn");
  if (exportDocxButton) {
    exportDocxButton.addEventListener("click", async () => {
      try {
        setButtonPending(exportDocxButton, true, "导出中...");
        await downloadFromApi(`/api/jobs/${job.id}/export-docx`, `${job.company}-${job.title}.docx`);
        renderPrep(job.id, "DOCX 已导出。");
      } catch (error) {
        setButtonPending(exportDocxButton, false);
        renderPrep(job.id, "", error.message);
      }
    });
  }
}

async function renderInterviews() {
  setActiveNav("#/interviews");
  title.textContent = "面试复盘";
  subtitle.textContent = "记录面试问题、复盘改进点，并把洞察回流到求职策略。";
  const jobs = await api("/api/jobs");

  app.innerHTML = `
    <div class="panel">
      <form id="reflection-form" class="stack">
        <div class="split">
          <label>岗位
            <select name="jobId">
              ${jobs.jobs.map((job) => `<option value="${job.id}">${escapeHtml(job.company)} / ${escapeHtml(job.title)}</option>`).join("")}
            </select>
          </label>
          <label>轮次名称<input name="roundName" value="Hiring Manager 初面" /></label>
        </div>
        <div class="split">
          <label>面试官类型<input name="interviewerType" value="Hiring Manager" /></label>
          <label>面试时间<input name="interviewDate" value="${new Date().toISOString()}" /></label>
        </div>
        <label>面试问题<textarea name="questionsAsked">你通常如何和工程团队协作？
为什么你想做这类岗位？</textarea></label>
        <label>补充笔记<textarea name="notes">需要准备更具体的跨团队协作案例。</textarea></label>
        <button class="button primary" type="submit">生成复盘</button>
      </form>
    </div>
    <div id="reflection-result" style="margin-top:16px;"></div>
  `;

  document.getElementById("reflection-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    try {
      setButtonPending(button, true, "生成中...");
      const payload = Object.fromEntries(new FormData(event.target).entries());
      payload.questionsAsked = String(payload.questionsAsked)
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
      const data = await api("/api/interviews/reflect", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      document.getElementById("reflection-result").innerHTML = sectionCard(
        "复盘结果",
        `<p>${escapeHtml(data.reflection.summary)}</p>
         <h4>改进建议</h4>
         <ul class="list">${data.reflection.improvementActions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      );
    } catch (error) {
      document.getElementById("reflection-result").innerHTML = renderNotice("error", error.message);
      setButtonPending(button, false);
    }
  });
}

async function renderProfile(message = "", errorMessage = "") {
  setActiveNav("#/profile");
  title.textContent = "个人画像";
  subtitle.textContent = "编辑并保存求职画像，供评估和申请准备真实读取。";
  renderLoadingState("加载个人画像", "正在同步画像与原始简历状态...");
  const [profileData, resumeData] = await Promise.all([api("/api/profile"), api("/api/resume")]);
  const profile = profileData.profile || {};
  const resumeVm = createResumeViewModel(resumeData.resumeDocument || null);

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    <div class="panel">
      <form id="profile-form" class="stack">
        <div class="split">
          <label>姓名<input name="name" value="${escapeHtml(profile.name || profile.fullName || "")}" required /></label>
          <label>背景简介<input name="background" value="${escapeHtml(profile.background || profile.headline || "")}" required /></label>
        </div>
        <div class="split">
          <label>工作年限<input name="yearsOfExperience" type="number" min="0" value="${escapeHtml(profile.yearsOfExperience || 0)}" /></label>
          <label>目标岗位<input name="targetRoles" value="${escapeHtml((profile.targetRoles || []).join(", "))}" /></label>
        </div>
        <div class="split">
          <label>目标行业<input name="targetIndustries" value="${escapeHtml((profile.targetIndustries || []).join(", "))}" /></label>
          <label>目标地点<input name="targetLocations" value="${escapeHtml((profile.targetLocations || profile.preferredLocations || []).join(", "))}" /></label>
        </div>
        <label>优势<textarea name="strengths">${escapeHtml((profile.strengths || []).join(", "))}</textarea></label>
        <label>限制条件<textarea name="constraints">${escapeHtml((profile.constraints || []).join(", "))}</textarea></label>
        <div class="panel">
          <h4>原始简历</h4>
          <div class="muted">上传 PDF 或 DOCX 后，系统会提取简历文本，用于岗位定制申请准备。</div>
          <div class="stack" style="margin-top:12px;">
            <div class="info-grid">
              <div class="panel">
                <strong>文件</strong>
                <div class="muted">${escapeHtml(resumeVm.fileName)}</div>
              </div>
              <div class="panel">
                <strong>解析状态</strong>
                <div class="muted">${escapeHtml(resumeVm.statusLabel)} · ${escapeHtml(resumeVm.parseStatusCode)}</div>
              </div>
              <div class="panel">
                <strong>上传时间</strong>
                <div class="muted">${escapeHtml(resumeVm.uploadedAtText)}</div>
              </div>
              <div class="panel">
                <strong>提取方式</strong>
                <div class="muted">${escapeHtml(resumeVm.extractionMethodLabel)}</div>
              </div>
              <div class="panel">
                <strong>解析质量</strong>
                <div class="muted">${escapeHtml(resumeVm.parseQualityLabel)}（${escapeHtml(String(resumeVm.parseQualityScore))}）</div>
              </div>
            </div>
            ${resumeVm.parseWarning ? `<div class="notice warning">${escapeHtml(resumeVm.parseWarning)}</div>` : ""}
            <div class="muted">${escapeHtml(resumeVm.summary)}</div>
            ${
              resumeVm.exists
                ? `
                    <div class="muted">推荐说明：DOCX 解析通常比 PDF 更稳定；如果当前质量较低，建议优先上传 DOCX。</div>
                    <div class="muted">技能：${escapeHtml(resumeVm.skills.slice(0, 8).join(" / ") || "暂无")} ｜ 亮点：${escapeHtml(resumeVm.highlights.slice(0, 4).join(" / ") || "暂无")}</div>
                    <div class="info-grid">
                      <div class="panel">
                        <strong>经历摘要</strong>
                        <ul class="list list-tight">${resumeVm.experience.slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无结构化经历。</li>"}</ul>
                      </div>
                      <div class="panel">
                        <strong>教育信息</strong>
                        <ul class="list list-tight">${resumeVm.education.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无结构化教育信息。</li>"}</ul>
                      </div>
                    </div>
                  `
                : `<div class="muted">你还没有上传原始简历，上传后才能生成岗位定制申请内容。</div>`
            }
            <div id="resume-upload-feedback"></div>
            <div class="toolbar">
              <input type="file" id="resume-file-input" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
              <button class="button" type="button" id="resume-upload-btn">上传并解析原始简历</button>
            </div>
          </div>
        </div>
        <div class="panel">
          <h4>策略控制</h4>
          <label>风险偏好覆盖
            <select name="riskToleranceOverride">
              <option value="" ${!(profile.policyPreferences?.riskToleranceOverride) ? "selected" : ""}>自动</option>
              <option value="low" ${profile.policyPreferences?.riskToleranceOverride === "low" ? "selected" : ""}>低</option>
              <option value="medium" ${profile.policyPreferences?.riskToleranceOverride === "medium" ? "selected" : ""}>中</option>
              <option value="high" ${profile.policyPreferences?.riskToleranceOverride === "high" ? "selected" : ""}>高</option>
            </select>
          </label>
          <label>我仍然想投这类岗位
            <input name="manualPreferredRoles" value="${escapeHtml((profile.policyPreferences?.manualPreferredRoles || []).join(", "))}" placeholder="例如 产品策略, 增长策略" />
          </label>
          <label>忽略系统对这些高风险岗位方向的建议
<input name="ignoredRiskyRoles" value="${escapeHtml((profile.policyPreferences?.ignoredRiskyRoles || []).join(", "))}" placeholder="例如 运营, 技术产品经理" />
          </label>
        </div>
        <label>主简历<textarea name="masterResume" required>${escapeHtml(profile.masterResume || profile.baseResume || "")}</textarea></label>
        <div class="toolbar">
          <button class="button primary" type="submit">保存个人画像</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById("profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const button = event.target.querySelector('button[type="submit"]');
      setButtonPending(button, true, "保存中...");
      const payload = Object.fromEntries(new FormData(event.target).entries());
      await api("/api/profile/save", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      renderProfile("个人画像已保存。");
    } catch (error) {
      renderProfile("", error.message);
    }
  });

  const uploadButton = document.getElementById("resume-upload-btn");
  const fileInput = document.getElementById("resume-file-input");
  const feedback = document.getElementById("resume-upload-feedback");
  uploadButton.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      feedback.innerHTML = renderNotice("warning", "请先选择一个 PDF 或 DOCX 简历文件。");
      return;
    }
    try {
      setButtonPending(uploadButton, true, "解析中...");
      feedback.innerHTML = renderNotice("info", "正在上传并解析原始简历，请稍候...");
      const base64Data = await readFileAsBase64(file);
      const result = await api("/api/resume/upload", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : ""),
          base64Data
        })
      });
      const uploadedResume = createResumeViewModel(result.resumeDocument);
      renderProfile(
        `原始简历已上传：${uploadedResume.fileName}（${uploadedResume.statusLabel}）`,
        uploadedResume.parseWarning || ""
      );
    } catch (error) {
      setButtonPending(uploadButton, false);
      feedback.innerHTML = renderNotice("error", error.message || "上传简历失败，请稍后重试。");
    }
  });
}

async function route() {
  const hash = window.location.hash || "#/dashboard";
  const parts = hash.slice(2).split("/");

  try {
    const session = await fetchAuthSession();
    if (!session.authenticated) {
      const demoSession = await ensureDemoSession();
      if (!demoSession.authenticated) {
        await renderUnauthenticatedWorkspace("无法创建演示会话，请稍后重试。");
        return;
      }
    }
    if (parts[0] === "dashboard" || parts[0] === "") {
      await renderDashboard();
      return;
    }
    if (parts[0] === "jobs" && parts[1] === "new") {
      await renderNewJob();
      return;
    }
    if (parts[0] === "jobs" && parts[1] && parts[2] === "tailoring") {
      await renderTailoringWorkspace(parts[1]);
      return;
    }
    if (parts[0] === "jobs" && parts[1]) {
      await renderJobDetail(parts[1]);
      return;
    }
    if (parts[0] === "jobs") {
      await renderJobs();
      return;
    }
    if (parts[0] === "governance") {
      await renderGovernance();
      return;
    }
    if (parts[0] === "prep") {
      await renderPrep(parts[1]);
      return;
    }
    if (parts[0] === "interviews") {
      await renderInterviews();
      return;
    }
    if (parts[0] === "profile") {
      await renderProfile();
      return;
    }
    await renderDashboard();
  } catch (error) {
    if (error.code === "UNAUTHENTICATED" || /Authentication required/i.test(error.message)) {
      authSession = { authenticated: false, user: null };
      updateAuthChrome();
      await renderUnauthenticatedWorkspace("登录状态已过期，请重新进入系统。");
      return;
    }
    app.innerHTML = `<div class="panel"><h3>出现问题</h3><p>${escapeHtml(localizeErrorMessage(error.message))}</p></div>`;
  }
}

logoutButton?.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch (error) {
    // Best effort logout: always clear local auth chrome and return to login screen.
  }
  authSession = { authenticated: false, user: null };
  updateAuthChrome();
  window.location.hash = "#/dashboard";
  await renderUnauthenticatedWorkspace("你已退出登录。");
});

window.addEventListener("hashchange", route);
route();
