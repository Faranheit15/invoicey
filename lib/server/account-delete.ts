/**
 * The decision rules for irreversible account deletion, kept pure so they can
 * be tested without a database, a Firebase project, or a request.
 *
 * Account deletion is the single surface in this product allowed to destroy
 * data permanently (PRODUCT.md). "Nothing is ever hard-deleted" still governs
 * the invoice lifecycle; it does not govern the DPDP right of erasure, which a
 * soft delete does not satisfy. Everything here exists to make sure that the
 * one irreversible action is never taken by accident or by a stolen session.
 */

import { createHmac } from "node:crypto";

/**
 * How recently the user must have actually proved who they are.
 *
 * `auth_time` is the moment of the real sign-in and does NOT advance on a
 * silent token refresh — which is exactly what makes it the right signal here.
 * A months-old session that keeps minting fresh ID tokens still carries its
 * original `auth_time`, so a stolen session cannot delete an account; the
 * thief would have to pass the actual credential challenge again.
 */
export const REAUTH_MAX_AGE_SECONDS = 300;

export const isReauthFresh = (
  authTimeSeconds: unknown,
  nowMs: number = Date.now()
): boolean => {
  if (typeof authTimeSeconds !== "number" || !Number.isFinite(authTimeSeconds)) {
    return false;
  }
  const ageSeconds = nowMs / 1000 - authTimeSeconds;
  // A negative age means a clock skew, not a fresh login. Allow a small skew
  // window rather than rejecting outright, but never an unbounded future value.
  if (ageSeconds < -REAUTH_MAX_AGE_SECONDS) return false;
  return ageSeconds <= REAUTH_MAX_AGE_SECONDS;
};

/**
 * The typed confirmation. The user types their own email address, not the word
 * "DELETE": typing your own address makes you read WHICH account is about to
 * go, which is the mistake a generic confirmation word cannot catch.
 *
 * Checked here, on the server, against the email in the verified ID token — a
 * dialog that only guards the button guards nothing, because the button is not
 * what deletes the account.
 */
export const confirmationMatches = (
  typed: unknown,
  tokenEmail: unknown
): boolean => {
  if (typeof typed !== "string" || typeof tokenEmail !== "string") return false;
  const a = typed.trim().toLowerCase();
  const b = tokenEmail.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b;
};

/**
 * A stable, non-reversible handle for a uid that has been erased.
 *
 * THE PROBLEM THIS SOLVES. An audit trail that outlives the deletion and still
 * carries the uid or the email partially defeats the erasure it is recording —
 * the row is the identifier. But an audit trail with nothing in it cannot
 * answer "was an account deleted on this date, and is this support ticket the
 * same person as that one". The HMAC gives correlation without
 * re-identification: it cannot be reversed to a uid, and it cannot be
 * recomputed by anyone who does not hold the key.
 *
 * Truncated to 16 hex chars — enough to correlate two support tickets, short
 * enough that it is obviously not the identifier itself.
 */
export const pseudonymizeUid = (uid: string): string => {
  // A dedicated ACCOUNT_AUDIT_SALT is preferred; JWT_SECRET is the fallback
  // because it is already required in every deployment, so this can never
  // degrade to an unsalted (and therefore trivially reversible) digest.
  const key = process.env.ACCOUNT_AUDIT_SALT?.trim() || process.env.JWT_SECRET;
  if (!key) {
    // No key means no honest pseudonym. Say so rather than emitting a bare
    // SHA-256 of the uid, which a rainbow table over the uid space reverses.
    return "unsalted";
  }
  return createHmac("sha256", key).update(uid).digest("hex").slice(0, 16);
};
