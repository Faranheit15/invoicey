import mongoose, { Schema, Document } from "mongoose";
import type {
  DocumentType,
  SupplyKind,
  TaxTreatment,
} from "@/lib/gst-supply";
import type {
  InvoiceDocumentKind,
  OriginalInvoiceRef,
  TdsSection,
} from "@/lib/invoice-domain";

export interface IInvoice extends Document {
  userId: string;
  companyName: string;
  companyEmail?: string;
  companyPhone?: string;
  companyAddress?: string;
  companyLogo?: string;
  billTo: string;
  billToEmail?: string;
  billToAddress?: string;
  invoiceNumber: string;
  /**
   * Rule 46(b) uniqueness scope: "2026-27", derived server-side from
   * `invoiceDate` (as a civil date, never a local one). Optional because every
   * document written before invoice numbering was enforced has neither this nor
   * `invoiceNumberKey`; the migration backfills both.
   */
  financialYear?: string;
  /**
   * `invoiceNumber` with whitespace removed and folded to upper case — the
   * value the unique index is built on, so `inv/2026-27/001` and
   * `INV/2026-27/001` cannot both exist. Server-derived; never accepted from a
   * request, and never printed (the document shows `invoiceNumber` as typed).
   */
  invoiceNumberKey?: string;
  invoiceDate: Date;
  dueDate: Date;
  terms?: string;
  notes?: string;
  currency: string;
  items: {
    name: string;
    price: number;
    quantity: number;
    hsnSac?: string;
    unit?: string;
    discount?: number;
    taxRatePercent?: number;
    taxableValue?: number;
    cgstAmount?: number;
    sgstAmount?: number;
    igstAmount?: number;
  }[];
  subtotal: number;
  discount: number;
  tax?: number;
  cgst: number;
  sgst: number;
  igst?: number;
  taxableValue?: number;
  roundOff?: number;
  convenienceCharge: number;
  paymentInfo?: string;
  total: number;
  status: "draft" | "sent" | "paid" | "overdue";
  is_deleted: boolean;
  createdAt: Date;

  // Phase 2 GST fields, all optional. `taxTreatment` and `documentType` have NO
  // schema default on purpose: absence is how a pre-Phase-2 document announces
  // itself to `resolveTaxContext`, and a default would erase that the first time
  // an old document is re-saved.
  /**
   * Rule 46(a)/(e): the supplier's and the recipient's GSTIN. On the INVOICE,
   * not read live from the business profile — an invoice is a historical
   * record, and changing a registration must not rewrite documents a client
   * already holds. Both optional: below the registration thresholds a user has
   * no GSTIN, and that is the majority case.
   */
  companyGstin?: string;
  billToGstin?: string;
  /** Characters 3-12 of the GSTIN. Every client deducting TDS needs it. */
  companyPan?: string;
  tdsSection?: TdsSection;
  tdsRatePercent?: number;
  /** Derived and stored, so a rate change cannot restate an issued document. */
  tdsAmount?: number;
  signatureLabel?: string;
  signatureImageUrl?: string;
  taxTreatment?: TaxTreatment;
  documentType?: DocumentType;
  /**
   * Phase 4. WHAT this document is, as opposed to what tax shape it has.
   *
   * ABSENT MEANS "invoice", and that absence is load-bearing twice over: every
   * document written before this field existed is an ordinary invoice, and a
   * NEW invoice is stored with the field absent too — which is what keeps both
   * in ONE numbering series under the unique index below. Only proformas,
   * quotations and credit/debit notes ever carry a value.
   */
  documentKind?: InvoiceDocumentKind;
  /**
   * Rule 53(1A): the serial number and date of the invoice this note corrects,
   * both mandatory particulars. Written only from an invoice the route has just
   * re-read under the caller's own uid — never from the request body — so a
   * note cannot name an invoice that does not exist, belongs to another user,
   * or has been soft-deleted.
   */
  originalInvoice?: OriginalInvoiceRef & { invoiceDate: Date | string };
  /** Rule 53: why the note was issued. */
  reasonForIssue?: string;
  reverseCharge?: boolean;
  supplierStateCode?: string;
  placeOfSupplyStateCode?: string;
  placeOfSupplyLabel?: string;
  placeOfSupplyOverridden?: boolean;
  supplyKind?: SupplyKind;
  recipientIsSez?: boolean;
  recipientIsOutsideIndia?: boolean;
  withPaymentOfTax?: boolean;
  lutArn?: string;
  countryOfDestination?: string;
}

