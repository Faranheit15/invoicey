/**
 * The `upi://pay` deep link — the whole of "accept payment" in this product.
 *
 * WHAT THIS IS NOT: a payment integration. Nothing here talks to a gateway, a
 * bank, or NPCI. The URI is built offline from a VPA the user typed, encoded
 * into a QR by `lib/qr.ts`, and printed on the invoice. The client's own bank
 * app reads it and the client's own bank moves the money. Invoicey never sees
 * the transaction, never holds funds, and never learns whether it happened —
 * which is exactly why this is allowed to exist under `PRODUCT.md`'s "the
 * product does not take payments", and why it needs no merchant account, no
 * KYC, no per-transaction fee and no regulatory posture.
 *
 * The parameters are NPCI's Common URL Specification:
 *   pa  payee address (the VPA)      REQUIRED
 *   pn  payee name                   free text
 *   am  amount                       "1234.50" — two decimals, no separators
 *   cu  currency                     INR, and only INR
 *   tn  transaction note             free text, short
 *   tr  transaction reference        our invoice number
 *
 * `mc` (merchant category code) is deliberately absent: it is for onboarded
 * merchants, and claiming one for a P2P VPA is a misrepresentation.
 */

/* -------------------------------------------------------------------------- */
/* VPA validation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Field caps from the NPCI spec. They are not arbitrary — an app that receives
 * an over-long `tn` may truncate it, reject the intent, or (the failure that
 * matters) mis-parse the remainder of the query string, and the parameter
 * immediately at risk is the amount.
 */
const MAX_VPA_LENGTH = 255;
const MAX_PAYEE_NAME = 50;
const MAX_NOTE = 50;
const MAX_REFERENCE = 35;

/** The largest amount we will put in a link. Above this, print the QR without one. */
const MAX_UPI_AMOUNT = 100_000_000;

/**
 * `handle` (the part after `@`) is a bank/PSP identifier: letters and digits,
 * starting with a letter, no dots. `okhdfcbank`, `ybl`, `paytm`, `apl`, `axl`.
 *
 * The local part is what banks actually allow: letters, digits, and `.`, `-`,
 * `_`, beginning and ending with an alphanumeric. It is deliberately NOT an
 * email rule — a VPA has no quoting, no `+` tags and no sub-domains, and being
 * permissive here is not kindness. An invalid VPA produces a QR that opens the
 * customer's bank app and fails there, in front of the customer, which is
 * strictly worse for the user than printing no QR at all.
 */
const VPA_PATTERN =
  /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?@[a-z][a-z0-9]{1,63}$/;

/**
 * Trim the ends and lower-case. Nothing else.
 *
 * VPAs are case-insensitive at the PSP and every printed one is lower-case, so
 * "ACME@OKHDFCBANK" pasted off a screenshot should validate rather than be
 * rejected for a reason the user cannot see. INTERNAL whitespace is left alone
 * so that validation fails on it: silently closing the gap in "acme okhdfc@ybl"
 * would invent a different address and point the payment at it.
 */
export const normalizeVpa = (value: string | undefined | null): string =>
  (value ?? "").trim().toLowerCase();

export const isValidVpa = (value: string | undefined | null): boolean => {
  const vpa = normalizeVpa(value);
  return vpa.length > 0 && vpa.length <= MAX_VPA_LENGTH && VPA_PATTERN.test(vpa);
};

/* -------------------------------------------------------------------------- */
/* Value formatting                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Collapse free text to one clean line and cut it to `max` characters.
 *
 * Newlines and control characters go first: a raw newline inside a query
 * parameter is the sort of thing that survives our encoding but not some
 * intermediate handler's, and there is no reason for one to be in a payee name.
 * The cut prefers a word boundary when it can find one near the limit, and
 * appends nothing — an ellipsis would spend one of the few characters the spec
 * allows on decoration.
 */
const toCleanText = (value: string | undefined | null, max: number): string => {
  const collapsed = (value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (collapsed.length <= max) {
    return collapsed;
  }
  const cut = collapsed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace >= max - 12 ? cut.slice(0, lastSpace) : cut).trim();
};

/**
 * "1180.00". Two decimals, no grouping, no symbol, no sign.
 *
 * Returns null for anything a bank app would refuse, in which case the link is
 * still built WITHOUT `am` — a QR the payer types the amount into is useful; a
 * QR carrying "1,180" or "₹1180" is not, and some apps silently drop the
 * malformed parameter and prefill nothing, which looks identical until the
 * payer sends the wrong number.
 */
export const formatUpiAmount = (amount: number | undefined | null): string | null => {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return null;
  }
  if (amount <= 0 || amount > MAX_UPI_AMOUNT) {
    return null;
  }
  return amount.toFixed(2);
};

/**
 * Percent-encode one parameter value.
 *
 * `encodeURIComponent` is the right primitive here and the reason is specific:
 * every character that can end a value or start another parameter — `&`, `=`,
 * `#`, `?`, `/`, space — is escaped by it. Payee names and invoice notes are
 * free text typed by a user ("Smith & Sons", "Design = branding, phase #2"),
 * and an unescaped `&` in `tn` does not corrupt `tn`: it terminates it and
 * turns everything after it into parameters the receiving app reads as its
 * own. When that lands next to `am`, the payer's app prefills a different
 * amount than the invoice says, silently. That is the bug this function exists
 * to make impossible.
 */
