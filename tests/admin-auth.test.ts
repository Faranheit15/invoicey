import { describe, it, expect, mock, beforeEach } from "bun:test";

let decodedToReturn: Record<string, unknown> = { uid: "admin-uid" };
let userDoc: Record<string, unknown> | null = null;
let userCount = 0;

mock.module("@/lib/firebase-admin", () => ({
  default: { auth: () => ({ verifyIdToken: async () => decodedToReturn }) },
  ensureFirebaseAdmin: () => {},
}));
mock.module("@/lib/mongodb", () => ({ default: async () => {} }));
mock.module("@/models/User", () => ({
  default: {
    findOne: () => ({ lean: async () => userDoc }),
    countDocuments: async () => userCount,
  },
}));

const { requireAdmin, assertNotSelf, assertNotLastActiveAdmin } = await import(
  "@/lib/server/admin"
);
const { AuthError } = await import("@/lib/server/auth");

const req = {
  headers: {
    get: (k: string) => (k === "authorization" ? "Bearer x" : null),
  },
} as unknown as import("next/server").NextRequest;

beforeEach(() => {
  decodedToReturn = { uid: "admin-uid" };
  userDoc = null;
  userCount = 0;
});

describe("requireAdmin gate", () => {
  it("fails closed when the user has no DB row", async () => {
    userDoc = null;
    await expect(requireAdmin(req)).rejects.toMatchObject({
      code: "AdminForbidden",
      status: 403,
    });
  });

  it("rejects a non-admin", async () => {
    userDoc = { uid: "admin-uid", email: "u@x.com", role: "user", status: "active" };
    await expect(requireAdmin(req)).rejects.toMatchObject({
      code: "AdminForbidden",
    });
  });

  it("rejects a suspended admin", async () => {
    userDoc = {
      uid: "admin-uid",
      email: "u@x.com",
      role: "admin",
      status: "suspended",
    };
    await expect(requireAdmin(req)).rejects.toMatchObject({ code: "Suspended" });
  });

  it("allows an active admin", async () => {
    userDoc = { uid: "admin-uid", email: "u@x.com", role: "admin", status: "active" };
    const ctx = await requireAdmin(req);
    expect(ctx).toMatchObject({ uid: "admin-uid", role: "admin" });
  });

  it("treats a legacy row without role/status as a non-admin (fail closed)", async () => {
    userDoc = { uid: "admin-uid", email: "u@x.com" };
    await expect(requireAdmin(req)).rejects.toMatchObject({
      code: "AdminForbidden",
    });
  });
});

describe("admin mutation guards", () => {
  it("assertNotSelf refuses acting on your own account", () => {
    expect(() =>
      assertNotSelf(
        { uid: "me", email: "", role: "admin", status: "active" },
        "me"
      )
    ).toThrow();
  });

  it("assertNotLastActiveAdmin refuses demoting the last admin", async () => {
    userDoc = { role: "admin", status: "active" };
    userCount = 1;
    await expect(assertNotLastActiveAdmin("target")).rejects.toBeInstanceOf(
      AuthError
    );
  });

  it("assertNotLastActiveAdmin allows when other admins remain", async () => {
    userDoc = { role: "admin", status: "active" };
    userCount = 2;
    await expect(assertNotLastActiveAdmin("target")).resolves.toBeUndefined();
  });
});
