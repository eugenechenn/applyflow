"use strict";

const PROFILE_KEY = "applyflow_profile_bundle";
const EXPECTED_CONTENT_SCHEMA_VERSION = "2026.04.23.5";
const TARGET_FIELDS = [
  "full_name",
  "email",
  "phone",
  "gender",
  "school_name",
  "first_school_name",
  "degree",
  "major",
  "first_major",
  "birth_date",
  "bachelor_start_date",
  "bachelor_end_date",
  "master_start_date",
  "master_end_date",
  "language_exam_language",
  "language_exam_level",
  "language_name",
  "english_proficiency",
  "english_score",
  "certificate_name",
  "achievement_score",
  "summary"
];

const supportBadge = document.getElementById("support-badge");
const supportDetail = document.getElementById("support-detail");
const profileStatus = document.getElementById("profile-status");
const profileFields = document.getElementById("profile-fields");
const dataSourceDebug = document.getElementById("data-source-debug");
const fieldSourceDebug = document.getElementById("field-source-debug");
const fieldResultsEl = document.getElementById("field-results");
const resultEl = document.getElementById("result");
const fillBtn = document.getElementById("fill-btn");
const refreshBtn = document.getElementById("refresh-btn");

function setResult(message, tone = "muted") {
  resultEl.className = tone;
  resultEl.textContent = message;
}

function setSupport(level, detail = "") {
  supportBadge.className = `status ${level}`;
  supportBadge.textContent = level === "high" ? "高" : level === "medium" ? "中" : "低";
  supportDetail.textContent = detail;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function getUrlScheme(url = "") {
  try {
    return new URL(String(url || "")).protocol.replace(":", "").toLowerCase();
  } catch (_error) {
    return "";
  }
}

function mapSendMessageError(error) {
  const message = String(error?.message || "");
  if (/Receiving end does not exist/i.test(message)) {
    return {
      code: "no_receiver",
      message: "当前页面脚本通信未建立，正在尝试补注入。"
    };
  }
  if (/Cannot access a chrome:\/\/ URL/i.test(message) || /Cannot access contents of url/i.test(message)) {
    return {
      code: "unsupported_scheme",
      message: "当前页面协议不支持插件注入（仅支持 http/https 页面）。"
    };
  }
  return {
    code: "send_message_failed",
    message: message || "页面通信失败。"
  };
}

async function pingContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "AF_EDGE_PING" });
    if (response?.ok && response?.ready) {
      const remoteFields = Array.isArray(response.targetFields) ? response.targetFields : [];
      const missingFields = TARGET_FIELDS.filter((field) => !remoteFields.includes(field));
      return {
        ok: true,
        frameUrl: response.frameUrl || "",
        schemaVersion: response.schemaVersion || "",
        missingFields
      };
    }
    return { ok: false, code: "ping_invalid_response", message: "content script 响应异常。" };
  } catch (error) {
    const mapped = mapSendMessageError(error);
    return { ok: false, code: mapped.code, message: mapped.message };
  }
}

async function injectContentScript(tabId) {
  const target = { tabId, allFrames: true };
  try {
    await chrome.scripting.executeScript({
      target,
      files: ["content.js"]
    });
  } catch (error) {
    return {
      ok: false,
      code: "inject_script_failed",
      message: String(error?.message || "注入 content.js 失败。")
    };
  }

  try {
    await chrome.scripting.insertCSS({
      target,
      files: ["content.css"]
    });
  } catch (_error) {
    // CSS 注入失败不阻断 JS 通信链路
  }
  return { ok: true };
}

async function ensureContentScriptReady(tab) {
  if (!tab?.id) {
    return { ok: false, code: "missing_tab", message: "未找到当前标签页。" };
  }

  const scheme = getUrlScheme(tab.url || "");
  if (!["http", "https"].includes(scheme)) {
    return {
      ok: false,
      code: "unsupported_scheme",
      message: "当前页面协议不支持插件注入（仅支持 http/https 页面）。"
    };
  }

  const firstPing = await pingContentScript(tab.id);
  if (firstPing.ok) {
    return {
      ok: true,
      source: "already_injected",
      frameUrl: firstPing.frameUrl || "",
      schemaVersion: firstPing.schemaVersion || "",
      missingFields: firstPing.missingFields || []
    };
  }

  const injected = await injectContentScript(tab.id);
  if (!injected.ok) {
    return injected;
  }

  await new Promise((resolve) => setTimeout(resolve, 120));
  const secondPing = await pingContentScript(tab.id);
  if (secondPing.ok) {
    return {
      ok: true,
      source: "runtime_injected",
      frameUrl: secondPing.frameUrl || "",
      schemaVersion: secondPing.schemaVersion || "",
      missingFields: secondPing.missingFields || []
    };
  }

  return {
    ok: false,
    code: "no_receiver_after_inject",
    message: "当前页面未建立可通信脚本上下文，请刷新页面后重试。"
  };
}

