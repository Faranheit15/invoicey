import { describe, it, expect, mock, beforeEach } from "bun:test";
import { NextResponse } from "next/server";
import * as realAuth from "@/lib/server/auth";

// The logged-in user is always "A". The route derives userId from this, never
// from the request body — that is the property under test.
//
// Bun's mock.module is process-global and replaces the WHOLE module, so a
// factory returning only the two exports this file overrides makes every other
// export vanish for every suite that runs after it — admin-auth.test.ts then
// fails to import verifyRequestToken. Spreading the real module keeps the rest
// intact and stops the suite being order-dependent.
mock.module("@/lib/server/auth", () => ({
  ...realAuth,
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

/**
 * The API's own GSTIN handling. These live in this file because it already owns
 * the in-memory Invoice model and the route import; `normalizePayload` is not
 * exported, and testing it through the real handler is the point — a rule that
 * only holds in the editor is not enforced.
 */
describe("POST /api/invoices — GSTIN particulars", () => {
  const MAHARASHTRA_GSTIN = "27AAPFU0939F1ZV";

  const gstBody = {
    ...validBody,
    taxTreatment: "gst",
    supplierStateCode: "27",
    placeOfSupplyStateCode: "27",
    items: [
      {
        description: "Consulting",
        quantity: 1,
        unitPrice: 10_000,
        hsnSac: "998314",
        taxRatePercent: 18,
      },
    ],
  };

  it("accepts an invoice with NO GSTIN at all", async () => {
    // The majority case: below the registration thresholds there is nothing to
    // put here, and the app must not force a fake one.
    const res = await POST(makeReq("http://x/api/invoices", validBody));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { invoice: { companyGstin: string } };
    expect(body.invoice.companyGstin).toBe("");
  });

  it("rejects a supplier GSTIN that fails the checksum", async () => {
    const res = await POST(
      makeReq("http://x/api/invoices", {
        ...validBody,
        companyGstin: "27AAPFU0939F1ZW",
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "Your GSTIN is not valid. Check the 15 characters.",
    });
  });

  it("rejects a client GSTIN that fails the checksum", async () => {
    const res = await POST(
      makeReq("http://x/api/invoices", {
        ...validBody,
        billToGstin: "29AAGCB7383J1Z9",
      })
    );
    expect(res.status).toBe(400);
  });

  it("stores a normalized GSTIN and the PAN derived from it", async () => {
    const res = await POST(
      makeReq("http://x/api/invoices", {
        ...gstBody,
        companyGstin: " 27aapfu0939f1zv ",
        billToGstin: "29AAGCB7383J1Z4",
        companyPan: "ZZZZZ9999Z", // loses to the GSTIN
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      invoice: { companyGstin: string; companyPan: string; billToGstin: string };
    };
    expect(body.invoice.companyGstin).toBe(MAHARASHTRA_GSTIN);
    expect(body.invoice.companyPan).toBe("AAPFU0939F");
    expect(body.invoice.billToGstin).toBe("29AAGCB7383J1Z4");
  });

  it("REJECTS a supplier state that contradicts the GSTIN's prefix (§5.9)", async () => {
    // Server-side, not just in the editor. Auto-correcting would silently flip
    // CGST+SGST to IGST (or back) on a document the client has to book.
    const res = await POST(
      makeReq("http://x/api/invoices", {
        ...gstBody,
        companyGstin: MAHARASHTRA_GSTIN, // 27
        supplierStateCode: "29",
        placeOfSupplyStateCode: "29",
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "Your state must match the first two digits of your GSTIN.",
    });
  });
});

describe("POST /api/invoices — TDS and the signature block", () => {
  it("stores the derived deduction without touching the total", async () => {
    const res = await POST(
      makeReq("http://x/api/invoices", {
        ...validBody,
        items: [{ description: "Retainer", quantity: 1, unitPrice: 10_000 }],
        tdsSection: "194J_professional",
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      invoice: {
        total: number;
        tdsAmount: number;
        tdsRatePercent: number;
        tdsSection: string;
      };
    };
    expect(body.invoice.total).toBe(10_000);
    expect(body.invoice.tdsAmount).toBe(1_000);
    // The rate is stored RESOLVED, never as the 0 the client omitted.
    expect(body.invoice.tdsRatePercent).toBe(10);
  });

  it("drops an unknown TDS section instead of storing it", async () => {
    const res = await POST(
      makeReq("http://x/api/invoices", {
        ...validBody,
        tdsSection: "194Z_invented",
      })
    );
    const body = (await res.json()) as {
      invoice: { tdsSection: string; tdsAmount: number };
    };
    expect(body.invoice.tdsSection).toBe("none");
    expect(body.invoice.tdsAmount).toBe(0);
  });

  it("strips a signature image URL outside the protocol allowlist", async () => {
    const res = await POST(
      makeReq("http://x/api/invoices", {
        ...validBody,
        signatureLabel: "For Acme Co",
        // eslint-disable-next-line no-script-url
        signatureImageUrl: "javascript:alert(1)",
      })
    );
    const body = (await res.json()) as {
      invoice: { signatureLabel: string; signatureImageUrl: string };
    };
    expect(body.invoice.signatureLabel).toBe("For Acme Co");
    expect(body.invoice.signatureImageUrl).toBe("");
  });

  it("keeps an https signature image", async () => {
    const res = await POST(
      makeReq("http://x/api/invoices", {
        ...validBody,
        signatureImageUrl: "https://cdn.example.com/sig.png",
      })
    );
    const body = (await res.json()) as { invoice: { signatureImageUrl: string } };
    expect(body.invoice.signatureImageUrl).toBe("https://cdn.example.com/sig.png");
  });
});
