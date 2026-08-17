import type { InvoiceRecord } from "@/lib/invoices";
import {
  DOCUMENT_TITLES,
  documentTypeFor,
  inferLegacyTaxTreatment,
  isRetiredGstRate,
  isServiceHsnSac,
  resolveTaxPresentation,
  splitLineTax,
  TAX_HEAD_LABELS,
  type DocumentType,
  type LineTax,
  type SupplyKind,
  type TaxHead,
  type TaxSuppressionReason,
  type TaxTreatment,
} from "@/lib/gst-supply";
import {
  isValidGstin,
  normalizeGstin,
  stateCodeFromGstin,
} from "@/lib/gstin";
import {
  DEFAULT_INVOICE_NUMBER_PATTERN,
  FALLBACK_INVOICE_NUMBER_PATTERN,
  checkInvoiceNumber,
  deriveFinancialYear,
  invoiceNumberProblemMessage,
  isFinancialYear,
  normalizeInvoiceNumber,
} from "@/lib/invoice-number";
import { isAcceptedGstRate } from "@/lib/gst-rates";

/**
 * Invoice domain: the single source of truth for the money formula, the display
 * amount resolution (including the legacy `tax` fallback), the ordered totals
 * rows shared by the live preview and the export, the line-item column list
 * shared by all three renderers, and invoice validation.
 *
 * This module imports only TYPES from lib/invoices (erased at compile time), so
 * lib/invoices can import computeTotals from here without a runtime cycle.
 * `lib/gst-supply` and `lib/gstin` are real runtime imports, and are allowed
 * because neither module imports anything from this one — the graph stays
 * acyclic in one direction. All GSTIN knowledge (regex, mod-36 checksum, state
 * table, PAN extraction) comes from `lib/gstin`; never re-implement any of it.
 */

export const round2 = (value: number): number => Number((value || 0).toFixed(2));

/**
 * Section 170, CGST Act 2017 — the sum payable is rounded to the NEAREST RUPEE:
 * ₹0.50 and above rounds up, below rounds down. Normal rounding, not banker's,
 * not always-up. `Math.round` is exactly that for non-negative amounts, which
 * is the only kind an invoice total can be.
 *
 * Applied to the GRAND TOTAL only, never per line and never per head: rounding
 * each component and then summing manufactures a discrepancy between the tax
 * shown and the tax charged.
 */
export const roundToRupee = (value: number): number =>
  Number.isFinite(value) ? Math.round(value) : 0;

/**
 * Input ceilings. They exist so a paste or a stuck key cannot produce an
 * invoice no one would accept, and so the printed sheet stays legible. Shared
 * by the editor's fields, `mapFormStateToPayload`, and the API's own
 * normalization — the client is not the only place they are enforced.
 */
export const MAX_ITEM_QUANTITY = 100_000;
export const MAX_ITEM_UNIT_PRICE = 100_000_000;
export const MAX_MONEY_VALUE = 100_000_000;

/** Clamp a money-ish number into [0, limit]; NaN and friends collapse to 0. */
export const clampToLimit = (value: number, limit: number, floor = 0): number =>
  Math.min(limit, Math.max(floor, Number.isFinite(value) ? value : floor));

/* -------------------------------------------------------------------------- */
/* Document kinds (Phase 4)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * WHAT a document is, as opposed to what tax SHAPE it has.
 *
 * `documentType` (lib/gst-supply) answers the second question and is derived
 * from `taxTreatment`: TAX INVOICE / INVOICE / BILL OF SUPPLY. It cannot answer
 * the first — a proforma issued by a registered supplier would derive
 * "tax_invoice" and print a heading that is, under Rule 46, a false statement.
 *
 * So the two axes are kept separate. `documentKind` is CHOSEN (a proforma is a
 * decision, not a derivation), `documentType` stays DERIVED, and the printed
 * heading is `documentTitleFor`, where the kind overrides the tax shape when it
 * has an opinion.
 *
 * ABSENCE MEANS "invoice". Every document ever written by this app before this
 * phase is an ordinary invoice, and `resolveDocumentKind(undefined)` says so —
 * which is also what keeps them in the SAME numbering series as new invoices
 * (see the unique index in models/Invoice.ts). Unlike `taxTreatment`, absence
 * here carries no legacy behaviour: there is nothing to distinguish.
 */
export type InvoiceDocumentKind =
  | "invoice"
  | "proforma"
  | "quotation"
  | "credit_note"
  | "debit_note";

export const INVOICE_DOCUMENT_KINDS: readonly InvoiceDocumentKind[] = [
  "invoice",
  "proforma",
  "quotation",
  "credit_note",
  "debit_note",
];

/**
 * Rule 53(1A): a credit or debit note must carry the "serial number(s) and
 * date(s) of the corresponding tax invoice(s)". Modelled explicitly rather than
 * as a loose `originalInvoiceNumber` string, because the id is what lets the
 * server PROVE the reference — it re-reads the invoice under the caller's own
 * uid and rewrites the number and date from the stored document, so a note can
 * never name an invoice that does not exist, belongs to someone else, or has
 * been deleted.
 */
export interface OriginalInvoiceRef {
  /** Mongo `_id` of the invoice being corrected. */
  invoiceId: string;
  /** As printed on that invoice. Server-derived, never trusted from a request. */
  invoiceNumber: string;
  /** `yyyy-mm-dd`. Server-derived. */
  invoiceDate: string;
}

export interface DocumentKindSpec {
  kind: InvoiceDocumentKind;
  /**
   * The printed heading, or `null` to defer to `DOCUMENT_TITLES[documentType]`.
   * A non-null title always WINS: that is what stops a proforma from a
   * registered supplier being headed "TAX INVOICE".
   */
  title: string | null;
  /** Sentence-case noun for UI chrome ("Create a proforma"). */
  noun: string;
  numberLabel: string;
  dateLabel: string;
  /**
   * The `dueDate` field's label. A proforma's validity date is the same field
   * under a different name — a second `validUntil` column would be one more
   * thing to keep in sync across four renderers for no extra information.
   */
  dueDateLabel: string;
  /**
   * The same three labels as PRINTED on the document, in the Title Case the
   * sheet's meta block has always used. Two sets rather than one case-folding
   * helper: the form's labels sit beside "Company name" and "Client email" and
   * have to match those, and a locale-aware case transform on a legal document
   * is exactly the kind of thing that quietly breaks in Turkish.
   */
  printedNumberLabel: string;
  printedDateLabel: string;
  printedDueDateLabel: string;
  /**
   * SEPARATE SERIES, and this is the point. Rule 46(b)'s "unique for a
   * financial year" is per series; a proforma numbered into the invoice series
   * leaves a gap in a sequence the law requires to be consecutive, which is the
   * first thing an auditor asks about.
   */
  numberPattern: string;
  /** Used when `numberPattern` renders past sixteen characters. */
  fallbackNumberPattern: string;
  /** Grand-total row label. A credit note credits; it does not "total". */
  grandTotalLabel: string;
  /** Rule 53: the note must name the invoice it corrects. */
  requiresOriginalInvoice: boolean;
}

