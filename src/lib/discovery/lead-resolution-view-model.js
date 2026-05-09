"use strict";

function asText(value = "", max = 500) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function extractEmail(text = "") {
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

function extractDeadline(text = "") {
  const source = String(text || "");
  const match =
    source.match(/(?:截止日期|截止时间|deadline)[:：]?\s*([0-9]{4}[./-][0-9]{1,2}[./-][0-9]{1,2})/i) ||
    source.match(/([0-9]{4}[./-][0-9]{1,2}[./-][0-9]{1,2})\s*(?:截止|前有效)/i);
  return match ? match[1] : "";
}

function buildAttachmentRequirements(rawAttachmentsMeta = [], rawText = "") {
  const attachmentNames = (Array.isArray(rawAttachmentsMeta) ? rawAttachmentsMeta : [])
    .map((item) => asText(item?.name || "", 160))
    .filter(Boolean);
  const textHints = [];
  const source = String(rawText || "");
  if (/作品集|portfolio/i.test(source)) textHints.push("需附作品集");
  if (/简历|resume|cv/i.test(source)) textHints.push("需附简历");
  if (/pdf/i.test(source)) textHints.push("附件建议 PDF");
  return [...new Set([...attachmentNames, ...textHints])];
}

function buildCompanySearchUrl(company = "") {
  if (!company) return "";
  return `https://www.bing.com/search?q=${encodeURIComponent(`${company} 官网 招聘`)}`;
}

function buildMailPortalActions(email = "") {
  if (!email) return [];
  const encodedEmail = encodeURIComponent(email);
  return [
    {
      actionId: "open_mailto_link",
      label: "打开默认邮箱",
      kind: "open_link",
      href: `mailto:${email}`
    },
    {
      actionId: "open_gmail_web",
      label: "打开 Gmail",
      kind: "open_link",
      href: `https://mail.google.com/mail/?view=cm&fs=1&to=${encodedEmail}`
    },
    {
      actionId: "open_outlook_web",
      label: "打开 Outlook",
      kind: "open_link",
      href: `https://outlook.office.com/mail/deeplink/compose?to=${encodedEmail}`
    },
    {
      actionId: "open_qq_mail",
      label: "打开 QQ 邮箱",
      kind: "open_link",
      href: "https://mail.qq.com/"
    }
  ];
}

function buildDisplayData(lead = {}) {
  const rawImagesMeta = Array.isArray(lead.rawImagesMeta) ? lead.rawImagesMeta : [];
  const rawAttachmentsMeta = Array.isArray(lead.rawAttachmentsMeta) ? lead.rawAttachmentsMeta : [];
  const originalNoticeText = asText(lead.rawText || "", 1200);
  const email = extractEmail(originalNoticeText);
  const deadline = extractDeadline(originalNoticeText);
  const attachmentRequirements = buildAttachmentRequirements(rawAttachmentsMeta, originalNoticeText);
  const imageHeavy = rawImagesMeta.length > 0 && originalNoticeText.length < 80;

  return {
    title: asText(lead.rawTitle || "", 200),
    company: asText(lead.rawCompany || "", 200),
    location: asText(lead.rawLocation || "", 200),
    sourceUrl: asText(lead.sourceUrl || lead.fetchMeta?.sourceUrl || "", 500),
    email,
    deadline,
    qrImageMeta: rawImagesMeta.filter((item) => /qr|二维码|小程序/i.test(`${item?.name || ""} ${item?.note || ""}`)),
    imageMeta: rawImagesMeta,
    attachmentMeta: rawAttachmentsMeta,
    attachmentRequirements,
    originalNoticeText,
    linkSummary: [asText(lead.sourceUrl || lead.fetchMeta?.sourceUrl || "", 500)].filter(Boolean),
    imageHeavy,
    importedAt: lead.fetchMeta?.importedAt || "",
    sourceLabel: lead.source || "feishu"
  };
}

function buildAvailableActions(view = {}) {
  const display = view.displayData || {};
  const actions = [];

  if (view.leadType === "mini_program_apply") {
    if (Array.isArray(display.qrImageMeta) && display.qrImageMeta.length) {
      actions.push({
        actionId: "view_qr_image",
        label: "查看二维码",
        kind: "view_media",
        mediaItems: display.qrImageMeta
      });
    }
    if (display.sourceUrl) {
      actions.push({
        actionId: "open_source_notice",
        label: "查看原公告",
        kind: "open_link",
        href: display.sourceUrl
      });
    }
    if (display.originalNoticeText) {
      actions.push({
        actionId: "copy_notice_text",
        label: "复制公告摘要",
        kind: "copy_text",
        textValue: display.originalNoticeText
      });
    }
    actions.push({
      actionId: "manual_followup",
      label: "扫码后人工跟进",
      kind: "informational"
    });
  }

  if (view.leadType === "email_apply") {
    if (display.email) {
      actions.push(...buildMailPortalActions(display.email));
      actions.push({
        actionId: "copy_email_address",
        label: "复制邮箱地址",
        kind: "copy_text",
        textValue: display.email
      });
    }
    if (display.sourceUrl) {
      actions.push({
        actionId: "open_source_notice",
        label: "查看原公告",
        kind: "open_link",
        href: display.sourceUrl
      });
    }
    actions.push({
      actionId: "email_followup_reserved",
      label: "保留为邮件投递线索",
      kind: "informational"
    });
  }

  if (view.leadType === "gateway_link") {
    if (display.sourceUrl) {
      actions.push({
        actionId: "open_gateway_url",
        label: "打开官网入口",
        kind: "open_link",
        href: display.sourceUrl
      });
    }
    if (display.company) {
      actions.push({
        actionId: "search_company_site",
        label: "搜索公司官网招聘页",
        kind: "open_link",
        href: buildCompanySearchUrl(display.company)
      });
    }
    actions.push({
      actionId: "manual_followup",
      label: "人工继续查找岗位页",
      kind: "informational"
    });
  }

  if (view.leadType === "incomplete" || display.imageHeavy) {
    if (Array.isArray(display.imageMeta) && display.imageMeta.length) {
      actions.push({
        actionId: "view_original_images",
        label: "查看原图",
        kind: "view_media",
        mediaItems: display.imageMeta
      });
    }
    if (display.originalNoticeText) {
      actions.push({
        actionId: "copy_available_text",
        label: "复制已有文本",
        kind: "copy_text",
        textValue: display.originalNoticeText
      });
    }
    actions.push({
      actionId: "manual_enrich_required",
      label: "信息不足，需人工处理",
      kind: "informational"
    });
  }

  if (!actions.length && display.sourceUrl) {
    actions.push({
      actionId: "open_source_notice",
      label: "打开原始来源",
      kind: "open_link",
      href: display.sourceUrl
    });
  }

  return actions;
}

function buildLeadResolutionItem(lead = {}, classification = {}, decision = {}) {
  const displayData = buildDisplayData(lead);
  const item = {
    leadId: lead.leadId || "",
    leadType: classification.leadType || decision.leadType || "incomplete",
    routing: decision.routing || "manual_enrich_queue",
    reason: decision.reason || "Lead is blocked from candidate input.",
    warnings: Array.isArray(decision.warnings) ? decision.warnings : [],
    availableActions: [],
    displayData
  };
  item.availableActions = buildAvailableActions(item);
  return item;
}

function buildLeadResolutionViewModel(leadProcessingResult = null) {
  if (!leadProcessingResult) {
    return {
      summary: {
        totalBlocked: 0,
        byLeadType: {},
        importedAt: "",
        sourceLabel: "feishu",
        docName: ""
      },
      items: []
    };
  }

  const leadRecords = Array.isArray(leadProcessingResult.leadRecords) ? leadProcessingResult.leadRecords : [];
  const classifications = Array.isArray(leadProcessingResult.classifications) ? leadProcessingResult.classifications : [];
  const decisions = Array.isArray(leadProcessingResult.eligibilityDecisions) ? leadProcessingResult.eligibilityDecisions : [];

  const items = leadRecords
    .map((lead, index) => ({
      lead,
      classification: classifications[index] || {},
      decision: decisions[index] || {}
    }))
    .filter((entry) => !entry.decision.eligibleForCandidateInput)
    .map((entry) => buildLeadResolutionItem(entry.lead, entry.classification, entry.decision));

  const byLeadType = items.reduce((accumulator, item) => {
    accumulator[item.leadType] = Number(accumulator[item.leadType] || 0) + 1;
    return accumulator;
  }, {});

  return {
    summary: {
      totalBlocked: items.length,
      byLeadType,
      importedAt: leadRecords[0]?.fetchMeta?.importedAt || leadProcessingResult.updatedAt || "",
      sourceLabel: leadRecords[0]?.source || "feishu",
      docName: leadRecords[0]?.fetchMeta?.docName || ""
    },
    items
  };
}

module.exports = {
  buildLeadResolutionViewModel
};
