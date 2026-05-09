"use strict";

const { cleanLine, uniqueLines } = require("../../contracts/canonical-resume-contracts");
const { createSiteAdapterDescriptor, ensureSiteAdapterContract } = require("../site-adapter-interface");

const SUPPORTED_FIELD_KEYS = ["name", "email", "phone", "resume_upload", "summary"];
const BLOCKED_FEATURE_FLAGS = ["hasCaptcha", "requiresLogin", "hasDeepIframe", "multiStepHeavy", "dynamicQuestionnaire"];
const FIELD_KEY_PATTERNS = [
  { key: "name", pattern: /(full[\s_-]*name|candidate[\s_-]*name|姓名|name)/i },
  { key: "email", pattern: /(email|e-?mail|邮箱)/i },
  { key: "phone", pattern: /(phone|mobile|tel|telephone|手机号|电话)/i },
  { key: "resume_upload", pattern: /(resume|cv|附件简历|简历上传|upload[\s_-]*(resume|cv))/i },
  { key: "summary", pattern: /(cover[\s_-]*letter|summary|self[\s_-]*intro|自我介绍|求职信)/i }
];

function asText(value = "", max = 320) {
  return cleanLine(value, max);
}

function asTextList(values = [], max = 20, perItemMax = 320) {
  return uniqueLines(Array.isArray(values) ? values : [], max, perItemMax);
}

function toComparableText(parts = []) {
  return parts
    .map((part) => asText(part || "", 200))
    .join(" ")
    .trim();
}

function normalizeSnapshotField(field = {}) {
  return {
    selector: asText(field.selector || "", 300),
    name: asText(field.name || "", 160),
    id: asText(field.id || "", 160),
    label: asText(field.label || "", 160),
    type: asText(field.type || "", 80).toLowerCase(),
    required: Boolean(field.required),
    disabled: Boolean(field.disabled)
  };
}

function normalizeFormSnapshot(snapshot = {}) {
  const input = snapshot && typeof snapshot === "object" ? snapshot : {};
  return {
    hasForm: Boolean(input.hasForm),
    sourceUrl: asText(input.sourceUrl || "", 500),
    pageTitle: asText(input.pageTitle || "", 200),
    features: {
      hasCaptcha: Boolean(input.features?.hasCaptcha),
      requiresLogin: Boolean(input.features?.requiresLogin),
      hasDeepIframe: Boolean(input.features?.hasDeepIframe),
      multiStepHeavy: Boolean(input.features?.multiStepHeavy),
      dynamicQuestionnaire: Boolean(input.features?.dynamicQuestionnaire)
    },
    fields: (Array.isArray(input.fields) ? input.fields : []).map(normalizeSnapshotField)
  };
}

async function loadFormSnapshot(context = {}) {
  const page = context.page;
  if (context.formSnapshot && typeof context.formSnapshot === "object") {
    return normalizeFormSnapshot(context.formSnapshot);
  }
  if (page && typeof page.getFormSnapshot === "function") {
    const snapshot = await page.getFormSnapshot();
    return normalizeFormSnapshot(snapshot);
  }
  return normalizeFormSnapshot({});
}

function detectFieldKey(field = {}) {
  const comparable = toComparableText([field.name, field.id, field.label, field.type]);
  for (const rule of FIELD_KEY_PATTERNS) {
    if (rule.pattern.test(comparable)) return rule.key;
  }
  return "";
}

