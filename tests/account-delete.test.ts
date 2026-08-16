import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  REAUTH_MAX_AGE_SECONDS,
  confirmationMatches,
  isReauthFresh,
  pseudonymizeUid,
} from "@/lib/server/account-delete";

/**
 * Account deletion is the only irreversible action in the product, so the two
 * things that can go wrong are "it happened by accident" and "it happened to
 * someone who was not there". These are the rules that stop each.
 */

const NOW = Date.parse("2026-08-17T12:00:00.000Z");
const secondsAgo = (n: number) => NOW / 1000 - n;

describe("re-authentication freshness", () => {
  it("accepts a sign-in from moments ago", () => {
    expect(isReauthFresh(secondsAgo(5), NOW)).toBe(true);
  });

  it("accepts one exactly at the boundary", () => {
    expect(isReauthFresh(secondsAgo(REAUTH_MAX_AGE_SECONDS), NOW)).toBe(true);
  });

  it("rejects a session that last proved identity six minutes ago", () => {
    expect(isReauthFresh(secondsAgo(REAUTH_MAX_AGE_SECONDS + 1), NOW)).toBe(false);
  });

  it("rejects a long-lived stolen session, however fresh its ID token is", () => {
    // auth_time does NOT advance on a silent token refresh — that is the whole
    // reason it is the signal being checked.
    expect(isReauthFresh(secondsAgo(60 * 60 * 24 * 30), NOW)).toBe(false);
  });

  it("rejects a missing or non-numeric auth_time rather than defaulting open", () => {
    expect(isReauthFresh(undefined, NOW)).toBe(false);
    expect(isReauthFresh(null, NOW)).toBe(false);
    expect(isReauthFresh("1755432000", NOW)).toBe(false);
    expect(isReauthFresh(Number.NaN, NOW)).toBe(false);
  });

  it("rejects an absurd future auth_time", () => {
    expect(isReauthFresh(secondsAgo(-3600), NOW)).toBe(false);
  });
});

describe("typed-email confirmation", () => {
  it("accepts the exact address", () => {
    expect(confirmationMatches("a@example.com", "a@example.com")).toBe(true);
  });

  it("tolerates case and surrounding whitespace, which are not the mistake", () => {
    expect(confirmationMatches("  A@Example.COM ", "a@example.com")).toBe(true);
  });

  it("rejects a different account's address", () => {
    expect(confirmationMatches("b@example.com", "a@example.com")).toBe(false);
  });

  it("rejects a near miss", () => {
    expect(confirmationMatches("a@exampl.com", "a@example.com")).toBe(false);
    expect(confirmationMatches("a@example.co", "a@example.com")).toBe(false);
  });

  it("rejects a missing, empty, or non-string confirmation", () => {
    expect(confirmationMatches(undefined, "a@example.com")).toBe(false);
    expect(confirmationMatches("", "a@example.com")).toBe(false);
    expect(confirmationMatches("   ", "a@example.com")).toBe(false);
    expect(confirmationMatches(123, "a@example.com")).toBe(false);
    expect(confirmationMatches({}, "a@example.com")).toBe(false);
  });

  it("rejects everything when the token carries no email", () => {
    // Two empty strings must not compare equal into a deletion.
    expect(confirmationMatches("", undefined)).toBe(false);
    expect(confirmationMatches("", "")).toBe(false);
    expect(confirmationMatches("anything", undefined)).toBe(false);
  });
});

describe("audit pseudonym", () => {
  const previousSalt = process.env.ACCOUNT_AUDIT_SALT;
  const previousJwt = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.ACCOUNT_AUDIT_SALT = "test-salt";
  });

  afterEach(() => {
    if (previousSalt === undefined) delete process.env.ACCOUNT_AUDIT_SALT;
    else process.env.ACCOUNT_AUDIT_SALT = previousSalt;
    if (previousJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwt;
  });

  it("never contains the uid it stands for", () => {
    const uid = "firebase-uid-12345";
    expect(pseudonymizeUid(uid)).not.toContain(uid);
  });

  it("is stable, so two support tickets can be correlated", () => {
    expect(pseudonymizeUid("user-A")).toBe(pseudonymizeUid("user-A"));
  });

  it("distinguishes two accounts", () => {
    expect(pseudonymizeUid("user-A")).not.toBe(pseudonymizeUid("user-B"));
  });

  it("changes with the salt, so it cannot be recomputed without the key", () => {
    const withOne = pseudonymizeUid("user-A");
    process.env.ACCOUNT_AUDIT_SALT = "different-salt";
    expect(pseudonymizeUid("user-A")).not.toBe(withOne);
  });

  it("falls back to JWT_SECRET rather than emitting an unsalted digest", () => {
    delete process.env.ACCOUNT_AUDIT_SALT;
    process.env.JWT_SECRET = "jwt-secret-value";
    expect(pseudonymizeUid("user-A")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("refuses to emit a reversible digest when no key exists at all", () => {
    delete process.env.ACCOUNT_AUDIT_SALT;
    delete process.env.JWT_SECRET;
    expect(pseudonymizeUid("user-A")).toBe("unsalted");
  });
});
