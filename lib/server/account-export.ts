/**
 * Shape + redaction rules for the DPDP data-subject access export.
 *
 * Pure on purpose: no database, no request, no Response. The route reads, this
 * builds. That keeps the allow-lists unit-testable and the route thin.
 *
 * WHY EVERY FIELD IS NAMED, AND NOTHING IS SPREAD.
 * `.lean()` returns what the driver returned, not what the current schema
 * declares. `User.accessToken` / `User.refreshToken` were removed from
 * `models/User.ts` and destroyed by `scripts/purge-user-tokens.ts`, but any
 * document written before that migration ran still carries them on disk, and
 * Mongoose will hand them back on a lean read without complaint. A `{ ...doc }`
 * here would post a never-expiring Firebase refresh token back over HTTP — the
 * exact leak the purge existed to close. So this module allow-lists: an unknown
 * field is dropped, and adding one to the export is a deliberate edit here.
 *
 * AND WHY THAT ALLOW-LIST HAS A DRIFT GUARD.
 * An allow-list is correct on the day it is written and decays every time the
 * schema grows past it — which is exactly what happened between Phase 1 and
 * Phase 4. `tests/account-export-schema.test.ts` reads the Mongoose schema
 * paths out of `models/Invoice.ts` and `models/BusinessProfile.ts` and fails
 * unless every one of them is either exported or named in the matching
 * `*_FIELDS_WITHHELD` list below with a reason. Adding a field to either model
 * therefore breaks the build until someone decides whether the user gets it.
 */

import { toCsv, type CsvCell } from "@/lib/server/admin-export";

export const ACCOUNT_EXPORT_FORMAT = "invoicey-account-export";
/**
 * Bumped to 2 when the export stopped being a Phase-1 subset: the business
 * profile, the GST/TDS/document-kind fields and the per-line tax breakdown all
 * arrived at once. A reader that keys off `version` can tell the two files
 * apart; a file stamped 1 is missing everything listed above.
 */
export const ACCOUNT_EXPORT_VERSION = 2;

/** Loose view of a `.lean()` document: unknown keys, read by name only. */
type LeanDoc = Record<string, unknown>;

const str = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const optionalNum = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const optionalStr = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value : String(value);
  return text.length ? text : undefined;
};

const optionalBool = (value: unknown): boolean | undefined =>
  value === undefined || value === null ? undefined : value === true;

const toIso = (value: unknown): string => {
  if (!value) return "";
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

export interface ExportedProfile {
  uid: string;
  email: string;
  name: string;
  avatar: string;
  providerIds: string[];
  createdAt: string;
  lastLoginAt: string;
}

/**
 * `role` and `status` are deliberately absent: they are our authorization state
 * about the user, not personal data the user supplied, and `status` in
 * particular would tell a suspended account exactly what we recorded about it.
 * `_id` / `__v` are storage plumbing and mean nothing outside our database.
 */
export const buildExportedProfile = (doc: LeanDoc | null): ExportedProfile | null => {
  if (!doc) return null;
  return {
    uid: str(doc.uid),
    email: str(doc.email),
    name: str(doc.name),
    avatar: str(doc.avatar),
    providerIds: Array.isArray(doc.providerIds) ? doc.providerIds.map(str) : [],
    createdAt: toIso(doc.createdAt),
    lastLoginAt: toIso(doc.lastLoginAt),
  };
};

/**
 * WHY THE ALLOW-LIST IS PAIRED WITH A WITHHELD LIST.
 *
 * The first version of this file was a correct allow-list that then ROTTED: it
 * was written in Phase 1 and Phases 2 and 4 added GSTINs, PAN, IGST, TDS, the
 * signature block, place of supply and the credit/debit-note fields to
 * `models/Invoice.ts` without anyone touching it. Nothing failed — the export
 * simply, silently, stopped being complete, and a GST-registered user who
 * followed the delete flow's own "download your data first" gate lost their
 * GSTIN, HSN codes and IGST with no way to tell.
 *
 * So the allow-list stays (a spread would re-open the token leak described at
 * the top of this file), and every field the schema has that is NOT exported
 * must be named below with a reason. `tests/account-export-schema.test.ts`
 * reads the Mongoose schema paths and fails if a path is in neither list —
 * which makes "add a field to the model" a build failure until someone decides
 * whether the user gets it.
 */
export const INVOICE_FIELDS_WITHHELD = [
  // Exported as `id`. The Mongo ObjectId itself is storage plumbing.
  "_id",
  // Mongoose's document version counter.
  "__v",
  // Our tenant key. It is the caller's own uid and is already on `profile.uid`;
  // repeating it on every invoice row says nothing new.
  "userId",
  // Server-derived index key: `invoiceNumber` with whitespace stripped and
  // upper-cased, never printed and never accepted from a request. The number as
  // the user typed it is exported.
  "invoiceNumberKey",
] as const;

/** Item `_id` is a subdocument id Mongoose adds; it names nothing outside our database. */
export const INVOICE_ITEM_FIELDS_WITHHELD = ["_id"] as const;

export interface ExportedInvoiceItem {
  name: string;
  price: number;
  quantity: number;
  /** Rule 46(g). Absent on a line written before per-line tax existed. */
  hsnSac?: string;
  unit?: string;
  discount?: number;
  taxRatePercent?: number;
  /** Derived and stored at issue time, so the export re-prints what was issued. */
  taxableValue?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
}

/** Rule 53(1A): the invoice a credit/debit note corrects. */
export interface ExportedOriginalInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
}

