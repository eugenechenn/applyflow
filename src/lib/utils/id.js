function createId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = { createId, nowIso };
