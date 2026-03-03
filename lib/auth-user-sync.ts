import type { DecodedIdToken } from "firebase-admin/auth";
import User from "@/models/User";
import Invoice from "@/models/Invoice";

const FALLBACK_AVATAR = "https://via.placeholder.com/40";

interface SyncUserInput {
  decodedToken: DecodedIdToken;
  idToken: string;
  providerId?: string;
  refreshToken?: string;
}

interface UserRecord {
  _id: unknown;
  uid?: string;
  email?: string;
  name?: string;
  avatar?: string;
  providerIds?: unknown;
  providerId?: unknown;
  refreshToken?: string;
}

const normalizeProviderId = (
  decodedProviderId: unknown,
  requestedProviderId?: string
): string => {
  if (typeof decodedProviderId === "string" && decodedProviderId.trim()) {
    return decodedProviderId.trim();
  }

  if (requestedProviderId?.trim()) {
    return requestedProviderId.trim();
  }

  return "unknown";
};

const normalizeProviderIds = (rawProviderIds: unknown, legacyProviderId: unknown): string[] => {
  const next = new Set<string>();

  if (Array.isArray(rawProviderIds)) {
    rawProviderIds.forEach((provider) => {
      if (typeof provider === "string" && provider.trim()) {
        next.add(provider.trim());
      }
    });
  }

  if (typeof legacyProviderId === "string" && legacyProviderId.trim()) {
    next.add(legacyProviderId.trim());
  }

  return Array.from(next);
};

const normalizeEmail = (email: string | undefined): string => {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
};

export const syncUserWithMongo = async ({
  decodedToken,
  idToken,
  providerId: requestedProviderId,
  refreshToken,
}: SyncUserInput) => {
  const uid = decodedToken.uid;
  const email = normalizeEmail(decodedToken.email);

  if (!uid || !email) {
    throw new Error("InvalidTokenPayload");
  }

  const providerId = normalizeProviderId(
    decodedToken.firebase?.sign_in_provider,
    requestedProviderId
  );

  const existingUser = (await User.findOne({
    $or: [{ uid }, { email }],
  })) as UserRecord | null;

  const existingProviderIds = normalizeProviderIds(
    existingUser?.providerIds,
    existingUser?.providerId
  );

  const providerIds = Array.from(new Set([...existingProviderIds, providerId]));

  const nameFromToken =
    typeof decodedToken.name === "string" && decodedToken.name.trim()
      ? decodedToken.name.trim()
      : "";

  const nextName = nameFromToken || existingUser?.name || email.split("@")[0] || "User";

  const nextAvatar =
    (typeof decodedToken.picture === "string" && decodedToken.picture.trim()
      ? decodedToken.picture
      : existingUser?.avatar) || FALLBACK_AVATAR;

  const nextRefreshToken =
    typeof refreshToken === "string" ? refreshToken : existingUser?.refreshToken || "";

  const updatePayload = {
    uid,
    email,
    name: nextName,
    avatar: nextAvatar,
    providerIds,
    accessToken: idToken,
    refreshToken: nextRefreshToken,
    lastLoginAt: new Date(),
  };

  const user = existingUser
    ? await (async () => {
        if (existingUser.uid && existingUser.uid !== uid) {
          await Invoice.updateMany(
            { userId: existingUser.uid },
            { $set: { userId: uid } }
          );
        }

        return User.findByIdAndUpdate(
          existingUser._id,
          {
            $set: updatePayload,
            $unset: { providerId: "" },
          },
          { new: true }
        );
      })()
    : await User.create(updatePayload);

  return {
    user,
    uid,
    email,
    providerId,
  };
};
