function detectRuntime() {
  if (process.env.APPLYFLOW_RUNTIME) {
    return String(process.env.APPLYFLOW_RUNTIME).trim().toLowerCase();
  }

  if (typeof WebSocketPair !== "undefined" && typeof caches !== "undefined") {
    return "cloudflare";
  }

  return "node";
}

function getDatabaseProvider() {
  return String(process.env.APPLYFLOW_DB_PROVIDER || "sqlite").trim().toLowerCase();
}

function getRuntimeConfig() {
  const runtime = detectRuntime();
  const dbProvider = getDatabaseProvider();
  return {
    runtime,
    dbProvider,
    isNodeRuntime: runtime === "node",
    isCloudflareRuntime: runtime === "cloudflare",
    isSQLiteProvider: dbProvider === "sqlite",
    isD1Provider: dbProvider === "d1",
    publicAssetHost: process.env.PUBLIC_APP_ORIGIN || "",
    d1BindingName: process.env.CLOUDFLARE_D1_BINDING || "APPLYFLOW_DB"
  };
}

module.exports = {
  detectRuntime,
  getDatabaseProvider,
  getRuntimeConfig
};
