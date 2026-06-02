#!/usr/bin/env node
/**
 * 校验插件 ZIP 下载链路的路由保护是否仍然存在。
 */

import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const workerEntryPath = path.join(rootDir, "cloudflare", "worker-entry.js");
const workerEntry = fs.readFileSync(workerEntryPath, "utf8");

const requiredMarkers = [
  '"/downloads/applyflow-edge-mvp-v11-semantic-slots"',
  '"/downloads/applyflow-edge-mvp-latest-v11"',
  '"/downloads/applyflow-edge-mvp-v11-semantic-slots.zip"',
  '"/downloads/applyflow-edge-mvp-latest-v11.zip"',
  'headers.set("Content-Type", "application/zip")',
  'headers.set("Content-Disposition", `attachment; filename*=UTF-8\'\'${encodeURIComponent(fileName)}`)',
  'headers.set("X-Content-Type-Options", "nosniff")',
  "handleExtensionDownloadFetch(request, env, EXTENSION_DOWNLOAD_ROUTES.get(pathname))"
];

const missingMarkers = requiredMarkers.filter((marker) => !workerEntry.includes(marker));
if (missingMarkers.length) {
  console.error("[fail] extension download route markers missing:");
  missingMarkers.forEach((marker) => console.error(` - ${marker}`));
  process.exit(1);
}

console.log("[pass] extension download route markers verified.");
