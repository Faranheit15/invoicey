import { describe, it, expect } from "bun:test";
import {
  computeTotals,
  resolveRecordAmounts,
  buildTotalsRows,
  validateInvoice,
} from "@/lib/invoice-domain";
import type { InvoiceRecord } from "@/lib/invoices";

describe("computeTotals", () => {
  it("applies the standard formula and clamps at 0", () => {
    expect(
      computeTotals({
        items: [{ quantity: 2, unitPrice: 100 }],
        discount: 250,
        cgst: 0,
        sgst: 0,
        convenienceCharge: 0,
      }).total
    ).toBe(0);
  });

  it("matches the previous inline server formula for a normal invoice", () => {
    const t = computeTotals({
      items: [
        { quantity: 2, unitPrice: 100 },
        { quantity: 1, unitPrice: 50 },
      ],
      discount: 25,
      cgst: 10,
      sgst: 10,
      convenienceCharge: 5,
    });
    expect(t).toEqual({
      subtotal: 250,
      discount: 25,
      cgst: 10,
      sgst: 10,
      convenienceCharge: 5,
      total: 250,
    });
  });
});

describe("resolveRecordAmounts", () => {
  const base: InvoiceRecord = {
    _id: "1",
    userId: "u",
    companyName: "Acme",
    billTo: "Client",
    invoiceNumber: "INV-1",
    invoiceDate: "2026-01-01",
    dueDate: "2026-01-15",
    currency: "INR",
    items: [{ name: "W", price: 100, quantity: 1 }],
    convenienceCharge: 0,
    total: 100,
    createdAt: "2026-01-01",
  };

  it("honors a legitimately-zero stored total (does not recompute)", () => {
    const amounts = resolveRecordAmounts({ ...base, discount: 150, total: 0 });
    expect(amounts.total).toBe(0);
  });

  it("recomputes with a clamp when total is absent (legacy)", () => {
    const amounts = resolveRecordAmounts({
      ...base,
      discount: 150,
      total: undefined as unknown as number,
      subtotal: undefined,
    });
    expect(amounts.total).toBe(0);
  });

  it("falls back to legacy `tax` for cgst", () => {
    const amounts = resolveRecordAmounts({
      ...base,
      cgst: undefined,
      tax: 18,
    });
    expect(amounts.cgst).toBe(18);
  });
});

describe("buildTotalsRows", () => {
  it("produces the fixed ordered, labeled rows", () => {
    const rows = buildTotalsRows({
      subtotal: 100,
      discount: 10,
      cgst: 5,
      sgst: 5,
      convenienceCharge: 2,
      total: 102,
    });
    expect(rows.map((r) => r.label)).toEqual([
      "Subtotal",
      "Discount",
      "CGST",
      "SGST",
      "Service Charge",
      "Total",
    ]);
    expect(rows.find((r) => r.label === "Discount")?.kind).toBe("discount");
    expect(rows.find((r) => r.label === "Total")?.kind).toBe("grand");
  });
});

describe("validateInvoice", () => {
  const valid = {
    companyName: "Acme",
    billTo: "Client",
    invoiceNumber: "INV-1",
    invoiceDate: "2026-01-01",
    dueDate: "2026-01-15",
    items: [{ description: "Widget" }],
  };

  it("returns null for a valid invoice", () => {
    expect(validateInvoice(valid)).toBeNull();
  });

  it("flags each required field", () => {
    expect(validateInvoice({ ...valid, companyName: " " })).toBe(
      "Company name is required"
    );
    expect(validateInvoice({ ...valid, billTo: "" })).toBe("Bill to is required");
    expect(validateInvoice({ ...valid, invoiceNumber: "" })).toBe(
      "Invoice number is required"
    );
    expect(validateInvoice({ ...valid, invoiceDate: "not-a-date" })).toBe(
      "Invoice date is invalid"
    );
    expect(validateInvoice({ ...valid, dueDate: "" })).toBe(
      "Due date is invalid"
    );
    expect(validateInvoice({ ...valid, items: [{ description: "  " }] })).toBe(
      "At least one line item is required"
    );
  });

  it("accepts DB-shaped items (name instead of description)", () => {
    expect(validateInvoice({ ...valid, items: [{ name: "Widget" }] })).toBeNull();
  });
});
