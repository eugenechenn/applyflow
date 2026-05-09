const app = document.getElementById("app");
const title = document.getElementById("page-title");
const subtitle = document.getElementById("page-subtitle");
const currentUserLabel = document.getElementById("current-user");
const logoutButton = document.getElementById("logout-button");
let selectedPolicyProposalId = null;
let authSession = { authenticated: false, user: null };
const DEMO_AUTO_LOGIN_EMAIL = "eugene@example.com";
let autoLoginAttempted = false;
let discoveryFlashMessage = "";
let discoveryFlashError = "";
let onboardingBootstrapContext = null;

const DISCOVERY_FEISHU_SAMPLE_LEADS = [
  {
    title: "AI Product Manager",
    company: "Lingxi AI",
    location: "Shanghai",
    contentText:
      "招聘公告：AI Product Manager，负责 Agent 产品规划、模型能力落地和增长闭环。JD 已开放直接投递，请查看职位详情并尽快申请。",
    links: [
      {
        url: "https://jobs.example.com/lingxi-ai/pm-001",
        label: "立即投递",
        type: "direct_apply",
        isPrimary: true
      }
    ],
    images: [],
    attachments: [],
    sourceUrl: "https://jobs.example.com/lingxi-ai/pm-001"
  },
  {
    title: "AI Strategy PM",
    company: "Nova Agent",
    location: "Shanghai",
    contentText:
      "招聘公告：AI Strategy PM，Base 上海，负责 Agent 产品策略与商业化推进，需要 3 年以上产品经验，熟悉 LLM 应用。公告正文已包含主要职责、要求和官网申请入口。",
    links: [
      {
        url: "https://careers.nova-agent.cn/jobs/pm-strategy",
        label: "公告详情",
        type: "announcement",
        isPrimary: true
      }
    ],
    images: [],
    attachments: []
  },
  {
    title: "",
    company: "",
    location: "",
    contentText: "扫码投递，请使用小程序提交申请。",
    links: [],
    images: [{ name: "qr.png", note: "校招二维码" }],
    attachments: [],
    sourceUrl: ""
  }
];

function stringifyDiscoverySample() {
  return JSON.stringify(DISCOVERY_FEISHU_SAMPLE_LEADS, null, 2);
}

function getDiscoveryDocName(intent = null, leadResolutionViewModel = null) {
  const fromVm = leadResolutionViewModel?.summary?.docName || "";
  const fromIntent = intent?.docName || "";
  return String(fromVm || fromIntent || "feishu-leads-manual").trim();
}

function renderRankingSection(intentId = "", rankingResult = null) {
  const items = Array.isArray(rankingResult?.rankedItems) ? rankingResult.rankedItems : [];
  if (!items.length) {
    return `<div class="notice info">暂无排序结果。</div>`;
  }

  const rows = items.slice(0, 12).map((item, index) => {
    const listingId = String(item?.listingId || "");
    const score = Number(item?.priorityScore || 0);
    const recommendation = String(item?.recommendation || "unknown");
    const recommendationLabelMap = {
      apply: "建议投递",
      cautious: "谨慎推进",
      skip: "暂不优先",
      hold: "建议暂缓",
      unknown: "待判断"
    };
    const recommendationLabel = recommendationLabelMap[recommendation] || recommendation;
    const whyRanked = String(item?.whyRanked || "").trim();
    const nextAction = String(item?.nextAction || "").trim();
    const clusterId = String(item?.clusterId || "").trim();
    return `
      <div class="panel">
        <div class="split">
          <div>
            <strong>#${index + 1}</strong>
            <div class="muted mono">${escapeHtml(listingId || "-")}</div>
          </div>
          <div style="text-align:right;">
            <strong>${escapeHtml(String(score))}</strong>
            <div class="muted">${escapeHtml(recommendationLabel)}</div>
          </div>
        </div>
        ${clusterId ? `<div class="muted">分组：${escapeHtml(clusterId)}</div>` : ""}
        ${whyRanked ? `<div class="muted">排序原因：${escapeHtml(whyRanked)}</div>` : ""}
        ${nextAction ? `<div class="muted">下一步：${escapeHtml(nextAction)}</div>` : ""}
      </div>
    `;
  });

  const intentHint = intentId ? `<div class="muted">意图 ID：<span class="mono">${escapeHtml(intentId)}</span></div>` : "";
  return `
    ${intentHint}
    <div class="stack">
      ${rows.join("")}
    </div>
  `;
}

function renderShortlistSection(intentId = "", shortlistResult = null) {
  if (!shortlistResult || typeof shortlistResult !== "object") {
    return `<div class="notice info">暂无候选清单结果。</div>`;
  }

  const shortlisted = Array.isArray(shortlistResult.shortlistedItems) ? shortlistResult.shortlistedItems : [];
  const holdItems = Array.isArray(shortlistResult.holdItems) ? shortlistResult.holdItems : [];
  const skippedItems = Array.isArray(shortlistResult.skippedItems) ? shortlistResult.skippedItems : [];
  const selectedIds = Array.isArray(shortlistResult.selectedListingIds) ? shortlistResult.selectedListingIds : [];

  const renderItems = (items = [], titleText = "") => {
    if (!items.length) {
      return `<div class="muted">${escapeHtml(titleText)}：0</div>`;
    }
    return `
      <div class="panel">
        <strong>${escapeHtml(titleText)}（${items.length}）</strong>
        <div class="stack" style="margin-top:8px;">
          ${items
            .slice(0, 8)
            .map((item) => {
              const listingId = String(item?.listingId || "");
              const reason = String(item?.selectionReason || item?.reason || "").trim();
              return `<div class="muted"><span class="mono">${escapeHtml(listingId || "-")}</span>${reason ? ` · ${escapeHtml(reason)}` : ""}</div>`;
            })
            .join("")}
        </div>
      </div>
    `;
  };

  return `
    ${intentId ? `<div class="muted">意图 ID：<span class="mono">${escapeHtml(intentId)}</span></div>` : ""}
    <div class="stack">
      <div class="muted">已选岗位数：${escapeHtml(String(selectedIds.length))}</div>
      ${renderItems(shortlisted, "已入候选清单")}
      ${renderItems(holdItems, "待观察")}
      ${renderItems(skippedItems, "已跳过")}
    </div>
  `;
}

