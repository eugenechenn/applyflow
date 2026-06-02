"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const contentPath = path.join(root, "public/extensions/applyflow-edge-mvp/content.js");
const source = fs.readFileSync(contentPath, "utf8");

function assertContains(token, label) {
  if (!source.includes(token)) {
    throw new Error(`${label} missing token: ${token}`);
  }
}

assertContains("function buildProfileBundleFromProfileForm(form)", "DOM fallback");
assertContains("document.getElementById(\"profile-form\")", "Profile form lookup");
assertContains("readStructuredRows(form, \"education\")", "Education rows fallback");
assertContains("readStructuredRows(form, \"work_experience\")", "Work rows fallback");
assertContains("readStructuredRows(form, \"project_experience\")", "Project rows fallback");
assertContains("readStructuredRows(form, \"family\")", "Family rows fallback");
assertContains("syncStatus: \"ok_dom_fallback\"", "Fallback sync status");
assertContains("profileForm: \"present\"", "Fallback source summary");

console.log("validate-edge-profile-sync-fallback: DOM fallback markers passed.");