export interface ExportedInvoice {
  id: string;
  invoiceNumber: string;
  /** Rule 46(b) uniqueness scope, e.g. "2026-27". Absent on legacy documents. */
  financialYear?: string;
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  companyAddress: string;
  companyLogo: string;
  /** Rule 46(a)/(e): both parties' GSTINs, as they stood on the document. */
  companyGstin: string;
  companyPan: string;
  billTo: string;
  billToEmail: string;
  billToAddress: string;
  billToGstin: string;
  invoiceDate: string;
  dueDate: string;
  terms: string;
  notes: string;
  currency: string;
  items: ExportedInvoiceItem[];
  subtotal: number;
  discount: number;
  /** Legacy single-tax field. Still present on pre-migration documents, and it
   *  is the user's own number, so it ships rather than being silently dropped. */
  tax?: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxableValue?: number;
  roundOff: number;
  /** Labeled "Service Charge" everywhere a user reads it. */
  convenienceCharge: number;
  tdsSection?: string;
  tdsRatePercent?: number;
  tdsAmount?: number;
  paymentInfo: string;
  total: number;
  status: string;
  signatureLabel: string;
  signatureImageUrl: string;
  /**
   * WHAT this document is. Absent means an ordinary invoice — the same absence
   * the schema uses — so a credit note is distinguishable from the invoice it
   * corrects, which it was not in version 1 of this file.
   */
  documentKind?: string;
  documentType?: string;
  taxTreatment?: string;
  originalInvoice?: ExportedOriginalInvoice;
  reasonForIssue?: string;
  reverseCharge?: boolean;
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
  placeOfSupplyLabel: string;
  placeOfSupplyOverridden?: boolean;
  supplyKind?: string;
  recipientIsSez?: boolean;
  recipientIsOutsideIndia?: boolean;
  withPaymentOfTax?: boolean;
  lutArn: string;
  countryOfDestination: string;
  /** Preserved, not filtered on. A deleted invoice is still the user's data. */
  is_deleted: boolean;
  createdAt: string;
}

/**
 * The nested reference, kept as an object rather than three flattened columns
 * so an absent one stays absent instead of becoming three empty strings.
 */
const buildExportedOriginalInvoice = (
  value: unknown
): ExportedOriginalInvoice | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const ref = value as LeanDoc;
  const invoiceId = str(ref.invoiceId);
  const invoiceNumber = str(ref.invoiceNumber);
  const invoiceDate = toIso(ref.invoiceDate);
  if (!invoiceId && !invoiceNumber && !invoiceDate) return undefined;
  return { invoiceId, invoiceNumber, invoiceDate };
};

