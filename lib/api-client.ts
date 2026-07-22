import { auth } from "@/lib/firebase";
import { requiresEmailVerification } from "@/lib/auth-client";
import type { User } from "firebase/auth";
import type { InvoiceRecord, InvoicePayload } from "@/lib/invoices";

/**
 * A non-OK API response. `status` is the HTTP status; `message` is the server's
 * `error` string (or a generic fallback).
 */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * There is no usable authenticated session. Callers should redirect to /auth.
 * `reason` distinguishes a signed-out user from one who must verify their email.
 */
export class UnauthenticatedError extends Error {
  readonly reason: "signed-out" | "verify-email";
  constructor(reason: "signed-out" | "verify-email") {
    super(reason);
    this.name = "UnauthenticatedError";
    this.reason = reason;
  }
}

/**
 * Resolve the current Firebase user AFTER session restoration has completed.
 *
 * Reading `auth.currentUser` synchronously (e.g. in an effect that runs on
 * mount) returns null until Firebase re-hydrates the persisted session, which
 * previously bounced logged-in users to /auth on a hard refresh. `authStateReady`
 * waits for that restoration to finish first.
 */
const getReadyUser = async (): Promise<User> => {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) {
    throw new UnauthenticatedError("signed-out");
  }
  if (requiresEmailVerification(user)) {
    throw new UnauthenticatedError("verify-email");
  }
  return user;
};

/** Acquire a fresh Firebase ID token for the ready, verified user. */
export const getAuthToken = async (): Promise<string> => {
  const user = await getReadyUser();
  return user.getIdToken();
};

/**
 * Single authenticated fetch used by every client API call: waits for auth
 * readiness, attaches the Bearer token, sets a JSON content-type when a body is
 * present, and converts a non-OK response into a typed ApiError.
 */
export const authedFetch = async <T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const token = await getAuthToken();

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });
  const data = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : "Request failed.";
    throw new ApiError(message, response.status);
  }

  return data as T;
};

const withId = (path: string, id: string) =>
  `${path}?id=${encodeURIComponent(id)}`;

export interface SaveInvoiceResponse {
  message: string;
  invoice: InvoiceRecord;
}

export const invoicesApi = {
  list: () => authedFetch<InvoiceRecord[]>("/api/invoices"),
  get: (id: string) => authedFetch<InvoiceRecord>(withId("/api/invoices", id)),
  create: (payload: InvoicePayload) =>
    authedFetch<SaveInvoiceResponse>("/api/invoices", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  update: (id: string, payload: InvoicePayload) =>
    authedFetch<SaveInvoiceResponse>(withId("/api/invoices", id), {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  patch: (id: string, body: Record<string, string>) =>
    authedFetch<{ message: string }>(withId("/api/invoices", id), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};

export const aiApi = {
  assist: <T>(body: unknown) =>
    authedFetch<T>("/api/ai/invoice-assistant", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
