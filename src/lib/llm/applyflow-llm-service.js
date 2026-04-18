const { logActivity } = require("../orchestrator/activity-logger");
const logger = require("../../server/platform/logger");

const DEFAULT_PROVIDER = process.env.LLM_PROVIDER || "openai";
const DEFAULT_BASE_URL =
  process.env.LLM_BASE_URL ||
  process.env.OPENAI_BASE_URL ||
  "https://api.openai.com/v1";
const DEFAULT_MODEL = process.env.LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS || 15000);

function getLlmConfig() {
  return {
    provider: String(process.env.LLM_PROVIDER || DEFAULT_PROVIDER || "openai").trim().toLowerCase(),
    apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "",
    baseUrl: String(process.env.LLM_BASE_URL || DEFAULT_BASE_URL || "https://api.openai.com/v1").trim(),
    model: String(process.env.LLM_MODEL || DEFAULT_MODEL || "gpt-4o-mini").trim(),
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS || 15000)
  };
}

function hasLlmConfig() {
  return Boolean(getLlmConfig().apiKey);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (Number.isNaN(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeStringArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function extractMessageContent(responseJson) {
  const content = responseJson?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => item?.text || item?.content || "")
      .join("")
      .trim();
  }
  return "";
}

function buildChatCompletionsUrl(baseUrl) {
  const normalized = String(baseUrl || "").replace(/\/+$/, "");
  return `${normalized}/chat/completions`;
}

function isSupportedProvider(provider) {
  return provider === "openai" || provider === "openai-compatible";
}

function logLlmTrace({ taskType, provider, model, success, fallbackUsed, latencyMs, errorSummary }) {
  logger.info("llm.call", {
    taskType,
    provider,
    model,
    success,
    fallbackUsed,
    latencyMs,
    errorSummary: errorSummary || null
  });
  return logActivity({
    type: "llm_trace",
    entityType: "llm_call",
    entityId: `${taskType}:${Date.now()}`,
    action: "llm_trace",
    summary: `${taskType} ${success ? "completed" : "failed"} using ${provider}/${model}${fallbackUsed ? " with fallback" : ""}.`,
    metadata: {
      taskType,
      provider,
      model,
      success,
      fallbackUsed,
      latencyMs,
      errorSummary: errorSummary || null
    },
    agentName: "ApplyFlow LLM Service",
    inputSummary: `Task type: ${taskType}; provider: ${provider}`,
    outputSummary: success ? "Structured response parsed successfully." : "LLM response unavailable; fallback path kept the workflow alive.",
    decisionReason: success
      ? "The service validated the model output against a stable schema before handing it to the orchestrator."
      : `The service fell back to heuristic logic because the LLM call was unavailable or invalid${errorSummary ? ` (${errorSummary})` : ""}.`
  });
}

async function callStructuredJson({
  taskType,
  schemaName,
  schema,
  systemPrompt,
  userPrompt,
  normalizer
}) {
  const startedAt = Date.now();
  const config = getLlmConfig();
  const { provider, apiKey, baseUrl, model, timeoutMs } = config;

  if (!isSupportedProvider(provider)) {
    const result = {
      ok: false,
      fallbackUsed: true,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      errorSummary: `Unsupported LLM provider: ${provider}.`
    };
    logLlmTrace({ taskType, ...result, success: false });
    return result;
  }

  if (!hasLlmConfig()) {
    const result = {
      ok: false,
      fallbackUsed: true,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      errorSummary: "LLM_API_KEY is not configured."
    };
    logLlmTrace({ taskType, ...result, success: false });
    return result;
  }

  if (typeof fetch !== "function") {
    const result = {
      ok: false,
      fallbackUsed: true,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      errorSummary: "Global fetch is not available in this Node runtime."
    };
    logLlmTrace({ taskType, ...result, success: false });
    return result;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildChatCompletionsUrl(baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: schemaName,
            strict: true,
            schema
          }
        }
      })
    });

    const responseJson = await response.json();
    if (!response.ok) {
      throw new Error(responseJson?.error?.message || `LLM request failed with status ${response.status}.`);
    }

    const content = extractMessageContent(responseJson);
    if (!content) {
      throw new Error("LLM response did not contain structured content.");
    }

    const parsed = JSON.parse(content);
    const data = normalizer(parsed);
    const result = {
      ok: true,
      data,
      fallbackUsed: false,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      errorSummary: null
    };
    logLlmTrace({ taskType, ...result, success: true });
    return result;
  } catch (error) {
    const result = {
      ok: false,
      fallbackUsed: true,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      errorSummary: error.name === "AbortError" ? "LLM request timed out." : error.message
    };
    logLlmTrace({ taskType, ...result, success: false });
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateJobIngestion({ payload, fallbackResult }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      company: { type: "string" },
      title: { type: "string" },
      location: { type: "string" },
      summary: { type: "string" },
      responsibilities: { type: "array", items: { type: "string" } },
      requirements: { type: "array", items: { type: "string" } },
      preferredQualifications: { type: "array", items: { type: "string" } },
      riskFlags: { type: "array", items: { type: "string" } }
    },
    required: [
      "company",
      "title",
      "location",
      "summary",
      "responsibilities",
      "requirements",
      "preferredQualifications",
      "riskFlags"
    ]
  };

  const result = await callStructuredJson({
    taskType: "job_ingestion",
    schemaName: "applyflow_job_ingestion",
    schema,
    systemPrompt:
      "You are a job-ingestion assistant. Extract stable, structured job fields from a job description. Return only factual content that can be safely rendered in a product UI. All user-facing text fields must be written in Simplified Chinese.",
    userPrompt: JSON.stringify({
      manualFields: {
        company: payload.company || "",
        title: payload.title || "",
        location: payload.location || "",
        sourcePlatform: payload.sourcePlatform || payload.sourceLabel || "",
        jobUrl: payload.jobUrl || payload.url || ""
      },
      jdText: payload.rawJdText || payload.jdRaw || ""
    }),
    normalizer(parsed) {
      return {
        company: String(parsed.company || fallbackResult.company || payload.company || "").trim() || "未知公司",
        title: String(parsed.title || fallbackResult.title || payload.title || "").trim() || "未命名岗位",
        location: String(parsed.location || fallbackResult.location || payload.location || "").trim() || "未知",
        summary:
          String(parsed.summary || "").trim() ||
          fallbackResult.jdStructured?.summary ||
          "已从提供的岗位描述中提取基础信息。",
        responsibilities:
          normalizeStringArray(parsed.responsibilities, fallbackResult.jdStructured?.responsibilities || []).slice(0, 6),
        requirements:
          normalizeStringArray(parsed.requirements, fallbackResult.jdStructured?.requirements || []).slice(0, 6),
        preferredQualifications: normalizeStringArray(
          parsed.preferredQualifications,
          fallbackResult.jdStructured?.preferredQualifications || []
        ).slice(0, 6),
        riskFlags: normalizeStringArray(parsed.riskFlags, fallbackResult.jdStructured?.riskFlags || []).slice(0, 5)
      };
    }
  });

  return result;
}

