import { describe, it, expect, mock, beforeEach } from "bun:test";
import { NextResponse } from "next/server";
import * as realAuth from "@/lib/server/auth";

/**
 * Tenant isolation for the two account-level routes.
 *
 * The export reads a whole tenant unpaginated and the delete destroys one, so
 * "which tenant" is the only question that matters here. Both routes take the
 * uid from the verified token and never from the request — these tests seed two
 * users into every collection and assert that A's request touches exactly A.
 *
 * The durable export quota is turned off (it counts LogEntry rows, and the
 * fake store would otherwise exhaust A's daily allowance mid-file); it has its
 * own logic and is not what is under test here.
 */
process.env.ACCOUNT_EXPORT_DAILY_LIMIT = "0";
process.env.ACCOUNT_AUDIT_SALT = "test-salt";

type Doc = Record<string, unknown>;

/** The decoded token the mocked auth helper hands back. Mutated per test. */
let currentToken: Doc = {};

// Bun's mock.module is process-global and replaces the WHOLE module, so a
// factory returning only the exports this file overrides would make every other
// export vanish for every suite that runs afterwards. Spread the real module.
mock.module("@/lib/server/auth", () => ({
  ...realAuth,
  requireUser: async () => currentToken.uid as string,
  verifyRequestToken: async () => currentToken,
  authErrorResponse: () =>
    NextResponse.json({ error: "unauthorized" }, { status: 401 }),
}));
mock.module("@/lib/mongodb", () => ({ default: async () => {} }));

const deletedFirebaseUids: string[] = [];
let firebaseDeleteError: (Error & { code?: string }) | null = null;
// The real module exports exactly these two names.
mock.module("@/lib/firebase-admin", () => ({
  default: {
    auth: () => ({
      deleteUser: async (uid: string) => {
        if (firebaseDeleteError) throw firebaseDeleteError;
        deletedFirebaseUids.push(uid);
      },
    }),
  },
  ensureFirebaseAdmin: () => {},
}));

/** Minimal filter matcher: equality plus the `$gte` the quota count uses. */
const matches = (doc: Doc, filter: Doc): boolean => {
  for (const [key, value] of Object.entries(filter)) {
    if (value && typeof value === "object" && "$gte" in (value as Doc)) {
      const at = new Date(doc[key] as string).getTime();
      if (!(at >= new Date((value as { $gte: Date }).$gte).getTime())) return false;
    } else if (doc[key] !== value) {
      return false;
    }
  }
  return true;
};

interface FakeModel {
  rows: Doc[];
  findFilters: Doc[];
  deleteFilters: Doc[];
  updateFilters: Doc[];
  find: (filter: Doc) => {
    sort: () => ReturnType<FakeModel["find"]>;
    limit: () => ReturnType<FakeModel["find"]>;
    lean: () => Promise<Doc[]>;
  };
  findOne: (filter: Doc) => { lean: () => Promise<Doc | null> };
  countDocuments: (filter: Doc) => Promise<number>;
  deleteMany: (filter: Doc) => Promise<{ deletedCount: number }>;
  deleteOne: (filter: Doc) => Promise<{ deletedCount: number }>;
  updateMany: (
    filter: Doc,
    update: { $set: Doc }
  ) => Promise<{ modifiedCount: number }>;
  create: (doc: Doc) => Promise<Doc>;
}

const makeModel = (): FakeModel => {
  const model: FakeModel = {
    rows: [],
    findFilters: [],
    deleteFilters: [],
    updateFilters: [],
    find(filter) {
      model.findFilters.push(filter);
      const selected = model.rows.filter((row) => matches(row, filter));
      const query = {
        sort: () => query,
        limit: () => query,
        lean: async () => selected,
      };
      return query;
    },
    findOne(filter) {
      model.findFilters.push(filter);
      return {
        lean: async () => model.rows.find((row) => matches(row, filter)) ?? null,
      };
    },
    async countDocuments(filter) {
      return model.rows.filter((row) => matches(row, filter)).length;
    },
    async deleteMany(filter) {
      model.deleteFilters.push(filter);
      const keep = model.rows.filter((row) => !matches(row, filter));
      const deletedCount = model.rows.length - keep.length;
      model.rows = keep;
      return { deletedCount };
    },
    async deleteOne(filter) {
      model.deleteFilters.push(filter);
      const index = model.rows.findIndex((row) => matches(row, filter));
      if (index === -1) return { deletedCount: 0 };
      model.rows.splice(index, 1);
      return { deletedCount: 1 };
    },
    async updateMany(filter, update) {
      model.updateFilters.push(filter);
      let modifiedCount = 0;
      for (const row of model.rows) {
        if (matches(row, filter)) {
          Object.assign(row, update.$set);
          modifiedCount += 1;
        }
      }
      return { modifiedCount };
    },
    async create(doc) {
      model.rows.push(doc);
      return doc;
    },
  };
  return model;
};

const Users = makeModel();
const Invoices = makeModel();
const Feedbacks = makeModel();
const Logs = makeModel();

