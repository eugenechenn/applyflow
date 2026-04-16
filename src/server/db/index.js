const sqliteAdapter = require("./adapters/sqlite-adapter");
const { createD1Adapter } = require("./adapters/d1-adapter");
const { getRuntimeConfig } = require("../platform/runtime");

function getDatabaseAdapter() {
  const runtime = getRuntimeConfig();
  if (runtime.isD1Provider) {
    return createD1Adapter(null);
  }
  return sqliteAdapter;
}

module.exports = {
  getDatabaseAdapter
};