async function generateFitAssessment({
  job,
  profile,
  strategyProfile,
  globalPolicy,
  fallbackResult
}) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      fitScore: { type: "number" },
      recommendation: { type: "string", enum: ["apply", "cautious", "skip"] },
      whyApply: { type: "array", items: { type: "string" } },
      keyGaps: { type: "array", items: { type: "string" } },
      riskFlags: { type: "array", items: { type: "string" } },
      suggestedAction: { type: "string" },
      strategyDecision: {
        type: "string",
        enum: ["proceed", "cautious_proceed", "deprioritize", "avoid"]
      },
      confidence: { type: "number" },
      decisionSummary: { type: "string" },
      strategyReasoning: { type: "string" },
      historyInfluenceSummary: { type: "string" },
      policyInfluenceSummary: { type: "string" }
    },
    required: [
      "fitScore",
      "recommendation",
      "whyApply",
      "keyGaps",
      "riskFlags",
      "suggestedAction",
      "strategyDecision",
      "confidence",
      "decisionSummary",
      "strategyReasoning",
      "historyInfluenceSummary",
      "policyInfluenceSummary"
    ]
  };

  const result = await callStructuredJson({
    taskType: "fit_evaluation",
    schemaName: "applyflow_fit_evaluation",
    schema,
    systemPrompt:
      "You are a fit-evaluation assistant for a semi-automatic job search product. Produce a structured assessment that is decisive, concise, and compatible with a stable product schema. Respect the existing policy and history context. All user-facing text fields must be written in Simplified Chinese.",
    userPrompt: JSON.stringify({
      job: {
        company: job.company,
        title: job.title,
        location: job.location,
        summary: job.jdStructured?.summary,
        responsibilities: job.jdStructured?.responsibilities || [],
        requirements: job.jdStructured?.requirements || [],
        preferredQualifications: job.jdStructured?.preferredQualifications || [],
        riskFlags: job.jdStructured?.riskFlags || [],
        keywords: job.jdStructured?.keywords || []
      },
      profile: {
        background: profile.background,
        yearsOfExperience: profile.yearsOfExperience,
        targetRoles: profile.targetRoles || [],
        targetIndustries: profile.targetIndustries || [],
        targetLocations: profile.targetLocations || profile.preferredLocations || [],
        strengths: profile.strengths || [],
        constraints: profile.constraints || []
      },
      history: {
        preferredRoles: strategyProfile?.preferredRoles || [],
        riskyRoles: strategyProfile?.riskyRoles || [],
        successPatterns: strategyProfile?.successPatterns || [],
        failurePatterns: strategyProfile?.failurePatterns || []
      },
      globalPolicy: {
        preferredRoles: globalPolicy?.preferredRoles || [],
        riskyRoles: globalPolicy?.riskyRoles || [],
        focusMode: globalPolicy?.focusMode || "balanced",
        riskTolerance: globalPolicy?.riskTolerance || "medium",
        avoidPatterns: globalPolicy?.avoidPatterns || []
      }
    }),
    normalizer(parsed) {
      const fitScore = clampNumber(parsed.fitScore, 0, 100, fallbackResult.fitScore);
      return {
        fitScore,
        recommendation: parsed.recommendation || fallbackResult.recommendation,
        whyApply: normalizeStringArray(parsed.whyApply, fallbackResult.whyApply || []).slice(0, 4),
        keyGaps: normalizeStringArray(parsed.keyGaps, fallbackResult.keyGaps || []).slice(0, 4),
        riskFlags: normalizeStringArray(parsed.riskFlags, fallbackResult.riskFlags || []).slice(0, 5),
        suggestedAction:
          String(parsed.suggestedAction || "").trim() || fallbackResult.suggestedAction,
        strategyDecision: parsed.strategyDecision || fallbackResult.strategyDecision,
        confidence: clampNumber(parsed.confidence, 0, 1, fallbackResult.confidence || 0.65),
        decisionSummary:
          String(parsed.decisionSummary || "").trim() || fallbackResult.decisionSummary,
        strategyReasoning:
          String(parsed.strategyReasoning || "").trim() || fallbackResult.strategyReasoning,
        historyInfluenceSummary:
          String(parsed.historyInfluenceSummary || "").trim() || fallbackResult.historyInfluenceSummary,
        policyInfluenceSummary:
          String(parsed.policyInfluenceSummary || "").trim() || fallbackResult.policyInfluenceSummary
      };
    }
  });

  return result;
}