function renderLeadResolutionSection(leadResolutionViewModel = null) {
  const summary = leadResolutionViewModel?.summary || {};
  const items = Array.isArray(leadResolutionViewModel?.items) ? leadResolutionViewModel.items : [];
  if (!items.length) {
    return `<div class="notice info">当前没有待处理的受限线索。</div>`;
  }

  return `
    <div class="stack">
      <div class="muted">
        受限线索：${escapeHtml(String(summary.totalBlocked || items.length))} · 导入时间：${escapeHtml(formatDateTime(summary.importedAt || ""))}
      </div>
      ${items
        .slice(0, 16)
        .map((item) => {
          const leadType = String(item?.leadType || "incomplete");
          const routing = String(item?.routing || "manual_enrich_queue");
          const reason = String(item?.reason || "").trim();
          const warnings = Array.isArray(item?.warnings) ? item.warnings : [];
          const availableActions = Array.isArray(item?.availableActions) ? item.availableActions : [];
          const company = String(item?.displayData?.company || "");
          const titleText = String(item?.displayData?.title || "");
          const sourceUrl = String(item?.displayData?.sourceUrl || "");
          return `
            <div class="panel">
              <div class="split">
                <div>
                  <strong>${escapeHtml(titleText || company || "受限线索")}</strong>
                  <div class="muted">${escapeHtml(company || "-")}</div>
                </div>
                <div style="text-align:right;">
                  <span class="status warning">${escapeHtml(leadType)}</span>
                  <div class="muted">${escapeHtml(routing)}</div>
                </div>
              </div>
              ${reason ? `<div class="muted">原因：${escapeHtml(reason)}</div>` : ""}
              ${
                warnings.length
                  ? `<div class="muted">提示：${escapeHtml(warnings.join(" | "))}</div>`
                  : ""
              }
              ${
                availableActions.length
                  ? `<div class="muted">可用动作：${escapeHtml(availableActions.map((action) => action?.label || action?.actionId || "").filter(Boolean).join(" / "))}</div>`
                  : `<div class="muted">可用动作：-</div>`
              }
              ${sourceUrl ? `<a class="text-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">打开原始链接</a>` : ""}
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function attachDiscoveryActionHandlers() {
  // Recovery-safe stub: keep discovery page renderable even if admin actions are unavailable.
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeJoin(value, separator = ", ") {
  return ensureArray(value).join(separator);
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
    let code = "";
    let details = null;
    try {
      const payload = await response.json();
      message = localizeErrorMessage(payload.error?.message || message);
      code = payload.error?.code || "";
      details = payload.error?.details || null;
    } catch (error) {
      console.error("导出接口返回非 JSON 响应", error);
    }
    const exportError = new Error(message);
    exportError.code = code;
    exportError.details = details;
    throw exportError;
  }
  const blob = await response.blob();
  const header = response.headers.get("content-disposition") || "";
  const matchedName = header.match(/filename\\*=UTF-8''([^;]+)/i);
  const fileName = matchedName ? decodeURIComponent(matchedName[1]) : fallbackFileName;
  const exportSummaryHeader = response.headers.get("x-applyflow-export-summary") || "";
  let exportSummary = null;
  if (exportSummaryHeader) {
    try {
      exportSummary = JSON.parse(decodeURIComponent(exportSummaryHeader));
    } catch (error) {
      console.error("导出摘要头解析失败", error);
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return {
    fileName,
    exportSummary
  };
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

function renderExportStatusCard(summary = null, fallbackStatus = "") {
  if (!summary || typeof summary !== "object") return "";
  const artifactMeta = summary.artifactMeta && typeof summary.artifactMeta === "object" ? summary.artifactMeta : {};
  const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
  const errors = Array.isArray(summary.errors) ? summary.errors : [];
  const exportStatus = summary.exportStatus || fallbackStatus || "";
  const statusClass = exportStatus === "failed" ? "error" : exportStatus === "exported" ? "success" : "warning";
  return `
    <div class="panel" style="margin-top:10px;">
      <div class="eyebrow">导出结果</div>
      <div><strong>${escapeHtml(String(summary.exportFormat || "").toUpperCase() || "导出文件")}</strong> / <span class="notice ${statusClass}" style="display:inline-block;padding:2px 8px;margin:0;">${escapeHtml(localizeExecutionLabel(exportStatus || "unknown"))}</span></div>
      <div class="muted">文件：${escapeHtml(summary.artifactName || "-")}</div>
      <div class="muted">格式：${escapeHtml(artifactMeta.mimeType || "-")}，扩展名：${escapeHtml(artifactMeta.extension || "-")}，大小：${escapeHtml(String(artifactMeta.sizeBytes ?? "-"))}</div>
      <div class="muted">追踪来源：${escapeHtml(summary.trace?.source || "-")} / ${escapeHtml(summary.trace?.runId || "-")}</div>
      ${warnings.length ? `<div class="notice warning" style="margin-top:8px;">提醒：${escapeHtml(warnings.join(" | "))}</div>` : ""}
      ${errors.length ? `<div class="notice error" style="margin-top:8px;">错误：${escapeHtml(errors.join(" | "))}</div>` : ""}
    </div>
  `;
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

// 顶层数组归一化：兼容数组/逗号字符串/空值，避免局部 helper 作用域漂移
function toArraySafe(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeLightweightProfileFallback(profile = {}) {
  const source =
    profile?.lightweightProfile && typeof profile.lightweightProfile === "object" ? profile.lightweightProfile : profile;

  return {
    targetRoles: toArraySafe(source?.targetRoles ?? profile?.targetRoles ?? []),
    skills: toArraySafe(source?.skills ?? profile?.strengths ?? []),
    preferredLocations: toArraySafe(source?.preferredLocations ?? profile?.preferredLocations ?? profile?.targetLocations ?? []),
    degree: String(source?.degree || "").trim(),
    acceptsNonTech: Boolean(source?.acceptsNonTech)
  };
}

const DEFAULT_JOB_PREFERENCE_WEIGHTS = Object.freeze({
  industry: 25,
  role: 35,
  skill: 10,
  location: 20,
  company: 10
});

// 全局去重辅助：仅依赖顶层 toArraySafe，避免运行时 ReferenceError
const uniqueList = (value = []) => [...new Set(toArraySafe(value))];
// 兼容别名：防止旧调用缓存或残留引用 unique(...)
const unique = uniqueList;

function normalizeJobPreferenceProfileFallback(profile = {}) {
  const source =
    profile?.jobPreferenceProfile && typeof profile.jobPreferenceProfile === "object"
      ? profile.jobPreferenceProfile
      : profile;
  const lightweight = normalizeLightweightProfileFallback(profile);
  const normalizeJobType = (value) => {
    const text = String(value || "").trim();
    if (text === "校招" || text === "实习" || text === "社招" || text === "不限") return text;
    return "不限";
  };

  return {
    preferredIndustries: uniqueList(source?.preferredIndustries ?? profile?.targetIndustries ?? []),
    excludedIndustries: uniqueList(source?.excludedIndustries ?? []),
    targetRoles: uniqueList(source?.targetRoles ?? lightweight.targetRoles ?? []),
    excludedRoles: uniqueList(source?.excludedRoles ?? []),
    skills: uniqueList(source?.skills ?? lightweight.skills ?? []),
    preferredLocations: uniqueList(source?.preferredLocations ?? lightweight.preferredLocations ?? []),
    companyTypes: uniqueList(source?.companyTypes ?? []),
    avoidCompanyTypes: uniqueList(source?.avoidCompanyTypes ?? []),
    jobType: normalizeJobType(source?.jobType || profile?.jobType || "不限"),
    priorityWeights:
      source?.priorityWeights && typeof source.priorityWeights === "object"
        ? source.priorityWeights
        : DEFAULT_JOB_PREFERENCE_WEIGHTS
  };
}

const ONBOARDING_PROFILE_LOCAL_KEY = "applyflow.onboarding.profile";
const DISCOVERY_LAST_INTENT_LOCAL_KEY = "applyflow.discovery.lastIntentId";
const JOBS_TRACKER_FILTER_LOCAL_KEY = "applyflow.jobs.trackerFilter";
const JOBS_SHORTLIST_FILTER_LOCAL_KEY = "applyflow.jobs.shortlistFilter";
const JOBS_FIRST_ENTRY_GUARD_SESSION_KEY = "applyflow.jobs.firstEntryGuard.v1";
const ROUTE_DATA_LOAD_TIMEOUT_MS = 12000;

function readJsonFromLocalStorage(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function writeJsonToLocalStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Best effort only, never block runtime rendering.
  }
}

function readSessionFlag(key = "") {
  try {
    if (!key) return "";
    return String(window.sessionStorage.getItem(key) || "").trim();
  } catch (_error) {
    return "";
  }
}

function writeSessionFlag(key = "", value = "1") {
  try {
    if (!key) return;
    window.sessionStorage.setItem(key, String(value || "1"));
  } catch (_error) {
    // Best effort only, never block runtime rendering.
  }
}

async function apiWithTimeout(path, options = {}, timeoutMs = ROUTE_DATA_LOAD_TIMEOUT_MS) {
  const safeTimeout = Number.isFinite(Number(timeoutMs)) ? Math.max(1000, Number(timeoutMs)) : ROUTE_DATA_LOAD_TIMEOUT_MS;
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`请求超时：${path}`);
      error.code = "REQUEST_TIMEOUT";
      reject(error);
    }, safeTimeout);
  });
  try {
    return await Promise.race([api(path, options), timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function readOnboardingProfileLocal() {
  const value = readJsonFromLocalStorage(ONBOARDING_PROFILE_LOCAL_KEY);
  if (!value || typeof value !== "object") {
    return {
      lightweightProfile: {},
      jobPreferenceProfile: {}
    };
  }
  // 兼容旧缓存：历史仅保存 lightweightProfile 数组结构。
  if (!("lightweightProfile" in value) && !("jobPreferenceProfile" in value)) {
    const normalizedLegacy = normalizeLightweightProfileSafe(value);
    return {
      lightweightProfile: normalizedLegacy,
      jobPreferenceProfile: normalizeJobPreferenceProfileFallback({
        lightweightProfile: normalizedLegacy
      })
    };
  }
  const lightweightProfile = normalizeLightweightProfileSafe({
    lightweightProfile:
      value.lightweightProfile && typeof value.lightweightProfile === "object" ? value.lightweightProfile : {}
  });
  const jobPreferenceProfile = normalizeJobPreferenceProfileFallback({
    lightweightProfile,
    jobPreferenceProfile:
      value.jobPreferenceProfile && typeof value.jobPreferenceProfile === "object" ? value.jobPreferenceProfile : {}
  });
  return { lightweightProfile, jobPreferenceProfile };
}

function saveOnboardingProfileLocal(profile = {}) {
  const lightweightProfile = normalizeLightweightProfileSafe(profile);
  const jobPreferenceProfile = normalizeJobPreferenceProfileFallback({
    ...profile,
    lightweightProfile
  });
  writeJsonToLocalStorage(ONBOARDING_PROFILE_LOCAL_KEY, {
    lightweightProfile,
    jobPreferenceProfile
  });
}

function readLastDiscoveryIntentId() {
  try {
    const value = String(window.localStorage.getItem(DISCOVERY_LAST_INTENT_LOCAL_KEY) || "").trim();
    return value;
  } catch (error) {
    return "";
  }
}

function rememberDiscoveryIntentId(intentId = "") {
  const value = String(intentId || "").trim();
  if (!value) return;
  try {
    window.localStorage.setItem(DISCOVERY_LAST_INTENT_LOCAL_KEY, value);
  } catch (error) {
    // Best effort only.
  }
}

function normalizeLightweightProfileSafe(profile = {}) {
  try {
    if (typeof normalizeLightweightProfile === "function") {
      return normalizeLightweightProfile(profile);
    }
  } catch (error) {
    // Fall through to fallback normalizer for recovery safety.
  }
  return normalizeLightweightProfileFallback(profile);
}

function isOnboardingCompleteSafe(profile = {}) {
  try {
    if (typeof isOnboardingComplete === "function") {
      return isOnboardingComplete(profile);
    }
  } catch (error) {
    // Fall through to fallback checker for recovery safety.
  }
  const normalized = normalizeLightweightProfileSafe(profile);
  return Boolean(normalized.targetRoles.length && normalized.preferredLocations.length);
}

function consumeOnboardingBootstrapContext() {
  const cached = onboardingBootstrapContext && typeof onboardingBootstrapContext === "object" ? onboardingBootstrapContext : null;
  onboardingBootstrapContext = null;
  return cached;
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
    reasonText: localizeDisplayContent(proposal.reasonSummary || "暂无提案原因说明。", "fit"),
    diffSummaryText: localizeDisplayContent(ensureArray(proposal.diffSummary).slice(0, 2).join(" ") || "暂无策略变更摘要。", "fit"),
    createdAtText: proposal.createdAt ? new Date(proposal.createdAt).toLocaleString() : "暂无",
    reviewerNoteText: localizeDisplayContent(proposal.reviewerNote || "暂无审核备注。", "fit"),
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
    preferredRolesSummary: safeJoin(policy.preferredRoles, ", ") || "还在学习中",
    riskyRolesSummary: safeJoin(policy.riskyRoles, ", ") || "暂无",
    shortSummaryText: localizeDisplayContent(policy.policySummary || "当前暂无可展示的全局策略摘要。", "fit"),
    preferredRolesCount: ensureArray(policy.preferredRoles).length,
    riskyRolesCount: ensureArray(policy.riskyRoles).length,
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
    summaryText: localizeDisplayContent(event.summary || "暂无可展示的审计摘要。", "timeline"),
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
        ? `建议谨慎推进：${ensureArray(fitAssessment.riskFlags).slice(0, 2).join(" / ") || "请优先核对关键风险"}`
        : "",
    usedBullets,
    unusedBullets,
    completedCount,
    checklistCount: checklist.length,
    raw: prep
  };
}

function deriveJobStateFromWorkspaceViewModel(data = {}, jobId = "") {
  const workspaceVm = data.jobWorkspaceViewModel || {};
  if (!workspaceVm || !workspaceVm.id) {
    return { job: null, fitAssessment: null, workspaceVm: null };
  }
  const jobSummaryVm = workspaceVm.jobSummary || {};
  const decisionVm = workspaceVm.decisionView || {};
  const controlVm = workspaceVm.controlView || {};
  const feedbackVm = workspaceVm.feedbackView || {};
  const inferredStrategyDecision =
    decisionVm.nextAction === "skip"
      ? "avoid"
      : decisionVm.nextAction === "collect_info"
        ? "cautious_proceed"
        : decisionVm.nextAction === "hold"
          ? "deprioritize"
          : "proceed";

  const job = {
    id: workspaceVm.id || jobId,
    title: jobSummaryVm.title || "未命名岗位",
    company: jobSummaryVm.company || "未知公司",
    location: jobSummaryVm.location || "地点未说明",
    sourceUrl: jobSummaryVm.sourceUrl || "",
    status: jobSummaryVm.status || "inbox",
    strategyDecision: inferredStrategyDecision,
    updatedAt: feedbackVm.lastUpdatedAt || new Date().toISOString()
  };

  const fitAssessment = {
    recommendation: decisionVm.recommendation || "cautious",
    fitScore: decisionVm.fitScore ?? null,
    decisionSummary: decisionVm.summary || decisionVm.rationale || "",
    strategyReasoning: decisionVm.rationale || decisionVm.summary || "",
    whyApply: Array.isArray(decisionVm.evidence) ? decisionVm.evidence : [],
    keyGaps: Array.isArray(decisionVm.gaps) ? decisionVm.gaps : [],
    riskFlags: Array.isArray(decisionVm.risks) ? decisionVm.risks : [],
    suggestedAction: decisionVm.nextAction || "",
    strategyDecision: inferredStrategyDecision,
    confidence: 0,
    overrideApplied: Boolean(feedbackVm.hasUserOverride),
    overrideSummary: feedbackVm.hasUserOverride ? "user_override" : "",
    activePolicyVersion: data.governanceView?.globalPolicy?.version
      ? `策略版本 ${data.governanceView.globalPolicy.version}`
      : ""
  };

  return { job, fitAssessment, workspaceVm };
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

function createResumeViewModel(resumeView = null) {
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
  const model = resumeView && typeof resumeView === "object" ? resumeView : {};
  const parseStatusCode = String(model.parseStatus || "missing");
  const parseQualityCode = String(model.parseQuality || "low");
  return {
    exists: Boolean(model.resumeId),
    id: model.resumeId || "",
    fileName: model.fileName || "未上传原始简历",
    parseStatusCode,
    statusLabel: statusMap[parseStatusCode] || "未上传",
    uploadedAtText: formatDateTime(model.uploadedAt || ""),
    extractionMethod: "canonical_resume_vm",
    extractionMethodLabel: "标准化简历视图",
    parseQualityLabel: qualityLabelMap[parseQualityCode] || "未知",
    parseQualityScore: Number(model.parseQualityScore || 0),
    parseWarning: (Array.isArray(model.warnings) ? model.warnings : []).join(" / "),
    summary:
      model.resumeSummary ||
      "上传 PDF 或 DOCX 后，系统会提取简历文本并为后续岗位定制申请准备提供真实素材。",
    skills: Array.isArray(model.sections?.skills) ? model.sections.skills : [],
    highlights: Array.isArray(model.highlights) ? model.highlights : [],
    experience: Array.isArray(model.sections?.workExperience) ? model.sections.workExperience : [],
    education: Array.isArray(model.sections?.projectExperience) ? model.sections.projectExperience : []
  };
}

function assessMasterResumeContent(editDto = {}) {
  const dto = editDto && typeof editDto === "object" ? editDto : {};
  const basicInfo = dto.basicInfo && typeof dto.basicInfo === "object" ? dto.basicInfo : {};
  const summary = String(dto.summary || "").trim();
  const workExperience = Array.isArray(dto.workExperience) ? dto.workExperience : [];
  const projectExperience = Array.isArray(dto.projectExperience) ? dto.projectExperience : [];
  const skills = Array.isArray(dto.skills) ? dto.skills : [];

  const hasBasicIdentity = Boolean(
    String(basicInfo.name || "").trim() ||
      String(basicInfo.email || "").trim() ||
      String(basicInfo.phone || "").trim()
  );
  const hasNarrative = summary.length >= 20;
  const hasExperience = workExperience.length + projectExperience.length >= 1;
  const hasSkills = skills.length >= 2;
  const signalCount = [hasBasicIdentity, hasNarrative, hasExperience, hasSkills].filter(Boolean).length;

  return {
    hasBasicIdentity,
    hasNarrative,
    hasExperience,
    hasSkills,
    signalCount,
    score: signalCount / 4
  };
}

function buildResumeReadinessViewModel({ resumeVm = null, masterResumeEditDto = null, tailoredResumeContract = null } = {}) {
  const resume = resumeVm && typeof resumeVm === "object" ? resumeVm : createResumeViewModel(null);
  const masterSignals = assessMasterResumeContent(masterResumeEditDto || {});
  const hasTailoredSource = Boolean(tailoredResumeContract?.masterResumeId || tailoredResumeContract?.tailoredResumeId);
  const parseStatus = String(resume.parseStatusCode || "missing");
  const parseSuccess = parseStatus === "parse_success" || parseStatus === "parsed";
  const parsePartial = parseStatus === "parse_partial" || parseStatus === "partial";
  const parseFailed = parseStatus === "parse_failed" || parseStatus === "failed";

  if (!resume.exists && masterSignals.signalCount <= 1 && !hasTailoredSource) {
    return {
      status: "missing",
      tone: "warning",
      label: "简历资产缺失",
      summary: "当前还没有可用简历资产。你仍可查看岗位与准备信息，但后续定制质量会受限。",
      suggestions: ["先上传 PDF / DOCX 原始简历。", "在 Profile 页补全结构化 MasterResume。"],
      canContinue: true
    };
  }

  if (parseFailed || parsePartial || masterSignals.signalCount <= 2) {
    return {
      status: "partial",
      tone: "warning",
      label: "简历资产部分可用",
      summary: "你可以继续推进 Prep，但建议先补全简历资产以提升定制与投递质量。",
      suggestions: [
        parseFailed ? "原始简历解析失败，建议重新上传（优先 DOCX）。" : "补充 MasterResume 的经历/技能信息。",
        "完善后再回到当前岗位可获得更稳定的申请材料。"
      ],
      canContinue: true
    };
  }

  return {
    status: "ready",
    tone: "success",
    label: "简历资产就绪",
    summary: "当前简历资产可支撑岗位定制与申请准备，可继续推进。",
    suggestions: ["如需进一步提升命中率，可在 Profile 页继续优化 MasterResume。"],
    canContinue: true
  };
}

function splitEditorList(value = "") {
  return String(value || "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitOnboardingList(value = "") {
  return String(value || "")
    .split(/[\n,，;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitOnboardingListSafe(value = "") {
  if (typeof splitOnboardingList === "function") {
    return splitOnboardingList(value);
  }
  if (typeof splitEditorList === "function") {
    return splitEditorList(value);
  }
  return String(value || "")
    .split(/[\n,，;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitBulletLines(value = "") {
  return String(value || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createEditableExperienceEntry(entry = {}, type = "work", index = 0) {
  const source = entry && typeof entry === "object" ? entry : {};
  return {
    id: source.id || `${type}_${index + 1}`,
    company: source.company || "",
    role: source.role || "",
    timeRange: source.timeRange || "",
    projectName: source.projectName || "",
    bullets: Array.isArray(source.bullets) ? source.bullets : []
  };
}

function createMasterResumeDraft(editDto = {}) {
  const dto = editDto && typeof editDto === "object" ? editDto : {};
  return {
    masterResumeId: dto.masterResumeId || "",
    basicInfo: {
      name: dto.basicInfo?.name || "",
      email: dto.basicInfo?.email || "",
      phone: dto.basicInfo?.phone || "",
      location: dto.basicInfo?.location || ""
    },
    summary: dto.summary || "",
    workExperience: (Array.isArray(dto.workExperience) ? dto.workExperience : []).map((entry, index) =>
      createEditableExperienceEntry(entry, "work", index)
    ),
    projectExperience: (Array.isArray(dto.projectExperience) ? dto.projectExperience : []).map((entry, index) =>
      createEditableExperienceEntry(entry, "project", index)
    ),
    education: Array.isArray(dto.education) ? dto.education : [],
    skills: Array.isArray(dto.skills) ? dto.skills : [],
    updatedAt: dto.updatedAt || ""
  };
}

function serializeMasterResumeDraft(draft = {}) {
  return {
    masterResumeId: draft.masterResumeId || "",
    basicInfo: {
      name: String(draft.basicInfo?.name || "").trim(),
      email: String(draft.basicInfo?.email || "").trim(),
      phone: String(draft.basicInfo?.phone || "").trim(),
      location: String(draft.basicInfo?.location || "").trim()
    },
    summary: String(draft.summary || "").trim(),
    workExperience: (Array.isArray(draft.workExperience) ? draft.workExperience : [])
      .map((entry, index) => ({
        id: entry.id || `work_${index + 1}`,
        company: String(entry.company || "").trim(),
        role: String(entry.role || "").trim(),
        timeRange: String(entry.timeRange || "").trim(),
        bullets: splitBulletLines(ensureArray(entry.bullets).join("\n"))
      }))
      .filter((entry) => entry.company || entry.role || entry.timeRange || entry.bullets.length),
    projectExperience: (Array.isArray(draft.projectExperience) ? draft.projectExperience : [])
      .map((entry, index) => ({
        id: entry.id || `project_${index + 1}`,
        projectName: String(entry.projectName || "").trim(),
        role: String(entry.role || "").trim(),
        timeRange: String(entry.timeRange || "").trim(),
        bullets: splitBulletLines(ensureArray(entry.bullets).join("\n"))
      }))
      .filter((entry) => entry.projectName || entry.role || entry.timeRange || entry.bullets.length),
    education: Array.isArray(draft.education) ? draft.education : [],
    skills: splitEditorList(Array.isArray(draft.skills) ? draft.skills.join(", ") : ""),
    updatedAt: draft.updatedAt || ""
  };
}

function renderMasterResumeSectionEntries(entries = [], type = "work") {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const isProject = type === "project";
  const titleLabel = isProject ? "项目名称" : "公司";
  const titleField = isProject ? "projectName" : "company";
  const emptyText = isProject ? "还没有项目经历，点击下方按钮新增一条。" : "还没有工作经历，点击下方按钮新增一条。";

  if (!safeEntries.length) {
    return `<div class="notice info">${emptyText}</div>`;
  }

  return safeEntries
    .map(
      (entry, index) => `
        <div class="master-resume-entry">
          <div class="master-resume-entry-head">
            <strong>${escapeHtml(isProject ? `项目经历 ${index + 1}` : `工作经历 ${index + 1}`)}</strong>
            <button class="button" type="button" data-action="remove-entry" data-section="${escapeHtml(type)}" data-index="${index}">删除</button>
          </div>
          <div class="split">
            <label>${titleLabel}<input data-section="${escapeHtml(type)}" data-index="${index}" data-field="${titleField}" value="${escapeHtml(entry[titleField] || "")}" /></label>
            <label>角色<input data-section="${escapeHtml(type)}" data-index="${index}" data-field="role" value="${escapeHtml(entry.role || "")}" /></label>
          </div>
          <label>时间范围<input data-section="${escapeHtml(type)}" data-index="${index}" data-field="timeRange" value="${escapeHtml(entry.timeRange || "")}" placeholder="例如 2022.01-2024.03" /></label>
          <label>经历要点
            <textarea data-section="${escapeHtml(type)}" data-index="${index}" data-field="bullets" placeholder="每行一条经历要点">${escapeHtml(ensureArray(entry.bullets).join("\n"))}</textarea>
          </label>
        </div>
      `
    )
    .join("");
}

function renderReadonlyEducation(education = []) {
  const items = Array.isArray(education) ? education : [];
  if (!items.length) {
    return `<div class="muted">教育经历本轮先只读；当前还没有结构化教育信息。</div>`;
  }
  return `
    <ul class="list list-tight">
      ${items
        .map(
          (entry) =>
            `<li>${escapeHtml([entry.school, entry.degree, entry.timeRange].filter(Boolean).join(" / ") || "未命名教育经历")}</li>`
        )
        .join("")}
    </ul>
  `;
}

function renderMasterResumeEditor(draft = {}, meta = {}) {
  const sourceLabelMap = {
    canonical_saved: "已保存主简历",
    resume_document_seed: "由上传简历初始化",
    empty_seed: "空白初始化"
  };
  const sourceLabel = sourceLabelMap[meta.source] || meta.source || "unknown";
  const skillsText = Array.isArray(draft.skills) ? draft.skills.join(", ") : "";

  return `
    <form id="master-resume-form" class="stack">
      <div class="master-resume-header">
        <div>
          <div class="eyebrow">Structured MasterResume</div>
          <h4>结构化主简历</h4>
          <p class="muted">这里保存你的全局主简历结构；本轮先支持关键 section 编辑，还不切 TailoredResume 主源。</p>
        </div>
        <div class="master-resume-meta">
          <span class="status ready_to_apply">${escapeHtml(sourceLabel)}</span>
          <div class="muted">更新时间：${escapeHtml(formatDateTime(meta.updatedAt || draft.updatedAt || ""))}</div>
        </div>
      </div>

      <div class="master-resume-grid">
        <section class="panel">
          <div class="eyebrow">Basic Info</div>
          <div class="split">
            <label>姓名<input data-master-basic="name" value="${escapeHtml(draft.basicInfo?.name || "")}" /></label>
            <label>邮箱<input data-master-basic="email" value="${escapeHtml(draft.basicInfo?.email || "")}" /></label>
          </div>
          <div class="split">
            <label>电话<input data-master-basic="phone" value="${escapeHtml(draft.basicInfo?.phone || "")}" /></label>
            <label>地点<input data-master-basic="location" value="${escapeHtml(draft.basicInfo?.location || "")}" /></label>
          </div>
        </section>

        <section class="panel">
          <div class="eyebrow">摘要</div>
          <label>主简历摘要
            <textarea data-master-field="summary" placeholder="用 2-4 句概括你的主简历核心卖点。">${escapeHtml(draft.summary || "")}</textarea>
          </label>
        </section>
      </div>

      <section class="panel">
        <div class="master-resume-section-head">
          <div>
            <div class="eyebrow">Work Experience</div>
            <h5>工作经历</h5>
          </div>
          <button class="button" type="button" data-action="add-entry" data-section="work">新增工作经历</button>
        </div>
        <div class="stack" id="master-resume-work-list">
          ${renderMasterResumeSectionEntries(draft.workExperience || [], "work")}
        </div>
      </section>

      <section class="panel">
        <div class="master-resume-section-head">
          <div>
            <div class="eyebrow">Project Experience</div>
            <h5>项目经历</h5>
          </div>
          <button class="button" type="button" data-action="add-entry" data-section="project">新增项目经历</button>
        </div>
        <div class="stack" id="master-resume-project-list">
          ${renderMasterResumeSectionEntries(draft.projectExperience || [], "project")}
        </div>
      </section>

      <div class="master-resume-grid">
        <section class="panel">
          <div class="eyebrow">Skills</div>
          <label>技能标签
            <textarea data-master-field="skills" placeholder="用逗号或换行分隔，例如 SQL, Python, Stakeholder Management">${escapeHtml(skillsText)}</textarea>
          </label>
        </section>
        <section class="panel">
          <div class="eyebrow">Education</div>
          <h5>教育经历（本轮先只读）</h5>
          ${renderReadonlyEducation(draft.education || [])}
        </section>
      </div>

      <div id="master-resume-feedback"></div>
      <div class="toolbar">
        <button class="button primary" type="submit">保存结构化主简历</button>
      </div>
    </form>
  `;
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

function getTailoringAcceptedBullets(prepDto = null) {
  return (prepDto?.rewriteBullets || []).map((item, index) => ({
    bulletId: `prep_bullet_${index + 1}`,
    before: item,
    after: item,
    rewritten: item,
    suggestion: item,
    status: "accepted"
  }));
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

  const hasMojibake = /�|锟|銆|鈥|鏈|闃|浠|璇|���/i.test(text);
  const fallbackMap = {
    summary: "系统已整理岗位摘要，建议结合原始岗位描述再确认细节。",
    responsibility: "系统已提炼一条岗位职责，请结合原始 JD 再核对。",
    requirement: "系统已提炼一条岗位要求，请结合原始 JD 再核对。",
    preferred: "系统已提炼一条加分项，请结合原始 JD 再核对。",
    risk: "系统已提炼一条风险提醒，请结合上下文判断。",
    fit: "系统已生成判断说明，请结合岗位详情继续确认。",
    prep: "系统已生成申请准备内容，请继续在编辑区确认。",
    timeline: "系统已记录一条过程信息。",
    pipeline: "系统已记录一条流程阶段信息。"
  };

  if (/[\u4e00-\u9fff]/.test(text) && !hasMojibake) return text;

  let result = text;
  [
    [/^Prep cautiously for (.+)$/i, "谨慎推进 $1 的申请准备"],
    [/^Proceed carefully(?: on)? (.+)$/i, "谨慎推进 $1，先补强最相关经历"],
    [/Stay highly concentrated on[^。.!?]*/gi, "优先聚焦与你当前经历最匹配的岗位方向"],
    [/Keep a balanced pipeline[^。.!?]*/gi, "保持投递节奏平衡，优先推进更有把握的岗位。"],
    [/^high$/i, "高"],
    [/^medium$/i, "中"],
    [/^low$/i, "低"]
  ].forEach(([pattern, replacement]) => {
    result = result.replace(pattern, replacement);
  });

  [
    [/\bcompleted with fallback\b/gi, "已完成（使用回退结果）"],
    [/\bfallback result\b/gi, "回退结果"],
    [/\bfallback\b/gi, "回退结果"],
    [/\baligned\b/gi, "基本对齐"],
    [/\bforming\b/gi, "形成中"],
    [/\bhigh\b/gi, "高"],
    [/\bmedium\b/gi, "中"],
    [/\blow\b/gi, "低"]
  ].forEach(([pattern, replacement]) => {
    result = result.replace(pattern, replacement);
  });

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

  result = result
    .replace(/�+/g, "")
    .replace(/锟斤拷|锟|銆|鈥|鏈|闃|浠|璇/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!result) {
    return fallbackMap[kind] || "系统已生成内容，请结合上下文继续确认。";
  }

  if (/[A-Za-z]{4,}/.test(result)) {
    return fallbackMap[kind] || "已提取英文原始内容，建议结合上下文进一步确认。";
  }

  return result;
}

function sanitizeWorkspaceName(value, fallback = "当前岗位定制版") {
  const cleaned = String(value || "")
    .replace(/�+/g, "")
    .replace(/锟斤拷|锟|銆|鈥|鏈|闃|浠|璇/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || fallback;
}

function buildPrepDraft(prep, prepDto = null) {
  if (!prep) {
    return {
      targetKeywords: Array.isArray(prepDto?.targetKeywords) ? prepDto.targetKeywords : [],
      tailoredResumeBullets: Array.isArray(prepDto?.rewriteBullets) ? prepDto.rewriteBullets.join("\n") : "",
      tailoredSummary: prepDto?.tailoredSummary || "",
      whyMe: "",
      selfIntroShort: prepDto?.selfIntro?.short || "",
      selfIntroMedium: prepDto?.selfIntro?.medium || "",
      qaDraft: Array.isArray(prepDto?.qaDraft) ? prepDto.qaDraft.map((item) => `${item.question} :: ${item.draftAnswer}`).join("\n") : "",
      coverNote: "",
      talkingPoints: Array.isArray(prepDto?.talkingPoints) ? prepDto.talkingPoints.join("\n") : "",
      outreachNote: "",
      checklist: Array.isArray(prepDto?.checklist) && prepDto.checklist.length
        ? prepDto.checklist
        : [
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
    talkingPoints: ensureArray(prep.talkingPoints).join("\n"),
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
  title.textContent = "求职工作台";
  subtitle.textContent = "输入偏好，自动排序岗位，立即进入结构化岗位决策。";
  renderLoadingState("加载求职工作台", "正在同步偏好与岗位概览...");

  const [profileResult, jobsResult] = await Promise.allSettled([
    apiWithTimeout("/api/profile"),
    apiWithTimeout("/api/jobs")
  ]);
  const profileData = profileResult.status === "fulfilled" ? profileResult.value : null;
  const jobsData = jobsResult.status === "fulfilled" ? jobsResult.value : null;
  const profileLoadFailed = profileResult.status !== "fulfilled";
  const jobsLoadFailed = jobsResult.status !== "fulfilled";

  if (profileLoadFailed && jobsLoadFailed) {
    app.innerHTML = `
      ${message ? renderNotice("success", message) : ""}
      ${errorMessage ? renderNotice("error", errorMessage) : ""}
      <div class="notice error">
        求职工作台加载失败，请重试。
        <div class="toolbar" style="margin-top:10px;">
          <button class="button" type="button" data-action="retry-dashboard-load">重试加载</button>
          <a class="button" href="#/jobs">查看岗位列表</a>
          <a class="button" href="#/profile">查看个人资料</a>
        </div>
      </div>
    `;
    document.querySelector("[data-action='retry-dashboard-load']")?.addEventListener("click", () => {
      renderDashboard(message);
    });
    return;
  }

  const profile = profileData?.profile || {};
  const lightweight = normalizeLightweightProfileSafe({
    ...profile,
    lightweightProfile: profile.lightweightProfile && typeof profile.lightweightProfile === "object" ? profile.lightweightProfile : {}
  });
  const jobPreference = normalizeJobPreferenceProfileFallback({
    ...profile,
    lightweightProfile: lightweight
  });
  const jobViews = Array.isArray(jobsData.jobWorkspaceViewModels) ? jobsData.jobWorkspaceViewModels : [];
  const recommendationStats = jobViews.reduce(
    (acc, vm) => {
      const recommendation = vm?.decisionView?.recommendation || "skip";
      if (recommendation === "apply") acc.apply += 1;
      else if (recommendation === "cautious") acc.cautious += 1;
      else acc.skip += 1;
      return acc;
    },
    { apply: 0, cautious: 0, skip: 0 }
  );
  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    ${
      profileLoadFailed || jobsLoadFailed
        ? renderNotice(
            "warning",
            `部分数据加载失败：${profileLoadFailed ? "偏好资料" : ""}${profileLoadFailed && jobsLoadFailed ? "、" : ""}${jobsLoadFailed ? "岗位概览" : ""}。你仍可继续操作，建议稍后重试。`
          )
        : ""
    }
    <div class="dashboard-shell">
      <section class="dashboard-hero">
        <div class="hero-copy">
          <div class="eyebrow">求职工作台</div>
          <h3 class="hero-title">你的 AI 求职决策面板</h3>
          <p class="hero-subtitle">输入偏好，自动排序岗位，立即进入结构化岗位决策。</p>
        </div>
        <div class="inline-meta" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
          <span class="status ready_to_apply">推荐投递 ${recommendationStats.apply}</span>
          <span class="status evaluating">谨慎推进 ${recommendationStats.cautious}</span>
          <span class="status archived">暂不优先 ${recommendationStats.skip}</span>
        </div>
      </section>

      <section class="card">
        <div class="section-head">
          <div>
            <div class="eyebrow">输入偏好</div>
            <h3>快速更新求职偏好</h3>
          </div>
          <div class="toolbar">
            <a class="button" href="#/profile?section=profile-preference-section">更多偏好设置（可选）</a>
          </div>
        </div>
        <div class="muted">必须条件直接影响过滤；强偏好影响排序；辅助偏好用于补充判断。</div>
        <details class="activity-disclosure" style="margin-top:8px;">
          <summary class="muted" style="cursor:pointer;">了解偏好规则（可选）</summary>
          <div class="muted" style="margin-top:8px;">必须条件：目标岗位、偏好地点、求职类型、排除行业、排除岗位。</div>
          <div class="muted">强偏好：偏好行业、偏好公司类型。</div>
          <div class="muted">辅助偏好：技能偏好（可选）与补充项，不会单独决定推荐结果。</div>
        </details>
        <form id="dashboard-preference-form" class="stack" style="margin-top:12px;">
          <div class="split">
            <label>目标岗位
              <input name="targetRoles" value="${escapeHtml(jobPreference.targetRoles.join(", "))}" placeholder="例如 产品经理, 算法工程师" />
            </label>
            <label>偏好行业
              <input name="preferredIndustries" value="${escapeHtml(jobPreference.preferredIndustries.join(", "))}" placeholder="例如 金融, AI/算法, 游戏" />
            </label>
          </div>
          <div class="split">
            <label>地点
              <input name="preferredLocations" value="${escapeHtml(jobPreference.preferredLocations.join(", "))}" placeholder="例如 上海, 北京" />
            </label>
          </div>
          <details class="activity-disclosure">
            <summary class="muted" style="cursor:pointer;">更多偏好设置（可选）</summary>
            <div class="stack" style="margin-top:8px;">
              <div class="split">
            <label>技能（可选）
              <input name="skills" value="${escapeHtml(jobPreference.skills.join(", "))}" placeholder="例如 Python, SQL, React" />
            </label>
            <label>排除岗位
              <input name="excludedRoles" value="${escapeHtml(jobPreference.excludedRoles.join(", "))}" placeholder="例如 销售, 客服" />
            </label>
              </div>
              <div class="split">
            <label>排除行业
              <input name="excludedIndustries" value="${escapeHtml(jobPreference.excludedIndustries.join(", "))}" placeholder="例如 教育, 房产中介" />
            </label>
            <label>公司类型偏好
              <input name="companyTypes" value="${escapeHtml(jobPreference.companyTypes.join(", "))}" placeholder="例如 大厂, 外企, 国企" />
            </label>
              </div>
              <div class="split">
                <label>求职类型
                  <select name="jobType">
                    ${["不限", "校招", "实习", "社招"]
                      .map((item) => {
                        const selected = jobPreference.jobType === item ? "selected" : "";
                        return `<option value="${escapeHtml(item)}" ${selected}>${escapeHtml(item)}</option>`;
                      })
                      .join("")}
                  </select>
                </label>
              </div>
            </div>
          </details>
          <div class="toolbar" style="position:sticky; bottom:0; background:var(--panel-bg,#fff); padding-top:8px; padding-bottom:8px;">
            <button class="button primary" type="submit">保存偏好并查看岗位决策</button>
          </div>
        </form>
      </section>
    </div>
  `;

  const preferenceForm = document.getElementById("dashboard-preference-form");
  if (!preferenceForm) return;

  preferenceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(preferenceForm);
    const targetRoles = splitOnboardingListSafe(String(formData.get("targetRoles") || ""));
    const preferredIndustries = splitOnboardingListSafe(String(formData.get("preferredIndustries") || ""));
    const preferredLocations = splitOnboardingListSafe(String(formData.get("preferredLocations") || ""));
    const skills = splitOnboardingListSafe(String(formData.get("skills") || ""));
    const excludedRoles = splitOnboardingListSafe(String(formData.get("excludedRoles") || ""));
    const excludedIndustries = splitOnboardingListSafe(String(formData.get("excludedIndustries") || ""));
    const companyTypes = splitOnboardingListSafe(String(formData.get("companyTypes") || ""));
    const jobType = String(formData.get("jobType") || "不限").trim() || "不限";

    const button = preferenceForm.querySelector("button[type='submit']");
    try {
      setButtonPending(button, true, "保存中...");
      if (!targetRoles.length || !preferredLocations.length) {
        throw new Error("请至少填写一个目标岗位和一个偏好城市。");
      }
      const payload = {
        ...profile,
        lightweightProfile: {
          ...lightweight,
          targetRoles,
          skills,
          preferredLocations
        },
        jobPreferenceProfile: {
          ...jobPreference,
          preferredIndustries,
          targetRoles,
          skills,
          preferredLocations,
          excludedIndustries,
          excludedRoles,
          companyTypes,
          jobType,
          priorityWeights:
            jobPreference.priorityWeights && typeof jobPreference.priorityWeights === "object"
              ? jobPreference.priorityWeights
              : DEFAULT_JOB_PREFERENCE_WEIGHTS
        }
      };
      const saved = await api("/api/profile/save", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      saveOnboardingProfileLocal(saved?.profile || payload);
      await ensureJobsSeededFromPreferences({
        targetRoles,
        preferredLocations
      });
      window.location.hash = "#/jobs";
    } catch (error) {
      setButtonPending(button, false);
      await renderDashboard("", error.message || "保存偏好失败。");
    }
  });
}

async function ensureJobsSeededFromPreferences({ targetRoles = [], preferredLocations = [] } = {}) {
  let jobsCount = 0;
  try {
    const jobsData = await api("/api/jobs");
    jobsCount = Array.isArray(jobsData?.jobWorkspaceViewModels)
      ? jobsData.jobWorkspaceViewModels.length
      : Array.isArray(jobsData?.jobs)
        ? jobsData.jobs.length
        : 0;
  } catch (error) {
    console.error("读取岗位列表失败，跳过自动引导导入。", error);
    return;
  }
  if (jobsCount > 0) return;

  const safeKeywords = Array.isArray(targetRoles) ? targetRoles.filter(Boolean).slice(0, 4) : [];
  const safeCity = Array.isArray(preferredLocations) ? String(preferredLocations[0] || "").trim() : "";
  if (!safeKeywords.length) return;

  const createIntentForSeed = async () => {
    const created = await api("/api/discovery/intents", {
      method: "POST",
      body: JSON.stringify({
        keywords: safeKeywords,
        city: safeCity,
        jobType: "full_time"
      })
    });
    return String(created?.intent?.intentId || "").trim();
  };

  try {
    let intentId = readLastDiscoveryIntentId();
    if (!intentId) {
      intentId = await createIntentForSeed();
    }
    if (!intentId) return;

    const importPayload = {
      candidateLimit: 50,
      resolutionLimit: 30,
      fallbackKeywords: safeKeywords,
      fallbackCity: safeCity,
      origin: "dashboard_bootstrap"
    };
      try {
        await api(`/api/discovery/intents/${intentId}/import-offline-json`, {
          method: "POST",
          body: JSON.stringify(importPayload)
        });
    } catch (error) {
      const raw = String(error?.rawMessage || error?.message || "");
      const shouldRecreateIntent = error?.code === "NOT_FOUND" || /intent.+not found/i.test(raw);
      if (!shouldRecreateIntent) throw error;
      intentId = await createIntentForSeed();
      if (!intentId) return;
      await api(`/api/discovery/intents/${intentId}/import-offline-json`, {
        method: "POST",
        body: JSON.stringify(importPayload)
      });
      }

      rememberDiscoveryIntentId(intentId);
      // Offline-json bootstrap now auto-admits in the same backend request.
    } catch (error) {
      console.error("自动导入岗位失败（不影响偏好保存）。", error);
    }
  }

function collectListingIdsForJobSeed(intentView = {}) {
  const shortlist = intentView?.shortlistResult || {};
  const ranking = intentView?.rankingResult || {};
  const buckets = [
    ...(Array.isArray(shortlist.shortlistedItems) ? shortlist.shortlistedItems : []),
    ...(Array.isArray(shortlist.holdItems) ? shortlist.holdItems : []),
    ...(Array.isArray(ranking.rankedItems) ? ranking.rankedItems : [])
  ];
  const ids = [];
  const seen = new Set();
  buckets.forEach((item) => {
    const listingId = String(item?.listingId || "").trim();
    if (!listingId || seen.has(listingId)) return;
    seen.add(listingId);
    ids.push(listingId);
  });
  return ids;
}

async function seedJobsFromDiscoveryIntent(intentId = "", limit = 12) {
  const safeIntentId = String(intentId || "").trim();
  if (!safeIntentId) return;

  let intentView = null;
  try {
    intentView = await api(`/api/discovery/intents/${safeIntentId}`);
  } catch (error) {
    console.warn("读取 discovery intent 失败，跳过 jobs seed。", error);
    return;
  }

  const listingIds = collectListingIdsForJobSeed(intentView).slice(0, Math.max(1, Number(limit) || 12));
  for (const listingId of listingIds) {
    try {
      await api(`/api/discovery/intents/${safeIntentId}/shortlist/${listingId}/admit`, {
        method: "POST",
        body: JSON.stringify({
          actor: "system",
          overrideReason: "dashboard bootstrap for jobs list visibility",
          allowSkipOverride: true
        })
      });
    } catch (error) {
      // Best effort: some listings can be blocked by admission policy.
    }
  }
}

async function triggerJobsSeedFromProfile(options = {}) {
  const profileData = await api("/api/profile");
  const profile = profileData?.profile && typeof profileData.profile === "object" ? profileData.profile : {};
  const lightweight = normalizeLightweightProfileSafe(profile);
  await ensureJobsSeededFromPreferences({
    targetRoles: Array.isArray(lightweight.targetRoles) ? lightweight.targetRoles : [],
    preferredLocations: Array.isArray(lightweight.preferredLocations) ? lightweight.preferredLocations : []
  });
  if (typeof options.onDone === "function") {
    options.onDone();
  }
}

function normalizeDateInputValue(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const yyyyMm = raw.match(/^(\d{4})-(\d{2})$/);
  if (yyyyMm) return `${yyyyMm[1]}-${yyyyMm[2]}-01`;
  const slash = raw.match(/^(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?$/);
  if (slash) {
    const mm = String(Math.max(1, Math.min(12, Number(slash[2])))).padStart(2, "0");
    const dd = String(Math.max(1, Math.min(31, Number(slash[3] || 1)))).padStart(2, "0");
    return `${slash[1]}-${mm}-${dd}`;
  }
  const zh = raw.match(/^(\d{4})年(\d{1,2})月(?:([0-9]{1,2})日)?$/);
  if (zh) {
    const mm = String(Math.max(1, Math.min(12, Number(zh[2])))).padStart(2, "0");
    const dd = String(Math.max(1, Math.min(31, Number(zh[3] || 1)))).padStart(2, "0");
    return `${zh[1]}-${mm}-${dd}`;
  }
  return "";
}

function normalizeMonthInputValue(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const slash = raw.match(/^(\d{4})\/(\d{1,2})$/);
  if (slash) {
    const mm = String(Math.max(1, Math.min(12, Number(slash[2])))).padStart(2, "0");
    return `${slash[1]}-${mm}`;
  }
  const zh = raw.match(/^(\d{4})年(\d{1,2})月$/);
  if (zh) {
    const mm = String(Math.max(1, Math.min(12, Number(zh[2])))).padStart(2, "0");
    return `${zh[1]}-${mm}`;
  }
  const fromDate = normalizeDateInputValue(raw);
  return /^\d{4}-\d{2}-\d{2}$/.test(fromDate) ? fromDate.slice(0, 7) : "";
}

async function renderDiscovery(message = "", errorMessage = "", intentId = "") {
  setActiveNav("#/discovery");
  title.textContent = "求职工作台";
  subtitle.textContent = "查看 AI 决策推荐岗位、候选清单与待处理线索，形成可执行求职闭环。";

  const resolvedIntentId = String(intentId || "").trim() || readLastDiscoveryIntentId();
  let data = null;
  if (resolvedIntentId) {
    renderLoadingState("加载岗位工作台", "正在同步最新排序、候选清单与线索处理结果...");
    data = await api(`/api/discovery/intents/${resolvedIntentId}`);
    if (data?.intent?.intentId) {
      rememberDiscoveryIntentId(data.intent.intentId);
    }
  }

  const intent = data?.intent || null;
  const rankingResult = data?.rankingResult || null;
  const shortlistResult = data?.shortlistResult || null;
  const leadResolutionViewModel = data?.leadResolutionViewModel || null;
  const blockedByType = leadResolutionViewModel?.summary?.byLeadType || {};
  const shortlistedCount = Array.isArray(shortlistResult?.shortlistedItems) ? shortlistResult.shortlistedItems.length : 0;

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    ${
      !intent
        ? `<div class="notice info">当前暂无可展示的岗位结果。请等待后台同步线索后刷新本页。</div>`
        : ""
    }
    <div class="stack">
      <div class="grid cards-3 discovery-entry-grid">
        <div class="panel">
          <div class="eyebrow">推荐岗位</div>
          <h3>推荐岗位</h3>
          <div class="muted">${escapeHtml(String(Array.isArray(rankingResult?.rankedItems) ? rankingResult.rankedItems.length : 0))}</div>
        </div>
        <div class="panel">
          <div class="eyebrow">候选清单</div>
          <h3>建议投递列表</h3>
          <div class="muted">${escapeHtml(String(shortlistedCount))}</div>
        </div>
        <div class="panel">
          <div class="eyebrow">同步快照</div>
          <h3>最新同步</h3>
          <div class="muted">${escapeHtml(formatDateTime(leadResolutionViewModel?.summary?.importedAt || ""))}</div>
        </div>
        <div class="panel">
          <div class="eyebrow">需网页补充</div>
          <h3>需官网继续</h3>
          <div class="muted">${escapeHtml(String(blockedByType.gateway_link || 0))}</div>
        </div>
        <div class="panel">
          <div class="eyebrow">需邮件投递</div>
          <h3>需邮箱申请</h3>
          <div class="muted">${escapeHtml(String(blockedByType.email_apply || 0))}</div>
        </div>
        <div class="panel">
          <div class="eyebrow">需扫码处理</div>
          <h3>需扫码处理</h3>
          <div class="muted">${escapeHtml(String(blockedByType.mini_program_apply || 0))}</div>
        </div>
      </div>

      <div class="card">
        <div class="section-head">
          <div>
            <div class="eyebrow">可执行岗位</div>
            <h3>可直接推进申请的岗位</h3>
          </div>
        </div>
        <div class="stack">
          <div class="panel">
            <div class="eyebrow">优先级排序</div>
            <h3>优先级排序</h3>
            <div class="stack">
              ${renderRankingSection(intent?.intentId || "", rankingResult)}
            </div>
          </div>
          <div class="panel">
            <div class="eyebrow">候选清单</div>
            <h3>建议投递列表</h3>
            ${renderShortlistSection(intent?.intentId || "", shortlistResult)}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="section-head">
          <div>
            <div class="eyebrow">线索处理</div>
            <h3>需继续处理的线索</h3>
          </div>
        </div>
        ${renderLeadResolutionSection(leadResolutionViewModel)}
      </div>
    </div>
  `;

  attachDiscoveryActionHandlers(intent, renderDiscovery);
}

async function renderDiscoveryAdmin(message = "", errorMessage = "", intentId = "") {
  setActiveNav("");
  title.textContent = "线索处理管理台";
  subtitle.textContent = "内部运营入口：管理飞书线索导入与多维表同步。";

  const resolvedIntentId = String(intentId || "").trim() || readLastDiscoveryIntentId();
  let data = null;
  if (resolvedIntentId) {
    renderLoadingState("加载线索处理管理台", "正在同步线索门禁、排序与候选清单...");
    data = await api(`/api/discovery/intents/${resolvedIntentId}`);
    if (data?.intent?.intentId) {
      rememberDiscoveryIntentId(data.intent.intentId);
    }
  }

  const intent = data?.intent || null;
  const rankingResult = data?.rankingResult || null;
  const leadResolutionViewModel = data?.leadResolutionViewModel || null;

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    <div class="stack">
      <div class="notice warning">内部页面：仅用于线索导入运维，不对终端用户暴露。</div>
      <div class="grid cards-3 discovery-entry-grid">
        <div class="panel">
          <div class="section-head">
            <div>
              <div class="eyebrow">飞书 JSON 导入</div>
              <h3>导入飞书线索</h3>
            </div>
            ${intent ? `<div class="muted">intentId · ${escapeHtml(intent.intentId || "")}</div>` : ""}
          </div>
          <form id="discovery-feishu-form" class="stack">
            <div class="split">
              <label>关键词<input name="keywords" value="${escapeHtml((ensureArray(intent?.keywords).length ? ensureArray(intent?.keywords) : ["AI Product Manager"]).join(", "))}" required /></label>
              <label>城市<input name="city" value="${escapeHtml(intent?.city || "Shanghai")}" /></label>
            </div>
            <div class="split">
              <label>岗位类型<input name="jobType" value="${escapeHtml(intent?.jobType || "full_time")}" /></label>
              <label>文档名称<input name="docName" value="${escapeHtml(getDiscoveryDocName(intent, leadResolutionViewModel))}" /></label>
            </div>
            <label>飞书线索 JSON<textarea id="discovery-feishu-json" name="leadsJson" rows="14" placeholder="粘贴飞书导出的 JSON 数组">${escapeHtml(stringifyDiscoverySample())}</textarea></label>
            <div class="toolbar">
              <input type="file" id="discovery-feishu-file" accept=".json,application/json" />
              <button class="button" type="button" id="discovery-sample-btn">载入示例 JSON</button>
              <button class="button primary" type="submit">导入并生成结果</button>
            </div>
          </form>
        </div>

        <div class="panel">
          <div class="section-head">
            <div>
              <div class="eyebrow">飞书同步</div>
              <h3>同步多维表</h3>
            </div>
          </div>
          <form id="discovery-feishu-sync-form" class="stack">
            <div class="split">
              <label>appToken<input name="appToken" placeholder="app_xxx" /></label>
              <label>tableId<input name="tableId" placeholder="tbl_xxx" /></label>
            </div>
            <div class="split">
              <label>tenantAccessToken<input name="tenantAccessToken" placeholder="t-xxx" /></label>
              <label>viewId（可选）<input name="viewId" placeholder="vew_xxx" /></label>
            </div>
            <div class="split">
              <label>pageSize<input name="pageSize" value="100" /></label>
              <label>maxPages<input name="maxPages" value="10" /></label>
            </div>
            <label>文档名称<input name="docName" value="${escapeHtml(getDiscoveryDocName(intent, leadResolutionViewModel))}" /></label>
            <div class="toolbar">
              <button class="button primary" type="submit">同步飞书多维表</button>
            </div>
          </form>
        </div>

        <div class="panel">
          <div class="eyebrow">当前结果</div>
          <h3>线索处理概览</h3>
          <div class="stack">
            <div class="panel">
              <strong>可执行岗位数量</strong>
              <div class="muted">${escapeHtml(String(Array.isArray(rankingResult?.rankedItems) ? rankingResult.rankedItems.length : 0))}</div>
            </div>
            <div class="panel">
              <strong>受限但可处理线索</strong>
              <div class="muted">${escapeHtml(String(leadResolutionViewModel?.summary?.totalBlocked || 0))}</div>
            </div>
            <div class="panel">
              <strong>最新导入时间</strong>
              <div class="muted">${escapeHtml(formatDateTime(leadResolutionViewModel?.summary?.importedAt || ""))}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const jsonTextarea = document.getElementById("discovery-feishu-json");
  const fileInput = document.getElementById("discovery-feishu-file");
  const sampleButton = document.getElementById("discovery-sample-btn");
  if (sampleButton) {
    sampleButton.addEventListener("click", () => {
      jsonTextarea.value = stringifyDiscoverySample();
    });
  }

  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        jsonTextarea.value = text;
      } catch (error) {
        renderDiscoveryAdmin("", "读取 JSON 文件失败，请改为直接粘贴。", resolvedIntentId);
      }
    });
  }

  document.getElementById("discovery-feishu-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    try {
      setButtonPending(button, true, "导入中...");
      const formData = new FormData(event.target);
      const keywords = String(formData.get("keywords") || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const city = String(formData.get("city") || "").trim();
      const jobType = String(formData.get("jobType") || "").trim() || "full_time";
      const docName = String(formData.get("docName") || "").trim();
      const leads = normalizeDiscoveryArray(formData.get("leadsJson") || "[]");

      const targetIntentId = await ensureDiscoveryIntent(intent, { keywords, city, jobType });
      await api(`/api/discovery/intents/${targetIntentId}/import-feishu`, {
        method: "POST",
        body: JSON.stringify({
          docName,
          origin: "feishu_ui_import",
          leads
        })
      });
      rememberDiscoveryIntentId(targetIntentId);
      discoveryFlashMessage = "飞书线索已导入，系统已完成线索门禁、排序与候选清单处理。";
      discoveryFlashError = "";
      window.location.hash = `#/discovery/${targetIntentId}`;
    } catch (error) {
      setButtonPending(button, false);
      renderDiscoveryAdmin("", error.message, resolvedIntentId);
    }
  });

  document.getElementById("discovery-feishu-sync-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    try {
      setButtonPending(button, true, "同步中...");
      const formData = new FormData(event.target);
      const keywords = String(document.querySelector('#discovery-feishu-form [name="keywords"]')?.value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const city = String(document.querySelector('#discovery-feishu-form [name="city"]')?.value || "").trim();
      const jobType = String(document.querySelector('#discovery-feishu-form [name="jobType"]')?.value || "").trim() || "full_time";
      const targetIntentId = await ensureDiscoveryIntent(intent, { keywords, city, jobType });
      await api(`/api/discovery/intents/${targetIntentId}/sync-feishu-bitable`, {
        method: "POST",
        body: JSON.stringify({
          appToken: String(formData.get("appToken") || "").trim(),
          tableId: String(formData.get("tableId") || "").trim(),
          tenantAccessToken: String(formData.get("tenantAccessToken") || "").trim(),
          viewId: String(formData.get("viewId") || "").trim(),
          pageSize: Number(formData.get("pageSize") || 100),
          maxPages: Number(formData.get("maxPages") || 10),
          docName: String(formData.get("docName") || "").trim()
        })
      });
      rememberDiscoveryIntentId(targetIntentId);
      discoveryFlashMessage = "Feishu 多维表已同步，页面已按 lead gate 刷新主链岗位与可处理线索。";
      discoveryFlashError = "";
      window.location.hash = `#/discovery/${targetIntentId}`;
    } catch (error) {
      setButtonPending(button, false);
      renderDiscoveryAdmin("", error.message, resolvedIntentId);
    }
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
  subtitle.textContent = "集中查看岗位优先级、解释依据与一键网申入口。";
  renderLoadingState("加载岗位列表", "正在刷新岗位队列与最新评估结果...");
  const [jobsResult, profileResult] = await Promise.allSettled([
    apiWithTimeout("/api/jobs"),
    apiWithTimeout("/api/profile")
  ]);
  const jobsLoadFailed = jobsResult.status !== "fulfilled";
  const profileLoadFailed = profileResult.status !== "fulfilled";
  if (jobsLoadFailed && profileLoadFailed) {
    app.innerHTML = `
      <div class="notice error">
        岗位页面加载失败（load_failed）。请重试。
        <div class="toolbar" style="margin-top:10px;">
          <button class="button" type="button" data-action="retry-jobs-load">重试加载</button>
          <a class="button" href="#/dashboard">返回工作台</a>
          <a class="button" href="#/profile">查看个人资料</a>
        </div>
      </div>
    `;
    document.querySelector("[data-action='retry-jobs-load']")?.addEventListener("click", () => {
      renderJobs(message);
    });
    return;
  }
  const data = jobsResult.status === "fulfilled" ? jobsResult.value : {};
  const profileData = profileResult.status === "fulfilled" ? profileResult.value : {};
  const jobViews = Array.isArray(data.jobWorkspaceViewModels) ? data.jobWorkspaceViewModels : [];
  const jobs = [...jobViews];
  const trackerStates = ["none", "saved", "prep", "tailored", "applied", "interview", "rejected", "offer"];
  const feedbackStates = ["none", "good_fit", "bad_fit", "misclassified"];
  const shortlistStates = ["none", "shortlisted"];
  const materialResumeStates = ["none", "draft", "tailored", "finalized"];
  const materialCoverLetterStates = ["none", "draft", "tailored", "finalized"];
  const materialInterviewPrepStates = ["none", "draft", "ready"];
  const submissionAuditStatuses = ["none", "ready", "submitted", "failed", "needs_review"];
  const submissionAuditSources = ["manual", "plugin", "system"];
  const followUpStatuses = ["none", "planned", "done", "skipped"];
  const followUpChannels = ["email", "phone", "linkedin", "other"];
  const trackerFilterOptions = [
    { value: "all", label: "全部流程状态" },
    { value: "saved", label: "已收藏" },
    { value: "prep", label: "准备中" },
    { value: "tailored", label: "已定制材料" },
    { value: "applied", label: "已投递" },
    { value: "interview", label: "面试中" },
    { value: "rejected", label: "已拒绝" },
    { value: "offer", label: "录用" }
  ];
  const shortlistFilterOptions = [
    { value: "all", label: "全部岗位" },
    { value: "shortlisted", label: "候选清单" }
  ];
  const resolveTrackerState = (value = "") => {
    const normalized = String(value || "").trim().toLowerCase();
    return trackerStates.includes(normalized) ? normalized : "none";
  };
  const resolveTrackerLabel = (value = "") => {
    const normalized = resolveTrackerState(value);
    const map = {
      none: "未设置",
      saved: "已收藏",
      prep: "准备中",
      tailored: "已定制材料",
      applied: "已投递",
      interview: "面试中",
      rejected: "已拒绝",
      offer: "录用"
    };
    return map[normalized] || "未设置";
  };
  const resolveTrackerTimelineLine = (trackerView = {}) => {
    const timeline = Array.isArray(trackerView.timeline) ? trackerView.timeline : [];
    if (timeline.length === 0) return "未记录";
    const latest = timeline[0] || {};
    const stateLabel = resolveTrackerLabel(latest.state);
    const dateLabel = formatDateTime(latest.timestamp);
    return `${stateLabel} · ${dateLabel}`;
  };
  const resolveMaterialState = (value = "", allowed = []) => {
    const normalized = String(value || "").trim().toLowerCase();
    return allowed.includes(normalized) ? normalized : "none";
  };
  const resolveMaterialLabel = (value = "") => {
    const map = {
      none: "未设置",
      draft: "草稿",
      tailored: "已定制",
      finalized: "已定稿",
      ready: "已就绪"
    };
    return map[String(value || "").trim().toLowerCase()] || "未设置";
  };
  const resolveSubmissionStatus = (value = "") => {
    const normalized = String(value || "").trim().toLowerCase();
    return submissionAuditStatuses.includes(normalized) ? normalized : "none";
  };
  const resolveSubmissionSource = (value = "") => {
    const normalized = String(value || "").trim().toLowerCase();
    return submissionAuditSources.includes(normalized) ? normalized : "manual";
  };
  const resolveSubmissionStatusLabel = (value = "") => {
    const map = {
      none: "未记录",
      ready: "待提交",
      submitted: "已提交",
      failed: "提交失败",
      needs_review: "需复核"
    };
    return map[resolveSubmissionStatus(value)] || "未记录";
  };
  const resolveSubmissionSourceLabel = (value = "") => {
    const map = {
      manual: "手动",
      plugin: "插件",
      system: "系统"
    };
    return map[resolveSubmissionSource(value)] || "手动";
  };
  const resolveFollowUpStatus = (value = "") => {
    const normalized = String(value || "").trim().toLowerCase();
    return followUpStatuses.includes(normalized) ? normalized : "none";
  };
  const resolveFollowUpChannel = (value = "") => {
    const normalized = String(value || "").trim().toLowerCase();
    return followUpChannels.includes(normalized) ? normalized : "other";
  };
  const resolveFollowUpStatusLabel = (value = "") => {
    const map = {
      none: "未计划",
      planned: "已计划",
      done: "已完成",
      skipped: "已跳过"
    };
    return map[resolveFollowUpStatus(value)] || "未计划";
  };
  const resolveFollowUpChannelLabel = (value = "") => {
    const map = {
      email: "邮件",
      phone: "电话",
      linkedin: "领英",
      other: "其他"
    };
    return map[resolveFollowUpChannel(value)] || "其他";
  };
  const toDateTimeLocalValue = (isoText = "") => {
    const text = String(isoText || "").trim();
    if (!text) return "";
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return "";
    const pad2 = (value) => String(value).padStart(2, "0");
    const year = parsed.getFullYear();
    const month = pad2(parsed.getMonth() + 1);
    const day = pad2(parsed.getDate());
    const hour = pad2(parsed.getHours());
    const minute = pad2(parsed.getMinutes());
    return `${year}-${month}-${day}T${hour}:${minute}`;
  };
  const resolveFeedbackState = (value = "") => {
    const normalized = String(value || "").trim().toLowerCase();
    return feedbackStates.includes(normalized) ? normalized : "none";
  };
  const resolveFeedbackLabel = (value = "") => {
    const normalized = resolveFeedbackState(value);
    const map = {
      none: "未反馈",
      good_fit: "好岗位",
      bad_fit: "不匹配",
      misclassified: "误判"
    };
    return map[normalized] || "未反馈";
  };
  const resolveFeedbackTimelineLine = (feedbackView = {}) => {
    const timeline = Array.isArray(feedbackView.timeline) ? feedbackView.timeline : [];
    if (timeline.length === 0) return "未记录";
    const latest = timeline[0] || {};
    const stateLabel = resolveFeedbackLabel(latest.state);
    return `${stateLabel} · ${formatDateTime(latest.timestamp)}`;
  };
  const resolveShortlistState = (value = "") => {
    const normalized = String(value || "").trim().toLowerCase();
    return shortlistStates.includes(normalized) ? normalized : "none";
  };
  const resolveShortlistLabel = (value = "") => {
    const normalized = resolveShortlistState(value);
    return normalized === "shortlisted" ? "候选清单" : "未加入";
  };
  const resolveShortlistTimelineLine = (shortlistView = {}) => {
    const timeline = Array.isArray(shortlistView.timeline) ? shortlistView.timeline : [];
    if (timeline.length === 0) return "未记录";
    const latest = timeline[0] || {};
    const stateLabel = resolveShortlistLabel(latest.state);
    return `${stateLabel} · ${formatDateTime(latest.timestamp)}`;
  };
  const trackerFilterRaw = String(localStorage.getItem(JOBS_TRACKER_FILTER_LOCAL_KEY) || "all")
    .trim()
    .toLowerCase();
  const parsedTrackerFilter = trackerFilterOptions.some((item) => item.value === trackerFilterRaw)
    ? trackerFilterRaw
    : "all";
  const shortlistFilterRaw = String(localStorage.getItem(JOBS_SHORTLIST_FILTER_LOCAL_KEY) || "all")
    .trim()
    .toLowerCase();
  const parsedShortlistFilter = shortlistFilterOptions.some((item) => item.value === shortlistFilterRaw)
    ? shortlistFilterRaw
    : "all";
  const hasAppliedJobsEntryGuard = readSessionFlag(JOBS_FIRST_ENTRY_GUARD_SESSION_KEY) === "1";
  let activeTrackerFilter = parsedTrackerFilter;
  let activeShortlistFilter = parsedShortlistFilter;
  if (!hasAppliedJobsEntryGuard) {
    activeTrackerFilter = "all";
    activeShortlistFilter = "all";
    localStorage.setItem(JOBS_TRACKER_FILTER_LOCAL_KEY, "all");
    localStorage.setItem(JOBS_SHORTLIST_FILTER_LOCAL_KEY, "all");
    writeSessionFlag(JOBS_FIRST_ENTRY_GUARD_SESSION_KEY, "1");
  }
  const trackerFilteredJobs =
    activeTrackerFilter === "all"
      ? jobs
      : jobs.filter((jobVm) => resolveTrackerState(jobVm?.trackerView?.state) === activeTrackerFilter);
  const filteredJobsBySelection =
    activeShortlistFilter === "all"
      ? trackerFilteredJobs
      : trackerFilteredJobs.filter((jobVm) => resolveShortlistState(jobVm?.shortlistView?.state) === activeShortlistFilter);
  const hasNoJobs = !jobsLoadFailed && jobs.length === 0;
  const isFilteredEmpty = !jobsLoadFailed && jobs.length > 0 && filteredJobsBySelection.length === 0;
  const filteredJobs = jobsLoadFailed ? [] : (isFilteredEmpty ? jobs : filteredJobsBySelection);
  const profile = profileData.profile || {};
  const lightweight = normalizeLightweightProfileSafe({
    ...profile,
    lightweightProfile:
      profile.lightweightProfile && typeof profile.lightweightProfile === "object" ? profile.lightweightProfile : {}
  });
  const jobPreference = normalizeJobPreferenceProfileFallback({
    ...profile,
    lightweightProfile: lightweight
  });
  const activeJobs = filteredJobs.filter((jobVm) => jobVm.jobSummary?.status !== "archived").length;
  const boostedJobs = filteredJobs.filter((jobVm) => {
    const verdict = String(jobVm?.scoringView?.decisionVerdict?.verdict || "").trim().toLowerCase();
    return verdict === "go";
  }).length;
  const deprioritizedJobs = filteredJobs.filter((jobVm) => {
    const verdict = String(jobVm?.scoringView?.decisionVerdict?.verdict || "").trim().toLowerCase();
    return verdict === "no_go";
  }).length;
  const top5Grades = filteredJobs.slice(0, 5).map((jobVm) =>
    String(jobVm?.scoringView?.decisionVerdict?.grade || "").trim().toUpperCase()
  );
  const top5HasHighMatch = top5Grades.some((grade) => ["A", "B", "C"].includes(grade));
  const shortlistedJobs = jobs.filter((jobVm) => resolveShortlistState(jobVm?.shortlistView?.state) === "shortlisted");

  const resolveOriginalUrl = (job = {}) => {
    const candidate = String(job.applyUrl || job.noticeUrl || job.sourceUrl || "").trim();
    if (!candidate) return "";
    if (!/^https?:\/\//i.test(candidate)) return "";
    if (/applyflow\.local\/fallback/i.test(candidate)) return "";
    return candidate;
  };
  const resolveCompanyType = (job = {}) =>
    String(job.companyType || job.company_type || job.enterpriseType || "").trim() || "—";
  const inferCompanyIndustry = (job = {}) => {
    const corpus = `${String(job.title || "")} ${String(job.description || "")} ${String(job.jdRaw || "")}`.toLowerCase();
    if (/金融|银行/.test(corpus)) return "金融";
    if (/游戏/.test(corpus)) return "游戏";
    if (/互联网|前端|后端|java|golang|算法|数据|ai|产品/.test(corpus)) return "互联网";
    return "跨域岗位";
  };
  const resolveCompanyIndustry = (jobVm = {}) => {
    const job = jobVm?.jobSummary || {};
    const rawIndustry = String(job.companyIndustry || job.industry || job.company_industry || "").trim();
    if (rawIndustry) return rawIndustry;
    const scoringIndustry = String(jobVm?.scoringView?.inferredIndustry || "").trim();
    if (scoringIndustry) return scoringIndustry;
    const inferred = inferCompanyIndustry(job);
    if (jobVm?.jobSummary && typeof jobVm.jobSummary === "object") {
      jobVm.jobSummary.companyIndustry = inferred;
    }
    return inferred || "—";
  };
  const legacyReadWarningCache = new Set();
  const isLegacyWarningEnabled = () => {
    try {
      if (typeof window === "undefined") return false;
      const queryFlag = new URLSearchParams(window.location.search || "").get("legacyWarn");
      if (queryFlag === "1" || queryFlag === "true") return true;
      const localFlag = window.localStorage?.getItem("APPLYFLOW_LEGACY_WARNINGS") || "";
      return localFlag === "1" || localFlag.toLowerCase() === "true";
    } catch (_error) {
      return false;
    }
  };
  const warnLegacyRead = ({ field = "", consumer = "", replacement = "", phase = "phase8c" } = {}) => {
    if (!isLegacyWarningEnabled()) return;
    const key = [field, consumer, replacement, phase].join("|");
    if (!field || legacyReadWarningCache.has(key)) return;
    legacyReadWarningCache.add(key);
    console.warn("[ApplyFlow][LegacyReadWarning]", {
      field,
      consumer,
      replacement,
      deprecationPhase: phase
    });
  };
  const truncateText = (value = "", maxLength = 56) => {
    const text = String(value || "").trim();
    if (!text) return "";
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}…`;
  };
  const resolveScoringGovernanceViews = (scoring = {}) => {
    const explainabilityFromContainer =
      scoring?.explainabilityFeatures && typeof scoring.explainabilityFeatures === "object"
        ? scoring.explainabilityFeatures
        : null;
    const feedbackFromContainer =
      scoring?.feedbackGovernanceFeatures && typeof scoring.feedbackGovernanceFeatures === "object"
        ? scoring.feedbackGovernanceFeatures
        : null;
    const explainabilityFeatures = explainabilityFromContainer || {};
    if (!explainabilityFromContainer && (scoring.recommendationReasonSummary || scoring.blockerReasonSummary || scoring.sourceRiskSummary || scoring.confidenceExplanation || scoring.preferenceDriftSummary)) {
      warnLegacyRead({
        field: "scoringView.recommendationReasonSummary",
        consumer: "public/app.js:resolveScoringGovernanceViews",
        replacement: "scoringView.explainabilityFeatures.recommendationReasonSummary",
        phase: "phase8c"
      });
    }
    const feedbackGovernanceFeatures = feedbackFromContainer || {};
    if (!feedbackFromContainer && (scoring.feedbackSignalType || scoring.feedbackConfidence || scoring.feedbackRecencyTier || scoring.feedbackConsistency || scoring.feedbackConflictRisk || scoring.preferenceEvolutionCandidate)) {
      warnLegacyRead({
        field: "scoringView.feedbackSignalType",
        consumer: "public/app.js:resolveScoringGovernanceViews",
        replacement: "scoringView.feedbackGovernanceFeatures.feedbackSignalType",
        phase: "phase8c"
      });
    }
    const featureModules =
      scoring?.jobFeaturesView?.featureLayerModules && typeof scoring.jobFeaturesView.featureLayerModules === "object"
        ? scoring.jobFeaturesView.featureLayerModules
        : {};
    return {
      explainabilityFeatures,
      feedbackGovernanceFeatures,
      semanticFeatures:
        featureModules.semanticFeatures && typeof featureModules.semanticFeatures === "object"
          ? featureModules.semanticFeatures
          : {},
      sourceGovernanceFeatures:
        featureModules.sourceGovernanceFeatures && typeof featureModules.sourceGovernanceFeatures === "object"
          ? featureModules.sourceGovernanceFeatures
          : {},
      dedupeFreshnessFeatures:
        featureModules.dedupeFreshnessFeatures && typeof featureModules.dedupeFreshnessFeatures === "object"
          ? featureModules.dedupeFreshnessFeatures
          : {}
    };
  };
  const buildScoringSummary = (scoring = {}, decision = {}) => {
    const governanceViews = resolveScoringGovernanceViews(scoring);
    const explainability = governanceViews.explainabilityFeatures;
    const matchedSignalsRaw = Array.isArray(scoring.matchedSignals) ? scoring.matchedSignals.slice(0, 2) : [];
    const matchedSignals = matchedSignalsRaw
      .map((item) => {
        if (item && typeof item === "object") {
          return String(item.profileSignal || item.jobEvidence || item.reason || "").trim();
        }
        return String(item || "").trim();
      })
      .filter(Boolean);
    const riskTop = Array.isArray(scoring.risks) && scoring.risks.length ? scoring.risks.slice(0, 1) : [];
    const contractReasons = [
      String(explainability.recommendationReasonSummary || "").trim(),
      String(explainability.reviewTriggerSummary || "").trim(),
      String(explainability.blockerReasonSummary || "").trim(),
      String(explainability.sourceRiskSummary || "").trim(),
      String(explainability.preferenceDriftSummary || "").trim(),
      String(explainability.confidenceExplanation || "").trim()
    ].filter(Boolean);
    const explanation = String(scoring.explanation || decision.summary || decision.rationale || "").trim();
    const normalizedExplanation = explanation
      .replace(/s+/g, " ")
      .trim();
    const fallback = "??????????";
    const reasonCandidates = [
      ...contractReasons,
      normalizedExplanation,
      matchedSignals.length > 0 ? `???${matchedSignals.join(" / ")}` : "",
      riskTop.length > 0 ? `???${riskTop.join(" / ")}` : ""
    ]
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    const dedupedReasons = [];
    const reasonKeySet = new Set();
    reasonCandidates.forEach((reason) => {
      const key = reason.replace(/[?:??/\s]/g, "").slice(0, 36);
      if (!key || reasonKeySet.has(key)) return;
      reasonKeySet.add(key);
      dedupedReasons.push(reason);
    });
    const summaryText = dedupedReasons.slice(0, 2).join("?") || fallback;
    return {
      summaryText,
      governanceViews
    };
  };
  const buildDecisionDigest = ({
    scoring = {},
    decisionVerdict = {},
    verdictLabel = "",
    nextActionLabel = "",
    skillGapLine = ""
  } = {}) => {
    const normalizedVerdict = String(decisionVerdict?.verdict || "").trim().toLowerCase();
    const conclusion =
      normalizedVerdict === "go" ? "建议优先投递" : normalizedVerdict === "no_go" ? "暂不优先" : "建议人工复核";
    const matchedSignals = Array.isArray(scoring.matchedSignals) ? scoring.matchedSignals : [];
    const hitCandidates = matchedSignals
      .map((item) => {
        if (item && typeof item === "object") {
          return String(item.profileSignal || item.jobEvidence || item.reason || "").trim();
        }
        return String(item || "").trim();
      })
      .filter(Boolean);
    const weightedSummary = Array.isArray(decisionVerdict.weightedSummary) ? decisionVerdict.weightedSummary : [];
    const strongDimensionLabels = weightedSummary
      .filter((item) => String(item?.status || "").trim() === "strong")
      .map((item) => String(item?.label || "").trim())
      .filter(Boolean)
      .map((label) => `${label}较强`);
    const primaryHits = uniqueList([...hitCandidates, ...strongDimensionLabels]).slice(0, 2);
    const hardBlockers = Array.isArray(decisionVerdict.hardBlockers)
      ? decisionVerdict.hardBlockers.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const risks = Array.isArray(scoring.risks) ? scoring.risks.map((item) => String(item || "").trim()).filter(Boolean) : [];
    const riskCandidates = [
      ...hardBlockers.map((item) => `命中阻断项：${item}`),
      ...risks
    ];
    const skillHint = String(skillGapLine || "").trim();
    if (skillHint.includes("技能信号不足") || skillHint.includes("补充技能偏好后可获得技能匹配提示")) {
      riskCandidates.push("技能证据不足，建议人工复核");
    }
    const primaryRisks = uniqueList(riskCandidates).slice(0, 2);
    return {
      conclusion: conclusion || verdictLabel || "建议人工复核",
      primaryHits,
      primaryRisks,
      nextAction: String(nextActionLabel || "").trim() || "建议人工复核"
    };
  };
  const resolveDimensionValue = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return "—";
    return `${Math.max(0, Math.min(100, Math.round(parsed)))}`;
  };
  const resolveCareerNextActionLabel = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "apply_now") return "建议动作：立即投递";
    if (normalized === "review_details") return "建议动作：先看细节";
    if (normalized === "skip") return "建议动作：暂不投递";
    return "建议动作：待判断";
  };
  const resolveScoringSourceLabel = (scoring = {}) => {
    const aiStatus = String(scoring?.llmMeta?.aiStatus || "").trim().toLowerCase();
    if (aiStatus === "pending") return "AI分析中";
    if (aiStatus === "fallback") return "规则评分 / AI暂不可用";
    if (String(scoring.scoringType || "").trim() === "ai") return "AI评分";
    return "规则评分";
  };
  const resolveSkillGapLine = (skillGapView = {}) => {
    const view = skillGapView && typeof skillGapView === "object" ? skillGapView : {};
    const overallFit = String(view.overallFit || "").trim().toLowerCase();
    const matchedSkills = Array.isArray(view.matchedSkills) ? view.matchedSkills : [];
    const missingSkills = Array.isArray(view.missingSkills) ? view.missingSkills : [];
    const hasUserSkills = Boolean(view.hasUserSkills);
    if (!hasUserSkills || overallFit === "unknown") {
      return "技能偏好匹配：补充技能偏好后可获得技能匹配提示";
    }
    if (matchedSkills.length > 0 && missingSkills.length > 0) {
      return `技能偏好匹配: ${matchedSkills.length}/${matchedSkills.length + missingSkills.length}（基于你填写的技能偏好）；可能缺少：${missingSkills.slice(0, 3).join(", ")}`;
    }
    if (matchedSkills.length > 0) {
      return `技能偏好匹配: ${matchedSkills.length}/${matchedSkills.length}（基于你填写的技能偏好）`;
    }
    if (missingSkills.length > 0) {
      return `技能偏好匹配：可能缺少 ${missingSkills.slice(0, 3).join(", ")}（基于你填写的技能偏好）`;
    }
    return String(view.gapHint || "技能偏好匹配提示待完善");
  };
  const resolveVerdictLabel = (verdict = "") => {
    const normalized = String(verdict || "").trim().toLowerCase();
    if (normalized === "go") return "优先投递";
    if (normalized === "no_go") return "不建议投递";
    return "建议复核";
  };
  const resolveConfidenceLabel = (confidence = "") => {
    const normalized = String(confidence || "").trim().toLowerCase();
    if (normalized === "high") return "高置信";
    if (normalized === "low") return "低置信";
    return "中置信";
  };
  const resolveApplyPriority = (scoring = {}) => {
    const verdict = String(scoring?.decisionVerdict?.verdict || "").trim().toLowerCase();
    const grade = String(scoring?.decisionVerdict?.grade || "").trim().toUpperCase();
    const blockers = Array.isArray(scoring?.decisionVerdict?.hardBlockers) ? scoring.decisionVerdict.hardBlockers : [];
    if (verdict === "no_go" || blockers.length > 0) return "low";
    if (verdict === "go" && (grade === "A" || grade === "B")) return "high";
    if (verdict === "review" && (grade === "B" || grade === "C")) return "medium";
    return "low";
  };
  const resolveApplyPriorityLabel = (value = "") => {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "high") return "高优先级";
    if (normalized === "medium") return "中优先级";
    return "低优先级";
  };
  const resolveFitTriState = (rawScore) => {
    const score = Number(rawScore);
    if (!Number.isFinite(score)) {
      return { state: "partial", stateLabel: "证据不足", tone: "inbox" };
    }
    if (score >= 70) {
      return { state: "match", stateLabel: "匹配", tone: "ready_to_apply" };
    }
    if (score >= 40) {
      return { state: "partial", stateLabel: "部分匹配", tone: "evaluating" };
    }
    return { state: "conflict", stateLabel: "冲突", tone: "archived" };
  };
  const resolveSkillTriState = (skillGapView = {}, skillFitRaw) => {
    const overallFit = String(skillGapView?.overallFit || "").trim().toLowerCase();
    if (overallFit === "high") return { state: "match", stateLabel: "匹配", tone: "ready_to_apply" };
    if (overallFit === "medium") return { state: "partial", stateLabel: "部分匹配", tone: "evaluating" };
    if (overallFit === "low") return { state: "conflict", stateLabel: "冲突", tone: "archived" };
    const hasUserSkills = Boolean(skillGapView?.hasUserSkills);
    if (hasUserSkills) {
      return { state: "partial", stateLabel: "证据不足", tone: "inbox" };
    }
    return resolveFitTriState(skillFitRaw);
  };
  const buildFiveDimensionView = ({ scoring = {}, decisionVerdict = {} } = {}) => {
    const hardBlockers = Array.isArray(decisionVerdict?.hardBlockers) ? decisionVerdict.hardBlockers : [];
    const dimensions = scoring?.userPriorityDimensions && typeof scoring.userPriorityDimensions === "object"
      ? scoring.userPriorityDimensions
      : {};
    const roleScore = Number.isFinite(Number(dimensions.role)) ? Number(dimensions.role) : Number(scoring?.roleFit || 0);
    const industryScore = Number.isFinite(Number(dimensions.industry)) ? Number(dimensions.industry) : Number(scoring?.industryFit || 0);
    const locationScore = Number.isFinite(Number(dimensions.location)) ? Number(dimensions.location) : Number(scoring?.locationFit || 0);
    const companyScore = Number.isFinite(Number(dimensions.company)) ? Number(dimensions.company) : Number(scoring?.companyFit || 0);
    const accessibilityScore = Number.isFinite(Number(dimensions.accessibility)) ? Number(dimensions.accessibility) : Number(scoring?.applicationAccessibilityFit || 0);
    const roleState = { ...resolveFitTriState(roleScore), displayScore: roleScore };
    const industryState = { ...resolveFitTriState(industryScore), displayScore: industryScore };
    const locationState = { ...resolveFitTriState(locationScore), displayScore: locationScore };
    const companyState = { ...resolveFitTriState(companyScore), displayScore: companyScore };
    const accessibilityState =
      hardBlockers.length > 0
        ? { state: "conflict", stateLabel: "冲突", tone: "archived", displayScore: Math.min(accessibilityScore || 0, 20) }
        : { ...resolveFitTriState(accessibilityScore), displayScore: accessibilityScore };
    const locationWorkModeState =
      locationState.state === "conflict" && hardBlockers.length === 0
        ? { state: "partial", stateLabel: "部分匹配", tone: "evaluating" }
        : locationState;
    const companyEnvironmentState =
      companyState.state === "conflict" && hardBlockers.length === 0
        ? { state: "partial", stateLabel: "部分匹配", tone: "evaluating" }
        : companyState;
    return [
      { key: "role", dimensionLabel: "岗位契合度", ...roleState },
      { key: "industry", dimensionLabel: "行业契合度", ...industryState },
      { key: "locationWorkMode", dimensionLabel: "地点与工作方式契合度", ...locationWorkModeState },
      { key: "companyEnvironment", dimensionLabel: "公司环境契合度", ...companyEnvironmentState },
      { key: "accessibility", dimensionLabel: "申请门槛可达性", ...accessibilityState }
    ];
  };
  const buildFiveDimensionTooltipText = ({ dimension = {}, scoring = {}, decisionVerdict = {} } = {}) => {
    const label = String(dimension.dimensionLabel || "").trim();
    const state = String(dimension.state || "").trim().toLowerCase();
    const blockers = Array.isArray(decisionVerdict?.hardBlockers) ? decisionVerdict.hardBlockers : [];
    const topBlocker = String(blockers[0] || "").trim();
    if (label === "岗位契合度") {
      if (state === "match") return "目标岗位方向与当前职位描述高度一致。";
      if (state === "partial") return "岗位方向有一定重合，但职责边界仍需进一步确认。";
      return "岗位方向与当前目标存在明显偏差，建议谨慎评估。";
    }
    if (label === "行业契合度") {
      if (state === "match") return "岗位所在行业与当前偏好基本一致。";
      if (state === "partial") return "行业相关性中等，建议结合具体业务再判断。";
      return "行业方向与当前偏好冲突，优先级建议下调。";
    }
    if (label === "地点与工作方式契合度") {
      if (state === "match") return "地点与工作方式与当前偏好较为一致。";
      if (state === "partial") return "地点或工作方式存在部分偏差，但仍可进一步评估。";
      return "地点约束冲突较明显，建议谨慎推进。";
    }
    if (label === "公司环境契合度") {
      if (state === "match") return "公司类型与团队环境偏好整体匹配。";
      if (state === "partial") return "公司环境部分匹配，建议结合稳定性与成长性评估。";
      return "公司环境偏好冲突明显，建议降低优先级。";
    }
    if (label === "申请门槛可达性") {
      if (topBlocker) return `当前存在阻断因素：${topBlocker}`;
      if (state === "match") return "当前背景可支撑投递动作，门槛可达性较好。";
      if (state === "partial") return "存在信息缺口或证据不足，建议人工复核后决策。";
      return "申请门槛存在较大阻力，建议暂缓投入。";
    }
    return "该维度用于辅助判断岗位与偏好的综合契合度。";
  };
  const mapDimensionStateToDisplayScore = (dimension = {}) => {
    const rawScore = Number(dimension?.displayScore);
    if (Number.isFinite(rawScore)) return Math.max(0, Math.min(100, rawScore));
    const stateLabel = String(dimension?.stateLabel || "").trim();
    const state = String(dimension?.state || "").trim().toLowerCase();
    if (stateLabel.includes("证据不足")) return 50;
    if (stateLabel.includes("部分匹配")) return 55;
    if (stateLabel.includes("冲突")) return 20;
    if (stateLabel.includes("匹配")) return 90;
    if (state === "match") return 90;
    if (state === "conflict") return 20;
    return 55;
  };
  const renderFiveDimensionRadar = ({ dimensions = [], scoring = {}, decisionVerdict = {} } = {}) => {
    const axis = dimensions.slice(0, 5);
    if (axis.length < 5) return "";
    const centerX = 84;
    const centerY = 84;
    const radius = 56;
    const rings = [0.25, 0.5, 0.75, 1];
    const angleAt = (index) => (-Math.PI / 2) + (index * (2 * Math.PI / 5));
    const pointAt = (index, ratio) => {
      const angle = angleAt(index);
      return {
        x: centerX + Math.cos(angle) * radius * ratio,
        y: centerY + Math.sin(angle) * radius * ratio
      };
    };
    const polygonPoints = axis
      .map((item, index) => {
        const score = mapDimensionStateToDisplayScore(item);
        const ratio = Math.max(0, Math.min(1, score / 100));
        const point = pointAt(index, ratio);
        return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
      })
      .join(" ");
    const dataPoints = axis
      .map((item, index) => {
        const score = mapDimensionStateToDisplayScore(item);
        const ratio = Math.max(0, Math.min(1, score / 100));
        const point = pointAt(index, ratio);
        const tooltipText = buildFiveDimensionTooltipText({ dimension: item, scoring, decisionVerdict });
        return `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3.2" fill="#1f7aff" stroke="#ffffff" stroke-width="1.2"><title>${escapeHtml(
          `${item.dimensionLabel}：${tooltipText}`
        )}</title></circle>`;
      })
      .join("");
    const ringPolygons = rings
      .map((ratio) =>
        axis
          .map((_, index) => {
            const point = pointAt(index, ratio);
            return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
          })
          .join(" ")
      );
    const spokes = axis
      .map((_, index) => {
        const point = pointAt(index, 1);
        return `<line x1="${centerX}" y1="${centerY}" x2="${point.x.toFixed(2)}" y2="${point.y.toFixed(2)}" stroke="#d6dbe7" stroke-width="1" />`;
      })
      .join("");
    const labels = axis
      .map((item, index) => {
        const shortLabelMap = {
          岗位契合度: "岗位",
          行业契合度: "行业",
          地点与工作方式契合度: "地点",
          公司环境契合度: "公司",
          申请门槛可达性: "门槛"
        };
        const shortLabel = shortLabelMap[item.dimensionLabel] || item.dimensionLabel;
        const point = pointAt(index, 1.15);
        const tooltipText = buildFiveDimensionTooltipText({ dimension: item, scoring, decisionVerdict });
        return `<text x="${point.x.toFixed(2)}" y="${point.y.toFixed(2)}" fill="#5b6475" font-size="10" text-anchor="middle" dominant-baseline="middle">${escapeHtml(
          shortLabel
        )}<title>${escapeHtml(`${item.dimensionLabel}：${tooltipText}`)}</title></text>`;
      })
      .join("");
    return `
      <svg viewBox="0 0 168 168" width="168" height="168" role="img" aria-label="五维匹配图" style="max-width:100%;height:auto;display:block;">
        ${ringPolygons
          .map((points, index) => `<polygon points="${points}" fill="none" stroke="${index === ringPolygons.length - 1 ? "#c6cfdf" : "#e1e6f0"}" stroke-width="1" />`)
          .join("")}
        ${spokes}
        <polygon points="${polygonPoints}" fill="rgba(31, 122, 255, 0.2)" stroke="#1f7aff" stroke-width="2" />
        ${dataPoints}
        ${labels}
      </svg>
    `;
  };
  const resolveVerdictDisplayLabel = (verdict = "", grade = "") => {
    const normalizedVerdict = String(verdict || "").trim().toLowerCase();
    const normalizedGrade = String(grade || "").trim().toUpperCase();
    if (normalizedVerdict === "no_go") return "不建议";
    if (normalizedVerdict === "go" && normalizedGrade === "A") return "强推";
    if (normalizedVerdict === "go") return "推荐";
    return "谨慎";
  };
  const buildCardRecommendationLine = ({ decisionVerdict = {}, scoringSummaryText = "", opportunityType = "" } = {}) => {
    const verdict = String(decisionVerdict?.verdict || "").trim().toLowerCase();
    const normalizedOpportunityType = String(opportunityType || decisionVerdict?.opportunityType || "").trim();
    const grade = String(decisionVerdict?.grade || "").trim().toUpperCase();
    const blockers = Array.isArray(decisionVerdict?.hardBlockers) ? decisionVerdict.hardBlockers : [];
    if (blockers.length > 0 || verdict === "no_go" || grade === "F") return "与当前求职策略存在冲突，建议暂不优先。";
    if (normalizedOpportunityType === "high_value_role_pool") return "多方向招聘入口，与你目标方向高度相关，建议优先确认具体子岗位。";
    if (normalizedOpportunityType === "broad_recruitment_entry") return "岗位入口较广，方向部分相关，建议确认职责后推进。";
    if (normalizedOpportunityType === "low_quality_mixed_posting") return "岗位职责混杂且目标方向证据较弱，建议谨慎。";
    if (grade === "A") return "整体方向高度契合，建议优先纳入投递计划。";
    if (grade === "B") return "匹配度较高，建议作为本轮重点推进岗位。";
    if (grade === "C") return "关键方向基本相关，建议结合岗位细节后再决策。";
    if (grade === "D") return "存在明显偏差，建议谨慎评估投入优先级。";
    const text = String(scoringSummaryText || "").trim();
    if (!text) return "岗位信息存在不确定性，建议补充信息后再判断。";
    return truncateText(text, 44);
  };
  const renderFiveDimensionExplanationList = ({ dimensions = [], scoring = {}, decisionVerdict = {} } = {}) => {
    const rows = dimensions
      .slice(0, 5)
      .map((item) => {
        const text = buildFiveDimensionTooltipText({ dimension: item, scoring, decisionVerdict });
        return `<li><strong>${escapeHtml(item.dimensionLabel)}</strong>：${escapeHtml(text)}</li>`;
      })
      .join("");
    if (!rows) return "";
    return `<ul style="margin:8px 0 0 16px;padding:0;display:grid;gap:6px;">${rows}</ul>`;
  };
  const resolveRecommendationCodeFromVerdict = (verdict = "") => {
    const normalized = String(verdict || "").trim().toLowerCase();
    if (normalized === "go") return "apply";
    if (normalized === "no_go") return "skip";
    return "cautious";
  };
  const summarizePreferenceList = (items = [], max = 4) => {
    const list = Array.isArray(items) ? items.map((item) => String(item || "").trim()).filter(Boolean) : [];
    if (!list.length) return "未设置";
    const visible = list.slice(0, max).join(" / ");
    const extra = list.length - max;
    return extra > 0 ? `${visible} +${extra}` : visible;
  };
  const preferenceSummaryRows = [
    { label: "偏好行业", value: summarizePreferenceList(jobPreference.preferredIndustries, 4) },
    { label: "目标岗位", value: summarizePreferenceList(jobPreference.targetRoles, 4) },
    { label: "偏好地点", value: summarizePreferenceList(jobPreference.preferredLocations, 4) },
    { label: "排除行业", value: summarizePreferenceList(jobPreference.excludedIndustries, 4) },
    { label: "排除岗位", value: summarizePreferenceList(jobPreference.excludedRoles, 4) },
    { label: "偏好公司类型", value: summarizePreferenceList(jobPreference.companyTypes, 4) },
    { label: "排除公司类型", value: summarizePreferenceList(jobPreference.avoidCompanyTypes, 4) },
    { label: "求职类型", value: String(jobPreference.jobType || "").trim() || "未设置" },
    { label: "技能偏好（可选）", value: summarizePreferenceList(jobPreference.skills, 4) }
  ];
  const preferenceRowsByKey = preferenceSummaryRows.reduce((acc, row) => {
    acc[row.label] = row.value;
    return acc;
  }, {});
  const preferenceGroups = [
    {
      title: "必须条件",
      hint: "这些信息会显著影响推荐结果，排除项会作为强约束处理。",
      labels: ["目标岗位", "偏好地点", "求职类型", "排除行业", "排除岗位"]
    },
    {
      title: "强偏好",
      hint: "这些信息会影响排序优先级，但不会简单删除岗位。",
      labels: ["偏好行业", "偏好公司类型"]
    },
    {
      title: "辅助偏好",
      hint: "技能偏好属于辅助信号，会作为岗位契合度与申请门槛可达性的证据；证据不足不会直接判为冲突。",
      labels: ["技能偏好（可选）", "排除公司类型"]
    }
  ];

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${
      jobsLoadFailed || profileLoadFailed
        ? renderNotice(
            "warning",
            `页面部分数据加载失败：${jobsLoadFailed ? "岗位数据" : ""}${jobsLoadFailed && profileLoadFailed ? "、" : ""}${profileLoadFailed ? "个人偏好" : ""}。当前已启用降级展示。`
          )
        : ""
    }
    <div class="jobs-shell">
      <section class="jobs-hero">
        <div class="hero-copy">
          <div class="eyebrow">岗位队列</div>
          <h3 class="hero-title">这是你的 AI 求职决策面板，而不只是岗位列表。</h3>
          <p class="hero-subtitle">系统会基于偏好给出结构化判断，帮你快速决定：优先投、谨慎看，还是暂缓。</p>
          <div class="toolbar">
            <a class="button" href="#/jobs/new">导入目标JD（可选）</a>
          </div>
          <div class="muted">用于补充你已发现但系统未覆盖的目标岗位。</div>
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
        <div class="muted">按优先级和最近更新时间排序（默认显示核心信息，详细流程可展开）</div>
        </div>
        <div class="toolbar" style="margin-bottom:10px;">
          ${trackerFilterOptions
            .map(
              (option) => `
            <button
              class="button ${activeTrackerFilter === option.value ? "primary" : ""}"
              type="button"
              data-action="filter-tracker-state"
              data-state="${escapeHtml(option.value)}"
            >${escapeHtml(option.label)}</button>
          `
            )
            .join("")}
        </div>
        <div class="toolbar" style="margin-bottom:10px;">
          ${shortlistFilterOptions
            .map(
              (option) => `
            <button
              class="button ${activeShortlistFilter === option.value ? "primary" : ""}"
              type="button"
              data-action="filter-shortlist-state"
              data-state="${escapeHtml(option.value)}"
            >${escapeHtml(option.label)}</button>
          `
            )
            .join("")}
        </div>
        ${
          jobsLoadFailed
            ? `
          <div class="notice warning" data-empty-state="load_failed_partial">
            岗位数据加载失败（load_failed），当前无法确认最新排序结果。你可以稍后重试，或先进入 Dashboard / Profile 继续操作。
            <div class="toolbar" style="margin-top:10px;">
              <button class="button" type="button" data-action="retry-jobs-load">重试加载</button>
              <a class="button" href="#/dashboard">返回工作台</a>
              <a class="button" href="#/profile">查看个人资料</a>
            </div>
          </div>
        `
            : hasNoJobs
            ? `
          <div class="notice info" data-empty-state="no_jobs">
            当前暂无可展示岗位（no_jobs）。你可以先
            <a class="text-link" href="#/dashboard">填写求职偏好</a>
            或
            <a class="text-link" href="#/profile">完善个人资料</a>
            ，然后回到岗位页继续。
            <div class="toolbar" style="margin-top:10px;">
              <button class="button" type="button" data-action="jobs-refresh-from-preferences">刷新岗位数据</button>
            </div>
          </div>
        `
            : isFilteredEmpty
              ? `
          <div class="notice warning" data-empty-state="filtered_empty">
            当前筛选无结果（filtered_empty）。以下已临时展示全部岗位，避免首屏阻断；如需清除历史筛选，请点击下方按钮。
            <div class="toolbar" style="margin-top:10px;">
              <button class="button" type="button" data-action="jobs-reset-filters">一键恢复全部岗位</button>
            </div>
          </div>
        `
              : ""
        }
        ${
          filteredJobs.length > 0 && !top5HasHighMatch
            ? `
          <div class="notice warning">
            当前候选池暂未找到高匹配岗位，系统按五维优先级展示相对更接近的机会，建议补充更高质量岗位来源后再决策。
          </div>
        `
            : ""
        }
        <div class="stack">
          ${filteredJobs
                .map((jobVm) => {
                  const job = jobVm.jobSummary || {};
                  const decision = jobVm.decisionView || {};
                  const scoring = jobVm.scoringView || {};
                  const control = jobVm.controlView || {};
                  const originalUrl = resolveOriginalUrl(job);
                  const companyType = resolveCompanyType(job);
                  const companyIndustry = resolveCompanyIndustry(jobVm);
                  const scoringSummary = buildScoringSummary(scoring, decision);
                  const skillGapLine = resolveSkillGapLine(scoring.skillGapView);
                  const llmFallbackReason = String(scoring?.llmMeta?.errorReason || "").trim();
                  const decisionVerdict =
                    scoring.decisionVerdict && typeof scoring.decisionVerdict === "object"
                      ? scoring.decisionVerdict
                      : {};
                  const verdictGrade = String(decisionVerdict.grade || "").trim();
                  const verdictConfidence = resolveConfidenceLabel(decisionVerdict.confidence);
                  const verdictHardBlockers = Array.isArray(decisionVerdict.hardBlockers)
                    ? decisionVerdict.hardBlockers.slice(0, 1)
                    : [];
                  const verdictNextAction = String(decisionVerdict.nextAction || "").trim();
                  const strategy = humanizeStrategyDecision(
                    decision.nextAction === "skip"
                      ? "avoid"
                      : decision.nextAction === "collect_info"
                        ? "cautious_proceed"
                        : decision.nextAction === "hold"
                          ? "deprioritize"
                          : "proceed"
                  );
                  const attentionBadge =
                    jobVm.feedbackView?.hasUserOverride
                      ? '<span class="status offer">人工覆盖中</span>'
                      : control.gateStatus === "blocked"
                        ? '<span class="status archived">建议回避</span>'
                        : control.gateStatus === "needs_human_review"
                          ? '<span class="status evaluating">降低优先级</span>'
                          : decision.recommendation === "apply"
                            ? '<span class="status ready_to_apply">策略加权</span>'
                            : "";

                  const aiScoring = scoring.aiScoring && typeof scoring.aiScoring === "object" ? scoring.aiScoring : {};
                  const aiGrade = String(aiScoring.aiGrade || "").trim();
                  const dimensions = aiScoring.dimensions && typeof aiScoring.dimensions === "object" ? aiScoring.dimensions : {};
                  const nextActionLabel = verdictNextAction || "建议人工复核";
                  const explanationShort = truncateText(scoringSummary.summaryText, 46);
                  const explanationFull = scoringSummary.summaryText;
                  const verdictDisplayLabel = resolveVerdictDisplayLabel(decisionVerdict.verdict, verdictGrade);
                  const opportunityTypeLabel = String(scoring.opportunityTypeLabel || decisionVerdict.opportunityTypeLabel || "").trim();
                  const roleMatchSignal = (Array.isArray(scoring.matchedSignals) ? scoring.matchedSignals : [])
                    .map((item) => String(item || "").trim())
                    .find((item) => item.startsWith("命中岗位方向"));
                  const recommendationLine = buildCardRecommendationLine({
                    decisionVerdict,
                    scoringSummaryText: scoringSummary.summaryText,
                    opportunityType: scoring.opportunityType || decisionVerdict.opportunityType
                  });
                  const priorityScoreLabel = Number.isFinite(Number(scoring.userPriorityScore))
                    ? String(Math.round(Number(scoring.userPriorityScore)))
                    : "—";
                  const fiveDimensionView = buildFiveDimensionView({ scoring, decisionVerdict });
                  const fiveDimensionRadarSvg = renderFiveDimensionRadar({
                    dimensions: fiveDimensionView,
                    scoring,
                    decisionVerdict
                  });
                  const fiveDimensionExplanationList = renderFiveDimensionExplanationList({
                    dimensions: fiveDimensionView,
                    scoring,
                    decisionVerdict
                  });
                  const trackerView = jobVm.trackerView && typeof jobVm.trackerView === "object" ? jobVm.trackerView : {};
                  const trackerState = resolveTrackerState(trackerView.state);
                  const trackerStateLabel = resolveTrackerLabel(trackerState);
                  const trackerTimelineLine = resolveTrackerTimelineLine(trackerView);
                  const feedbackView = jobVm.feedbackView && typeof jobVm.feedbackView === "object" ? jobVm.feedbackView : {};
                  const feedbackState = resolveFeedbackState(feedbackView.state);
                  const feedbackStateLabel = resolveFeedbackLabel(feedbackState);
                  const feedbackTimelineLine = resolveFeedbackTimelineLine(feedbackView);
                  const shortlistView = jobVm.shortlistView && typeof jobVm.shortlistView === "object" ? jobVm.shortlistView : {};
                  const shortlistState = resolveShortlistState(shortlistView.state);
                  const shortlistStateLabel = resolveShortlistLabel(shortlistState);
                  const shortlistTimelineLine = resolveShortlistTimelineLine(shortlistView);
                  const materialsPrepView =
                    jobVm.materialsPrepView && typeof jobVm.materialsPrepView === "object" ? jobVm.materialsPrepView : {};
                  const resumeStatus = resolveMaterialState(materialsPrepView.resumeStatus, materialResumeStates);
                  const coverLetterStatus = resolveMaterialState(
                    materialsPrepView.coverLetterStatus,
                    materialCoverLetterStates
                  );
                  const interviewPrepStatus = resolveMaterialState(
                    materialsPrepView.interviewPrepStatus,
                    materialInterviewPrepStates
                  );
                  const materialsNotes = String(materialsPrepView.notes || "");
                  const materialsUpdatedLine = materialsPrepView.lastUpdatedAt
                    ? `材料更新于 ${formatDateTime(materialsPrepView.lastUpdatedAt)}`
                    : "材料记录未更新";
                  const submissionAuditView =
                    jobVm.submissionAuditView && typeof jobVm.submissionAuditView === "object" ? jobVm.submissionAuditView : {};
                  const submissionStatus = resolveSubmissionStatus(submissionAuditView.status);
                  const submissionSource = resolveSubmissionSource(submissionAuditView.source);
                  const submissionSubmittedAt = submissionAuditView.submittedAt
                    ? formatDateTime(submissionAuditView.submittedAt)
                    : "暂无";
                  const submissionLastAttemptAt = submissionAuditView.lastAttemptAt
                    ? formatDateTime(submissionAuditView.lastAttemptAt)
                    : "暂无";
                  const submissionAttemptCount = Number.isFinite(Number(submissionAuditView.attemptCount))
                    ? Math.max(0, Number(submissionAuditView.attemptCount))
                    : 0;
                  const submissionLastError = String(submissionAuditView.lastError || "");
                  const submissionNotes = String(submissionAuditView.notes || "");
                  const followUpView =
                    jobVm.followUpView && typeof jobVm.followUpView === "object" ? jobVm.followUpView : {};
                  const followUpStatus = resolveFollowUpStatus(followUpView.status);
                  const followUpChannel = resolveFollowUpChannel(followUpView.channel);
                  const followUpDueAt = String(followUpView.dueAt || "").trim();
                  const followUpDueAtLabel = followUpDueAt ? formatDateTime(followUpDueAt) : "暂无";
                  const followUpDueAtInputValue = toDateTimeLocalValue(followUpDueAt);
                  const followUpNotes = String(followUpView.notes || "");
                  const followUpUpdatedAtLabel = followUpView.lastUpdatedAt
                    ? formatDateTime(followUpView.lastUpdatedAt)
                    : "未更新";
                  const applyPriority = resolveApplyPriority(scoring);
                  const shortlistNextState = shortlistState === "shortlisted" ? "none" : "shortlisted";
                  const shortlistActionLabel = shortlistState === "shortlisted" ? "移出候选清单" : "加入候选清单";
                  const isDecisionBlocked = String(decisionVerdict.verdict || "").trim().toLowerCase() === "no_go" || verdictHardBlockers.length > 0;

                  return `
                    <article class="card jobs-item-card">
                      <div class="split" style="gap:10px;align-items:flex-start;">
                        <div style="min-width:0;flex:1;">
                          <div class="job-company-name job-title-clamp" title="${escapeHtml(job.company || "未知公司")}">${escapeHtml(job.company || "未知公司")}</div>
                          <div class="job-role-name" title="${escapeHtml(job.title || "未命名岗位")}">${escapeHtml(job.title || "未命名岗位")}</div>
                          <div class="muted">${escapeHtml(job.location || "地点未说明")} · ${escapeHtml(companyIndustry)} · ${escapeHtml(companyType)}</div>
                        </div>
                        <div style="text-align:right;flex-shrink:0;">
                          ${verdictGrade ? `<div class="grade-badge">等级 ${escapeHtml(verdictGrade)}</div>` : (aiGrade ? `<div class="grade-badge">等级 ${escapeHtml(aiGrade)}</div>` : "")}
                        </div>
                      </div>
                      <div class="inline-meta" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
                        <span class="status evaluating">${escapeHtml(verdictDisplayLabel)}</span>
                        <span class="status inbox">${escapeHtml(verdictConfidence)}</span>
                        ${opportunityTypeLabel ? `<span class="status inbox">${escapeHtml(opportunityTypeLabel)}</span>` : ""}
                        ${roleMatchSignal ? `<span class="status ready_to_apply">${escapeHtml(roleMatchSignal)}</span>` : ""}
                        <span class="status inbox">优先级分数 ${escapeHtml(priorityScoreLabel)}</span>
                        <span class="status inbox">投递优先级 ${escapeHtml(resolveApplyPriorityLabel(applyPriority))}</span>
                        ${attentionBadge}
                      </div>
                      <div class="panel" style="margin-top:8px;padding:10px;">
                        <div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;">
                          <div style="flex:0 0 168px;max-width:100%;">${fiveDimensionRadarSvg}</div>
                          <div style="min-width:0;flex:1;">
                            <div class="muted">桌面端可悬停查看维度依据。</div>
                            <details class="activity-disclosure" style="margin-top:8px;">
                              <summary class="muted" style="cursor:pointer;">查看五维判断依据</summary>
                              ${fiveDimensionExplanationList}
                            </details>
                          </div>
                        </div>
                      </div>
                      <div class="panel" style="margin-top:8px;padding:10px;">
                        <div><strong>${escapeHtml(recommendationLine)}</strong></div>
                      </div>
                      <div class="muted" style="margin-top:8px;">下一步：${escapeHtml(nextActionLabel)}</div>
                      <details class="activity-disclosure" style="margin-top:8px;">
                        <summary class="muted" style="cursor:pointer;">评分解释：查看排序理由与维度</summary>
                        <div class="muted explanation-extra" style="margin-top:8px;">${escapeHtml(explanationFull || "暂无解释")}</div>
                        ${verdictHardBlockers.length > 0 ? `<div class="muted explanation-extra">阻断项：${escapeHtml(verdictHardBlockers[0])}</div>` : ""}
                        <div class="muted explanation-extra">${escapeHtml(skillGapLine)}</div>
                        ${llmFallbackReason ? `<div class="muted explanation-extra">AI评分回退：${escapeHtml(llmFallbackReason)}</div>` : ""}
                        <div class="muted explanation-extra">${escapeHtml(strategy.label)}</div>
                      </details>
                      <div class="toolbar" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;">
                        ${
                          originalUrl
                            ? `<a class="button" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">原始链接 / 投递链接</a>`
                            : `<span class="muted">投递链接：需处理</span>`
                        }
                        ${
                          isDecisionBlocked
                            ? `<button class="button" type="button" disabled title="命中阻断项，当前不可执行网申">一键网申（已阻断）</button>`
                            : `<button
                                class="button primary"
                                type="button"
                                data-action="open-apply-modal"
                                data-job-id="${escapeHtml(jobVm.id)}"
                                data-job-title="${escapeHtml(job.title || "未命名岗位")}"
                                data-job-company="${escapeHtml(job.company || "未知公司")}"
                                data-job-url="${escapeHtml(originalUrl)}"
                              >
                                一键网申
                              </button>`
                        }
                        <a class="button" href="#/jobs/${jobVm.id}">查看详情</a>
                      </div>
                      <details class="activity-disclosure" style="margin-top:10px;">
                        <summary class="muted" style="cursor:pointer;">流程追踪 / 反馈 / 候选清单（紧凑）</summary>
                        <div class="inline-meta" style="margin-top:8px;">
                          <span class="status evaluating">${escapeHtml(trackerStateLabel)}</span>
                        </div>
                        <div class="muted explanation-extra">${escapeHtml(trackerTimelineLine)}</div>
                        <div class="toolbar" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;">
                          <button class="button" type="button" data-action="set-tracker-state" data-job-id="${escapeHtml(jobVm.id)}" data-next-state="saved">已收藏</button>
                          <button class="button" type="button" data-action="set-tracker-state" data-job-id="${escapeHtml(jobVm.id)}" data-next-state="prep">准备中</button>
                          <button class="button" type="button" data-action="set-tracker-state" data-job-id="${escapeHtml(jobVm.id)}" data-next-state="tailored">已定制材料</button>
                          <button class="button" type="button" data-action="set-tracker-state" data-job-id="${escapeHtml(jobVm.id)}" data-next-state="applied">已投递</button>
                          <button class="button" type="button" data-action="set-tracker-state" data-job-id="${escapeHtml(jobVm.id)}" data-next-state="interview">面试中</button>
                          <button class="button" type="button" data-action="set-tracker-state" data-job-id="${escapeHtml(jobVm.id)}" data-next-state="rejected">已拒绝</button>
                          <button class="button" type="button" data-action="set-tracker-state" data-job-id="${escapeHtml(jobVm.id)}" data-next-state="offer">录用</button>
                        </div>
                        <div class="inline-meta" style="margin-top:10px;">
                          <span class="status inbox">${escapeHtml(feedbackStateLabel)}</span>
                        </div>
                        <div class="muted explanation-extra">${escapeHtml(feedbackTimelineLine)}</div>
                        <div class="toolbar" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;">
                          <button class="button" type="button" data-action="set-feedback-state" data-job-id="${escapeHtml(jobVm.id)}" data-next-state="good_fit">👍 好岗位</button>
                          <button class="button" type="button" data-action="set-feedback-state" data-job-id="${escapeHtml(jobVm.id)}" data-next-state="bad_fit">👎 不匹配</button>
                          <button class="button" type="button" data-action="set-feedback-state" data-job-id="${escapeHtml(jobVm.id)}" data-next-state="misclassified">⚠ 误判</button>
                        </div>
                        <div class="inline-meta" style="margin-top:10px;">
                          <span class="status saved">${escapeHtml(shortlistStateLabel)}</span>
                        </div>
                        <div class="muted explanation-extra">${escapeHtml(shortlistTimelineLine)}</div>
                        <div class="toolbar" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;">
                          <button class="button" type="button" data-action="set-shortlist-state" data-job-id="${escapeHtml(jobVm.id)}" data-next-state="${escapeHtml(shortlistNextState)}">${escapeHtml(shortlistActionLabel)}</button>
                        </div>
                      </details>
                      <details class="activity-disclosure" style="margin-top:10px;">
                        <summary class="muted" style="cursor:pointer;">材料准备（${escapeHtml(resolveMaterialLabel(resumeStatus))} / ${escapeHtml(resolveMaterialLabel(coverLetterStatus))}）</summary>
                        <div class="muted explanation-extra" style="margin-top:8px;">${escapeHtml(materialsUpdatedLine)}</div>
                        <div class="split" style="margin-top:8px;gap:6px;">
                          <label class="muted">简历
                            <select data-material-field="resumeStatus" data-job-id="${escapeHtml(jobVm.id)}">
                              ${materialResumeStates
                                .map(
                                  (state) =>
                                    `<option value="${escapeHtml(state)}" ${resumeStatus === state ? "selected" : ""}>${escapeHtml(resolveMaterialLabel(state))}</option>`
                                )
                                .join("")}
                            </select>
                          </label>
                          <label class="muted">求职信
                            <select data-material-field="coverLetterStatus" data-job-id="${escapeHtml(jobVm.id)}">
                              ${materialCoverLetterStates
                                .map(
                                  (state) =>
                                    `<option value="${escapeHtml(state)}" ${coverLetterStatus === state ? "selected" : ""}>${escapeHtml(resolveMaterialLabel(state))}</option>`
                                )
                                .join("")}
                            </select>
                          </label>
                          <label class="muted">面试准备
                            <select data-material-field="interviewPrepStatus" data-job-id="${escapeHtml(jobVm.id)}">
                              ${materialInterviewPrepStates
                                .map(
                                  (state) =>
                                    `<option value="${escapeHtml(state)}" ${interviewPrepStatus === state ? "selected" : ""}>${escapeHtml(resolveMaterialLabel(state))}</option>`
                                )
                                .join("")}
                            </select>
                          </label>
                        </div>
                        <div style="margin-top:8px;">
                          <input
                            data-material-field="notes"
                            data-job-id="${escapeHtml(jobVm.id)}"
                            maxlength="2000"
                            placeholder="材料备注（仅用于记录）"
                            value="${escapeHtml(materialsNotes)}"
                          />
                        </div>
                        <div class="toolbar" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
                          <button class="button" type="button" data-action="save-materials-prep" data-job-id="${escapeHtml(jobVm.id)}">保存材料记录</button>
                        </div>
                      </details>
                      <details class="activity-disclosure" style="margin-top:10px;">
                        <summary class="muted" style="cursor:pointer;">投递记录（${escapeHtml(resolveSubmissionStatusLabel(submissionStatus))}）</summary>
                        <div class="inline-meta" style="margin-top:10px;">
                          <span class="status applied">${escapeHtml(resolveSubmissionStatusLabel(submissionStatus))}</span>
                          <span class="status inbox">${escapeHtml(resolveSubmissionSourceLabel(submissionSource))}</span>
                        </div>
                        <div class="muted explanation-extra">提交时间：${escapeHtml(submissionSubmittedAt)}</div>
                        <div class="muted explanation-extra">最近尝试：${escapeHtml(submissionLastAttemptAt)} · 尝试次数=${escapeHtml(String(submissionAttemptCount))}</div>
                        ${submissionLastError ? `<div class="muted explanation-extra">错误：${escapeHtml(submissionLastError)}</div>` : ""}
                        <div class="split" style="margin-top:8px;gap:6px;">
                          <label class="muted">投递状态
                            <select data-submission-field="status" data-job-id="${escapeHtml(jobVm.id)}">
                              ${submissionAuditStatuses
                                .map(
                                  (state) =>
                                    `<option value="${escapeHtml(state)}" ${submissionStatus === state ? "selected" : ""}>${escapeHtml(resolveSubmissionStatusLabel(state))}</option>`
                                )
                                .join("")}
                            </select>
                          </label>
                          <label class="muted">来源
                            <select data-submission-field="source" data-job-id="${escapeHtml(jobVm.id)}">
                              ${submissionAuditSources
                                .map(
                                  (state) =>
                                    `<option value="${escapeHtml(state)}" ${submissionSource === state ? "selected" : ""}>${escapeHtml(resolveSubmissionSourceLabel(state))}</option>`
                                )
                                .join("")}
                            </select>
                          </label>
                        </div>
                        <div style="margin-top:8px;">
                          <input
                            data-submission-field="lastError"
                            data-job-id="${escapeHtml(jobVm.id)}"
                            maxlength="2000"
                            placeholder="提交错误（可选）"
                            value="${escapeHtml(submissionLastError)}"
                          />
                        </div>
                        <div style="margin-top:8px;">
                          <input
                            data-submission-field="notes"
                            data-job-id="${escapeHtml(jobVm.id)}"
                            maxlength="2000"
                            placeholder="投递审计备注（仅用于记录）"
                            value="${escapeHtml(submissionNotes)}"
                          />
                        </div>
                        <div class="toolbar" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
                          <button class="button" type="button" data-action="save-submission-audit" data-job-id="${escapeHtml(jobVm.id)}">保存投递审计</button>
                        </div>
                      </details>
                      <details class="activity-disclosure" style="margin-top:10px;">
                        <summary class="muted" style="cursor:pointer;">跟进提醒（${escapeHtml(resolveFollowUpStatusLabel(followUpStatus))}）</summary>
                        <div class="inline-meta" style="margin-top:10px;">
                          <span class="status follow_up">${escapeHtml(resolveFollowUpStatusLabel(followUpStatus))}</span>
                          <span class="status inbox">${escapeHtml(resolveFollowUpChannelLabel(followUpChannel))}</span>
                        </div>
                        <div class="muted explanation-extra">跟进时间：${escapeHtml(followUpDueAtLabel)}</div>
                        <div class="muted explanation-extra">更新时间：${escapeHtml(followUpUpdatedAtLabel)}</div>
                        <div class="split" style="margin-top:8px;gap:6px;">
                          <label class="muted">跟进状态
                            <select data-followup-field="status" data-job-id="${escapeHtml(jobVm.id)}">
                              ${followUpStatuses
                                .map(
                                  (state) =>
                                    `<option value="${escapeHtml(state)}" ${followUpStatus === state ? "selected" : ""}>${escapeHtml(resolveFollowUpStatusLabel(state))}</option>`
                                )
                                .join("")}
                            </select>
                          </label>
                          <label class="muted">沟通渠道
                            <select data-followup-field="channel" data-job-id="${escapeHtml(jobVm.id)}">
                              ${followUpChannels
                                .map(
                                  (channel) =>
                                    `<option value="${escapeHtml(channel)}" ${followUpChannel === channel ? "selected" : ""}>${escapeHtml(resolveFollowUpChannelLabel(channel))}</option>`
                                )
                                .join("")}
                            </select>
                          </label>
                        </div>
                        <div style="margin-top:8px;">
                          <label class="muted">跟进时间
                            <input
                              type="datetime-local"
                              data-followup-field="dueAt"
                              data-job-id="${escapeHtml(jobVm.id)}"
                              value="${escapeHtml(followUpDueAtInputValue)}"
                            />
                          </label>
                        </div>
                        <div style="margin-top:8px;">
                          <input
                            data-followup-field="notes"
                            data-job-id="${escapeHtml(jobVm.id)}"
                            maxlength="2000"
                            placeholder="跟进备注（仅用于记录）"
                            value="${escapeHtml(followUpNotes)}"
                          />
                        </div>
                        <div class="toolbar" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
                          <button class="button" type="button" data-action="save-follow-up" data-job-id="${escapeHtml(jobVm.id)}">保存跟进提醒</button>
                        </div>
                      </details>
                    </article>
                  `;
                })
                .join("")}
        </div>
      </section>

      <section class="card">
        <div class="section-head">
          <div>
            <div class="eyebrow">当前偏好</div>
            <h3>本页排序依据</h3>
          </div>
          <div class="toolbar">
            <a class="button" href="#/profile?section=profile-preference-section">去个人画像修改偏好</a>
          </div>
        </div>
        <div class="muted">
          当前按：行业（${escapeHtml(summarizePreferenceList(jobPreference.preferredIndustries, 3))}）/
          岗位（${escapeHtml(summarizePreferenceList(jobPreference.targetRoles, 3))}）/
          地点（${escapeHtml(summarizePreferenceList(jobPreference.preferredLocations, 3))}）/
          公司（${escapeHtml(summarizePreferenceList(jobPreference.companyTypes, 3))}）/
          求职类型（${escapeHtml(String(jobPreference.jobType || "不限"))}）排序。
        </div>
        <details class="activity-disclosure" style="margin-top:8px;">
          <summary class="muted" style="cursor:pointer;">展开查看完整偏好依据</summary>
          <div class="muted">以下岗位排序基于当前偏好与岗位匹配结果。</div>
          <div class="muted">反馈会轻微影响后续同类岗位排序。</div>
          <div class="stack" style="margin-top:10px;">
            ${preferenceGroups
              .map((group) => {
                const groupRows = group.labels.map((label) => ({
                  label,
                  value: preferenceRowsByKey[label] || "未设置"
                }));
                return `
                  <div class="panel">
                    <strong>${escapeHtml(group.title)}</strong>
                    <div class="muted">${escapeHtml(group.hint)}</div>
                    <div class="info-grid" style="margin-top:8px;">
                      ${groupRows
                        .map(
                          (row) => `
                            <div class="panel">
                              <strong>${escapeHtml(row.label)}</strong>
                              <div class="muted">${escapeHtml(row.value)}</div>
                            </div>
                          `
                        )
                        .join("")}
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>
        </details>
      </section>

      <section class="card">
        <details class="activity-disclosure">
          <summary class="section-head" style="cursor:pointer;">
            <div>
              <div class="eyebrow">批量对比</div>
              <h3>候选清单对比面板</h3>
            </div>
            <div class="muted">仅展示已加入候选清单的岗位</div>
          </summary>
          ${
            shortlistedJobs.length === 0
              ? `<div class="muted">当前暂无候选清单岗位，请先在岗位卡片中点击“加入候选清单”。</div>`
              : `
                <div class="stack">
                  ${shortlistedJobs
                    .map((jobVm) => {
                      const job = jobVm.jobSummary || {};
                      const scoring = jobVm.scoringView || {};
                      const companyType = resolveCompanyType(job);
                      const companyIndustry = resolveCompanyIndustry(jobVm);
                      const verdict = scoring.decisionVerdict || {};
                      const blockers = Array.isArray(verdict.hardBlockers) ? verdict.hardBlockers : [];
                      const verdictGrade = String(verdict.grade || "").trim();
                      const verdictDisplayLabel = resolveVerdictDisplayLabel(verdict.verdict, verdictGrade);
                      const opportunityTypeLabel = String(scoring.opportunityTypeLabel || verdict.opportunityTypeLabel || "").trim();
                      const trackerState = resolveTrackerLabel(jobVm?.trackerView?.state);
                      const feedbackState = resolveFeedbackLabel(jobVm?.feedbackView?.state);
                      const priority = resolveApplyPriority(scoring);
                      const fiveDimensionView = buildFiveDimensionView({ scoring, decisionVerdict: verdict });
                      const fiveDimensionRadarSvg = renderFiveDimensionRadar({
                        dimensions: fiveDimensionView,
                        scoring,
                        decisionVerdict: verdict
                      });
                      const fiveDimensionExplanationList = renderFiveDimensionExplanationList({
                        dimensions: fiveDimensionView,
                        scoring,
                        decisionVerdict: verdict
                      });
                      const dimensionSummaryText = fiveDimensionView
                        .map((item) => `${item.dimensionLabel}：${item.stateLabel}`)
                        .join(" / ");
                      return `
                        <div class="panel">
                          <div class="split">
                            <div>
                              <strong>${escapeHtml(job.company || "未知公司")}</strong>
                              <div class="muted">${escapeHtml(job.title || "未命名岗位")}</div>
                              <div class="muted">${escapeHtml(job.location || "地点未说明")} · ${escapeHtml(companyIndustry || "行业未说明")} · ${escapeHtml(companyType || "公司类型未说明")}</div>
                            </div>
                          </div>
                          <div class="inline-meta" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
                            <span class="status evaluating">${escapeHtml(verdictDisplayLabel)}</span>
                            <span class="status inbox">等级 ${escapeHtml(verdictGrade || "—")}</span>
                            <span class="status inbox">${escapeHtml(resolveConfidenceLabel(verdict.confidence))}</span>
                            ${opportunityTypeLabel ? `<span class="status inbox">${escapeHtml(opportunityTypeLabel)}</span>` : ""}
                            <span class="status inbox">投递优先级 ${escapeHtml(resolveApplyPriorityLabel(priority))}</span>
                          </div>
                          <div class="muted" style="margin-top:6px;">流程：${escapeHtml(trackerState)} · 反馈：${escapeHtml(feedbackState)}</div>
                          <div class="muted" style="margin-top:8px;">五维摘要：${escapeHtml(dimensionSummaryText)}</div>
                          <details class="activity-disclosure" style="margin-top:8px;">
                            <summary class="muted" style="cursor:pointer;">展开五维图与详细证据</summary>
                            <div class="panel" style="margin-top:8px;padding:10px;">
                              <div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;">
                                <div style="flex:0 0 168px;max-width:100%;">${fiveDimensionRadarSvg}</div>
                                <div style="min-width:0;flex:1;">
                                  <div class="muted">桌面端可悬停查看维度依据。</div>
                                  <details class="activity-disclosure" style="margin-top:8px;">
                                    <summary class="muted" style="cursor:pointer;">查看五维判断依据</summary>
                                    ${fiveDimensionExplanationList}
                                  </details>
                                </div>
                              </div>
                            </div>
                          </details>
                          <div class="muted" style="margin-top:8px;">建议动作：${escapeHtml(String(verdict.nextAction || "建议人工复核"))}</div>
                          <div class="muted">${escapeHtml(blockers[0] || "无阻断项")}</div>
                        </div>
                      `;
                    })
                    .join("")}
                </div>
              `
          }
        </details>
      </section>
    </div>
    <div id="jobs-apply-modal" class="apply-modal hidden" role="dialog" aria-modal="true" aria-labelledby="jobs-apply-modal-title">
      <div class="apply-modal-backdrop" data-action="close-apply-modal"></div>
      <div class="apply-modal-card">
        <h4 id="jobs-apply-modal-title">一键网申辅助</h4>
        <div id="jobs-apply-modal-body" class="stack"></div>
        <div class="toolbar">
          <a
            class="button"
            href="/downloads/applyflow-edge-mvp-v11-semantic-slots.zip"
            target="_blank"
            rel="noopener noreferrer"
          >
            下载并安装插件
          </a>
          <a class="button" href="#/profile">去完善资料</a>
          <a class="button primary" id="jobs-apply-manual-link" target="_blank" rel="noopener noreferrer">先手动申请</a>
          <button class="button" type="button" data-action="close-apply-modal">关闭</button>
        </div>
      </div>
    </div>
  `;

  const autofillProfile = profile.autofillProfile && typeof profile.autofillProfile === "object" ? profile.autofillProfile : {};

  const isMissing = (value) => !String(value || "").trim();
  const readinessChecks = [
    { key: "full_name", label: "姓名" },
    { key: "email", label: "邮箱" },
    { key: "phone", label: "电话" },
    { key: "school_name", label: "学校" },
    { key: "degree", label: "学历/学位" },
    { key: "major", label: "专业" }
  ];
  const missingFields = readinessChecks.filter((entry) => isMissing(autofillProfile[entry.key]));
  const readinessStatus = missingFields.length === 0 ? "ready" : missingFields.length <= 2 ? "partial" : "missing";
  const lastPluginSyncAt = String(
    autofillProfile?.pluginMeta?.lastSyncedAt ||
      profile?.pluginMeta?.lastSyncedAt ||
      ""
  ).trim();
  const pluginStatus = lastPluginSyncAt ? "ready" : "missing";

  const modal = document.getElementById("jobs-apply-modal");
  const modalBody = document.getElementById("jobs-apply-modal-body");
  const manualLink = document.getElementById("jobs-apply-manual-link");

  const closeModal = () => {
    modal?.classList.add("hidden");
    if (manualLink) {
      manualLink.removeAttribute("href");
      manualLink.classList.add("is-disabled");
    }
  };

  const openModal = ({ company = "", title: jobTitle = "", url = "" } = {}) => {
    const profileStatusText =
      readinessStatus === "ready"
        ? "资料状态：已完善。可直接使用插件进行网页预填。"
        : readinessStatus === "partial"
          ? `资料状态：部分缺失。建议先补全：${missingFields.map((item) => item.label).join(" / ")}。`
          : `资料状态：未完善。建议先补全：${missingFields.map((item) => item.label).join(" / ")}。`;
    const pluginStatusText =
      pluginStatus === "ready"
        ? `插件状态：已检测到最近同步（${formatDateTime(lastPluginSyncAt)}）。`
        : "插件状态：未安装或未启用。请先下载插件并在 Edge 扩展页加载。";
    const nextActionText =
      readinessStatus !== "ready"
        ? "下一步：先去个人资料补全网申辅助资料，再回到岗位列表点击一键网申。"
        : pluginStatus !== "ready"
          ? "下一步：先安装并启用插件，然后打开岗位投递链接执行辅助填写。"
          : "下一步：可直接打开投递链接，使用插件辅助填写；也可继续手动申请。";

    modalBody.innerHTML = `
      <div class="notice info">岗位：${escapeHtml(company)} · ${escapeHtml(jobTitle)}</div>
      <div class="muted">一键网申依赖 Edge 插件执行网页预填，这不是强制步骤，你始终可以继续手动申请。</div>
      <div class="muted">${escapeHtml(profileStatusText)}</div>
      <div class="muted">${escapeHtml(pluginStatusText)}</div>
      <div class="muted">${escapeHtml(nextActionText)}</div>
      ${
        url
          ? `<div class="muted">你也可以直接打开投递链接继续手动申请。</div>`
          : `<div class="notice warning">该岗位暂无投递链接，建议先进入详情页补充来源链接。</div>`
      }
    `;
    if (manualLink) {
      if (url) {
        manualLink.href = url;
        manualLink.classList.remove("is-disabled");
      } else {
        manualLink.removeAttribute("href");
        manualLink.classList.add("is-disabled");
      }
    }
    modal?.classList.remove("hidden");
  };

  document.querySelectorAll("[data-action='open-apply-modal']").forEach((button) => {
    button.addEventListener("click", () => {
      openModal({
        company: button.dataset.jobCompany || "",
        title: button.dataset.jobTitle || "",
        url: button.dataset.jobUrl || ""
      });
    });
  });

  document.querySelectorAll("[data-action='filter-tracker-state']").forEach((button) => {
    button.addEventListener("click", () => {
      const state = String(button.dataset.state || "all").trim().toLowerCase();
      localStorage.setItem(JOBS_TRACKER_FILTER_LOCAL_KEY, state);
      renderJobs(message);
    });
  });

  document.querySelectorAll("[data-action='filter-shortlist-state']").forEach((button) => {
    button.addEventListener("click", () => {
      const state = String(button.dataset.state || "all").trim().toLowerCase();
      localStorage.setItem(JOBS_SHORTLIST_FILTER_LOCAL_KEY, state);
      renderJobs(message);
    });
  });

  document.querySelectorAll("[data-action='set-tracker-state']").forEach((button) => {
    button.addEventListener("click", async () => {
      const jobId = String(button.dataset.jobId || "").trim();
      const nextState = String(button.dataset.nextState || "").trim().toLowerCase();
      if (!jobId || !nextState) return;
      try {
        setButtonPending(button, true, "更新中...");
        await api(`/api/jobs/${jobId}/tracker-state`, {
          method: "POST",
          body: JSON.stringify({ nextState })
        });
        renderJobs("岗位跟进状态已更新。");
      } catch (error) {
        setButtonPending(button, false);
        renderJobs(`岗位跟进状态更新失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll("[data-action='set-feedback-state']").forEach((button) => {
    button.addEventListener("click", async () => {
      const jobId = String(button.dataset.jobId || "").trim();
      const nextState = String(button.dataset.nextState || "").trim().toLowerCase();
      if (!jobId || !nextState) return;
      try {
        setButtonPending(button, true, "更新中...");
        await api(`/api/jobs/${jobId}/feedback-state`, {
          method: "POST",
          body: JSON.stringify({ nextState })
        });
        renderJobs("岗位反馈已记录。");
      } catch (error) {
        setButtonPending(button, false);
        renderJobs(`岗位反馈记录失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll("[data-action='set-shortlist-state']").forEach((button) => {
    button.addEventListener("click", async () => {
      const jobId = String(button.dataset.jobId || "").trim();
      const nextState = String(button.dataset.nextState || "").trim().toLowerCase();
      if (!jobId || !nextState) return;
      try {
        setButtonPending(button, true, "更新中...");
        await api(`/api/jobs/${jobId}/shortlist-state`, {
          method: "POST",
          body: JSON.stringify({ nextState })
        });
        renderJobs("候选清单已更新。");
      } catch (error) {
        setButtonPending(button, false);
        renderJobs(`候选清单更新失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll("[data-action='save-materials-prep']").forEach((button) => {
    button.addEventListener("click", async () => {
      const jobId = String(button.dataset.jobId || "").trim();
      if (!jobId) return;
      const readValue = (field) => {
        const el = document.querySelector(`[data-material-field="${field}"][data-job-id="${jobId}"]`);
        return el ? String(el.value || "").trim() : "";
      };
      const payload = {
        resumeStatus: readValue("resumeStatus"),
        coverLetterStatus: readValue("coverLetterStatus"),
        interviewPrepStatus: readValue("interviewPrepStatus"),
        notes: readValue("notes")
      };
      try {
        setButtonPending(button, true, "保存中...");
        await api(`/api/jobs/${jobId}/materials-prep`, {
          method: "POST",
          body: JSON.stringify(payload)
        });
        renderJobs("材料准备记录已保存。");
      } catch (error) {
        setButtonPending(button, false);
        renderJobs(`材料准备记录保存失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll("[data-action='save-submission-audit']").forEach((button) => {
    button.addEventListener("click", async () => {
      const jobId = String(button.dataset.jobId || "").trim();
      if (!jobId) return;
      const readValue = (field) => {
        const el = document.querySelector(`[data-submission-field="${field}"][data-job-id="${jobId}"]`);
        return el ? String(el.value || "").trim() : "";
      };
      const payload = {
        status: readValue("status"),
        source: readValue("source"),
        lastError: readValue("lastError"),
        notes: readValue("notes")
      };
      try {
        setButtonPending(button, true, "保存中...");
        await api(`/api/jobs/${jobId}/submission-audit`, {
          method: "POST",
          body: JSON.stringify(payload)
        });
        renderJobs("投递审计记录已更新。");
      } catch (error) {
        setButtonPending(button, false);
        renderJobs(`投递审计记录更新失败：${error.message}`);
      }
    });
  });

  document.querySelectorAll("[data-action='save-follow-up']").forEach((button) => {
    button.addEventListener("click", async () => {
      const jobId = String(button.dataset.jobId || "").trim();
      if (!jobId) return;
      const readValue = (field) => {
        const el = document.querySelector(`[data-followup-field="${field}"][data-job-id="${jobId}"]`);
        return el ? String(el.value || "").trim() : "";
      };
      const rawDueAt = readValue("dueAt");
      const payload = {
        status: readValue("status"),
        channel: readValue("channel"),
        dueAt: rawDueAt ? new Date(rawDueAt).toISOString() : "",
        notes: readValue("notes")
      };
      try {
        setButtonPending(button, true, "保存中...");
        await api(`/api/jobs/${jobId}/follow-up`, {
          method: "POST",
          body: JSON.stringify(payload)
        });
        renderJobs("跟进提醒记录已更新。");
      } catch (error) {
        setButtonPending(button, false);
        renderJobs(`跟进提醒记录更新失败：${error.message}`);
      }
    });
  });

  modal?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-action='close-apply-modal']")) {
      closeModal();
    }
  });

  document.querySelectorAll("[data-action='close-apply-modal']").forEach((button) => {
    button.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!modal || modal.classList.contains("hidden")) return;
    closeModal();
  });

  const refreshJobsButton = document.querySelector("[data-action='jobs-refresh-from-preferences']");
  if (refreshJobsButton) {
    refreshJobsButton.addEventListener("click", async () => {
      try {
        setButtonPending(refreshJobsButton, true, "刷新中...");
        await triggerJobsSeedFromProfile({
          onDone: () => {
            renderJobs("岗位数据已刷新。");
          }
        });
      } catch (error) {
        setButtonPending(refreshJobsButton, false);
        renderJobs("", error.message || "刷新岗位数据失败。");
      }
    });
  }

  const resetJobsFiltersButton = document.querySelector("[data-action='jobs-reset-filters']");
  if (resetJobsFiltersButton) {
    resetJobsFiltersButton.addEventListener("click", () => {
      localStorage.setItem(JOBS_TRACKER_FILTER_LOCAL_KEY, "all");
      localStorage.setItem(JOBS_SHORTLIST_FILTER_LOCAL_KEY, "all");
      renderJobs("已恢复全部岗位展示。");
    });
  }
  const retryJobsLoadButton = document.querySelector("[data-action='retry-jobs-load']");
  if (retryJobsLoadButton) {
    retryJobsLoadButton.addEventListener("click", () => {
      renderJobs(message);
    });
  }
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
  const safeStatuses = (Array.isArray(allowedNextStatuses) ? allowedNextStatuses : []).filter(
    (status) => status !== "applied"
  );

  if (!safeStatuses.length) {
    return `<div class="empty">当前状态没有可继续推进的非执行流转。</div>`;
  }

  const recommendedStatuses = Array.isArray(recommendedNextStatuses) ? recommendedNextStatuses : [];

  return `
    <div class="toolbar">
      ${safeStatuses
        .map((status) => {
          const emphasized = recommendedStatuses.includes(status) ? "primary" : "";
          return `<button class="button ${emphasized}" data-next-status="${status}">${getStatusActionLabel(status)}</button>`;
        })
        .join("")}
    </div>
  `;
}

function localizeExecutionLabel(value) {
  const rawValue = String(value || "").trim();
  const labels = {
    ready_to_apply: "可进入投递准备",
    to_prepare: "待准备",
    needs_human_review: "需要人工确认",
    blocked: "已阻止",
    pending: "待处理",
    confirmed: "已确认",
    submitted: "已提交",
    exported: "已导出",
    failed: "失败",
    unknown: "未知",
    success: "成功",
    created: "已创建",
    continue_browser: "继续在浏览器中处理",
    generic_html_form: "通用网页表单",
    stage: "阶段",
    dry_run: "提交前检查",
    submit: "提交记录",
    confirm: "人工确认",
    execution_created: "已创建执行记录",
    execution_dry_run_completed: "提交前检查已完成",
    execution_submit_completed: "提交记录已完成"
  };
  return labels[rawValue] || rawValue.replaceAll("_", " ");
}

function renderExecutionSession(session = {}, job = {}) {
  const gateStatus = session.gateStatus || "needs_human_review";
  const confirmState = session.confirmState || "pending";
  const submitOutcome = session.submitOutcome || "pending";
  const requiredActions = Array.isArray(session.requiredActions) ? session.requiredActions : [];
  const timeline = Array.isArray(session.stageTimeline) ? session.stageTimeline : [];
  const canDryRun = gateStatus !== "blocked" && ["to_prepare", "ready_to_apply"].includes(job.status);
  const canConfirm = Boolean(session.confirmRequired) && confirmState !== "confirmed";
  const canSubmit =
    job.status === "ready_to_apply" &&
    gateStatus !== "blocked" &&
    (gateStatus !== "needs_human_review" || confirmState === "confirmed");

  return `
    <div class="panel">
      <strong>执行会话</strong>
      <div class="muted">执行编号：${escapeHtml(session.runId || "未生成")}</div>
      <div class="trace-detail"><strong>门禁状态</strong><span>${escapeHtml(localizeExecutionLabel(gateStatus))}</span></div>
      <div class="trace-detail"><strong>确认状态</strong><span>${escapeHtml(localizeExecutionLabel(confirmState))}</span></div>
      <div class="trace-detail"><strong>提交结果</strong><span>${escapeHtml(localizeExecutionLabel(submitOutcome))}</span></div>
      ${session.latestEventType ? `<div class="trace-detail"><strong>最新事件</strong><span>${escapeHtml(localizeExecutionLabel(session.latestEventType))}</span></div>` : ""}
      ${session.failureReason ? `<div class="notice warning">${escapeHtml(session.failureReason)}</div>` : ""}
      ${requiredActions.length ? `<div class="trace-detail"><strong>要求动作</strong><span>${escapeHtml(requiredActions.join(" / "))}</span></div>` : ""}
      ${
        timeline.length
          ? `<div class="stack" style="margin-top:8px;">${timeline
              .map(
                (item) => `
                  <div class="trace-detail">
                    <strong>${escapeHtml(localizeExecutionLabel(item.stage || "stage"))}</strong>
                    <span>${escapeHtml(localizeExecutionLabel(item.status || "pending"))}${item.timestamp ? ` · ${escapeHtml(new Date(item.timestamp).toLocaleString())}` : ""}</span>
                  </div>
                `
              )
              .join("")}</div>`
          : ""
      }
      <div class="toolbar" style="margin-top:10px;">
        <button class="button" type="button" id="execution-dry-run-btn" ${canDryRun ? "" : "disabled"}>先做提交前检查</button>
        ${
          canConfirm
            ? `<input id="execution-confirm-token" placeholder="确认口令" value="${escapeHtml(session.confirmToken || "")}" style="min-width:180px;" />`
            : ""
        }
        <button class="button" type="button" id="execution-confirm-btn" ${canConfirm ? "" : "disabled"}>人工确认</button>
        <button class="button primary" type="button" id="execution-submit-btn" ${canSubmit ? "" : "disabled"}>确认提交记录</button>
      </div>
    </div>
  `;
}

function renderBrowserApplySession(session = {}, executionSession = {}) {
  const status = session.status || "created";
  const supportedAdapter = session.supportedAdapter || "generic_html_form";
  const fieldSummary = session.fieldSummary || {};
  const fillableFields = Array.isArray(fieldSummary.fillableFields) ? fieldSummary.fillableFields : [];
  const filledFields = Array.isArray(fieldSummary.filledFields) ? fieldSummary.filledFields : [];
  const unfilledFields = Array.isArray(fieldSummary.unfilledFields) ? fieldSummary.unfilledFields : [];
  const unsupportedFields = Array.isArray(fieldSummary.unsupportedFields) ? fieldSummary.unsupportedFields : [];
  const warnings = Array.isArray(session.warnings) ? session.warnings : [];
  const canRunSession = Boolean(executionSession.runId);
  const nextAction = session.nextAction || "continue_browser";
  const submitEligible = Boolean(session.submitEligible);

  return `
    <div class="panel">
      <strong>浏览器辅助投递会话</strong>
      <div class="trace-detail"><strong>状态</strong><span>${escapeHtml(localizeExecutionLabel(status))}</span></div>
      <div class="trace-detail"><strong>适配方式</strong><span>${escapeHtml(localizeExecutionLabel(supportedAdapter))}</span></div>
      <div class="trace-detail"><strong>下一步</strong><span>${escapeHtml(localizeExecutionLabel(nextAction))}</span></div>
      <div class="trace-detail"><strong>是否可进入提交</strong><span>${submitEligible ? "可以" : "不可以"}</span></div>
      <div class="trace-detail"><strong>可填字段</strong><span>${escapeHtml(fillableFields.join(" / ") || "暂无")}</span></div>
      <div class="trace-detail"><strong>已填字段</strong><span>${escapeHtml(filledFields.join(" / ") || "暂无")}</span></div>
      <div class="trace-detail"><strong>未填字段</strong><span>${escapeHtml(unfilledFields.join(" / ") || "暂无")}</span></div>
      <div class="trace-detail"><strong>不支持字段</strong><span>${escapeHtml(unsupportedFields.join(" / ") || "暂无")}</span></div>
      ${session.blockingReason ? `<div class="notice warning">${escapeHtml(session.blockingReason)}</div>` : ""}
      ${warnings.length ? `<div class="notice warning">${escapeHtml(warnings.join(" / "))}</div>` : ""}
      ${
        canRunSession
          ? ""
          : `<div class="notice warning">请先完成提交前检查，再启动浏览器辅助投递会话。</div>`
      }
      <div class="toolbar" style="margin-top:10px;">
        <select id="browser-apply-mode">
          <option value="standard">标准表单</option>
          <option value="no_form">未检测到表单</option>
          <option value="blocked">复杂页面需人工处理</option>
        </select>
        <button class="button" type="button" id="browser-apply-run-btn" ${canRunSession ? "" : "disabled"}>运行浏览器辅助检查</button>
      </div>
      <div class="muted">此阶段仅生成受控检查结果，不会自动提交，也不会绕过人工确认。</div>
      <div class="panel" style="margin-top:10px;">
        <strong>ApplyFlow Edge 插件（MVP）</strong>
        <div class="muted">用于在真实招聘网页执行“手动触发的一键预填”，不自动提交，不绕过人工确认。</div>
        <ul class="list list-tight">
          <li>1. 下载插件压缩包并在 Edge 扩展页手动加载。</li>
          <li>2. 先打开 ApplyFlow 的 Profile/Resume 页面同步资料。</li>
          <li>3. 打开招聘网页后点击插件按钮，查看支持度并执行一键填写。</li>
        </ul>
        <div class="muted">当前推荐版本：<span class="mono">applyflow-edge-mvp-v11-semantic-slots.zip</span>（仅使用这一个版本）。</div>
        <div class="toolbar" style="margin-top:8px;">
          <a class="button" href="/downloads/applyflow-edge-mvp-v11-semantic-slots.zip" target="_blank" rel="noopener noreferrer">下载 Edge 插件 ZIP（v11-semantic-slots）</a>
          <a class="button" href="#/profile">前往资料中心</a>
        </div>
      </div>
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
        <h3>${escapeHtml(localizeDisplayContent(nextAction.title, "fit"))}</h3>
        <p>${escapeHtml(localizeDisplayContent(nextAction.description, "fit"))}</p>
      </div>
      <div class="next-action-controls">
        ${
          nextAction.ctaType === "open_prep"
            ? `<a class="button primary" href="#/prep/${nextAction.jobId}">${escapeHtml(localizeDisplayContent(nextAction.ctaLabel, "fit"))}</a>`
            : nextAction.ctaType === "tailor"
              ? `<a class="button primary" href="#/jobs/${nextAction.jobId}/tailoring">${escapeHtml(localizeDisplayContent(nextAction.ctaLabel, "fit"))}</a>`
              : nextAction.ctaType === "prepare"
              ? `<button class="button primary" id="next-action-prepare">${escapeHtml(localizeDisplayContent(nextAction.ctaLabel, "fit"))}</button>`
              : nextAction.ctaType === "evaluate"
                ? `<button class="button primary" id="next-action-evaluate">${escapeHtml(localizeDisplayContent(nextAction.ctaLabel, "fit"))}</button>`
                : nextAction.ctaType === "status"
                  ? (nextAction.nextStatus === "applied"
                    ? `<button class="button primary" id="next-action-submit">${escapeHtml(localizeDisplayContent(nextAction.ctaLabel, "fit"))}</button>`
                    : `<button class="button primary" id="next-action-status" data-next-status="${nextAction.nextStatus}">${escapeHtml(localizeDisplayContent(nextAction.ctaLabel, "fit"))}</button>`)
                  : `<span class="muted">${escapeHtml(localizeDisplayContent(nextAction.ctaLabel || "手动查看", "fit"))}</span>`
        }
      </div>
    </div>
  `;
}

function renderTimeline(logs) {
  if (!logs.length) {
    return `<div class="empty">当前还没有反馈记录。</div>`;
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
                  <strong>${escapeHtml(log.eventLabel || log.eventType || "反馈事件")}</strong>
                  <span class="muted">${escapeHtml(log.timeText || new Date(log.timestamp || 0).toLocaleString())}</span>
                </div>
                <div>${escapeHtml(localizeDisplayContent(log.summary || "", "timeline"))}</div>
                ${log.actor ? `<div class="muted">执行方：${escapeHtml(log.actor)}</div>` : ""}
                ${log.outcome ? `<div class="trace-detail"><strong>结果</strong><span>${escapeHtml(log.outcome)}</span></div>` : ""}
                ${log.executionStage ? `<div class="trace-detail"><strong>执行阶段</strong><span>${escapeHtml(log.executionStage)} / ${escapeHtml(log.executionStatus || "unknown")}</span></div>` : ""}
                ${Array.isArray(log.blockingIssues) && log.blockingIssues.length ? `<div class="trace-detail"><strong>阻断原因</strong><span>${escapeHtml(log.blockingIssues.join(" / "))}</span></div>` : ""}
                ${Array.isArray(log.requiredActions) && log.requiredActions.length ? `<div class="trace-detail"><strong>要求动作</strong><span>${escapeHtml(log.requiredActions.join(" / "))}</span></div>` : ""}
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
                <strong>${escapeHtml(localizeDisplayContent(stage.label, "pipeline"))}</strong>
                <span class="status ${tone}">${escapeHtml(getStageStatusLabel(stage.status))}</span>
              </div>
              <div class="muted">${escapeHtml(localizeDisplayContent(stage.summary || "当前没有阶段摘要。", "pipeline"))}</div>
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
  const { job, fitAssessment } = deriveJobStateFromWorkspaceViewModel(data, jobId);
  const {
    operationData = {},
    governanceView = {},
    executionActions = {},
    resumeViewModel,
    feedbackTimelineView,
    executionSessionView
  } = data;
  const {
    applicationPrep,
    tailoredResumeContract,
    tailoringDisplayView,
    prepDto,
    executionSessionView: executionSessionInOperation,
    tasks,
    interviewReflection,
    badCase,
    pipelineStages
  } = operationData;
  const {
    globalPolicy,
    policyExplanation,
    policyProposals,
    policyAuditLogs
  } = governanceView;
  const { allowedNextStatuses, recommendedNextStatuses, nextAction } = executionActions;

  if (!job) {
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
  const safePolicyExplanation = Array.isArray(policyExplanation) ? policyExplanation : [];
  const safePolicyAuditLogs = Array.isArray(policyAuditLogs) ? policyAuditLogs : [];
  const safeAllowedNextStatuses = Array.isArray(allowedNextStatuses) ? allowedNextStatuses : [];
  const safeRecommendedNextStatuses = Array.isArray(recommendedNextStatuses) ? recommendedNextStatuses : [];
  const safeChecklist = Array.isArray(applicationPrep?.checklist) ? applicationPrep.checklist : [];
  const executionSessionVm = executionSessionView || executionSessionInOperation || {};

  const enhancedNextAction = nextAction ? { ...nextAction, jobId: job.id } : null;
  const jobVm = createJobViewModel({ job, fitAssessment, nextAction: enhancedNextAction });
  const policyVm = createPolicyViewModel(globalPolicy);
  const prepVm = createPrepViewModel({ prep: applicationPrep, fitAssessment });
  const resumeVm = createResumeViewModel(resumeViewModel);
  const proposalVms = (policyProposals || []).map((proposal) => createProposalViewModel(proposal));
  const timelineEntries = (Array.isArray(feedbackTimelineView) ? feedbackTimelineView : []).map((entry) => ({
    eventLabel: entry.eventType,
    timeText: entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "暂无",
    summary: entry.summary || "",
    actor: entry.actor || "system",
    outcome: entry.outcome || "",
    executionStage: entry.execution?.stage || "",
    executionStatus: entry.execution?.status || "",
    blockingIssues: entry.control?.blockingIssues || [],
    requiredActions: entry.control?.requiredActions || []
  }));
  const timelinePreviewEntries = timelineEntries.slice(0, 5);
  const hiddenTimelineCount = Math.max(0, timelineEntries.length - timelinePreviewEntries.length);
  const recommendationClass = fitAssessment ? recommendationTone(fitAssessment.recommendation) : "neutral";
  const completedCount = applicationPrep ? safeChecklist.filter((item) => item.completed).length : 0;
  const prepReady = applicationPrep && completedCount >= 3;
  const policyVersion = fitAssessment?.activePolicyVersion || policyVm.version;
  const policySummaryText =
      (Array.isArray(data.jobWorkspaceViewModel?.controlView?.reasons)
        ? data.jobWorkspaceViewModel.controlView.reasons[0]
        : "") ||
      safePolicyExplanation[0] ||
      "当前还没有记录到明确的策略影响。";
    const historySummaryText =
      (Array.isArray(feedbackTimelineView) && feedbackTimelineView[0]?.summary) ||
      "当前还没有历史修正说明。";
  const recommendationMeta = humanizeRecommendation(fitAssessment?.recommendation);
  const strategyMeta = humanizeStrategyDecision(fitAssessment?.strategyDecision || job.strategyDecision);
  const fitToTailoringGuidance = createFitToTailoringGuidance(fitAssessment);
  const tailoringExplainability = Array.isArray(tailoringDisplayView?.changeReasons)
    ? tailoringDisplayView.changeReasons
    : [];
  const tailoringBulletVms = (Array.isArray(tailoringDisplayView?.sectionDiffs) ? tailoringDisplayView.sectionDiffs : []).map((item, index) =>
    createTailoringBulletViewModel(item, index)
  );
  const acceptedTailoringCount = tailoringBulletVms.filter((item) => item.status === "accepted").length;
  const pendingTailoringCount = tailoringBulletVms.filter((item) => item.status === "pending").length;
  const diffEntries = Array.isArray(tailoringDisplayView?.sectionDiffs) ? tailoringDisplayView.sectionDiffs : [];

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
          <p>${escapeHtml(localizeDisplayContent(fitAssessment?.decisionSummary || "重新评估后，这里会展示系统对该岗位的整体判断摘要。", "fit"))}</p>
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
              : tailoredResumeContract
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
                <div class="muted">门禁状态：${escapeHtml(data.jobWorkspaceViewModel?.controlView?.gateStatus || "unknown")}</div>
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
                <h3>匹配结果到简历定制引导</h3>
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
                <div class="muted">${escapeHtml(localizeDisplayContent(policySummaryText || "当前还没有明确的策略影响说明。", "fit"))}</div>
                </div>
                <div class="panel">
                  <strong>历史影响</strong>
                <div class="muted">${escapeHtml(localizeDisplayContent(historySummaryText, "fit"))}</div>
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
                <div class="eyebrow">当前状态</div>
                <h3>进入工作区前先看这里</h3>
              </div>
            </div>
            <div class="panel">
              <strong>原始简历</strong>
              <div class="muted">
                ${
                  resumeVm.exists
                    ? `${escapeHtml(resumeVm.fileName)} · ${escapeHtml(resumeVm.statusLabel)} · 解析质量 ${escapeHtml(resumeVm.parseQualityLabel)}`
                    : "当前还没有可用的原始简历，建议先去个人画像上传 PDF / DOCX。"
                }
              </div>
            </div>
            <div class="panel">
              <strong>岗位定制工作区</strong>
              <div class="muted">
                ${
                  tailoredResumeContract
                    ? "当前岗位已经有定制结果，建议直接进入工作区继续修改，再决定是否进入申请准备。"
                    : "当前岗位还没有定制结果，建议先进入工作区生成第一版岗位定制简历。"
                }
              </div>
            </div>
            ${applicationPrep ? `<p class="muted">申请准备当前进度：${escapeHtml(prepVm.checklistProgress)} · ${escapeHtml(prepVm.readinessLabel)}</p>` : ""}
            ${
              job.strategyDecision === "cautious_proceed"
                ? `<div class="notice warning">这是一条“谨慎推进”岗位。建议先在工作区补强最相关经历，再决定是否进入申请准备。</div>`
                : ""
            }
            ${resumeVm.parseWarning ? `<div class="notice warning">${escapeHtml(localizeDisplayContent(resumeVm.parseWarning, "prep"))}</div>` : ""}
            <div class="toolbar" style="margin-top:12px;">
              <a class="button primary" href="#/jobs/${job.id}/tailoring">进入岗位定制工作区</a>
              <a class="button" href="#/profile">${resumeVm.exists ? "更新原始简历" : "上传原始简历"}</a>
              ${tailoredResumeContract ? `<a class="button" href="#/prep/${job.id}">查看申请准备</a>` : ""}
            </div>
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">最近动态</div>
                <h3>只看关键进展</h3>
              </div>
            </div>
            ${renderTimeline(timelinePreviewEntries)}
            ${
              hiddenTimelineCount
                ? `<div class="muted activity-preview-note">还有 ${escapeHtml(String(hiddenTimelineCount))} 条系统过程记录，已收起到页面底部，避免影响当前判断。</div>`
                : ""
            }
          </div>

          <div class="card">
            <div class="section-head">
              <div>
                <div class="eyebrow">执行审计</div>
                <h3>单次执行会话视图</h3>
              </div>
            </div>
            ${renderExecutionSession(executionSessionVm, job)}
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
            <summary>查看全部活动记录与决策链${timelineEntries.length ? `（${escapeHtml(String(timelineEntries.length))} 条）` : ""}</summary>
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
      if (tailoredResumeContract) {
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
            tailoredSummary: prepDto?.tailoredSummary || "",
            whyMe: "",
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
      if (nextStatus === "applied") {
        renderJobDetail(job.id, "", "投递提交必须先经过提交前检查与人工确认，不能直接推进状态。");
        return;
      }
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

  const nextActionSubmit = document.getElementById("next-action-submit");
  if (nextActionSubmit) {
    nextActionSubmit.addEventListener("click", async () => {
      try {
        setButtonPending(nextActionSubmit, true, "提交中...");
        await api(`/api/jobs/${job.id}/execution/submit`, {
          method: "POST",
          body: JSON.stringify({ actor: "user" })
        });
        renderJobDetail(job.id, "提交记录已完成。");
      } catch (error) {
        setButtonPending(nextActionSubmit, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  }

  document.querySelectorAll("[data-next-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextStatus = button.getAttribute("data-next-status");
      if (nextStatus === "applied") {
        renderJobDetail(job.id, "", "投递提交必须先经过提交前检查与人工确认，不能直接推进状态。");
        return;
      }
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

  const executionDryRunButton = document.getElementById("execution-dry-run-btn");
  if (executionDryRunButton) {
    executionDryRunButton.addEventListener("click", async () => {
      try {
        setButtonPending(executionDryRunButton, true, "提交前检查中...");
        await api(`/api/jobs/${job.id}/execution/dry-run`, {
          method: "POST",
          body: JSON.stringify({ targetUrl: job.jobUrl || "" })
        });
        renderJobDetail(job.id, "提交前检查已完成。");
      } catch (error) {
        setButtonPending(executionDryRunButton, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  }

  const executionConfirmButton = document.getElementById("execution-confirm-btn");
  if (executionConfirmButton) {
    executionConfirmButton.addEventListener("click", async () => {
      try {
        setButtonPending(executionConfirmButton, true, "确认中...");
        const confirmToken = document.getElementById("execution-confirm-token")?.value || "";
        await api(`/api/jobs/${job.id}/execution/confirm`, {
          method: "POST",
          body: JSON.stringify({ actor: "user", confirmToken })
        });
        renderJobDetail(job.id, "人工确认已记录。");
      } catch (error) {
        setButtonPending(executionConfirmButton, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  }

  const executionSubmitButton = document.getElementById("execution-submit-btn");
  if (executionSubmitButton) {
    executionSubmitButton.addEventListener("click", async () => {
      try {
        setButtonPending(executionSubmitButton, true, "提交中...");
        await api(`/api/jobs/${job.id}/execution/submit`, {
          method: "POST",
          body: JSON.stringify({ actor: "user" })
        });
        renderJobDetail(job.id, "提交记录已完成。");
      } catch (error) {
        setButtonPending(executionSubmitButton, false);
        renderJobDetail(job.id, "", error.message);
      }
    });
  }

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

function createTailoringBulletViewModel(item = {}, index = 0) {
  const status = item.status || "pending";
  return {
    bulletId: item.bulletId || `tailored_bullet_${index + 1}`,
    before: item.before || item.source || "",
    suggestion: item.suggestion || item.after || item.rewritten || "",
    status,
    reason: item.reason || "系统认为这条经历与岗位要求更相关，因此建议前置并强化。",
    jdRequirement: item.jdRequirement || "",
    type: item.type || "modified",
    tone: status === "accepted" ? "offer" : status === "rejected" ? "archived" : "to_prepare"
  };
}

function renderWorkspaceList(items = [], kind = "resume", emptyText = "暂无内容") {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!list.length) {
    return `<div class="workspace-empty-note">${escapeHtml(emptyText)}</div>`;
  }
  return `<ul class="list list-tight workspace-resume-list">${list
    .map((item) => `<li>${escapeHtml(String(item || "").trim())}</li>`)
    .join("")}</ul>`;
}

function renderWorkspaceKeywords(items = []) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!list.length) {
    return `<div class="workspace-empty-note">暂无关键词</div>`;
  }
  return `<div class="workspace-keyword-cloud">${list
    .map((item) => `<span class="workspace-keyword">${escapeHtml(item)}</span>`)
    .join("")}</div>`;
}

function renderWorkspacePersonalInfo(personalInfo = {}) {
  const entries = [
    ["姓名", personalInfo.name || "未识别"],
    ["邮箱", personalInfo.email || "未识别"],
    ["电话", personalInfo.phone || "未识别"],
    ["城市", personalInfo.location || "未识别"]
  ];
  return `<div class="workspace-personal-inline">${entries
    .map(
      ([label, value]) => `
        <div class="workspace-personal-chip">
          <span class="workspace-personal-label">${escapeHtml(label)}</span>
          <span class="workspace-personal-value">${escapeHtml(value)}</span>
        </div>
      `
    )
    .join("")}</div>`;
}

function renderWorkspaceWorkEntries(entries = [], emptyText = "暂无工作经历") {
  const list = (Array.isArray(entries) ? entries : []).filter(Boolean);
  if (!list.length) return `<div class="workspace-empty-note">${escapeHtml(emptyText)}</div>`;
  return `<div class="workspace-entry-stack">${list
    .map(
      (entry) => `
        <div class="workspace-structured-entry">
          <div class="workspace-entry-header">
            <div class="workspace-entry-title">${escapeHtml(entry.company || "未识别公司")}</div>
            <div class="workspace-entry-meta">${escapeHtml(entry.role || "岗位未识别")}${entry.timeRange ? ` · ${escapeHtml(entry.timeRange)}` : ""}</div>
          </div>
          ${
            (entry.bullets || []).length
              ? `<ul class="list list-tight workspace-resume-list">${entry.bullets.map((item) => `<li>${escapeHtml(String(item || "").trim())}</li>`).join("")}</ul>`
              : `<div class="muted">暂无详细要点</div>`
          }
        </div>
      `
    )
    .join("")}</div>`;
}

function renderWorkspaceProjectEntries(entries = [], emptyText = "暂无项目经历") {
  const list = (Array.isArray(entries) ? entries : []).filter(Boolean);
  if (!list.length) return `<div class="workspace-empty-note">${escapeHtml(emptyText)}</div>`;
  return `<div class="workspace-entry-stack">${list
    .map(
      (entry) => `
        <div class="workspace-structured-entry">
          <div class="workspace-entry-header">
            <div class="workspace-entry-title">${escapeHtml(entry.projectName || entry.name || "未识别项目")}</div>
            <div class="workspace-entry-meta">${escapeHtml(entry.role || "角色未识别")}${entry.timeRange ? ` · ${escapeHtml(entry.timeRange)}` : ""}</div>
          </div>
          ${
            (entry.bullets || []).length
              ? `<ul class="list list-tight workspace-resume-list">${entry.bullets.map((item) => `<li>${escapeHtml(String(item || "").trim())}</li>`).join("")}</ul>`
              : `<div class="muted">暂无详细要点</div>`
          }
        </div>
      `
    )
    .join("")}</div>`;
}

function renderWorkspaceEducationEntries(entries = [], emptyText = "暂无教育背景") {
  const list = (Array.isArray(entries) ? entries : []).filter(Boolean);
  if (!list.length) return `<div class="workspace-empty-note">${escapeHtml(emptyText)}</div>`;
  return `<div class="workspace-entry-stack">${list
    .map(
      (entry) => `
        <div class="workspace-structured-entry compact">
          <div class="workspace-entry-title">${escapeHtml(entry.displayTitle || [entry.timeRange, entry.school, entry.major].filter(Boolean).join(" "))}</div>
        </div>
      `
    )
    .join("")}</div>`;
}

function renderWorkspaceModulePairs(module = {}, moduleIndex = 0) {
  const items = Array.isArray(module.items) ? module.items : [];
  if (!items.length) {
    return `<div class="workspace-empty-note">当前模块暂无可编辑内容</div>`;
  }
  return items
    .map(
      (item, itemIndex) => `
        <div class="workspace-module-pair">
          <div class="workspace-module-col">
            <div class="eyebrow">原文</div>
            <div class="workspace-bullet-text">${escapeHtml(item.original || "暂无原文")}</div>
          </div>
          <div class="workspace-module-col">
            <div class="eyebrow">定制版</div>
            <textarea
              class="workspace-module-textarea"
              data-module-textarea="${escapeHtml(module.key)}"
              data-module-item-index="${itemIndex}"
              data-bullet-id="${escapeHtml(item.bulletId || "")}"
            >${escapeHtml(item.tailored || "")}</textarea>
          </div>
        </div>
      `
    )
    .join("");
}

async function renderTailoringWorkspace(jobId, message = "", errorMessage = "") {
  setActiveNav("#/jobs");
  title.textContent = "岗位定制简历工作区";
  subtitle.textContent = "先理解岗位，再对照原始简历完成定制，最后带着确认后的版本进入申请准备。";
  renderLoadingState("加载岗位定制简历工作区", "正在同步岗位摘要、原始简历与定制建议...");
  const data = await api(`/api/jobs/${jobId}/tailoring-workspace`);
  const { job, fitAssessment } = deriveJobStateFromWorkspaceViewModel(data, jobId);
  const {
    resumeViewModel,
    feedbackTimelineView = [],
    tailoringWorkspaceViewModel = {},
    tailoringWorkspaceEditDto = {}
  } = data;

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

  const jobVm = createJobViewModel({ job, fitAssessment, nextAction: null });
  const resumeVm = createResumeViewModel(resumeViewModel);
  const workspaceName = sanitizeWorkspaceName(
    tailoringWorkspaceEditDto.workspaceName ||
      tailoringWorkspaceViewModel.workspaceName ||
      `${job.company || "目标公司"} ${job.title || "岗位"}定制版`,
    `${job.company || "目标公司"} ${job.title || "岗位"}定制版`
  );
  const jobSummary = tailoringWorkspaceViewModel.jobSummary || {};
  const baseResume = tailoringWorkspaceViewModel.baseResume || {};
  const tailoredResume = tailoringWorkspaceViewModel.tailoredResume || {};
  const insights = tailoringWorkspaceViewModel.insights || {};
  const reviewModules = Array.isArray(tailoringWorkspaceViewModel.reviewModules)
    ? tailoringWorkspaceViewModel.reviewModules
    : [];
  const hasTailoringOutput = Boolean(tailoringWorkspaceViewModel.hasTailoringOutput);
  const lengthBudget = tailoredResume.lengthBudget || { status: "within_budget", notes: [] };
  const weakSignalNote = jobSummary.weakSignalNote || "";
  const workspaceMetaLine = [
    workspaceName ? `当前版本：${workspaceName}` : "",
    resumeVm.exists ? `原始简历：${resumeVm.fileName}` : ""
  ]
    .filter(Boolean)
    .join(" · ");

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    <div class="tailoring-workspace-shell">
      <section class="tailoring-workspace-hero">
        <div class="hero-copy">
          <div class="eyebrow">岗位定制简历工作区</div>
          <h3 class="hero-title">${escapeHtml(jobVm.title)}</h3>
          <p class="hero-subtitle">${escapeHtml(jobVm.company)} · ${escapeHtml(jobVm.location)} · ${escapeHtml(jobVm.displayStatus)}</p>
          <div class="hero-meta">
            ${statusBadge(job.status)}
            ${fitAssessment ? semanticBadge(`匹配度 ${fitAssessment.fitScore}`, humanizeRecommendation(fitAssessment.recommendation).tone) : '<span class="status">待评估</span>'}
            <span class="status">${escapeHtml(jobVm.strategyLabel)}</span>
          </div>
          ${workspaceMetaLine ? `<div class="muted">${escapeHtml(workspaceMetaLine)}</div>` : ""}
          <div class="workspace-judgement-card">
            <div class="workspace-judgement-row">
              <strong>岗位判断</strong>
              <details class="workspace-help-inline" title="查看工作区说明">
                <summary>?</summary>
                <div class="muted">${escapeHtml(tailoringWorkspaceViewModel.helpNote || "左侧是你的原始简历，右侧是当前岗位的定制版本；确认后再进入申请准备。")}</div>
              </details>
            </div>
            <ul class="list list-tight">
              <li>${escapeHtml(insights.headline || "系统已提炼出该岗位最关键的判断信号。")}</li>
              <li>${escapeHtml(insights.strongestMatch || "系统正在比对你最能打动这个岗位的经历。")}</li>
              <li>${escapeHtml(insights.biggestGap || "系统正在识别这条岗位当前最需要补强的短板。")}</li>
              <li>${escapeHtml(insights.nextEditFocus || "先从最相关的模块开始调整，再进入申请准备。")}</li>
            </ul>
          </div>
          <div class="workspace-job-summary-card">
            <div class="workspace-job-summary-top">
              <div>
                <strong>岗位重点</strong>
                <p class="muted">${escapeHtml(jobSummary.roleSummary || "系统已整理出这条岗位的职责、要求与关键词。")}</p>
              </div>
            </div>
            <div class="workspace-summary-grid">
              <div class="workspace-summary-block">
                <div class="eyebrow">核心职责</div>
                ${renderWorkspaceList(jobSummary.coreResponsibilities || [], "responsibility", "系统已从岗位原文中提炼职责重点")}
              </div>
              <div class="workspace-summary-block">
                <div class="eyebrow">核心要求</div>
                ${renderWorkspaceList(jobSummary.coreRequirements || [], "requirement", "系统已从岗位原文中提炼任职要求")}
              </div>
              <div class="workspace-summary-block">
                <div class="eyebrow">重点关键词</div>
                ${renderWorkspaceKeywords(jobSummary.targetKeywords || [])}
              </div>
            </div>
            ${
              (jobSummary.riskNotes || []).length
                ? `<div class="workspace-risk-row">${(jobSummary.riskNotes || [])
                    .map((item) => `<span class="status archived">${escapeHtml(item)}</span>`)
                    .join("")}</div>`
                : ""
            }
            ${weakSignalNote ? `<div class="muted workspace-weak-note">${escapeHtml(weakSignalNote)}</div>` : ""}
          </div>
        </div>
        <div class="stack">
          ${
            !resumeVm.exists
              ? `<div class="notice warning">你还没有上传原始简历。请先前往个人画像上传 PDF 或 DOCX，再生成岗位定制内容。<a class="text-link" href="#/profile">前往上传</a></div>`
              : `<div class="card workspace-side-note-compact"><div class="eyebrow">工作区说明</div><p class="muted">左侧显示原始简历实体结构，右侧显示当前岗位的定制版本；确认后再进入申请准备。</p><p class="muted">${escapeHtml(resumeVm.statusLabel)} · ${escapeHtml(resumeVm.extractionMethodLabel)} · 质量 ${escapeHtml(resumeVm.parseQualityLabel)}</p></div>`
          }
        </div>
      </section>

      <section class="tailoring-workspace-main">
        <div class="card">
          <div class="section-head">
            <div>
              <div class="eyebrow">左侧</div>
              <h3>原始简历</h3>
            </div>
          </div>
          <div class="stack">
            <div class="workspace-personal-compact">
              <strong>工作经历</strong>
              ${renderWorkspaceWorkEntries(baseResume.workExperience || [], "暂无工作经历")}
            </div>
            <div class="workspace-section-card">
              <strong>项目经历</strong>
              ${renderWorkspaceProjectEntries(baseResume.projectExperience || [], "暂无项目经历")}
            </div>
            ${
              baseResume.selfSummary
                ? `<div class="workspace-section-card"><strong>个人优势 / 自我评价</strong><div class="muted">${escapeHtml(baseResume.selfSummary)}</div></div>`
                : ""
            }
          </div>
        </div>

        <div class="card">
          <div class="section-head">
            <div>
              <div class="eyebrow">右侧</div>
              <h3>岗位定制版简历</h3>
            </div>
          </div>
          ${
            hasTailoringOutput
              ? `
                <div class="stack">
                  <div class="workspace-length-budget ${lengthBudget.status === "over_budget" ? "warning" : "success"}">
                    <strong>${lengthBudget.status === "over_budget" ? "当前内容偏长" : "当前长度接近一页纸约束"}</strong>
                    <div class="muted">总字符约 ${escapeHtml(String(lengthBudget.totalChars || 0))}，经历条目 ${escapeHtml(String(lengthBudget.totalBullets || 0))} 条。</div>
                    ${
                      (lengthBudget.notes || []).length
                        ? `<ul class="list list-tight">${(lengthBudget.notes || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
                        : ""
                    }
                  </div>
                  <div class="workspace-section-card">
                    <strong>定制后的工作经历</strong>
                    ${renderWorkspaceWorkEntries(tailoredResume.workExperience || [], "还没有生成定制后的工作经历")}
                  </div>
                  <div class="workspace-section-card">
                    <strong>定制后的项目经历</strong>
                    ${renderWorkspaceProjectEntries(tailoredResume.projectExperience || [], "暂无定制后的项目经历")}
                  </div>
                  <div class="workspace-section-card">
                    <strong>定制后的个人优势 / 自我评价</strong>
                    <textarea name="tailoredSummary" form="tailoring-workspace-save-form" id="workspace-tailored-summary" placeholder="用一句话概括你对这个岗位最相关的能力">${escapeHtml(tailoringWorkspaceEditDto.tailoredSummary || tailoredResume.selfEvaluation || "")}</textarea>
                  </div>
                </div>
              `
              : `<div class="empty">当前还没有该岗位的定制结果。你可以先生成第一版岗位定制简历。</div>`
          }
        </div>
      </section>

      <section class="card workspace-actions-card">
        <div class="section-head">
          <div>
            <div class="eyebrow">模块调整</div>
            <h3>按模块继续修改</h3>
          </div>
        </div>
            ${!hasTailoringOutput ? `<div class="empty">先生成岗位定制简历，这里才会出现模块化改写区。</div>` : `
        <form id="tailoring-refine-form" class="stack">
          <label>版本名称
            <input name="workspaceName" value="${escapeHtml(workspaceName)}" maxlength="120" />
          </label>
          <div class="stack">
            ${reviewModules.map((module, moduleIndex) => `
              <div class="workspace-module-editor" data-module-key="${escapeHtml(module.key)}">
                <div class="workspace-card-top">
                  <div>
                    <strong>${escapeHtml(module.title)}</strong>
                    <div class="muted">${escapeHtml(module.reason || "")}</div>
                  </div>
                </div>
                ${renderWorkspaceModulePairs(module, moduleIndex)}
                <div class="workspace-module-refine">
                  <textarea data-module-refine="${escapeHtml(module.key)}" placeholder="例如：压缩一点；更强调协同推进；更像产品运营/AI PM方向；不要写太满"></textarea>
                  <button class="button" type="button" data-module-refine-btn="${escapeHtml(module.key)}">重新改这一模块</button>
                </div>
              </div>
            `).join("")}
          </div>
        </form>
        <form id="tailoring-workspace-save-form" class="toolbar workspace-final-actions">
          <button class="button primary" type="submit" id="workspace-save-btn">确认当前定制版</button>
          <a class="button" href="#/prep/${job.id}">用当前定制版进入申请准备</a>
          <a class="button" href="#/jobs/${job.id}">返回岗位详情</a>
        </form>
        `}
      </section>

      <details class="activity-disclosure">
        <summary>查看工作区活动记录</summary>
        <div class="card activity-card">
              ${renderTimeline((Array.isArray(feedbackTimelineView) ? feedbackTimelineView : []).map((entry) => ({
                eventLabel: entry.eventType,
                timeText: entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "暂无",
                summary: entry.summary || "",
                actor: entry.actor || "system",
                outcome: entry.outcome || "",
                executionStage: entry.execution?.stage || "",
                executionStatus: entry.execution?.status || "",
                blockingIssues: entry.control?.blockingIssues || [],
                requiredActions: entry.control?.requiredActions || []
              })))}
        </div>
      </details>
    </div>
  `;

  const refineForm = document.getElementById("tailoring-refine-form");
  document.querySelectorAll("[data-module-refine-btn]").forEach((button) => {
    button.addEventListener("click", async () => {
      const moduleKey = String(button.getAttribute("data-module-refine-btn") || "");
      const prompt = String(document.querySelector(`[data-module-refine="${moduleKey}"]`)?.value || "").trim();
      if (!prompt) {
        renderTailoringWorkspace(job.id, "", "请先输入这一模块的修改方向。");
        return;
      }
      try {
        setButtonPending(button, true, "调整中...");
        await api(`/api/jobs/${job.id}/tailoring-workspace/refine`, {
          method: "POST",
          body: JSON.stringify({
            workspaceName: String(document.querySelector('#tailoring-refine-form [name="workspaceName"]')?.value || workspaceName),
            moduleKey,
            refinePrompt: prompt,
            currentText:
              moduleKey === "self_summary"
                ? String(document.querySelector('[data-module-textarea="self_summary"]')?.value || tailoredResume.selfEvaluation || "")
                : ""
          })
        });
        renderTailoringWorkspace(job.id, "该模块已更新。");
      } catch (error) {
        setButtonPending(button, false);
        renderTailoringWorkspace(job.id, "", error.message);
      }
    });
  });

  const saveForm = document.getElementById("tailoring-workspace-save-form");
  saveForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = document.getElementById("workspace-save-btn");
    try {
      setButtonPending(submitButton, true, "保存中...");
      const collectModuleDraft = (moduleKey, sourceItems = []) =>
        sourceItems.map((item, index) => {
          const element = document.querySelector(
            `[data-module-textarea="${moduleKey}"][data-module-item-index="${index}"]`
          );
          const rawText = String(element?.value || item.tailored || "").trim();
          const lines = rawText
            .split("\n")
            .map((line) => String(line || "").trim())
            .filter(Boolean);
          const [titleLine, ...bulletLines] = lines;

          if (moduleKey === "project_experience") {
            const titleParts = String(titleLine || "")
              .split("/")
              .map((part) => part.trim())
              .filter(Boolean);
            return {
              id: item.bulletId || `project_${index + 1}`,
              projectName: titleParts[0] || "",
              role: titleParts[1] || "",
              timeRange: titleParts[2] || "",
              bullets: bulletLines
            };
          }

          if (moduleKey === "work_experience") {
            const titleParts = String(titleLine || "")
              .split("/")
              .map((part) => part.trim())
              .filter(Boolean);
            return {
              id: item.bulletId || `work_${index + 1}`,
              company: titleParts[0] || "",
              role: titleParts[1] || "",
              timeRange: titleParts[2] || "",
              bullets: bulletLines
            };
          }

          return null;
        }).filter(Boolean);

      const workModule = reviewModules.find((module) => module.key === "work_experience");
      const projectModule = reviewModules.find((module) => module.key === "project_experience");
      const summaryModule = reviewModules.find((module) => module.key === "self_summary");

      const workspaceDraft = {
        workExperience: collectModuleDraft("work_experience", workModule?.items || []),
        projectExperience: collectModuleDraft("project_experience", projectModule?.items || []),
        selfEvaluation:
          String(document.getElementById("workspace-tailored-summary")?.value || summaryModule?.items?.[0]?.tailored || "")
            .trim()
      };
      await api(`/api/jobs/${job.id}/tailoring-workspace/save`, {
        method: "POST",
        body: JSON.stringify({
          workspaceName: String(
            document.querySelector('#tailoring-refine-form [name="workspaceName"]')?.value ||
              workspaceName
          ),
          workspaceDraft,
          tailoredSummary: workspaceDraft.selfEvaluation,
          refinePrompt: tailoringWorkspaceEditDto.lastRefinePrompt || ""
        })
      });
      renderTailoringWorkspace(job.id, "当前定制版已确认，可以进入申请准备。");
    } catch (error) {
      setButtonPending(submitButton, false);
      renderTailoringWorkspace(job.id, "", error.message);
    }
  });
}

async function renderPrep(jobId, message = "", errorMessage = "", exportStatusPayload = null) {
  setActiveNav("#/prep");
  title.textContent = "申请准备";
  subtitle.textContent = "编辑申请材料并保存，再回到岗位详情推进状态。";

  if (!jobId) {
    app.innerHTML = `<div class="empty">请从某个岗位详情进入申请准备页面。</div>`;
    return;
  }

  renderLoadingState("加载申请准备", "正在同步最新草稿与准备状态...");
  const [jobDetailResult, masterResumeResult] = await Promise.allSettled([api(`/api/jobs/${jobId}`), api("/api/master-resume")]);
  if (jobDetailResult.status !== "fulfilled") {
    throw jobDetailResult.reason;
  }
  const data = jobDetailResult.value;
  const masterResumeData = masterResumeResult.status === "fulfilled" ? masterResumeResult.value : {};
  const { job, fitAssessment } = deriveJobStateFromWorkspaceViewModel(data, jobId);
  const operationData = data.operationData || {};
  const { applicationPrep, tailoredResumeContract, tailoringDisplayView, prepDto, executionSessionView: executionSessionInOperation } = operationData;
  const exportStatusHtml = renderExportStatusCard(exportStatusPayload);
  if (!job) {
    app.innerHTML = `
      ${message ? renderNotice("success", message) : ""}
      ${errorMessage ? renderNotice("error", errorMessage) : ""}
      ${exportStatusHtml}
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
  const draft = buildPrepDraft(applicationPrep, prepDto);
  const prepVm = createPrepViewModel({ prep: applicationPrep, fitAssessment });
  const jobVm = createJobViewModel({ job, fitAssessment });
  const resumeVm = createResumeViewModel(data.resumeViewModel || null);
  const masterResumeEditDto = masterResumeData?.masterResumeEditDto || null;
  const resumeReadinessVm = buildResumeReadinessViewModel({
    resumeVm,
    masterResumeEditDto,
    tailoredResumeContract
  });
  const executionSessionVm = data.executionSessionView || executionSessionInOperation || {};
  const browserApplySessionVm = data.browserApplyViewModel || operationData.browserApplyViewModel || {};
  const explainability = Array.isArray(tailoringDisplayView?.changeReasons)
    ? tailoringDisplayView.changeReasons
    : Array.isArray(prepDto?.changeReasons)
      ? prepDto.changeReasons
      : [];
  const explainabilityCards = explainability.map((item, index) =>
    typeof item === "string"
      ? {
          title: `改写说明 ${index + 1}`,
          jdRequirement: "",
          before: "",
          after: item,
          reason: item
        }
      : item
  );
  const acceptedTailoringBullets = getTailoringAcceptedBullets(prepDto);
  if (!applicationPrep && acceptedTailoringBullets.length) {
    draft.tailoredResumeBullets = acceptedTailoringBullets.map((item) => item.after || item.rewritten || "").join("\n");
  }
  const tailoredPreview = tailoredResumeContract?.canonicalTailoredResume || applicationPrep?.tailoredResumePreview || null;
  const contentWithSources = Array.isArray(applicationPrep?.contentWithSources) ? applicationPrep.contentWithSources : [];
  const prepRiskNote =
    job.strategyDecision === "cautious_proceed"
      ? `这条岗位带有谨慎推进标记，建议优先处理 ${ensureArray(fitAssessment?.riskFlags).slice(0, 2).join(" / ") || "关键风险项"}.`
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
    ${exportStatusHtml}
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
            `<div class="notice ${escapeHtml(resumeReadinessVm.tone)}">
              <strong>${escapeHtml(resumeReadinessVm.label)}</strong>：${escapeHtml(resumeReadinessVm.summary)}
            <a class="text-link" href="#/profile">去个人画像补全简历</a>
            </div>`
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

      <section class="card">
        <div class="section-head">
          <div>
            <div class="eyebrow">Resume Readiness</div>
            <h3>简历就绪状态提示（非阻塞）</h3>
          </div>
          ${semanticBadge(resumeReadinessVm.label, resumeReadinessVm.tone === "success" ? "ready_to_apply" : "evaluating")}
        </div>
        <div class="panel">
          <div class="muted">${escapeHtml(resumeReadinessVm.summary)}</div>
          <ul class="list list-tight">
            ${(Array.isArray(resumeReadinessVm.suggestions) ? resumeReadinessVm.suggestions : [])
              .map((item) => `<li>${escapeHtml(item)}</li>`)
              .join("")}
          </ul>
          <div class="toolbar">
            <a class="button" href="#/profile">${
              resumeReadinessVm.status === "missing" ? "去导入简历" : "去完善 MasterResume"
            }</a>
            <span class="muted">当前为非阻塞提示：你可以继续查看并编辑本页 Prep 内容。</span>
          </div>
        </div>
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
                ? `<button class="button primary" type="button" id="generate-tailoring-btn">${tailoredResumeContract ? "生成申请准备包" : "生成岗位定制简历"}</button>`
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
              <input name="targetKeywords" value="${escapeHtml(safeJoin(draft.targetKeywords, ", "))}" />
            </label>
            ${
              tailoredResumeContract
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
              tailoringDisplayView?.diffSummary
                ? `
                <div class="panel">
                  <strong>与原始简历的差异</strong>
                  <div class="muted">改写条数：${escapeHtml(String(tailoringDisplayView.diffSummary.changedBulletCount || 0))}</div>
                  <div class="muted">重排顺序：${escapeHtml(safeJoin(tailoringDisplayView?.diffSummary?.reorderedSections, " -> ") || "未调整")}</div>
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
                            <div class="muted">基于：${escapeHtml(ensureArray(item.sources).map((source) => source.label).join(" / ") || "已确认内容")}</div>
                          </div>
                        `
                      )
                      .join("")}
                  </div>
                </div>
              `
              : tailoredResumeContract
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
              <div class="eyebrow">执行会话</div>
              <h3>执行门禁与提交状态</h3>
            </div>
          </div>
          ${renderExecutionSession(executionSessionVm, job)}
        </section>

        <section class="card">
          <div class="section-head">
            <div>
              <div class="eyebrow">网页辅助填写</div>
              <h3>Browser session 状态与预填结果</h3>
            </div>
          </div>
          ${renderBrowserApplySession(browserApplySessionVm, executionSessionVm)}
        </section>

        <section class="card">
          <div class="section-head">
            <div>
              <div class="eyebrow">为什么这样改</div>
              <h3>定制理由与 JD 对齐</h3>
            </div>
          </div>
          ${
            explainabilityCards.length
              ? `<div class="stack">${explainabilityCards
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
            ${applicationPrep ? `<button class="button" type="button" id="export-pdf-btn">导出 PDF</button>` : ""}
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
        if (tailoredResumeContract) {
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
        const exportResult = await downloadFromApi(`/api/jobs/${job.id}/export-docx`, `${job.company}-${job.title}.docx`);
        renderPrep(job.id, "DOCX 已导出。", "", exportResult.exportSummary || null);
      } catch (error) {
        setButtonPending(exportDocxButton, false);
        renderPrep(job.id, "", error.message, error?.details?.exportContract || null);
      }
    });
  }

  const exportPdfButton = document.getElementById("export-pdf-btn");
  if (exportPdfButton) {
    exportPdfButton.addEventListener("click", async () => {
      try {
        setButtonPending(exportPdfButton, true, "导出中...");
        const exportResult = await downloadFromApi(`/api/jobs/${job.id}/export-pdf`, `${job.company}-${job.title}.pdf`);
        renderPrep(job.id, "PDF 已导出。", "", exportResult.exportSummary || null);
      } catch (error) {
        setButtonPending(exportPdfButton, false);
        renderPrep(job.id, "", error.message, error?.details?.exportContract || null);
      }
    });
  }

  const prepExecutionDryRunButton = document.getElementById("execution-dry-run-btn");
  if (prepExecutionDryRunButton) {
    prepExecutionDryRunButton.addEventListener("click", async () => {
      try {
        setButtonPending(prepExecutionDryRunButton, true, "提交前检查中...");
        await api(`/api/jobs/${job.id}/execution/dry-run`, {
          method: "POST",
          body: JSON.stringify({ targetUrl: job.jobUrl || "" })
        });
        renderPrep(job.id, "提交前检查已完成。");
      } catch (error) {
        setButtonPending(prepExecutionDryRunButton, false);
        renderPrep(job.id, "", error.message);
      }
    });
  }

  const prepExecutionConfirmButton = document.getElementById("execution-confirm-btn");
  if (prepExecutionConfirmButton) {
    prepExecutionConfirmButton.addEventListener("click", async () => {
      try {
        setButtonPending(prepExecutionConfirmButton, true, "确认中...");
        const confirmToken = document.getElementById("execution-confirm-token")?.value || "";
        await api(`/api/jobs/${job.id}/execution/confirm`, {
          method: "POST",
          body: JSON.stringify({ actor: "user", confirmToken })
        });
        renderPrep(job.id, "人工确认已记录。");
      } catch (error) {
        setButtonPending(prepExecutionConfirmButton, false);
        renderPrep(job.id, "", error.message);
      }
    });
  }

  const prepExecutionSubmitButton = document.getElementById("execution-submit-btn");
  if (prepExecutionSubmitButton) {
    prepExecutionSubmitButton.addEventListener("click", async () => {
      try {
        setButtonPending(prepExecutionSubmitButton, true, "提交中...");
        await api(`/api/jobs/${job.id}/execution/submit`, {
          method: "POST",
          body: JSON.stringify({ actor: "user" })
        });
        renderPrep(job.id, "提交记录已完成。");
      } catch (error) {
        setButtonPending(prepExecutionSubmitButton, false);
        renderPrep(job.id, "", error.message);
      }
    });
  }

  const browserApplyRunButton = document.getElementById("browser-apply-run-btn");
  if (browserApplyRunButton) {
    browserApplyRunButton.addEventListener("click", async () => {
      try {
        setButtonPending(browserApplyRunButton, true, "运行中...");
        const simulationMode = document.getElementById("browser-apply-mode")?.value || "standard";
        await api(`/api/jobs/${job.id}/browser-apply/session`, {
          method: "POST",
          body: JSON.stringify({ actor: "user", simulationMode })
        });
        renderPrep(job.id, "浏览器辅助会话已更新。");
      } catch (error) {
        setButtonPending(browserApplyRunButton, false);
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
  const jobOptions = Array.isArray(jobs.jobWorkspaceViewModels) ? jobs.jobWorkspaceViewModels : [];

  app.innerHTML = `
    <div class="panel">
      <form id="reflection-form" class="stack">
        <div class="split">
          <label>岗位
            <select name="jobId">
              ${jobOptions
                .map((jobVm) => `<option value="${jobVm.id}">${escapeHtml(jobVm.jobSummary?.company || "未知公司")} / ${escapeHtml(jobVm.jobSummary?.title || "未命名岗位")}</option>`)
                .join("")}
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

async function renderOnboarding(message = "", errorMessage = "", options = {}) {
  setActiveNav("#/onboarding");
  title.textContent = "用户画像 Onboarding";
  subtitle.textContent = "填写求职偏好，立即生成个性化岗位排序。";
  renderLoadingState("加载 onboarding", "正在同步你当前的轻量用户画像...");

  const bootstrapContext =
    options && typeof options === "object" && Object.keys(options).length > 0 ? options : consumeOnboardingBootstrapContext() || {};
  let resolvedErrorMessage = String(errorMessage || bootstrapContext.errorMessage || "").trim();
  let profileData =
    bootstrapContext.profileData && typeof bootstrapContext.profileData === "object"
      ? bootstrapContext.profileData
      : null;
  if (!profileData && !bootstrapContext.skipProfileFetch) {
    try {
      profileData = await apiWithTimeout("/api/profile");
    } catch (_error) {
      profileData = { profile: readOnboardingProfileLocal() || {} };
      if (!resolvedErrorMessage) {
        resolvedErrorMessage = "当前画像同步较慢，已切换到可编辑表单。你可以直接填写后保存。";
      }
    }
  }
  if (!profileData || typeof profileData !== "object") {
    profileData = { profile: readOnboardingProfileLocal() || {} };
  }
  const profile = profileData.profile || {};
  const localProfile = readOnboardingProfileLocal() || {};
  const localLightweight = localProfile.lightweightProfile || {};
  const localJobPreference = localProfile.jobPreferenceProfile || {};
  const lightweight = normalizeLightweightProfileSafe({
    ...profile,
    lightweightProfile: {
      ...(profile.lightweightProfile || {}),
      ...localLightweight
    }
  });
  const jobPreference = normalizeJobPreferenceProfileFallback({
    ...profile,
    jobPreferenceProfile: {
      ...(profile.jobPreferenceProfile || {}),
      ...localJobPreference
    },
    lightweightProfile: lightweight
  });

  const roleOptions = ["AI Product Manager", "Backend Engineer", "Data Analyst", "Product Manager", "AI Engineer"];
  const skillOptions = ["Python", "SQL", "LLM", "Prompt Engineering", "Data Analysis", "A/B Testing"];
  const locationOptions = ["Shanghai", "Beijing", "Shenzhen", "Hangzhou", "Remote"];
  const displayedTargetRoles = Array.isArray(jobPreference.targetRoles) ? jobPreference.targetRoles : [];
  const displayedSkills = Array.isArray(jobPreference.skills) ? jobPreference.skills : [];
  const displayedPreferredLocations = Array.isArray(jobPreference.preferredLocations)
    ? jobPreference.preferredLocations
    : [];
  const targetRolesCustomDefault = displayedTargetRoles.filter((item) => !roleOptions.includes(item)).join(", ");
  const skillsCustomDefault = displayedSkills.filter((item) => !skillOptions.includes(item)).join(", ");
  const preferredLocationsCustomDefault = displayedPreferredLocations
    .filter((item) => !locationOptions.includes(item))
    .join(", ");

  const checkboxGroup = (name, options, selected = []) =>
    options
      .map((item) => {
        const checked = selected.includes(item) ? "checked" : "";
        return `<label><input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(item)}" ${checked} /> ${escapeHtml(item)}</label>`;
      })
      .join("");

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${resolvedErrorMessage ? renderNotice("error", resolvedErrorMessage) : ""}
    <div class="panel">
      <form id="onboarding-form" class="stack">
        <div class="panel">
          <h4>想要的方向</h4>
          <div class="muted">先填写想投的行业、岗位和地点；技能为可选增强信号。</div>
          <div style="margin-top:10px;">
            <label>偏好行业（逗号分隔）
              <input name="preferredIndustries" value="${escapeHtml(jobPreference.preferredIndustries.join(", "))}" placeholder="例如 金融, AI/算法, 游戏" />
            </label>
          </div>
          <div style="margin-top:10px;">
            <label>目标岗位方向（多选）</label>
          </div>
          <div class="split">${checkboxGroup("targetRoles", roleOptions, displayedTargetRoles)}</div>
          <label>补充岗位方向（逗号分隔）
            <input name="targetRolesCustom" value="${escapeHtml(targetRolesCustomDefault)}" placeholder="例如 产品经理, 数据分析, AI Strategy" />
          </label>
        </div>

        <div class="panel">
          <h4>技能（可选）</h4>
          <div class="muted">不填也可以保存，不会阻断后续推荐。</div>
          <div class="split">${checkboxGroup("skills", skillOptions, displayedSkills)}</div>
          <label>补充技能（逗号分隔）
            <input name="skillsCustom" value="${escapeHtml(skillsCustomDefault)}" placeholder="例如 LangChain, BI, Experiment Design" />
          </label>
        </div>

        <div class="panel">
          <h4>偏好城市（多选）</h4>
          <div class="split">${checkboxGroup("preferredLocations", locationOptions, displayedPreferredLocations)}</div>
          <label>补充城市（逗号分隔）
            <input name="preferredLocationsCustom" value="${escapeHtml(preferredLocationsCustomDefault)}" placeholder="例如 Suzhou, Guangzhou" />
          </label>
        </div>

        <div class="panel">
          <h4>不想看的内容</h4>
          <div class="muted">用于主动降权或过滤不想投的行业、岗位和公司类型。</div>
          <div class="split">
            <label>排除行业（逗号分隔）
              <input name="excludedIndustries" value="${escapeHtml(jobPreference.excludedIndustries.join(", "))}" placeholder="例如 教育, 房产中介" />
            </label>
            <label>排除岗位（逗号分隔）
              <input name="excludedRoles" value="${escapeHtml(jobPreference.excludedRoles.join(", "))}" placeholder="例如 销售, 客服" />
            </label>
          </div>
        </div>

        <div class="panel">
          <h4>公司偏好</h4>
          <div class="muted">公司类型偏好会作为辅助排序信号。</div>
          <div class="split">
            <label>偏好公司类型（逗号分隔）
              <input name="companyTypes" value="${escapeHtml(jobPreference.companyTypes.join(", "))}" placeholder="例如 大厂, 外企, 国企" />
            </label>
            <label>排除公司类型（逗号分隔）
              <input name="avoidCompanyTypes" value="${escapeHtml(jobPreference.avoidCompanyTypes.join(", "))}" placeholder="例如 创业公司" />
            </label>
          </div>
        </div>

        <div class="panel">
          <h4>求职类型</h4>
          <label>求职阶段
            <select name="jobType">
              ${["不限", "校招", "实习", "社招"]
                .map((item) => {
                  const selected = jobPreference.jobType === item ? "selected" : "";
                  return `<option value="${escapeHtml(item)}" ${selected}>${escapeHtml(item)}</option>`;
                })
                .join("")}
            </select>
          </label>
        </div>

        <div class="panel">
          <label><input type="checkbox" name="acceptsNonTech" ${lightweight.acceptsNonTech ? "checked" : ""} /> 接受非纯技术岗位（如策略/运营向）</label>
        </div>

        <div class="toolbar">
          <button class="button primary" type="submit">保存并进入岗位推荐</button>
          <a class="button" href="#/profile">去完整画像页</a>
        </div>
      </form>
    </div>
  `;

  document.getElementById("onboarding-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    try {
      setButtonPending(button, true, "保存中...");
      const formData = new FormData(event.target);
      const targetRoles = uniqueList(
        formData.getAll("targetRoles").map(String).concat(splitOnboardingListSafe(formData.get("targetRolesCustom")))
      );
      const skills = uniqueList(
        formData.getAll("skills").map(String).concat(splitOnboardingListSafe(formData.get("skillsCustom")))
      );
      const preferredLocations = uniqueList(
        formData
          .getAll("preferredLocations")
          .map(String)
          .concat(splitOnboardingListSafe(formData.get("preferredLocationsCustom")))
      );
      const preferredIndustries = uniqueList(splitOnboardingListSafe(String(formData.get("preferredIndustries") || "")));
      const excludedIndustries = uniqueList(splitOnboardingListSafe(String(formData.get("excludedIndustries") || "")));
      const excludedRoles = uniqueList(splitOnboardingListSafe(String(formData.get("excludedRoles") || "")));
      const companyTypes = uniqueList(splitOnboardingListSafe(String(formData.get("companyTypes") || "")));
      const avoidCompanyTypes = uniqueList(splitOnboardingListSafe(String(formData.get("avoidCompanyTypes") || "")));
      const jobType = String(formData.get("jobType") || "不限").trim() || "不限";
      const acceptsNonTech = formData.get("acceptsNonTech") === "on";

      if (!targetRoles.length || !preferredLocations.length) {
        throw new Error("请至少填写一个目标岗位和一个偏好城市。");
      }

      const profilePayload = {
        targetRoles,
        skills,
        preferredLocations,
        preferredIndustries,
        excludedIndustries,
        excludedRoles,
        companyTypes,
        avoidCompanyTypes,
        jobType,
        acceptsNonTech
      };
      const saved = await api("/api/profile/onboarding", {
        method: "POST",
        body: JSON.stringify(profilePayload)
      });
      saveOnboardingProfileLocal(saved?.profile || profilePayload);

      let intentId = readLastDiscoveryIntentId();
      if (!intentId) {
        const created = await api("/api/discovery/intents", {
          method: "POST",
          body: JSON.stringify({
            keywords: targetRoles.slice(0, 4),
            city: preferredLocations[0] || "",
            jobType: "full_time"
          })
        });
        intentId = created?.intent?.intentId || "";
      }
      if (intentId) {
        await api(`/api/discovery/intents/${intentId}/import-offline-json`, {
          method: "POST",
          body: JSON.stringify({
            candidateLimit: 50,
            resolutionLimit: 30,
            origin: "onboarding_bootstrap"
          })
        });
        rememberDiscoveryIntentId(intentId);
        window.location.hash = "#/jobs";
        return;
      }

      window.location.hash = "#/jobs";
    } catch (error) {
      setButtonPending(button, false);
      renderOnboarding("", error.message || "保存 onboarding 失败。");
    }
  });
}

async function renderProfile(message = "", errorMessage = "", options = {}) {
  setActiveNav("#/profile");
  title.textContent = "个人资料";
  subtitle.textContent = "高级偏好配置、材料管理与历史记录；与首页采用同一套求职决策语言。";
  renderLoadingState("加载个人资料", "正在同步求职偏好、网申辅助资料与可选简历状态...");
  const [profileResult, resumeResult] = await Promise.allSettled([
    apiWithTimeout("/api/profile"),
    apiWithTimeout("/api/resume")
  ]);
  const profileLoadFailed = profileResult.status !== "fulfilled";
  const resumeLoadFailed = resumeResult.status !== "fulfilled";
  if (profileLoadFailed && resumeLoadFailed) {
    app.innerHTML = `
      ${message ? renderNotice("success", message) : ""}
      ${errorMessage ? renderNotice("error", errorMessage) : ""}
      <div class="notice error">
        个人资料加载失败（load_failed）。请重试。
        <div class="toolbar" style="margin-top:10px;">
          <button class="button" type="button" data-action="retry-profile-load">重试加载</button>
          <a class="button" href="#/dashboard">返回工作台</a>
          <a class="button" href="#/jobs">查看岗位列表</a>
        </div>
      </div>
    `;
    document.querySelector("[data-action='retry-profile-load']")?.addEventListener("click", () => {
      renderProfile(message, errorMessage, options);
    });
    return;
  }
  const profileData = profileResult.status === "fulfilled" ? profileResult.value : {};
  const resumeData = resumeResult.status === "fulfilled" ? resumeResult.value : {};
  const profile = profileData.profile || {};
  const masterResumeViewModel = options.masterResumeViewModel || null;
  const lightweight = normalizeLightweightProfileSafe({
    ...profile,
    lightweightProfile:
      profile.lightweightProfile && typeof profile.lightweightProfile === "object" ? profile.lightweightProfile : {}
  });
  const jobPreference = normalizeJobPreferenceProfileFallback({
    ...profile,
    lightweightProfile: lightweight
  });
  const autofillProfile = profile.autofillProfile && typeof profile.autofillProfile === "object" ? profile.autofillProfile : {};
  const normalizedBirthDate = normalizeDateInputValue(autofillProfile.birth_date || "");
  const normalizedBachelorStartDate = normalizeMonthInputValue(autofillProfile.bachelor_start_date || "");
  const normalizedBachelorEndDate = normalizeMonthInputValue(autofillProfile.bachelor_end_date || "");
  const normalizedMasterStartDate = normalizeMonthInputValue(autofillProfile.master_start_date || "");
  const normalizedMasterEndDate = normalizeMonthInputValue(autofillProfile.master_end_date || "");
  const resumeVm = createResumeViewModel(resumeData.resumeViewModel || null);
  const resolveProfileTabFromSection = (sectionId = "") => {
    const safeSection = String(sectionId || "").trim();
    if (!safeSection) return "preference";
    if (safeSection === "profile-preference-section") return "preference";
    if (safeSection === "autofill-materials-section" || safeSection === "profile-materials-resume-section") return "materials";
    if (safeSection === "profile-history-section") return "history";
    return "preference";
  };
  const initialProfileTab = resolveProfileTabFromSection(options.sectionId);

  app.innerHTML = `
    ${message ? renderNotice("success", message) : ""}
    ${errorMessage ? renderNotice("error", errorMessage) : ""}
    ${
      profileLoadFailed || resumeLoadFailed
        ? renderNotice(
            "warning",
            `页面部分数据加载失败：${profileLoadFailed ? "个人资料" : ""}${profileLoadFailed && resumeLoadFailed ? "、" : ""}${resumeLoadFailed ? "简历状态" : ""}。当前已启用降级展示，可继续编辑并稍后重试。`
          )
        : ""
    }
    <div class="panel">
      <form id="profile-form" class="stack">
        <div class="notice info">
          <strong>页面定位：</strong>本页用于高级偏好设置、材料管理与历史记录查看；日常偏好填写建议从首页工作台进入。
          <a class="button" style="margin-left:8px;" href="/downloads/applyflow-edge-mvp-v11-semantic-slots.zip" target="_blank" rel="noopener noreferrer">下载插件</a>
          <a class="button" style="margin-left:8px;" href="#/profile?section=profile-preference-section">去填写求职偏好</a>
          <a class="button" style="margin-left:8px;" href="#/profile?section=autofill-materials-section">去填写网申辅助资料</a>
        </div>
        <div class="panel">
          <div class="toolbar" role="tablist" aria-label="个人资料分区">
            <button type="button" class="button" data-profile-tab-trigger="preference">高级偏好</button>
            <button type="button" class="button" data-profile-tab-trigger="materials">材料管理</button>
            <button type="button" class="button" data-profile-tab-trigger="history">历史记录</button>
          </div>
          <div class="muted" style="margin-top:8px;">按分区编辑并保存，无需在超长页面中来回滚动。</div>
        </div>
        <div class="panel" id="profile-preference-section" data-profile-tab-panel="preference" style="padding-bottom:84px;">
          <h4>求职偏好</h4>
          <div class="muted">用于岗位过滤、优先级排序与五维决策解释；与首页字段含义完全一致。</div>
          <div class="split" style="margin-top:10px;">
            <label>姓名<input name="name" value="${escapeHtml(profile.name || profile.fullName || "")}" required /></label>
            <label>背景简介<input name="background" value="${escapeHtml(profile.background || profile.headline || "")}" required /></label>
          </div>
          <div class="panel">
            <h5>必须条件</h5>
            <div class="muted">这些信息会直接影响过滤：不满足时会被显著降级或阻断。</div>
            <div class="split">
              <label>目标岗位<input name="targetRoles" value="${escapeHtml(safeJoin(jobPreference.targetRoles, ", "))}" placeholder="例如 产品经理, 后端工程师" /></label>
              <label>偏好地点<input name="targetLocations" value="${escapeHtml(safeJoin(jobPreference.preferredLocations, ", "))}" placeholder="例如 上海, 北京" /></label>
            </div>
            <div class="split">
              <label>不想看的行业<input name="excludedIndustries" value="${escapeHtml(safeJoin(jobPreference.excludedIndustries, ", "))}" placeholder="例如 教育, 房产中介" /></label>
              <label>不想看的岗位<input name="excludedRoles" value="${escapeHtml(safeJoin(jobPreference.excludedRoles, ", "))}" placeholder="例如 销售, 电话客服" /></label>
            </div>
            <div class="split">
              <label>求职阶段
                <select name="jobTypePreference">
                  ${["不限", "校招", "实习", "社招"]
                    .map((item) => {
                      const selected = jobPreference.jobType === item ? "selected" : "";
                      return `<option value="${escapeHtml(item)}" ${selected}>${escapeHtml(item)}</option>`;
                    })
                    .join("")}
                </select>
              </label>
              <label>学历偏好（可选）<input name="degreePreference" value="${escapeHtml(lightweight.degree || "")}" placeholder="例如 硕士研究生" /></label>
            </div>
          </div>
          <div class="panel">
            <h5>强偏好</h5>
            <div class="muted">这些信息会影响排序优先级，不会直接删除岗位。</div>
            <div class="split">
              <label>偏好行业<input name="targetIndustries" value="${escapeHtml(safeJoin(jobPreference.preferredIndustries, ", "))}" placeholder="例如 金融, AI/算法, 游戏" /></label>
              <label>偏好公司类型<input name="companyTypes" value="${escapeHtml(safeJoin(jobPreference.companyTypes, ", "))}" placeholder="例如 大厂, 外企, 国企" /></label>
            </div>
          </div>
          <div class="panel">
            <h5>辅助偏好</h5>
            <div class="muted">技能偏好属于辅助信号：只用于补充岗位契合度与申请门槛可达性，不会单独决定推荐结果。</div>
            <div class="split">
              <label>技能偏好（可选）<input name="strengths" value="${escapeHtml(safeJoin(jobPreference.skills, ", "))}" placeholder="例如 Python, SQL, LLM" /></label>
              <label>不想看的公司类型<input name="avoidCompanyTypes" value="${escapeHtml(safeJoin(jobPreference.avoidCompanyTypes, ", "))}" placeholder="例如 创业公司" /></label>
            </div>
            <div class="split">
              <label>工作年限（可选）<input name="yearsOfExperience" type="number" min="0" value="${escapeHtml(profile.yearsOfExperience || 0)}" /></label>
              <div></div>
            </div>
          </div>
          <label><input name="acceptsNonTech" type="checkbox" ${lightweight.acceptsNonTech ? "checked" : ""} /> 是否接受非技术岗位</label>
          <label>限制条件（可选）<textarea name="constraints">${escapeHtml(safeJoin(profile.constraints, ", "))}</textarea></label>
          <div class="toolbar" style="position:sticky; bottom:0; background:var(--panel-bg,#fff); padding-top:8px; margin-top:10px; border-top:1px solid var(--border,#e6e6e6);">
            <button class="button primary" type="submit" data-profile-save-tab="preference">保存高级偏好</button>
            <a class="button" href="#/dashboard">返回工作台</a>
          </div>
        </div>
        <div class="panel" id="autofill-materials-section" data-profile-tab-panel="materials" style="padding-bottom:84px;">
          <h4>辅助材料（网申）</h4>
          <div class="muted">这部分用于浏览器插件辅助填写，不影响线索发现/岗位排序主链；与结构化主简历分层管理。</div>
          <div class="split" style="margin-top:10px;">
            <label>邮箱<input name="email" value="${escapeHtml(autofillProfile.email || "")}" /></label>
            <label>电话<input name="phone" value="${escapeHtml(autofillProfile.phone || "")}" /></label>
          </div>
          <div class="split">
            <div class="autofill-gender-field">
              <div class="autofill-field-label">性别</div>
              <div class="autofill-radio-group">
                <label class="autofill-radio-option">
                  <input name="gender" type="radio" value="male" ${autofillProfile.gender === "male" ? "checked" : ""} />
                  <span>男</span>
                </label>
                <label class="autofill-radio-option">
                  <input name="gender" type="radio" value="female" ${autofillProfile.gender === "female" ? "checked" : ""} />
                  <span>女</span>
                </label>
              </div>
            </div>
            <label>出生日期<input name="birth_date" type="date" value="${escapeHtml(normalizedBirthDate)}" /></label>
          </div>
          <div class="split">
            <label>学校<input name="school_name" value="${escapeHtml(autofillProfile.school_name || "")}" /></label>
            <label>学历 / 学位<input name="degree" value="${escapeHtml(autofillProfile.degree || "")}" /></label>
          </div>
          <div class="split">
            <label>专业<input name="major" value="${escapeHtml(autofillProfile.major || "")}" /></label>
            <label>第一学历毕业院校<input name="first_school_name" value="${escapeHtml(autofillProfile.first_school_name || "")}" /></label>
          </div>
          <div class="split">
            <label>第一学历专业<input name="first_major" value="${escapeHtml(autofillProfile.first_major || "")}" /></label>
            <label>本科开始时间（年月）<input name="bachelor_start_date" type="month" value="${escapeHtml(normalizedBachelorStartDate)}" /></label>
          </div>
          <div class="split">
            <label>本科结束时间（年月）<input name="bachelor_end_date" type="month" value="${escapeHtml(normalizedBachelorEndDate)}" /></label>
            <label>研究生开始时间（年月）<input name="master_start_date" type="month" value="${escapeHtml(normalizedMasterStartDate)}" /></label>
          </div>
          <div class="split">
            <label>研究生结束时间（年月）<input name="master_end_date" type="month" value="${escapeHtml(normalizedMasterEndDate)}" /></label>
            <label>语言等级语种
              <select name="language_exam_language">
                <option value="" ${!(autofillProfile.language_exam_language || "") ? "selected" : ""}>请选择</option>
                <option value="英语" ${autofillProfile.language_exam_language === "英语" ? "selected" : ""}>英语</option>
                <option value="日语" ${autofillProfile.language_exam_language === "日语" ? "selected" : ""}>日语</option>
                <option value="韩语" ${autofillProfile.language_exam_language === "韩语" ? "selected" : ""}>韩语</option>
                <option value="法语" ${autofillProfile.language_exam_language === "法语" ? "selected" : ""}>法语</option>
                <option value="德语" ${autofillProfile.language_exam_language === "德语" ? "selected" : ""}>德语</option>
                <option value="其他" ${autofillProfile.language_exam_language === "其他" ? "selected" : ""}>其他</option>
              </select>
            </label>
          </div>
          <div class="split">
            <label>语言等级
              <select name="language_exam_level">
                <option value="" ${!(autofillProfile.language_exam_level || "") ? "selected" : ""}>请选择</option>
                <option value="英语四级" ${autofillProfile.language_exam_level === "英语四级" ? "selected" : ""}>英语四级</option>
                <option value="英语六级" ${autofillProfile.language_exam_level === "英语六级" ? "selected" : ""}>英语六级</option>
                <option value="专业四级" ${autofillProfile.language_exam_level === "专业四级" ? "selected" : ""}>专业四级</option>
                <option value="专业八级" ${autofillProfile.language_exam_level === "专业八级" ? "selected" : ""}>专业八级</option>
                <option value="日语四级" ${autofillProfile.language_exam_level === "日语四级" ? "selected" : ""}>日语四级</option>
                <option value="日语三级" ${autofillProfile.language_exam_level === "日语三级" ? "selected" : ""}>日语三级</option>
                <option value="日语二级" ${autofillProfile.language_exam_level === "日语二级" ? "selected" : ""}>日语二级</option>
                <option value="日语一级" ${autofillProfile.language_exam_level === "日语一级" ? "selected" : ""}>日语一级</option>
                <option value="托福" ${autofillProfile.language_exam_level === "托福" ? "selected" : ""}>托福</option>
                <option value="雅思" ${autofillProfile.language_exam_level === "雅思" ? "selected" : ""}>雅思</option>
              </select>
            </label>
            <label>语种<input name="language_name" value="${escapeHtml(autofillProfile.language_name || "")}" placeholder="例如 英语 / 日语" /></label>
          </div>
          <div class="split">
            <label>英语水平<input name="english_proficiency" value="${escapeHtml(autofillProfile.english_proficiency || "")}" placeholder="例如 熟练 / 良好" /></label>
            <label>英语等级/分数<input name="english_score" value="${escapeHtml(autofillProfile.english_score || "")}" placeholder="例如 CET-6 520 / IELTS 7.0" /></label>
          </div>
          <div class="split">
            <label>证书名称<input name="certificate_name" value="${escapeHtml(autofillProfile.certificate_name || "")}" placeholder="例如 CET-6 / IELTS / TOEFL" /></label>
            <label>成绩得分<input name="achievement_score" value="${escapeHtml(autofillProfile.achievement_score || "")}" placeholder="例如 520 / 7.0 / 95" /></label>
          </div>
          <div class="panel">
            <h5>教育经历（可添加多条）</h5>
            <div class="muted">用于网申辅助填写教育模块，支持新增、删除与编辑。</div>
            <div id="autofill-education-rows" class="stack" style="margin-top:10px;"></div>
            <div class="toolbar">
              <button class="button" type="button" data-action="add-autofill-row" data-module="education">新增教育经历</button>
            </div>
          </div>
          <div class="panel">
            <h5>工作经历（可添加多条）</h5>
            <div class="muted">用于网申辅助填写工作经历模块，支持新增、删除与编辑。</div>
            <div id="autofill-work-rows" class="stack" style="margin-top:10px;"></div>
            <div class="toolbar">
              <button class="button" type="button" data-action="add-autofill-row" data-module="work_experience">新增工作经历</button>
            </div>
          </div>
          <div class="panel">
            <h5>项目经历（可添加多条）</h5>
            <div class="muted">用于网申辅助填写项目经历模块，支持新增、删除与编辑。</div>
            <div id="autofill-project-rows" class="stack" style="margin-top:10px;"></div>
            <div class="toolbar">
              <button class="button" type="button" data-action="add-autofill-row" data-module="project_experience">新增项目经历</button>
            </div>
          </div>
          <div class="panel">
            <h5>家庭关系（可添加多条）</h5>
            <div class="muted">用于网申辅助填写家庭关系模块，支持新增、删除与编辑。</div>
            <div id="autofill-family-rows" class="stack" style="margin-top:10px;"></div>
            <div class="toolbar">
              <button class="button" type="button" data-action="add-autofill-row" data-module="family">新增家庭关系</button>
            </div>
          </div>
          <label>网申摘要
            <textarea name="autofill_summary">${escapeHtml(autofillProfile.summary || profile.summary || "")}</textarea>
          </label>
          <div class="toolbar" style="position:sticky; bottom:0; background:var(--panel-bg,#fff); padding-top:8px; margin-top:10px; border-top:1px solid var(--border,#e6e6e6);">
            <button class="button primary" type="submit" data-profile-save-tab="materials">保存材料信息</button>
            <a class="button" href="#/dashboard">返回工作台</a>
          </div>
        </div>
        <div class="panel" id="profile-materials-resume-section" data-profile-tab-panel="materials">
          <h4>可选简历导入</h4>
          <div class="muted">导入简历可自动解析部分基础信息，提升后续定制与网申效果；不是必填项。</div>
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
        <div class="panel" id="profile-history-section" data-profile-tab-panel="history" style="padding-bottom:84px;">
          <h4>历史记录</h4>
          <div class="muted">用于查看与推进求职执行状态：流程追踪、投递审计、跟进记录。</div>
          <div class="info-grid" style="margin-top:10px;">
            <div class="panel">
              <strong>流程追踪</strong>
              <div class="muted">查看 已收藏/准备中/已定制材料/已投递/面试中/已拒绝/已拿 Offer 阶段。</div>
            </div>
            <div class="panel">
              <strong>投递审计</strong>
              <div class="muted">查看提交状态、尝试次数、错误信息与备注。</div>
            </div>
            <div class="panel">
              <strong>跟进提醒</strong>
              <div class="muted">查看 follow-up 计划、渠道、时间与备注。</div>
            </div>
          </div>
          <div class="toolbar" style="position:sticky; bottom:0; background:var(--panel-bg,#fff); padding-top:8px; margin-top:10px; border-top:1px solid var(--border,#e6e6e6);">
            <a class="button primary" id="profile-jobs-cta" href="#/jobs">去岗位列表查看历史状态</a>
            <a class="button" href="#/dashboard">返回工作台</a>
          </div>
        </div>
      </form>
    </div>
  `;

  if (options.scrollToJobsCta) {
    requestAnimationFrame(() => {
      const jobsCta = document.getElementById("profile-jobs-cta");
      if (!jobsCta) return;
      jobsCta.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  const profileTabTriggers = Array.from(document.querySelectorAll("[data-profile-tab-trigger]"));
  const profileTabPanels = Array.from(document.querySelectorAll("[data-profile-tab-panel]"));
  const activateProfileTab = (tabName = "preference") => {
    const activeTab = String(tabName || "preference").trim() || "preference";
    profileTabTriggers.forEach((trigger) => {
      const isActive = trigger.dataset.profileTabTrigger === activeTab;
      trigger.classList.toggle("primary", isActive);
      trigger.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    profileTabPanels.forEach((panel) => {
      const isActive = panel.dataset.profileTabPanel === activeTab;
      panel.style.display = isActive ? "" : "none";
    });
  };
  profileTabTriggers.forEach((trigger) => {
    trigger.addEventListener("click", () => {
      activateProfileTab(trigger.dataset.profileTabTrigger || "preference");
    });
  });
  activateProfileTab(initialProfileTab);

  const autofillModuleDefinitions = {
    education: {
      containerId: "autofill-education-rows",
      title: "教育经历",
      fieldPrefix: "education",
      fields: [
        { key: "level", label: "学历层级（本科/硕士）" },
        { key: "school_name", label: "学校名称" },
        { key: "major", label: "专业" },
        { key: "degree", label: "学位" },
        { key: "start_date", label: "开始日期", type: "month" },
        { key: "end_date", label: "结束日期", type: "month" }
      ]
    },
    work_experience: {
      containerId: "autofill-work-rows",
      title: "工作经历",
      fieldPrefix: "work",
      fields: [
        { key: "company_name", label: "公司名称" },
        { key: "department", label: "部门" },
        { key: "job_title", label: "岗位名称" },
        { key: "start_date", label: "开始日期", type: "month" },
        { key: "end_date", label: "结束日期", type: "month" },
        { key: "description", label: "描述", type: "textarea" }
      ]
    },
    project_experience: {
      containerId: "autofill-project-rows",
      title: "项目经历",
      fieldPrefix: "project",
      fields: [
        { key: "project_name", label: "项目名称" },
        { key: "role", label: "角色" },
        { key: "start_date", label: "开始日期", type: "month" },
        { key: "end_date", label: "结束日期", type: "month" },
        { key: "description", label: "描述", type: "textarea" }
      ]
    },
    family: {
      containerId: "autofill-family-rows",
      title: "家庭关系",
      fieldPrefix: "family",
      fields: [
        { key: "name", label: "姓名" },
        { key: "relation", label: "关系" },
        { key: "employer", label: "工作单位" },
        { key: "position", label: "职位" }
      ]
    }
  };

  const createAutofillEmptyRow = (moduleKey) => {
    const definition = autofillModuleDefinitions[moduleKey];
    return definition.fields.reduce((acc, field) => {
      acc[field.key] = "";
      return acc;
    }, {});
  };

  const normalizeAutofillRows = (rows, moduleKey) => {
    const definition = autofillModuleDefinitions[moduleKey];
    if (!Array.isArray(rows) || !rows.length) return [];
    return rows
      .map((row) => {
        const rowObj = row && typeof row === "object" ? row : {};
        return definition.fields.reduce((acc, field) => {
          acc[field.key] = String(rowObj[field.key] || "");
          return acc;
        }, {});
      })
      .filter((row) => definition.fields.some((field) => String(row[field.key] || "").trim()));
  };

  const autofillModuleState = {
    education: normalizeAutofillRows(autofillProfile.education, "education"),
    work_experience: normalizeAutofillRows(autofillProfile.work_experience, "work_experience"),
    project_experience: normalizeAutofillRows(autofillProfile.project_experience, "project_experience"),
    family: normalizeAutofillRows(autofillProfile.family, "family")
  };

  const renderAutofillModuleRows = (moduleKey) => {
    const definition = autofillModuleDefinitions[moduleKey];
    const container = document.getElementById(definition.containerId);
    if (!container) return;
    const rows = autofillModuleState[moduleKey] || [];
    if (!rows.length) {
      container.innerHTML = `<div class="muted">暂无${escapeHtml(definition.title)}，点击下方按钮新增一条。</div>`;
      return;
    }

    container.innerHTML = rows
      .map((row, index) => {
        const fieldsHtml = definition.fields
          .map((field) => {
            const fieldName = `${definition.fieldPrefix}_${field.key}[]`;
            const rawValue = String(row[field.key] || "");
            const normalizedValue =
              field.type === "date"
                ? normalizeDateInputValue(rawValue)
                : field.type === "month"
                  ? normalizeMonthInputValue(rawValue)
                  : rawValue;
            const value = escapeHtml(normalizedValue);
            if (field.type === "textarea") {
              return `<label>${escapeHtml(field.label)}<textarea name="${fieldName}" data-module-field="${field.key}">${value}</textarea></label>`;
            }
            return `<label>${escapeHtml(field.label)}<input name="${fieldName}" data-module-field="${field.key}" type="${field.type || "text"}" value="${value}" /></label>`;
          })
          .join("");
        return `
          <div class="panel" data-module-row="${moduleKey}" data-row-index="${index}">
            <div class="split">${fieldsHtml}</div>
            <div class="toolbar">
              <button class="button" type="button" data-action="remove-autofill-row" data-module="${moduleKey}" data-index="${index}">删除这一条</button>
            </div>
          </div>
        `;
      })
      .join("");
  };

  const syncAutofillStateFromDom = () => {
    Object.keys(autofillModuleDefinitions).forEach((moduleKey) => {
      const rows = Array.from(document.querySelectorAll(`[data-module-row="${moduleKey}"]`)).map((rowEl) => {
        const row = {};
        rowEl.querySelectorAll("[data-module-field]").forEach((fieldEl) => {
          row[fieldEl.dataset.moduleField] = String(fieldEl.value || "").trim();
        });
        return row;
      });
      autofillModuleState[moduleKey] = normalizeAutofillRows(rows, moduleKey);
    });
  };

  const renderAllAutofillModules = () => {
    renderAutofillModuleRows("education");
    renderAutofillModuleRows("work_experience");
    renderAutofillModuleRows("project_experience");
    renderAutofillModuleRows("family");
  };

  renderAllAutofillModules();

  const profileFormElement = document.getElementById("profile-form");
  profileFormElement?.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-action='add-autofill-row']");
    if (addButton) {
      event.preventDefault();
      const moduleKey = addButton.dataset.module;
      if (!autofillModuleDefinitions[moduleKey]) return;
      syncAutofillStateFromDom();
      autofillModuleState[moduleKey].push(createAutofillEmptyRow(moduleKey));
      renderAutofillModuleRows(moduleKey);
      return;
    }

    const removeButton = event.target.closest("[data-action='remove-autofill-row']");
    if (removeButton) {
      event.preventDefault();
      const moduleKey = removeButton.dataset.module;
      const index = Number(removeButton.dataset.index);
      if (!autofillModuleDefinitions[moduleKey]) return;
      syncAutofillStateFromDom();
      autofillModuleState[moduleKey].splice(index, 1);
      renderAutofillModuleRows(moduleKey);
    }
  });

  document.getElementById("profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const submitter = event.submitter;
      const saveTab = String(submitter?.dataset?.profileSaveTab || "preference").trim();
      const button =
        submitter && submitter.tagName === "BUTTON"
          ? submitter
          : event.target.querySelector(`button[data-profile-save-tab="${saveTab}"]`) ||
            event.target.querySelector('button[type="submit"]');
      setButtonPending(button, true, "保存中...");
      const formData = new FormData(event.target);
      const collectRowsFromFormData = (prefix, fields) => {
        const columns = fields.map((field) => ({
          key: field.key,
          values: formData.getAll(`${prefix}_${field.key}[]`).map((value) => String(value || "").trim())
        }));
        const maxLength = columns.reduce((max, column) => Math.max(max, column.values.length), 0);
        const rows = [];
        for (let index = 0; index < maxLength; index += 1) {
          const row = {};
          let hasValue = false;
          columns.forEach((column) => {
            const value = column.values[index] || "";
            row[column.key] = value;
            if (value) hasValue = true;
          });
          if (hasValue) rows.push(row);
        }
        return rows;
      };

      let payload = {};
      if (saveTab === "materials") {
        syncAutofillStateFromDom();
        const raw = Object.fromEntries(
          Array.from(formData.entries()).filter(([key]) => !String(key).endsWith("[]"))
        );
        payload = {
          autofillProfile: {
            basic: {
              full_name: raw.full_name || raw.name || "",
              gender: raw.gender || "",
              birth_date: raw.birth_date || "",
              email: raw.email || "",
              phone: raw.phone || ""
            },
            full_name: raw.full_name || raw.name || "",
            gender: raw.gender || "",
            birth_date: raw.birth_date || "",
            email: raw.email || "",
            phone: raw.phone || "",
            school_name: raw.school_name || "",
            degree: raw.degree || "",
            major: raw.major || "",
            first_school_name: raw.first_school_name || "",
            first_major: raw.first_major || "",
            bachelor_start_date: raw.bachelor_start_date || "",
            bachelor_end_date: raw.bachelor_end_date || "",
            master_start_date: raw.master_start_date || "",
            master_end_date: raw.master_end_date || "",
            language_exam_language: raw.language_exam_language || "",
            language_exam_level: raw.language_exam_level || "",
            language_name: raw.language_name || "",
            english_proficiency: raw.english_proficiency || "",
            english_score: raw.english_score || "",
            certificate_name: raw.certificate_name || "",
            achievement_score: raw.achievement_score || "",
            summary: raw.autofill_summary || "",
            education: collectRowsFromFormData("education", autofillModuleDefinitions.education.fields),
            work_experience: collectRowsFromFormData("work", autofillModuleDefinitions.work_experience.fields),
            project_experience: collectRowsFromFormData("project", autofillModuleDefinitions.project_experience.fields),
            family: collectRowsFromFormData("family", autofillModuleDefinitions.family.fields)
          }
        };
      } else if (saveTab === "preference") {
        const raw = Object.fromEntries(
          Array.from(formData.entries()).filter(([key]) => !String(key).endsWith("[]"))
        );
        const acceptsNonTech = formData.get("acceptsNonTech") === "on";
        const lightweightProfile = {
          targetRoles: splitOnboardingListSafe(raw.targetRoles),
          skills: splitOnboardingListSafe(raw.strengths),
          preferredLocations: splitOnboardingListSafe(raw.targetLocations),
          degree: String(raw.degreePreference || "").trim(),
          acceptsNonTech
        };
        payload = {
          name: raw.name || "",
          background: raw.background || "",
          yearsOfExperience: raw.yearsOfExperience,
          constraints: raw.constraints || "",
          acceptsNonTech,
          preferredLocations: raw.targetLocations || "",
          lightweightProfile,
          jobPreferenceProfile: {
            preferredIndustries: splitOnboardingListSafe(raw.targetIndustries),
            excludedIndustries: splitOnboardingListSafe(raw.excludedIndustries),
            targetRoles: lightweightProfile.targetRoles,
            excludedRoles: splitOnboardingListSafe(raw.excludedRoles),
            skills: lightweightProfile.skills,
            preferredLocations: lightweightProfile.preferredLocations,
            companyTypes: splitOnboardingListSafe(raw.companyTypes),
            avoidCompanyTypes: splitOnboardingListSafe(raw.avoidCompanyTypes),
            jobType: String(raw.jobTypePreference || "不限").trim() || "不限",
            priorityWeights: DEFAULT_JOB_PREFERENCE_WEIGHTS
          }
        };
      } else {
        setButtonPending(button, false);
        return;
      }
      await api("/api/profile/save", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      renderProfile(saveTab === "materials" ? "材料信息已保存。" : "高级偏好已保存。", "", { sectionId: saveTab === "materials" ? "autofill-materials-section" : "profile-preference-section" });
    } catch (error) {
      renderProfile("", error.message);
    }
  });

  const masterResumePanel = document.getElementById("master-resume-panel");
  if (masterResumePanel) {
    function rerenderMasterResumePanel() {
    masterResumePanel.innerHTML = renderMasterResumeEditor(masterResumeDraft, masterResumeMeta);

    masterResumePanel.querySelectorAll("[data-master-basic]").forEach((input) => {
      input.addEventListener("input", (event) => {
        const field = event.target.dataset.masterBasic;
        masterResumeDraft.basicInfo[field] = event.target.value;
      });
    });

    masterResumePanel.querySelectorAll("[data-master-field]").forEach((input) => {
      input.addEventListener("input", (event) => {
        const field = event.target.dataset.masterField;
        if (field === "skills") {
          masterResumeDraft.skills = splitEditorList(event.target.value);
          return;
        }
        masterResumeDraft[field] = event.target.value;
      });
    });

    masterResumePanel.querySelectorAll("[data-section][data-index][data-field]").forEach((input) => {
      input.addEventListener("input", (event) => {
        const { section, index, field } = event.target.dataset;
        const targetList = section === "project" ? masterResumeDraft.projectExperience : masterResumeDraft.workExperience;
        const targetEntry = targetList[Number(index)];
        if (!targetEntry) return;
        targetEntry[field] = field === "bullets" ? splitBulletLines(event.target.value) : event.target.value;
      });
    });

    masterResumePanel.querySelectorAll("[data-action='add-entry']").forEach((button) => {
      button.addEventListener("click", () => {
        const section = button.dataset.section;
        if (section === "project") {
          masterResumeDraft.projectExperience.push(createEditableExperienceEntry({}, "project", masterResumeDraft.projectExperience.length));
        } else {
          masterResumeDraft.workExperience.push(createEditableExperienceEntry({}, "work", masterResumeDraft.workExperience.length));
        }
        rerenderMasterResumePanel();
      });
    });

    masterResumePanel.querySelectorAll("[data-action='remove-entry']").forEach((button) => {
      button.addEventListener("click", () => {
        const section = button.dataset.section;
        const index = Number(button.dataset.index);
        if (section === "project") {
          masterResumeDraft.projectExperience.splice(index, 1);
        } else {
          masterResumeDraft.workExperience.splice(index, 1);
        }
        rerenderMasterResumePanel();
      });
    });

    const masterResumeForm = document.getElementById("master-resume-form");
    masterResumeForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.target.querySelector('button[type="submit"]');
      const feedback = document.getElementById("master-resume-feedback");
      try {
        setButtonPending(button, true, "保存中...");
        const saved = await api("/api/master-resume", {
          method: "POST",
          body: JSON.stringify(serializeMasterResumeDraft(masterResumeDraft))
        });
        masterResumeDraft = createMasterResumeDraft(saved.masterResumeEditDto || {});
        renderProfile("结构化主简历已保存。");
      } catch (error) {
        setButtonPending(button, false);
        feedback.innerHTML = renderNotice("error", error.message || "保存结构化主简历失败。");
      }
    });
    }

    rerenderMasterResumePanel();
  }

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
      const uploadedResume = createResumeViewModel(result.resumeViewModel || null);
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

function parseHashRoute(rawHash) {
  const hash = rawHash || "";
  if (!hash.startsWith("#/")) {
    return {
      isRoute: false,
      anchor: hash.startsWith("#") ? decodeURIComponent(hash.slice(1)) : ""
    };
  }
  const routePayload = hash.slice(2);
  const hashIndex = routePayload.indexOf("#");
  const routeAndQuery = hashIndex >= 0 ? routePayload.slice(0, hashIndex) : routePayload;
  const legacyAnchor = hashIndex >= 0 ? routePayload.slice(hashIndex + 1) : "";
  const queryIndex = routeAndQuery.indexOf("?");
  const pathPart = queryIndex >= 0 ? routeAndQuery.slice(0, queryIndex) : routeAndQuery;
  const queryPart = queryIndex >= 0 ? routeAndQuery.slice(queryIndex + 1) : "";
  const parts = pathPart.split("/").filter(Boolean);
  const query = new URLSearchParams(queryPart);
  if (legacyAnchor && !query.has("section")) {
    query.set("section", legacyAnchor);
  }
  return { isRoute: true, parts, query };
}

async function route() {
  const parsedRoute = parseHashRoute(window.location.hash || "#/dashboard");
  if (!parsedRoute.isRoute) {
    if (parsedRoute.anchor) {
      const section = document.getElementById(parsedRoute.anchor);
      if (section) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    return;
  }

  const parts = parsedRoute.parts.length > 0 ? parsedRoute.parts : ["dashboard"];

  try {
    const session = await fetchAuthSession();
    if (!session.authenticated) {
      const demoSession = await ensureDemoSession();
      if (!demoSession.authenticated) {
        await renderUnauthenticatedWorkspace("无法创建演示会话，请稍后重试。");
        return;
      }
    }
    if (parts[0] === "onboarding") {
      await renderOnboarding();
      return;
    }
    if (parts[0] === "dashboard" || parts[0] === "") {
      let profileData = null;
      let onboardingFallbackError = "";
      try {
        profileData = await apiWithTimeout("/api/profile");
      } catch (_error) {
        profileData = null;
        onboardingFallbackError = "当前画像同步较慢，已切换到可编辑表单。你可以直接填写后保存。";
      }
      const onboardingSource = profileData?.profile || readOnboardingProfileLocal() || {};
      if (!isOnboardingCompleteSafe(onboardingSource)) {
        onboardingBootstrapContext = {
          profileData: profileData || { profile: onboardingSource },
          errorMessage: onboardingFallbackError,
          skipProfileFetch: true
        };
        window.location.hash = "#/onboarding";
        return;
      }
      await renderDashboard();
      return;
    }
    if (parts[0] === "discovery") {
      const message = discoveryFlashMessage;
      const errorMessage = discoveryFlashError;
      discoveryFlashMessage = "";
      discoveryFlashError = "";
      const routeIntentId = parts[1] || "";
      if (routeIntentId) {
        rememberDiscoveryIntentId(routeIntentId);
      }
      await renderDiscovery(message, errorMessage, routeIntentId);
      return;
    }
    if (parts[0] === "discovery-admin") {
      const message = discoveryFlashMessage;
      const errorMessage = discoveryFlashError;
      discoveryFlashMessage = "";
      discoveryFlashError = "";
      const routeIntentId = parts[1] || "";
      if (routeIntentId) {
        rememberDiscoveryIntentId(routeIntentId);
      }
      await renderDiscoveryAdmin(message, errorMessage, routeIntentId);
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
      const sectionId = parsedRoute.query.get("section") || "";
      if (sectionId) {
        await renderProfile("", "", { sectionId });
      } else {
        await renderProfile();
      }
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