export const DOCUMENT_KIND_SPECS: Record<InvoiceDocumentKind, DocumentKindSpec> = {
  invoice: {
    kind: "invoice",
    title: null,
    noun: "Invoice",
    numberLabel: "Invoice number",
    dateLabel: "Invoice date",
    dueDateLabel: "Due date",
    printedNumberLabel: "Invoice Number",
    printedDateLabel: "Invoice Date",
    printedDueDateLabel: "Due Date",
    numberPattern: DEFAULT_INVOICE_NUMBER_PATTERN,
    fallbackNumberPattern: FALLBACK_INVOICE_NUMBER_PATTERN,
    grandTotalLabel: "Total",
    requiresOriginalInvoice: false,
  },
  proforma: {
    kind: "proforma",
    title: "PROFORMA INVOICE",
    noun: "Proforma invoice",
    numberLabel: "Proforma number",
    dateLabel: "Proforma date",
    dueDateLabel: "Valid until",
    printedNumberLabel: "Proforma Number",
    printedDateLabel: "Proforma Date",
    printedDueDateLabel: "Valid Until",
    // "PI/2026-27/001" is 14 characters. Never "INV/…": a proforma sharing the
    // tax-invoice prefix is exactly the confusion the separate series exists to
    // prevent.
    numberPattern: "PI/{FY}/{SEQ:3}",
    fallbackNumberPattern: "PI/{FY2}/{SEQ:4}",
    grandTotalLabel: "Total",
    requiresOriginalInvoice: false,
  },
  quotation: {
    kind: "quotation",
    title: "QUOTATION",
    noun: "Quotation",
    numberLabel: "Quotation number",
    dateLabel: "Quotation date",
    dueDateLabel: "Valid until",
    printedNumberLabel: "Quotation Number",
    printedDateLabel: "Quotation Date",
    printedDueDateLabel: "Valid Until",
    numberPattern: "QT/{FY}/{SEQ:3}",
    fallbackNumberPattern: "QT/{FY2}/{SEQ:4}",
    grandTotalLabel: "Total",
    requiresOriginalInvoice: false,
  },
  credit_note: {
    kind: "credit_note",
    title: "CREDIT NOTE",
    noun: "Credit note",
    numberLabel: "Credit note number",
    dateLabel: "Credit note date",
    dueDateLabel: "Adjustment date",
    printedNumberLabel: "Credit Note Number",
    printedDateLabel: "Credit Note Date",
    printedDueDateLabel: "Adjustment Date",
    numberPattern: "CN/{FY}/{SEQ:3}",
    fallbackNumberPattern: "CN/{FY2}/{SEQ:4}",
    grandTotalLabel: "Total Credited",
    requiresOriginalInvoice: true,
  },
  debit_note: {
    kind: "debit_note",
    title: "DEBIT NOTE",
    noun: "Debit note",
    numberLabel: "Debit note number",
    dateLabel: "Debit note date",
    dueDateLabel: "Payable by",
    printedNumberLabel: "Debit Note Number",
    printedDateLabel: "Debit Note Date",
    printedDueDateLabel: "Payable By",
    numberPattern: "DN/{FY}/{SEQ:3}",
    fallbackNumberPattern: "DN/{FY2}/{SEQ:4}",
    grandTotalLabel: "Total Debited",
    requiresOriginalInvoice: true,
  },
};

/** Absent, unknown or malformed all mean "an ordinary invoice". */
export const resolveDocumentKind = (
  value: string | null | undefined
): InvoiceDocumentKind =>
  (INVOICE_DOCUMENT_KINDS as readonly string[]).includes(value ?? "")
    ? (value as InvoiceDocumentKind)
    : "invoice";

export const documentKindSpecFor = (
  value: string | null | undefined
): DocumentKindSpec => DOCUMENT_KIND_SPECS[resolveDocumentKind(value)];

/** §34: a credit note reduces the supplier's liability, a debit note raises it. */
export const isCreditOrDebitNote = (
  value: string | null | undefined
): boolean => {
  const kind = resolveDocumentKind(value);
  return kind === "credit_note" || kind === "debit_note";
};

export interface DocumentIdentity {
  documentKind?: string | null;
  /** Derived from `taxTreatment`; absent on a pre-Phase-2 record. */
  documentType?: DocumentType;
  /** ABSENT means pre-Phase-2. Used only to re-derive a missing `documentType`. */
  taxTreatment?: TaxTreatment;
}

/**
 * The one printed heading, for all four renderers.
 *
 * A pre-Phase-2 record has neither field and keeps the plain "INVOICE" it has
 * always printed — re-printing a document a client already holds must not
 * change its heading.
 */
export const documentTitleFor = (source: DocumentIdentity): string => {
  const spec = documentKindSpecFor(source.documentKind);
  if (spec.title) {
    return spec.title;
  }
  const documentType =
    source.documentType ??
    (source.taxTreatment ? documentTypeFor(source.taxTreatment) : "invoice");
  return DOCUMENT_TITLES[documentType] ?? DOCUMENT_TITLES.invoice;
};

/**
 * The tax language a non-invoice document MUST carry, or null.
 *
 * A proforma is not a GST document at all: it creates no liability, carries no
 * input tax credit, and must say so. What it must say depends on the supplier's
 * registration — telling an unregistered freelancer's client that "GST will be
 * charged on the tax invoice" is a claim §32 forbids them from making, and
 * telling a composition dealer's client to expect a tax invoice is wrong in the
 * other direction (they will receive a bill of supply).
 *
 * A credit or debit note from a REGISTERED supplier is a §34 document and needs
 * no disclaimer. From anyone else it adjusts nothing for GST, and says so.
 */
export const documentTaxNoticeFor = (source: DocumentIdentity): string | null => {
  const kind = resolveDocumentKind(source.documentKind);
  const treatment = source.taxTreatment;

  if (kind === "credit_note" || kind === "debit_note") {
    if (treatment === "gst") {
      return null;
    }
    const noun = kind === "credit_note" ? "credit note" : "debit note";
    return `This is a commercial ${noun}. It adjusts no GST and carries no input tax credit.`;
  }

  if (kind !== "proforma" && kind !== "quotation") {
    return null;
  }

  const noun = kind === "quotation" ? "quotation" : "proforma invoice";
  if (treatment === "gst") {
    return `This is not a tax invoice. No tax has been charged on this ${noun} and no input tax credit may be claimed against it; GST shown is indicative and will be charged on the tax invoice.`;
  }
  if (treatment === "composition") {
    return `This is not a tax invoice or a bill of supply. Tax is not collected on this ${noun}; a bill of supply will be issued when the supply is made.`;
  }
  return `This is not a tax invoice. No tax has been charged on this ${noun} and it creates no tax liability.`;
};

/**
 * "30 November 2027" — the last date a credit note against an invoice dated in
 * `originalInvoiceDate`'s financial year can still be DECLARED in a return and
 * actually reduce the supplier's output tax liability (§34(2), as amended by
 * the Finance Act 2022; or the annual return for that year, whichever is
 * earlier).
 *
 * There is NO time limit on issuing one — only on declaring it — so this is
 * surfaced as a warning and never as a block. Returns null when the date cannot
 * be read, rather than guessing a deadline onto a legal document.
 */
export const creditNoteDeclarationDeadline = (
  originalInvoiceDate: string | Date | undefined
): string | null => {
  if (!originalInvoiceDate) {
    return null;
  }
  const financialYear = deriveFinancialYear(originalInvoiceDate);
  if (!isFinancialYear(financialYear)) {
    return null;
  }
  // FY 2026-27 ends 31 March 2027, so "the 30 November following the end of the
  // financial year" is 30 November 2027 — the START year plus one.
  return `30 November ${Number(financialYear.slice(0, 4)) + 1}`;
};

/* -------------------------------------------------------------------------- */
/* TDS (item 7.3)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The withholding sections an Indian client actually deducts under when paying
 * a freelancer or a small firm. "none" is the default and means "print nothing".
 */
