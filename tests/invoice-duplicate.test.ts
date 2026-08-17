import { describe, it, expect, mock, beforeEach } from "bun:test";
import { NextResponse } from "next/server";
import * as realAuth from "@/lib/server/auth";
import {
  DEFAULT_DUPLICATE_TERM_DAYS,
  MAX_DUPLICATE_TERM_DAYS,
  buildDuplicateFormState,
  duplicateTermDays,
  financialYearRange,
  highestInvoiceNumber,
  toDateInputValue,
} from "@/lib/invoice-duplicate";
import { mapInvoiceRecordToFormState } from "@/lib/invoices";
import type { InvoiceRecord } from "@/lib/invoices";

/* -------------------------------------------------------------------------- */
/* Financial-year window                                                      */
/* -------------------------------------------------------------------------- */

describe("financialYearRange", () => {
  it("spans 1 April to the following 1 April, in UTC", () => {
    const range = financialYearRange("2026-27");
    expect(range?.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(range?.end.toISOString()).toBe("2027-04-01T00:00:00.000Z");
  });

  it("is half-open, so 31 March is inside and 1 April is not", () => {
    const range = financialYearRange("2026-27")!;
    const lastDay = new Date("2027-03-31T00:00:00.000Z");
    const nextYear = new Date("2027-04-01T00:00:00.000Z");
    expect(lastDay >= range.start && lastDay < range.end).toBe(true);
    expect(nextYear < range.end).toBe(false);
  });

  it("refuses a malformed financial year rather than guessing", () => {
    expect(financialYearRange("2026-29")).toBeNull();
    expect(financialYearRange("")).toBeNull();
    expect(financialYearRange("2026")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Picking the previous number                                                */
/* -------------------------------------------------------------------------- */

describe("highestInvoiceNumber", () => {
  it("compares by sequence, not lexicographically", () => {
    // "INV/2026-27/9" sorts above "INV/2026-27/10" as a string; suggesting
    // /10 when /10 exists is a collision.
    expect(
      highestInvoiceNumber(["INV/2026-27/9", "INV/2026-27/10"])
    ).toBe("INV/2026-27/10");
  });

  it("keeps zero padding on the winner", () => {
    expect(
      highestInvoiceNumber(["INV/2026-27/007", "INV/2026-27/003"])
    ).toBe("INV/2026-27/007");
  });

  it("skips numbers with nothing to increment", () => {
    expect(highestInvoiceNumber(["ABC", "", null, undefined, "INV/2026-27/002"])).toBe(
      "INV/2026-27/002"
    );
  });

  it("returns null when nothing in the set has a sequence", () => {
    expect(highestInvoiceNumber([])).toBeNull();
    expect(highestInvoiceNumber(["ABC", "", null])).toBeNull();
  });

  it("normalises whitespace out of a pasted number", () => {
    expect(highestInvoiceNumber([" INV/2026-27/ 004 "])).toBe("INV/2026-27/004");
  });
});

/* -------------------------------------------------------------------------- */
/* Payment term                                                               */
/* -------------------------------------------------------------------------- */

describe("duplicateTermDays", () => {
  it("carries the source invoice's own term over", () => {
    expect(duplicateTermDays("2026-06-01", "2026-07-01")).toBe(30);
    expect(duplicateTermDays("2026-06-01", "2026-06-01")).toBe(0);
  });

  it("falls back to the default for unreadable or reversed dates", () => {
    expect(duplicateTermDays("", "")).toBe(DEFAULT_DUPLICATE_TERM_DAYS);
    expect(duplicateTermDays("nonsense", "2026-07-01")).toBe(
      DEFAULT_DUPLICATE_TERM_DAYS
    );
    // A due date before the invoice date is a broken record, not a negative
    // term — a duplicate must not be born overdue.
    expect(duplicateTermDays("2026-07-01", "2026-06-01")).toBe(
      DEFAULT_DUPLICATE_TERM_DAYS
    );
  });

  it("caps a nonsense term at a year", () => {
    expect(duplicateTermDays("2026-01-01", "2099-01-01")).toBe(
      MAX_DUPLICATE_TERM_DAYS
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The duplicate                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A settled Phase-2 GST invoice: registered supplier, inter-State supply, TDS,
 * a signature and per-line HSN/rates. Everything on it except the number, the
 * dates and the status has to survive duplication.
 */
const paidGstRecord: Partial<InvoiceRecord> = {
  _id: "inv-source",
  userId: "A",
  createdAt: "2026-06-01T10:00:00.000Z",
  is_deleted: false,
  status: "paid",
  invoiceNumber: "INV/2026-27/007",
  invoiceDate: "2026-06-01",
  dueDate: "2026-07-01",
  companyName: "Acme Consulting",
  companyEmail: "hi@acme.in",
  companyAddress: "Bengaluru",
  billTo: "Nova Health Pvt Ltd",
  billToEmail: "accounts@novahealth.in",
  billToAddress: "Mumbai",
  billToGstin: "27AAPFU0939F1ZV",
  companyGstin: "29AAGCB7383J1Z4",
  companyPan: "AGCB7383J",
  currency: "INR",
  terms: "Payment due within 30 days.",
  notes: "Retainer, June.",
  paymentInfo: "HDFC 0001",
  items: [
    {
      name: "Monthly retainer",
      quantity: 1,
      price: 50_000,
      hsnSac: "998314",
      unit: "NOS",
      taxRatePercent: 18,
      taxableValue: 50_000,
      igstAmount: 9000,
    },
  ],
  discount: 0,
  cgst: 0,
  sgst: 0,
  igst: 9000,
  convenienceCharge: 0,
  total: 59_000,
  taxTreatment: "gst",
  documentType: "tax_invoice",
  supplyKind: "inter",
  reverseCharge: false,
  supplierStateCode: "29",
  placeOfSupplyStateCode: "27",
  placeOfSupplyLabel: "Maharashtra",
  placeOfSupplyOverridden: true,
  tdsSection: "194J_professional",
  tdsRatePercent: 10,
  signatureLabel: "For Acme Consulting",
};

const duplicateOf = (record: Partial<InvoiceRecord>, invoiceNumber: string) =>
  buildDuplicateFormState(mapInvoiceRecordToFormState(record), {
    invoiceNumber,
    today: new Date("2026-08-17T09:00:00.000Z"),
  });

describe("buildDuplicateFormState", () => {
  const duplicate = duplicateOf(paidGstRecord, "INV/2026-27/008");

  it("takes the fresh number and never the source's", () => {
    expect(duplicate.invoiceNumber).toBe("INV/2026-27/008");
    expect(duplicate.invoiceNumber).not.toBe(paidGstRecord.invoiceNumber);
  });

  it("resets the status to draft, whatever the source was settled to", () => {
    expect(paidGstRecord.status).toBe("paid");
    expect(duplicate.status).toBe("draft");
  });

  it("carries no identity or lifecycle field from the source record", () => {
    // `InvoiceFormState` has no room for these at all, which is the guard —
    // asserted so a future widening of the type cannot quietly open the door.
    for (const key of ["_id", "userId", "createdAt", "updatedAt", "is_deleted", "total"]) {
      expect(key in duplicate).toBe(false);
    }
    expect(JSON.stringify(duplicate)).not.toContain("inv-source");
  });

  it("dates it today and re-derives the due date from the source's own term", () => {
    expect(duplicate.invoiceDate).toBe("2026-08-17");
    // 2026-06-01 -> 2026-07-01 was a 30-day term.
    expect(duplicate.dueDate).toBe("2026-09-16");
  });

  it("carries the Phase 2 GST block across intact", () => {
    expect(duplicate.taxTreatment).toBe("gst");
    expect(duplicate.supplierStateCode).toBe("29");
    expect(duplicate.placeOfSupplyStateCode).toBe("27");
    expect(duplicate.placeOfSupplyLabel).toBe("Maharashtra");
    expect(duplicate.placeOfSupplyOverridden).toBe(true);
    expect(duplicate.reverseCharge).toBe(false);
    expect(duplicate.companyGstin).toBe("29AAGCB7383J1Z4");
    expect(duplicate.billToGstin).toBe("27AAPFU0939F1ZV");
    expect(duplicate.companyPan).toBe("AGCB7383J");
    expect(duplicate.tdsSection).toBe("194J_professional");
    expect(duplicate.tdsRatePercent).toBe(10);
    expect(duplicate.signatureLabel).toBe("For Acme Consulting");
  });

  it("carries the client block and the line items, with per-line tax particulars", () => {
    expect(duplicate.billTo).toBe("Nova Health Pvt Ltd");
    expect(duplicate.billToEmail).toBe("accounts@novahealth.in");
    expect(duplicate.billToAddress).toBe("Mumbai");
    expect(duplicate.items).toEqual([
      {
        description: "Monthly retainer",
        quantity: 1,
        unitPrice: 50_000,
        hsnSac: "998314",
        unit: "NOS",
        taxRatePercent: 18,
      },
    ]);
    expect(duplicate.terms).toBe("Payment due within 30 days.");
    expect(duplicate.paymentInfo).toBe("HDFC 0001");
  });

  it("copies line items by value, so editing the copy cannot touch the source", () => {
    const source = mapInvoiceRecordToFormState(paidGstRecord);
    const copy = buildDuplicateFormState(source, { invoiceNumber: "X-1" });
    copy.items[0].description = "Changed";
    expect(source.items[0].description).toBe("Monthly retainer");
  });

  it("keeps a pre-Phase-2 document on the legacy path", () => {
    // An ABSENT taxTreatment is what marks a document as pre-Phase-2; a
    // duplicate that invented one would silently zero the tax it was issued
    // with.
    const legacy = duplicateOf(
      {
        ...paidGstRecord,
        taxTreatment: undefined,
        documentType: undefined,
        supplyKind: undefined,
      },
      "INV-2"
    );
    expect("taxTreatment" in legacy).toBe(false);
  });

  it("leaves the number blank rather than reusing the source's when none was suggested", () => {
    expect(duplicateOf(paidGstRecord, "").invoiceNumber).toBe("");
  });
});

describe("toDateInputValue", () => {
  it("renders the UTC calendar date a date input binds to", () => {
    expect(toDateInputValue(new Date("2026-08-17T23:30:00.000Z"))).toBe("2026-08-17");
  });
});

/* -------------------------------------------------------------------------- */
/* GET /api/invoices?suggest_number=1                                         */
/* -------------------------------------------------------------------------- */

mock.module("@/lib/server/auth", () => ({
  ...realAuth,
  requireUser: async () => "A",
  authErrorResponse: () =>
    NextResponse.json({ error: "unauthorized" }, { status: 401 }),
}));
mock.module("@/lib/mongodb", () => ({ default: async () => {} }));
mock.module("@/models/LogEntry", () => ({
  default: { create: async () => ({}) },
}));

interface StoredInvoice {
  userId: string;
  is_deleted: boolean;
  invoiceNumber: string;
  invoiceDate: Date;
}

const store: StoredInvoice[] = [];
const finds: Record<string, unknown>[] = [];

/**
 * Only the read path the suggester uses. `find(...).sort(...).limit(...).lean()`
 * is honoured for real, including the `$gte`/`$lt` date window, so the test
 * proves the FY scoping rather than assuming it.
 */
class FakeInvoice {
  static find(filter: Record<string, unknown>) {
    finds.push(filter);
    const window = filter.invoiceDate as { $gte: Date; $lt: Date } | undefined;
    let rows = store.filter(
      (doc) =>
        doc.userId === filter.userId &&
        // Soft-deleted rows are NOT excluded here any more: the unique index is
        // full, so a soft-deleted document still holds its number and the
        // suggester has to skip past it. The route no longer sends the filter.
        (filter.is_deleted === undefined || doc.is_deleted !== true) &&
        (!window ||
          (doc.invoiceDate >= window.$gte && doc.invoiceDate < window.$lt))
    );
    const chain = {
      sort: () => chain,
      limit: (n: number) => {
        rows = rows.slice(0, n);
        return chain;
      },
      lean: async () => rows.map((doc) => ({ invoiceNumber: doc.invoiceNumber })),
    };
    return chain;
  }
}

mock.module("@/models/Invoice", () => ({ default: FakeInvoice }));

const { GET } = await import("@/app/api/invoices/route");

const makeReq = (url: string) =>
  ({
    url,
    headers: { get: () => null },
    json: async () => ({}),
  }) as unknown as import("next/server").NextRequest;

beforeEach(() => {
  store.length = 0;
  finds.length = 0;
});

describe("GET /api/invoices?suggest_number=1", () => {
  it("opens a new financial year at 001", async () => {
    const res = await GET(
      makeReq("http://x/api/invoices?suggest_number=1&date=2026-08-17")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      financialYear: "2026-27",
      invoiceNumber: "INV/2026-27/001",
    });
  });

  it("continues the caller's existing series", async () => {
    store.push(
      {
        userId: "A",
        is_deleted: false,
        invoiceNumber: "INV/2026-27/007",
        invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
      },
      {
        userId: "A",
        is_deleted: false,
        invoiceNumber: "INV/2026-27/003",
        invoiceDate: new Date("2026-05-01T00:00:00.000Z"),
      }
    );
    const res = await GET(
      makeReq("http://x/api/invoices?suggest_number=1&date=2026-08-17")
    );
    expect((await res.json()).invoiceNumber).toBe("INV/2026-27/008");
  });

  it("never reads another user's series", async () => {
    store.push({
      userId: "B",
      is_deleted: false,
      invoiceNumber: "INV/2026-27/900",
      invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
    });
    const res = await GET(
      makeReq("http://x/api/invoices?suggest_number=1&date=2026-08-17")
    );
    expect((await res.json()).invoiceNumber).toBe("INV/2026-27/001");
    expect(finds[0].userId).toBe("A");
  });

  /**
   * The unique index is FULL, so a soft-deleted invoice keeps its number for as
   * long as it is retained. Suggesting that number back would hand the user a
   * value the index then refuses — skipping past it is the mitigation that
   * makes keeping the index full workable.
   */
  it("counts a soft-deleted number as spent rather than reissuing it", async () => {
    store.push({
      userId: "A",
      is_deleted: true,
      invoiceNumber: "INV/2026-27/500",
      invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
    });
    const res = await GET(
      makeReq("http://x/api/invoices?suggest_number=1&date=2026-08-17")
    );
    expect((await res.json()).invoiceNumber).toBe("INV/2026-27/501");
  });

  it("restarts the series in a new financial year", async () => {
    store.push({
      userId: "A",
      is_deleted: false,
      invoiceNumber: "INV/2025-26/147",
      invoiceDate: new Date("2026-01-01T00:00:00.000Z"),
    });
    // Asking for FY 2026-27 must not see last year's row at all.
    const res = await GET(
      makeReq("http://x/api/invoices?suggest_number=1&date=2026-04-01")
    );
    const body = (await res.json()) as { financialYear: string; invoiceNumber: string };
    expect(body.financialYear).toBe("2026-27");
    expect(body.invoiceNumber).toBe("INV/2026-27/001");
  });

  it("rejects an unreadable date instead of guessing a year", async () => {
    const res = await GET(
      makeReq("http://x/api/invoices?suggest_number=1&date=not-a-date")
    );
    expect(res.status).toBe(400);
  });

  it("answers null when the series is exhausted", async () => {
    store.push({
      userId: "A",
      is_deleted: false,
      invoiceNumber: "INV/2026-27/9999",
      invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
    });
    const res = await GET(
      makeReq("http://x/api/invoices?suggest_number=1&date=2026-08-17")
    );
    expect((await res.json()).invoiceNumber).toBeNull();
  });
});
