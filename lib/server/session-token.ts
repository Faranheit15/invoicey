import { SignJWT } from "jose";

/**
 * Session token minting, shared by the auth-mint routes.
 *
 * Uses `jose` (not `jsonwebtoken`) because jsonwebtoken's CommonJS module graph
 * fails to evaluate under Next 16's server bundler ("Cannot read properties of
 * undefined (reading 'prototype')"), breaking the auth routes and `next build`.
 * jose is ESM-native and bundler/edge-friendly.
 *
 * NOTE: this HS256 token is stored client-side but is NOT verified server-side —
 * the Firebase ID token is the real authorization. It is retained for response
 * shape compatibility.
 */

const getJwtSecret = (): Uint8Array => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Missing JWT_SECRET");
  }
  return new TextEncoder().encode(secret);
};

export interface SessionTokenClaims {
  uid: string;
  email: string;
}

export const signSessionToken = async (
  claims: SessionTokenClaims
): Promise<string> => {
  return new SignJWT({ uid: claims.uid, email: claims.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());
};