/**
 * ADDING A FIELD HERE IS ALSO A CHANGE TO THE DPDP EXPORT.
 *
 * `lib/server/account-export.ts` allow-lists every field it ships (a spread
 * would post pre-migration Firebase tokens back over HTTP), which means it goes
 * stale every time this schema grows — it did exactly that across Phases 2 and
 * 4, and the export silently stopped containing GSTINs, HSN codes, IGST and the
 * credit-note reference while still telling users it was their complete record.
 * `tests/account-export-schema.test.ts` now reads the schema paths below and
 * fails unless each one is either exported or named as deliberately withheld.
 * So: add the field here, then decide there. The test will insist.
 */
const InvoiceSchema: Schema = new Schema({
  // Tenant owner. The non-empty validator stops any future write from creating
  // an orphan (tenant-less) row. NOTE: true isolation is still application-
  // enforced by the `{ _id, userId }` query filters in the route — this only
  // prevents *new* orphans; legacy orphans are handled by the audit script.
  userId: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: (value: string) =>
        typeof value === "string" && value.trim().length > 0,
      message: "userId must be a non-empty string",
    },
  },
  companyName: { type: String, required: true },
  companyEmail: { type: String, default: "" },
  companyPhone: { type: String, default: "" },
  companyAddress: { type: String, default: "" },
  companyLogo: { type: String, default: "" },
  billTo: { type: String, required: true },
  billToEmail: { type: String, default: "" },
  billToAddress: { type: String, default: "" },
  invoiceNumber: { type: String, required: true },
  // Both derived in `normalizePayload`, never read from the request. No
  // defaults: absence is what a pre-enforcement document looks like, and the
  // migration is what turns that absence into a value.
  financialYear: { type: String },
  invoiceNumberKey: { type: String },
  invoiceDate: { type: Date, required: true },
  dueDate: { type: Date, required: true },
  terms: { type: String, default: "" },
  notes: { type: String, default: "" },
  currency: { type: String, default: "INR" },
  items: [
    {
      name: { type: String, required: true },
      price: { type: Number, required: true },
      quantity: { type: Number, required: true },
      // Item 6. No defaults: an absent HSN/SAC or rate means the line was
      // written before per-line tax existed, and the printed table omits the
      // column entirely rather than showing an empty one.
      hsnSac: { type: String },
      unit: { type: String },
      discount: { type: Number },
      taxRatePercent: { type: Number },
      // Derived, stored so a later rate-table edit cannot re-price an issued
      // document.
      taxableValue: { type: Number },
      cgstAmount: { type: Number },
      sgstAmount: { type: Number },
      igstAmount: { type: Number },
    },
  ],
  subtotal: { type: Number, required: true },
  discount: { type: Number, required: true, default: 0 },
  // Pre-migration single tax field. Still read as a fallback, never written.
  tax: { type: Number, default: 0 },
  // `required: true` alongside `default: 0` could never fire — the default runs
  // first, so the validator saw 0, not undefined. It was never what forced tax
  // rows onto unregistered users (unconditional rows in `buildTotalsRows` were).
  // Dropped as dead weight; the default stays, because it is load-bearing.
  cgst: { type: Number, default: 0 },
  sgst: { type: Number, default: 0 },
  igst: { type: Number, default: 0 },
  taxableValue: { type: Number },
  roundOff: { type: Number, default: 0 },
  convenienceCharge: { type: Number, required: true },
  paymentInfo: { type: String, default: "" },
  total: { type: Number, required: true },
  status: {
    type: String,
    enum: ["draft", "sent", "paid", "overdue"],
    default: "draft",
  },
  is_deleted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },

  // --- Phase 2: registration status, supply geography, reverse charge.
  // NO default on taxTreatment/documentType/supplyKind: absence means
  // "written before this field existed" and must stay distinguishable from an
  // explicit value, or the legacy read path becomes untestable.
  // Party identity. `uppercase`/`trim` at the schema level as well as in the
  // route: these are identifiers with no lowercase letters in their alphabet,
  // and a write that bypassed the normaliser must not store a variant spelling
  // of the same GSTIN.
  companyGstin: { type: String, uppercase: true, trim: true, default: "" },
  billToGstin: { type: String, uppercase: true, trim: true, default: "" },
  companyPan: { type: String, uppercase: true, trim: true, default: "" },
  // TDS. No default on `tdsSection` for the same reason as `taxTreatment`:
  // absence is how a pre-item-7 document says it never had the field.
  tdsSection: {
    type: String,
    enum: ["none", "194J_professional", "194J_technical", "194C"],
  },
  tdsRatePercent: { type: Number },
  tdsAmount: { type: Number },
  signatureLabel: { type: String, default: "" },
  signatureImageUrl: { type: String, default: "" },

  taxTreatment: { type: String, enum: ["none", "gst", "composition"] },
  documentType: {
    type: String,
    enum: ["tax_invoice", "invoice", "bill_of_supply"],
  },
  // NO default and NO "invoice" member in the enum: an ordinary invoice is
  // stored with this field ABSENT, which is what puts it in the same index key
  // space as every document written before Phase 4. Writing "invoice" here
  // would split one series into two.
  documentKind: {
    type: String,
    enum: ["proforma", "quotation", "credit_note", "debit_note"],
  },
  // A nested path rather than a subdocument: no _id, and an absent reference is
  // an absent object rather than one full of empty strings.
  originalInvoice: {
    invoiceId: { type: String },
    invoiceNumber: { type: String },
    invoiceDate: { type: Date },
  },
  reasonForIssue: { type: String },
  reverseCharge: { type: Boolean, default: false },
  supplierStateCode: { type: String, default: "" },
  placeOfSupplyStateCode: { type: String, default: "" },
  placeOfSupplyLabel: { type: String, default: "" },
  placeOfSupplyOverridden: { type: Boolean, default: false },
  supplyKind: { type: String, enum: ["intra", "inter", "export", "sez"] },
  recipientIsSez: { type: Boolean, default: false },
  recipientIsOutsideIndia: { type: Boolean, default: false },
  withPaymentOfTax: { type: Boolean, default: false },
  lutArn: { type: String, default: "" },
  countryOfDestination: { type: String, default: "" },
});