async function generateResumeTailoring({
  job,
  profile,
  fitAssessment,
  resumeDocument,
  fallbackResult,
  refinePrompt = "",
  existingOutput = null
}) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      targetKeywords: { type: "array", items: { type: "string" } },
      selectedEvidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            sourceId: { type: "string" },
            sourceText: { type: "string" },
            reason: { type: "string" }
          },
          required: ["sourceId", "sourceText", "reason"]
        }
      },
      rewrittenBullets: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            source: { type: "string" },
            rewritten: { type: "string" }
          },
          required: ["source", "rewritten"]
        }
      },
      tailoredSummary: { type: "string" },
      whyMe: { type: "string" },
      orderingPlan: { type: "array", items: { type: "string" } },
      explainability: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            before: { type: "string" },
            after: { type: "string" },
            reason: { type: "string" },
            jdRequirement: { type: "string" },
            goal: { type: "string" },
            evidenceAnchor: { type: "string" }
          },
          required: ["title", "before", "after", "reason", "jdRequirement", "goal", "evidenceAnchor"]
        }
      },
      uncoveredRequirements: { type: "array", items: { type: "string" } },
      decisionSummary: { type: "string" },
      whyThisVersion: { type: "string" }
    },
    required: [
      "targetKeywords",
      "selectedEvidence",
      "rewrittenBullets",
      "tailoredSummary",
      "whyMe",
      "orderingPlan",
      "explainability",
      "uncoveredRequirements",
      "decisionSummary",
      "whyThisVersion"
    ]
  };

  const result = await callStructuredJson({
    taskType: "resume_tailoring",
    schemaName: "applyflow_resume_tailoring",
    schema,
    systemPrompt:
      "You are a resume-tailoring assistant inside a semi-automatic job application system. You must only select, reorder, and strengthen evidence that already exists in the user's resume. Do not invent new experience. Return only structured JSON. All user-facing fields must be in Simplified Chinese.",
    userPrompt: JSON.stringify({
      job: {
        company: job.company,
        title: job.title,
        summary: job.jdStructured?.summary,
        responsibilities: job.jdStructured?.responsibilities || [],
        requirements: job.jdStructured?.requirements || [],
        preferredQualifications: job.jdStructured?.preferredQualifications || [],
        keywords: job.jdStructured?.keywords || []
      },
      profile: {
        background: profile.background,
        targetRoles: profile.targetRoles || [],
        strengths: profile.strengths || [],
        constraints: profile.constraints || []
      },
      fitAssessment: fitAssessment
        ? {
            fitScore: fitAssessment.fitScore,
            recommendation: fitAssessment.recommendation,
            whyApply: fitAssessment.whyApply || [],
            keyGaps: fitAssessment.keyGaps || [],
            riskFlags: fitAssessment.riskFlags || []
          }
        : null,
      resumeDocument: {
        summary:
          resumeDocument?.structuredProfile?.summary ||
          resumeDocument?.summary ||
          "",
        experience: resumeDocument?.structuredProfile?.experience || [],
        projects: resumeDocument?.structuredProfile?.projects || [],
        skills: resumeDocument?.structuredProfile?.skills || [],
        education: resumeDocument?.structuredProfile?.education || [],
        achievements: resumeDocument?.structuredProfile?.achievements || []
      },
      existingTailoring: existingOutput
        ? {
            tailoredSummary: existingOutput.tailoredSummary || "",
            whyMe: existingOutput.whyMe || "",
            rewrittenBullets: existingOutput.rewrittenBullets || []
          }
        : null,
      userRefineInstruction: String(refinePrompt || "").trim() || null
    }),
    normalizer(parsed) {
      const fallbackBullets = fallbackResult.rewrittenBullets || [];
      const fallbackExplainability = fallbackResult.explainability || [];
      return {
        targetingBrief: {
          ...fallbackResult.targetingBrief,
          targetKeywords: normalizeStringArray(
            parsed.targetKeywords,
            fallbackResult.targetingBrief?.targetKeywords || []
          ).slice(0, 10)
        },
        selectionPlan: {
          ...(fallbackResult.selectionPlan || {}),
          orderingPlan: normalizeStringArray(
            parsed.orderingPlan,
            fallbackResult.selectionPlan?.orderingPlan || []
          ).slice(0, 6)
        },
        rewrittenBullets:
          Array.isArray(parsed.rewrittenBullets) && parsed.rewrittenBullets.length
            ? parsed.rewrittenBullets
                .map((item, index) => ({
                  source: String(item?.source || fallbackBullets[index]?.source || `经历 ${index + 1}`).trim(),
                  rewritten: String(item?.rewritten || "").trim()
                }))
                .filter((item) => item.rewritten)
                .slice(0, 5)
            : fallbackBullets,
        tailoredSummary:
          String(parsed.tailoredSummary || "").trim() || fallbackResult.tailoredSummary || "",
        whyMe: String(parsed.whyMe || "").trim() || fallbackResult.whyMe || "",
        explainability:
          Array.isArray(parsed.explainability) && parsed.explainability.length
            ? parsed.explainability
                .map((item, index) => ({
                  id: fallbackExplainability[index]?.id || `tailoring_reason_${index + 1}`,
                  title: String(item?.title || fallbackExplainability[index]?.title || `定制理由 ${index + 1}`).trim(),
                  before: String(item?.before || fallbackExplainability[index]?.before || "").trim(),
                  after: String(item?.after || fallbackExplainability[index]?.after || "").trim(),
                  reason: String(item?.reason || fallbackExplainability[index]?.reason || "").trim(),
                  jdRequirement: String(item?.jdRequirement || fallbackExplainability[index]?.jdRequirement || "").trim(),
                  goal: String(item?.goal || fallbackExplainability[index]?.goal || "").trim(),
                  evidenceAnchor: String(item?.evidenceAnchor || fallbackExplainability[index]?.evidenceAnchor || "").trim()
                }))
                .slice(0, 6)
            : fallbackExplainability,
        coverageReport: {
          ...(fallbackResult.coverageReport || {}),
          uncoveredRequirements: normalizeStringArray(
            parsed.uncoveredRequirements,
            fallbackResult.coverageReport?.uncoveredRequirements || []
          ).slice(0, 6)
        },
        decisionSummary:
          String(parsed.decisionSummary || "").trim() || fallbackResult.decisionSummary,
        whyThisVersion:
          String(parsed.whyThisVersion || "").trim() || fallbackResult.whyThisVersion,
        stageOutputSummary:
          String(parsed.decisionSummary || "").trim() || fallbackResult.stageOutputSummary,
        stageDecisionReason:
          "系统基于 JD 重点与原始简历中的真实证据，重排并强化了最相关的经历表达。"
      };
    }
  });

  return result;
}

