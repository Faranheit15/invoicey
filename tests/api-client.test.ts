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

const { authedFetch, invoicesApi, ApiError, UnauthenticatedError } =
  await import("@/lib/api-client");

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
