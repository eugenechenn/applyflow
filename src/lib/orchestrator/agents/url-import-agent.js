const { importJobFromUrl } = require("../../importers/job-url-importer");

async function runUrlImportAgent(payload) {
  const result = await importJobFromUrl(payload);
  return {
    ...result,
    stageOutputSummary: result.ok
      ? `Imported a draft for ${result.draft.company} / ${result.draft.title} using ${result.draft.importMeta?.strategy || "importer"}.`
      : `Import fell back to a manual draft because ${result.errorSummary || "the fetch failed"}.`,
    stageDecisionReason: result.ok
      ? "The URL import stage tries browser-backed or HTML extraction first so the user starts from a real draft instead of a blank form."
      : "The importer preserved the URL and manual fields so the user can keep moving even when the page cannot be parsed automatically."
  };
}

module.exports = {
  runUrlImportAgent
};
