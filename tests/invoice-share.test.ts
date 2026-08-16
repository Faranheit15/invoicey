import { describe, it, expect } from "bun:test";
import {
  buildShareMessage,
  buildWhatsAppUrl,
  normalizeWhatsAppPhone,
} from "@/components/invoice-share";
import type { InvoiceRecord } from "@/lib/invoices";

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

describe("normalizeWhatsAppPhone", () => {
  it("adds +91 to an Indian mobile number, however it was written", () => {
    ["9876543210", "98765 43210", "98765-43210", "09876543210"].forEach(
      (input) => expect(normalizeWhatsAppPhone(input)).toBe("919876543210")
    );
    expect(normalizeWhatsAppPhone("+91 98765 43210")).toBe("919876543210");
    expect(normalizeWhatsAppPhone("919876543210")).toBe("919876543210");
    expect(normalizeWhatsAppPhone("0091 98765 43210")).toBe("919876543210");
  });

  it("leaves an explicitly international number alone", () => {
    expect(normalizeWhatsAppPhone("+1 415 555 0132")).toBe("14155550132");
    expect(normalizeWhatsAppPhone("+44 20 7946 0958")).toBe("442079460958");
  });

  it("returns null rather than guessing — a wrong guess opens a chat with a stranger", () => {
    [
      "",
      "   ",
      "12345",
      "5432109876", // Indian mobiles never start below 6
      "1234567890123456789",
      "not a phone",
      "+1",
    ].forEach((input) => expect(normalizeWhatsAppPhone(input)).toBeNull());
    expect(normalizeWhatsAppPhone(undefined)).toBeNull();
  });
});

describe("buildShareMessage", () => {
  it("states the invoice's facts and claims nothing about delivery", () => {
    const message = buildShareMessage({
      invoice: makeRecord(),
      total: 1180,
      upiVpa: "acme@okhdfcbank",
    });
    expect(message).toContain("Invoice INV/2026-27/001 from Acme Inc");
    expect(message).toContain("Amount: ₹1,180.00");
    expect(message).toContain("Due:");
    expect(message).toContain("Pay by UPI: acme@okhdfcbank");
    // `PRODUCT.md`: the product never sends anything. The draft the user is
    // about to send in their own voice must not say we did.
    expect(message.toLowerCase()).not.toContain("we have sent");
    expect(message.toLowerCase()).not.toContain("invoicey");
  });

  it("omits the UPI line for a currency UPI cannot settle", () => {
    const message = buildShareMessage({
      invoice: makeRecord({ currency: "USD" }),
      total: 1180,
      upiVpa: "acme@okhdfcbank",
    });
    expect(message).not.toContain("Pay by UPI");
    expect(message).toContain("$1,180.00");
  });

  it("omits the UPI line when the VPA is not valid", () => {
    const message = buildShareMessage({
      invoice: makeRecord(),
      total: 100,
      upiVpa: "acme@",
    });
    expect(message).not.toContain("Pay by UPI");
  });

  it("survives an invoice with almost nothing on it", () => {
    const message = buildShareMessage({
      invoice: makeRecord({ invoiceNumber: "", companyName: "", dueDate: "" }),
      total: 0,
    });
    expect(message.startsWith("Invoice")).toBe(true);
    expect(message).not.toContain("undefined");
    expect(message).not.toContain("Due:");
  });
});

describe("buildWhatsAppUrl", () => {
  it("encodes the whole message, newlines included", () => {
    const url = buildWhatsAppUrl({
      message: "Invoice INV/1 from Smith & Sons\nAmount: ₹1,180.00",
    });
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(url).toContain("%0A");
    expect(url).toContain("%26");
    expect(url).not.toContain(" ");
    expect(decodeURIComponent(url.split("?text=")[1])).toBe(
      "Invoice INV/1 from Smith & Sons\nAmount: ₹1,180.00"
    );
  });

  it("addresses a recipient when the number is recognisable", () => {
    expect(buildWhatsAppUrl({ message: "hi", phone: "98765 43210" })).toBe(
      "https://wa.me/919876543210?text=hi"
    );
  });

  it("drops an unrecognisable number instead of dialling it", () => {
    expect(buildWhatsAppUrl({ message: "hi", phone: "12345" })).toBe(
      "https://wa.me/?text=hi"
    );
  });

  it("is a wa.me hand-off and nothing else — no API, no send endpoint", () => {
    const url = buildWhatsAppUrl({ message: "hi", phone: "9876543210" });
    expect(url.startsWith("https://wa.me/")).toBe(true);
    expect(url).not.toContain("api.whatsapp.com/send");
    expect(url).not.toContain("graph.facebook.com");
  });
});