function buildPayload(bridgeInput = {}) {
  const prefill = bridgeInput.prefillPayload && typeof bridgeInput.prefillPayload === "object" ? bridgeInput.prefillPayload : {};
  const formPayload = bridgeInput.formPayload && typeof bridgeInput.formPayload === "object" ? bridgeInput.formPayload : {};
  return {
    name: asText(prefill.name || formPayload.name || prefill.fullName || formPayload.fullName || "", 120),
    email: asText(prefill.email || formPayload.email || "", 160),
    phone: asText(prefill.phone || formPayload.phone || prefill.mobile || formPayload.mobile || "", 80),
    resume_upload: asText(
      prefill.resumeUploadPath ||
        prefill.resumeFilePath ||
        formPayload.resumeUploadPath ||
        formPayload.resumeFilePath ||
        formPayload.resumePath ||
        "",
      500
    ),
    summary: asText(
      prefill.summary || prefill.coverLetter || formPayload.summary || formPayload.coverLetter || "",
      4000
    )
  };
}

function mapFieldsFromSnapshot(snapshot = {}, bridgeInput = {}) {
  const payload = buildPayload(bridgeInput);
  const mapped = [];
  const unmatched = [];
  const usedFieldKeys = new Set();

  for (const field of snapshot.fields) {
    const detectedKey = detectFieldKey(field);
    if (!detectedKey || !SUPPORTED_FIELD_KEYS.includes(detectedKey)) continue;
    if (usedFieldKeys.has(detectedKey)) continue;
    usedFieldKeys.add(detectedKey);
    mapped.push({
      fieldKey: detectedKey,
      selector: field.selector,
      fieldType: field.type,
      value: payload[detectedKey] || "",
      required: Boolean(field.required),
      disabled: Boolean(field.disabled)
    });
  }

  SUPPORTED_FIELD_KEYS.forEach((key) => {
    if (!usedFieldKeys.has(key)) {
      unmatched.push({
        fieldKey: key,
        reason: "No compatible field was detected on page."
      });
    }
  });

  return { mappedFields: mapped, unmatchedFields: unmatched, payload };
}

async function fillMappedFields(page, mapResult = {}) {
  const fieldFillResults = [];
  for (const item of mapResult.mappedFields || []) {
    if (item.disabled) {
      fieldFillResults.push({
        fieldKey: item.fieldKey,
        outcome: "unsupported",
        source: "generic_html_form",
        reason: "Field exists but is disabled."
      });
      continue;
    }

    if (!item.value) {
      fieldFillResults.push({
        fieldKey: item.fieldKey,
        outcome: "missing",
        source: "bridge_payload",
        reason: "No value provided in prefill payload."
      });
      continue;
    }

    try {
      if (page && typeof page.fillField === "function") {
        if (item.fieldKey === "resume_upload") {
          await page.uploadFile(item.selector, item.value);
        } else {
          await page.fillField(item.selector, item.value);
        }
      }
      fieldFillResults.push({
        fieldKey: item.fieldKey,
        outcome: "filled",
        source: "bridge_payload",
        reason: item.fieldKey === "resume_upload" ? "File upload mapped and applied." : "Mapped field filled."
      });
    } catch (error) {
      fieldFillResults.push({
        fieldKey: item.fieldKey,
        outcome: "error",
        source: "generic_html_form",
        reason: asText(error?.message || "Failed to fill detected field.", 500)
      });
    }
  }

  for (const unmatched of mapResult.unmatchedFields || []) {
    fieldFillResults.push({
      fieldKey: unmatched.fieldKey,
      outcome: "unsupported",
      source: "generic_html_form",
      reason: unmatched.reason
    });
  }

  return fieldFillResults;
}

