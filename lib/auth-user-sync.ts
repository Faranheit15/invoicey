import type { DecodedIdToken } from "firebase-admin/auth";
import User from "@/models/User";
import Invoice from "@/models/Invoice";
import { normalizeAvatarUrl, sanitizeProviderId } from "@/lib/user-profile";
import { recordActivity } from "@/lib/server/log";

/** Emails allowed to bootstrap as admin, from ADMIN_EMAILS (comma-separated). */
const getAdminEmailAllowlist = (): string[] =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

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

const normalizeProviderIds = (rawProviderIds: unknown, legacyProviderId: unknown): string[] => {
  const next = new Set<string>();

  if (Array.isArray(rawProviderIds)) {
    rawProviderIds.forEach((provider) => {
      const sanitized = sanitizeProviderId(provider);
      if (sanitized) {
        next.add(sanitized);
      }
    });
  }

  const legacyProvider = sanitizeProviderId(legacyProviderId);
  if (legacyProvider) {
    next.add(legacyProvider);
  }

  return Array.from(next);
};

const inferProviderIdFromToken = (decodedToken: DecodedIdToken): string | null => {
  const identities = decodedToken.firebase?.identities;
  if (!identities || typeof identities !== "object") {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(identities, "google.com")) {
    return "google.com";
  }
  if (Object.prototype.hasOwnProperty.call(identities, "email")) {
    return "password";
  }

  return null;
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

  // Only trust the token's email for account linking when Firebase has verified
  // it. Matching/merging by an unverified email would let a token carrying a
  // victim's email but a different uid adopt the victim's User row and trigger
  // the invoice reassignment below — a full account takeover. When the email is
  // unverified we match on uid only, so an attacker can never link into another
  // account (and the unique email index makes a duplicate create fail closed).
  const emailVerified = decodedToken.email_verified === true;

  // Bootstrap admins from the env allowlist, but ONLY when Firebase has verified
  // the token's email — the same trust boundary that prevents the email-based
  // account takeover below. This promotes only; role/status are never otherwise
  // written on login (kept out of updatePayload), so a normal sign-in can neither
  // wipe a panel-granted admin nor un-suspend a suspended user.
  const isBootstrapAdmin =
    emailVerified && getAdminEmailAllowlist().includes(email);
  const rolePatch = isBootstrapAdmin ? { role: "admin" as const } : {};

  const existingUser = (await User.findOne(
    emailVerified ? { $or: [{ uid }, { email }] } : { uid }
  )) as UserRecord | null;

  const existingProviderIds = normalizeProviderIds(
    existingUser?.providerIds,
    existingUser?.providerId
  );

  const providerId =
    sanitizeProviderId(decodedToken.firebase?.sign_in_provider) ||
    sanitizeProviderId(requestedProviderId) ||
    inferProviderIdFromToken(decodedToken) ||
    existingProviderIds[0] ||
    "password";

  const providerIds = Array.from(new Set([...existingProviderIds, providerId]));

  const nameFromToken =
    typeof decodedToken.name === "string" && decodedToken.name.trim()
      ? decodedToken.name.trim()
      : "";

  const nextName = nameFromToken || existingUser?.name || email.split("@")[0] || "User";

  const pictureFromToken =
    typeof decodedToken.picture === "string" && decodedToken.picture.trim()
      ? decodedToken.picture
      : null;
  const nextAvatar = normalizeAvatarUrl(pictureFromToken || existingUser?.avatar);

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
            $set: { ...updatePayload, ...rolePatch },
            $unset: { providerId: "" },
          },
          { new: true }
        );
      })()
    : await User.create({ ...updatePayload, ...rolePatch });

  // Fire-and-forget login activity; never blocks or fails the sign-in.
  recordActivity({ userId: uid, type: "login", meta: { providerId } });

  return {
    user,
    uid,
    email,
    providerId,
  };
};
