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
 */

import { toCsv, type CsvCell } from "@/lib/server/admin-export";

export const ACCOUNT_EXPORT_FORMAT = "invoicey-account-export";
export const ACCOUNT_EXPORT_VERSION = 1;

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

export interface ExportedInvoiceItem {
  name: string;
  price: number;
  quantity: number;
}

export interface ExportedInvoice {
  id: string;
  invoiceNumber: string;
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  companyAddress: string;
  companyLogo: string;
  billTo: string;
  billToEmail: string;
  billToAddress: string;
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
  /** Labeled "Service Charge" everywhere a user reads it. */
  convenienceCharge: number;
  paymentInfo: string;
  total: number;
  status: string;
  /** Preserved, not filtered on. A deleted invoice is still the user's data. */
  is_deleted: boolean;
  createdAt: string;
}

export const buildExportedInvoice = (doc: LeanDoc): ExportedInvoice => ({
  id: str(doc._id),
  invoiceNumber: str(doc.invoiceNumber),
  companyName: str(doc.companyName),
  companyEmail: str(doc.companyEmail),
  companyPhone: str(doc.companyPhone),
  companyAddress: str(doc.companyAddress),
  companyLogo: str(doc.companyLogo),
  billTo: str(doc.billTo),
  billToEmail: str(doc.billToEmail),
  billToAddress: str(doc.billToAddress),
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
        };
      })
    : [],
  subtotal: num(doc.subtotal),
  discount: num(doc.discount),
  tax: optionalNum(doc.tax),
  cgst: num(doc.cgst),
  sgst: num(doc.sgst),
  convenienceCharge: num(doc.convenienceCharge),
  paymentInfo: str(doc.paymentInfo),
  total: num(doc.total),
  status: str(doc.status),
  is_deleted: doc.is_deleted === true,
  createdAt: toIso(doc.createdAt),
});

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
  invoices: ExportedInvoice[];
  feedback: ExportedFeedback[];
  activity: ExportedActivity[];
}

export interface AccountExportInput {
  profile: LeanDoc | null;
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
      ],
    },
    profile: buildExportedProfile(input.profile),
    invoices,
    feedback,
    activity,
  };
};

export const ACCOUNT_EXPORT_CSV_HEADER: string[] = [
  "invoiceNumber",
  "status",
  "is_deleted",
  "companyName",
  "billTo",
  "billToEmail",
  "currency",
  "subtotal",
  "discount",
  "cgst",
  "sgst",
  "convenienceCharge",
  "total",
  "invoiceDate",
  "dueDate",
  "createdAt",
];

/**
 * CSV covers invoices only — it is a flat format and the account export is not
 * flat. The JSON is the complete record, and the UI says so. Encoding goes
 * through `toCsv`, which already owns quote doubling and the leading-`=+-@`
 * formula-injection defusal; a second encoder here would be a third place for
 * that bug to come back.
 */
export const buildAccountExportCsv = (invoices: ExportedInvoice[]): string => {
  const rows: CsvCell[][] = [
    ACCOUNT_EXPORT_CSV_HEADER,
    ...invoices.map((invoice) => [
      invoice.invoiceNumber,
      invoice.status,
      invoice.is_deleted ? "true" : "false",
      invoice.companyName,
      invoice.billTo,
      invoice.billToEmail,
      invoice.currency,
      invoice.subtotal,
      invoice.discount,
      invoice.cgst,
      invoice.sgst,
      invoice.convenienceCharge,
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