function summarizeProfile(profile = {}) {
  const fields = TARGET_FIELDS.map((key) => ({ key, value: profile[key] }));
  const readyCount = fields.filter((item) => String(item.value || "").trim()).length;
  return { fields, readyCount };
}

function renderProfileStatus(bundle = {}) {
  const profile = bundle?.profile || {};
  const debug = bundle?.debug || {};
  const sourceSummary = debug?.sourceSummary || {};
  const fieldSources = debug?.fieldSources || {};
  const fieldReasons = debug?.fieldReasons || {};
  const { fields, readyCount } = summarizeProfile(profile);

  if (!readyCount) {
    profileStatus.innerHTML = `<span class="bad">未检测到可用资料。</span> 请先打开 ApplyFlow 的 Profile/Resume 页面。`;
  } else if (readyCount < Math.ceil(TARGET_FIELDS.length * 0.6)) {
    profileStatus.innerHTML = `<span class="warn">资料部分可用（${readyCount}/${TARGET_FIELDS.length}）</span>，建议补全后再填写。`;
  } else {
    profileStatus.innerHTML = `<span class="ok">资料可用（${readyCount}/${TARGET_FIELDS.length}）</span>，可直接尝试一键填写。`;
  }

  profileFields.innerHTML = fields.map((item) => `<li>${item.key}: ${item.value ? "✅" : "—"}</li>`).join("");

  dataSourceDebug.textContent =
    `数据来源: ` +
    `/api/profile=${sourceSummary.profileApi || "unknown"}, ` +
    `/api/master-resume(editDto)=${sourceSummary.masterResumeEditDto || "unknown"}, ` +
    `/api/master-resume(viewModel)=${sourceSummary.masterResumeViewModel || "unknown"}, ` +
    `storage=${sourceSummary.storage || "unknown"}, ` +
    `syncStatus=${debug.syncStatus || "unknown"}`;

  fieldSourceDebug.innerHTML = fields
    .map((item) => {
      const src = fieldSources[item.key] || "none";
      const reason = item.value ? "ok" : fieldReasons[item.key] || "unknown";
      return `<li><span class="mono">${item.key}</span> → <span class="mono">${src}</span> (${reason})</li>`;
    })
    .join("");
}

function humanizeControlType(value = "") {
  const map = {
    plain_input: "plain_input",
    textarea: "textarea",
    searchable_select: "searchable_select",
    date_picker: "date_picker",
    radio_group: "radio_group",
    rich_text_like: "rich_text_like",
    not_found: "not_found"
  };
  return map[value] || value || "not_found";
}

function humanizeStatus(value = "") {
  const map = {
    filled: "filled",
    not_found: "not_found",
    unsupported_control: "unsupported_control",
    partial_not_supported: "partial_not_supported",
    empty_profile_value: "empty_profile_value",
    selector_mismatch: "selector_mismatch"
  };
  return map[value] || value || "-";
}

function buildFieldResultRows(results = [], fallbackProfile = {}) {
  const byField = {};
  (Array.isArray(results) ? results : []).forEach((item) => {
    byField[item.field] = item;
  });

  return TARGET_FIELDS.map((field) => {
    const fromResult = byField[field];
    if (fromResult) return fromResult;
    return {
      field,
      profileValuePresent: Boolean(String(fallbackProfile[field] || "").trim()),
      controlType: "not_found",
      supported: false,
      status: "not_found",
      reason: "not_run",
      hint: ""
    };
  });
}