export type TdsSection =
  | "none"
  | "194J_professional"
  | "194J_technical"
  | "194C";

export interface TdsSectionSpec {
  value: Exclude<TdsSection, "none">;
  /** Picker copy. */
  label: string;
  /**
   * What gets PRINTED beside the amount. FY 2026-27 renumbers 194J to
   * "s.393 SN 11" and 194C to "s.393 SN 6"; that renumbering is marked
   * UNVERIFIED in the research, so both the familiar and the new citation are
   * printed together — a reader who knows either one can follow the line.
   */
  printedCode: string;
  /** Statutory rate, prefilled and overridable. */
  ratePercent: number;
}

export const TDS_SECTIONS: readonly TdsSectionSpec[] = [
  {
    value: "194J_professional",
    label: "194J — professional fees (10%)",
    printedCode: "194J / s.393 SN 11",
    ratePercent: 10,
  },
  {
    value: "194J_technical",
    label: "194J — technical services (2%)",
    printedCode: "194J / s.393 SN 11",
    ratePercent: 2,
  },
  {
    value: "194C",
    label: "194C — contract work (1% / 2%)",
    printedCode: "194C / s.393 SN 6",
    ratePercent: 1,
  },
];

/** A rate ceiling, not a rule: 20% is the no-PAN penal rate and 30% covers it. */
export const MAX_TDS_RATE_PERCENT = 30;

export const tdsSpecFor = (
  section: TdsSection | undefined
): TdsSectionSpec | null =>
  TDS_SECTIONS.find((spec) => spec.value === section) ?? null;

/**
 * The resolved TDS line. `amount` is the client's deduction, NOT a reduction of
 * the invoice — see the note on `buildTotalsRows`.
 */
export interface TdsInfo {
  section: Exclude<TdsSection, "none">;
  ratePercent: number;
  amount: number;
  /** Fully-built row label, so the three renderers cannot word it differently. */
  label: string;
}

/** @deprecated Use `TotalsLineInput`. Kept so older call sites keep compiling. */
export interface LineItemAmount {
  quantity: number;
  unitPrice: number;
}

export interface TotalsLineInput {
  quantity: number;
  unitPrice: number;
  /** Per-line discount, absolute, in currency units. */
  discount?: number;
  /** Full GST rate for this line. `undefined` means the line is untaxed. */
  taxRatePercent?: number;
  /**
   * Set only when replaying a stored, already-issued invoice. An issued
   * document must not be re-priced by a later edit to the rate table, so a
   * stored per-line split wins over a recomputed one.
   */
  storedTax?: LineTax;
}

/**
 * How tax is arrived at. A discriminated union rather than a pile of optional
 * fields, because the LEGACY arm has to keep behaving byte-for-byte like the
 * pre-Phase-2 formula, and the only way to guarantee that is to keep it as its
 * own arm instead of threading `?? tax` fallbacks through the new per-line math.
 */
export type TotalsTaxContext =
  /** Pre-Phase-2 documents: two flat, hand-typed invoice-level amounts. */
  | { mode: "legacy"; cgst: number; sgst: number }
  /** taxTreatment "none"/"composition", reverse charge, or zero-rated under LUT. */
  | { mode: "none"; suppressedBecause: TaxSuppressionReason | null }
  /** The real path: rate per line, heads from the supply geography. */
  | {
      mode: "derived";
      supplyKind: SupplyKind;
      supplierStateCode: string;
      withPaymentOfTax: boolean;
    };

export interface TotalsInput {
  items: TotalsLineInput[];
  /** Invoice-level discount, absolute. Apportioned pro-rata across the lines. */
  discount: number;
  convenienceCharge: number;
  /** Absent => `{ mode: "legacy", cgst, sgst }` from the flat fields below. */
  tax?: TotalsTaxContext;
  /**
   * ISO code. Only consulted for the §170 rupee rounding, which is a rule about
   * rupees — rounding a USD export to the whole dollar is not it.
   */
  currency?: string;
  /** @deprecated Flat legacy amounts. Present so existing call sites compile. */
  cgst?: number;
  /** @deprecated Flat legacy amounts. Present so existing call sites compile. */
  sgst?: number;
  /**
   * The client's withholding. Absent (or `"none"`) means no TDS block at all.
   * It never enters the money formula — see `buildTotalsRows`.
   */
  tds?: { section?: TdsSection; ratePercent?: number };
  /**
   * WHAT the document is. It changes no arithmetic — see the note on
   * `grandTotalLabel` — only the name of the grand-total row, which rides out
   * inside `InvoiceTotals` so all four renderers pick it up with no call-site
   * edit. Absent means "invoice".
   */
  documentKind?: InvoiceDocumentKind;
}

export interface ComputedLine {
  /** round2(qty * unitPrice) */
  gross: number;
  /** As entered, clamped into [0, gross]. */
  lineDiscount: number;
  /** This line's share of the invoice-level discount. */
  apportioned: number;
  /** round2(gross - lineDiscount - apportioned), never negative. */
  taxable: number;
  /** 0 when untaxed. */
  ratePercent: number;
  tax: LineTax;
}

export interface TaxRow {
  head: TaxHead;
  label: string;
  amount: number;
}

export interface InvoiceTotals {
  /** Σ gross — unchanged meaning, still PRE-discount. */
  subtotal: number;
  /** The discount actually applied (per-line plus invoice-level). */
  discount: number;
  /** Rule 46(j): the value tax is charged on, i.e. subtotal - discount. */
  taxableValue: number;
  lines: ComputedLine[];
  /** 0, 1 or 2 entries. Never 3, and never a zero-amount placeholder. */
  taxRows: TaxRow[];
  /** Rollup. Carries UTGST for a union-territory intra-State supplier. */
  cgst: number;
  /** Rollup. Carries UTGST for a union-territory intra-State supplier. */
  sgst: number;
  igst: number;
  convenienceCharge: number;
  /** Signed §170 adjustment; 0 in legacy and no-tax modes. */
  roundOff: number;
  total: number;
  /** Drives the explanatory line under the totals. */
  suppressedBecause: TaxSuppressionReason | null;
  /**
   * The client's TDS deduction, or `null`. Deliberately OUTSIDE `total`: TDS is
   * withheld by the recipient and paid to the government on the supplier's
   * behalf, so the invoice's legal value is unchanged by it. It rides inside
   * `InvoiceTotals` (design decision D1) so every renderer picks the two rows
   * up from `buildTotalsRows` with no call-site edit.
   */
  tds: TdsInfo | null;
  /**
   * What the grand-total row is CALLED. "Total" for an invoice, "Total
   * Credited" for a credit note, "Total Debited" for a debit note.
   *
   * A LABEL, not a sign — and that is the whole design decision for §34. A
   * credit note flows through `computeTotals` unchanged: every amount on it is
   * a positive magnitude ("value of supply, rate and amount of tax credited",
   * Rule 53(1A)), and the direction is a property of the DOCUMENT, not of the
   * arithmetic. Negating the total here would give the formula a second
   * meaning, defeat the `Math.max(0, …)` clamp that stops a discount producing
   * a nonsense total, and put a minus sign on a printed credit note that no
   * accountant expects to see there.
   *
   * Optional so that hand-built `InvoiceTotals` literals keep compiling;
   * `computeTotals` always sets it and `buildTotalsRows` falls back to "Total".
   */
  grandTotalLabel?: string;
}

const ZERO_LINE_TAX: LineTax = { cgst: 0, sgst: 0, igst: 0 };

