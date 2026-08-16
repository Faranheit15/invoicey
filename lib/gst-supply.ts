/**
 * GST supply geography and tax-head resolution: the pure decision layer behind
 * every tax figure Invoicey prints.
 *
 * Three INDEPENDENT things decide whether an invoice shows tax, and what the
 * tax is called. Collapsing them into one enum is the mistake this module
 * exists to prevent:
 *
 *   A. Registration status of the SUPPLIER  -> `TaxTreatment`
 *      §32 CGST *prohibits* an unregistered person from collecting tax, and a
 *      composition dealer issues a Bill of Supply, never a tax invoice. Neither
 *      may print a tax row at all — not even a zero one, because a document
 *      shaped like a tax invoice with no GSTIN on it is the exact shape of a
 *      fraudulent invoice.
 *   B. Geography of THIS transaction       -> `SupplyKind`
 *      GST is a destination tax. Same state as the place of supply means
 *      CGST + SGST (or CGST + UTGST); anywhere else in India means IGST at the
 *      FULL rate; outside India or into an SEZ means a zero-rated supply.
 *   C. Who PAYS the tax                    -> `reverseCharge`
 *      Under RCM the supplier shows the rate but no amount (Rule 46(o)).
 *
 * `resolveTaxPresentation` is the single function that collapses all three into
 * the row set a renderer should draw. Renderers branch on ITS output, never on
 * `taxTreatment` — an axis-A switch cannot express "zero-rated under LUT" or
 * "payable by the recipient", and gets rewritten the moment either lands.
 *
 * No React, no DOM, and no imports from `lib/invoices` or `lib/invoice-domain`
 * — so the dependency graph stays acyclic and every rule below is reachable
 * from `bun test`.
 */

/** Local copy of the money rounder. This module must not import lib/invoice-domain
 * (which imports this one), so the two-line helper is duplicated deliberately. */
const round2 = (value: number): number =>
  Number.isFinite(value) ? Number(value.toFixed(2)) : 0;

/** Axis A: what the supplier is registered as. */
export type TaxTreatment = "none" | "gst" | "composition";

/** Axis B: where this supply goes. */
export type SupplyKind = "intra" | "inter" | "export" | "sez";

/** The heads a tax row can carry. Never more than two on one invoice. */
export type TaxHead = "cgst" | "sgst" | "utgst" | "igst";

export type DocumentType = "tax_invoice" | "invoice" | "bill_of_supply";

/** Why an invoice shows no tax rows. `null` when it shows some. */
export type TaxSuppressionReason =
  | "unregistered"
  | "composition"
  | "zero_rated_lut"
  | "reverse_charge";

export interface TaxPresentation {
  /** `[]` | `["igst"]` | `["cgst","sgst"]` | `["cgst","utgst"]`. Never three. */
  heads: TaxHead[];
  suppressedBecause: TaxSuppressionReason | null;
}

/**
 * Union territories WITHOUT a legislature charge UTGST in place of SGST.
 * Delhi (07), Puducherry (34) and Jammu & Kashmir (01) HAVE legislatures and
 * therefore charge SGST — those three are what everyone gets wrong.
 *
 * 04 Chandigarh, 25 Daman & Diu (legacy code), 26 Dadra & Nagar Haveli and
 * Daman & Diu (merged), 31 Lakshadweep, 35 Andaman & Nicobar, 38 Ladakh,
 * 97 Other Territory.
 */
export const UTGST_STATE_CODES: ReadonlySet<string> = new Set([
  "04",
  "25",
  "26",
  "31",
  "35",
  "38",
  "97",
]);

/** Place-of-supply code that means "outside India". */
export const OUTSIDE_INDIA_STATE_CODE = "96";

export const DOCUMENT_TITLES: Record<DocumentType, string> = {
  tax_invoice: "TAX INVOICE",
  invoice: "INVOICE",
  bill_of_supply: "BILL OF SUPPLY",
};

/** Statutory wording — CGST Rule 5(f). Do not reflow, re-case, or "improve". */
export const COMPOSITION_BANNER =
  "composition taxable person, not eligible to collect tax on supplies";

/** Statutory wording — Rule 46 proviso. Verbatim, upper case, as printed. */
export const EXPORT_ENDORSEMENT_WITH_TAX =
  "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS ON PAYMENT OF INTEGRATED TAX";

/** Statutory wording — Rule 46 proviso. Verbatim, upper case, as printed. */
export const EXPORT_ENDORSEMENT_UNDER_LUT =
  "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX";

/**
 * The one-line explanation printed under the totals when there are no tax rows.
 * One map, one place, so the preview and the export cannot word it differently.
 */
