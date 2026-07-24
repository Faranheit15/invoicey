import { describe, it, expect, mock, beforeEach } from "bun:test";
import { NextResponse } from "next/server";

// The logged-in user is always "A". The route derives userId from this, never
// from the request body — that is the property under test.
mock.module("@/lib/server/auth", () => ({
  requireUser: async () => "A",
  authErrorResponse: () =>
    NextResponse.json({ error: "unauthorized" }, { status: 401 }),
}));
mock.module("@/lib/mongodb", () => ({ default: async () => {} }));
// Neutralize the real writer's DB deps rather than mocking the log module
// (Bun's global mocks would leak an incomplete stub across suites).
mock.module("@/models/LogEntry", () => ({
  default: { create: async () => ({}) },
}));

// In-memory Invoice model honoring the { _id, userId, is_deleted } filters.
const store = new Map<string, Record<string, unknown>>();
const updateOneCalls: unknown[][] = [];
let idCounter = 1;

const matches = (
  doc: Record<string, unknown>,
  filter: Record<string, unknown>
): boolean => {
  for (const [key, value] of Object.entries(filter)) {
    if (
      key === "is_deleted" &&
      value &&
      typeof value === "object" &&
      "$ne" in (value as Record<string, unknown>)
    ) {
      if ((doc.is_deleted ?? false) === (value as { $ne: unknown }).$ne) {
        return false;
      }
    } else if (doc[key] !== value) {
      return false;
    }
  }
  return true;
};

class FakeInvoice {
  [k: string]: unknown;
  _id: string;
  constructor(data: Record<string, unknown>) {
    this._id = (data._id as string) ?? `id-${idCounter++}`;
    Object.assign(this, data);
  }
  async save() {
    store.set(this._id, this as unknown as Record<string, unknown>);
    return this;
  }
  toObject() {
    return { ...this };
  }
  static async findOne(filter: Record<string, unknown>) {
    for (const doc of store.values()) if (matches(doc, filter)) return doc;
    return null;
  }
  static find(filter: Record<string, unknown>) {
    const arr = [...store.values()].filter((d) => matches(d, filter));
    return { sort: () => arr };
  }
  static async updateOne(
    filter: Record<string, unknown>,
    update: { $set: Record<string, unknown> }
  ) {
    updateOneCalls.push([filter, update]);
    for (const doc of store.values()) {
      if (matches(doc, filter)) {
        Object.assign(doc, update.$set);
        return { modifiedCount: 1 };
      }
    }
    return { modifiedCount: 0 };
  }
}

mock.module("@/models/Invoice", () => ({ default: FakeInvoice }));

const { GET, POST, PUT, PATCH } = await import("@/app/api/invoices/route");

const makeReq = (url: string, body?: unknown) =>
  ({
    url,
    headers: { get: () => null },
    json: async () => body,
  }) as unknown as import("next/server").NextRequest;

const validBody = {
  userId: "B", // must be ignored by the server
  companyName: "Acme Co",
  companyEmail: "acme@example.com",
  billTo: "Client Ltd",
  invoiceNumber: "INV-NEW",
  invoiceDate: "2026-07-01",
  dueDate: "2026-07-15",
  currency: "INR",
  items: [{ description: "Consulting", quantity: 2, unitPrice: 100 }],
  discount: 0,
  cgst: 0,
  sgst: 0,
  convenienceCharge: 0,
  status: "sent",
};

beforeEach(() => {
  store.clear();
  updateOneCalls.length = 0;
  // Seed as FakeInvoice instances so the route's `invoice.toObject()` works.
  store.set(
    "inv-A",
    new FakeInvoice({
      _id: "inv-A",
      userId: "A",
      is_deleted: false,
      invoiceNumber: "A-1",
      total: 50,
      currency: "INR",
      status: "sent",
    }) as unknown as Record<string, unknown>
  );
  store.set(
    "inv-B",
    new FakeInvoice({
      _id: "inv-B",
      userId: "B",
      is_deleted: false,
      invoiceNumber: "B-1",
      total: 100,
      currency: "INR",
      status: "sent",
    }) as unknown as Record<string, unknown>
  );
});

describe("invoice per-user isolation", () => {
  it("GET ?id= of another user's invoice returns 404", async () => {
    const res = await GET(makeReq("http://x/api/invoices?id=inv-B"));
    expect(res.status).toBe(404);
  });

  it("GET list returns only the caller's own invoices", async () => {
    const res = await GET(makeReq("http://x/api/invoices"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string }[];
    expect(body).toHaveLength(1);
    expect(body[0].userId).toBe("A");
  });

  it("POST ignores a client-supplied userId and stamps the token's uid", async () => {
    const res = await POST(makeReq("http://x/api/invoices", validBody));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { invoice: { userId: string } };
    expect(body.invoice.userId).toBe("A");
  });

  it("PUT on another user's invoice returns 404 and does not modify it", async () => {
    const res = await PUT(makeReq("http://x/api/invoices?id=inv-B", validBody));
    expect(res.status).toBe(404);
    expect(store.get("inv-B")?.userId).toBe("B");
    expect(store.get("inv-B")?.invoiceNumber).toBe("B-1");
  });

  it("PATCH soft_delete on another user's invoice returns 404", async () => {
    const res = await PATCH(
      makeReq("http://x/api/invoices?id=inv-B", { action: "soft_delete" })
    );
    expect(res.status).toBe(404);
    expect(store.get("inv-B")?.is_deleted).toBe(false);
  });

  it("PATCH settle scopes the write by userId (defense in depth)", async () => {
    const res = await PATCH(
      makeReq("http://x/api/invoices?id=inv-A", { action: "settle" })
    );
    expect(res.status).toBe(200);
    expect(updateOneCalls[0][0]).toEqual({ _id: "inv-A", userId: "A" });
  });
});
