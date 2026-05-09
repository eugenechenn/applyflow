"use strict";

/**
 * GLM OpenAI-compatible JSON 调用客户端（独立模块，不影响主链默认行为）。
 */
const DEFAULT_GLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_GLM_MODEL = "glm-4-flash";
const DEFAULT_TIMEOUT_MS = 15000;
const MIN_TIMEOUT_MS = 15000;

function getGlmConfig() {
  return {
    apiKey: String(process.env.GLM_API_KEY || "").trim(),
    baseUrl: String(process.env.GLM_BASE_URL || DEFAULT_GLM_BASE_URL).trim(),
    model: String(process.env.GLM_MODEL || DEFAULT_GLM_MODEL).trim(),
    timeoutMs: Number(process.env.GLM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  };
}

function buildChatCompletionsUrl(baseUrl = "") {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/chat/completions`;
}

function extractMessageContent(responseJson = {}) {
  const content = responseJson?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => item?.text || item?.content || "")
    .join("")
    .trim();
}

function buildErrorResult(errorCode, rawText = "", extras = {}) {
  return {
    ok: false,
    errorCode: String(errorCode || "UNKNOWN_ERROR"),
    rawText: String(rawText || ""),
    ...extras
  };
}

function stripCodeFence(text = "") {
  const raw = String(text || "").trim();
  if (!raw.startsWith("```")) return raw;
  return raw.replace(/^```[a-zA-Z]*\s*/u, "").replace(/\s*```$/u, "").trim();
}

function extractJsonSlice(text = "") {
  const raw = String(text || "").trim();
  const firstObject = raw.indexOf("{");
  const firstArray = raw.indexOf("[");
  let start = -1;
  if (firstObject >= 0 && firstArray >= 0) start = Math.min(firstObject, firstArray);
  else start = Math.max(firstObject, firstArray);
  if (start < 0) return "";
  const slice = raw.slice(start);
  const lastObject = slice.lastIndexOf("}");
  const lastArray = slice.lastIndexOf("]");
  const end = Math.max(lastObject, lastArray);
  if (end < 0) return slice;
  return slice.slice(0, end + 1).trim();
}

function parseJsonStrict(rawText = "") {
  const candidates = [String(rawText || "").trim(), stripCodeFence(rawText), extractJsonSlice(stripCodeFence(rawText))].filter(Boolean);
  let lastError = null;
  for (const text of candidates) {
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch (error) {
      lastError = error;
    }
  }
  return { ok: false, error: lastError };
}

/**
 * 调用 GLM 并返回严格 JSON 解析结果。
 * 成功：{ ok:true, data, rawText, model }
 * 失败：{ ok:false, errorCode, rawText, ... }
 */
async function callGLMJson({
  systemPrompt,
  userPrompt,
  schemaName,
  expectedRoot = "object",
  responseFormatType = "json_object"
} = {}) {
  const startedAt = Date.now();
  const config = getGlmConfig();

  if (!config.apiKey) {
    return buildErrorResult("GLM_API_KEY_MISSING", "", {
      model: config.model,
      latencyMs: Date.now() - startedAt
    });
  }

  if (typeof fetch !== "function") {
    return buildErrorResult("FETCH_UNAVAILABLE", "", {
      model: config.model,
      latencyMs: Date.now() - startedAt
    });
  }

  const controller = new AbortController();
  const timeoutMs = Number.isFinite(config.timeoutMs) ? Math.max(MIN_TIMEOUT_MS, config.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const requestBody = {
      model: config.model,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: String(systemPrompt || "你是一个严格返回 JSON 的助手。")
        },
        {
          role: "user",
          content: String(userPrompt || "")
        }
      ],
      metadata: {
        schema_name: String(schemaName || "glm_json_schema")
      }
    };
    if (responseFormatType === "json_object") {
      requestBody.response_format = { type: "json_object" };
    }

    const response = await fetch(buildChatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify(requestBody)
    });

    const responseJson = await response.json().catch(() => null);
    const rawText = extractMessageContent(responseJson || {});

    if (!response.ok) {
      return buildErrorResult("HTTP_ERROR", rawText, {
        status: Number(response.status || 0),
        model: config.model,
        latencyMs: Date.now() - startedAt
      });
    }

    if (!rawText) {
      return buildErrorResult("EMPTY_CONTENT", "", {
        model: config.model,
        latencyMs: Date.now() - startedAt
      });
    }

    try {
      const parsedResult = parseJsonStrict(rawText);
      if (!parsedResult.ok) {
        return buildErrorResult("JSON_PARSE_ERROR", rawText, {
          parseMessage: parsedResult?.error?.message || "",
          model: config.model,
          latencyMs: Date.now() - startedAt
        });
      }
      const parsed = parsedResult.data;
      if (expectedRoot === "array") {
        if (!Array.isArray(parsed)) {
          return buildErrorResult("JSON_NOT_ARRAY", rawText, {
            model: config.model,
            latencyMs: Date.now() - startedAt
          });
        }
      } else if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return buildErrorResult("JSON_NOT_OBJECT", rawText, {
          model: config.model,
          latencyMs: Date.now() - startedAt
        });
      }
      return {
        ok: true,
        data: parsed,
        rawText,
        model: config.model,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      return buildErrorResult("JSON_PARSE_ERROR", rawText, {
        parseMessage: error?.message || "",
        model: config.model,
        latencyMs: Date.now() - startedAt
      });
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      return buildErrorResult("TIMEOUT", "", {
        model: config.model,
        latencyMs: Date.now() - startedAt
      });
    }
    return buildErrorResult("NETWORK_ERROR", "", {
      message: error?.message || String(error || "network_error"),
      model: config.model,
      latencyMs: Date.now() - startedAt
    });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  getGlmConfig,
  callGLMJson
};
