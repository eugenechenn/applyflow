"use strict";

const fs = require("fs");
const path = require("path");

/**
 * 本地开发环境变量加载器：
 * - 仅在非 production 环境启用
 * - 仅用于 node 本地入口（不影响 wrangler/production）
 * - 优先加载 .env.local，再加载 .dev.vars（仅填充未设置变量）
 */
function loadLocalEnv() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() === "production") {
    return { loadedFiles: [] };
  }

  const root = process.cwd();
  const candidates = [".env.local", ".dev.vars"];
  const loadedFiles = [];

  candidates.forEach((fileName) => {
    const fullPath = path.join(root, fileName);
    if (!fs.existsSync(fullPath)) return;

    const content = fs.readFileSync(fullPath, "utf8");
    parseEnvLikeContent(content).forEach(({ key, value }) => {
      if (!key) return;
      if (process.env[key] !== undefined) return;
      process.env[key] = value;
    });
    loadedFiles.push(fileName);
  });

  return { loadedFiles };
}

function parseEnvLikeContent(content = "") {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      if (index <= 0) return { key: "", value: "" };
      const key = line.slice(0, index).trim();
      const rawValue = line.slice(index + 1).trim();
      const value = stripWrappingQuotes(rawValue);
      return { key, value };
    });
}

function stripWrappingQuotes(value = "") {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

module.exports = {
  loadLocalEnv
};