export const TAX_SUPPRESSION_NOTES: Record<TaxSuppressionReason, string> = {
  unregistered: "GST not applicable — not registered under GST",
  composition: "Composition levy — tax not collected from the recipient",
  zero_rated_lut: "Zero-rated supply under LUT — no IGST charged",
  reverse_charge: "Tax payable by the recipient under reverse charge",
};

export const TAX_HEAD_LABELS: Record<TaxHead, string> = {
  cgst: "CGST",
  sgst: "SGST",
  utgst: "UTGST",
  igst: "IGST",
};

/**
 * GST 2.0 took effect 22 Sep 2025: 12% and 28% were abolished and 40% added.
 * lastVerified: 2026-08 (source: docs/research/gst-compliance.md §3(a)).
 *
 * These live here rather than in a `lib/gst-rates.ts` of their own only because
 * this change set is scoped to the domain layer; move them when the rate picker
 * lands.
 */
export const GST_RATES = [0, 5, 18, 40] as const;
/** Rough stones and bullion keep their own slabs. */
export const GST_SPECIAL_RATES = [0.25, 3] as const;
/** Accept on READ (documents predating 22 Sep 2025 carry them). Never offer. */
export const GST_RETIRED_RATES = [12, 28] as const;

export const isRetiredGstRate = (rate: number): boolean =>
  (GST_RETIRED_RATES as readonly number[]).includes(rate);

/** `documentType` is derived from `taxTreatment`, never chosen by the user. */
export const documentTypeFor = (treatment: TaxTreatment): DocumentType => {
  if (treatment === "gst") {
    return "tax_invoice";
  }
  if (treatment === "composition") {
    return "bill_of_supply";
  }
  return "invoice";
};

export interface SupplyContext {
  /** "29"; "" when unknown. */
  supplierStateCode: string;
  /** "27"; "96" = outside India; "" when unknown. */
  placeOfSupplyStateCode: string;
  recipientIsSez: boolean;
  recipientIsOutsideIndia: boolean;
}

/**
 * Where this supply goes, in strict precedence order. THE ORDER IS THE
 * SPECIFICATION — reordering these produces a wrong invoice for a real case.
 *
 *   1. outside India (or POS "96")  -> "export"   IGST §13 / §16 zero-rated
 *   2. SEZ recipient                -> "sez"      IGST §7(5)/§8(1) proviso:
 *      deemed inter-State EVEN WHEN THE SEZ IS IN THE SUPPLIER'S OWN STATE.
 *      This is the single counter-intuitive rule in GST place-of-supply and the
 *      one a later "simplification" is most likely to delete. It has a named
 *      test; keep it.
 *   3. both codes known and equal   -> "intra"    IGST §8
 *   4. both codes known, different  -> "inter"    IGST §7
 *   5. either code unknown          -> "intra"    documented fallback
 *
 * Row 5 is unreachable for a SAVED GST invoice — `validateInvoice` requires both
 * codes when `taxTreatment === "gst"`. It exists so this function is total and
 * so the live preview renders something sane before the fields are filled. Do
 * not add an `"unknown"` member to the union to model it: every consumer, every
 * switch and every test would then have to handle a state that can never be
 * persisted. The gate is validation, not the type.
 *
 * Export beats SEZ. If both flags are set the data is contradictory; this stays
 * total and `validateInvoice` raises the contradiction.
 *
 * Knows nothing about `taxTreatment`. Callers gate on that.
 */
export const deriveSupplyKind = (ctx: SupplyContext): SupplyKind => {
  if (
    ctx.recipientIsOutsideIndia ||
    ctx.placeOfSupplyStateCode === OUTSIDE_INDIA_STATE_CODE
  ) {
    return "export";
  }
  if (ctx.recipientIsSez) {
    return "sez";
  }
  if (!ctx.supplierStateCode || !ctx.placeOfSupplyStateCode) {
    return "intra";
  }
  return ctx.supplierStateCode === ctx.placeOfSupplyStateCode
    ? "intra"
    : "inter";
};

export interface TaxPresentationInput {
  taxTreatment: TaxTreatment;
  supplyKind: SupplyKind;
  supplierStateCode: string;
  withPaymentOfTax: boolean;
  reverseCharge: boolean;
}

/**
 * Collapse axes A, B and C into the tax rows a document may print.
 *
 * Precedence, and the order matters: registration status can suppress tax that
 * geography would otherwise create, and reverse charge can suppress tax that a
 * perfectly ordinary registered intra-State supply would otherwise create.
 */
