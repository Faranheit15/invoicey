import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Invoice from "@/models/Invoice";
import { requireUser, authErrorResponse } from "@/lib/server/auth";
import {
  MAX_ITEM_QUANTITY,
  MAX_ITEM_UNIT_PRICE,
  MAX_MONEY_VALUE,
  MAX_TDS_RATE_PERCENT,
  TDS_SECTIONS,
  clampToLimit,
  computeTotals,
  resolveTaxContext,
  validateInvoice,
  type TdsSection,
} from "@/lib/invoice-domain";
import {
  deriveSupplyKind,
  documentTypeFor,
  type DocumentType,
  type SupplyKind,
  type TaxTreatment,
} from "@/lib/gst-supply";
import {
  MAX_UNIT_LENGTH,
  isValidHsnSac,
  placeOfSupplyLabelFor,
} from "@/lib/gst-rates";
import {
  GST_STATE_CODES,
  OTHER_COUNTRY_STATE_CODE,
  isValidPan,
  normalizeGstin,
  panFromGstin,
} from "@/lib/gstin";
import { parsePagination } from "@/lib/server/pagination";
import {
  buildInvoiceListFilter,
  parseInvoiceListSort,
} from "@/lib/server/invoice-list-query";
import { recordActivity, logRouteError } from "@/lib/server/log";
import {
  deriveFinancialYear,
  invoiceNumberKey,
  normalizeInvoiceNumber,
  suggestInvoiceNumber,
} from "@/lib/invoice-number";
import {
  financialYearRange,
  highestInvoiceNumber,
} from "@/lib/invoice-duplicate";

type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

/**
 * How many of the financial year's invoices the number suggester reads.
 *
 * "The highest number in this year" is a date-range query plus
 * `highestInvoiceNumber` in JS, and stays that way even though `financialYear`
 * is stored now: every document written before the backfill migration has no
 * such field, and a query on it would silently skip them and suggest a number
 * that is already in use. Switch to the field once the migration has run
 * everywhere. Bounded
 * so a user with a very long history cannot turn a suggestion into a scan; the
 * rows come back newest-first, and a series that needs more than 500 invoices
 * of lookback is not a series this app can continue anyway.
 */
const NUMBER_SUGGESTION_SCAN_LIMIT = 500;

/** The answer to `GET /api/invoices?suggest_number=1`. */
export interface InvoiceNumberSuggestion {
  /** The financial year the date falls in, e.g. "2026-27". */
  financialYear: string;
  /**
   * The number to pre-fill, or null when the caller must ask the user — an
   * exhausted series ("INV/2026-27/9999") or a legacy number whose own charset
   * Rule 46(b) forbids. Advisory either way: the field stays editable.
   */
  invoiceNumber: string | null;
}

interface RawInvoiceItem {
  description?: string;
  name?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  price?: number | string;
  hsnSac?: string;
  unit?: string;
  discount?: number | string;
  taxRatePercent?: number | string;
}

interface RawInvoicePayload {
  id?: string;
  companyName?: string;
  companyEmail?: string;
  companyPhone?: string;
  companyAddress?: string;
  companyLogo?: string;
  billTo?: string;
  billToEmail?: string;
  billToAddress?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  terms?: string;
  notes?: string;
  currency?: string;
  items?: RawInvoiceItem[];
  discount?: number | string;
  tax?: number | string;
  cgst?: number | string;
  sgst?: number | string;
  convenienceCharge?: number | string;
  paymentInfo?: string;
  status?: InvoiceStatus;
  companyGstin?: string;
  billToGstin?: string;
  companyPan?: string;
  tdsSection?: string;
  tdsRatePercent?: number | string;
  signatureLabel?: string;
  signatureImageUrl?: string;
  taxTreatment?: string;
  reverseCharge?: boolean;
  supplierStateCode?: string;
  placeOfSupplyStateCode?: string;
  placeOfSupplyLabel?: string;
  placeOfSupplyOverridden?: boolean;
  recipientIsSez?: boolean;
  recipientIsOutsideIndia?: boolean;
  withPaymentOfTax?: boolean;
  lutArn?: string;
  countryOfDestination?: string;
  // `documentType` and `supplyKind` are deliberately NOT read from the request:
  // both are re-derived below so a client cannot head an unregistered document
  // "TAX INVOICE" or claim an intra-State supply is inter-State.
}