/** "9", "2.5", "0.125" — never "9.00". Used only for tax-row labels. */
const formatRate = (rate: number): string => String(Number(rate.toFixed(3)));

/**
 * Apportion an invoice-level discount pro-rata across the lines that still have
 * value in them, with the residual absorbed by the LAST such line.
 *
 * The naive `round2(invDisc * net_i / netBase)` on every line does not sum back
 * to `invDisc` — ₹100 across three equal lines gives 33.33 × 3 = 99.99 — and
 * then the printed Discount row disagrees with the sum of the line reductions
 * by a paisa, which is the kind of thing an accountant emails about. Giving the
 * last non-zero line the remainder makes the sum exact by construction.
 *
 * Lines with no value left take nothing and are skipped when picking "the last
 * one", so the residual can never land on a line that has nothing to reduce.
 */
const apportionDiscount = (
  netValues: number[],
  netBase: number,
  amount: number
): number[] => {
  const apportioned = netValues.map(() => 0);
  if (amount <= 0 || netBase <= 0) {
    return apportioned;
  }

  const eligible = netValues
    .map((value, index) => ({ value, index }))
    .filter((entry) => entry.value > 0);
  if (eligible.length === 0) {
    return apportioned;
  }

  let allocated = 0;
  eligible.forEach((entry, position) => {
    if (position === eligible.length - 1) {
      apportioned[entry.index] = round2(amount - allocated);
      return;
    }
    const share = round2((amount * entry.value) / netBase);
    apportioned[entry.index] = share;
    allocated = round2(allocated + share);
  });

  return apportioned;
};

/**
 * The one totals formula.
 *
 * Legacy mode is the formula this app has always had:
 * `subtotal - discount + cgst + sgst + convenienceCharge`, clamped at 0, every
 * step `round2`. The generalisation replaces the scalar `cgst + sgst` with the
 * sum of the per-line splits, inserts the discount apportionment and the
 * taxable-value step, and adds the §170 rupee rounding of the grand total.
 *
 * Two things deliberately do NOT happen in legacy mode, because a document a
 * client already holds must re-print with the numbers it was issued with:
 *
 *  - the invoice-level discount is reported AS ENTERED rather than clamped to
 *    the line values (in the new modes it is clamped, so that the Discount row
 *    always equals the sum of what was actually taken off the lines);
 *  - the grand total is not rounded to the rupee.
 *
 * `convenienceCharge` stays OUTSIDE the tax base. §15(2)(c) arguably makes it
 * taxable, but making it so here would silently change the total of every
 * invoice a user habitually produces inside the same commit that changes
 * everything else about tax. The right fix is to retire the field into an
 * ordinary line item with its own rate; that is a later decision, recorded
 * rather than silently taken.
 */
export const computeTotals = (input: TotalsInput): InvoiceTotals => {
  const tax: TotalsTaxContext = input.tax ?? {
    mode: "legacy",
    cgst: input.cgst ?? 0,
    sgst: input.sgst ?? 0,
  };

  const items = input.items || [];

  // 1. Per line: gross, the line's own discount, and what is left.
  const gross = items.map((item) =>
    round2(
      Math.max(0, item.quantity || 0) * Math.max(0, item.unitPrice || 0)
    )
  );
  const lineDiscounts = items.map((item, index) =>
    Math.min(round2(Math.max(0, item.discount || 0)), gross[index])
  );
  const netValues = gross.map((value, index) =>
    round2(value - lineDiscounts[index])
  );

  // 2-3. Bases, and the invoice-level discount that can actually be taken.
  // Legacy invoices summed the RAW products and rounded once at the end; the
  // per-line rounding above is a Phase 2 addition, needed so that a printed line
  // reconciles with the tax charged on it. Summing the rounded values instead
  // shifts the subtotal by a paisa on fractional quantities (2 lines of 2.5 x
  // 33.33: 166.65 before, 166.64 after) — which would silently rewrite the total
  // of an already-issued document the next time it is saved. Reads are protected
  // by the stored `subtotal`/`total`, but a re-save is not, so legacy keeps the
  // old arithmetic exactly.
  const subtotal =
    tax.mode === "legacy"
      ? round2(
          items.reduce(
            (sum, item) =>
              sum +
              Math.max(0, item.quantity || 0) * Math.max(0, item.unitPrice || 0),
            0
          )
        )
      : round2(gross.reduce((sum, value) => sum + value, 0));
  const netBase = round2(netValues.reduce((sum, value) => sum + value, 0));
  const enteredDiscount = round2(Math.max(0, input.discount || 0));
  const appliedDiscount = Math.min(enteredDiscount, netBase);

  // 4-5. Apportionment and the taxable value per line.
  const apportioned = apportionDiscount(netValues, netBase, appliedDiscount);
  const taxableValues = netValues.map((value, index) =>
    round2(Math.max(0, value - apportioned[index]))
  );
  const taxableValue = round2(
    taxableValues.reduce((sum, value) => sum + value, 0)
  );
  const lineDiscountTotal = round2(
    lineDiscounts.reduce((sum, value) => sum + value, 0)
  );
  const discount = round2(
    lineDiscountTotal + (tax.mode === "legacy" ? enteredDiscount : appliedDiscount)
  );

  // 6. Tax.
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let taxRows: TaxRow[] = [];
  let suppressedBecause: TaxSuppressionReason | null = null;
  let lineTaxes: LineTax[] = items.map(() => ({ ...ZERO_LINE_TAX }));
  const rates = items.map((item) =>
    Number.isFinite(item.taxRatePercent)
      ? Math.max(0, item.taxRatePercent as number)
      : 0
  );

  if (tax.mode === "legacy") {
    cgst = round2(Math.max(0, tax.cgst || 0));
    sgst = round2(Math.max(0, tax.sgst || 0));
    // A legacy document that carried tax keeps BOTH of its rows verbatim, zeros
    // included; one whose tax was all zeros loses the two ₹0.00 placeholder
    // rows that made an unregistered person's document look like a tax invoice.
    if (inferLegacyTaxTreatment({ cgst, sgst }) === "gst") {
      taxRows = [
        { head: "cgst", label: TAX_HEAD_LABELS.cgst, amount: cgst },
        { head: "sgst", label: TAX_HEAD_LABELS.sgst, amount: sgst },
      ];
    }
  } else if (tax.mode === "derived") {
    const presentation = resolveTaxPresentation({
      taxTreatment: "gst",
      supplyKind: tax.supplyKind,
      supplierStateCode: tax.supplierStateCode,
      withPaymentOfTax: tax.withPaymentOfTax,
      reverseCharge: false,
    });
    suppressedBecause = presentation.suppressedBecause;

    lineTaxes = items.map((item, index) =>
      item.storedTax
        ? {
            cgst: round2(Math.max(0, item.storedTax.cgst || 0)),
            sgst: round2(Math.max(0, item.storedTax.sgst || 0)),
            igst: round2(Math.max(0, item.storedTax.igst || 0)),
          }
        : splitLineTax({
            taxableValue: taxableValues[index],
            ratePercent: rates[index],
            kind: tax.supplyKind,
            withPaymentOfTax: tax.withPaymentOfTax,
          })
    );

    cgst = round2(lineTaxes.reduce((sum, line) => sum + line.cgst, 0));
    sgst = round2(lineTaxes.reduce((sum, line) => sum + line.sgst, 0));
    igst = round2(lineTaxes.reduce((sum, line) => sum + line.igst, 0));

    // Rule 46(k) is satisfied per line, so the totals block only carries a rate
    // suffix when there is exactly one rate to name.
    const taxedRates = new Set(
      rates.filter((rate, index) => rate > 0 && taxableValues[index] > 0)
    );
    const soleRate = taxedRates.size === 1 ? [...taxedRates][0] : null;
    const amountForHead = (head: TaxHead): number =>
      head === "igst" ? igst : head === "cgst" ? cgst : sgst;

    taxRows = presentation.heads
      .map((head) => ({
        head,
        label:
          soleRate === null
            ? TAX_HEAD_LABELS[head]
            : `${TAX_HEAD_LABELS[head]} @ ${formatRate(
                head === "igst" ? soleRate : soleRate / 2
              )}%`,
        amount: amountForHead(head),
      }))
      // Never print a zero-amount tax row: an auditor reads CGST ₹0.00 next to
      // IGST ₹0.00 as a document that does not know what it is.
      .filter((row) => row.amount !== 0);
  } else {
    suppressedBecause = tax.suppressedBecause;
  }

  // 7-9. Charge, raw total, and the §170 rupee rounding.
  const convenienceCharge = round2(Math.max(0, input.convenienceCharge || 0));

  let total: number;
  let roundOff: number;
  if (tax.mode === "legacy") {
    total = round2(
      Math.max(0, subtotal - discount + cgst + sgst + convenienceCharge)
    );
    roundOff = 0;
  } else {
    const rawTotal = round2(
      Math.max(0, taxableValue + cgst + sgst + igst + convenienceCharge)
    );
    // §170 rounds "the amount of tax, interest, penalty, refund or any other
    // sum payable" to the nearest rupee. Two conditions follow from that and
    // both are load-bearing:
    //
    //  - It is a rule about RUPEES. An export invoiced in USD has no rupee
    //    amount to round, and rounding it produced a "Round Off $0.07" line on
    //    a foreign document — which is both wrong and unexplainable to the
    //    client reading it.
    //  - There must be tax. A zero-rated export under LUT collects nothing, so
    //    there is nothing to round; without this it rounded while an otherwise
    //    identical unregistered invoice did not, giving two zero-tax documents
    //    different totals for the same supply.
    const isRupees = (input.currency || "INR").toUpperCase() === "INR";
    const taxWasCharged = cgst + sgst + igst > 0;
    if (tax.mode === "derived" && isRupees && taxWasCharged) {
      total = roundToRupee(rawTotal);
      roundOff = round2(total - rawTotal);
    } else {
      total = rawTotal;
      roundOff = 0;
    }
  }

  // 10. TDS. Computed on the PRE-GST taxable value, never on the total (CBDT
  // Circular 23/2017): the client withholds against the value of the supply,
  // not against the tax the government is already collecting through GST.
  // Nothing above this line reads `tds`, which is the point — the deduction
  // cannot move `total`.
  const tdsSpec = tdsSpecFor(input.tds?.section);
  let tds: TdsInfo | null = null;
  if (tdsSpec) {
    // A 0 (or absent) rate means "use the section's statutory rate", not "zero
    // deduction": choosing a section IS the request to deduct, and a form that
    // has not been through the rate field yet carries 0. A genuine zero
    // deduction is expressed by leaving the section on "none".
    const requestedRate = input.tds?.ratePercent;
    const ratePercent =
      Number.isFinite(requestedRate) && (requestedRate as number) > 0
        ? clampToLimit(requestedRate as number, MAX_TDS_RATE_PERCENT)
        : tdsSpec.ratePercent;
    tds = {
      section: tdsSpec.value,
      ratePercent,
      amount: round2((taxableValue * ratePercent) / 100),
      label: `Less: TDS @${formatRate(ratePercent)}% (${tdsSpec.printedCode})`,
    };
  }

  const lines: ComputedLine[] = items.map((_, index) => ({
    gross: gross[index],
    lineDiscount: lineDiscounts[index],
    apportioned: apportioned[index],
    taxable: taxableValues[index],
    ratePercent: rates[index],
    tax: lineTaxes[index],
  }));

  return {
    subtotal,
    discount,
    taxableValue,
    lines,
    taxRows,
    cgst,
    sgst,
    igst,
    convenienceCharge,
    roundOff,
    total,
    suppressedBecause,
    tds,
    grandTotalLabel: documentKindSpecFor(input.documentKind).grandTotalLabel,
  };
};