// Every read is `find({ userId, is_deleted }).sort({ createdAt: -1 })`.
// This compound index turns those from collection scans into index scans.
// Prod note: on an existing collection, build this in the background (off-hours)
// so a foreground build does not lock the collection.
InvoiceSchema.index({ userId: 1, is_deleted: 1, createdAt: -1 });

// Admin cross-user scans. The compound index above leads with userId and cannot
// serve tenant-wide queries, so the admin surface needs its own. Build these in
// the background off-hours on an existing collection (see note above).
InvoiceSchema.index({ is_deleted: 1, createdAt: -1 }); // global recent list + invoices-over-time
InvoiceSchema.index({ is_deleted: 1, status: 1, currency: 1 }); // status breakdown + revenue-by-currency

/**
 * Rule 46(b): an invoice number is unique for a financial year. This index is
 * the only thing that actually guarantees it — validation runs per request and
 * two concurrent saves can pass it both.
 *
 * FULL, NOT PARTIAL, and this is the decision to preserve. A partial index
 * filtered on `{ is_deleted: { $ne: true } }` would let a user soft-delete
 * INV/2026-27/007 and issue a second, different INV/2026-27/007 — and because
 * nothing here is ever hard-deleted, both documents are retained side by side
 * for the 72 months §36 requires, sharing one serial. That is the audit finding
 * this index exists to prevent, so a soft-deleted number stays spent. The cost
 * is that a mistyped draft's number cannot be reused; the suggestion endpoint
 * skips past it, and it is visibly parked rather than silently reissued.
 *
 * `documentKind` IS in the key, as of Phase 4, and `documentType` still is not.
 *
 * The two are different questions. `documentType` (TAX INVOICE / INVOICE / BILL
 * OF SUPPLY) is derived from the supplier's registration and does not open a
 * new series — an unregistered person's INVOICE and a registered person's TAX
 * INVOICE are the same running sequence, and putting it in the key would let
 * one user reuse a number simply by changing their GST status. `documentKind`
 * is the series itself: Rule 46(b)'s "unique for a financial year" is per
 * series, and a proforma numbered into the tax-invoice sequence leaves a gap in
 * a sequence the law requires to be consecutive.
 *
 * THE MIGRATION IMPLICATION, and why it is unusually cheap: an ordinary invoice
 * is stored with `documentKind` ABSENT, which is exactly what every pre-Phase-4
 * document already has. Both index as null, so the invoice series keeps the
 * identical key space it had before and NO BACKFILL IS REQUIRED — this is the
 * whole reason "invoice" is not a storable value. Only the index itself has to
 * be replaced, and the old one must be DROPPED first: leaving
 * `uniq_user_fy_invoice_number` in place would keep enforcing uniqueness ACROSS
 * series, so a user whose proformas and invoices share a numbering pattern
 * would be refused a legitimate proforma number. `bun run
 * migrate:invoice-numbering` does the drop-then-build in the right order.
 *
 * ORDER OF DEPLOYMENT MATTERS: every legacy document is missing both numbering
 * fields, so they all index as (null, null) and a unique build fails
 * immediately. Run `bun run migrate:invoice-numbering` first (it backfills and
 * REPORTS duplicates rather than renumbering), resolve what it reports, then
 * build this in the background off-hours.
 */
InvoiceSchema.index(
  { userId: 1, financialYear: 1, documentKind: 1, invoiceNumberKey: 1 },
  { unique: true, name: "uniq_user_fy_kind_invoice_number" }
);

export default mongoose.models.Invoice ||
  mongoose.model<IInvoice>("Invoice", InvoiceSchema);