interface PatchInvoicePayload {
  id?: string;
  action?: "settle" | "soft_delete";
  status?: InvoiceStatus;
}

interface NormalizedInvoiceItem {
  name: string;
  quantity: number;
  price: number;
  hsnSac?: string;
  unit?: string;
  discount?: number;
  taxRatePercent?: number;
  taxableValue?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
}

/** The invoice-level GST block. Absent entirely for a pre-Phase-2 client. */
interface NormalizedGstFields {
  taxTreatment: TaxTreatment;
  documentType: DocumentType;
  supplyKind: SupplyKind;
  reverseCharge: boolean;
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
  placeOfSupplyLabel: string;
  placeOfSupplyOverridden: boolean;
  recipientIsSez: boolean;
  recipientIsOutsideIndia: boolean;
  withPaymentOfTax: boolean;
  lutArn: string;
  countryOfDestination: string;
}

interface NormalizedInvoicePayload extends Partial<NormalizedGstFields> {
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  companyAddress: string;
  companyLogo: string;
  billTo: string;
  billToEmail: string;
  billToAddress: string;
  invoiceNumber: string;
  /** Rule 46(b) uniqueness scope, derived from `invoiceDate`. Never from the client. */
  financialYear: string;
  /** The case-folded key the unique index is built on. Never from the client. */
  invoiceNumberKey: string;
  invoiceDate: string;
  dueDate: string;
  terms: string;
  notes: string;
  currency: string;
  items: NormalizedInvoiceItem[];
  subtotal: number;
  discount: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxableValue: number;
  roundOff: number;
  convenienceCharge: number;
  paymentInfo: string;
  status: InvoiceStatus;
  total: number;
  companyGstin: string;
  billToGstin: string;
  companyPan: string;
  tdsSection: TdsSection;
  tdsRatePercent: number;
  tdsAmount: number;
  signatureLabel: string;
  signatureImageUrl: string;
}

const INVOICE_AUTH_MESSAGES = {
  EmailNotVerified: "Please verify your email before accessing invoices.",
} as const;

