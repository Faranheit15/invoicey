import { formatCurrency, formatDateLong, type InvoiceRecord } from "@/lib/invoices";
import { isValidVpa, normalizeVpa } from "@/lib/upi";

/**
 * The text and the links behind the share buttons. No React, no DOM — the
 * component next door is the adapter, and everything decidable lives here so
 * it can be asserted directly (`tests/invoice-share.test.ts`).
 *
 * THE LINE THIS FEATURE SITS ON. `PRODUCT.md`: "Delivery is the user's own…
 * Invoicey does not send invoices; it produces files", and "The product does
 * not send email, take payments, or issue reminders." Everything here is a
 * HAND-OFF: it opens the user's own WhatsApp with a draft in the composer, and
 * the user presses send. No message leaves this app, no recipient is contacted
 * by us, and no copy anywhere may say or imply otherwise — not "sent",
 * not "delivered", not "we'll notify your client".
 */

/* -------------------------------------------------------------------------- */
/* Phone numbers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * `wa.me/<number>` wants digits only, with a country code and no `+`.
 *
 * India is assumed only when the number is unmistakably Indian — ten digits
 * starting 6-9, with or without a leading 0 or a 91 already on the front. A
 * number written internationally (`+`, or a `00` prefix) is taken at its word.
 * Anything else returns null, and the caller falls back to a link with no
 * recipient: the user picks the contact in WhatsApp, which is a small
 * inconvenience. Guessing wrong opens a chat with a STRANGER holding their
 * client's invoice, which is not.
 */
export const normalizeWhatsAppPhone = (
  raw: string | undefined | null
): string | null => {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return null;
  }
  const isInternational = trimmed.startsWith("+") || trimmed.startsWith("00");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  if (isInternational) {
    const withoutTrunk = trimmed.startsWith("00") ? digits.slice(2) : digits;
    return withoutTrunk.length >= 8 && withoutTrunk.length <= 15
      ? withoutTrunk
      : null;
  }

  // 91 already present, e.g. "919876543210".
  if (digits.length === 12 && digits.startsWith("91")) {
    return /^[6-9]/.test(digits.slice(2)) ? digits : null;
  }
  // Domestic trunk prefix, e.g. "09876543210".
  if (digits.length === 11 && digits.startsWith("0")) {
    return /^[6-9]/.test(digits.slice(1)) ? `91${digits.slice(1)}` : null;
  }
  // A plain Indian mobile number.
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return `91${digits}`;
  }
  return null;
};

/* -------------------------------------------------------------------------- */
/* The message                                                                 */
/* -------------------------------------------------------------------------- */

export interface ShareMessageInput {
  invoice: InvoiceRecord;
  /** Invoice total, already resolved by the caller (the exporters' number). */
  total: number;
  /** The seller's UPI ID, if they have saved one. Printed only for INR. */
  upiVpa?: string;
}

/**
 * The draft that lands in the composer.
 *
 * Deliberately plain and short: it is a message a person is about to send to
 * their own client under their own name, so it reads as something they could
 * have typed. It states facts already on the invoice and makes no claim about
 * delivery — the file itself is attached by the user in WhatsApp.
 */
export const buildShareMessage = ({
  invoice,
  total,
  upiVpa,
}: ShareMessageInput): string => {
  const currency = invoice.currency || "INR";
  const company = (invoice.companyName || "").trim();
  const number = (invoice.invoiceNumber || "").trim();

  const lines: string[] = [];
  lines.push(
    number
      ? `Invoice ${number}${company ? ` from ${company}` : ""}`
      : `Invoice${company ? ` from ${company}` : ""}`
  );
  lines.push(`Amount: ${formatCurrency(total, currency)}`);
  if (invoice.dueDate) {
    lines.push(`Due: ${formatDateLong(invoice.dueDate)}`);
  }

  // The VPA is INR-only for the same reason the QR is: a UPI ID cannot settle
  // a dollar invoice, and offering one against a foreign-currency total invites
  // a payment of the right number in the wrong currency.
  const vpa = normalizeVpa(upiVpa);
  if (currency.toUpperCase() === "INR" && isValidVpa(vpa)) {
    lines.push(`Pay by UPI: ${vpa}`);
  }
  return lines.join("\n");
};

/* -------------------------------------------------------------------------- */
/* Links                                                                       */
/* -------------------------------------------------------------------------- */

export interface WhatsAppLinkInput {
  message: string;
  /** Optional recipient. Anything unrecognised is dropped rather than guessed. */
  phone?: string;
}

/**
 * `https://wa.me/<phone>?text=<encoded>`.
 *
 * `encodeURIComponent` and not a hand-rolled escape: the message contains
 * newlines, `&` in company names, `#` in invoice numbers and `+` in phone
 * numbers, and every one of them ends the parameter early if left alone —
 * which silently truncates the draft rather than failing loudly.
 */
export const buildWhatsAppUrl = ({ message, phone }: WhatsAppLinkInput): string => {
  const recipient = normalizeWhatsAppPhone(phone);
  const query = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${recipient ?? ""}${query}`;
};