async function collectEvidenceSnapshot(context = {}, detectResult = {}, mapResult = {}, fillResult = {}) {
  const page = context.page;
  const evidence = {
    currentUrl: asText(detectResult?.snapshot?.sourceUrl || context.targetUrl || "", 500),
    pageTitle: asText(detectResult?.snapshot?.pageTitle || "", 200),
    screenshotRefs: [],
    evidenceRefs: [],
    notes: []
  };

  if (page && typeof page.collectEvidence === "function") {
    const pageEvidence = await page.collectEvidence();
    evidence.currentUrl = asText(pageEvidence?.currentUrl || evidence.currentUrl, 500);
    evidence.pageTitle = asText(pageEvidence?.pageTitle || evidence.pageTitle, 200);
    evidence.screenshotRefs = asTextList(pageEvidence?.screenshotRefs || [], 8, 500);
    evidence.evidenceRefs = asTextList(pageEvidence?.evidenceRefs || [], 10, 500);
    evidence.notes = asTextList(pageEvidence?.notes || [], 12, 320);
  }

  const mappedCount = Array.isArray(mapResult?.mappedFields) ? mapResult.mappedFields.length : 0;
  const filledCount = Array.isArray(fillResult?.fieldFillResults)
    ? fillResult.fieldFillResults.filter((entry) => entry.outcome === "filled").length
    : 0;
  const errorCount = Array.isArray(fillResult?.fieldFillResults)
    ? fillResult.fieldFillResults.filter((entry) => entry.outcome === "error").length
    : 0;

  evidence.notes = asTextList(
    [
      ...evidence.notes,
      `Mapped fields: ${mappedCount}`,
      `Filled fields: ${filledCount}`,
      errorCount > 0 ? `Fill errors: ${errorCount}` : ""
    ],
    12,
    320
  );

  return evidence;
}

const genericHtmlFormAdapter = {
  descriptor: createSiteAdapterDescriptor({
    adapterId: "generic_html_form",
    version: "v1",
    capabilities: {
      supportedFieldKeys: SUPPORTED_FIELD_KEYS,
      supportsFileUpload: true
    },
    trace: {
      source: "generic_html_form.adapter"
    }
  }),

  async detect(context = {}) {
    const snapshot = await loadFormSnapshot(context);
    const blockedReasons = [];
    BLOCKED_FEATURE_FLAGS.forEach((flag) => {
      if (snapshot.features?.[flag]) blockedReasons.push(`${flag} is detected`);
    });
    const detected = Boolean(snapshot.hasForm && snapshot.fields.length > 0 && blockedReasons.length === 0);
    return {
      adapterId: "generic_html_form",
      detected,
      confidence: detected ? 0.88 : 0.15,
      blockedReasons,
      warnings: blockedReasons.length ? ["Page contains unsupported complexity for v1 adapter."] : [],
      snapshot
    };
  },

  async mapFields(context = {}) {
    const detectResult = context.detectResult || (await this.detect(context));
    if (!detectResult.detected) {
      return {
        adapterId: "generic_html_form",
        mappedFields: [],
        unmatchedFields: SUPPORTED_FIELD_KEYS.map((fieldKey) => ({
          fieldKey,
          reason: "Form is not detected or blocked."
        })),
        payload: buildPayload(context.bridgeInput || {})
      };
    }
    const mapped = mapFieldsFromSnapshot(detectResult.snapshot, context.bridgeInput || {});
    return {
      adapterId: "generic_html_form",
      ...mapped
    };
  },

  async fill(context = {}) {
    const mapResult = context.mapResult || (await this.mapFields(context));
    const fieldFillResults = await fillMappedFields(context.page, mapResult);
    return {
      adapterId: "generic_html_form",
      fieldFillResults,
      hasErrors: fieldFillResults.some((entry) => entry.outcome === "error")
    };
  },

  async collectEvidence(context = {}) {
    const detectResult = context.detectResult || (await this.detect(context));
    const mapResult = context.mapResult || (await this.mapFields({ ...context, detectResult }));
    const fillResult = context.fillResult || (await this.fill({ ...context, detectResult, mapResult }));
    const artifacts = await collectEvidenceSnapshot(context, detectResult, mapResult, fillResult);
    return {
      adapterId: "generic_html_form",
      artifacts
    };
  }
};

ensureSiteAdapterContract(genericHtmlFormAdapter);

module.exports = {
  SUPPORTED_FIELD_KEYS,
  BLOCKED_FEATURE_FLAGS,
  genericHtmlFormAdapter
};