export const buildExportedInvoice = (doc: LeanDoc): ExportedInvoice => ({
  id: str(doc._id),
  invoiceNumber: str(doc.invoiceNumber),
  financialYear: optionalStr(doc.financialYear),
  companyName: str(doc.companyName),
  companyEmail: str(doc.companyEmail),
  companyPhone: str(doc.companyPhone),
  companyAddress: str(doc.companyAddress),
  companyLogo: str(doc.companyLogo),
  companyGstin: str(doc.companyGstin),
  companyPan: str(doc.companyPan),
  billTo: str(doc.billTo),
  billToEmail: str(doc.billToEmail),
  billToAddress: str(doc.billToAddress),
  billToGstin: str(doc.billToGstin),
  invoiceDate: toIso(doc.invoiceDate),
  dueDate: toIso(doc.dueDate),
  terms: str(doc.terms),
  notes: str(doc.notes),
  currency: str(doc.currency),
  items: Array.isArray(doc.items)
    ? doc.items.map((raw) => {
        const item = (raw ?? {}) as LeanDoc;
        return {
          name: str(item.name),
          price: num(item.price),
          quantity: num(item.quantity),
          hsnSac: optionalStr(item.hsnSac),
          unit: optionalStr(item.unit),
          discount: optionalNum(item.discount),
          taxRatePercent: optionalNum(item.taxRatePercent),
          taxableValue: optionalNum(item.taxableValue),
          cgstAmount: optionalNum(item.cgstAmount),
          sgstAmount: optionalNum(item.sgstAmount),
          igstAmount: optionalNum(item.igstAmount),
        };
      })
    : [],
  subtotal: num(doc.subtotal),
  discount: num(doc.discount),
  tax: optionalNum(doc.tax),
  cgst: num(doc.cgst),
  sgst: num(doc.sgst),
  igst: num(doc.igst),
  taxableValue: optionalNum(doc.taxableValue),
  roundOff: num(doc.roundOff),
  convenienceCharge: num(doc.convenienceCharge),
  tdsSection: optionalStr(doc.tdsSection),
  tdsRatePercent: optionalNum(doc.tdsRatePercent),
  tdsAmount: optionalNum(doc.tdsAmount),
  paymentInfo: str(doc.paymentInfo),
  total: num(doc.total),
  status: str(doc.status),
  signatureLabel: str(doc.signatureLabel),
  signatureImageUrl: str(doc.signatureImageUrl),
  documentKind: optionalStr(doc.documentKind),
  documentType: optionalStr(doc.documentType),
  taxTreatment: optionalStr(doc.taxTreatment),
  originalInvoice: buildExportedOriginalInvoice(doc.originalInvoice),
  reasonForIssue: optionalStr(doc.reasonForIssue),
  reverseCharge: optionalBool(doc.reverseCharge),
  supplierStateCode: str(doc.supplierStateCode),
  placeOfSupplyStateCode: str(doc.placeOfSupplyStateCode),
  placeOfSupplyLabel: str(doc.placeOfSupplyLabel),
  placeOfSupplyOverridden: optionalBool(doc.placeOfSupplyOverridden),
  supplyKind: optionalStr(doc.supplyKind),
  recipientIsSez: optionalBool(doc.recipientIsSez),
  recipientIsOutsideIndia: optionalBool(doc.recipientIsOutsideIndia),
  withPaymentOfTax: optionalBool(doc.withPaymentOfTax),
  lutArn: str(doc.lutArn),
  countryOfDestination: str(doc.countryOfDestination),
  is_deleted: doc.is_deleted === true,
  createdAt: toIso(doc.createdAt),
});

/**
 * The seller side of every invoice, saved once per user: GSTIN, PAN, postal
 * address, bank account, IFSC, UPI VPA, signature.
 *
 * It was missing from this export entirely while `DELETE /api/account` already
 * `deleteMany`-ed the collection — so the delete flow's own "download your data
 * first" gate handed the user a file that did not contain the most identifying
 * and least reconstructible record the product holds. This is the collection
 * whose absence made the export's completeness claim false.
 */
export const BUSINESS_PROFILE_FIELDS_WITHHELD = [
  "_id",
  "__v",
  // Our tenant key; already on `profile.uid`.
  "userId",
] as const;

