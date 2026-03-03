import type { User } from "firebase/auth";

export const getProviderIdsFromFirebaseUser = (user: User | null): string[] => {
  if (!user) {
    return [];
  }

  const providerIds = user.providerData
    .map((provider) => provider?.providerId)
    .filter((providerId): providerId is string =>
      Boolean(providerId && providerId.trim())
    )
    .map((providerId) => providerId.trim());

  if (providerIds.length === 0 && user.providerId?.trim()) {
    providerIds.push(user.providerId.trim());
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