function renderFieldResults(results = [], fallbackProfile = {}) {
  const rows = buildFieldResultRows(results, fallbackProfile);
  fieldResultsEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>field</th>
          <th>profile值</th>
          <th>控件类型</th>
          <th>支持</th>
          <th>结果</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((item) => {
            const hasValue = item.profileValuePresent ? "yes" : "no";
            const controlType = humanizeControlType(item.controlType);
            const supported = item.supported ? "yes" : "no";
            const status = humanizeStatus(item.status);
            const reason = item.reason ? ` <span class="mono">(${item.reason})</span>` : "";
            return `
              <tr>
                <td><span class="mono">${item.field}</span></td>
                <td>${hasValue}</td>
                <td><span class="pill">${controlType}</span></td>
                <td>${supported}</td>
                <td class="status-${status}">${status}${reason}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

async function readProfileBundle() {
  const data = await chrome.storage.local.get([PROFILE_KEY]);
  const bundle = data?.[PROFILE_KEY] || {};
  return bundle && typeof bundle === "object" ? bundle : {};
}

function buildVersionMismatchMessage(ready = {}) {
  const missingFields = Array.isArray(ready.missingFields) ? ready.missingFields : [];
  if (missingFields.length) {
    return `插件字段版本不一致，缺少: ${missingFields.join(", ")}。请在扩展管理页重新加载插件。`;
  }
  if (ready.schemaVersion && ready.schemaVersion !== EXPECTED_CONTENT_SCHEMA_VERSION) {
    return `插件版本不一致（content=${ready.schemaVersion}, popup=${EXPECTED_CONTENT_SCHEMA_VERSION}），请在扩展管理页重新加载插件。`;
  }
  return "";
}

async function detectSupport(tab) {
  const ready = await ensureContentScriptReady(tab);
  if (!ready.ok) {
    setSupport("low", ready.message || "当前页面未注入 content script 或不支持检测。");
    return null;
  }

  const mismatchMessage = buildVersionMismatchMessage(ready);
  if (mismatchMessage) {
    setResult(mismatchMessage, "warn");
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "AF_EDGE_ANALYZE" });
    const level = response?.supportLevel || "low";
    const detail = `识别字段 ${response?.recognizedCount || 0}，可填控件 ${response?.fillTargetCount || 0}`;
    setSupport(level, detail);
    return response;
  } catch (error) {
    const mapped = mapSendMessageError(error);
    setSupport("low", mapped.message || "当前页面未注入 content script 或不支持检测。");
    return null;
  }
}

async function triggerProfileSync(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "AF_EDGE_SYNC_PROFILE" });
    if (!response?.ok) {
      return { ok: false, message: response?.message || "sync_failed" };
    }
    return { ok: true };
  } catch (_error) {
    return { ok: false, message: "当前页面不支持资料同步（请在 ApplyFlow Profile 页面点击刷新检测）。" };
  }
}

async function refreshView() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    setResult("未找到当前标签页。", "bad");
    return;
  }

  const syncResult = await triggerProfileSync(tab.id);
  const analyzeResult = await detectSupport(tab);
  const bundle = await readProfileBundle();
  renderProfileStatus(bundle);
  const previewResults = (analyzeResult?.fieldDetections || []).map((item) => ({
    field: item.field,
    profileValuePresent: Boolean(String(bundle?.profile?.[item.field] || "").trim()),
    controlType: item.controlType || "not_found",
    supported: Boolean(item.supported),
    status: "not_found",
    reason: item.found ? "not_filled_yet" : "not_found",
    hint: item.hint || ""
  }));
  renderFieldResults(previewResults, bundle?.profile || {});

  if (!syncResult.ok) {
    if (bundle.updatedAt) {
      setResult(`当前站点无法实时同步，已使用本地缓存资料（${new Date(bundle.updatedAt).toLocaleString()}）。`, "warn");
      return;
    }
    setResult(syncResult.message, "warn");
    return;
  }
  if (bundle?.debug?.syncStatus === "failed") {
    setResult(`资料同步失败：${bundle?.debug?.syncError || "unknown"}`, "bad");
    return;
  }
  if (bundle.updatedAt) {
    setResult(`资料更新时间：${new Date(bundle.updatedAt).toLocaleString()}`);
  } else {
    setResult("尚未同步到本地资料，请先打开 ApplyFlow Profile 页面。", "warn");
  }
}

fillBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) {
    setResult("未找到当前标签页。", "bad");
    return;
  }
  const bundle = await readProfileBundle();
  const profile = bundle?.profile || {};
  if (!Object.values(profile).some((v) => String(v || "").trim())) {
    setResult("没有可用资料，请先打开 ApplyFlow Profile/Resume 页面完成同步。", "warn");
    return;
  }

  const ready = await ensureContentScriptReady(tab);
  if (!ready.ok) {
    setResult(`填写失败：${ready.message || ready.code || "content script 未就绪"}`, "bad");
    return;
  }

  const mismatchMessage = buildVersionMismatchMessage(ready);
  if (mismatchMessage) {
    setResult(mismatchMessage, "warn");
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "AF_EDGE_FILL", payload: profile });
    if (!response?.ok) {
      setResult(`填写失败：${response?.message || response?.code || "unknown_error"}`, "bad");
      return;
    }
    renderFieldResults(response?.fieldResults || [], profile);
    const filled = Number(response?.filledCount || 0);
    const unsupported = Number(response?.unsupportedCount || 0);
    const unfilled = Number(response?.unfilledCount || 0);
    setResult(`填写完成：已填 ${filled}，未填 ${unfilled}，不支持 ${unsupported}。`, filled > 0 ? "ok" : "warn");
    await detectSupport(tab);
  } catch (error) {
    const mapped = mapSendMessageError(error);
    setResult(`填写失败：${mapped.message || "当前页面不支持或 content script 未就绪。"}`, "bad");
  }
});

refreshBtn.addEventListener("click", refreshView);

refreshView().catch((error) => {
  setResult(`初始化失败：${error.message || error}`, "bad");
});
