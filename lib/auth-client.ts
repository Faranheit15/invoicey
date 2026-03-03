import type { User } from "firebase/auth";
import { sanitizeProviderId } from "@/lib/user-profile";

export const getProviderIdsFromFirebaseUser = (user: User | null): string[] => {
  if (!user) {
    return [];
  }

  const providerIds = user.providerData
    .map((provider) => provider?.providerId)
    .map((providerId) => sanitizeProviderId(providerId))
    .filter((providerId): providerId is string => Boolean(providerId));

  const fallbackProvider = sanitizeProviderId(user.providerId);
  if (providerIds.length === 0 && fallbackProvider) {
    providerIds.push(fallbackProvider);
  }

  return Array.from(new Set(providerIds));
};

export const requiresEmailVerification = (user: User | null): boolean => {
  if (!user) {
    return false;
  }

  const providerIds = getProviderIdsFromFirebaseUser(user);
  return providerIds.includes("password") && !user.emailVerified;
};
