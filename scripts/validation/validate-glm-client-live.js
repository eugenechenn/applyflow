"use strict";

const { callGLMJson, getGlmConfig } = require("../../src/lib/llm/glm-client");

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const config = getGlmConfig();
  if (!config.apiKey) {
    console.log("validate-glm-client-live: skipped (GLM_API_KEY is not set).");
    return;
  }

  const result = await callGLMJson({
    systemPrompt: "你是一个只输出 JSON 的助手。字段必须是 hello。",
    userPrompt: "请返回 JSON 对象：{\"hello\":\"world\"}",
    schemaName: "validate_glm_client_live"
  });

  if (!result?.ok) {
    console.error("validate-glm-client-live: call failed", {
      errorCode: result?.errorCode || "UNKNOWN",
      rawText: result?.rawText || "",
      model: result?.model || config.model
    });
    process.exitCode = 1;
    return;
  }

  assertTrue(result.data && typeof result.data === "object", "live result data should be object");
  assertTrue(!Array.isArray(result.data), "live result data should not be array");
  assertTrue(typeof result.rawText === "string" && result.rawText.length > 0, "rawText should be non-empty");
  console.log("validate-glm-client-live: passed.");
}

main().catch((error) => {
  console.error("validate-glm-client-live failed:", error?.message || error);
  process.exitCode = 1;
});