export const resolveTaxPresentation = (
  input: TaxPresentationInput
): TaxPresentation => {
  if (input.taxTreatment === "none") {
    return { heads: [], suppressedBecause: "unregistered" };
  }
  if (input.taxTreatment === "composition") {
    return { heads: [], suppressedBecause: "composition" };
  }
  if (input.reverseCharge) {
    return { heads: [], suppressedBecause: "reverse_charge" };
  }
  if (input.supplyKind === "export" || input.supplyKind === "sez") {
    return input.withPaymentOfTax
      ? { heads: ["igst"], suppressedBecause: null }
      : { heads: [], suppressedBecause: "zero_rated_lut" };
  }
  if (input.supplyKind === "inter") {
    return { heads: ["igst"], suppressedBecause: null };
  }
  return {
    heads: UTGST_STATE_CODES.has(input.supplierStateCode)
      ? ["cgst", "utgst"]
      : ["cgst", "sgst"],
    suppressedBecause: null,
  };
};

export interface LineTaxInput {
  /** AFTER the line discount and the apportioned invoice discount. */
  taxableValue: number;
  /** The FULL rate: 0 | 0.25 | 3 | 5 | 18 | 40. Halved for CGST/SGST. */
  ratePercent: number;
  kind: SupplyKind;
  /** Consulted only for `export` and `sez`. */
  withPaymentOfTax?: boolean;
}

export interface LineTax {
  cgst: number;
  sgst: number;
  igst: number;
}

const ZERO_TAX: LineTax = { cgst: 0, sgst: 0, igst: 0 };

/**
 * Split one line's tax across heads.
 *
 * Two things this function deliberately does NOT know about, because keeping
 * them out is what keeps its case table small enough to test exhaustively:
 *
 *  - `taxTreatment` and `reverseCharge`. They suppress tax entirely, and are
 *    handled one level up by not calling this at all.
 *  - UTGST. It is stored in the `sgst` slot and differs only in LABEL, which is
 *    `resolveTaxPresentation`'s job. GSTR-1 reports SGST and UTGST in one
 *    column, and a separate `utgst` field would double the number of legacy
 *    fallbacks in the read path for zero arithmetic benefit. THE FIELD NAME
 *    LIES ABOUT ITS CONTENTS FOR A UT SUPPLIER — that is the deal, recorded
 *    here so nobody has to rediscover it.
 *
 * Half-rate rounding: `cgst = sgst = round2(t * r / 200)`, each rounded and
 * THEN used, so `cgst + sgst` may differ from `round2(t * r / 100)` by one
 * paisa. That is intentional: equal CGST and SGST amounts matter more than an
 * exact sum, because unequal halves are a reporting red flag in GSTR-1.
 *
 * `withPaymentOfTax` is a PARAMETER, not a module-scope lookup. The research's
 * sketch (docs/research/gst-compliance.md:322) reads a free identifier here;
 * besides not compiling, resolving it from module scope would silently charge
 * IGST on an LUT export — the exact case zero-rating exists for.
 *
 * Every degenerate input (rate 0, negative or NaN value, Infinity) returns
 * zeros rather than throwing.
 */
export const splitLineTax = (input: LineTaxInput): LineTax => {
  const t = Number.isFinite(input.taxableValue)
    ? Math.max(0, input.taxableValue)
    : 0;
  const r = Number.isFinite(input.ratePercent)
    ? Math.max(0, input.ratePercent)
    : 0;

  if (t === 0 || r === 0) {
    return { ...ZERO_TAX };
  }

  if (input.kind === "export" || input.kind === "sez") {
    return input.withPaymentOfTax === true
      ? { cgst: 0, sgst: 0, igst: round2((t * r) / 100) }
      : { ...ZERO_TAX };
  }

  if (input.kind === "inter") {
    return { cgst: 0, sgst: 0, igst: round2((t * r) / 100) };
  }

  const half = round2((t * r) / 200);
  return { cgst: half, sgst: half, igst: 0 };
};

/**
 * The whole backwards-compatibility story for `taxTreatment`.
 *
 * A document written before Phase 2 has no `taxTreatment` field at all, and D5
 * says absence must stay distinguishable from "explicitly none" — so this is
 * only ever called when the field is missing.
 *
 * A legacy document that CARRIED tax keeps its tax rows verbatim; one whose tax
 * was all zeros loses its two ₹0.00 rows. No amount ever changes: a re-print of
 * an invoice a client already holds shows the same numbers it always did. The
 * only visible difference is the disappearance of placeholder zero tax rows,
 * which is precisely the hazard this phase exists to remove.
 */
export const inferLegacyTaxTreatment = (amounts: {
  cgst?: number;
  sgst?: number;
  tax?: number;
}): TaxTreatment => {
  const anyTax =
    (amounts.cgst ?? 0) > 0 ||
    (amounts.sgst ?? 0) > 0 ||
    (amounts.tax ?? 0) > 0;
  return anyTax ? "gst" : "none";
};

/** SAC (services) always begins "99"; anything else is an HSN, i.e. goods. */
export const isServiceHsnSac = (hsnSac: string | undefined): boolean =>
  typeof hsnSac === "string" && hsnSac.trim().startsWith("99");
