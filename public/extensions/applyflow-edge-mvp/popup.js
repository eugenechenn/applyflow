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
const profileLink = document.getElementById("profile-link");

const DEFAULT_APPLYFLOW_ORIGIN = "https://applyflow-staging.applyflow-eugene.workers.dev";

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

function isApplyFlowLikeHost(hostname = "") {
  const safeHost = String(hostname || "").toLowerCase();
  return safeHost.includes("applyflow");
}

function buildMaterialsProfileUrl(tabUrl = "") {
  try {
    const parsed = new URL(String(tabUrl || ""));
    const origin = isApplyFlowLikeHost(parsed.hostname) ? parsed.origin : DEFAULT_APPLYFLOW_ORIGIN;
    return `${origin}/#/profile?section=autofill-materials-section`;
  } catch (_error) {
    return `${DEFAULT_APPLYFLOW_ORIGIN}/#/profile?section=autofill-materials-section`;
  }
}

function isProfileMaterialsUrl(tabUrl = "") {
  return String(tabUrl || "").includes("#/profile?section=autofill-materials-section");
}

function isGenericProfileUrl(tabUrl = "") {
  return String(tabUrl || "").includes("#/profile");
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
    profileStatus.innerHTML = `<span class="bad">未检测到可用资料。</span> 请先打开 ApplyFlow 的“网申辅助资料与插件同步”页面。`;
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

function buildMaterialsGuidance(tabUrl = "") {
  if (isProfileMaterialsUrl(tabUrl)) {
    return "当前已在“网申辅助资料与插件同步”页面，保存后点击“刷新检测”即可。";
  }
  if (isGenericProfileUrl(tabUrl)) {
    return "当前在个人资料页，但不在“网申辅助资料与插件同步”分区。请点击“打开网申辅助资料”直达材料页。";
  }
  return "请先打开 ApplyFlow 的“网申辅助资料与插件同步”页面完成同步。";
}

function isApplyFlowPageUrl(tabUrl = "") {
  try {
    const parsed = new URL(String(tabUrl || ""));
    return isApplyFlowLikeHost(parsed.hostname);
  } catch (_error) {
    return false;
  }
}

function buildProfileBundleFromPopupDom(rawProfile = {}) {
  const safeProfile = rawProfile && typeof rawProfile === "object" ? rawProfile : {};
  const fieldSources = {};
  const fieldReasons = {};
  TARGET_FIELDS.forEach((field) => {
    const value = String(safeProfile[field] || "").trim();
    fieldSources[field] = "profile_form_dom";
    fieldReasons[field] = value ? "ok" : "empty_profile_form";
  });
  return {
    profile: {
      full_name: String(safeProfile.full_name || "").trim(),
      email: String(safeProfile.email || "").trim(),
      phone: String(safeProfile.phone || "").trim(),
      gender: String(safeProfile.gender || "").trim(),
      school_name: String(safeProfile.school_name || "").trim(),
      first_school_name: String(safeProfile.first_school_name || "").trim(),
      degree: String(safeProfile.degree || "").trim(),
      major: String(safeProfile.major || "").trim(),
      first_major: String(safeProfile.first_major || "").trim(),
      birth_date: String(safeProfile.birth_date || "").trim(),
      bachelor_start_date: String(safeProfile.bachelor_start_date || "").trim(),
      bachelor_end_date: String(safeProfile.bachelor_end_date || "").trim(),
      master_start_date: String(safeProfile.master_start_date || "").trim(),
      master_end_date: String(safeProfile.master_end_date || "").trim(),
      language_exam_language: String(safeProfile.language_exam_language || "").trim(),
      language_exam_level: String(safeProfile.language_exam_level || "").trim(),
      language_name: String(safeProfile.language_name || "").trim(),
      english_proficiency: String(safeProfile.english_proficiency || "").trim(),
      english_score: String(safeProfile.english_score || "").trim(),
      certificate_name: String(safeProfile.certificate_name || "").trim(),
      achievement_score: String(safeProfile.achievement_score || "").trim(),
      summary: String(safeProfile.summary || "").trim(),
      education: Array.isArray(safeProfile.education) ? safeProfile.education : [],
      work_experience: Array.isArray(safeProfile.work_experience) ? safeProfile.work_experience : [],
      project_experience: Array.isArray(safeProfile.project_experience) ? safeProfile.project_experience : [],
      family: Array.isArray(safeProfile.family) ? safeProfile.family : []
    },
    updatedAt: new Date().toISOString(),
    source: "applyflow_popup_dom_sync",
    debug: {
      syncStatus: "ok_popup_dom_sync",
      syncError: "",
      sourceSummary: {
        profileApi: "popup_dom_sync",
        masterResumeEditDto: "popup_dom_sync",
        masterResumeViewModel: "popup_dom_sync",
        profileForm: "present",
        storage: "chrome.storage.local"
      },
      fieldSources,
      fieldReasons
    }
  };
}

async function syncProfileBundleFromApplyFlowTab(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const form = document.getElementById("profile-form");
        if (!form) {
          return { ok: false, code: "PROFILE_FORM_NOT_FOUND", message: "当前页未找到 profile-form。" };
        }
        const readValue = (selector) => {
          const field = form.querySelector(selector);
          if (!field) return "";
          return String(field.value || field.textContent || "").trim();
        };
        const readRadio = (name) => {
          const checked = form.querySelector(`input[name="${name}"]:checked`);
          return String(checked?.value || "").trim();
        };
        const readRows = (moduleKey) =>
          Array.from(form.querySelectorAll(`[data-module-row="${moduleKey}"]`))
            .map((rowEl) => {
              const row = {};
              rowEl.querySelectorAll("[data-module-field]").forEach((fieldEl) => {
                const key = String(fieldEl?.dataset?.moduleField || "").trim();
                if (!key) return;
                row[key] = String(fieldEl.value || "").trim();
              });
              return row;
            })
            .filter((row) => Object.values(row).some((value) => String(value || "").trim()));
        const profile = {
          full_name: readValue('input[name="name"]'),
          email: readValue('input[name="email"]'),
          phone: readValue('input[name="phone"]'),
          gender: readRadio("gender"),
          school_name: readValue('input[name="school_name"]'),
          first_school_name: readValue('input[name="first_school_name"]'),
          degree: readValue('input[name="degree"]'),
          major: readValue('input[name="major"]'),
          first_major: readValue('input[name="first_major"]'),
          birth_date: readValue('input[name="birth_date"]'),
          bachelor_start_date: readValue('input[name="bachelor_start_date"]'),
          bachelor_end_date: readValue('input[name="bachelor_end_date"]'),
          master_start_date: readValue('input[name="master_start_date"]'),
          master_end_date: readValue('input[name="master_end_date"]'),
          language_exam_language: readValue('select[name="language_exam_language"]'),
          language_exam_level: readValue('select[name="language_exam_level"]'),
          language_name: readValue('input[name="language_name"]'),
          english_proficiency: readValue('input[name="english_proficiency"]'),
          english_score: readValue('input[name="english_score"]'),
          certificate_name: readValue('input[name="certificate_name"]'),
          achievement_score: readValue('input[name="achievement_score"]'),
          summary: readValue('textarea[name="autofill_summary"]'),
          education: readRows("education"),
          work_experience: readRows("work_experience"),
          project_experience: readRows("project_experience"),
          family: readRows("family")
        };
        const hasAnyValue = Object.values(profile).some((value) => {
          if (Array.isArray(value)) return value.length > 0;
          return String(value || "").trim().length > 0;
        });
        if (!hasAnyValue) {
          return { ok: false, code: "PROFILE_FORM_EMPTY", message: "当前材料页尚未填写可同步字段。" };
        }
        return { ok: true, profile };
      }
    });
    const payload = Array.isArray(results) && results[0] ? results[0].result : null;
    if (!payload?.ok) {
      return { ok: false, message: payload?.message || payload?.code || "popup_dom_sync_failed" };
    }
    const bundle = buildProfileBundleFromPopupDom(payload.profile || {});
    await chrome.storage.local.set({ [PROFILE_KEY]: bundle });
    return { ok: true, bundle };
  } catch (error) {
    return { ok: false, message: String(error?.message || "popup_dom_sync_failed") };
  }
}

