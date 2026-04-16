const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const dataDir = path.join(process.cwd(), "data");
const sqliteFilePath = path.join(dataDir, process.env.APPLYFLOW_DB_FILE || "applyflow.sqlite");
const schemaFilePath = path.join(__dirname, "..", "schema.sql");

let dbInstance = null;

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function readSchemaSql() {
  return fs.readFileSync(schemaFilePath, "utf8");
}

function initializeSchema(db) {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(readSchemaSql());
}

function getDatabase() {
  if (dbInstance) {
    return dbInstance;
  }

  ensureDataDir();
  dbInstance = new DatabaseSync(sqliteFilePath);
  initializeSchema(dbInstance);
  return dbInstance;
}

function normalizeParams(params = []) {
  return Array.isArray(params) ? params : [params];
}

function get(sql, params = []) {
  return getDatabase().prepare(sql).get(...normalizeParams(params));
}

function all(sql, params = []) {
  return getDatabase().prepare(sql).all(...normalizeParams(params));
}

function run(sql, params = []) {
  return getDatabase().prepare(sql).run(...normalizeParams(params));
}

function exec(sql) {
  return getDatabase().exec(sql);
}

function transaction(handler) {
  const db = getDatabase();
  try {
    db.exec("BEGIN");
    const result = handler();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

module.exports = {
  kind: "sqlite",
  dataDir,
  sqliteFilePath,
  schemaFilePath,
  getDatabase,
  get,
  all,
  run,
  exec,
  transaction
};