mock.module("@/models/User", () => ({ default: Users }));
mock.module("@/models/Invoice", () => ({ default: Invoices }));
mock.module("@/models/Feedback", () => ({ default: Feedbacks }));
mock.module("@/models/LogEntry", () => ({ default: Logs }));

const { GET: exportGet } = await import("@/app/api/account/export/route");
const { DELETE: accountDelete, GET: accountGet } = await import(
  "@/app/api/account/route"
);

const makeReq = (url: string, body?: unknown) =>
  ({
    url,
    method: "GET",
    headers: { get: () => null },
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  }) as unknown as import("next/server").NextRequest;

const tokenFor = (uid: string, email: string, ageSeconds = 10): Doc => ({
  uid,
  email,
  email_verified: true,
  auth_time: Date.now() / 1000 - ageSeconds,
  firebase: { sign_in_provider: "google.com" },
});

/**
 * The burst limiters in both routes are the real ones, and they key on the uid
 * in a map that lives for the whole test process. Giving every case its own
 * "user A" keeps a later case from being answered 429 by an earlier one's
 * bucket, without weakening what is being asserted — A and B are still two
 * tenants in every collection.
 */
let subjectCounter = 0;
let A = "A0";
let aEmail = "a0@example.com";

beforeEach(() => {
  deletedFirebaseUids.length = 0;
  firebaseDeleteError = null;
  subjectCounter += 1;
  A = `A${subjectCounter}`;
  aEmail = `a${subjectCounter}@example.com`;
  currentToken = tokenFor(A, aEmail);

  Users.rows = [
    {
      _id: "u-A",
      uid: A,
      email: aEmail,
      name: "Operator A",
      providerIds: ["google.com"],
      // A pre-migration document: these two fields are gone from the schema but
      // still on disk, and `.lean()` hands them straight back.
      accessToken: "LEAKED_ID_TOKEN",
      refreshToken: "NEVER_EXPIRES",
    },
    { _id: "u-B", uid: "B", email: "b@example.com", name: "Operator B" },
  ];
  Invoices.rows = [
    { _id: "inv-A1", userId: A, invoiceNumber: "A-1", is_deleted: false, items: [] },
    { _id: "inv-A2", userId: A, invoiceNumber: "A-BINNED", is_deleted: true, items: [] },
    { _id: "inv-B1", userId: "B", invoiceNumber: "B-1", is_deleted: false, items: [] },
  ];
  Feedbacks.rows = [
    { _id: "fb-A", userId: A, message: "A said this" },
    { _id: "fb-B", userId: "B", message: "B said this" },
  ];
  Logs.rows = [
    { _id: "log-A", userId: A, at: new Date(), event: "invoice.created", ip: "203.0.113.9", meta: {} },
    { _id: "log-B", userId: "B", at: new Date(), event: "invoice.created", ip: "198.51.100.7", meta: {} },
  ];
  Invoices.findFilters.length = 0;
  Invoices.deleteFilters.length = 0;
  Feedbacks.deleteFilters.length = 0;
  Logs.updateFilters.length = 0;
});

const readJson = async (res: Response) => JSON.parse(await res.text());