export interface TaxContextSource {
  /** ABSENT means "written before Phase 2" — never give this a default. */
  taxTreatment?: TaxTreatment;
  reverseCharge?: boolean;
  supplyKind?: SupplyKind;
  supplierStateCode?: string;
  withPaymentOfTax?: boolean;
  /** Already through the `?? tax` fallback by the time it gets here. */
  legacyCgst?: number;
  legacySgst?: number;
}

/**
 * Choose the tax mode. One function, used by the record read path, by the live
 * preview and by the API, so the precedence between "no taxTreatment at all",
 * "not registered", "reverse charge" and "derive it" is stated exactly once.
 *
 * ABSENCE of `taxTreatment` means the document was written before Phase 2 and
 * must be replayed through the legacy formula — which is why the field has no
 * Mongoose default, and why "absent" is not folded into "none".
 */
export const resolveTaxContext = (
  source: TaxContextSource
): TotalsTaxContext => {
  const treatment = source.taxTreatment;
  if (treatment === undefined) {
    return {
      mode: "legacy",
      cgst: source.legacyCgst ?? 0,
      sgst: source.legacySgst ?? 0,
    };
  }

  const reverseCharge = source.reverseCharge ?? false;
  const supplyKind = source.supplyKind ?? "intra";
  const supplierStateCode = source.supplierStateCode ?? "";
  const withPaymentOfTax = source.withPaymentOfTax ?? false;

  if (treatment !== "gst" || reverseCharge) {
    // Reuse the precedence table rather than restating it here.
    const presentation = resolveTaxPresentation({
      taxTreatment: treatment,
      supplyKind,
      supplierStateCode,
      withPaymentOfTax,
      reverseCharge,
    });
    return { mode: "none", suppressedBecause: presentation.suppressedBecause };
  }

  return { mode: "derived", supplyKind, supplierStateCode, withPaymentOfTax };
};

const taxContextForRecord = (invoice: InvoiceRecord): TotalsTaxContext =>
  resolveTaxContext({
    taxTreatment: invoice.taxTreatment,
    reverseCharge: invoice.reverseCharge,
    supplyKind: invoice.supplyKind,
    supplierStateCode: invoice.supplierStateCode,
    withPaymentOfTax: invoice.withPaymentOfTax,
    // The legacy `?? tax` fallback lives HERE and nowhere else.
    legacyCgst: invoice.cgst ?? invoice.tax ?? 0,
    legacySgst: invoice.sgst ?? 0,
  });

/**
 * Resolve the amounts to DISPLAY for a persisted record. Honors server-stored
 * subtotal/total/roundOff when present (`??` keeps a legitimate 0), applies the
 * legacy `cgst ?? tax` fallback for documents written before the CGST/SGST
 * migration, and prefers stored per-line tax over a recomputed one so that a
 * later change to the rate table cannot re-price an issued invoice.
 */
