const MAX_DRAFT_TEXT_CHARS = 14000;

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#x27;/gi, "'");
}

function cleanInlineText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function clipText(value, maxLength = MAX_DRAFT_TEXT_CHARS) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}\n\n[Truncated for preview]`;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function normalizeJsonLdCandidates(parsed) {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed["@graph"])) return parsed["@graph"];
  return [parsed];
}

function extractJobPostingJsonLd(html) {
  const scriptMatches = [...String(html || "").matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  for (const match of scriptMatches) {
    const parsed = safeJsonParse(match[1]?.trim());
    const candidates = normalizeJsonLdCandidates(parsed);
    const jobPosting = candidates.find((entry) => {
      const type = entry?.["@type"];
      if (Array.isArray(type)) return type.some((item) => String(item).toLowerCase() === "jobposting");
      return String(type || "").toLowerCase() === "jobposting";
    });

    if (!jobPosting) continue;

    const hiringOrganization = jobPosting.hiringOrganization?.name || jobPosting.hiringOrganization?.legalName || "";
    const locationObject = Array.isArray(jobPosting.jobLocation)
      ? jobPosting.jobLocation[0]
      : jobPosting.jobLocation || jobPosting.applicantLocationRequirements?.[0] || {};
    const postalAddress = locationObject?.address || {};
    const location = [
      postalAddress.addressLocality,
      postalAddress.addressRegion,
      postalAddress.addressCountry
    ]
      .filter(Boolean)
      .join(", ");

    const descriptionText = cleanInlineText(
      String(jobPosting.description || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<li>/gi, "\n- ")
        .replace(/<[^>]+>/g, " ")
    );

    return {
      found: true,
      title: cleanInlineText(jobPosting.title || ""),
      company: cleanInlineText(hiringOrganization),
      location: cleanInlineText(location),
      descriptionText: descriptionText || "",
      sourceType: "json_ld"
    };
  }

  return { found: false };
}

function extractMetaContent(html, propertyName) {
  const escaped = propertyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const match = String(html || "").match(pattern);
  return cleanInlineText(match?.[1] || "");
}

function extractTitleFromDocument(html) {
  const titleMatch = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) return cleanInlineText(titleMatch[1]);
  const h1Match = String(html || "").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match?.[1]) return cleanInlineText(h1Match[1]);
  return "";
}

function htmlToText(html) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<\/(p|div|section|article|li|ul|ol|h1|h2|h3|h4|h5|h6|br)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function inferCompanyFromHostname(jobUrl) {
  try {
    const hostname = new URL(jobUrl).hostname.replace(/^www\./i, "");
    const firstPart = hostname.split(".")[0] || "";
    if (!firstPart) return "";
    return firstPart
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch (error) {
    return "";
  }
}

function inferTitleAndCompany(candidateTitle, jobUrl) {
  const titleText = cleanInlineText(candidateTitle);
  if (!titleText) {
    return {
      title: "",
      company: inferCompanyFromHostname(jobUrl)
    };
  }

  const separators = [" at ", " | ", " - ", " — ", " – ", " @ "];
  for (const separator of separators) {
    if (!titleText.toLowerCase().includes(separator.toLowerCase())) continue;
    const parts = titleText.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        title: parts[0],
        company: parts[1]
      };
    }
  }

  return {
    title: titleText,
    company: inferCompanyFromHostname(jobUrl)
  };
}

function inferLocation(text) {
  const normalized = String(text || "");
  const explicitMatch = normalized.match(/location[:：]\s*([^\n]+)/i);
  if (explicitMatch?.[1]) return cleanInlineText(explicitMatch[1]);

  const knownLocations = [
    "Remote",
    "Hybrid",
    "Onsite",
    "San Francisco",
    "New York",
    "Seattle",
    "London",
    "Singapore",
    "Shanghai",
    "Beijing",
    "Shenzhen",
    "Hangzhou"
  ];

  const found = knownLocations.find((item) => new RegExp(item, "i").test(normalized));
  return found || "";
}

function extractStructuredJobSignals({ jobUrl, html, preferredText = "", documentTitle = "" }) {
  const jsonLd = extractJobPostingJsonLd(html);
  const metaTitle = extractMetaContent(html, "og:title") || extractMetaContent(html, "twitter:title");
  const metaDescription =
    extractMetaContent(html, "description") ||
    extractMetaContent(html, "og:description") ||
    extractMetaContent(html, "twitter:description");
  const titleFromDocument = documentTitle || extractTitleFromDocument(html);
  const pageText = htmlToText(html);
  const extractedText = jsonLd.found
    ? [jsonLd.descriptionText, preferredText, metaDescription, pageText].filter(Boolean).join("\n\n")
    : [preferredText, metaDescription, pageText].filter(Boolean).join("\n\n");

  return {
    jsonLd,
    metaTitle,
    metaDescription,
    documentTitle: titleFromDocument,
    extractedText: clipText(extractedText),
    pageText: clipText(pageText)
  };
}

module.exports = {
  MAX_DRAFT_TEXT_CHARS,
  cleanInlineText,
  clipText,
  extractJobPostingJsonLd,
  extractMetaContent,
  extractTitleFromDocument,
  htmlToText,
  inferCompanyFromHostname,
  inferTitleAndCompany,
  inferLocation,
  extractStructuredJobSignals
};
