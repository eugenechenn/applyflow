const mammoth = require("mammoth");
const { PDFParse } = require("pdf-parse");
const { createId, nowIso } = require("../utils/id");

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_CLEANED_TEXT_LENGTH = 10_000;
const MAX_SUMMARY_LENGTH = 2_000;
const MAX_SECTION_COUNT = 12;
const MAX_SECTION_CONTENT_LENGTH = 800;

function isDocxFile(fileName = "", mimeType = "") {
  return /docx$/i.test(fileName) || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function isPdfFile(fileName = "", mimeType = "") {
  return /pdf$/i.test(fileName) || mimeType === "application/pdf";
}

function normalizeWhitespace(text = "") {
  return String(text || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateText(text = "", max = MAX_CLEANED_TEXT_LENGTH) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return "";
  return normalized.length > max ? normalized.slice(0, max) : normalized;
}

function splitLines(text = "") {
  return normalizeWhitespace(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function looksLikePdfNoise(line = "") {
  const value = String(line || "").trim();
  if (!value) return true;
  if (/^%PDF-/i.test(value)) return true;
  if (/^(xref|trailer|startxref)$/i.test(value)) return true;
  if (/^\d+ \d+ obj$/i.test(value)) return true;
  if (/^endobj$/i.test(value)) return true;
  if (/^stream$/i.test(value) || /^endstream$/i.test(value)) return true;
  if (/^<<.*>>$/i.test(value)) return true;
  if (/^<\?xml/i.test(value)) return true;
  if (/^<x:xmpmeta/i.test(value)) return true;
  if (/^<rdf:RDF/i.test(value)) return true;
  if (/^<dc:/i.test(value)) return true;
  if (/^<pdf:/i.test(value)) return true;
  if (/^<xmp:/i.test(value)) return true;
  if (/^\/([A-Za-z]+)(\s|$)/.test(value)) return true;
  if (/\b(Catalog|Pages|Metadata|Font|ProcSet|MediaBox|Type|Subtype|FlateDecode|Length)\b/.test(value) && value.length < 200) return true;
  if (/^[A-Za-z0-9+\/]{80,}={0,2}$/.test(value)) return true;
  return false;
}

function cleanExtractedText(rawText = "") {
  const cleanedLines = [];
  for (const line of splitLines(rawText)) {
    if (looksLikePdfNoise(line)) continue;
    const withoutTags = line
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, " ")
      .replace(/Page\s+\d+\s+of\s+\d+/gi, " ");
    const normalized = normalizeWhitespace(withoutTags);
    if (!normalized) continue;
    cleanedLines.push(normalized);
  }

  const merged = [];
  cleanedLines.forEach((line) => {
    const previous = merged[merged.length - 1] || "";
    const previousIsHeading = !!scoreHeading(previous);
    const currentIsHeading = !!scoreHeading(line);
    const shouldMerge =
      previous &&
      !previousIsHeading &&
      !currentIsHeading &&
      previous.length < 120 &&
      line.length < 120 &&
      !/[。！？.!?:：]$/.test(previous) &&
      !/^[-•·▪●]/.test(line);

    if (shouldMerge) {
      merged[merged.length - 1] = `${previous} ${line}`.replace(/[ ]{2,}/g, " ");
    } else {
      merged.push(line);
    }
  });

  return truncateText(merged.join("\n\n"), MAX_CLEANED_TEXT_LENGTH);
}

function countMatches(text = "", patterns = []) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function evaluateResumeTextQuality(rawText = "", cleanedText = "") {
  const safeRaw = String(rawText || "");
  const safeCleaned = String(cleanedText || "");
  const contactSignals = countMatches(safeCleaned, [
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    /(?:\+?\d[\d\s\-()]{7,}\d)/,
    /linkedin/i,
    /github/i
  ]);
  const sectionSignals = countMatches(safeCleaned, [
    /\b(summary|profile|about)\b/i,
    /\b(experience|employment|work history)\b/i,
    /\b(skills|competencies|tooling)\b/i,
    /\b(education|academic)\b/i,
    /\b(projects?)\b/i,
    /简介|概述|个人总结|工作经验|经历|技能|教育|项目/
  ]);
  const resumeSignals = countMatches(safeCleaned, [
    /manager|product|analyst|strategy|operations|growth|designer|engineer/i,
    /university|college|academy|bachelor|master|mba|博士|硕士|本科|大学/i,
    /sql|python|excel|figma|analysis|roadmap|experimentation|stakeholder/i
  ]);
  const noiseSignals = countMatches(`${safeRaw}\n${safeCleaned}`, [
    /^%PDF-/im,
    /^\d+ \d+ obj$/im,
    /^xref$/im,
    /^trailer$/im,
    /^endobj$/im,
    /\/Type\s*\/Catalog/i,
    /<x:xmpmeta/i,
    /<rdf:RDF/i
  ]);
  const cleanedLength = safeCleaned.length;
  const rawLength = safeRaw.length;
  const signalScore = contactSignals + sectionSignals + resumeSignals;
  const noiseRatio = rawLength > 0 ? Math.min(1, noiseSignals * 18 / Math.max(rawLength, 1)) : 0;

  let score = 0;
  if (cleanedLength >= 1600) score += 40;
  else if (cleanedLength >= 800) score += 30;
  else if (cleanedLength >= 250) score += 20;
  else if (cleanedLength >= 120) score += 12;
  else if (cleanedLength >= 60) score += 6;

  score += Math.min(signalScore * 8, 40);
  score -= Math.min(Math.round(noiseRatio * 100), 30);
  score = Math.max(0, Math.min(100, score));

  const label = score >= 75 ? "high" : score >= 45 ? "medium" : "low";
  const usable = cleanedLength >= 120 && signalScore >= 2 && noiseRatio < 0.35;

  return {
    score,
    label,
    usable,
    cleanedLength,
    signalScore,
    noiseRatio,
    contactSignals,
    sectionSignals,
    resumeSignals,
    reasons: [
      `cleanedLength=${cleanedLength}`,
      `signalScore=${signalScore}`,
      `noiseRatio=${noiseRatio.toFixed(3)}`
    ]
  };
}

function inferParseQuality({ rawText = "", cleanedText = "", structuredProfile = {} }) {
  const quality = evaluateResumeTextQuality(rawText, cleanedText);
  const structureSignals = [
    structuredProfile.summary,
    ...(structuredProfile.experience || []),
    ...(structuredProfile.projects || []),
    ...(structuredProfile.skills || []),
    ...(structuredProfile.education || [])
  ].filter(Boolean).length;
  const score = Math.max(0, Math.min(100, quality.score + Math.min(structureSignals * 4, 16)));
  const label = score >= 75 ? "high" : score >= 45 ? "medium" : "low";
  return { score, label, usable: quality.usable, reasons: quality.reasons };
}

function scoreHeading(line = "") {
  const normalized = String(line || "").trim();
  if (!normalized) return null;
  const map = [
    { key: "summary", patterns: [/summary/i, /profile/i, /about/i, /简介/, /概述/, /个人总结/] },
    { key: "experience", patterns: [/experience/i, /employment/i, /work history/i, /经历/, /工作经验/, /实习/] },
    { key: "projects", patterns: [/projects?/i, /项目/] },
    { key: "skills", patterns: [/skills?/i, /competencies/i, /tooling/i, /技能/, /能力/] },
    { key: "education", patterns: [/education/i, /academic/i, /学校/, /教育/] },
    { key: "achievements", patterns: [/achievements?/i, /awards?/i, /highlights?/i, /成果/, /亮点/, /奖项/] },
    { key: "certifications", patterns: [/certifications?/i, /certificate/i, /证书/, /认证/] }
  ];
  const match = map.find((item) => item.patterns.some((pattern) => pattern.test(normalized)));
  return match?.key || null;
}

function limitItems(items, max = 8, perItemMax = 240) {
  return (Array.isArray(items) ? items : [])
    .map((item) => truncateText(item, perItemMax))
    .filter(Boolean)
    .slice(0, max);
}

function extractBulletLikeItems(text = "", max = 8, perItemMax = 240) {
  return limitItems(
    String(text || "")
      .split(/\n|•|·|▪|●|■|-/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 4),
    max,
    perItemMax
  );
}

function chunkResumeSections(cleanedText = "") {
  const lines = splitLines(cleanedText);
  const sections = [];
  let current = { key: "summary", heading: "Summary", lines: [] };

  lines.forEach((line) => {
    const [possibleHeading, inlineContent = ""] = line.split(/[:：]\s*/, 2);
    const nextKey = scoreHeading(line) || scoreHeading(possibleHeading);
    if (nextKey && line.length <= 40) {
      if (current.lines.length > 0) {
        sections.push({
          key: current.key,
          heading: current.heading,
          content: truncateText(current.lines.join("\n"), MAX_SECTION_CONTENT_LENGTH)
        });
      }
      current = { key: nextKey, heading: line, lines: [] };
      return;
    }
    if (nextKey && inlineContent && possibleHeading.length <= 40) {
      if (current.lines.length > 0) {
        sections.push({
          key: current.key,
          heading: current.heading,
          content: truncateText(current.lines.join("\n"), MAX_SECTION_CONTENT_LENGTH)
        });
      }
      current = { key: nextKey, heading: possibleHeading, lines: [inlineContent] };
      return;
    }
    current.lines.push(line);
  });

  if (current.lines.length > 0) {
    sections.push({
      key: current.key,
      heading: current.heading,
      content: truncateText(current.lines.join("\n"), MAX_SECTION_CONTENT_LENGTH)
    });
  }

  return sections.slice(0, MAX_SECTION_COUNT);
}

function extractContact(cleanedText = "") {
  const email = cleanedText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const phone = cleanedText.match(/(?:\+?\d[\d\s\-()]{7,}\d)/)?.[0] || "";
  const lines = splitLines(cleanedText).slice(0, 6);
  const name =
    lines.find((line) => {
      if (scoreHeading(line)) return false;
      if (/@|\d/.test(line)) return false;
      return /^[A-Za-z\u4e00-\u9fa5][A-Za-z\u4e00-\u9fa5 .'-]{1,40}$/.test(line);
    }) || "";
  const location = lines.find((line) => /remote|shanghai|beijing|shenzhen|hangzhou|new york|san francisco|singapore|london|城市|上海|北京|深圳|杭州|远程/i.test(line)) || "";
  return { name, email, phone, location };
}

function buildStructuredProfile(cleanedText = "", extractionMethod = "unknown") {
  const sections = chunkResumeSections(cleanedText);
  const getSectionText = (key) =>
    sections
      .filter((section) => section.key === key)
      .map((section) => section.content)
      .join("\n\n")
      .trim();

  const allLines = splitLines(cleanedText);
  const summaryText = getSectionText("summary") || allLines.slice(0, 4).join(" ");
  const skillsText = getSectionText("skills");
  const fallbackExperienceLines = allLines.filter((line) => /\b(19|20)\d{2}\b/.test(line) || /(manager|analyst|lead|director|specialist|产品|经理|运营|分析|策略)/i.test(line));
  const fallbackEducationLines = allLines.filter((line) => /(university|college|school|academy|大学|学院|本科|硕士|博士|mba|bachelor|master)/i.test(line));
  const fallbackSkillLines = allLines.filter((line) => /(sql|python|excel|strategy|analysis|product|ai|agent|沟通|数据|实验|增长)/i.test(line));
  return {
    ...extractContact(cleanedText),
    summary: truncateText(summaryText, 1200),
    experience: extractBulletLikeItems(getSectionText("experience") || fallbackExperienceLines.join("\n"), 10, 260),
    projects: extractBulletLikeItems(getSectionText("projects"), 8, 240),
    skills: limitItems(
      (skillsText || fallbackSkillLines.join("\n"))
        .split(/,|\/|\n|•|·/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2),
      16,
      80
    ),
    education: extractBulletLikeItems(getSectionText("education") || fallbackEducationLines.join("\n"), 6, 180),
    achievements: extractBulletLikeItems(getSectionText("achievements"), 8, 180),
    certifications: extractBulletLikeItems(getSectionText("certifications"), 6, 140),
    sections,
    extractionMethod
  };
}

async function extractTextFromDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return normalizeWhitespace(result.value || "");
}

function extractFallbackBinaryText(buffer) {
  const utf8Text = buffer.toString("utf8");
  const latin1Text = buffer.toString("latin1");
  const utf8Cleaned = cleanExtractedText(utf8Text);
  const latin1Cleaned = cleanExtractedText(latin1Text);
  return utf8Cleaned.length >= latin1Cleaned.length ? { rawText: utf8Text, cleanedText: utf8Cleaned } : { rawText: latin1Text, cleanedText: latin1Cleaned };
}

async function tryPdfParseStage(buffer, meta = {}) {
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    const rawText = normalizeWhitespace(parsed?.text || "");
    const cleanedText = cleanExtractedText(rawText);
    const quality = evaluateResumeTextQuality(rawText, cleanedText);
    console.info("[resume-parser] pdf stage result", {
      stage: "A_pdf-parse",
      ...meta,
      rawLength: rawText.length,
      cleanedLength: cleanedText.length,
      qualityScore: quality.score,
      qualityLabel: quality.label,
      usable: quality.usable
    });
    return {
      ok: quality.usable,
      rawText,
      cleanedText,
      quality,
      extractionMethod: "pdf-parse"
    };
  } finally {
    await parser.destroy().catch(() => null);
  }
}

async function tryPdfJsStage(buffer, meta = {}) {
  globalThis.DOMMatrix ||= class DOMMatrix {};
  globalThis.ImageData ||= class ImageData {};
  globalThis.Path2D ||= class Path2D {};
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    worker: null,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true
  });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/[ ]{2,}/g, " ")
      .trim();
    if (pageText) pages.push(pageText);
  }
  const rawText = normalizeWhitespace(pages.join("\n\n"));
  const cleanedText = cleanExtractedText(rawText);
  const quality = evaluateResumeTextQuality(rawText, cleanedText);
  console.info("[resume-parser] pdf stage result", {
    stage: "B_pdfjs-dist",
    ...meta,
    rawLength: rawText.length,
    cleanedLength: cleanedText.length,
    qualityScore: quality.score,
    qualityLabel: quality.label,
    usable: quality.usable
  });
  return {
    ok: quality.usable,
    rawText,
    cleanedText,
    quality,
    extractionMethod: "pdfjs-dist"
  };
}

