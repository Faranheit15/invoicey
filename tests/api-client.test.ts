import { describe, it, expect, mock, beforeEach } from "bun:test";

// The API client depends on the Firebase singleton and the DOM fetch. Mock both
// so we can assert token attachment, readiness gating, and error mapping.
let currentUser: { getIdToken: () => Promise<string> } | null = null;
let needsVerification = false;

const fakeAuth = {
  authStateReady: async () => {},
  get currentUser() {
    return currentUser;
  },
};

mock.module("@/lib/firebase", () => ({ auth: fakeAuth }));
mock.module("@/lib/auth-client", () => ({
  requiresEmailVerification: () => needsVerification,
}));

const {
  authedFetch,
  invoicesApi,
  ApiError,
  UnauthenticatedError,
  NetworkError,
  describeRequestError,
} = await import("@/lib/api-client");

const okUser = { getIdToken: async () => "id-token-123" };

let fetchMock: ReturnType<typeof mock>;

beforeEach(() => {
  currentUser = okUser;
  needsVerification = false;
  fetchMock = mock(
    async () =>
      new Response(JSON.stringify([{ _id: "1" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe("authedFetch", () => {
  it("attaches the bearer token and returns parsed JSON on success", async () => {
    const data = await invoicesApi.list();
    expect(data).toHaveLength(1);
    expect((data[0] as { _id: string })._id).toBe("1");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer id-token-123");
  });

  it("throws a typed ApiError with the server message on a non-OK response", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ error: "Invoice not found" }), {
          status: 404,
        })
    ) as unknown as typeof fetch;

    expect(invoicesApi.get("missing")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "Invoice not found",
    });
  });

  it("throws UnauthenticatedError(signed-out) when there is no user after readiness", async () => {
    currentUser = null;
    expect(authedFetch("/api/invoices")).rejects.toBeInstanceOf(
      UnauthenticatedError
    );
    await authedFetch("/api/invoices").catch((e) => {
      expect((e as { reason: string }).reason).toBe("signed-out");
    });
  });

  it("throws UnauthenticatedError(verify-email) when the user must verify", async () => {
    needsVerification = true;
    await authedFetch("/api/invoices").catch((e) => {
      expect(e).toBeInstanceOf(UnauthenticatedError);
      expect((e as { reason: string }).reason).toBe("verify-email");
    });
  });

  it("does not throw ApiError for a 200 (sanity on the success path)", async () => {
    const result = await authedFetch("/api/invoices");
    expect(result).toBeDefined();
    expect(ApiError).toBeDefined();
  });
});

describe("invoicesApi.page", () => {
  /**
   * `list()` and `page()` hit the SAME url; the route only paginates when
   * `page`/`limit` are present. So the two must not converge: a `page()` that
   * forgot its params would silently get the unpaginated array back and hand
   * the table `res.invoices === undefined`.
   */
  it("sends the paging, sort and filter params as a query string", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({ invoices: [{ _id: "1" }], page: 2, limit: 25, total: 51 }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    ) as unknown as typeof fetch;

    const body = await invoicesApi.page({
      page: 2,
      limit: 25,
      sort: "dueDate",
      order: "asc",
      q: "Nova",
      status: "overdue",
    });

    expect(body.total).toBe(51);
    expect(body.invoices).toHaveLength(1);

    const [url] = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock
      .calls[0] as [string];
    const query = new URL(url, "http://localhost").searchParams;
    expect(url.startsWith("/api/invoices?")).toBe(true);
    expect(query.get("page")).toBe("2");
    expect(query.get("limit")).toBe("25");
    expect(query.get("sort")).toBe("dueDate");
    expect(query.get("order")).toBe("asc");
    expect(query.get("q")).toBe("Nova");
    expect(query.get("status")).toBe("overdue");
  });

  it("drops empty values rather than sending blanks", async () => {
    await invoicesApi.page({ page: 1, q: "", status: undefined });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/invoices?page=1");
  });
});

describe("network failures", () => {
  // fetch only rejects when no response was produced. Those cases used to
  // escape as a raw TypeError, so every `instanceof ApiError` check missed and
  // the user got a generic message that blamed their input.
  it("maps a rejected fetch to NetworkError, not ApiError", async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    const error = await authedFetch("/api/invoices").catch((e) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(ApiError);
  });

  it("maps an aborted request to NetworkError(timeout)", async () => {
    globalThis.fetch = mock(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as unknown as typeof fetch;

    const error = await authedFetch("/api/invoices").catch((e) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as { kind: string }).kind).toBe("timeout");
  });

  it("attaches an abort signal so a request cannot hang forever", async () => {
    await invoicesApi.list();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeDefined();
  });
});

describe("statusFallbackMessage (via ApiError)", () => {
  const respondWith = (status: number, body: unknown = null) => {
    globalThis.fetch = mock(
      async () => new Response(body ? JSON.stringify(body) : "", { status })
    ) as unknown as typeof fetch;
  };

  it("prefers the server's own error string over any fallback", async () => {
    respondWith(400, { error: "Invoice number already exists" });
    const error = await authedFetch("/api/invoices").catch((e) => e);
    expect((error as Error).message).toBe("Invoice number already exists");
  });

  it("substitutes actionable copy when the body carries no error string", async () => {
    respondWith(500);
    const error = await authedFetch("/api/invoices").catch((e) => e);
    expect((error as Error).message).toContain("our side");
    expect((error as Error).message).not.toBe("Request failed.");
  });

  it("distinguishes 404 from a generic failure", async () => {
    respondWith(404);
    const error = await authedFetch("/api/invoices").catch((e) => e);
    expect((error as Error).message).toContain("no longer exists");
  });
});

describe("describeRequestError", () => {
  it("offers a retry for offline, and says the work is still there", () => {
    const result = describeRequestError(new NetworkError("offline"), "fallback");
    expect(result.canRetry).toBe(true);
    expect(result.message).toContain("offline");
  });

  it("offers a retry for 5xx but not for a validation rejection", () => {
    expect(describeRequestError(new ApiError("boom", 500), "f").canRetry).toBe(true);
    expect(describeRequestError(new ApiError("bad field", 400), "f").canRetry).toBe(
      false
    );
  });

  it("passes the server message straight through for an ApiError", () => {
    const result = describeRequestError(new ApiError("Invoice not found", 404), "f");
    expect(result.message).toBe("Invoice not found");
  });

  it("falls back to the caller's copy for an unrecognized throw", () => {
    const result = describeRequestError(new Error("???"), "Couldn't save this invoice.");
    expect(result.message).toBe("Couldn't save this invoice.");
  });
});
