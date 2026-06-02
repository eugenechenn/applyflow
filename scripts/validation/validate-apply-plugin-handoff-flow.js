"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const appJsPath = path.join(root, "public/app.js");
const extensionReadmePath = path.join(root, "public/extensions/applyflow-edge-mvp/README.md");
const extensionZipPath = path.join(root, "public/downloads/applyflow-edge-mvp-v11-semantic-slots.zip");

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

const appSource = readUtf8(appJsPath);
const extensionReadme = readUtf8(extensionReadmePath);

const requiredAppTokens = [
  'id="jobs-apply-modal"',
  'id="jobs-apply-plugin-download"',
  'id="jobs-apply-profile-link"',
  "打开官网投递链接前，先确认是否启用插件辅助填写",
  "真实投递会在企业官网完成。ApplyFlow 负责帮你排序、准备资料，并通过插件自动预填可识别字段。",
  "插件能力边界：仅辅助填写可识别字段",
  "推荐操作顺序",
  "去个人资料页补齐“网申辅助资料”",
  "网申辅助资料与插件同步",
  "这部分专门服务于企业官网网申辅助填写",
  "边界说明：当前插件不会自动提交，也不保证覆盖附件上传、验证码或复杂多步骤表单。"
];

requiredAppTokens.forEach((token) => {
  assertTrue(appSource.includes(token), `apply plugin handoff token missing in app.js: ${token}`);
});

assertTrue(
  appSource.includes('/downloads/applyflow-edge-mvp-v11-semantic-slots'),
  "plugin download path missing from app.js"
);
assertTrue(
  appSource.includes('#/profile?section=autofill-materials-section'),
  "profile materials deep link missing from app.js"
);

assertTrue(fs.existsSync(extensionZipPath), "curated Edge plugin zip is missing");
assertTrue(
  extensionReadme.includes("one-click fill action"),
  "extension README should still describe one-click fill action"
);
assertTrue(
  extensionReadme.includes("auto submit"),
  "extension README should still preserve no-auto-submit boundary"
);

console.log("validate-apply-plugin-handoff-flow: jobs/profile/plugin handoff markers passed.");
