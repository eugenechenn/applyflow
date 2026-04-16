function redact(value) {
  if (!value) return value;
  const text = String(value);
  if (text.length <= 8) return "***";
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
}

function baseLog(level, event, payload = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...payload
  };
  console.log(JSON.stringify(record));
}

function info(event, payload = {}) {
  baseLog("info", event, payload);
}

function warn(event, payload = {}) {
  baseLog("warn", event, payload);
}

function error(event, payload = {}) {
  baseLog("error", event, payload);
}

module.exports = {
  info,
  warn,
  error,
  redact
};
