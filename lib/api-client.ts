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
 * The request never produced a response: the device is offline, DNS failed, or
 * the request exceeded REQUEST_TIMEOUT_MS. Distinct from ApiError, which means
 * the server answered and said no. Callers should offer a retry rather than
 * telling the user their input was wrong.
 */
export class NetworkError extends Error {
  readonly kind: "offline" | "timeout" | "unreachable";
  constructor(kind: "offline" | "timeout" | "unreachable") {
    super(kind);
    this.name = "NetworkError";
    this.kind = kind;
  }
}

/** Requests that outlive this are treated as a timeout, not a hang. */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Default copy for a non-OK response whose body carried no `error` string.
 * "Request failed." tells the user nothing they can act on; these do.
 */
const statusFallbackMessage = (status: number): string => {
  if (status === 400 || status === 422) {
    return "Some details were rejected. Check the highlighted fields and try again.";
  }
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "That invoice no longer exists. It may have been deleted.";
  if (status === 409) {
    return "This invoice changed somewhere else. Reload to get the latest version.";
  }
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status >= 500) return "Something broke on our side. Try again in a moment.";
  return "Request failed.";
};

/**
 * Turn any thrown value from an API call into copy a user can act on, plus
 * whether retrying the same request could plausibly succeed. Components render
 * this instead of hand-writing a per-call fallback string.
 */
export const describeRequestError = (
  error: unknown,
  fallback: string
): { message: string; canRetry: boolean } => {
  if (error instanceof NetworkError) {
    if (error.kind === "offline") {
      return {
        message: "You appear to be offline. Your work is still here — reconnect and try again.",
        canRetry: true,
      };
    }
    if (error.kind === "timeout") {
      return { message: "The server took too long to respond.", canRetry: true };
    }
    return { message: "Couldn't reach the server.", canRetry: true };
  }
  if (error instanceof ApiError) {
    return { message: error.message, canRetry: error.status === 429 || error.status >= 500 };
  }
  return { message: fallback, canRetry: true };
};

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

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // fetch only rejects when no response was produced at all. Everything the
    // server actually answered — including 500s — lands below as an ApiError.
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new NetworkError("timeout");
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new NetworkError("offline");
    }
    throw new NetworkError("unreachable");
  }

  const data = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : statusFallbackMessage(response.status);
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
