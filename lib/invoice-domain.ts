import type { InvoiceRecord } from "@/lib/invoices";
import {
  inferLegacyTaxTreatment,
  isRetiredGstRate,
  isServiceHsnSac,
  resolveTaxPresentation,
  splitLineTax,
  TAX_HEAD_LABELS,
  type LineTax,
  type SupplyKind,
  type TaxHead,
  type TaxSuppressionReason,
  type TaxTreatment,
} from "@/lib/gst-supply";

/**
 * Invoice domain: the single source of truth for the money formula, the display
 * amount resolution (including the legacy `tax` fallback), the ordered totals
 * rows shared by the live preview and the export, and invoice validation.
 *
 * This module imports only TYPES from lib/invoices (erased at compile time), so
 * lib/invoices can import computeTotals from here without a runtime cycle.
 * `lib/gst-supply` is a real runtime import, and is allowed because that module
 * imports nothing from this one — the graph stays acyclic in one direction.
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
  /** @deprecated Flat legacy amounts. Present so existing call sites compile. */
  cgst?: number;
  /** @deprecated Flat legacy amounts. Present so existing call sites compile. */
  sgst?: number;
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
  const subtotal = round2(gross.reduce((sum, value) => sum + value, 0));
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
    if (tax.mode === "derived") {
      total = roundToRupee(rawTotal);
      roundOff = round2(total - rawTotal);
    } else {
      // Nothing was collected as tax, so there is no tax to round under §170.
      total = rawTotal;
      roundOff = 0;
    }
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
    tax: taxContextForRecord(invoice),
  });

  return {
    ...computed,
    subtotal: invoice.subtotal ?? computed.subtotal,
    total: invoice.total ?? computed.total,
    roundOff: invoice.roundOff ?? computed.roundOff,
  };
};

export type TotalsRowKind = "line" | "discount" | "grand";

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

  rows.push({ label: "Total", amount: amounts.total, kind: "grand" });
  return rows;
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
  taxTreatment?: TaxTreatment;
  supplyKind?: SupplyKind;
  supplierStateCode?: string;
  placeOfSupplyStateCode?: string;
  recipientIsSez?: boolean;
  recipientIsOutsideIndia?: boolean;
  withPaymentOfTax?: boolean;
  lutArn?: string;
  countryOfDestination?: string;
  /** The computed heads, used only as a tripwire on the derivation itself. */
  totals?: { cgst: number; sgst: number; igst: number };
}

export interface InvoiceValidation {
  error: string | null;
  warnings: string[];
}

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

  const treatment = invoice.taxTreatment;
  const supplyKind = invoice.supplyKind;

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
  }

  if (supplyKind === "export" && isBlank(invoice.countryOfDestination)) {
    return fail("Country of destination is required on an export invoice.");
  }
  if (
    (supplyKind === "export" || supplyKind === "sez") &&
    !invoice.withPaymentOfTax &&
    isBlank(invoice.lutArn)
  ) {
    return fail("Enter your LUT ARN, or switch to 'with payment of tax'.");
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
