const { createId, nowIso } = require("../../utils/id");
const { generateJobIngestion, getLlmConfig } = require("../../llm/applyflow-llm-service");

function splitLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripListMarker(line) {
  return String(line || "")
    .replace(/^[-•*]\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
}

function pickFirstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return "";
}

function extractTitle(lines, fallback) {
  const joined = lines.join("\n");
  return (
    pickFirstMatch(joined, [
      /title[:：]\s*(.+)/i,
      /role[:：]\s*(.+)/i,
      /position[:：]\s*(.+)/i
    ]) ||
    lines.find((line) => /product manager|strategy|analyst|operations|growth|manager/i.test(line)) ||
    fallback ||
    "Untitled Role"
  );
}

function extractCompany(lines, fallback) {
  const joined = lines.join("\n");
  return (
    pickFirstMatch(joined, [
      /company[:：]\s*(.+)/i,
      /organization[:：]\s*(.+)/i,
      /employer[:：]\s*(.+)/i
    ]) ||
    fallback ||
    "Unknown Company"
  );
}

function extractLocation(lines, fallback) {
  const joined = lines.join("\n");
  return (
    pickFirstMatch(joined, [
      /location[:：]\s*(.+)/i,
      /based in[:：]?\s*(.+)/i,
      /city[:：]\s*(.+)/i
    ]) ||
    lines.find((line) => /shanghai|beijing|shenzhen|hangzhou|remote|hybrid/i.test(line)) ||
    fallback ||
    "Unknown"
  );
}

function collectListFromSections(lines, patterns, fallbackCount = 3) {
  const lowered = lines.map((line) => line.toLowerCase());
  const sectionIndex = lowered.findIndex((line) => patterns.some((pattern) => line.includes(pattern)));

  if (sectionIndex >= 0) {
    const collected = [];
    for (let index = sectionIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^[A-Za-z\s]+[:：]$/.test(line) || /responsibilities|requirements|preferred|qualifications/i.test(line)) {
        if (collected.length > 0) {
          break;
        }
      }
      if (/^[-•*]/.test(line) || /^\d+\./.test(line)) {
        collected.push(stripListMarker(line));
      } else if (collected.length > 0) {
        break;
      }
    }
    if (collected.length > 0) {
      return collected;
    }
  }

  return lines
    .filter((line) => /^[-•*]/.test(line) || /^\d+\./.test(line))
    .slice(0, fallbackCount)
    .map((line) => stripListMarker(line));
}

function extractKeywords(jdRaw) {
  const keywords = String(jdRaw || "")
    .toLowerCase()
    .match(/[a-z][a-z+/.-]{2,}/g);

  return [...new Set((keywords || []).filter((word) => !["with", "and", "the", "for", "you", "are"].includes(word)))]
    .slice(0, 12);
}

function detectRiskFlags(jdRaw, title, location) {
  const text = `${title} ${location} ${jdRaw}`.toLowerCase();
  const flags = [];

  if (text.includes("director") || text.includes("head of")) {
    flags.push("Role may be senior relative to many pivoting candidates.");
  }
  if (text.includes("onsite") || text.includes("relocation")) {
    flags.push("Location or work mode may reduce flexibility.");
  }
  if (text.includes("advertising") || text.includes("ad tech")) {
    flags.push("Domain specialization may be narrow.");
  }
  if (String(jdRaw || "").length < 120) {
    flags.push("JD detail is limited, so parsing confidence is lower.");
  }

  return flags;
}

function runRuleBasedJobIngestionAgent(payload) {
  const jdRaw = payload.rawJdText || payload.jdRaw || "";
  const lines = splitLines(jdRaw);
  const title = extractTitle(lines, payload.title);
  const company = extractCompany(lines, payload.company);
  const location = extractLocation(lines, payload.location);
  const responsibilities = collectListFromSections(lines, ["responsibilities", "what you will do", "you will"]);
  const requirements = collectListFromSections(lines, ["requirements", "must have", "what we're looking for"]);
  const preferredQualifications = collectListFromSections(lines, ["preferred", "nice to have", "bonus"], 0);
  const keywords = extractKeywords(`${title} ${company} ${jdRaw}`);
  const riskFlags = detectRiskFlags(jdRaw, title, location);
  const summaryParts = [
    title,
    company !== "Unknown Company" ? `at ${company}` : "",
    responsibilities[0] || requirements[0] || "role details parsed from JD"
  ].filter(Boolean);

  return {
    id: createId("job"),
    source: payload.source || "manual",
    sourceLabel: payload.sourcePlatform || payload.sourceLabel || "Manual",
    url: payload.jobUrl || payload.url,
    company,
    title,
    location,
    jdRaw,
    jdStructured: {
      summary: `${summaryParts.join(" - ")}.`,
      responsibilities:
        responsibilities.length > 0
          ? responsibilities
          : ["Responsibilities were not clearly listed; manual review recommended."],
      requirements:
        requirements.length > 0
          ? requirements
          : ["Core requirements were not clearly listed; manual review recommended."],
      preferredQualifications,
      keywords,
      riskFlags
    },
    status: "evaluating",
    priority: "medium",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

async function runJobIngestionAgent(payload) {
  const fallbackResult = runRuleBasedJobIngestionAgent(payload);
  const llmResult = await generateJobIngestion({ payload, fallbackResult });
  const llmProvider = getLlmConfig().provider;

  if (!llmResult.ok) {
    return {
      ...fallbackResult,
      llmMeta: {
        provider: "heuristic_fallback",
        model: llmResult.model,
        fallbackUsed: true,
        errorSummary: llmResult.errorSummary || null,
        latencyMs: llmResult.latencyMs || null
      }
    };
  }

  return {
    ...fallbackResult,
    company: payload.company || llmResult.data.company || fallbackResult.company,
    title: payload.title || llmResult.data.title || fallbackResult.title,
    location: payload.location || llmResult.data.location || fallbackResult.location,
    jdStructured: {
      ...fallbackResult.jdStructured,
      summary: llmResult.data.summary || fallbackResult.jdStructured.summary,
      responsibilities:
        llmResult.data.responsibilities.length > 0
          ? llmResult.data.responsibilities
          : fallbackResult.jdStructured.responsibilities,
      requirements:
        llmResult.data.requirements.length > 0
          ? llmResult.data.requirements
          : fallbackResult.jdStructured.requirements,
      preferredQualifications:
        llmResult.data.preferredQualifications.length > 0
          ? llmResult.data.preferredQualifications
          : fallbackResult.jdStructured.preferredQualifications,
      riskFlags:
        llmResult.data.riskFlags.length > 0
          ? llmResult.data.riskFlags
          : fallbackResult.jdStructured.riskFlags
    },
    llmMeta: {
      provider: llmProvider,
      model: llmResult.model,
      fallbackUsed: false,
      latencyMs: llmResult.latencyMs || null,
      errorSummary: null
    }
  };
}

module.exports = { runJobIngestionAgent, runRuleBasedJobIngestionAgent };
