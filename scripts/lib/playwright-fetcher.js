const { chromium } = require("playwright");
const {
  cleanInlineText,
  clipText,
  extractStructuredJobSignals
} = require("../../src/lib/importers/job-page-extractor");

function parseHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch (error) {
    return "";
  }
}

function splitLines(text) {
  return String(text || "")
    .split(/\n+/)
    .map((line) => cleanInlineText(line))
    .filter(Boolean);
}

function collectSectionLines(lines, startKeywords, stopKeywords = []) {
  const startIndex = lines.findIndex((line) =>
    startKeywords.some((keyword) => line.toLowerCase().includes(keyword))
  );
  if (startIndex === -1) return [];

  const collected = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const lowered = line.toLowerCase();
    if (stopKeywords.some((keyword) => lowered.includes(keyword))) break;
    if (/^[A-Z][A-Za-z /&-]{2,40}:?$/.test(line) && collected.length >= 2) break;
    collected.push(line);
    if (collected.length >= 8) break;
  }
  return collected;
}

function inferRequirements(descriptionText) {
  const lines = splitLines(descriptionText);
  const mustHave = collectSectionLines(lines, ["requirements", "basic qualifications", "minimum qualifications"], [
    "preferred qualifications",
    "nice to have",
    "benefits",
    "about you"
  ]);
  const preferred = collectSectionLines(lines, ["preferred qualifications", "nice to have", "preferred"], [
    "benefits",
    "about you",
    "how to apply"
  ]);

  return {
    requirements: mustHave.length ? mustHave : lines.filter((line) => /^[-•*]/.test(line)).slice(0, 6),
    preferredQualifications: preferred
  };
}

async function safeInnerText(locator) {
  try {
    const count = await locator.count();
    if (!count) return "";
    return cleanInlineText(await locator.first().innerText({ timeout: 3000 }));
  } catch (error) {
    return "";
  }
}

async function fetchJobPageWithPlaywright({
  jobUrl,
  timeoutMs = Number(process.env.JD_FETCHER_TIMEOUT_MS || 20000),
  headless = true
}) {
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1080 }
  });

  try {
    await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    try {
      await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 8000) });
    } catch (error) {
      // Some job pages keep polling forever. We still continue with the current DOM snapshot.
    }

    const html = await page.content();
    const pageTitle = cleanInlineText(await page.title());
    const mainText = await safeInnerText(page.locator("main, article, [role='main'], .job-description, .description"));
    const bodyText = await safeInnerText(page.locator("body"));
    const signals = extractStructuredJobSignals({
      jobUrl: page.url(),
      html,
      preferredText: mainText || bodyText,
      documentTitle: pageTitle
    });
    const descriptionText = clipText(signals.extractedText || mainText || bodyText);
    const { requirements, preferredQualifications } = inferRequirements(descriptionText);
    const extractor = "playwright";
    const extractionStrategy = signals.jsonLd.found ? "playwright_json_ld" : mainText ? "playwright_main" : "playwright_body";
    const normalized = {
      sourceUrl: page.url(),
      sourceHost: parseHost(page.url()),
      title: signals.jsonLd.title || signals.metaTitle || signals.documentTitle || "",
      company: signals.jsonLd.company || "",
      location: signals.jsonLd.location || "",
      descriptionText,
      requirements,
      preferredQualifications,
      extractor,
      extractionStrategy
    };

    return {
      ok: true,
      finalUrl: normalized.sourceUrl,
      html,
      pageTitle,
      mainText,
      bodyText,
      ...normalized,
      extracted: {
        title: normalized.title,
        company: normalized.company,
        location: normalized.location,
        text: normalized.descriptionText,
        requirements: normalized.requirements,
        preferredQualifications: normalized.preferredQualifications,
        strategy: normalized.extractionStrategy,
        extractor: normalized.extractor
      }
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = {
  fetchJobPageWithPlaywright
};
