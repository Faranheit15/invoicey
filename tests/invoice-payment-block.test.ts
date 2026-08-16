import { describe, it, expect } from "bun:test";
import {
  buildPaymentBlock,
  createInvoiceHtml,
  type InvoicePaymentDetails,
} from "@/lib/invoice-export";
import type { InvoiceRecord } from "@/lib/invoices";

/**
 * The pay block on the printed invoice: a QR that must not be wrong, and a bank
 * block that must not be a hole in the escaping.
 */

const makeRecord = (overrides: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  _id: "abc123",
  userId: "user-1",
  companyName: "Acme Inc",
  billTo: "Client Co",
  invoiceNumber: "INV/2026-27/001",
  invoiceDate: "2026-01-01",
  dueDate: "2026-01-15",
  currency: "INR",
  items: [{ name: "Widget", price: 1000, quantity: 1 }],
  convenienceCharge: 0,
  total: 1000,
  createdAt: "2026-01-01",
  ...overrides,
});

const payment: InvoicePaymentDetails = {
  upiVpa: "acme@okhdfcbank",
  payeeName: "Acme Inc",
  bankName: "HDFC Bank",
  bankAccountName: "Acme Inc",
  bankAccountNumber: "0000 1111 2222",
  bankIfsc: "hdfc0000123",
};

describe("buildPaymentBlock — when a QR is offered at all", () => {
  it("builds a UPI link for an INR invoice with a valid VPA", () => {
    const block = buildPaymentBlock(makeRecord(), payment, 1180)!;
    expect(block.upi).not.toBeNull();
    expect(block.upi!.uri).toContain("pa=acme%40okhdfcbank");
    expect(block.upi!.uri).toContain("am=1180.00");
    expect(block.upi!.uri).toContain("cu=INR");
    // The invoice number reaches the payer both as the note and the reference.
    expect(block.upi!.uri).toContain("tn=Invoice%20INV%2F2026-27%2F001");
    expect(block.upi!.uri).toContain("tr=INV-2026-27-001");
  });

  it("offers NO QR for a non-INR invoice — the link cannot carry the currency", () => {
    ["USD", "EUR", "GBP", "AED"].forEach((currency) => {
      const block = buildPaymentBlock(
        makeRecord({ currency }),
        payment,
        1180
      )!;
      expect(block.upi).toBeNull();
      // The bank particulars remain: an overseas client still pays by wire.
      expect(block.rows.length).toBeGreaterThan(0);
      expect(block.rows.map(([label]) => label)).not.toContain("UPI ID");
    });
  });

  it("offers no QR when the VPA is not valid", () => {
    const block = buildPaymentBlock(
      makeRecord(),
      { ...payment, upiVpa: "acme@" },
      1180
    )!;
    expect(block.upi).toBeNull();
  });

  it("returns nothing at all when there is no payment identity", () => {
    expect(buildPaymentBlock(makeRecord(), undefined, 1180)).toBeNull();
    expect(buildPaymentBlock(makeRecord(), {}, 1180)).toBeNull();
    expect(
      buildPaymentBlock(makeRecord(), { upiVpa: "not-a-vpa" }, 1180)
    ).toBeNull();
  });

  it("normalizes the bank particulars it prints", () => {
    const block = buildPaymentBlock(makeRecord(), payment, 1180)!;
    expect(block.rows).toEqual([
      ["UPI ID", "acme@okhdfcbank"],
      ["Account name", "Acme Inc"],
      ["Bank", "HDFC Bank"],
      ["Account number", "000011112222"],
      ["IFSC", "HDFC0000123"],
    ]);
  });

  it("falls back to the invoice's company name as the payee", () => {
    const block = buildPaymentBlock(
      makeRecord({ companyName: "Bright Studio" }),
      { upiVpa: "acme@okhdfcbank" },
      500
    )!;
    expect(block.upi!.payeeName).toBe("Bright Studio");
  });
});

describe("createInvoiceHtml — the pay block on the page", () => {
  it("prints a QR and the bank block for an INR invoice", () => {
    const html = createInvoiceHtml(makeRecord(), { payment });
    expect(html).toContain("How to pay");
    expect(html).toContain("<svg");
    expect(html).toContain("Scan with any UPI app");
    expect(html).toContain("acme@okhdfcbank");
    expect(html).toContain("HDFC0000123");
  });

  it("prints nothing at all when no payment identity is configured", () => {
    const html = createInvoiceHtml(makeRecord());
    expect(html).not.toContain("How to pay");
    expect(html).not.toContain("Scan with any UPI app");
  });

  it("prints the bank block but no QR on a foreign-currency invoice", () => {
    const html = createInvoiceHtml(makeRecord({ currency: "USD" }), {
      payment,
    });
    expect(html).toContain("How to pay");
    expect(html).toContain("HDFC0000123");
    expect(html).not.toContain("Scan with any UPI app");
    expect(html).not.toContain("<svg");
  });

  it("prints the QR alone when there are no bank particulars", () => {
    const html = createInvoiceHtml(makeRecord(), {
      payment: { upiVpa: "acme@okhdfcbank" },
    });
    expect(html).toContain("Scan with any UPI app");
    expect(html).toContain("<svg");
  });

  it("escapes the bank block, which is user-typed text in a raw HTML string", () => {
    const html = createInvoiceHtml(makeRecord(), {
      payment: {
        upiVpa: "acme@okhdfcbank",
        bankName: '<script>alert("x")</script>',
        bankAccountName: "Smith & Sons \"Ltd\"",
      },
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Smith &amp; Sons");
  });

  it("keeps the QR's own markup inert — geometry and a background, nothing else", () => {
    const html = createInvoiceHtml(makeRecord(), { payment });
    const svg = html.slice(html.indexOf("<svg"), html.indexOf("</svg>") + 6);
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("onload");
    // The URI itself is geometry, not text: it must not appear as markup.
    expect(svg).not.toContain("upi://");
  });

  it("does not change an invoice printed before any of this existed", () => {
    const before = createInvoiceHtml(makeRecord());
    const after = createInvoiceHtml(makeRecord(), { payment: {} });
    expect(after).toBe(before);
  });
});
