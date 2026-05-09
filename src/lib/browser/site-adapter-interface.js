"use strict";

const { cleanLine } = require("../contracts/canonical-resume-contracts");

const SITE_ADAPTER_STAGES = ["detect", "mapFields", "fill", "collectEvidence"];

function asText(value = "", max = 220) {
  return cleanLine(value, max);
}

function asTextList(values = [], max = 20, perItemMax = 220) {
  return (Array.isArray(values) ? values : [])
    .map((value) => asText(value, perItemMax))
    .filter(Boolean)
    .slice(0, max);
}

function createSiteAdapterDescriptor(input = {}) {
  return {
    adapterId: asText(input.adapterId || "", 120),
    version: asText(input.version || "v1", 40),
    capabilities: {
      supportedFieldKeys: asTextList(input.capabilities?.supportedFieldKeys || [], 40, 120),
      supportsFileUpload: Boolean(input.capabilities?.supportsFileUpload),
      supportsSubmit: false
    },
    trace: {
      source: asText(input.trace?.source || "site_adapter_interface.v1", 120)
    }
  };
}

function validateSiteAdapterDescriptor(descriptor = {}) {
  const errors = [];
  if (!descriptor || typeof descriptor !== "object") errors.push("descriptor must be an object");
  if (!descriptor.adapterId) errors.push("adapterId is required");
  if (!descriptor.version) errors.push("version is required");
  if (!descriptor.capabilities || typeof descriptor.capabilities !== "object") {
    errors.push("capabilities must be an object");
  } else {
    if (!Array.isArray(descriptor.capabilities.supportedFieldKeys)) {
      errors.push("capabilities.supportedFieldKeys must be an array");
    }
    if (typeof descriptor.capabilities.supportsFileUpload !== "boolean") {
      errors.push("capabilities.supportsFileUpload must be a boolean");
    }
    if (descriptor.capabilities.supportsSubmit !== false) {
      errors.push("capabilities.supportsSubmit must be false");
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateSiteAdapterImplementation(adapter) {
  const errors = [];
  if (!adapter || typeof adapter !== "object") {
    return { ok: false, errors: ["site adapter must be an object"] };
  }

  if (!adapter.descriptor || typeof adapter.descriptor !== "object") {
    errors.push("adapter.descriptor is required");
  } else {
    const descriptorValidation = validateSiteAdapterDescriptor(adapter.descriptor);
    if (!descriptorValidation.ok) {
      errors.push(...descriptorValidation.errors.map((error) => `descriptor.${error}`));
    }
  }

  SITE_ADAPTER_STAGES.forEach((methodName) => {
    if (typeof adapter[methodName] !== "function") {
      errors.push(`${methodName} must be a function`);
    }
  });

  if (typeof adapter.submit === "function") {
    errors.push("submit is not allowed on site adapter interface");
  }

  return { ok: errors.length === 0, errors };
}

function ensureSiteAdapterContract(adapter) {
  const validation = validateSiteAdapterImplementation(adapter);
  if (!validation.ok) {
    const error = new Error(`Invalid site adapter interface: ${validation.errors.join("; ")}`);
    error.code = "INVALID_SITE_ADAPTER_INTERFACE";
    error.details = { errors: validation.errors };
    throw error;
  }
}

module.exports = {
  SITE_ADAPTER_STAGES,
  createSiteAdapterDescriptor,
  validateSiteAdapterDescriptor,
  validateSiteAdapterImplementation,
  ensureSiteAdapterContract
};

