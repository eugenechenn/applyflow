"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const requiredFiles = [
  "public/extensions/applyflow-edge-mvp/manifest.json",
  "public/extensions/applyflow-edge-mvp/popup.html",
  "public/extensions/applyflow-edge-mvp/popup.js",
  "public/extensions/applyflow-edge-mvp/content.js",
  "public/extensions/applyflow-edge-mvp/content.css",
  "public/downloads/applyflow-edge-mvp-v11-semantic-slots.zip",
  "public/downloads/applyflow-edge-mvp-latest-v11.zip"
];

requiredFiles.forEach((relativePath) => {
  const abs = path.join(root, relativePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Missing required edge extension artifact: ${relativePath}`);
  }
});

const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
if (!/\/downloads\/applyflow-edge-mvp-v11-semantic-slots(?!\.zip)/.test(appJs)) {
  throw new Error("Prep UI missing Edge extension download entry.");
}

const popupHtml = fs.readFileSync(path.join(root, "public/extensions/applyflow-edge-mvp/popup.html"), "utf8");
const popupJs = fs.readFileSync(path.join(root, "public/extensions/applyflow-edge-mvp/popup.js"), "utf8");
const downloadedPopupHtml = fs.readFileSync(path.join(root, "public/downloads/popup.html"), "utf8");
const downloadedPopupJs = fs.readFileSync(path.join(root, "public/downloads/popup.js"), "utf8");
if (!/打开网申辅助资料/.test(popupHtml)) {
  throw new Error("Popup missing materials deeplink label.");
}
if (!/#\/profile\?section=autofill-materials-section/.test(popupHtml)) {
  throw new Error("Popup missing materials deeplink target.");
}
if (/Resume \/ Profile|Profile\/Resume/.test(popupHtml) || /Profile\/Resume/.test(popupJs)) {
  throw new Error("Popup still contains legacy Profile/Resume wording.");
}
if (!/网申辅助资料与插件同步/.test(popupJs)) {
  throw new Error("Popup guidance missing materials sync wording.");
}
if (!/syncProfileBundleFromApplyFlowTab/.test(popupJs) || !/buildProfileBundleFromPopupDom/.test(popupJs)) {
  throw new Error("Popup missing direct ApplyFlow DOM sync path.");
}
if (!/target:\s*\{\s*tabId,\s*allFrames:\s*true\s*\}/.test(popupJs)) {
  throw new Error("Popup fallback fill is not scanning all frames.");
}
if (!/rankedResults/.test(popupJs) || !/recognizedCount/.test(popupJs)) {
  throw new Error("Popup fallback fill is missing frame result ranking.");
}
if (!/isApplyFlowPageUrl\(tab\.url \|\| \"\"\)/.test(popupJs)) {
  throw new Error("Popup missing ApplyFlow page sync branch.");
}
if (!/打开网申辅助资料/.test(downloadedPopupHtml) || !/#\/profile\?section=autofill-materials-section/.test(downloadedPopupHtml)) {
  throw new Error("Downloaded popup missing materials deeplink.");
}
if (/Resume \/ Profile|Profile\/Resume/.test(downloadedPopupHtml) || /Profile\/Resume/.test(downloadedPopupJs)) {
  throw new Error("Downloaded popup still contains legacy Profile/Resume wording.");
}
if (!/syncProfileBundleFromApplyFlowTab/.test(downloadedPopupJs) || !/buildProfileBundleFromPopupDom/.test(downloadedPopupJs)) {
  throw new Error("Downloaded popup missing direct ApplyFlow DOM sync path.");
}
if (!/target:\s*\{\s*tabId,\s*allFrames:\s*true\s*\}/.test(downloadedPopupJs)) {
  throw new Error("Downloaded popup fallback fill is not scanning all frames.");
}
if (!/buildFrameCandidateSummary/.test(fs.readFileSync(path.join(root, "public/extensions/applyflow-edge-mvp/content.js"), "utf8"))) {
  throw new Error("Content script missing frame candidate summary helper.");
}
if (!/respondWithFramePriority/.test(fs.readFileSync(path.join(root, "public/extensions/applyflow-edge-mvp/content.js"), "utf8"))) {
  throw new Error("Content script missing frame-priority response guard.");
}

if (!/field-results/.test(fs.readFileSync(path.join(root, "public/extensions/applyflow-edge-mvp/popup.html"), "utf8"))) {
  throw new Error("Popup missing field-level result container.");
}

console.log("validate-edge-extension-mvp: passed.");
