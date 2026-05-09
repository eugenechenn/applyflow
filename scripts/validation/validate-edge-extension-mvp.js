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
if (!/\/downloads\/applyflow-edge-mvp-v11-semantic-slots\.zip/.test(appJs)) {
  throw new Error("Prep UI missing Edge extension download entry.");
}

if (!/field-results/.test(fs.readFileSync(path.join(root, "public/extensions/applyflow-edge-mvp/popup.html"), "utf8"))) {
  throw new Error("Popup missing field-level result container.");
}

console.log("validate-edge-extension-mvp: passed.");
