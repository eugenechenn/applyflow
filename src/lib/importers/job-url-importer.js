const { nowIso } = require("../utils/id");
const logger = require("../../server/platform/logger");
const {
  clipText,
  inferTitleAndCompany,
  inferLocation,
  extractStructuredJobSignals
} = require("./job-page-extractor");

const MAX_FETCH_CHARS = 120000;

function buildDraftFromText({
  jobUrl,
  sourcePlatform,
  manualFields = {},
  extractedText = "",
  extractedTitle = "",
  extractedCompany = "",
  extractedLocation = "",
  strategy = "html_fetch",
  warnings = []
}) {
  const { title: inferredTitle, company: inferredCompany } = inferTitleAndCompany(extractedTitle, jobUrl);
  const location = extractedLocation || inferLocation(extractedText) || manualFields.location || "";
  const company = extractedCompany || manualFields.company || inferredCompany || "Unknown Company";
  const title = manualFields.title || inferredTitle || "Imported Job Draft";
  const rawJdText = clipText(extractedText);

  return {
    source: "url",
    sourceLabel:
      sourcePlatform && String(sourcePlatform).trim().toLowerCase() !== "manual"
        ? sourcePlatform
        : manualFields.sourcePlatform && String(manualFields.sourcePlatform).trim().toLowerCase() !== "manual"
          ? manualFields.sourcePlatform
          : "URL Import",
    jobUrl,
    company,
    title,
    location,
    rawJdText,
    importMeta: {
      strategy,
      fetchedAt: nowIso(),
      warnings: warnings.filter(Boolean),
      textLength: rawJdText.length
    }
  };
}

async function fetchJobUrl(jobUrl) {
  const response = await fetch(jobUrl, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; ApplyFlowBot/1.0; +https://applyflow.local/importer)",
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    const error = new Error(`Unable to fetch the job page (${response.status}).`);
    error.code = "IMPORT_FETCH_FAILED";
    throw error;
  }

  const html = (await response.text()).slice(0, MAX_FETCH_CHARS);
  return {
    html,
    finalUrl: response.url || jobUrl
  };
}

async function tryPlaywrightFetcher({ jobUrl }) {
  const jdFetcherUrl = String(process.env.JD_FETCHER_URL || "").trim();

  try {
    if (jdFetcherUrl) {
      const response = await fetch(jdFetcherUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: jobUrl })
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `JD fetcher returned ${response.status}.`);
      }
      return payload;
    }

    return null;
  } catch (error) {
    logger.warn("job.playwright_fetch_failed", {
      jobUrl,
      message: error.message
    });
    return {
      ok: false,
      error: error.message
    };
  }
}

async function importJobFromUrl({ jobUrl, sourcePlatform, company, title, location }) {
  const manualFields = { company, title, location, sourcePlatform };
  const fallbackImportPath = "fallback_importer";

  try {
    const playwrightResult = await tryPlaywrightFetcher({ jobUrl });
    if (playwrightResult?.ok) {
      const warnings = [];
      if (clipText(playwrightResult.descriptionText || playwrightResult.extracted?.text || "").length < 400) {
        warnings.push("The imported JD is still fairly short. Review and complete the draft before creating the job.");
      }
      const draft = buildDraftFromText({
        jobUrl: playwrightResult.finalUrl || jobUrl,
        sourcePlatform,
        manualFields,
        extractedText:
          playwrightResult.descriptionText ||
          playwrightResult.extracted?.text ||
          playwrightResult.mainText ||
          playwrightResult.bodyText ||
          "",
        extractedTitle: playwrightResult.title || playwrightResult.extracted?.title || playwrightResult.pageTitle || "",
        extractedCompany: playwrightResult.company || playwrightResult.extracted?.company || "",
        extractedLocation: playwrightResult.location || playwrightResult.extracted?.location || "",
        strategy: playwrightResult.extractionStrategy || playwrightResult.extracted?.strategy || "playwright_body",
        warnings
      });

      return {
        ok: true,
        draft,
        importPath: "jd_fetcher_service",
        extractor: playwrightResult.extractor || playwrightResult.extracted?.extractor || "playwright",
        warning: warnings[0] || null
      };
    }

    const { html, finalUrl } = await fetchJobUrl(jobUrl);
    const signals = extractStructuredJobSignals({ jobUrl: finalUrl, html });
    const warnings = [];

    if (playwrightResult?.error) {
      warnings.push(`Playwright fetch failed first: ${playwrightResult.error}`);
    }
    if (!signals.jsonLd.found) {
      warnings.push("Structured JobPosting data was not found, so ApplyFlow used a best-effort HTML extraction.");
    }
    if (clipText(signals.extractedText).length < 400) {
      warnings.push("The imported JD is still fairly short. Review and complete the draft before creating the job.");
    }

    const draft = buildDraftFromText({
      jobUrl: finalUrl,
      sourcePlatform,
      manualFields,
      extractedText: signals.extractedText,
      extractedTitle: signals.jsonLd.title || signals.metaTitle || signals.documentTitle,
      extractedCompany: signals.jsonLd.company || "",
      extractedLocation: signals.jsonLd.location || "",
      strategy: signals.jsonLd.found ? "json_ld" : "html_fetch",
      warnings
    });

    return {
      ok: true,
      draft,
      importPath: fallbackImportPath,
      extractor: signals.jsonLd.found ? "json_ld" : "html_fetch",
      warning: warnings[0] || null
    };
  } catch (error) {
    const fallbackDraft = buildDraftFromText({
      jobUrl,
      sourcePlatform,
      manualFields,
      extractedText: "",
      extractedTitle: title,
      extractedCompany: company,
      extractedLocation: location,
      strategy: "manual_fallback",
      warnings: [
        error.message || "Import failed. Paste the JD manually and continue.",
        "ApplyFlow kept your URL and manual fields so you can still create the job."
      ]
    });

    return {
      ok: false,
      draft: fallbackDraft,
      errorSummary: error.message || "Unable to import the job URL.",
      importPath: fallbackImportPath,
      extractor: "manual_fallback",
      warning: fallbackDraft.importMeta?.warnings?.[0] || null
    };
  }
}

module.exports = {
  importJobFromUrl
};