async function fillBasicFieldsDirectly(tabId, profile = {}) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      args: [profile],
      func: (rawProfile) => {
        const profileData = rawProfile && typeof rawProfile === "object" ? rawProfile : {};
        const targetFieldPatterns = {
          full_name: [/姓名/i, /名字/i, /name/i, /first.?name/i, /last.?name/i],
          email: [/邮箱/i, /邮件/i, /e-?mail/i],
          phone: [/手机/i, /电话/i, /手机号/i, /mobile/i, /phone/i, /tel/i],
          gender: [/性别/i, /gender/i, /sex/i],
          birth_date: [/出生/i, /生日/i, /birth/i, /birthday/i],
          school_name: [/学校/i, /院校/i, /school/i, /university/i, /college/i],
          degree: [/学历/i, /学位/i, /degree/i, /education/i],
          major: [/专业/i, /major/i, /specialty/i],
          summary: [/个人介绍/i, /自我介绍/i, /自我评价/i, /summary/i, /about/i, /profile/i]
        };

        const isVisible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };

        const textOf = (el) => String(el?.textContent || "").trim();
        const normalizeGender = (value = "") => {
          const text = String(value || "").toLowerCase();
          if (/male|男|m|1/.test(text)) return "male";
          if (/female|女|f|2/.test(text)) return "female";
          return "";
        };

        const collectHints = (el) => {
          const hints = [];
          const attrs = ["name", "id", "placeholder", "aria-label"].map((key) => String(el?.getAttribute?.(key) || "").trim());
          hints.push(...attrs);
          if (el?.labels?.length) {
            hints.push(...Array.from(el.labels).map((label) => textOf(label)));
          }
          const label = el.closest?.("label");
          if (label) hints.push(textOf(label));
          const parent = el.parentElement;
          if (parent) hints.push(textOf(parent));
          const prev = parent?.previousElementSibling || el.previousElementSibling;
          if (prev) hints.push(textOf(prev));
          return hints.filter(Boolean).join(" ").toLowerCase();
        };

        const scoreField = (hint = "", field = "") => {
          const patterns = targetFieldPatterns[field] || [];
          let score = 0;
          patterns.forEach((pattern) => {
            if (pattern.test(hint)) score += 10;
          });
          return score;
        };

        const getNativeSetter = (el) => {
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          return Object.getOwnPropertyDescriptor(proto, "value")?.set || null;
        };

        const triggerEvents = (el) => {
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("blur", { bubbles: true }));
        };

        const fillText = (el, value) => {
          if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
          const setter = getNativeSetter(el);
          if (setter) setter.call(el, value);
          else el.value = value;
          triggerEvents(el);
          return String(el.value || "").trim() === String(value || "").trim();
        };

        const fillSelect = (el, value) => {
          if (!(el instanceof HTMLSelectElement)) return false;
          const options = Array.from(el.options || []);
          const target = String(value || "").trim().toLowerCase();
          const hit = options.find((option) => {
            const text = String(option.textContent || option.label || option.value || "").trim().toLowerCase();
            return text === target || text.includes(target) || target.includes(text);
          });
          if (!hit) return false;
          el.value = hit.value;
          triggerEvents(el);
          return String(el.value || "").trim() === String(hit.value || "").trim();
        };

        const fillRadio = (field, value) => {
          const target = normalizeGender(value);
          if (!target) return false;
          const radios = Array.from(document.querySelectorAll("input[type='radio']")).filter(isVisible);
          for (const radio of radios) {
            const hint = collectHints(radio);
            const nextText = textOf(radio.nextElementSibling);
            const labelText = textOf(radio.closest("label"));
            const joined = `${hint} ${nextText} ${labelText}`.toLowerCase();
            const radioValue = normalizeGender(`${radio.value} ${joined}`);
            if (radioValue !== target) continue;
            radio.checked = true;
            radio.dispatchEvent(new Event("click", { bubbles: true }));
            triggerEvents(radio);
            if (radio.checked) return true;
          }
          return false;
        };

        const controls = Array.from(
          document.querySelectorAll("input:not([type='hidden']):not([type='checkbox']):not([type='radio']), textarea, select")
        ).filter(isVisible);

        const fieldResults = [];
        let filledCount = 0;
        let unsupportedCount = 0;
        let unfilledCount = 0;

        const candidateMap = {};
        Object.keys(targetFieldPatterns).forEach((field) => {
          const candidates = controls
            .map((el) => ({
              el,
              hint: collectHints(el),
              score: scoreField(collectHints(el), field)
            }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score);
          candidateMap[field] = candidates;
        });

        for (const [field, value] of Object.entries(profileData)) {
          if (!targetFieldPatterns[field]) continue;
          const safeValue = String(value || "").trim();
          if (!safeValue) {
            fieldResults.push({
              field,
              profileValuePresent: false,
              controlType: "not_found",
              supported: false,
              status: "empty_profile_value",
              reason: "empty_profile_value",
              hint: ""
            });
            continue;
          }
          if (field === "gender") {
            const ok = fillRadio(field, safeValue);
            fieldResults.push({
              field,
              profileValuePresent: true,
              controlType: "radio_group",
              supported: true,
              status: ok ? "filled" : "selector_mismatch",
              reason: ok ? "ok" : "radio_option_not_matched",
              hint: ""
            });
            if (ok) filledCount += 1;
            else unfilledCount += 1;
            continue;
          }
          const firstCandidate = (candidateMap[field] || [])[0] || null;
          if (!firstCandidate) {
            fieldResults.push({
              field,
              profileValuePresent: true,
              controlType: "not_found",
              supported: false,
              status: "not_found",
              reason: "not_found",
              hint: ""
            });
            unfilledCount += 1;
            continue;
          }
          const el = firstCandidate.el;
          let ok = false;
          let controlType = "plain_input";
          if (el instanceof HTMLSelectElement) {
            controlType = "searchable_select";
            ok = fillSelect(el, safeValue);
          } else if (el instanceof HTMLTextAreaElement) {
            controlType = "textarea";
            ok = fillText(el, safeValue);
          } else if (el instanceof HTMLInputElement) {
            const inputType = String(el.type || "").toLowerCase();
            if (inputType === "date") {
              controlType = "date_picker";
            }
            ok = fillText(el, safeValue);
          }
          fieldResults.push({
            field,
            profileValuePresent: true,
            controlType,
            supported: true,
            status: ok ? "filled" : "selector_mismatch",
            reason: ok ? "ok" : "popup_dom_fallback_failed",
            hint: firstCandidate.hint || ""
          });
          if (ok) filledCount += 1;
          else unfilledCount += 1;
        }

        return {
          ok: true,
          filledCount,
          unsupportedCount,
          unfilledCount,
          fieldResults,
          supportLevel: filledCount > 0 ? "medium" : "low",
          recognizedCount: fieldResults.filter((item) => item.controlType !== "not_found").length,
          frameUrl: window.location.href
        };
      }
    });
    const rankedResults = (Array.isArray(results) ? results : [])
      .map((item) => item?.result || null)
      .filter((item) => item && item.ok)
      .sort((left, right) => {
        const leftFilled = Number(left.filledCount || 0);
        const rightFilled = Number(right.filledCount || 0);
        if (rightFilled !== leftFilled) return rightFilled - leftFilled;
        const leftRecognized = Number(left.recognizedCount || 0);
        const rightRecognized = Number(right.recognizedCount || 0);
        if (rightRecognized !== leftRecognized) return rightRecognized - leftRecognized;
        const leftUnfilled = Number(left.unfilledCount || 0);
        const rightUnfilled = Number(right.unfilledCount || 0);
        return leftUnfilled - rightUnfilled;
      });
    const payload = rankedResults[0] || null;
    if (!payload?.ok) {
      return { ok: false, message: payload?.message || "popup_direct_fill_failed" };
    }
    return payload;
  } catch (error) {
    return { ok: false, message: String(error?.message || "popup_direct_fill_failed") };
  }
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
  if (profileLink) {
    profileLink.href = buildMaterialsProfileUrl(tab.url || "");
  }

  if (isApplyFlowPageUrl(tab.url || "")) {
    setSupport("medium", "当前为 ApplyFlow 资料页，可直接同步插件资料。");
    const syncResult = await syncProfileBundleFromApplyFlowTab(tab.id);
    const bundle = syncResult.bundle || (await readProfileBundle());
    renderProfileStatus(bundle);
    renderFieldResults([], bundle?.profile || {});
    if (!syncResult.ok) {
      setResult(`刷新检测失败：${syncResult.message || "popup_dom_sync_failed"}。${buildMaterialsGuidance(tab.url || "")}`, "bad");
      return;
    }
    setResult(`资料更新时间：${new Date(bundle.updatedAt).toLocaleString()}`);
    return;
  }

  const ready = await ensureContentScriptReady(tab);
  const mismatchMessage = ready.ok ? buildVersionMismatchMessage(ready) : "";
  if (mismatchMessage) {
    setResult(mismatchMessage, "warn");
  }
  let syncResult = await triggerProfileSync(tab.id);
  if (!syncResult.ok && ready.ok && isApplyFlowPageUrl(tab.url || "")) {
    syncResult = await triggerProfileSync(tab.id);
  }
  const analyzeResult = ready.ok ? await detectSupport(tab) : null;
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

  if (!ready.ok) {
    setResult(`刷新检测失败：${ready.message || ready.code || "content script 未就绪"}。${buildMaterialsGuidance(tab.url || "")}`, "bad");
    return;
  }
  if (!syncResult.ok) {
    if (bundle.updatedAt) {
      setResult(`当前站点无法实时同步，已使用本地缓存资料（${new Date(bundle.updatedAt).toLocaleString()}）。`, "warn");
      return;
    }
    setResult(`${syncResult.message} ${buildMaterialsGuidance(tab.url || "")}`.trim(), "warn");
    return;
  }
  if (bundle?.debug?.syncStatus === "failed") {
    setResult(`资料同步失败：${bundle?.debug?.syncError || "unknown"}。${buildMaterialsGuidance(tab.url || "")}`, "bad");
    return;
  }
  if (bundle?.debug?.syncStatus === "ok_dom_fallback" && !isProfileMaterialsUrl(tab.url || "")) {
    setResult(`已从页面读取资料，但建议改为打开“网申辅助资料与插件同步”页面后再刷新检测。`, "warn");
    return;
  }
  if (bundle.updatedAt) {
    setResult(`资料更新时间：${new Date(bundle.updatedAt).toLocaleString()}`);
  } else {
    setResult(buildMaterialsGuidance(tab.url || ""), "warn");
  }
}

fillBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) {
    setResult("未找到当前标签页。", "bad");
    return;
  }
  setResult("正在尝试填写...", "muted");
  const bundle = await readProfileBundle();
  const profile = bundle?.profile || {};
  if (!Object.values(profile).some((v) => String(v || "").trim())) {
    setResult(`没有可用资料，${buildMaterialsGuidance(tab?.url || "")}`, "warn");
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
      const fallbackResponse = await fillBasicFieldsDirectly(tab.id, profile);
      if (!fallbackResponse?.ok) {
        setResult(`填写失败：${response?.message || response?.code || "unknown_error"}；兜底填写也失败：${fallbackResponse?.message || "popup_direct_fill_failed"}`, "bad");
        return;
      }
      renderFieldResults(fallbackResponse.fieldResults || [], profile);
      setResult(`已启用基础控件兜底填写：已填 ${fallbackResponse.filledCount || 0}，未填 ${fallbackResponse.unfilledCount || 0}。`, fallbackResponse.filledCount > 0 ? "ok" : "warn");
      return;
    }
    renderFieldResults(response?.fieldResults || [], profile);
    const filled = Number(response?.filledCount || 0);
    const unsupported = Number(response?.unsupportedCount || 0);
    const unfilled = Number(response?.unfilledCount || 0);
    if (filled > 0) {
      setResult(`填写完成：已填 ${filled}，未填 ${unfilled}，不支持 ${unsupported}。`, "ok");
      await detectSupport(tab);
      return;
    }
    const fallbackResponse = await fillBasicFieldsDirectly(tab.id, profile);
    if (fallbackResponse?.ok && Number(fallbackResponse.filledCount || 0) > 0) {
      renderFieldResults(fallbackResponse.fieldResults || [], profile);
      setResult(`智能识别未命中，已启用基础控件兜底填写：已填 ${fallbackResponse.filledCount || 0}，未填 ${fallbackResponse.unfilledCount || 0}。`, "ok");
      return;
    }
    setResult(`填写完成：已填 ${filled}，未填 ${unfilled}，不支持 ${unsupported}。`, "warn");
    await detectSupport(tab);
  } catch (error) {
    const mapped = mapSendMessageError(error);
    const fallbackResponse = await fillBasicFieldsDirectly(tab.id, profile);
    if (fallbackResponse?.ok && Number(fallbackResponse.filledCount || 0) > 0) {
      renderFieldResults(fallbackResponse.fieldResults || [], profile);
      setResult(`页面通信异常，已启用基础控件兜底填写：已填 ${fallbackResponse.filledCount || 0}，未填 ${fallbackResponse.unfilledCount || 0}。`, "ok");
      return;
    }
    setResult(`填写失败：${mapped.message || "当前页面不支持或 content script 未就绪。"}`, "bad");
  }
});

refreshBtn.addEventListener("click", refreshView);

refreshView().catch((error) => {
  setResult(`初始化失败：${error.message || error}`, "bad");
});