async function extractTextFromPdf(buffer, meta = {}) {
  console.info("[resume-parser] entering PDF pipeline", {
    ...meta,
    bufferBytes: buffer.length
  });

  try {
    const stageA = await tryPdfParseStage(buffer, meta);
    if (stageA.ok) {
      return stageA;
    }
  } catch (error) {
    console.warn("[resume-parser] pdf stage failed", {
      stage: "A_pdf-parse",
      ...meta,
      reason: error?.message || String(error)
    });
  }

  try {
    const stageB = await tryPdfJsStage(buffer, meta);
    if (stageB.ok) {
      return stageB;
    }

    const fallback = extractFallbackBinaryText(buffer);
    const fallbackQuality = evaluateResumeTextQuality(fallback.rawText, fallback.cleanedText);
    console.warn("[resume-parser] pdf fallback selected", {
      stage: "C_fallback_text",
      ...meta,
      rawLength: fallback.rawText.length,
      cleanedLength: fallback.cleanedText.length,
      qualityScore: fallbackQuality.score,
      qualityLabel: fallbackQuality.label,
      usable: fallbackQuality.usable
    });
    return {
      ok: fallbackQuality.usable,
      rawText: fallbackQuality.usable ? fallback.rawText : "",
      cleanedText: fallback.cleanedText,
      quality: fallbackQuality,
      extractionMethod: fallbackQuality.usable ? "fallback_text" : "fallback_text"
    };
  } catch (error) {
    console.warn("[resume-parser] pdf stage failed", {
      stage: "B_pdfjs-dist",
      ...meta,
      reason: error?.message || String(error)
    });
  }

  return {
    ok: false,
    rawText: "",
    cleanedText: "",
    quality: evaluateResumeTextQuality("", ""),
    extractionMethod: "fallback_text"
  };
}

