function assertObject(value, fieldName = "payload") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error(`${fieldName} must be a JSON object.`);
    error.code = "VALIDATION_ERROR";
    throw error;
  }
}

function ensureString(value, fieldName, options = {}) {
  const min = options.min ?? 0;
  const max = options.max ?? 5000;
  const allowEmpty = options.allowEmpty ?? false;
  const normalized = String(value ?? "").trim();

  if (!allowEmpty && normalized.length < min) {
    const error = new Error(`${fieldName} is required.`);
    error.code = "VALIDATION_ERROR";
    error.details = { field: fieldName };
    throw error;
  }

  if (normalized.length > max) {
    const error = new Error(`${fieldName} is too long.`);
    error.code = "VALIDATION_ERROR";
    error.details = { field: fieldName, max };
    throw error;
  }

  return normalized;
}

function ensureEnum(value, fieldName, allowedValues = []) {
  const normalized = String(value ?? "").trim();
  if (!allowedValues.includes(normalized)) {
    const error = new Error(`${fieldName} must be one of: ${allowedValues.join(", ")}.`);
    error.code = "VALIDATION_ERROR";
    error.details = { field: fieldName, allowedValues };
    throw error;
  }
  return normalized;
}

function sanitizeStringArray(value, options = {}) {
  const maxItems = options.maxItems ?? 20;
  const maxLength = options.maxLength ?? 200;
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .map((item) => item.slice(0, maxLength))
    .slice(0, maxItems);
}

module.exports = {
  assertObject,
  ensureString,
  ensureEnum,
  sanitizeStringArray
};