export const resolveRecordAmounts = (invoice: InvoiceRecord): InvoiceTotals => {
  const computed = computeTotals({
    items: (invoice.items || []).map((item) => ({
      quantity: item.quantity,
      unitPrice: item.price,
      discount: item.discount,
      taxRatePercent: item.taxRatePercent,
      storedTax:
        item.cgstAmount !== undefined ||
        item.sgstAmount !== undefined ||
        item.igstAmount !== undefined
          ? {
              cgst: item.cgstAmount ?? 0,
              sgst: item.sgstAmount ?? 0,
              igst: item.igstAmount ?? 0,
            }
          : undefined,
    })),
    discount: invoice.discount ?? 0,
    convenienceCharge: invoice.convenienceCharge ?? 0,
    currency: invoice.currency,
    tax: taxContextForRecord(invoice),
    tds: { section: invoice.tdsSection, ratePercent: invoice.tdsRatePercent },
    documentKind: invoice.documentKind,
  });

  return {
    ...computed,
    subtotal: invoice.subtotal ?? computed.subtotal,
    total: invoice.total ?? computed.total,
    roundOff: invoice.roundOff ?? computed.roundOff,
    // Same D3 discipline as the amounts above: a stored deduction wins, so a
    // later change to the section's statutory rate cannot restate a figure the
    // client has already withheld and deposited.
    tds: computed.tds
      ? { ...computed.tds, amount: invoice.tdsAmount ?? computed.tds.amount }
      : null,
  };
};

/**
 * `"info"` is a NON-ARITHMETIC row: it is displayed inside the totals ladder but
 * takes no part in the money formula. TDS is the only one today, and it is the
 * reason the kind exists — the deduction is made by the client, so showing it as
 * an ordinary line would imply the invoice is worth less than its Total.
 */
export type TotalsRowKind = "line" | "discount" | "grand" | "info";

export interface TotalsRow {
  label: string;
  amount: number;
  kind: TotalsRowKind;
  /** Present on tax rows only. Renderers can use it as a stable React key. */
  head?: TaxHead;
}

/**
 * The ordered, labeled totals rows. The live preview, the read-only modal, the
 * HTML/PDF export and the CSV export all render from this list so their totals
 * section cannot drift in label, order, or which amount is shown.
 *
 * The signature stays SINGLE-ARGUMENT on purpose: every presentation decision
 * (which heads exist, what they are called, whether there is a round-off) rides
 * inside `InvoiceTotals`, so conditional tax rows reach all four renderers with
 * zero call-site edits. A second "context" parameter would multiply the blast
 * radius by four and create four places for the renderings to disagree.
 *
 * `convenienceCharge` is labeled "Service Charge".
 */
export const buildTotalsRows = (amounts: InvoiceTotals): TotalsRow[] => {
  const rows: TotalsRow[] = [
    { label: "Subtotal", amount: amounts.subtotal, kind: "line" },
    { label: "Discount", amount: amounts.discount, kind: "discount" },
  ];

  for (const row of amounts.taxRows ?? []) {
    rows.push({
      label: row.label,
      amount: row.amount,
      kind: "line",
      head: row.head,
    });
  }

  rows.push({
    label: "Service Charge",
    amount: amounts.convenienceCharge,
    kind: "line",
  });

  if ((amounts.roundOff ?? 0) !== 0) {
    rows.push({ label: "Round Off", amount: amounts.roundOff, kind: "line" });
  }

  rows.push({
    label: amounts.grandTotalLabel ?? "Total",
    amount: amounts.total,
    kind: "grand",
  });

  // Both rows sit AFTER Total, and Total is untouched: the legal value of the
  // invoice is what the supply is worth, and TDS is the client's obligation to
  // withhold out of that value and deposit against the supplier's PAN. Netting
  // it into Total would understate the invoice in the client's books and in
  // every GST return derived from it.
  if (amounts.tds) {
    rows.push({
      label: amounts.tds.label,
      amount: -amounts.tds.amount,
      kind: "info",
    });
    rows.push({
      label: "Net Payable",
      amount: round2(amounts.total - amounts.tds.amount),
      kind: "grand",
    });
  }

  return rows;
};

/* -------------------------------------------------------------------------- */
/* Shared line-item columns                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The line-item table's columns, as a data structure every renderer reads.
 *
 * This is `buildTotalsRows`' sibling and lives here for the same reason: item 6
 * added four columns to a table that exists twice in JSX (the editor preview,
 * the view modal) and once as a raw HTML string (the export, which the CSV also
 * reads). Without a shared column list those renderings disagree about which
 * columns exist, in what order, and what an empty one means.
 *
 * It briefly lived in `lib/invoice-export.ts` only because the change set that
 * introduced it could not edit this file; the modal was the renderer that paid
 * for that, and it has been moved here and routed through.
 *
 * `buildLineItemCells` stays in `lib/invoice-export.ts`: it formats currency via
 * `lib/invoices`, which imports this module, and a runtime import back would
 * close the cycle this module's header rule exists to prevent.
 */
export type LineItemColumnKey =
  | "index"
  | "description"
  | "hsnSac"
  | "unit"
  | "quantity"
  | "unitPrice"
  | "discount"
  | "taxable"
  | "taxRate"
  | "tax"
  | "amount";

export interface LineItemColumn {
  key: LineItemColumnKey;
  label: string;
  align: "left" | "right";
  /**
   * Print hint. Exactly one column wraps (the description); everything else is
   * `white-space: nowrap` so an eight-column A4 table cannot collapse into
   * unreadable slivers. Item 8(6).
   */
  wrap: boolean;
}

/** Accepts a DB item (`name`/`price`) or a form item (`description`/`unitPrice`). */
export interface LineItemSource {
  name?: string;
  description?: string;
  quantity?: number;
  price?: number;
  unitPrice?: number;
  hsnSac?: string;
  unit?: string;
}

export interface LineItemTableInput {
  items: LineItemSource[];
  totals: InvoiceTotals;
  currency: string;
}

const ALL_LINE_ITEM_COLUMNS: LineItemColumn[] = [
  { key: "index", label: "#", align: "left", wrap: false },
  { key: "description", label: "Description", align: "left", wrap: true },
  { key: "hsnSac", label: "HSN/SAC", align: "left", wrap: false },
  { key: "unit", label: "UOM", align: "left", wrap: false },
  { key: "quantity", label: "Qty", align: "right", wrap: false },
  { key: "unitPrice", label: "Unit Price", align: "right", wrap: false },
  { key: "discount", label: "Discount", align: "right", wrap: false },
  // Rule 46(j): "taxable value of supply ... taking into account discount or
  // abatement, if any". It sits between the discount and the rate because that
  // is the order the arithmetic runs in, and because the two columns to its
  // right are the ones that have to reconcile against it.
  { key: "taxable", label: "Taxable Value", align: "right", wrap: false },
  { key: "taxRate", label: "Rate", align: "right", wrap: false },
  { key: "tax", label: "Tax", align: "right", wrap: false },
  { key: "amount", label: "Amount", align: "right", wrap: false },
];

const hasText = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Which columns this invoice actually needs.
 *
 * An optional column appears only when at least one line populates it. A column
 * of empty cells is worse than no column at A4 width (item 8(6)), and an
 * "HSN/SAC" heading over eight blanks reads as a document that forgot to fill
 * itself in rather than one that never needed the field.
 */
