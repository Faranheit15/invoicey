import { loadFirebaseAuth } from "@/lib/firebase-lazy";
import { requiresEmailVerification } from "@/lib/auth-client";
import type { User } from "firebase/auth";
import type { InvoiceRecord, InvoicePayload } from "@/lib/invoices";
import type { ClientDirectoryResponse } from "@/lib/clients";
// Type-only, like the BusinessProfile import below: the route module it lives
// in pulls mongoose, and a value import would ship the driver to the browser.
import type { InvoiceNumberSuggestion } from "@/app/api/invoices/route";
import type { ClientEventInput } from "@/lib/logs";
import type { FeedbackInput, FeedbackRecord } from "@/lib/feedback";
// `import type` is load-bearing: @/models/BusinessProfile imports mongoose, and
// a value import here would pull the driver into the browser bundle. The type
// is erased at compile time, so nothing ships.
import type { BusinessProfileFields } from "@/models/BusinessProfile";
import type {
  AdminMe,
  AdminOverview,
  AdminUsersResponse,
  AdminUserDetail,
  AdminInvoicesResponse,
  AdminActivityResponse,
  AdminLogsResponse,
  AdminActionResponse,
  AdminFeedbackResponse,
} from "@/lib/admin-types";

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
  const { auth } = await loadFirebaseAuth();
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
  /**
   * One page of the list, with the matching total. The route only paginates
   * when `page`/`limit` are present, so `list()` above keeps its array shape.
   */
  page: (params: QueryParams = {}) =>
    authedFetch<{
      invoices: InvoiceRecord[];
      page: number;
      limit: number;
      total: number;
    }>(`/api/invoices${buildQuery(params)}`),
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
  /**
   * The next number in this user's series for the financial year `date` falls
   * in. Read-only — nothing is written and no counter moves, so calling it for
   * a draft the user then abandons leaves no gap in the series.
   */
  suggestNumber: (date?: string) =>
    authedFetch<InvoiceNumberSuggestion>(
      `/api/invoices${buildQuery({ suggest_number: 1, date })}`
    ),
};

/**
 * The clients this user has invoiced, derived from their own invoice history.
 *
 * Read-only by design: there is no clients collection to write to. See
 * `lib/clients.ts`. `q` filters, `page`/`limit` paginate (the endpoint clamps
 * both), and the response says when the scan window truncated the directory.
 */
export const clientsApi = {
  list: (params: QueryParams = {}) =>
    authedFetch<ClientDirectoryResponse>(`/api/clients${buildQuery(params)}`),
};

export const aiApi = {
  assist: <T>(body: unknown) =>
    authedFetch<T>("/api/ai/invoice-assistant", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

/** Build a query string, dropping empty/undefined values. */
export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export const buildQuery = (params: QueryParams = {}): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
};

/**
 * A file-returning authed request (admin exports). Same auth/timeout/error
 * handling as authedFetch, but resolves the response body as a Blob and reads
 * the download filename from Content-Disposition.
 */
export const authedFetchBlob = async (
  path: string
): Promise<{ blob: Blob; filename: string }> => {
  const token = await getAuthToken();

  let response: Response;
  try {
    response = await fetch(path, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new NetworkError("timeout");
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new NetworkError("offline");
    }
    throw new NetworkError("unreachable");
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as unknown;
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : statusFallbackMessage(response.status);
    throw new ApiError(message, response.status);
  }

  const disposition = response.headers.get("Content-Disposition") || "";
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] || "export";
  const blob = await response.blob();
  return { blob, filename };
};

export type UserAction = "promote" | "revoke" | "suspend" | "unsuspend";

