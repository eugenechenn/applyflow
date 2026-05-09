"use strict";

const { callGLMJson } = require("../../src/lib/llm/glm-client");

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const originalGlmApiKey = process.env.GLM_API_KEY;
  try {
    delete process.env.GLM_API_KEY;
    const result = await callGLMJson({
      systemPrompt: "你是 JSON 助手。",
      userPrompt: "请返回 {\"ok\":true}",
      schemaName: "validate_glm_client_disabled"
    });

    assertTrue(result && typeof result === "object", "result should be an object");
    assertTrue(result.ok === false, "without GLM_API_KEY result.ok should be false");
    assertTrue(result.errorCode === "GLM_API_KEY_MISSING", "should return GLM_API_KEY_MISSING");
    assertTrue(typeof result.rawText === "string", "rawText should always be string");
    console.log("validate-glm-client-disabled: passed.");
  } finally {
    if (originalGlmApiKey === undefined) {
      delete process.env.GLM_API_KEY;
    } else {
      process.env.GLM_API_KEY = originalGlmApiKey;
    }
  }
}

main().catch((error) => {
  console.error("validate-glm-client-disabled failed:", error?.message || error);
  process.exitCode = 1;
});
