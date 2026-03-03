export const DEFAULT_USER_AVATAR = "/default-user-avatar.svg";

const LEGACY_AVATAR_URLS = new Set([
  "https://via.placeholder.com/40",
  "http://via.placeholder.com/40",
]);

const INVALID_PROVIDER_IDS = new Set([
  "",
  "unknown",
  "undefined",
  "null",
  "none",
  "n/a",
]);

export const sanitizeProviderId = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (INVALID_PROVIDER_IDS.has(normalized)) {
    return null;
  }

  return normalized;
};

export const normalizeAvatarUrl = (value: unknown): string => {
  if (typeof value !== "string") {
    return DEFAULT_USER_AVATAR;
  }

  const normalized = value.trim();
  if (!normalized || LEGACY_AVATAR_URLS.has(normalized)) {
    return DEFAULT_USER_AVATAR;
  }

  return normalized;
};