async function generatePrepDraft({ job, profile, fallbackResult }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      targetKeywords: { type: "array", items: { type: "string" } },
      rewriteBullets: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            source: { type: "string" },
            rewritten: { type: "string" }
          },
          required: ["source", "rewritten"]
        }
      },
      selfIntroShort: { type: "string" },
      selfIntroMedium: { type: "string" },
      tailoredSummary: { type: "string" },
      whyMe: { type: "string" },
      qaDraft: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string" },
            draftAnswer: { type: "string" }
          },
          required: ["question", "draftAnswer"]
        }
      },
      talkingPoints: { type: "array", items: { type: "string" } },
      coverNote: { type: "string" },
      outreachNote: { type: "string" }
    },
    required: [
      "targetKeywords",
      "rewriteBullets",
      "selfIntroShort",
      "selfIntroMedium",
      "tailoredSummary",
      "whyMe",
      "qaDraft",
      "talkingPoints",
      "coverNote",
      "outreachNote"
    ]
  };

  const result = await callStructuredJson({
    taskType: "prep_generation",
    schemaName: "applyflow_prep_generation",
    schema,
    systemPrompt:
      "You are an application-prep assistant. Generate concise but realistic application materials that a user can edit. Keep outputs specific to the job and profile, and return only schema-compliant content. All user-facing text fields must be written in Simplified Chinese.",
    userPrompt: JSON.stringify({
      job: {
        company: job.company,
        title: job.title,
        summary: job.jdStructured?.summary,
        responsibilities: job.jdStructured?.responsibilities || [],
        requirements: job.jdStructured?.requirements || [],
        keywords: job.jdStructured?.keywords || []
      },
      profile: {
        background: profile.background,
        strengths: profile.strengths || [],
        masterResume: profile.masterResume || profile.baseResume || "",
        keyProjects: profile.keyProjects || [],
        resumeDocument: profile.resumeDocument || null
      }
    }),
    normalizer(parsed) {
      const fallbackBullets = fallbackResult.resumeTailoring?.rewriteBullets || [];
      const fallbackQa = fallbackResult.qaDraft || [];
      return {
        targetKeywords: normalizeStringArray(
          parsed.targetKeywords,
          fallbackResult.resumeTailoring?.targetKeywords || []
        ).slice(0, 6),
        rewriteBullets: Array.isArray(parsed.rewriteBullets) && parsed.rewriteBullets.length
          ? parsed.rewriteBullets
              .map((item, index) => ({
                source: String(item?.source || fallbackBullets[index]?.source || `Bullet ${index + 1}`).trim(),
                rewritten: String(item?.rewritten || "").trim()
              }))
              .filter((item) => item.rewritten)
              .slice(0, 4)
          : fallbackBullets,
        selfIntroShort:
          String(parsed.selfIntroShort || "").trim() || fallbackResult.selfIntro?.short || "",
        selfIntroMedium:
          String(parsed.selfIntroMedium || "").trim() || fallbackResult.selfIntro?.medium || "",
        tailoredSummary:
          String(parsed.tailoredSummary || "").trim() || fallbackResult.tailoredSummary || "",
        whyMe: String(parsed.whyMe || "").trim() || fallbackResult.whyMe || "",
        qaDraft: Array.isArray(parsed.qaDraft) && parsed.qaDraft.length
          ? parsed.qaDraft
              .map((item, index) => ({
                question: String(item?.question || fallbackQa[index]?.question || `Question ${index + 1}`).trim(),
                draftAnswer: String(item?.draftAnswer || "").trim()
              }))
              .filter((item) => item.question && item.draftAnswer)
              .slice(0, 4)
          : fallbackQa,
        talkingPoints: normalizeStringArray(parsed.talkingPoints, fallbackResult.talkingPoints || []).slice(0, 5),
        coverNote: String(parsed.coverNote || "").trim() || fallbackResult.coverNote || "",
        outreachNote: String(parsed.outreachNote || "").trim() || fallbackResult.outreachNote || ""
      };
    }
  });

  return result;
}

module.exports = {
  getLlmConfig,
  hasLlmConfig,
  generateJobIngestion,
  generateFitAssessment,
  generateResumeTailoring,
  generatePrepDraft
};
