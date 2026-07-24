import { NextRequest, NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import admin, { ensureFirebaseAdmin } from "@/lib/firebase-admin";

export type AuthErrorCode =
  | "AuthConfigurationError"
  | "EmailNotVerified"
  | "Unauthorized"
  | "AdminForbidden"
  | "Suspended";

/**
 * Typed authentication error. Replaces the previous pattern of throwing plain
 * Errors with sentinel message strings that were string-matched to pick a status
 * code — a rewording silently changed the HTTP response.
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;

  constructor(
    code: AuthErrorCode,
    status: number,
    message?: string,
    options?: { cause?: unknown }
  ) {
    super(message ?? code, options);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_MESSAGES: Record<AuthErrorCode, string> = {
  AuthConfigurationError: "Server authentication is misconfigured",
  EmailNotVerified: "Please verify your email before continuing.",
  Unauthorized: "Unauthorized",
  AdminForbidden: "You do not have permission to access this resource.",
  Suspended: "Your account has been suspended.",
};

/**
 * Verify the Firebase ID token on the Authorization header and return the uid.
 * The Firebase ID token is the real authorization for the API. Password-provider
 * accounts must have a verified email (matching the gate on the auth-mint routes).
 *
 * This is the single source of truth for request auth — import it; do not copy it.
 */
/**
 * Verify the Firebase ID token on the Authorization header and return the full
 * decoded token. Shared core for `requireUser` and `requireAdmin` (lib/server/
 * admin.ts) so there is exactly one token path.
 *
 * `checkRevoked: true` makes verification reject a token whose refresh tokens
 * were revoked or whose Firebase account was disabled — this is what lets
 * suspension take effect on the very next request, without a per-request DB read.
 */
export const verifyRequestToken = async (
  req: NextRequest
): Promise<DecodedIdToken> => {
  try {
    ensureFirebaseAdmin();
  } catch (error: unknown) {
    throw new AuthError("AuthConfigurationError", 500, undefined, {
      cause: error,
    });
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthError("Unauthorized", 401);
  }

  const token = authHeader.split("Bearer ")[1];

  let decodedToken: DecodedIdToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(token, true);
  } catch (error: unknown) {
    throw new AuthError("Unauthorized", 401, undefined, { cause: error });
  }

  if (!decodedToken.uid) {
    throw new AuthError("Unauthorized", 401);
  }

  if (
    decodedToken.firebase?.sign_in_provider === "password" &&
    !decodedToken.email_verified
  ) {
    throw new AuthError("EmailNotVerified", 403);
  }

  return decodedToken;
};

export const requireUser = async (req: NextRequest): Promise<string> => {
  const decodedToken = await verifyRequestToken(req);
  return decodedToken.uid;
};

/**
 * Map an error thrown by requireUser to a NextResponse. Routes may override the
 * user-facing copy per code (e.g. a route-specific EmailNotVerified message).
 */
export const authErrorResponse = (
  error: unknown,
  messages?: Partial<Record<AuthErrorCode, string>>
) => {
  if (error instanceof AuthError) {
    const message = messages?.[error.code] ?? DEFAULT_MESSAGES[error.code];
    return NextResponse.json({ error: message }, { status: error.status });
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
};
