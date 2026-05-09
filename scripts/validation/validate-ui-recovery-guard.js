"use strict";

const fs = require("fs");
const path = require("path");

const fixturePath = path.resolve(__dirname, "../fixtures/ui-recovery-guard-fixture.json");
const appJsPath = path.resolve(__dirname, "../../public/app.js");
const indexPath = path.resolve(__dirname, "../../public/index.html");

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const appSource = fs.readFileSync(appJsPath, "utf8");
const indexSource = fs.readFileSync(indexPath, "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

for (const token of fixture.requiredTokens || []) {
  assert(appSource.includes(token), `recovery guard token missing: ${token}`);
}

for (const route of fixture.requiredRoutes || []) {
  assert(indexSource.includes(`href="${route}"`), `core route missing from nav: ${route}`);
}

for (const routeHandlerToken of fixture.requiredRouteHandlers || []) {
  assert(appSource.includes(routeHandlerToken), `route handler token missing: ${routeHandlerToken}`);
}

console.log("validate-ui-recovery-guard: helper fallback guards keep core routes render-safe.");