export const adminApi = {
  me: () => authedFetch<AdminMe>("/api/admin/me"),
  overview: () => authedFetch<AdminOverview>("/api/admin/overview"),
  users: (params: QueryParams = {}) =>
    authedFetch<AdminUsersResponse>(`/api/admin/users${buildQuery(params)}`),
  user: (uid: string, params: QueryParams = {}) =>
    authedFetch<AdminUserDetail>(
      `/api/admin/users/${encodeURIComponent(uid)}${buildQuery(params)}`
    ),
  invoices: (params: QueryParams = {}) =>
    authedFetch<AdminInvoicesResponse>(`/api/admin/invoices${buildQuery(params)}`),
  activity: (params: QueryParams = {}) =>
    authedFetch<AdminActivityResponse>(`/api/admin/activity${buildQuery(params)}`),
  logs: (params: QueryParams = {}) =>
    authedFetch<AdminLogsResponse>(`/api/admin/logs${buildQuery(params)}`),
  userAction: (uid: string, action: UserAction) =>
    authedFetch<AdminActionResponse>(
      `/api/admin/users/${encodeURIComponent(uid)}`,
      { method: "PATCH", body: JSON.stringify({ action }) }
    ),
  invoiceAction: (
    id: string,
    body: { action?: "soft_delete" | "restore"; status?: string }
  ) =>
    authedFetch<AdminActionResponse>(
      `/api/admin/invoices/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),
  exportUsers: (format: "csv" | "json") =>
    authedFetchBlob(`/api/admin/export/users${buildQuery({ format })}`),
  exportInvoices: (format: "csv" | "json") =>
    authedFetchBlob(`/api/admin/export/invoices${buildQuery({ format })}`),
  feedback: (params: QueryParams = {}) =>
    authedFetch<AdminFeedbackResponse>(`/api/admin/feedback${buildQuery(params)}`),
  feedbackAction: (id: string, status: string) =>
    authedFetch<AdminActionResponse>(
      `/api/admin/feedback/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ status }) }
    ),
};

export interface AccountSummary {
  email: string;
  counts: {
    invoices: number;
    deletedInvoices: number;
    feedback: number;
    activity: number;
  };
}

export interface AccountDeleteResult {
  deleted: {
    invoices: number;
    feedback: number;
    activityAnonymised: number;
  };
}

/**
 * Account-level data-subject actions: take your data, or destroy the account.
 *
 * `exportData` goes through `authedFetchBlob` (the same path the admin exports
 * use) because the response is a file, not JSON to render. `deleteAccount`
 * sends the typed confirmation for the SERVER to check — the dialog's own check
 * only guards a button, and the button is not what deletes the account.
 */
export const accountApi = {
  summary: () => authedFetch<AccountSummary>("/api/account"),
  exportData: (format: "json" | "csv") =>
    authedFetchBlob(`/api/account/export${buildQuery({ format })}`),
  deleteAccount: (confirmEmail: string) =>
    authedFetch<AccountDeleteResult>("/api/account", {
      method: "DELETE",
      body: JSON.stringify({ confirmEmail }),
    }),
};

/**
 * The saved seller-side details that seed every new invoice.
 *
 * `Required<...>` because the route always answers with every key present —
 * including for a user who has never saved one — so the UI binds straight to
 * these fields with no `?? ""` at every input.
 */
export type BusinessProfile = Required<BusinessProfileFields>;

export interface BusinessProfileResponse {
  profile: BusinessProfile;
  /** false when the user has never saved a profile. Shape is identical either way. */
  exists: boolean;
}

export interface SaveBusinessProfileResponse extends BusinessProfileResponse {
  message: string;
}

/**
 * Read and write the business profile. `save` is a PUT upsert: there is exactly
 * one profile per user, so there is no create-vs-update for a caller to choose
 * between, and `get` never 404s on a user who has not saved one yet.
 */
export const profileApi = {
  get: () => authedFetch<BusinessProfileResponse>("/api/profile"),
  save: (profile: BusinessProfile) =>
    authedFetch<SaveBusinessProfileResponse>("/api/profile", {
      method: "PUT",
      body: JSON.stringify(profile),
    }),
};

export const feedbackApi = {
  submit: (input: FeedbackInput) =>
    authedFetch<{ message: string; feedback: FeedbackRecord }>("/api/feedback", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listOwn: () => authedFetch<{ feedback: FeedbackRecord[] }>("/api/feedback"),
};

/**
 * Fire-and-forget client telemetry beacon. Never throws, never blocks the UI —
 * failures (offline, signed-out, server down) are swallowed. `keepalive` lets it
 * survive a navigation/unload while still carrying the Firebase bearer header
 * (navigator.sendBeacon cannot set headers).
 */
export const eventsApi = {
  emit: (input: ClientEventInput): void => {
    void (async () => {
      try {
        const token = await getAuthToken();
        await fetch("/api/events", {
          method: "POST",
          keepalive: true,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
        });
      } catch {
        // best-effort telemetry: swallow everything.
      }
    })();
  },
};