export const buildLineItemColumns = (
  input: LineItemTableInput
): LineItemColumn[] => {
  const lines = input.totals.lines ?? [];
  const present = new Set<LineItemColumnKey>([
    "index",
    "description",
    "quantity",
    "unitPrice",
    "amount",
  ]);

  if (input.items.some((item) => hasText(item.hsnSac))) {
    present.add("hsnSac");
  }
  if (input.items.some((item) => hasText(item.unit))) {
    present.add("unit");
  }
  if (lines.some((line) => line.lineDiscount > 0)) {
    present.add("discount");
  }
  if (lines.some((line) => line.ratePercent > 0)) {
    present.add("taxRate");
  }
  // Rule 46(j). Without it the table does not reconcile: "Amount" is the line's
  // GROSS value, so a line carrying a per-line discount or a share of the
  // invoice-level discount reads `Rate 18 | Tax 174.00 | Amount 1000.00`, and
  // 18% of 1000 is 180. The taxable value is the number the tax was actually
  // charged on, and printing it makes rate x taxable = tax exact on the page.
  //
  // Shown whenever tax was charged, and also whenever a discount moved the
  // taxable value away from the gross — a document whose Amount column no
  // longer equals what was billed for owes the reader the difference.
  if (
    (input.totals.taxRows ?? []).length > 0 ||
    lines.some((line) => line.taxable !== line.gross)
  ) {
    present.add("taxable");
  }
  // The per-line tax column tracks the TOTALS block: if no tax row is printed
  // (unregistered, composition, reverse charge, zero-rated under LUT) then no
  // tax was charged, and a per-line tax column of zeros would contradict that.
  if ((input.totals.taxRows ?? []).length > 0) {
    present.add("tax");
  }

  return ALL_LINE_ITEM_COLUMNS.filter((column) => present.has(column.key));
};

export interface ValidatableInvoiceItem {
  description?: string;
  name?: string;
  hsnSac?: string;
  taxRatePercent?: number;
}

export interface ValidatableInvoice {
  companyName: string;
  billTo: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  items: ValidatableInvoiceItem[];
  /** Rule 46(a)/(e). Optional: most users are below the registration threshold. */
  companyGstin?: string;
  billToGstin?: string;
  taxTreatment?: TaxTreatment;
  supplyKind?: SupplyKind;
  supplierStateCode?: string;
  placeOfSupplyStateCode?: string;
  recipientIsSez?: boolean;
  recipientIsOutsideIndia?: boolean;
  withPaymentOfTax?: boolean;
  lutArn?: string;
  countryOfDestination?: string;
  /** Absent means "invoice" — see `resolveDocumentKind`. */
  documentKind?: InvoiceDocumentKind;
  /** Rule 53(1A). Required on a credit or debit note, forbidden on anything else. */
  originalInvoice?: {
    invoiceId?: string;
    invoiceNumber?: string;
    invoiceDate?: string;
  };
  /** The computed heads, used only as a tripwire on the derivation itself. */
  totals?: { cgst: number; sgst: number; igst: number };
}

export interface InvoiceValidation {
  error: string | null;
  warnings: string[];
}

/**
 * The one wording for a line rate that is not a GST slab.
 *
 * A CONSTANT, not a template: `lib/invoice-field-validation.ts` looks its specs
 * up by the validator's exact message, and interpolating the offending rate
 * would make every occurrence a different string. The line at fault is pointed
 * at by that module instead, which is more useful than naming the number.
 */
export const UNKNOWN_GST_RATE_ERROR =
  "That isn't a GST rate. Use 0%, 0.25%, 3%, 5%, 18% or 40%.";

/**
 * Rule 53(1A) wordings, as CONSTANTS for the same reason as
 * `UNKNOWN_GST_RATE_ERROR`: `lib/invoice-field-validation.ts` looks its repair
 * specs up by the validator's exact message, so interpolating "credit"/"debit"
 * would make each rule two strings and lose the lookup. One sentence covers
 * both kinds — they share the rule and they share the fix.
 */
export const NOTE_WITHOUT_ORIGINAL_ERROR =
  "A credit or debit note must name the invoice it corrects.";
export const NOTE_ORIGINAL_DATE_ERROR =
  "The date of the invoice this note corrects is invalid.";
export const NOTE_BEFORE_ORIGINAL_ERROR =
  "A credit or debit note cannot be dated before the invoice it corrects.";

const isValidDate = (value: string): boolean =>
  Boolean(value) && !Number.isNaN(new Date(value).getTime());

const isBlank = (value: string | undefined): boolean =>
  !value || !value.trim();

/**
 * The one invoice validator, shared by the editor (before save) and the API
 * (before persist).
 *
 * Returns an error (the first one — first error wins, as it always has) plus a
 * list of non-blocking warnings. A wrong-looking but legal invoice must still
 * be savable: a blocked save is a lost invoice.
 */
