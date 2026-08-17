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
    } else if (
      key === "invoiceDate" &&
      value &&
      typeof value === "object" &&
      "$gte" in (value as Record<string, unknown>)
    ) {
      // The suggester's financial-year window. The fake stores whatever the
      // route wrote (a string), so both sides are coerced before comparing.
      const window = value as { $gte: Date; $lt: Date };
      const at = new Date(doc.invoiceDate as string).getTime();
      if (
        Number.isNaN(at) ||
        at < window.$gte.getTime() ||
        at >= window.$lt.getTime()
      ) {
        return false;
      }
    } else if (doc[key] !== value) {
      return false;
    }
  }
  return true;
};

/**
 * The unique index from `models/Invoice.ts`, simulated.
 *
 * `{ userId, financialYear, invoiceNumberKey }`, FULL — soft-deleted rows are
 * checked too, exactly as the real index does, because a soft-deleted document
 * still holds its number. Without this the fake store would accept duplicates
 * and the 409 path would be untestable.
 */
const duplicateKeyError = () =>
  Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });

class FakeInvoice {
  [k: string]: unknown;
  _id: string;
  constructor(data: Record<string, unknown>) {
    this._id = (data._id as string) ?? `id-${idCounter++}`;
    Object.assign(this, data);
  }
  async save() {
    if (this.financialYear !== undefined && this.invoiceNumberKey !== undefined) {
      for (const doc of store.values()) {
        if (
          doc !== (this as unknown as Record<string, unknown>) &&
          doc._id !== this._id &&
          doc.userId === this.userId &&
          doc.financialYear === this.financialYear &&
          doc.invoiceNumberKey === this.invoiceNumberKey
        ) {
          throw duplicateKeyError();
        }
      }
    }
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
    // `sort()` still yields a plain array for the list endpoint; `limit`/`lean`
    // ride along for the number suggester, which chains all four.
    const chain = (rows: Record<string, unknown>[]) =>
      Object.assign([...rows], {
        limit: (n: number) => chain(rows.slice(0, n)),
        lean: async () => rows,
      });
    return { sort: () => chain(arr) };
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
  // Every NEW invoice states its treatment. Omitting it is no longer a way onto
  // the pre-Phase-2 tax arm — see "the legacy tax path" below.
  taxTreatment: "none",
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

/* -------------------------------------------------------------------------- *
 * Rule 46(b): the number, the financial year, and the unique index
 * -------------------------------------------------------------------------- */

describe("POST /api/invoices — invoice number (Rule 46(b))", () => {
  const numbered = (invoiceNumber: string, over: Record<string, unknown> = {}) =>
    makeReq("http://x/api/invoices", { ...validBody, invoiceNumber, ...over });

  it("rejects a number carrying characters the rule forbids, naming them", async () => {
    // "a b#c" used to save exactly as sent: `cleanString` trimmed it and
    // nothing else looked at it.
    const res = await POST(numbered("a b#c"));
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error:
        'Invoice number cannot contain "#". Use only letters, numbers, - and /.',
    });
  });

  it("rejects a number over sixteen characters, naming the length", async () => {
    const res = await POST(numbered("INVOICE/2026-27/0001"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Invoice number must be 16 characters or fewer (this one is 20)."
    );
  });

  it("stores the financial year of the INVOICE DATE and a case-folded key", async () => {
    const res = await POST(
      numbered("inv/2026-27/001", { invoiceDate: "2026-07-01" })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      invoice: {
        invoiceNumber: string;
        financialYear: string;
        invoiceNumberKey: string;
      };
    };
    // Printed as typed; keyed in upper case.
    expect(body.invoice.invoiceNumber).toBe("inv/2026-27/001");
    expect(body.invoice.financialYear).toBe("2026-27");
    expect(body.invoice.invoiceNumberKey).toBe("INV/2026-27/001");
  });

  it("files a 31 March invoice in the year that is ending, not today's", async () => {
    const res = await POST(
      numbered("INV/2025-26/9", { invoiceDate: "2026-03-31", dueDate: "2026-04-15" })
    );
    const body = (await res.json()) as { invoice: { financialYear: string } };
    expect(body.invoice.financialYear).toBe("2025-26");
  });

  it("409s on a second invoice with the same number in the same year", async () => {
    expect((await POST(numbered("INV/2026-27/001"))).status).toBe(201);

    const res = await POST(numbered("INV/2026-27/001"));
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      code: string;
      suggestion: string | null;
    };
    expect(body.code).toBe("DUPLICATE_INVOICE_NUMBER");
    expect(body.error).toContain("INV/2026-27/001");
    expect(body.error).toContain("2026-27");
    // The next free number rides along, in the body and in the message.
    expect(body.suggestion).toBe("INV/2026-27/002");
    expect(body.error).toContain("INV/2026-27/002");
  });

  it("catches a case-only duplicate too", async () => {
    expect((await POST(numbered("INV/2026-27/007"))).status).toBe(201);
    expect((await POST(numbered("inv/2026-27/007"))).status).toBe(409);
  });

  it("allows the SAME number in a different financial year", async () => {
    expect(
      (await POST(numbered("INV/001", { invoiceDate: "2026-07-01" }))).status
    ).toBe(201);
    // 1 April opens a new year, so the series legitimately restarts.
    const res = await POST(
      numbered("INV/001", { invoiceDate: "2027-04-01", dueDate: "2027-04-15" })
    );
    expect(res.status).toBe(201);
  });

  it("409s rather than 500s when an EDIT moves a number onto one in use", async () => {
    const first = (await (
      await POST(numbered("INV/2026-27/001"))
    ).json()) as { invoice: { _id: string } };
    await POST(numbered("INV/2026-27/002"));

    const res = await PUT(
      makeReq(`http://x/api/invoices?id=${first.invoice._id}`, {
        ...validBody,
        invoiceNumber: "INV/2026-27/002",
      })
    );
    expect(res.status).toBe(409);
  });

  it("lets an invoice be re-saved under its own unchanged number", async () => {
    const created = (await (
      await POST(numbered("INV/2026-27/010"))
    ).json()) as { invoice: { _id: string } };
    const res = await PUT(
      makeReq(`http://x/api/invoices?id=${created.invoice._id}`, {
        ...validBody,
        invoiceNumber: "INV/2026-27/010",
        notes: "edited",
      })
    );
    expect(res.status).toBe(200);
  });
});

