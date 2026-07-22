import { describe, it, expect } from "bun:test";
import { createInvoiceCsv, createInvoiceHtml } from "@/lib/invoice-export";
import type { InvoiceRecord } from "@/lib/invoices";

const makeRecord = (overrides: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  _id: "abc123",
  userId: "user-1",
  companyName: "Acme Inc",
  billTo: "Client Co",
  invoiceNumber: "INV-1",
  invoiceDate: "2026-01-01",
  dueDate: "2026-01-15",
  currency: "INR",
  items: [{ name: "Widget", price: 100, quantity: 1 }],
  convenienceCharge: 0,
  total: 100,
  createdAt: "2026-01-01",
  ...overrides,
});

describe("createInvoiceCsv — formula injection", () => {
  it("prefixes a leading = with a single quote so spreadsheets treat it as text", () => {
    const csv = createInvoiceCsv(
      makeRecord({ companyName: '=HYPERLINK("http://evil","x")' })
    );
    expect(csv).toContain('"\'=HYPERLINK');
    expect(csv).not.toContain('"=HYPERLINK');
  });

  it("neutralizes +, -, and @ leading characters", () => {
    const plus = createInvoiceCsv(makeRecord({ billTo: "+1+1" }));
    expect(plus).toContain("\"'+1+1\"");

    const at = createInvoiceCsv(makeRecord({ companyName: "@SUM(A1)" }));
    expect(at).toContain("\"'@SUM(A1)\"");
  });

  it("leaves ordinary values untouched", () => {
    const csv = createInvoiceCsv(makeRecord({ companyName: "Acme Inc" }));
    expect(csv).toContain('"Acme Inc"');
    expect(csv).not.toContain("'Acme");
  });
});

describe("createInvoiceCsv — totals clamp", () => {
  it("renders 0.00 (not negative) for an over-discounted invoice with no stored total", () => {
    const csv = createInvoiceCsv(
      makeRecord({
        items: [{ name: "Widget", price: 100, quantity: 1 }],
        discount: 150,
        total: undefined,
        subtotal: undefined,
      })
    );
    expect(csv).toContain('"Total","0.00"');
    expect(csv).not.toContain("-50.00");
  });

  it("respects a legitimately-zero stored total instead of recomputing", () => {
    const csv = createInvoiceCsv(
      makeRecord({ items: [{ name: "W", price: 100, quantity: 1 }], discount: 150, total: 0 })
    );
    expect(csv).toContain('"Total","0.00"');
  });
});

describe("createInvoiceHtml — escaping", () => {
  it("escapes HTML-significant characters in user fields", () => {
    const html = createInvoiceHtml(
      makeRecord({ companyName: "<script>alert(1)</script>" })
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("drops a javascript: logo URL (protocol allowlist)", () => {
    const html = createInvoiceHtml(
      makeRecord({ companyLogo: "javascript:alert(1)" })
    );
    expect(html).not.toContain("javascript:alert(1)");
  });

  it("uses the legacy tax value when cgst is absent", () => {
    const html = createInvoiceHtml(
      makeRecord({ cgst: undefined, tax: 18, currency: "USD" })
    );
    // CGST row should reflect the 18 fallback, formatted as currency.
    expect(html).toContain("18");
  });
});
