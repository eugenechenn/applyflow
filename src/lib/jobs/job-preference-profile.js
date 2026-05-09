"use strict";

/**
 * 用户求职偏好归一化：
 * - 兼容 legacy lightweightProfile
 * - 支持新增 jobPreferenceProfile 多维字段
 * - 仅作为 derived/scoring 输入，不改 canonical job
 */

const DEFAULT_PRIORITY_WEIGHTS = Object.freeze({
  industry: 25,
  role: 35,
  skill: 10,
  location: 20,
  company: 10
});

const SUPPORTED_JOB_TYPES = new Set(["校招", "实习", "社招", "不限"]);
const JOB_PREFERENCE_PROFILE_EXPLICIT_KEYS = [
  "preferredIndustries",
  "excludedIndustries",
  "targetRoles",
  "excludedRoles",
  "skills",
  "preferredLocations",
  "companyTypes",
  "avoidCompanyTypes",
  "jobType",
  "priorityWeights"
];

function normalizeTextList(value = [], max = 20) {
  const source = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      source
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  ).slice(0, max);
}

function normalizePriorityWeights(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {
    industry: toPositiveNumber(source.industry, DEFAULT_PRIORITY_WEIGHTS.industry),
    role: toPositiveNumber(source.role, DEFAULT_PRIORITY_WEIGHTS.role),
    skill: toPositiveNumber(source.skill, DEFAULT_PRIORITY_WEIGHTS.skill),
    location: toPositiveNumber(source.location, DEFAULT_PRIORITY_WEIGHTS.location),
    company: toPositiveNumber(source.company, DEFAULT_PRIORITY_WEIGHTS.company)
  };
  const sum = result.industry + result.role + result.skill + result.location + result.company;
  if (sum <= 0) return { ...DEFAULT_PRIORITY_WEIGHTS };
  return result;
}

function toPositiveNumber(value, fallback = 0) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw < 0) return Number(fallback || 0);
  return Math.round(raw);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeLightweightProfile(profile = {}) {
  const source =
    profile?.lightweightProfile && typeof profile.lightweightProfile === "object"
      ? profile.lightweightProfile
      : profile;
  return {
    targetRoles: normalizeTextList(toArray(source?.targetRoles ?? profile?.targetRoles ?? []), 12),
    skills: normalizeTextList(toArray(source?.skills ?? profile?.skills ?? profile?.strengths ?? []), 16),
    preferredLocations: normalizeTextList(
      toArray(source?.preferredLocations ?? profile?.preferredLocations ?? profile?.targetLocations ?? []),
      12
    ),
    degree: String(source?.degree || "").trim(),
    acceptsNonTech: Boolean(source?.acceptsNonTech)
  };
}

function normalizeJobType(value = "") {
  const text = String(value || "").trim();
  return SUPPORTED_JOB_TYPES.has(text) ? text : "不限";
}

function hasExplicitJobPreferenceProfile(profileLike = {}) {
  if (!profileLike || typeof profileLike !== "object" || Array.isArray(profileLike)) return false;
  return JOB_PREFERENCE_PROFILE_EXPLICIT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(profileLike, key));
}

function normalizeJobPreferenceProfile(profile = {}, options = {}) {
  const strict = Boolean(options?.strict);
  const source =
    profile?.jobPreferenceProfile && typeof profile.jobPreferenceProfile === "object"
      ? profile.jobPreferenceProfile
      : profile;
  const lightweight = normalizeLightweightProfile(profile);
  const preferredIndustries = normalizeTextList(
    toArray(source?.preferredIndustries ?? (strict ? [] : profile?.targetIndustries ?? [])),
    12
  );
  const targetRoles = normalizeTextList(toArray(source?.targetRoles ?? (strict ? [] : lightweight.targetRoles ?? [])), 16);
  const skills = normalizeTextList(toArray(source?.skills ?? lightweight.skills ?? []), 20);
  const preferredLocations = normalizeTextList(
    toArray(source?.preferredLocations ?? lightweight.preferredLocations ?? []),
    16
  );

  return {
    preferredIndustries,
    excludedIndustries: normalizeTextList(toArray(source?.excludedIndustries ?? []), 12),
    targetRoles,
    excludedRoles: normalizeTextList(toArray(source?.excludedRoles ?? []), 12),
    skills,
    preferredLocations,
    companyTypes: normalizeTextList(toArray(source?.companyTypes ?? []), 10),
    avoidCompanyTypes: normalizeTextList(toArray(source?.avoidCompanyTypes ?? []), 10),
    jobType: normalizeJobType(source?.jobType ?? profile?.jobType ?? "不限"),
    priorityWeights: normalizePriorityWeights(source?.priorityWeights)
  };
}

function buildLightweightProfileFromJobPreferenceProfile(jobPreferenceProfile = {}, fallback = {}) {
  const normalizedPreference = normalizeJobPreferenceProfile({ jobPreferenceProfile });
  const normalizedFallback = normalizeLightweightProfile(fallback);
  return {
    targetRoles:
      normalizedPreference.targetRoles.length > 0
        ? normalizedPreference.targetRoles
        : normalizedFallback.targetRoles,
    skills: normalizedPreference.skills.length > 0 ? normalizedPreference.skills : normalizedFallback.skills,
    preferredLocations:
      normalizedPreference.preferredLocations.length > 0
        ? normalizedPreference.preferredLocations
        : normalizedFallback.preferredLocations,
    degree: normalizedFallback.degree,
    acceptsNonTech: normalizedFallback.acceptsNonTech
  };
}

module.exports = {
  DEFAULT_PRIORITY_WEIGHTS,
  hasExplicitJobPreferenceProfile,
  normalizeLightweightProfile,
  normalizeJobPreferenceProfile,
  buildLightweightProfileFromJobPreferenceProfile
};
