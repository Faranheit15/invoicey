import { describe, it, expect, mock, beforeEach } from "bun:test";
import { NextResponse } from "next/server";
import * as realAuth from "@/lib/server/auth";

/**
 * `POST/PUT /api/invoices` for the Phase 4 document kinds, and the numbering
 * series behind them.
 *
 * Four properties, each of which is a way for a document to be wrong on the
 * page or wrong in the database:
 *
 *   1. SERIES ISOLATION. A proforma and an invoice may hold the same number in
 *      the same financial year — they are different sequences — and neither may
 *      be offered a number out of the other's.
 *   2. THE RULE 53 REFERENCE IS PROVED, NOT TRUSTED. A credit note may not name
 *      an invoice that does not exist, belongs to another user, or has been
 *      soft-deleted, and its printed particulars come from the stored invoice
 *      rather than from the request body.
 *   3. A DOCUMENT CANNOT CHANGE KIND once saved.
 *   4. A legacy invoice keeps behaving exactly as it did.
 *
 * Bun's `mock.module` is process-global, so the auth module is SPREAD rather
 * than replaced — see the note in tests/invoices-isolation.test.ts.
 */
mock.module("@/lib/server/auth", () => ({
  ...realAuth,
  requireUser: async () => "user-A",
  authErrorResponse: () =>
    NextResponse.json({ error: "unauthorized" }, { status: 401 }),
}));
mock.module("@/lib/mongodb", () => ({ default: async () => {} }));
mock.module("@/models/LogEntry", () => ({
  default: { create: async () => ({}) },
}));

type Doc = Record<string, unknown>;

const store = new Map<string, Doc>();
let idCounter = 1;

/**
 * The Mongo semantics this route actually depends on. `{ field: null }` is the
 * important one: it matches a document whose field is null OR MISSING, which is
 * exactly how the invoice series is scanned (an ordinary invoice stores no
 * `documentKind`).
 */
const matches = (doc: Doc, filter: Doc): boolean => {
  for (const [key, value] of Object.entries(filter)) {
    if (value === null) {
      if (doc[key] !== null && doc[key] !== undefined) {
        return false;
      }
      continue;
    }
    if (value && typeof value === "object" && "$ne" in (value as Doc)) {
      if ((doc[key] ?? false) === (value as { $ne: unknown }).$ne) {
        return false;
      }
      continue;
    }
    if (value && typeof value === "object" && "$gte" in (value as Doc)) {
      const window = value as { $gte: Date; $lt: Date };
      const at = new Date(doc[key] as string).getTime();
      if (
        Number.isNaN(at) ||
        at < window.$gte.getTime() ||
        at >= window.$lt.getTime()
      ) {
        return false;
      }
      continue;
    }
    if (doc[key] !== value) {
      return false;
    }
  }
  return true;
};

const duplicateKeyError = () =>
  Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });

class FakeInvoice {
  [k: string]: unknown;
  _id: string;
  constructor(data: Doc) {
    this._id = (data._id as string) ?? `id-${idCounter++}`;
    Object.assign(this, data);
  }
  async save() {
    // The unique index, simulated: { userId, financialYear, documentKind,
    // invoiceNumberKey }. `documentKind` is normalised through `?? null`,
    // matching how Mongo indexes a missing field — which is what puts every
    // ordinary invoice, new and legacy, in ONE key space.
    if (this.financialYear !== undefined && this.invoiceNumberKey !== undefined) {
      for (const doc of store.values()) {
        if (
          doc._id !== this._id &&
          doc.userId === this.userId &&
          doc.financialYear === this.financialYear &&
          (doc.documentKind ?? null) === (this.documentKind ?? null) &&
          doc.invoiceNumberKey === this.invoiceNumberKey
        ) {
          throw duplicateKeyError();
        }
      }
    }
    store.set(this._id, this as unknown as Doc);
    return this;
  }
  toObject() {
    return { ...this };
  }
  static async findOne(filter: Doc) {
    // Mongoose throws a CastError before it queries anything when `_id` is not
    // a well-formed ObjectId. Reproduced here because the route has to turn
    // that into a refusal rather than a 500.
    if (filter._id === "not-an-object-id") {
      throw Object.assign(new Error("Cast to ObjectId failed"), {
        name: "CastError",
      });
    }
    for (const doc of store.values()) {
      if (matches(doc, filter)) {
        return doc;
      }
    }
    return null;
  }
  static find(filter: Doc) {
    const rows = [...store.values()].filter((doc) => matches(doc, filter));
    const chain = (list: Doc[]) =>
      Object.assign([...list], {
        limit: (n: number) => chain(list.slice(0, n)),
        lean: async () => list,
      });
    return { sort: () => chain(rows) };
  }
  static async updateOne(filter: Doc, update: { $set: Doc }) {
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

const { GET, POST, PUT } = await import("@/app/api/invoices/route");

// Pure mappers, imported after the mocks so nothing here pulls in a real model.
const { applyDocumentKindToDraft, mapFormStateToPayload, mapInvoiceRecordToFormState } =
  await import("@/lib/invoices");
const { buildDuplicateFormState } = await import("@/lib/invoice-duplicate");

const makeReq = (url: string, body?: unknown) =>
  ({
    url,
    headers: { get: () => null },
    json: async () => body,
  }) as unknown as import("next/server").NextRequest;

const baseBody = {
  taxTreatment: "none",
  companyName: "Acme Consulting",
  billTo: "Client Co",
  invoiceDate: "2026-07-01",
  dueDate: "2026-07-15",
  currency: "INR",
  items: [{ description: "Consulting", quantity: 1, unitPrice: 1000 }],
  discount: 0,
  cgst: 0,
  sgst: 0,
  convenienceCharge: 0,
  status: "sent",
};

const seed = (doc: Doc) => {
  const invoice = new FakeInvoice({
    is_deleted: false,
    userId: "user-A",
    financialYear: "2026-27",
    ...doc,
  });
  store.set(invoice._id, invoice as unknown as Doc);
  return invoice;
};

beforeEach(() => {
  store.clear();
});

/* -------------------------------------------------------------------------- */
/* 1. Series isolation                                                        */
/* -------------------------------------------------------------------------- */

describe("numbering series isolation", () => {
  it("suggests out of the requested series, ignoring the others", async () => {
    seed({
      _id: "inv-1",
      invoiceNumber: "INV/2026-27/007",
      invoiceNumberKey: "INV/2026-27/007",
      invoiceDate: "2026-07-01",
    });
    seed({
      _id: "pi-1",
      documentKind: "proforma",
      invoiceNumber: "PI/2026-27/002",
      invoiceNumberKey: "PI/2026-27/002",
      invoiceDate: "2026-07-01",
    });

    const invoiceRes = await GET(
      makeReq("http://x/api/invoices?suggest_number=1&date=2026-07-02")
    );
    expect(await invoiceRes.json()).toMatchObject({
      financialYear: "2026-27",
      invoiceNumber: "INV/2026-27/008",
    });

    const proformaRes = await GET(
      makeReq(
        "http://x/api/invoices?suggest_number=1&date=2026-07-02&kind=proforma"
      )
    );
    // Not INV/2026-27/008, and not PI/2026-27/008 either — the proforma series
    // has its own counter and its own prefix.
    expect(await proformaRes.json()).toMatchObject({
      invoiceNumber: "PI/2026-27/003",
    });

    // A series with nothing in it starts at 1 rather than continuing another.
    const creditRes = await GET(
      makeReq(
        "http://x/api/invoices?suggest_number=1&date=2026-07-02&kind=credit_note"
      )
    );
    expect(await creditRes.json()).toMatchObject({
      invoiceNumber: "CN/2026-27/001",
    });
  });

  it("falls back to the invoice series for an unknown kind", async () => {
    const res = await GET(
      makeReq("http://x/api/invoices?suggest_number=1&date=2026-07-02&kind=nonsense")
    );
    expect(await res.json()).toMatchObject({ invoiceNumber: "INV/2026-27/001" });
  });

  it("lets a proforma and an invoice hold the same number in the same year", async () => {
    const invoice = await POST(
      makeReq("http://x/api/invoices", {
        ...baseBody,
        invoiceNumber: "X/2026-27/001",
      })
    );
    expect(invoice.status).toBe(201);

    const proforma = await POST(
      makeReq("http://x/api/invoices", {
        ...baseBody,
        documentKind: "proforma",
        invoiceNumber: "X/2026-27/001",
      })
    );
    // Different series, different index key. Rule 46(b)'s uniqueness is per
    // series, so this is not a duplicate.
    expect(proforma.status).toBe(201);
  });

  it("still refuses a second INVOICE with the same number", async () => {
    await POST(
      makeReq("http://x/api/invoices", {
        ...baseBody,
        invoiceNumber: "INV/2026-27/001",
      })
    );
    const second = await POST(
      makeReq("http://x/api/invoices", {
        ...baseBody,
        invoiceNumber: "INV/2026-27/001",
      })
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string; suggestion: string };
    expect(body.error).toContain("Invoice number INV/2026-27/001");
    expect(body.suggestion).toBe("INV/2026-27/002");
  });

  it("offers a proforma's own series in its 409", async () => {
    await POST(
      makeReq("http://x/api/invoices", {
        ...baseBody,
        documentKind: "proforma",
        invoiceNumber: "PI/2026-27/001",
      })
    );
    const second = await POST(
      makeReq("http://x/api/invoices", {
        ...baseBody,
        documentKind: "proforma",
        invoiceNumber: "PI/2026-27/001",
      })
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string; suggestion: string };
    expect(body.error).toContain("Proforma invoice number");
    expect(body.suggestion).toBe("PI/2026-27/002");
  });

  it("stores an ordinary invoice with NO documentKind at all", async () => {
    // Not "invoice" — absence is what shares one index key space with every
    // pre-Phase-4 document. Storing the word would split the series in two.
    const res = await POST(
      makeReq("http://x/api/invoices", {
        ...baseBody,
        documentKind: "invoice",
        invoiceNumber: "INV/2026-27/001",
      })
    );
    const body = (await res.json()) as { invoice: { documentKind?: string } };
    expect(body.invoice.documentKind).toBeUndefined();
  });

  it("refuses an unknown kind by treating it as an invoice", async () => {
    const res = await POST(
      makeReq("http://x/api/invoices", {
        ...baseBody,
        documentKind: "receipt_voucher",
        invoiceNumber: "INV/2026-27/001",
      })
    );
    const body = (await res.json()) as { invoice: { documentKind?: string } };
    expect(res.status).toBe(201);
    expect(body.invoice.documentKind).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* 2. The Rule 53 reference is proved, not trusted                            */
/* -------------------------------------------------------------------------- */

describe("POST /api/invoices — credit and debit notes", () => {
  const noteBody = (overrides: Record<string, unknown> = {}) => ({
    ...baseBody,
    documentKind: "credit_note",
    invoiceNumber: "CN/2026-27/001",
    invoiceDate: "2026-08-01",
    dueDate: "2026-08-01",
    reasonForIssue: "Sales return",
    ...overrides,
  });

  beforeEach(() => {
    seed({
      _id: "inv-A",
      userId: "user-A",
      invoiceNumber: "INV/2026-27/007",
      invoiceNumberKey: "INV/2026-27/007",
      invoiceDate: "2026-07-01",
      total: 1000,
    });
    seed({
      _id: "inv-B",
      userId: "user-B",
      invoiceNumber: "B/2026-27/001",
      invoiceNumberKey: "B/2026-27/001",
      invoiceDate: "2026-07-01",
    });
    seed({
      _id: "inv-deleted",
      userId: "user-A",
      is_deleted: true,
      invoiceNumber: "INV/2026-27/006",
      invoiceNumberKey: "INV/2026-27/006",
      invoiceDate: "2026-07-01",
    });
    seed({
      _id: "pi-A",
      userId: "user-A",
      documentKind: "proforma",
      invoiceNumber: "PI/2026-27/001",
      invoiceNumberKey: "PI/2026-27/001",
      invoiceDate: "2026-07-01",
    });
  });

  it("accepts a note against the caller's own live invoice", async () => {
    const res = await POST(
      makeReq(
        "http://x/api/invoices",
        noteBody({ originalInvoice: { invoiceId: "inv-A" } })
      )
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      invoice: {
        documentKind: string;
        reasonForIssue: string;
        originalInvoice: { invoiceNumber: string; invoiceDate: string };
      };
    };
    expect(body.invoice.documentKind).toBe("credit_note");
    expect(body.invoice.reasonForIssue).toBe("Sales return");
    expect(body.invoice.originalInvoice.invoiceNumber).toBe("INV/2026-27/007");
    expect(body.invoice.originalInvoice.invoiceDate).toBe("2026-07-01");
  });

  it("REFUSES a note against another user's invoice", async () => {
    // The lookup is scoped to the uid from the verified token, so this is
    // indistinguishable from an id that does not exist — which is the point.
    const res = await POST(
      makeReq(
        "http://x/api/invoices",
        noteBody({ originalInvoice: { invoiceId: "inv-B" } })
      )
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain(
      "no longer exists"
    );
    // And nothing was written.
    expect([...store.values()].some((doc) => doc.documentKind === "credit_note")).toBe(
      false
    );
  });

  it("REFUSES a note against a soft-deleted invoice", async () => {
    const res = await POST(
      makeReq(
        "http://x/api/invoices",
        noteBody({ originalInvoice: { invoiceId: "inv-deleted" } })
      )
    );
    expect(res.status).toBe(404);
  });

  it("REFUSES a note whose reference is not even a well-formed id", async () => {
    // Mongoose throws a CastError here; reaching the outer handler would turn a
    // bad reference into a 500 that looks like an outage.
    const res = await POST(
      makeReq(
        "http://x/api/invoices",
        noteBody({ originalInvoice: { invoiceId: "not-an-object-id" } })
      )
    );
    expect(res.status).toBe(404);
  });

  it("REFUSES a note against an invoice that does not exist", async () => {
    const res = await POST(
      makeReq(
        "http://x/api/invoices",
        noteBody({ originalInvoice: { invoiceId: "nope" } })
      )
    );
    expect(res.status).toBe(404);
  });

  it("REFUSES a note against a proforma — there is no liability to adjust", async () => {
    const res = await POST(
      makeReq(
        "http://x/api/invoices",
        noteBody({ originalInvoice: { invoiceId: "pi-A" } })
      )
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(
      "only be issued against an invoice"
    );
  });

  it("REFUSES a note with no reference at all", async () => {
    const res = await POST(makeReq("http://x/api/invoices", noteBody()));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(
      "must reference the invoice it corrects"
    );
  });

  it("IGNORES a number and date the body claims, taking both from the invoice", async () => {
    const res = await POST(
      makeReq(
        "http://x/api/invoices",
        noteBody({
          originalInvoice: {
            invoiceId: "inv-A",
            invoiceNumber: "SOMEONE-ELSES/0001",
            invoiceDate: "1999-01-01",
          },
        })
      )
    );
    const body = (await res.json()) as {
      invoice: { originalInvoice: { invoiceNumber: string; invoiceDate: string } };
    };
    expect(body.invoice.originalInvoice.invoiceNumber).toBe("INV/2026-27/007");
    expect(body.invoice.originalInvoice.invoiceDate).toBe("2026-07-01");
  });

  it("refuses a note dated before the invoice it corrects", async () => {
    const res = await POST(
      makeReq(
        "http://x/api/invoices",
        noteBody({
          invoiceDate: "2026-06-01",
          dueDate: "2026-06-01",
          originalInvoice: { invoiceId: "inv-A" },
        })
      )
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(
      "cannot be dated before"
    );
  });

  it("stores a debit note the same way, with its own wording", async () => {
    const res = await POST(
      makeReq(
        "http://x/api/invoices",
        noteBody({
          documentKind: "debit_note",
          invoiceNumber: "DN/2026-27/001",
          originalInvoice: { invoiceId: "inv-A" },
        })
      )
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { invoice: { documentKind: string } };
    expect(body.invoice.documentKind).toBe("debit_note");
  });

  it("keeps the total positive — a credit note credits, it does not negate", async () => {
    const res = await POST(
      makeReq(
        "http://x/api/invoices",
        noteBody({
          originalInvoice: { invoiceId: "inv-A" },
          items: [{ description: "Overcharge", quantity: 1, unitPrice: 250 }],
        })
      )
    );
    const body = (await res.json()) as { invoice: { total: number } };
    expect(body.invoice.total).toBe(250);
  });

  it("stores no reference on a document that is not a note", async () => {
    const res = await POST(
      makeReq("http://x/api/invoices", {
        ...baseBody,
        invoiceNumber: "INV/2026-27/010",
        originalInvoice: { invoiceId: "inv-A" },
        reasonForIssue: "smuggled",
      })
    );
    const body = (await res.json()) as {
      invoice: { originalInvoice?: unknown; reasonForIssue: string };
    };
    expect(res.status).toBe(201);
    expect(body.invoice.originalInvoice).toBeUndefined();
    expect(body.invoice.reasonForIssue).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/* 3. A saved document cannot change kind                                     */
/* -------------------------------------------------------------------------- */

describe("PUT /api/invoices — the kind is frozen", () => {
  it("refuses to turn a saved invoice into a credit note", async () => {
    const created = await POST(
      makeReq("http://x/api/invoices", {
        ...baseBody,
        invoiceNumber: "INV/2026-27/001",
      })
    );
    const { invoice } = (await created.json()) as { invoice: { _id: string } };

    const res = await PUT(
      makeReq(`http://x/api/invoices?id=${invoice._id}`, {
        ...baseBody,
        invoiceNumber: "INV/2026-27/001",
        documentKind: "credit_note",
      })
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(
      "cannot be turned into"
    );
    // The stored document is untouched.
    expect(store.get(invoice._id)?.documentKind).toBeUndefined();
  });

  it("lets a proforma be edited as a proforma", async () => {
    const created = await POST(
      makeReq("http://x/api/invoices", {
        ...baseBody,
        documentKind: "proforma",
        invoiceNumber: "PI/2026-27/001",
      })
    );
    const { invoice } = (await created.json()) as { invoice: { _id: string } };

    const res = await PUT(
      makeReq(`http://x/api/invoices?id=${invoice._id}`, {
        ...baseBody,
        documentKind: "proforma",
        invoiceNumber: "PI/2026-27/001",
        billTo: "Renamed Client",
      })
    );
    expect(res.status).toBe(200);
    expect(store.get(invoice._id)?.billTo).toBe("Renamed Client");
    expect(store.get(invoice._id)?.documentKind).toBe("proforma");
  });

  it("re-proves a note's reference on every update", async () => {
    seed({
      _id: "inv-A",
      userId: "user-A",
      invoiceNumber: "INV/2026-27/007",
      invoiceNumberKey: "INV/2026-27/007",
      invoiceDate: "2026-07-01",
    });
    seed({
      _id: "inv-B",
      userId: "user-B",
      invoiceNumber: "B/2026-27/001",
      invoiceNumberKey: "B/2026-27/001",
      invoiceDate: "2026-07-01",
    });

    const created = await POST(
      makeReq("http://x/api/invoices", {
        ...baseBody,
        documentKind: "credit_note",
        invoiceNumber: "CN/2026-27/001",
        invoiceDate: "2026-08-01",
        dueDate: "2026-08-01",
        originalInvoice: { invoiceId: "inv-A" },
      })
    );
    const { invoice } = (await created.json()) as { invoice: { _id: string } };

    // Repointing it at somebody else's invoice is refused exactly as on create.
    const res = await PUT(
      makeReq(`http://x/api/invoices?id=${invoice._id}`, {
        ...baseBody,
        documentKind: "credit_note",
        invoiceNumber: "CN/2026-27/001",
        invoiceDate: "2026-08-01",
        dueDate: "2026-08-01",
        originalInvoice: { invoiceId: "inv-B" },
      })
    );
    expect(res.status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Legacy documents                                                        */
/* -------------------------------------------------------------------------- */

describe("a pre-Phase-4 invoice", () => {
  it("is scanned as part of the invoice series, because it has no kind", async () => {
    seed({
      _id: "legacy-1",
      invoiceNumber: "INV-000042",
      invoiceNumberKey: "INV-000042",
      invoiceDate: "2026-07-01",
      // No documentKind, no financialYear, no taxTreatment — as written by an
      // older version of this app.
      financialYear: undefined,
    });
    const res = await GET(
      makeReq("http://x/api/invoices?suggest_number=1&date=2026-07-02")
    );
    expect(await res.json()).toMatchObject({ invoiceNumber: "INV-000043" });
  });

  it("keeps the legacy tax arm when it is re-saved without a treatment", async () => {
    seed({
      _id: "legacy-2",
      invoiceNumber: "INV-000043",
      invoiceNumberKey: "INV-000043",
      invoiceDate: "2026-07-01",
      companyName: "Old Co",
      billTo: "Old Client",
      total: 118,
    });
    const res = await PUT(
      makeReq("http://x/api/invoices?id=legacy-2", {
        companyName: "Old Co",
        billTo: "Old Client",
        invoiceNumber: "INV-000043",
        invoiceDate: "2026-07-01",
        dueDate: "2026-07-15",
        currency: "INR",
        items: [{ description: "Consulting", quantity: 1, unitPrice: 100 }],
        discount: 0,
        cgst: 9,
        sgst: 9,
        convenienceCharge: 0,
      })
    );
    expect(res.status).toBe(200);
    const stored = store.get("legacy-2")!;
    expect(stored.total).toBe(118);
    expect(stored.documentKind).toBeUndefined();
    expect(stored.originalInvoice).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Proforma -> invoice, end to end                                         */
/* -------------------------------------------------------------------------- */

describe("converting an accepted proforma into an invoice", () => {
  it("takes a fresh number out of the INVOICE series and today's date", async () => {
    // An invoice already exists, so the conversion must land on /008 rather
    // than restarting, and must not touch the proforma's own PI/... serial.
    seed({
      _id: "inv-old",
      invoiceNumber: "INV/2026-27/007",
      invoiceNumberKey: "INV/2026-27/007",
      invoiceDate: "2026-07-01",
    });

    const created = await POST(
      makeReq("http://x/api/invoices", {
        ...baseBody,
        documentKind: "proforma",
        invoiceNumber: "PI/2026-27/004",
        invoiceDate: "2026-07-05",
        dueDate: "2026-07-19",
      })
    );
    expect(created.status).toBe(201);
    const { invoice: proforma } = (await created.json()) as {
      invoice: Record<string, unknown>;
    };

    // What the editor does when it is opened at `?convert=<id>`.
    const suggestion = (await (
      await GET(
        makeReq("http://x/api/invoices?suggest_number=1&date=2026-09-10&kind=invoice")
      )
    ).json()) as { invoiceNumber: string };
    expect(suggestion.invoiceNumber).toBe("INV/2026-27/008");

    const today = new Date("2026-09-10T00:00:00.000Z");
    const payload = mapFormStateToPayload(
      applyDocumentKindToDraft(
        buildDuplicateFormState(
          mapInvoiceRecordToFormState(
            proforma as unknown as Parameters<typeof mapInvoiceRecordToFormState>[0]
          ),
          { invoiceNumber: suggestion.invoiceNumber, today }
        ),
        { documentKind: "invoice" }
      )
    );

    const converted = await POST(makeReq("http://x/api/invoices", payload));
    expect(converted.status).toBe(201);
    const { invoice } = (await converted.json()) as {
      invoice: {
        documentKind?: string;
        invoiceNumber: string;
        invoiceDate: string;
        dueDate: string;
        billTo: string;
      };
    };

    // A real invoice, in the invoice series, dated today — not the proforma's
    // number and not the proforma's date.
    expect(invoice.documentKind).toBeUndefined();
    expect(invoice.invoiceNumber).toBe("INV/2026-27/008");
    expect(invoice.invoiceNumber).not.toBe("PI/2026-27/004");
    expect(invoice.invoiceDate).toBe("2026-09-10");
    expect(invoice.dueDate).toBe("2026-09-24");
    // Everything the client agreed to came across.
    expect(invoice.billTo).toBe("Client Co");

    // And the proforma is still there, unchanged — a conversion copies, it
    // does not consume.
    expect(store.get(proforma._id as string)?.invoiceNumber).toBe("PI/2026-27/004");
    expect(store.get(proforma._id as string)?.documentKind).toBe("proforma");
  });
});
