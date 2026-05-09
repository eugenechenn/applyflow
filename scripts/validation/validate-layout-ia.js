"use strict";

const fs = require("fs");
const path = require("path");

const fixturePath = path.resolve(__dirname, "../fixtures/layout-ia-fixture.json");
const indexPath = path.resolve(__dirname, "../../public/index.html");
const appJsPath = path.resolve(__dirname, "../../public/app.js");

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const indexSource = fs.readFileSync(indexPath, "utf8");
const appSource = fs.readFileSync(appJsPath, "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertContains(source, token, message) {
  assert(source.includes(token), `${message}: ${token}`);
}

const navMatches = [...indexSource.matchAll(/<a href="(#[^"]+)">/g)].map((match) => match[1]);

assert(
  navMatches.length === fixture.requiredNavRoutes.length,
  `导航入口数量不符合最小闭环（期望 ${fixture.requiredNavRoutes.length}，实际 ${navMatches.length}）`
);

for (const route of fixture.requiredNavRoutes) {
  assert(navMatches.includes(route), `导航缺少核心入口: ${route}`);
}

for (const token of fixture.requiredDashboardTokens || []) {
  assertContains(appSource, token, "工作台结构缺少关键文案");
}

for (const token of fixture.requiredJobsTokens || []) {
  assertContains(appSource, token, "岗位列表结构缺少关键字段");
}

for (const token of fixture.requiredProfileTokens || []) {
  assertContains(appSource, token, "个人资料结构缺少关键分区");
}

console.log("validate-layout-ia: information architecture is aligned to 3-page MVP flow.");