describe("GET /api/account/export — tenant isolation", () => {
  it("returns the caller's invoices, including the soft-deleted one", async () => {
    const res = await exportGet(makeReq("http://x/api/account/export"));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const numbers = body.invoices.map((i: Doc) => i.invoiceNumber).sort();
    expect(numbers).toEqual(["A-1", "A-BINNED"]);
    expect(body.invoices.find((i: Doc) => i.invoiceNumber === "A-BINNED").is_deleted).toBe(true);
  });

  it("cannot reach another tenant's invoices, feedback, or activity", async () => {
    const res = await exportGet(makeReq("http://x/api/account/export"));
    const raw = JSON.stringify(await readJson(res));
    expect(raw).not.toContain("B-1");
    expect(raw).not.toContain("B said this");
    expect(raw).not.toContain("b@example.com");
    expect(raw).not.toContain("198.51.100.7");
  });

  it("scopes every read by the token's uid, not anything from the request", async () => {
    await exportGet(
      // A hostile query string naming another tenant must change nothing.
      makeReq("http://x/api/account/export?userId=B&uid=B&id=inv-B1")
    );
    for (const filter of Invoices.findFilters) {
      expect(filter.userId).toBe(A);
    }
    const body = await readJson(
      await exportGet(makeReq("http://x/api/account/export?userId=B"))
    );
    expect(body.invoices).toHaveLength(2);
  });

  it("does not ship the purged token fields the legacy user document still has", async () => {
    const raw = await (await exportGet(makeReq("http://x/api/account/export"))).text();
    expect(raw).not.toContain("LEAKED_ID_TOKEN");
    expect(raw).not.toContain("NEVER_EXPIRES");
  });

  it("marks the response no-store — it is an entire account in one body", async () => {
    const res = await exportGet(makeReq("http://x/api/account/export"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
  });

  it("gives user B only B's data from the same handler", async () => {
    currentToken = tokenFor("B", "b@example.com");
    const body = await readJson(await exportGet(makeReq("http://x/api/account/export")));
    expect(body.invoices.map((i: Doc) => i.invoiceNumber)).toEqual(["B-1"]);
    expect(body.profile.email).toBe("b@example.com");
  });
});

describe("GET /api/account — the damage report", () => {
  it("counts the caller's own rows, recycle bin included", async () => {
    const body = await readJson(await accountGet(makeReq("http://x/api/account")));
    expect(body.counts.invoices).toBe(2);
    expect(body.counts.deletedInvoices).toBe(1);
    expect(body.counts.feedback).toBe(1);
    expect(body.email).toBe(aEmail);
  });
});

describe("DELETE /api/account — confirmation gates", () => {
  it("rejects a missing confirmation and destroys nothing", async () => {
    const res = await accountDelete(makeReq("http://x/api/account", {}));
    expect(res.status).toBe(400);
    expect(Invoices.rows).toHaveLength(3);
    expect(Invoices.deleteFilters).toHaveLength(0);
    expect(deletedFirebaseUids).toHaveLength(0);
  });

  it("rejects a wrong confirmation and destroys nothing", async () => {
    const res = await accountDelete(
      makeReq("http://x/api/account", { confirmEmail: "b@example.com" })
    );
    expect(res.status).toBe(400);
    expect(Invoices.rows).toHaveLength(3);
    expect(deletedFirebaseUids).toHaveLength(0);
  });

  it("rejects a stale session even with a correct confirmation", async () => {
    currentToken = tokenFor(A, aEmail, 3600);
    const res = await accountDelete(
      makeReq("http://x/api/account", { confirmEmail: aEmail })
    );
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe("REAUTH_REQUIRED");
    expect(Invoices.rows).toHaveLength(3);
  });
});

describe("DELETE /api/account — what it actually destroys", () => {
  it("hard-deletes only the caller's data and leaves the other tenant intact", async () => {
    const res = await accountDelete(
      makeReq("http://x/api/account", { confirmEmail: `  ${aEmail.toUpperCase()} ` })
    );
    expect(res.status).toBe(200);

    // No `is_deleted` filter anywhere: the recycle bin goes too.
    for (const filter of Invoices.deleteFilters) {
      expect(filter).toEqual({ userId: A });
      expect(filter.is_deleted).toBeUndefined();
    }
    expect(Feedbacks.deleteFilters).toEqual([{ userId: A }]);

    expect(Invoices.rows.map((r) => r._id)).toEqual(["inv-B1"]);
    expect(Feedbacks.rows.map((r) => r._id)).toEqual(["fb-B"]);
    expect(Users.rows.map((r) => r.uid)).toEqual(["B"]);
    expect(deletedFirebaseUids).toEqual([A]);

    const body = await readJson(res);
    expect(body.deleted.invoices).toBe(2);
    expect(body.deleted.feedback).toBe(1);
  });

  it("anonymises the caller's log rows instead of destroying the audit trail", async () => {
    await accountDelete(
      makeReq("http://x/api/account", { confirmEmail: aEmail })
    );
    const own = Logs.rows.find((r) => r._id === "log-A")!;
    expect(own.userId).toBeNull();
    expect(own.ip).toBeNull();
    // The event itself survives, so an operator can still see what happened.
    expect(own.event).toBe("invoice.created");
    // Another tenant's rows are untouched.
    const other = Logs.rows.find((r) => r._id === "log-B")!;
    expect(other.userId).toBe("B");
    expect(other.ip).toBe("198.51.100.7");
  });

  it("leaves no surviving log row carrying the erased uid", async () => {
    await accountDelete(
      makeReq("http://x/api/account", { confirmEmail: aEmail })
    );
    // Includes the `account.delete.requested` row the route writes on the way
    // in — it is awaited precisely so the anonymisation pass catches it.
    expect(Logs.rows.filter((r) => r.userId === A)).toHaveLength(0);
    expect(JSON.stringify(Logs.rows)).not.toContain(aEmail);
  });

  it("treats an already-deleted Firebase user as success, so a retry completes", async () => {
    const notFound = new Error("no user") as Error & { code?: string };
    notFound.code = "auth/user-not-found";
    firebaseDeleteError = notFound;
    const res = await accountDelete(
      makeReq("http://x/api/account", { confirmEmail: aEmail })
    );
    expect(res.status).toBe(200);
    expect(Users.rows.map((r) => r.uid)).toEqual(["B"]);
  });

  it("reports a real Firebase failure as a 500 so the client keeps the session", async () => {
    firebaseDeleteError = new Error("firebase is down");
    const res = await accountDelete(
      makeReq("http://x/api/account", { confirmEmail: aEmail })
    );
    expect(res.status).toBe(500);
    // Firebase is the LAST step, so by the time it fails the invoices are
    // already permanently gone. Telling the user "nothing has been lost" on the
    // one irreversible surface in the product is the failure mode this pins.
    const { error } = await readJson(res);
    expect(error).toContain("already been permanently deleted");
    expect(error).not.toContain("Nothing has been");
  });
});
