import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { DecodedIdToken } from "firebase-admin/auth";

// Capture what queries/mutations the sync issues, without a real database.
let lastFindOneQuery: unknown = null;
let existingUserToReturn: Record<string, unknown> | null = null;
let lastWrittenPayload: Record<string, unknown> | null = null;
const updateManyCalls: unknown[][] = [];

const fakeUser = {
  findOne: mock(async (query: unknown) => {
    lastFindOneQuery = query;
    return existingUserToReturn;
  }),
  create: mock(async (payload: Record<string, unknown>) => {
    lastWrittenPayload = payload;
    return { _id: "new-id", ...payload };
  }),
  findByIdAndUpdate: mock(async (_id: unknown, update: { $set: unknown }) => {
    lastWrittenPayload = update.$set as Record<string, unknown>;
    return { _id, ...(update.$set as Record<string, unknown>) };
  }),
};

const fakeInvoice = {
  updateMany: mock(async (...args: unknown[]) => {
    updateManyCalls.push(args);
    return { modifiedCount: 0 };
  }),
};

mock.module("@/models/User", () => ({ default: fakeUser }));
mock.module("@/models/Invoice", () => ({ default: fakeInvoice }));
// The sync records a login activity via the real writer. Neutralize its DB deps
// so it stays harmless — do NOT mock @/lib/server/log itself, since Bun's global
// module mocks would leak an incomplete stub into the other suites.
mock.module("@/lib/mongodb", () => ({ default: async () => {} }));
mock.module("@/models/LogEntry", () => ({
  default: { create: async () => ({}) },
}));

const { syncUserWithMongo } = await import("@/lib/auth-user-sync");

const decoded = (over: Partial<DecodedIdToken> & { email_verified?: boolean }) =>
  ({
    uid: "attacker-uid",
    email: "victim@example.com",
    firebase: { sign_in_provider: "password", identities: {} },
    ...over,
  }) as unknown as DecodedIdToken;

beforeEach(() => {
  lastFindOneQuery = null;
  existingUserToReturn = null;
  lastWrittenPayload = null;
  updateManyCalls.length = 0;
});

describe("syncUserWithMongo — account-linking safety", () => {
  it("does NOT match by email when the token email is unverified (uid-only lookup)", async () => {
    await syncUserWithMongo({
      decodedToken: decoded({ email_verified: false }),
    });
    expect(lastFindOneQuery).toEqual({ uid: "attacker-uid" });
  });

  it("matches by uid OR email when the token email is verified", async () => {
    await syncUserWithMongo({
      decodedToken: decoded({ email_verified: true }),
    });
    expect(lastFindOneQuery).toEqual({
      $or: [{ uid: "attacker-uid" }, { email: "victim@example.com" }],
    });
  });

  it("never reassigns invoices for an unverified token even if a same-email row exists", async () => {
    // Even if a victim row shared the email, the unverified path looks up by uid
    // only, so it will not find (and therefore not adopt) the victim's account.
    existingUserToReturn = null; // uid-only lookup finds nothing
    await syncUserWithMongo({
      decodedToken: decoded({ email_verified: false }),
    });
    expect(updateManyCalls.length).toBe(0);
  });

  it("reassigns invoices only on a legitimate verified-email link with a changed uid", async () => {
    existingUserToReturn = {
      _id: "victim-row",
      uid: "victim-uid",
      email: "victim@example.com",
    };
    await syncUserWithMongo({
      decodedToken: decoded({ email_verified: true }),
    });
    expect(updateManyCalls[0]).toEqual([
      { userId: "victim-uid" },
      { $set: { userId: "attacker-uid" } },
    ]);
  });
});

describe("syncUserWithMongo — no Firebase token is ever persisted", () => {
  // A stored Firebase refresh token never expires, so a database dump would be a
  // permanent takeover kit. Nothing reads these back; they must not come back.
  it("omits accessToken/refreshToken when creating a user", async () => {
    await syncUserWithMongo({ decodedToken: decoded({ email_verified: true }) });

    expect(lastWrittenPayload).not.toBeNull();
    expect(Object.keys(lastWrittenPayload!)).not.toContain("accessToken");
    expect(Object.keys(lastWrittenPayload!)).not.toContain("refreshToken");
  });

  it("omits accessToken/refreshToken when updating an existing user", async () => {
    existingUserToReturn = {
      _id: "existing-row",
      uid: "attacker-uid",
      email: "victim@example.com",
      // A token banked by the old code must not be read forward into the write.
      refreshToken: "leftover-refresh-token",
    };

    await syncUserWithMongo({ decodedToken: decoded({ email_verified: true }) });

    expect(lastWrittenPayload).not.toBeNull();
    expect(Object.keys(lastWrittenPayload!)).not.toContain("accessToken");
    expect(Object.keys(lastWrittenPayload!)).not.toContain("refreshToken");
    expect(JSON.stringify(lastWrittenPayload)).not.toContain("leftover-refresh-token");
  });
});