const toNumber = (value: number | string | undefined, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const cleanString = (value: string | undefined): string => {
  return typeof value === "string" ? value.trim() : "";
};

/**
 * A REAL GST state code, or "" — two digits is not enough. "88" is two digits
 * and is not a state; accepting it would put an unresolvable place of supply on
 * a printed document and make `deriveSupplyKind` compare against a fiction.
 * "96" (outside India) is allowed: it is Invoicey's place-of-supply sentinel.
 */
const cleanStateCode = (value: string | undefined): string => {
  const digits = cleanString(value).replace(/\D/g, "");
  if (digits === OTHER_COUNTRY_STATE_CODE) {
    return digits;
  }
  return Object.prototype.hasOwnProperty.call(GST_STATE_CODES, digits)
    ? digits
    : "";
};

/**
 * HSN/SAC, Rule 46(f) format: digits only, 4/6/8 long. A code of any other
 * length is DROPPED rather than truncated — silently turning a mistyped 5-digit
 * code into a valid-looking 4-digit one would print a classification the user
 * never chose.
 */
const cleanHsnSac = (value: string | undefined): string => {
  const digits = cleanString(value).replace(/\D/g, "");
  return isValidHsnSac(digits) ? digits : "";
};

const ALLOWED_TAX_TREATMENTS: TaxTreatment[] = ["none", "gst", "composition"];

const ALLOWED_TDS_SECTIONS: TdsSection[] = [
  "none",
  ...TDS_SECTIONS.map((spec) => spec.value),
];

/**
 * Protocol allowlist for the signature image, mirroring the exporter's
 * `toSafeImageUrl` and the profile route's `cleanImageUrl`.
 *
 * The stored value is interpolated into an `<img src>` in a document rendered
 * inside a same-origin iframe, so `javascript:` here is not hypothetical.
 * Storing only safe values makes the exporter's own guard defence in depth
 * rather than the only line.
 */
const cleanImageUrl = (value: string | undefined): string => {
  const raw = cleanString(value).slice(0, 2048);
  if (!raw) return "";
  if (raw.startsWith("/")) return raw;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") return raw;
  if (parsed.protocol === "data:" && /^data:image\//i.test(raw)) return raw;
  return "";
};

/**
 * NORMALISE ONLY — trim, upper-case, strip internal spaces. Rejecting an
 * invalid GSTIN is `validateInvoice`'s job, and the two responsibilities stay
 * separate exactly as they do for every other field in this file: a lowercased
 * paste is corrected, a wrong one is refused with a message the user can act on
 * rather than being silently blanked.
 */
const cleanGstin = (value: string | undefined): string =>
  normalizeGstin(value).slice(0, 15);

const normalizeItems = (items: RawInvoiceItem[] = []): NormalizedInvoiceItem[] => {
  return items
    .map((item) => {
      const name = cleanString(item.description || item.name);
      // Clamped both ways here too: the editor's fields are not the only way a
      // request reaches this handler.
      const quantity = clampToLimit(toNumber(item.quantity, 1), MAX_ITEM_QUANTITY, 1);
      const price = clampToLimit(
        toNumber(item.unitPrice ?? item.price, 0),
        MAX_ITEM_UNIT_PRICE
      );
      const hsnSac = cleanHsnSac(item.hsnSac);
      const unit = cleanString(item.unit).slice(0, MAX_UNIT_LENGTH).toUpperCase();
      const normalized: NormalizedInvoiceItem = { name, quantity, price };
      // Only SET what the client actually sent: an absent HSN/SAC or rate is
      // how a line says "written before per-line tax existed", and writing an
      // empty string or a 0 would erase that.
      if (hsnSac) {
        normalized.hsnSac = hsnSac;
      }
      if (unit) {
        normalized.unit = unit;
      }
      if (item.discount !== undefined) {
        normalized.discount = clampToLimit(
          toNumber(item.discount, 0),
          MAX_MONEY_VALUE
        );
      }
      if (item.taxRatePercent !== undefined) {
        // KEPT AS SENT (rounded to paise), then judged by `validateInvoice`.
        //
        // GST has a fixed slab table, so a 15% line is not a rate that needs
        // bringing into range — it is a rate that does not exist. Dropping it
        // here, which is what this did, saved the invoice with NO tax on it
        // while the editor preview had just shown the user a total that
        // included it: the document silently disagreed with the screen it was
        // created on. Carrying the rate through to the validator turns that
        // into a 400 naming the rule. Retired slabs (12, 28) are accepted and
        // warned about — a back-dated document carries them legitimately.
        normalized.taxRatePercent = Number(
          toNumber(item.taxRatePercent, 0).toFixed(2)
        );
      }
      return normalized;
    })
    .filter((item) => item.name.length > 0);
};

/**
 * The invoice-level GST block, re-derived server-side.
 *
 * Returns `undefined` when the client sent no `taxTreatment` at all — that is a
 * pre-Phase-2 client (or a pre-Phase-2 document being re-saved), and it must
 * stay on the legacy money formula rather than being silently switched to
 * "unregistered", which would zero the tax it typed in.
 *
 * `documentType` and `supplyKind` are computed here and never read from the
 * request.
 */
const normalizeGstFields = (
  raw: RawInvoicePayload
): NormalizedGstFields | undefined => {
  if (raw.taxTreatment === undefined || raw.taxTreatment === null) {
    return undefined;
  }

  const taxTreatment = ALLOWED_TAX_TREATMENTS.includes(
    raw.taxTreatment as TaxTreatment
  )
    ? (raw.taxTreatment as TaxTreatment)
    : "none";

  const supplierStateCode = cleanStateCode(raw.supplierStateCode);
  const placeOfSupplyStateCode = cleanStateCode(raw.placeOfSupplyStateCode);
  const recipientIsSez = raw.recipientIsSez === true;
  const recipientIsOutsideIndia = raw.recipientIsOutsideIndia === true;

  return {
    taxTreatment,
    documentType: documentTypeFor(taxTreatment),
    supplyKind: deriveSupplyKind({
      supplierStateCode,
      placeOfSupplyStateCode,
      recipientIsSez,
      recipientIsOutsideIndia,
    }),
    reverseCharge: raw.reverseCharge === true,
    supplierStateCode,
    placeOfSupplyStateCode,
    // The label is what gets PRINTED. A client-supplied one is kept (an export's
    // place of supply is a country name, which no table of ours knows) but a
    // blank one falls back to our own state table rather than printing nothing
    // — or worse, printing the bare code "27".
    placeOfSupplyLabel:
      cleanString(raw.placeOfSupplyLabel).slice(0, 120) ||
      placeOfSupplyLabelFor(placeOfSupplyStateCode),
    placeOfSupplyOverridden: raw.placeOfSupplyOverridden === true,
    recipientIsSez,
    recipientIsOutsideIndia,
    withPaymentOfTax: raw.withPaymentOfTax === true,
    lutArn: cleanString(raw.lutArn).slice(0, 60),
    countryOfDestination: cleanString(raw.countryOfDestination).slice(0, 120),
  };
};

const normalizePayload = (raw: RawInvoicePayload): NormalizedInvoicePayload => {
  const items = normalizeItems(raw.items || []);
  const gst = normalizeGstFields(raw);

  // Rule 46(b) numbering. Both derived here and nowhere else: the financial
  // year comes from the invoice DATE (not today — a 31 March invoice entered on
  // 2 April belongs to the year that ended), and the key is what the unique
  // index sees. Neither is read from the request; a client that could choose
  // its own uniqueness scope could opt out of uniqueness.
  const invoiceNumber = normalizeInvoiceNumber(cleanString(raw.invoiceNumber));
  const invoiceDateRaw = cleanString(raw.invoiceDate);
  const financialYear = deriveFinancialYear(invoiceDateRaw || new Date());

  const companyGstin = cleanGstin(raw.companyGstin);
  const billToGstin = cleanGstin(raw.billToGstin);
  // A valid GSTIN carries the PAN in characters 3-12 and is the authority for
  // it. A hand-typed PAN only survives when there is no GSTIN to contradict it,
  // and only if it is well-formed — a wrong PAN printed on a document is worse
  // than none, because the client deducts TDS against it.
  const typedPan = normalizeGstin(raw.companyPan).slice(0, 10);
  const companyPan =
    panFromGstin(companyGstin) || (isValidPan(typedPan) ? typedPan : "");

  const tdsSection: TdsSection = ALLOWED_TDS_SECTIONS.includes(
    raw.tdsSection as TdsSection
  )
    ? (raw.tdsSection as TdsSection)
    : "none";
  const tdsRatePercent = clampToLimit(
    toNumber(raw.tdsRatePercent, 0),
    MAX_TDS_RATE_PERCENT
  );

  // Single source of truth for the money math — the server never trusts client
  // numbers, and this is the same formula the editor preview and export use.
  // In particular the per-head amounts are DERIVED from the line rates and the
  // supply geography; a client-supplied `cgst`/`sgst` only survives on the
  // legacy path, where there is nothing else to go on.
  // Resolved before the totals: the §170 rupee rounding is INR-only, so
  // computeTotals has to know the currency.
  const currency = cleanString(raw.currency) || "INR";

  const totals = computeTotals({
    items: items.map((item) => ({
      quantity: item.quantity,
      unitPrice: item.price,
      discount: item.discount,
      taxRatePercent: item.taxRatePercent,
    })),
    discount: clampToLimit(toNumber(raw.discount, 0), MAX_MONEY_VALUE),
    convenienceCharge: clampToLimit(
      toNumber(raw.convenienceCharge, 0),
      MAX_MONEY_VALUE
    ),
    currency,
    tax: resolveTaxContext({
      taxTreatment: gst?.taxTreatment,
      reverseCharge: gst?.reverseCharge,
      supplyKind: gst?.supplyKind,
      supplierStateCode: gst?.supplierStateCode,
      withPaymentOfTax: gst?.withPaymentOfTax,
      legacyCgst: clampToLimit(toNumber(raw.cgst, 0), MAX_MONEY_VALUE),
      legacySgst: clampToLimit(toNumber(raw.sgst, 0), MAX_MONEY_VALUE),
    }),
    // TDS is computed here too, from the same formula the preview runs. It
    // cannot move `total` — see `buildTotalsRows` — so this only decides what
    // the informational rows say.
    tds: { section: tdsSection, ratePercent: tdsRatePercent },
  });

  // Store the derived per-line amounts, but only on the derived path: writing
  // zeros onto a legacy document would later be read back as a stored split and
  // would suppress the real tax the moment that document gained a treatment.
  const storedItems: NormalizedInvoiceItem[] =
    gst && gst.taxTreatment === "gst" && !gst.reverseCharge
      ? items.map((item, index) => ({
          ...item,
          taxableValue: totals.lines[index].taxable,
          cgstAmount: totals.lines[index].tax.cgst,
          sgstAmount: totals.lines[index].tax.sgst,
          igstAmount: totals.lines[index].tax.igst,
        }))
      : items;

  const allowedStatuses: InvoiceStatus[] = ["draft", "sent", "paid", "overdue"];
  const status =
    raw.status && allowedStatuses.includes(raw.status) ? raw.status : "draft";

  return {
    ...(gst ?? {}),
    companyName: cleanString(raw.companyName),
    companyEmail: cleanString(raw.companyEmail),
    companyPhone: cleanString(raw.companyPhone),
    companyAddress: cleanString(raw.companyAddress),
    companyLogo: cleanString(raw.companyLogo),
    billTo: cleanString(raw.billTo),
    billToEmail: cleanString(raw.billToEmail),
    billToAddress: cleanString(raw.billToAddress),
    // Whitespace out, case untouched: this is the value printed on the
    // document. Rule 46(b)'s charset and 16-character limit are enforced by
    // `validateInvoice` on the normalised value, so "INV 001" is stored as
    // "INV001" rather than rejected, while "INV#001" is refused with the rule
    // it broke.
    invoiceNumber,
    financialYear,
    invoiceNumberKey: invoiceNumberKey(invoiceNumber),
    invoiceDate: cleanString(raw.invoiceDate),
    dueDate: cleanString(raw.dueDate),
    terms: cleanString(raw.terms),
    notes: cleanString(raw.notes),
    currency,
    items: storedItems,
    subtotal: totals.subtotal,
    discount: totals.discount,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    taxableValue: totals.taxableValue,
    roundOff: totals.roundOff,
    convenienceCharge: totals.convenienceCharge,
    paymentInfo: cleanString(raw.paymentInfo),
    status,
    total: totals.total,
    companyGstin,
    billToGstin,
    companyPan,
    tdsSection,
    // The rate is stored as RESOLVED, not as sent: an unset rate means "use the
    // section's statutory one", and storing 0 would re-read as "no deduction"
    // the next time the section's rate changed.
    tdsRatePercent: totals.tds?.ratePercent ?? 0,
    tdsAmount: totals.tds?.amount ?? 0,
    signatureLabel: cleanString(raw.signatureLabel).slice(0, 120),
    signatureImageUrl: cleanImageUrl(raw.signatureImageUrl),
  };
};

const isNotFoundOrInvalidIdError = (error: unknown): boolean => {
  const err = error as { name?: string };
  return err?.name === "CastError";
};

/**
 * The unique index on `{ userId, financialYear, invoiceNumberKey }` rejecting a
 * second document with the same number in the same year. Mongo reports it as
 * E11000; the driver surfaces it as `code: 11000` on a MongoServerError.
 */
const isDuplicateInvoiceNumberError = (error: unknown): boolean =>
  (error as { code?: number } | null)?.code === 11000;

/**
 * A request that OMITTED `taxTreatment`, as opposed to a record that PREDATES
 * it. The difference is not visible in the request at all, which is why it is
 * answered from the STORED DOCUMENT: absence is a property a record has, not
 * one a request can claim.
 *
 * Absence puts `computeTotals` on the legacy arm, where the invoice-level
 * `cgst`/`sgst` are taken from the client verbatim — that arm exists so a
 * document written before Phase 2 re-prints with the numbers it was issued
 * with. Reachable by a NEW invoice, it is a hole: POST `{ cgst: 500, sgst: 500 }`
 * with no GSTIN and no treatment stored exactly that and printed CGST and SGST
 * rows on a document headed "INVOICE" — §32 says an unregistered person may not
 * collect tax, and that shape is the shape of a fraudulent invoice. So:
 *
 *   - POST: absence is always a client that omitted the field. Rejected.
 *   - PUT: absence is legitimate only when the document being updated has no
 *     `taxTreatment` of its own. A record that HAS one cannot be walked back
 *     onto the legacy arm by dropping the field from the request.
 */
const LEGACY_TAX_TREATMENT_ERROR =
  "Choose whether GST applies to this invoice. Only invoices created before Invoicey had GST fields can keep the old flat tax amounts.";

const omitsTaxTreatment = (raw: RawInvoicePayload): boolean =>
  raw.taxTreatment === undefined || raw.taxTreatment === null;

/**
 * The next free number in `financialYear` for this user, or null.
 *
 * Shared by the suggestion endpoint and by the 409 path, so the number offered
 * after a collision is arrived at exactly the way the pre-filled one was.
 *
 * SOFT-DELETED INVOICES ARE INCLUDED. The unique index is full, so a
 * soft-deleted document still holds its number for as long as it is retained —
 * suggesting a number the index will refuse is a dead end, and skipping past it
 * is the mitigation the design names for keeping the index full.
 */
const nextNumberForYear = async (
  userUid: string,
  financialYear: string
): Promise<string | null> => {
  const range = financialYearRange(financialYear);
  if (!range) {
    return null;
  }
  const rows = (await Invoice.find(
    {
      userId: userUid,
      invoiceDate: { $gte: range.start, $lt: range.end },
    },
    { invoiceNumber: 1 }
  )
    .sort({ createdAt: -1 })
    .limit(NUMBER_SUGGESTION_SCAN_LIMIT)
    .lean()) as unknown as { invoiceNumber?: string }[];

  return suggestInvoiceNumber({
    financialYear,
    previous: highestInvoiceNumber(rows.map((row) => row.invoiceNumber)),
  });
};

/**
 * The 409 for a number already used in that financial year.
 *
 * A 500 was what this used to be, which told the user nothing and looked like
 * an outage. The next free number rides along in the body AND in the message,
 * because `ApiError` carries only the message to the editor.
 */
const duplicateNumberResponse = async (input: {
  userUid: string;
  invoiceNumber: string;
  financialYear: string;
}) => {
  let suggestion: string | null = null;
  try {
    suggestion = await nextNumberForYear(input.userUid, input.financialYear);
  } catch {
    // A failed suggestion must not turn a clear 409 into a 500.
    suggestion = null;
  }
  return NextResponse.json(
    {
      error: `Invoice number ${input.invoiceNumber} is already used in ${input.financialYear}.${
        suggestion ? ` Try ${suggestion}.` : ""
      }`,
      code: "DUPLICATE_INVOICE_NUMBER",
      suggestion,
    },
    { status: 409 }
  );
};

const allowedStatuses: InvoiceStatus[] = ["draft", "sent", "paid", "overdue"];

export async function GET(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await requireUser(req);
  } catch (error: unknown) {
    return authErrorResponse(error, INVOICE_AUTH_MESSAGES);
  }

  await connectDB();

  const { searchParams } = new URL(req.url);
  const invoiceId = searchParams.get("id");

  try {
    // A third read mode on the same route, disambiguated by a query param
    // exactly as `?id=` already disambiguates item from collection.
    //
    // It exists because only the SERVER can see every invoice in the series:
    // the editor holds one draft, and the dashboard holds only what it fetched.
    // Suggesting is deliberately not the same as issuing — nothing is written
    // and no counter moves, so an abandoned draft leaves no gap in a series
    // Rule 46(b) requires to be consecutive.
    if (searchParams.get("suggest_number") !== null) {
      const rawDate = (searchParams.get("date") || "").trim();
      const financialYear = deriveFinancialYear(rawDate || new Date());
      if (!financialYearRange(financialYear)) {
        return NextResponse.json(
          { error: "That date isn't one we can read." },
          { status: 400 }
        );
      }

      const suggestion: InvoiceNumberSuggestion = {
        financialYear,
        invoiceNumber: await nextNumberForYear(userUid, financialYear),
      };
      return NextResponse.json(suggestion);
    }

    if (invoiceId) {
      const invoice = await Invoice.findOne({
        _id: invoiceId,
        userId: userUid,
        is_deleted: { $ne: true },
      });
      if (!invoice) {
        return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
      }
      return NextResponse.json(invoice);
    }

    // Tenant scope and the soft-delete rule are applied INSIDE
    // `buildInvoiceListFilter`, unconditionally, so neither can be dropped by
    // adding a search or a status filter here.
    const listFilter = buildInvoiceListFilter({ userId: userUid, searchParams });
    const { spec } = parseInvoiceListSort(searchParams);
    // Paginate only when asked, so `invoicesApi.list()` keeps returning an array.
    if (searchParams.get("page") === null && searchParams.get("limit") === null) {
      return NextResponse.json(await Invoice.find(listFilter).sort(spec));
    }
    const { page, limit, skip } = parsePagination(searchParams, {
      defaultLimit: 25,
      maxLimit: 100,
    });
    const [total, invoices] = await Promise.all([
      Invoice.countDocuments(listFilter),
      Invoice.find(listFilter).sort(spec).skip(skip).limit(limit).lean(),
    ]);
    return NextResponse.json({ invoices, page, limit, total });
  } catch (error: unknown) {
    if (isNotFoundOrInvalidIdError(error)) {
      return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
    }

    logRouteError(error, {
      req,
      route: "GET /api/invoices",
      userId: userUid,
      category: "invoice",
    });
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await requireUser(req);
  } catch (error: unknown) {
    return authErrorResponse(error, INVOICE_AUTH_MESSAGES);
  }

  await connectDB();

  try {
    const rawPayload = (await req.json()) as RawInvoicePayload;
    // A NEW invoice can never be a pre-Phase-2 document, so the legacy tax arm
    // is not available to it. See `omitsTaxTreatment`.
    if (omitsTaxTreatment(rawPayload)) {
      return NextResponse.json(
        { error: LEGACY_TAX_TREATMENT_ERROR },
        { status: 400 }
      );
    }
    const payload = normalizePayload(rawPayload);
    // The head rollups go in as a tripwire: an inter-State supply that somehow
    // produced CGST/SGST (or the reverse) is a bug in the derivation, not a
    // user error, and it must not reach a client's inbox.
    const validationError = validateInvoice({
      ...payload,
      totals: {
        cgst: payload.cgst,
        sgst: payload.sgst,
        igst: payload.igst,
      },
    });

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const invoice = new Invoice({
      userId: userUid,
      is_deleted: false,
      ...payload,
    });

    try {
      await invoice.save();
    } catch (error: unknown) {
      if (isDuplicateInvoiceNumberError(error)) {
        return duplicateNumberResponse({
          userUid,
          invoiceNumber: payload.invoiceNumber,
          financialYear: payload.financialYear,
        });
      }
      throw error;
    }
    recordActivity({
      userId: userUid,
      type: "invoice_create",
      invoiceId: String(invoice._id),
      amount: payload.total,
      currency: payload.currency,
    });
    return NextResponse.json(
      {
        message: "Invoice created successfully",
        invoice,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "POST /api/invoices",
      userId: userUid,
      category: "invoice",
    });
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await requireUser(req);
  } catch (error: unknown) {
    return authErrorResponse(error, INVOICE_AUTH_MESSAGES);
  }

  await connectDB();

  try {
    const rawPayload = (await req.json()) as RawInvoicePayload;
    const { searchParams } = new URL(req.url);
    const invoiceId = searchParams.get("id") || cleanString(rawPayload.id);

    if (!invoiceId) {
      return NextResponse.json(
        { error: "Invoice id is required for updates" },
        { status: 400 }
      );
    }

    const existingInvoice = await Invoice.findOne({
      _id: invoiceId,
      userId: userUid,
      is_deleted: { $ne: true },
    });
    if (!existingInvoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // The legacy tax arm stays open for a document that really does predate
    // Phase 2 — the STORED record is what decides, never the request. A record
    // that already carries a treatment cannot be walked back onto it.
    if (
      omitsTaxTreatment(rawPayload) &&
      existingInvoice.taxTreatment !== undefined &&
      existingInvoice.taxTreatment !== null
    ) {
      return NextResponse.json(
        { error: LEGACY_TAX_TREATMENT_ERROR },
        { status: 400 }
      );
    }

    const payload = normalizePayload(rawPayload);
    // The head rollups go in as a tripwire: an inter-State supply that somehow
    // produced CGST/SGST (or the reverse) is a bug in the derivation, not a
    // user error, and it must not reach a client's inbox.
    const validationError = validateInvoice({
      ...payload,
      totals: {
        cgst: payload.cgst,
        sgst: payload.sgst,
        igst: payload.igst,
      },
    });

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    Object.assign(existingInvoice, payload);
    try {
      // Re-saving a document with its own unchanged number does not violate the
      // unique index — it is the same document — so no self-exclusion is needed
      // here. This catches an edit that moves the number onto one already used.
      await existingInvoice.save();
    } catch (error: unknown) {
      if (isDuplicateInvoiceNumberError(error)) {
        return duplicateNumberResponse({
          userUid,
          invoiceNumber: payload.invoiceNumber,
          financialYear: payload.financialYear,
        });
      }
      throw error;
    }

    recordActivity({
      userId: userUid,
      type: "invoice_update",
      invoiceId: invoiceId,
      amount: payload.total,
      currency: payload.currency,
    });

    return NextResponse.json({
      message: "Invoice updated successfully",
      invoice: existingInvoice,
    });
  } catch (error: unknown) {
    if (isNotFoundOrInvalidIdError(error)) {
      return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
    }

    logRouteError(error, {
      req,
      route: "PUT /api/invoices",
      userId: userUid,
      category: "invoice",
    });
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await requireUser(req);
  } catch (error: unknown) {
    return authErrorResponse(error, INVOICE_AUTH_MESSAGES);
  }

  await connectDB();

  try {
    const rawPayload = (await req.json()) as PatchInvoicePayload;
    const { searchParams } = new URL(req.url);
    const invoiceId = searchParams.get("id") || cleanString(rawPayload.id);

    if (!invoiceId) {
      return NextResponse.json(
        { error: "Invoice id is required" },
        { status: 400 }
      );
    }

    const invoice = await Invoice.findOne({
      _id: invoiceId,
      userId: userUid,
      is_deleted: { $ne: true },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Scope every write by userId as well (defense in depth): the findOne above
    // already proves ownership, but keeping the predicate on the write means a
    // future refactor cannot silently turn these into cross-tenant updates.
    const ownedFilter = { _id: invoiceId, userId: userUid };

    if (rawPayload.action === "soft_delete") {
      await Invoice.updateOne(ownedFilter, { $set: { is_deleted: true } });
      recordActivity({
        userId: userUid,
        type: "invoice_delete",
        invoiceId,
      });
      return NextResponse.json({ message: "Invoice deleted successfully" });
    }

    if (rawPayload.action === "settle") {
      await Invoice.updateOne(ownedFilter, { $set: { status: "paid" } });
      recordActivity({
        userId: userUid,
        type: "invoice_settle",
        invoiceId,
        amount: invoice.total,
        currency: invoice.currency,
      });
      return NextResponse.json({
        message: "Invoice settled successfully",
        invoice: { ...invoice.toObject(), status: "paid" },
      });
    }

    if (rawPayload.status && allowedStatuses.includes(rawPayload.status)) {
      await Invoice.updateOne(ownedFilter, { $set: { status: rawPayload.status } });
      recordActivity({
        userId: userUid,
        type: "invoice_status_change",
        invoiceId,
        meta: { from: invoice.status, to: rawPayload.status },
      });
      return NextResponse.json({
        message: "Invoice status updated successfully",
        invoice: { ...invoice.toObject(), status: rawPayload.status },
      });
    }

    return NextResponse.json(
      { error: "No valid patch action provided" },
      { status: 400 }
    );
  } catch (error: unknown) {
    if (isNotFoundOrInvalidIdError(error)) {
      return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
    }

    logRouteError(error, {
      req,
      route: "PATCH /api/invoices",
      userId: userUid,
      category: "invoice",
    });
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
