"use client";

import Cookies from "js-cookie";
import { normalizeAvatarUrl, sanitizeProviderId } from "@/lib/user-profile";
import { clearAllInvoiceDrafts } from "@/lib/invoice-draft";

interface UserData {
  uid: string;
  email: string;
  name: string;
  photoURL: string;
  providerIds: string[];
  role?: "user" | "admin";
}

interface LegacyUserData extends Omit<UserData, "providerIds"> {
  providerId?: string;
}

// Keys this app no longer writes. The Firebase ID and refresh tokens used to be
// mirrored here in JS-readable cookies; dropping the writer does not drop the
// cookie a returning browser already holds, and a Firebase refresh token never
// expires on its own. Purged on every construction so the first page a returning
// user opens destroys the leftover.
const LEGACY_TOKEN_KEYS = ["access-token", "refresh-token"];

export default class UserSessionManager {
  private keys = {
    sessionToken: "session-token",
    sessionId: "session-id",
    username: "username",
    userId: "user-id",
    user: "user",
  };

  constructor() {
    this.purgeLegacyTokens();
  }

  get sessionToken(): string | null {
    return Cookies.get(this.keys.sessionToken) || null;
  }
  set sessionToken(value: string | null) {
    if (value) {
      Cookies.set(this.keys.sessionToken, value, { secure: true, sameSite: "Strict" });
    } else {
      Cookies.remove(this.keys.sessionToken);
    }
  }

  // Access token using Cookies
  get sessionId(): string | null {
    return Cookies.get(this.keys.sessionId) || null;
  }
  set sessionId(value: string | null) {
    if (value) {
      Cookies.set(this.keys.sessionId, value, { secure: true, sameSite: "Strict" });
    } else {
      Cookies.remove(this.keys.sessionId);
    }
  }

  // Other fields remain in localStorage
  get username(): string | null {
    return this.getItem<string>(this.keys.username);
  }
  set username(value: string | null) {
    this.setItem(this.keys.username, value);
  }

  get userId(): number | null {
    return this.getItem<number>(this.keys.userId);
  }
  set userId(value: number | null) {
    this.setItem(this.keys.userId, value);
  }

  get user(): UserData | null {
    const value = this.getItem<UserData | LegacyUserData>(this.keys.user);
    if (!value) {
      return null;
    }

    const providerIds = Array.isArray((value as UserData).providerIds)
      ? (value as UserData).providerIds
          .map((providerId) => sanitizeProviderId(providerId))
          .filter((providerId): providerId is string => Boolean(providerId))
      : typeof (value as LegacyUserData).providerId === "string" &&
          sanitizeProviderId((value as LegacyUserData).providerId)
        ? [sanitizeProviderId((value as LegacyUserData).providerId)!]
        : [];

    return {
      uid: value.uid,
      email: value.email,
      name: value.name,
      photoURL: normalizeAvatarUrl(value.photoURL),
      providerIds: Array.from(new Set(providerIds)),
      role: (value as UserData).role,
    };
  }
  set user(value: UserData | null) {
    if (value) {
      value.photoURL = normalizeAvatarUrl(value.photoURL);
      this.setItem(this.keys.user, value);
    } else {
      this.clearLocal();
    }
  }

  // Internal methods for localStorage
  private setItem<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.log("An error occurred while setting localStorage item:", e);
    }
  }

  private getItem<T>(key: string): T | null {
    try {
      const value = localStorage.getItem(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch (e) {
      console.log("An error occurred while getting localStorage item:", e);
      return null;
    }
  }

  // Guarded on `document` because client components still render on the server
  // during SSR, where js-cookie and localStorage are unavailable.
  private purgeLegacyTokens(): void {
    if (typeof document === "undefined") {
      return;
    }

    LEGACY_TOKEN_KEYS.forEach((key) => {
      Cookies.remove(key);
      if (typeof localStorage === "undefined") {
        return;
      }
      try {
        localStorage.removeItem(key);
      } catch (e) {
        console.log("An error occurred while purging a legacy token key:", e);
      }
    });
  }

  // Clear all localStorage and cookies
  clearLocal = () => {
    // Explicit, and FIRST: an editor draft holds the client's name, email,
    // billing address and amounts — DPDP personal data sitting unencrypted on a
    // possibly shared machine. `localStorage.clear()` below happens to remove
    // them today, but an incidental clear is one refactor away from a privacy
    // regression, so the guarantee is stated rather than inherited.
    try {
      clearAllInvoiceDrafts(localStorage);
    } catch (e) {
      console.log("An error occurred while clearing invoice drafts:", e);
    }
    localStorage.clear();
    Cookies.remove(this.keys.sessionId);
    Cookies.remove(this.keys.sessionToken);
    this.purgeLegacyTokens();
  };
}
