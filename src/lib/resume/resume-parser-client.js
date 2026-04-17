const { getRequestContext } = require("../../server/request-context");
const { getRuntimeConfig } = require("../../server/platform/runtime");

function runtimeRequire(modulePath) {
  return eval("require")(modulePath);
}

function getResumeParserUrl() {
  const contextEnv = getRequestContext().env || {};
  return (
    contextEnv.RESUME_PARSER_URL ||
    process.env.RESUME_PARSER_URL ||
    ""
  ).trim();
}

function normalizeServiceResult(result = {}) {
  return {
    id: result.id || "",
    fileName: result.fileName || result.filename || "resume",
    mimeType: result.mimeType || "application/octet-stream",
    fileSizeBytes: Number(result.fileSizeBytes || 0),
    parseStatus: result.parseStatus || "parse_failed",
    status:
      result.status ||
      String(result.parseStatus || "parse_failed").replace(/^parse_/, ""),
    parseQuality:
      typeof result.parseQuality === "object" && result.parseQuality
        ? {
            label: result.parseQuality.label || "low",
            score: Number(result.parseQuality.score || 0)
          }
        : {
            label: result.parseQuality || "low",
            score: Number(result.parseQualityScore || 0)
          },
    extractionMethod: result.extractionMethod || "service_unknown",
    parseWarning: result.parseWarning || "",
    rawText: String(result.rawText || "").slice(0, 10_000),
    cleanedText: String(result.cleanedText || "").slice(0, 10_000),
    summary: String(result.summary || "").slice(0, 2_000),
    structuredProfile: result.structuredProfile || {
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
      extractionMethod: result.extractionMethod || "service_unknown"
    },
    createdAt: result.createdAt || new Date().toISOString(),
    updatedAt: result.updatedAt || new Date().toISOString()
  };
}

async function callResumeParserService(payload) {
  const serviceUrl = getResumeParserUrl();
  if (!serviceUrl) {
    const error = new Error("未配置简历解析服务，请先设置 RESUME_PARSER_URL。");
    error.code = "RESUME_PARSER_URL_MISSING";
    throw error;
  }
  if (typeof fetch !== "function") {
    const error = new Error("当前运行环境不支持调用外部简历解析服务。");
    error.code = "FETCH_UNAVAILABLE";
    throw error;
  }

  const response = await fetch(serviceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  let json = {};
  try {
    json = await response.json();
  } catch (error) {
    json = {};
  }

  if (!response.ok || json.ok === false) {
    const error = new Error(json.error || "简历解析服务调用失败。");
    error.code = json.code || "RESUME_SERVICE_ERROR";
    throw error;
  }

  return normalizeServiceResult(json.data || json.result || json);
}

async function parseResumeWithBestEffort(payload) {
  const runtime = getRuntimeConfig();
  const serviceUrl = getResumeParserUrl();

  if (serviceUrl) {
    return callResumeParserService(payload);
  }

  if (runtime.isNodeRuntime) {
    const { parseResumeDocument } = runtimeRequire("./resume-parser");
    return parseResumeDocument(payload);
  }

  const error = new Error("线上环境未配置简历解析服务，请稍后重试。");
  error.code = "RESUME_SERVICE_NOT_READY";
  throw error;
}

module.exports = {
  parseResumeWithBestEffort,
  getResumeParserUrl,
  normalizeServiceResult
};
