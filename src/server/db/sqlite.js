const sqliteAdapter = require("./adapters/sqlite-adapter");

function getDb() {
  return sqliteAdapter.getDatabase ? sqliteAdapter.getDatabase() : null;
}

module.exports = {
  dataDir: sqliteAdapter.dataDir,
  sqliteFilePath: sqliteAdapter.sqliteFilePath,
  schemaFilePath: sqliteAdapter.schemaFilePath,
  getDb
};
