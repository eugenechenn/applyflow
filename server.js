const { loadLocalEnv } = require("./src/server/platform/load-local-env");
const { createServer } = require("http");
const { handleRequest } = require("./src/server/app");
const store = require("./src/server/store");
const { getRuntimeConfig } = require("./src/server/platform/runtime");

const envLoadResult = loadLocalEnv();
const PORT = process.env.PORT || 3000;

const server = createServer((req, res) => {
  handleRequest(req, res);
});

server.listen(PORT, () => {
  const runtime = getRuntimeConfig();
  console.log(`ApplyFlow running at http://localhost:${PORT}`);
  if (envLoadResult.loadedFiles.length > 0) {
    console.log(`Local env loaded from: ${envLoadResult.loadedFiles.join(", ")}`);
  }
  console.log(`Runtime target: ${runtime.runtime}`);
  console.log(`Database provider: ${runtime.dbProvider}`);
  if (runtime.dbProvider === "sqlite") {
    console.log(`Data layer: SQLite -> ${store.sqliteFilePath}`);
  } else {
    console.log(`Data layer: D1 binding -> ${runtime.d1BindingName}`);
  }
  if (store.migrationStatus?.migrated) {
    console.log(`Imported legacy JSON data from ${store.storeFilePath}`);
  }
});