export const validateInvoiceDetailed = (
  invoice: ValidatableInvoice
): InvoiceValidation => {
  const warnings: string[] = [];
  const fail = (error: string): InvoiceValidation => ({ error, warnings });

  if (!invoice.companyName.trim()) {
    return fail("Company name is required");
  }
  if (!invoice.billTo.trim()) {
    return fail("Bill to is required");
  }
  if (!invoice.invoiceNumber.trim()) {
    return fail("Invoice number is required");
  }
  /**
   * Rule 46(b): 16 characters at most, and only letters, digits, `-` and `/`.
   *
   * Normalised first (whitespace removed, case untouched) so that a number
   * pasted out of a PDF is judged on what will actually be stored, and so a
   * trailing space is not reported as an illegal character. The specific
   * problem is surfaced, never a generic "invalid": this is the field an
   * auditor looks at first, and "invalid invoice number" over a legally
   * constrained format is a dead end for whoever has to fix it.
   */
  const invoiceNumberProblem = checkInvoiceNumber(
    normalizeInvoiceNumber(invoice.invoiceNumber)
  );
  if (invoiceNumberProblem) {
    return fail(invoiceNumberProblemMessage(invoiceNumberProblem));
  }
  if (!isValidDate(invoice.invoiceDate)) {
    return fail("Invoice date is invalid");
  }
  if (!isValidDate(invoice.dueDate)) {
    return fail("Due date is invalid");
  }
  const hasLineItem = invoice.items.some((item) =>
    ((item.description ?? item.name) || "").trim()
  );
  if (!hasLineItem) {
    return fail("At least one line item is required");
  }

  /**
   * §34 + Rule 53(1A): a credit or debit note is DEFINED by the invoice it
   * corrects, and the original's serial number and date are mandatory
   * particulars. A note without them is not a defective document, it is a
   * different (and unusable) one — so this blocks rather than warns.
   *
   * The reference itself is proved server-side, where the invoice can actually
   * be looked up under the caller's own uid; this rule is about the document
   * being complete, and it runs identically in the editor and in the API.
   */
  const documentKind = resolveDocumentKind(invoice.documentKind);
  if (documentKind === "credit_note" || documentKind === "debit_note") {
    const original = invoice.originalInvoice;
    if (isBlank(original?.invoiceNumber)) {
      return fail(NOTE_WITHOUT_ORIGINAL_ERROR);
    }
    if (!isValidDate(original?.invoiceDate ?? "")) {
      return fail(NOTE_ORIGINAL_DATE_ERROR);
    }
    // A note that predates the supply it adjusts cannot be what it claims to
    // be. Compared as civil dates: both sides round-trip through
    // `yyyy-mm-dd`, so a same-day note passes.
    if (
      isValidDate(invoice.invoiceDate) &&
      new Date(invoice.invoiceDate).getTime() <
        new Date(original!.invoiceDate as string).getTime()
    ) {
      return fail(NOTE_BEFORE_ORIGINAL_ERROR);
    }
  }

  // GSTINs. ABSENCE IS VALID and must stay valid: registration starts at ₹20
  // lakh of turnover for services, so most users have no GSTIN, and a validator
  // that rejected "" would force every one of them to invent one. Present-but-
  // wrong is a different matter — a mistyped GSTIN on a printed tax invoice
  // costs the recipient their input tax credit.
  const companyGstin = normalizeGstin(invoice.companyGstin);
  const billToGstin = normalizeGstin(invoice.billToGstin);
  if (companyGstin && !isValidGstin(companyGstin)) {
    return fail("Your GSTIN is not valid. Check the 15 characters.");
  }
  if (billToGstin && !isValidGstin(billToGstin)) {
    return fail("The client's GSTIN is not valid.");
  }

  const treatment = invoice.taxTreatment;
  const supplyKind = invoice.supplyKind;

  /**
   * §5.9: the GSTIN's first two characters ARE the state code, so a supplier
   * state that disagrees with them is a contradiction, not a preference.
   *
   * REJECTED, not auto-corrected. Which of the two is wrong is unknowable from
   * here — the user may have picked the wrong state, or pasted the GSTIN of
   * their other registration — and the disagreement decides the single most
   * money-visible branch on the document: supplier state versus place of supply
   * is what makes the tax CGST+SGST or IGST. Silently rewriting the state would
   * re-price the invoice without telling anyone; silently rewriting the GSTIN
   * would print a registration number the user never chose. Either produces a
   * document the client has to reject and the supplier has to credit-note,
   * which is far more expensive than one blocked save with a specific message.
   */
  if (
    companyGstin &&
    !isBlank(invoice.supplierStateCode) &&
    stateCodeFromGstin(companyGstin) !== (invoice.supplierStateCode ?? "").trim()
  ) {
    return fail("Your state must match the first two digits of your GSTIN.");
  }

  // Contradictory geography. `deriveSupplyKind` stays total and silently
  // prefers "export"; the user still has to resolve it before saving.
  if (invoice.recipientIsSez && invoice.recipientIsOutsideIndia) {
    return fail(
      "An SEZ unit is inside India — clear either the SEZ flag or the overseas recipient."
    );
  }

  if (treatment === "gst") {
    if (isBlank(invoice.supplierStateCode)) {
      return fail("Select the state you're registered in.");
    }
    if (isBlank(invoice.placeOfSupplyStateCode)) {
      return fail("Select the place of supply.");
    }
    const taxedLineWithoutCode = invoice.items.some(
      (item) =>
        Number.isFinite(item.taxRatePercent) &&
        (item.taxRatePercent as number) > 0 &&
        isBlank(item.hsnSac)
    );
    if (taxedLineWithoutCode) {
      return fail("Add an HSN or SAC code for every taxed line.");
    }
    // Rule 46(a) wants the supplier's GSTIN on a tax invoice. A WARNING, not an
    // error: the treatment is seeded from the business profile, and a user who
    // has one saved but has not re-opened this draft since must still be able
    // to save. The next write is where they get nudged (§2.4).
    if (!companyGstin) {
      warnings.push(
        "A tax invoice should carry your GSTIN. Add it in your business profile."
      );
    }
  }

  if (supplyKind === "export" && isBlank(invoice.countryOfDestination)) {
    return fail("Country of destination is required on an export invoice.");
  }
  /**
   * The LUT rule belongs to a REGISTERED supplier and to no one else.
   *
   * An LUT (Letter of Undertaking) is a filing a GST-registered person makes so
   * that they may export without paying IGST; §1.2's table gives the
   * unregistered row "no endorsement, no LUT". Applying it to everyone blocked
   * the single most common export case this product has — a freelancer below
   * the ₹20 lakh services threshold billing a client abroad — from saving at
   * all, and left them two ways out, both of which put a false statement on a
   * legal document: invent an ARN (printing "...UNDER BOND OR LETTER OF
   * UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX" over a plain INVOICE with no
   * GSTIN), or tick with-payment-of-tax (printing "...ON PAYMENT OF INTEGRATED
   * TAX" while charging zero). An unregistered person has no registration to
   * make either claim under. `exportEndorsementFor` is gated on the same axis,
   * so nothing statutory prints on their document either.
   */
  if (
    treatment === "gst" &&
    (supplyKind === "export" || supplyKind === "sez") &&
    !invoice.withPaymentOfTax &&
    isBlank(invoice.lutArn)
  ) {
    return fail("Enter your LUT ARN, or switch to 'with payment of tax'.");
  }

  /**
   * A rate GST does not have is REJECTED, not dropped.
   *
   * The write path used to omit an unrecognised `taxRatePercent` and save the
   * rest, so a 15% line saved silently with no tax on it while the editor
   * preview had shown the user a total that included it. A rate is not a value
   * that needs bringing into range — it is either a slab or it is a mistake,
   * and a document that quietly disagrees with the screen it was created on is
   * worse than a blocked save. Retired slabs (12, 28) pass and warn below: a
   * back-dated document carries them legitimately.
   */
  const hasUnknownRate = invoice.items.some(
    (item) =>
      item.taxRatePercent !== undefined && !isAcceptedGstRate(item.taxRatePercent)
  );
  if (hasUnknownRate) {
    return fail(UNKNOWN_GST_RATE_ERROR);
  }

  if (treatment === "composition" && supplyKind && supplyKind !== "intra") {
    // A composition dealer cannot make inter-State outward supplies of GOODS.
    // Services are identifiable only by their SAC, which always begins "99".
    const hasGoodsLine = invoice.items.some(
      (item) => !isBlank(item.hsnSac) && !isServiceHsnSac(item.hsnSac)
    );
    if (hasGoodsLine) {
      return fail(
        "A composition dealer cannot make an inter-State supply of goods."
      );
    }
    warnings.push(
      "A composition dealer's inter-State supplies are restricted — check this is a service."
    );
  }

  // Tripwires on the derivation itself. Unreachable by construction once tax is
  // derived, which is exactly why they are worth asserting: they cost nothing
  // and they catch a regression in `splitLineTax` before a client sees it.
  if (invoice.totals) {
    if (supplyKind === "inter" && invoice.totals.cgst + invoice.totals.sgst > 0) {
      return fail("An inter-State supply must be taxed as IGST, not CGST/SGST.");
    }
    if (supplyKind === "intra" && invoice.totals.igst > 0) {
      return fail("An intra-State supply must be taxed as CGST/SGST, not IGST.");
    }
  }

  /**
   * §34(2)'s declaration deadline. A WARNING, never a block: there is no time
   * limit on ISSUING a credit note, only on declaring it in a return, and a
   * user correcting an old invoice for commercial reasons is entitled to do so
   * long after the adjustment stops being available.
   */
  if (documentKind === "credit_note" && treatment === "gst") {
    const deadline = creditNoteDeclarationDeadline(
      invoice.originalInvoice?.invoiceDate
    );
    if (deadline) {
      warnings.push(
        `Declare this credit note in a return by ${deadline} to reduce your GST liability. After that it adjusts nothing for GST.`
      );
    }
  }

  for (const item of invoice.items) {
    if (
      Number.isFinite(item.taxRatePercent) &&
      isRetiredGstRate(item.taxRatePercent as number)
    ) {
      warnings.push("12% and 28% were withdrawn on 22 Sep 2025.");
      break;
    }
  }

  return { error: null, warnings };
};

/**
 * The blocking half of `validateInvoiceDetailed`. Kept with its original
 * `string | null` signature so `InvoiceEditor.saveInvoice` and both API write
 * paths compile untouched; callers opt into warnings when they can display them.
 */
export const validateInvoice = (invoice: ValidatableInvoice): string | null =>
  validateInvoiceDetailed(invoice).error;