const encodeParameter = (value: string): string => encodeURIComponent(value);

/* -------------------------------------------------------------------------- */
/* Link building                                                               */
/* -------------------------------------------------------------------------- */

export interface UpiLinkInput {
  /** The payee's VPA, e.g. `acme@okhdfcbank`. Validated; nothing is emitted without it. */
  vpa: string;
  /** Printed name of the payee. Truncated to the spec's 50 characters. */
  payeeName?: string;
  /** Invoice total. Omitted from the link rather than mangled if unusable. */
  amount?: number;
  /** Must be INR, or nothing is emitted. See `buildUpiLink`. */
  currency?: string;
  /** Transaction note — what the payer sees in their app. */
  note?: string;
  /** Transaction reference, e.g. the invoice number. */
  reference?: string;
}

export interface UpiLink {
  /** The full `upi://pay?…` URI, ready to encode as a QR. */
  uri: string;
  /** The normalised VPA, for printing next to the QR. */
  vpa: string;
  /** The payee name that actually went into the link (possibly truncated). */
  payeeName: string;
  /** The formatted amount that went into the link, or "" if it was omitted. */
  amount: string;
  note: string;
  reference: string;
}

/**
 * UPI settles in rupees and carries no exchange mechanism, so `cu` is INR and
 * there is no second value. A link built for a USD invoice would be a link
 * that charges the payer a rupee number with a dollar label on the invoice
 * beside it.
 */
const UPI_CURRENCY = "INR";

/**
 * Build the link, or return null.
 *
 * Null is the answer for: no/invalid VPA, and any currency other than INR.
 * Every one of those is a case where a wrong link is worse than no link, and
 * the caller's job in all of them is the same — print the invoice without a QR.
 */
export const buildUpiLink = (input: UpiLinkInput): UpiLink | null => {
  const vpa = normalizeVpa(input.vpa);
  if (!isValidVpa(vpa)) {
    return null;
  }
  const currency = (input.currency || UPI_CURRENCY).trim().toUpperCase();
  if (currency !== UPI_CURRENCY) {
    return null;
  }

  const payeeName = toCleanText(input.payeeName, MAX_PAYEE_NAME);
  const note = toCleanText(input.note, MAX_NOTE);
  const reference = toCleanText(input.reference, MAX_REFERENCE);
  const amount = formatUpiAmount(input.amount) ?? "";

  // Order follows the NPCI examples: pa, pn, am, cu, tn, tr. Some older apps
  // are order-sensitive in ways they should not be, and matching the published
  // examples costs nothing.
  const parameters: Array<[string, string]> = [["pa", vpa]];
  if (payeeName) {
    parameters.push(["pn", payeeName]);
  }
  if (amount) {
    parameters.push(["am", amount]);
  }
  parameters.push(["cu", UPI_CURRENCY]);
  if (note) {
    parameters.push(["tn", note]);
  }
  if (reference) {
    parameters.push(["tr", reference]);
  }

  const uri = `upi://pay?${parameters
    .map(([key, value]) => `${key}=${encodeParameter(value)}`)
    .join("&")}`;

  return { uri, vpa, payeeName, amount, note, reference };
};

/**
 * Make an invoice number safe to use as `tr`.
 *
 * The reference is meant to be a plain alphanumeric handle, and real invoice
 * numbers are full of slashes ("INV/2026-27/001"). Slashes inside a percent-
 * encoded value are legal, but `tr` is the one field a payer's bank may echo
 * back into a statement narration, and the conservative form travels further.
 */
export const toUpiReference = (value: string | undefined | null): string =>
  (value ?? "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_REFERENCE);

/** Just the URI, for callers that do not need the parts back. */
export const buildUpiUri = (input: UpiLinkInput): string | null =>
  buildUpiLink(input)?.uri ?? null;

/** Whether a UPI QR can be offered for this currency at all. */
export const supportsUpi = (currency: string | undefined | null): boolean =>
  (currency || UPI_CURRENCY).trim().toUpperCase() === UPI_CURRENCY;

/* -------------------------------------------------------------------------- */
/* Bank details                                                                */
/* -------------------------------------------------------------------------- */

/** `HDFC0000123` — four letters, a zero, then six alphanumerics. */
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const normalizeIfsc = (value: string | undefined | null): string =>
  (value ?? "").replace(/\s+/g, "").trim().toUpperCase();

export const isValidIfsc = (value: string | undefined | null): boolean =>
  IFSC_PATTERN.test(normalizeIfsc(value));

/**
 * Account numbers are 9-18 digits in India and are frequently written in
 * groups. Spaces and hyphens are stripped rather than rejected, because that is
 * how they appear on a passbook and a user copying one is not making a mistake.
 */
export const normalizeAccountNumber = (value: string | undefined | null): string =>
  (value ?? "").replace(/[\s-]+/g, "").trim();

export const isValidAccountNumber = (value: string | undefined | null): boolean =>
  /^\d{6,20}$/.test(normalizeAccountNumber(value));
