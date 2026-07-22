import { describe, it, expect } from "bun:test";
import {
  calculateInvoiceTotals,
  mapInvoiceRecordToFormState,
  mapFormStateToPayload,
  getInvoiceStatus,
  formatCurrency,
  createDefaultInvoiceFormState,
  type InvoiceRecord,
  type InvoiceFormState,
} from "@/lib/invoices";

const items = (
  rows: Array<{ description?: string; quantity: number; unitPrice: number }>
) =>
  rows.map((r) => ({
    description: r.description ?? "Item",
    quantity: r.quantity,
    unitPrice: r.unitPrice,
  }));

describe("calculateInvoiceTotals", () => {
  it("sums line items and applies the standard formula", () => {
    const result = calculateInvoiceTotals({
      items: items([
        { quantity: 2, unitPrice: 100 },
        { quantity: 1, unitPrice: 50 },
      ]),
      discount: 25,
      cgst: 10,
      sgst: 10,
      convenienceCharge: 5,
    });
    expect(result.subtotal).toBe(250);
    // 250 - 25 + 10 + 10 + 5
    expect(result.total).toBe(250);
  });

  it("clamps an over-discounted total to 0 (never negative)", () => {
    const result = calculateInvoiceTotals({
      items: items([{ quantity: 1, unitPrice: 100 }]),
      discount: 150,
      cgst: 0,
      sgst: 0,
      convenienceCharge: 0,
    });
    expect(result.subtotal).toBe(100);
    expect(result.total).toBe(0);
  });

  it("clamps negative quantities and prices to 0 per line", () => {
    const result = calculateInvoiceTotals({
      items: items([
        { quantity: -5, unitPrice: 100 },
        { quantity: 2, unitPrice: -10 },
      ]),
      discount: 0,
      cgst: 0,
      sgst: 0,
      convenienceCharge: 0,
    });
    expect(result.subtotal).toBe(0);
    expect(result.total).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    const result = calculateInvoiceTotals({
      items: items([{ quantity: 3, unitPrice: 0.1 }]),
      discount: 0,
      cgst: 0,
      sgst: 0,
      convenienceCharge: 0,
    });
    expect(result.subtotal).toBe(0.3);
    expect(result.total).toBe(0.3);
  });
});

describe("mapInvoiceRecordToFormState (legacy tax fallback)", () => {
  const base: Partial<InvoiceRecord> = {
    companyName: "Acme",
    billTo: "Client",
    invoiceNumber: "INV-1",
    invoiceDate: "2026-01-01",
    dueDate: "2026-01-15",
    currency: "INR",
    items: [{ name: "Widget", price: 100, quantity: 2 }],
  };

  it("falls back to legacy `tax` when cgst is absent (un-migrated document)", () => {
    const form = mapInvoiceRecordToFormState({ ...base, tax: 18 });
    expect(form.cgst).toBe(18);
    expect(form.sgst).toBe(0);
  });

  it("prefers cgst over legacy tax when both exist", () => {
    const form = mapInvoiceRecordToFormState({ ...base, cgst: 9, tax: 18 });
    expect(form.cgst).toBe(9);
  });

  it("renames DB item fields (name/price) to form fields (description/unitPrice)", () => {
    const form = mapInvoiceRecordToFormState(base);
    expect(form.items[0]).toEqual({
      description: "Widget",
      quantity: 2,
      unitPrice: 100,
    });
  });
});

describe("mapFormStateToPayload", () => {
  it("trims strings and clamps numbers to non-negative", () => {
    const form: InvoiceFormState = {
      ...createDefaultInvoiceFormState(),
      companyName: "  Acme  ",
      discount: -5,
      items: [{ description: "  A  ", quantity: -2, unitPrice: -1 }],
    };
    const payload = mapFormStateToPayload(form);
    expect(payload.companyName).toBe("Acme");
    expect(payload.discount).toBe(0);
    expect(payload.items[0].quantity).toBe(1);
    expect(payload.items[0].unitPrice).toBe(0);
    expect(payload.items[0].description).toBe("A");
  });
});

describe("getInvoiceStatus", () => {
  it("returns the explicit status when present", () => {
    expect(getInvoiceStatus({ status: "paid" })).toBe("paid");
  });

  it("infers overdue from a past due date when no status is set", () => {
    expect(getInvoiceStatus({ dueDate: "2000-01-01" })).toBe("overdue");
  });

  it("defaults to sent for a future due date when no status is set", () => {
    expect(getInvoiceStatus({ dueDate: "2999-01-01" })).toBe("sent");
  });
});

describe("formatCurrency", () => {
  it("formats zero and falsy amounts safely", () => {
    expect(formatCurrency(0, "USD")).toContain("0");
    expect(formatCurrency(NaN, "USD")).toContain("0");
  });
});