/* -------------------------------------------------------------------------- *
 * The legacy tax path is for legacy RECORDS, not for requests missing a field
 * -------------------------------------------------------------------------- */

describe("POST /api/invoices — omitting taxTreatment", () => {
  it("refuses to create an invoice with no treatment, and stores nothing", async () => {
    const { taxTreatment: _dropped, ...noTreatment } = validBody;
    const res = await POST(
      makeReq("http://x/api/invoices", {
        ...noTreatment,
        // The purchase this used to buy: arbitrary invoice-level tax on a
        // document headed "INVOICE", with no GSTIN anywhere on it.
        cgst: 500,
        sgst: 500,
      })
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(
      "Choose whether GST applies"
    );
    expect([...store.values()].some((doc) => doc.cgst === 500)).toBe(false);
  });

  it("charges no tax when the treatment is stated as 'none', whatever was sent", async () => {
    const res = await POST(
      makeReq("http://x/api/invoices", {
        ...validBody,
        taxTreatment: "none",
        cgst: 500,
        sgst: 500,
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      invoice: { cgst: number; sgst: number; total: number; documentType: string };
    };
    expect(body.invoice.cgst).toBe(0);
    expect(body.invoice.sgst).toBe(0);
    expect(body.invoice.total).toBe(200);
    expect(body.invoice.documentType).toBe("invoice");
  });
});

describe("PUT /api/invoices — the legacy arm belongs to legacy records", () => {
  const seedLegacy = (over: Record<string, unknown> = {}) => {
    const doc = new FakeInvoice({
      _id: "legacy-1",
      userId: "A",
      is_deleted: false,
      companyName: "Acme Co",
      billTo: "Client Ltd",
      invoiceNumber: "OLD-1",
      invoiceDate: "2026-07-01",
      dueDate: "2026-07-15",
      currency: "INR",
      items: [{ name: "Consulting", quantity: 2, price: 100 }],
      cgst: 18,
      sgst: 18,
      convenienceCharge: 0,
      total: 236,
      ...over,
    }) as unknown as Record<string, unknown>;
    store.set("legacy-1", doc);
    return doc;
  };

  const legacyBody = {
    companyName: "Acme Co",
    billTo: "Client Ltd",
    invoiceNumber: "OLD-1",
    invoiceDate: "2026-07-01",
    dueDate: "2026-07-15",
    currency: "INR",
    items: [{ description: "Consulting", quantity: 2, unitPrice: 100 }],
    discount: 0,
    cgst: 18,
    sgst: 18,
    convenienceCharge: 0,
    status: "sent",
  };

  it("keeps a record that really predates Phase 2 on the legacy formula", async () => {
    seedLegacy();
    const res = await PUT(
      makeReq("http://x/api/invoices?id=legacy-1", legacyBody)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      invoice: { cgst: number; sgst: number; total: number };
    };
    // The document a client already holds re-saves with the numbers it was
    // issued with.
    expect(body.invoice.cgst).toBe(18);
    expect(body.invoice.sgst).toBe(18);
    expect(body.invoice.total).toBe(236);
  });

  it("refuses to walk a record that HAS a treatment back onto it", async () => {
    seedLegacy({ taxTreatment: "none", documentType: "invoice" });
    const res = await PUT(
      makeReq("http://x/api/invoices?id=legacy-1", legacyBody)
    );
    expect(res.status).toBe(400);
    expect(store.get("legacy-1")?.cgst).toBe(18);
  });
});

/* -------------------------------------------------------------------------- *
 * A rate GST does not have
 * -------------------------------------------------------------------------- */

describe("POST /api/invoices — non-slab line rates", () => {
  const gstBody = {
    ...validBody,
    taxTreatment: "gst",
    supplierStateCode: "27",
    placeOfSupplyStateCode: "27",
  };

  it("rejects 15% instead of dropping it and saving an untaxed invoice", async () => {
    const res = await POST(
      makeReq("http://x/api/invoices", {
        ...gstBody,
        items: [
          {
            description: "Consulting",
            quantity: 1,
            unitPrice: 1_000,
            hsnSac: "998314",
            taxRatePercent: 15,
          },
        ],
      })
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "That isn't a GST rate. Use 0%, 0.25%, 3%, 5%, 18% or 40%."
    );
    expect(store.size).toBe(2); // only the two seeded rows
  });

  it("still accepts a retired slab, with a warning rather than a refusal", async () => {
    const res = await POST(
      makeReq("http://x/api/invoices", {
        ...gstBody,
        items: [
          {
            description: "Consulting",
            quantity: 1,
            unitPrice: 1_000,
            hsnSac: "998314",
            taxRatePercent: 12,
          },
        ],
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { invoice: { cgst: number } };
    expect(body.invoice.cgst).toBe(60);
  });
});

/* -------------------------------------------------------------------------- *
 * The unregistered exporter can actually issue an invoice
 * -------------------------------------------------------------------------- */

describe("POST /api/invoices — an unregistered supplier exporting services", () => {
  it("saves with no LUT ARN and no with-payment-of-tax claim", async () => {
    // The ₹20 lakh threshold means most users have no GSTIN. Billing a client
    // abroad used to be refused outright with "Enter your LUT ARN, or switch to
    // 'with payment of tax'" — an LUT is a filing only a registered person can
    // make, so both ways out put a false statement on a legal document.
    const res = await POST(
      makeReq("http://x/api/invoices", {
        ...validBody,
        invoiceNumber: "INV/2026-27/001",
        taxTreatment: "none",
        companyGstin: "",
        recipientIsOutsideIndia: true,
        placeOfSupplyStateCode: "96",
        countryOfDestination: "United States",
        withPaymentOfTax: false,
        lutArn: "",
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      invoice: {
        supplyKind: string;
        documentType: string;
        companyGstin: string;
        cgst: number;
        sgst: number;
        igst: number;
        lutArn: string;
      };
    };
    expect(body.invoice.supplyKind).toBe("export");
    // A plain INVOICE, no GSTIN, no tax of any head, and no invented ARN.
    expect(body.invoice.documentType).toBe("invoice");
    expect(body.invoice.companyGstin).toBe("");
    expect(body.invoice.cgst + body.invoice.sgst + body.invoice.igst).toBe(0);
    expect(body.invoice.lutArn).toBe("");
  });

  it("still requires the LUT ARN from a REGISTERED exporter", async () => {
    const res = await POST(
      makeReq("http://x/api/invoices", {
        ...validBody,
        invoiceNumber: "INV/2026-27/002",
        taxTreatment: "gst",
        companyGstin: "27AAPFU0939F1ZV",
        supplierStateCode: "27",
        recipientIsOutsideIndia: true,
        placeOfSupplyStateCode: "96",
        countryOfDestination: "United States",
        withPaymentOfTax: false,
        lutArn: "",
      })
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Enter your LUT ARN, or switch to 'with payment of tax'."
    );
  });
});
