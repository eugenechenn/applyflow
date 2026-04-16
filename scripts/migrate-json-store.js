const store = require("../src/server/store");

console.log(
  JSON.stringify(
    {
      database: store.sqliteFilePath,
      legacySource: store.storeFilePath,
      migration: store.migrationStatus
    },
    null,
    2
  )
);