export interface ExportedBusinessProfile {
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  companyAddress: string;
  companyLogo: string;
  companyGstin: string;
  companyPan: string;
  supplierStateCode: string;
  taxTreatment?: string;
  lutArn: string;
  upiVpa: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankName: string;
  defaultCurrency: string;
  defaultTerms: string;
  defaultPaymentInfo: string;
  defaultDueDays?: number;
  invoiceNumberPattern: string;
  signatureLabel: string;
  signatureImageUrl: string;
  createdAt: string;
  updatedAt: string;
}

export const buildExportedBusinessProfile = (
  doc: LeanDoc | null
): ExportedBusinessProfile | null => {
  if (!doc) return null;
  return {
    companyName: str(doc.companyName),
    companyEmail: str(doc.companyEmail),
    companyPhone: str(doc.companyPhone),
    companyAddress: str(doc.companyAddress),
    companyLogo: str(doc.companyLogo),
    companyGstin: str(doc.companyGstin),
    companyPan: str(doc.companyPan),
    supplierStateCode: str(doc.supplierStateCode),
    taxTreatment: optionalStr(doc.taxTreatment),
    lutArn: str(doc.lutArn),
    upiVpa: str(doc.upiVpa),
    bankAccountName: str(doc.bankAccountName),
    bankAccountNumber: str(doc.bankAccountNumber),
    bankIfsc: str(doc.bankIfsc),
    bankName: str(doc.bankName),
    defaultCurrency: str(doc.defaultCurrency),
    defaultTerms: str(doc.defaultTerms),
    defaultPaymentInfo: str(doc.defaultPaymentInfo),
    defaultDueDays: optionalNum(doc.defaultDueDays),
    invoiceNumberPattern: str(doc.invoiceNumberPattern),
    signatureLabel: str(doc.signatureLabel),
    signatureImageUrl: str(doc.signatureImageUrl),
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
};

export interface ExportedFeedback {
  id: string;
  message: string;
  rating?: number;
  category: string;
  page: string;
  createdAt: string;
}

/** `status` is our triage state, not the user's submission. It stays internal. */
export const buildExportedFeedback = (doc: LeanDoc): ExportedFeedback => ({
  id: str(doc._id),
  message: str(doc.message),
  rating: optionalNum(doc.rating),
  category: str(doc.category),
  page: str(doc.page),
  createdAt: toIso(doc.createdAt),
});

/**
 * The only `meta` keys that survive into an activity row.
 *
 * The redaction here cuts BOTH ways and that is the point. `ip` and
 * `userAgent` are the user's own data and belong in their export. Our stack
 * traces (`meta.stack`), internal route names (`meta.route`), status codes and
 * `requestId` are our operational detail, not theirs — shipping them is the
 * same information-disclosure class as returning `err.message` to a client.
 * `message` is dropped for the same reason: on error rows it is the exception
 * text.
 */
export const ACTIVITY_META_ALLOWLIST = [
  "invoiceId",
  "amount",
  "currency",
  "format",
] as const;

export interface ExportedActivity {
  at: string;
  category: string;
  event: string;
  ip: string;
  userAgent: string;
  meta: Record<string, unknown>;
}

export const buildExportedActivity = (doc: LeanDoc): ExportedActivity => {
  const rawMeta = (doc.meta ?? {}) as LeanDoc;
  const meta: Record<string, unknown> = {};
  for (const key of ACTIVITY_META_ALLOWLIST) {
    if (rawMeta[key] !== undefined && rawMeta[key] !== null) {
      meta[key] = rawMeta[key];
    }
  }
  return {
    at: toIso(doc.at),
    category: str(doc.category),
    event: str(doc.event),
    ip: str(doc.ip),
    userAgent: str(doc.userAgent),
    meta,
  };
};

export interface AccountExport {
  meta: {
    generatedAt: string;
    format: typeof ACCOUNT_EXPORT_FORMAT;
    version: number;
    counts: { invoices: number; feedback: number; activity: number };
    truncated: { invoices: boolean; activity: boolean };
    notes: string[];
  };
  profile: ExportedProfile | null;
  /** `null` for a user who never saved one — not an empty object, which would
   *  read as "we hold a profile and it is blank". */
  businessProfile: ExportedBusinessProfile | null;
  invoices: ExportedInvoice[];
  feedback: ExportedFeedback[];
  activity: ExportedActivity[];
}

export interface AccountExportInput {
  profile: LeanDoc | null;
  /** Optional in the signature only so a test can omit it; the route passes it. */
  businessProfile?: LeanDoc | null;
  invoices: LeanDoc[];
  feedback: LeanDoc[];
  activity: LeanDoc[];
  truncated: { invoices: boolean; activity: boolean };
  generatedAt?: Date;
}

export const buildAccountExport = (input: AccountExportInput): AccountExport => {
  const invoices = input.invoices.map(buildExportedInvoice);
  const feedback = input.feedback.map(buildExportedFeedback);
  const activity = input.activity.map(buildExportedActivity);

  return {
    meta: {
      generatedAt: (input.generatedAt ?? new Date()).toISOString(),
      format: ACCOUNT_EXPORT_FORMAT,
      version: ACCOUNT_EXPORT_VERSION,
      counts: {
        invoices: invoices.length,
        feedback: feedback.length,
        activity: activity.length,
      },
      truncated: input.truncated,
      notes: [
        "Invoices you deleted are included here, marked is_deleted: true.",
        "Activity rows carry your IP and device string. Our own diagnostics — stack traces, internal route names, request ids — are stripped; they are not your data.",
        "If you are registered under GST you must keep your invoice records for 72 months. Invoicey is not your books of account.",
        "businessProfile is your saved seller details — GSTIN, PAN, address, bank account, IFSC and UPI ID. Deleting your account destroys it, and we cannot get it back for you.",
      ],
    },
    profile: buildExportedProfile(input.profile),
    businessProfile: buildExportedBusinessProfile(input.businessProfile ?? null),
    invoices,
    feedback,
    activity,
  };
};

export const ACCOUNT_EXPORT_CSV_HEADER: string[] = [
  "invoiceNumber",
  // A credit note read as an ordinary invoice in the flat file too, so a
  // spreadsheet summing the total column double-counted a corrected sale.
  "documentKind",
  "status",
  "is_deleted",
  "companyName",
  "companyGstin",
  "billTo",
  "billToEmail",
  "billToGstin",
  "currency",
  "subtotal",
  "discount",
  "cgst",
  "sgst",
  "igst",
  "convenienceCharge",
  "roundOff",
  "total",
  "invoiceDate",
  "dueDate",
  "createdAt",
];

/**
 * CSV covers invoices only, and only the columns below — it is a flat format
 * and an invoice is not flat (line items, the note reference and the whole
 * business profile have nowhere to go in a single row). THE JSON IS THE
 * COMPLETE RECORD; this is a summary for a spreadsheet, and the UI must say
 * exactly that rather than implying the two are interchangeable. Encoding goes
 * through `toCsv`, which already owns quote doubling and the leading-`=+-@`
 * formula-injection defusal; a second encoder here would be a third place for
 * that bug to come back.
 */
export const buildAccountExportCsv = (invoices: ExportedInvoice[]): string => {
  const rows: CsvCell[][] = [
    ACCOUNT_EXPORT_CSV_HEADER,
    ...invoices.map((invoice) => [
      invoice.invoiceNumber,
      invoice.documentKind || "invoice",
      invoice.status,
      invoice.is_deleted ? "true" : "false",
      invoice.companyName,
      invoice.companyGstin,
      invoice.billTo,
      invoice.billToEmail,
      invoice.billToGstin,
      invoice.currency,
      invoice.subtotal,
      invoice.discount,
      invoice.cgst,
      invoice.sgst,
      invoice.igst,
      invoice.convenienceCharge,
      invoice.roundOff,
      invoice.total,
      invoice.invoiceDate,
      invoice.dueDate,
      invoice.createdAt,
    ]),
  ];
  return toCsv(rows);
};

/** `invoicey-export-2026-08-17.json` — dated so repeated downloads don't collide. */
export const accountExportFilename = (
  format: "json" | "csv",
  now: Date = new Date()
): string => `invoicey-export-${now.toISOString().slice(0, 10)}.${format}`;