async function parseResumeDocument({ fileName, mimeType, base64Data }) {
  const safeFileName = String(fileName || "resume");
  const safeMimeType = String(mimeType || "application/octet-stream");
  const buffer = Buffer.from(String(base64Data || ""), "base64");
  if (buffer.byteLength > MAX_FILE_BYTES) {
    const error = new Error("简历文件过大，请上传 15MB 以内的 PDF 或 DOCX。");
    error.code = "RESUME_FILE_TOO_LARGE";
    throw error;
  }

  let rawText = "";
  let cleanedText = "";
  let extractionMethod = "unknown";
  let parseStatus = "parse_failed";
  let parseWarning = "";
  let stageQuality = evaluateResumeTextQuality("", "");
  const parseMeta = {
    fileName: safeFileName,
    mimeType: safeMimeType
  };

  try {
    if (isDocxFile(safeFileName, safeMimeType)) {
      rawText = await extractTextFromDocx(buffer);
      cleanedText = cleanExtractedText(rawText);
      extractionMethod = "mammoth_docx";
      stageQuality = evaluateResumeTextQuality(rawText, cleanedText);
    } else if (isPdfFile(safeFileName, safeMimeType)) {
      const pdfResult = await extractTextFromPdf(buffer, parseMeta);
      rawText = pdfResult.rawText || "";
      cleanedText = pdfResult.cleanedText || "";
      extractionMethod = pdfResult.extractionMethod || "fallback_text";
      stageQuality = pdfResult.quality || evaluateResumeTextQuality(rawText, cleanedText);
    } else {
      const unsupportedError = new Error("当前仅支持 PDF 与 DOCX 简历解析。");
      unsupportedError.code = "UNSUPPORTED_RESUME_TYPE";
      throw unsupportedError;
    }
  } catch (error) {
    parseWarning =
      safeMimeType === "application/pdf" || /pdf$/i.test(safeFileName)
        ? "PDF 解析未完整成功，建议优先上传 DOCX 版本以获得更稳定的结构化结果。"
        : "文档解析未完整成功，请稍后重试，或优先上传 DOCX 版本。";
    return {
      id: createId("resume"),
      fileName: safeFileName,
      mimeType: safeMimeType,
      fileSizeBytes: buffer.byteLength,
      parseStatus,
      status: "failed",
      parseQuality: { label: "low", score: 0, reasons: [error?.message || "parse_failed"] },
      extractionMethod: extractionMethod === "unknown" ? "service_failed" : extractionMethod,
      parseWarning,
      rawText: "",
      cleanedText: "",
      summary: "",
      structuredProfile: {
        name: "",
        email: "",
        phone: "",
        location: "",
        summary: "",
        experience: [],
        projects: [],
        skills: [],
        education: [],
        achievements: [],
        certifications: [],
        sections: [],
        extractionMethod: extractionMethod === "unknown" ? "service_failed" : extractionMethod
      },
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  }

  const structuredProfile = buildStructuredProfile(cleanedText, extractionMethod);
  const parseQuality = inferParseQuality({ rawText, cleanedText, structuredProfile });
  const strongSectionCount = (structuredProfile.sections || []).filter((section) => section.content && section.content.length >= 20).length;

  if (parseQuality.usable && strongSectionCount >= 2) {
    parseStatus = "parse_success";
  } else if (cleanedText.length >= 60) {
    parseStatus = "parse_partial";
    parseWarning = extractionMethod === "fallback_text"
      ? "自动解析质量不足，建议上传 DOCX 或手动补充关键信息。"
      : "已提取到部分可用简历内容，但结构化结果可能不完整，建议继续手动检查并优先上传 DOCX。";
  } else {
    parseStatus = "parse_failed";
    parseWarning = "未能提取到稳定的简历正文，建议改用 DOCX 后重新上传。";
  }

  if (safeMimeType === "application/pdf" && extractionMethod === "fallback_text") {
    rawText = "";
  }

  const safeSummary =
    extractionMethod === "fallback_text" && parseStatus !== "parse_success"
      ? truncateText(cleanedText || "自动解析质量不足，建议上传 DOCX 或手动补充。", MAX_SUMMARY_LENGTH)
      : truncateText(structuredProfile.summary || cleanedText, MAX_SUMMARY_LENGTH);

  console.info("[resume-parser] parsed resume document", {
    ...parseMeta,
    extractionMethod,
    parseStatus,
    rawTextLength: rawText.length,
    cleanedTextLength: cleanedText.length,
    stageQuality,
    finalQuality: parseQuality
  });

  return {
    id: createId("resume"),
    fileName: safeFileName,
    mimeType: safeMimeType,
    fileSizeBytes: buffer.byteLength,
    parseStatus,
    status: parseStatus === "parse_success" ? "success" : parseStatus === "parse_partial" ? "partial" : "failed",
    parseQuality,
    extractionMethod,
    parseWarning,
    rawText: extractionMethod === "fallback_text" ? "" : truncateText(rawText, MAX_CLEANED_TEXT_LENGTH),
    cleanedText,
    summary: safeSummary,
    structuredProfile,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

module.exports = {
  parseResumeDocument,
  cleanExtractedText,
  buildStructuredProfile,
  evaluateResumeTextQuality,
  MAX_FILE_BYTES,
  MAX_CLEANED_TEXT_LENGTH,
  MAX_SUMMARY_LENGTH
};
