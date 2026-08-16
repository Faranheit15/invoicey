/**
 * GST rate slabs, UQC codes and HSN/SAC format — the small reference tables the
 * pickers, the AI normalizer and the API all read from.
 *
 * WHY THIS MODULE RE-EXPORTS RATHER THAN REDEFINES: the rate arrays were landed
 * in `lib/gst-supply.ts` by the domain change set, and `lib/invoice-domain.ts`
 * imports `isRetiredGstRate` from there. Copying the arrays here would give the
 * repo two rate tables that a future rate change could update independently —
 * exactly the drift `buildTotalsRows` exists to prevent for totals. So the
 * numbers keep a single definition in `gst-supply.ts`, and this module is the
 * PRESENTATION layer over them: what a picker may offer, what a free-text unit
 * field accepts, and what an HSN/SAC has to look like.
 *
 * Pure. No React, no DOM, no mongoose — importable from the editor, the API
 * route, the AI normalizer and `bun test` alike.
 */
import {
  GST_RATES,
  GST_RETIRED_RATES,
  GST_SPECIAL_RATES,
  isRetiredGstRate,
} from "@/lib/gst-supply";
import { OTHER_COUNTRY_STATE_CODE, stateNameFromCode } from "@/lib/gstin";

export { GST_RATES, GST_RETIRED_RATES, GST_SPECIAL_RATES, isRetiredGstRate };

/**
 * When the slab table below was last checked against the law.
 *
 * GST 2.0 took effect **22 September 2025**: it abolished 12% and 28% and added
 * 40%. Source: docs/research/gst-compliance.md §3(a).
 */
export const GST_RATES_LAST_VERIFIED = "2026-08";

/** The date the two retired slabs stopped being issuable. */
export const GST_2_0_EFFECTIVE_DATE = "2025-09-22";

/** Shown next to a line that still carries 12% or 28%. */
export const GST_RETIRED_RATE_WARNING =
  "12% and 28% were withdrawn on 22 Sep 2025.";

/**
 * Every rate a PICKER may offer, ordered as a user reads them.
 *
 * 12 and 28 are deliberately absent. They are accepted on read (a document
 * issued before 22 Sep 2025 legitimately carries them, and a user may type one
 * for a back-dated invoice) but offering them would be handing someone a rate
 * that no longer exists.
 */
export const GST_RATE_PICKER_VALUES: readonly number[] = [
  ...GST_SPECIAL_RATES,
  ...GST_RATES,
].sort((a, b) => a - b);

/** Every rate accepted on READ, retired slabs included. */
export const GST_ACCEPTED_RATES: readonly number[] = [
  ...GST_RATE_PICKER_VALUES,
  ...GST_RETIRED_RATES,
].sort((a, b) => a - b);

/**
 * Is this a rate GST actually has? Used to drop a hallucinated 15% from an AI
 * patch before it reaches form state. A retired 12% passes — it is real, just
 * withdrawn, and it earns a warning rather than a silent drop.
 */
export const isAcceptedGstRate = (rate: unknown): boolean =>
  typeof rate === "number" &&
  Number.isFinite(rate) &&
  GST_ACCEPTED_RATES.includes(rate);

/** "0.25%", "5%", "18%" — never "18.00%". */
export const formatGstRate = (rate: number): string =>
  `${Number(rate.toFixed(3))}%`;

/**
 * Picker options, plus whatever non-standard rate the line already carries.
 *
 * A stored 12% must stay visible and selected rather than silently snapping to
 * the nearest live slab — an issued document keeps the numbers it was issued
 * with, and an editor that cannot display a value it loaded is worse than one
 * that shows a warning next to it.
 */
export const gstRateOptions = (
  currentRate?: number
): Array<{ value: string; label: string }> => {
  const values = [...GST_RATE_PICKER_VALUES];
  if (
    typeof currentRate === "number" &&
    Number.isFinite(currentRate) &&
    currentRate > 0 &&
    !values.includes(currentRate)
  ) {
    values.push(currentRate);
  }
  return values
    .sort((a, b) => a - b)
    .map((value) => ({
      value: String(value),
      label: isRetiredGstRate(value)
        ? `${formatGstRate(value)} (withdrawn)`
        : formatGstRate(value),
    }));
};

/**
 * Unit Quantity Codes. A curated short list, NOT an enum the field validates
 * against: a wrong UQC is a return-filing annoyance, a blocked save is a lost
 * invoice. The field is free text capped at `MAX_UNIT_LENGTH`; this list only
 * drives the datalist of suggestions. `OTH` is the fallback.
 */
export const UQC_CODES: readonly string[] = [
  "NOS",
  "PCS",
  "KGS",
  "GMS",
  "LTR",
  "MLT",
  "MTR",
  "SQF",
  "SQM",
  "HRS",
  "DAY",
  "MON",
  "SET",
  "BOX",
  "BAG",
  "OTH",
];

export const DEFAULT_UQC = "OTH";

/** The DB column and the API normalizer both cap at 8. */
export const MAX_UNIT_LENGTH = 8;

/**
 * Rule 46(f). Digits only, 4/6/8 long. The DIGIT COUNT is turnover-based (4
 * digits up to ₹5cr, 6 above) and Invoicey does not know the user's turnover,
 * so this validates the FORMAT and nothing else — presence is required only
 * when the line is taxed, and that rule lives in `validateInvoice`.
 */
export const HSN_SAC_REGEX = /^\d{4}(?:\d{2})?(?:\d{2})?$/;

export const isValidHsnSac = (value: unknown): boolean =>
  typeof value === "string" && HSN_SAC_REGEX.test(value.trim());

/** SAC — services — always begins "99". Kept as a hint, never enforced. */
export const SAC_PREFIX = "99";

/**
 * What "96" prints as. Never print the code itself — it is an Invoicey-internal
 * sentinel, not an official GST state code (see `OTHER_COUNTRY_STATE_CODE`).
 */
export const OUTSIDE_INDIA_LABEL = "Outside India";

/**
 * The printable name for a place-of-supply code. One definition, shared by the
 * editor's picker, the AI normalizer, the patch applier and both exporters, so
 * the label on the document cannot depend on which surface set it.
 */
export const placeOfSupplyLabelFor = (code: string | undefined): string => {
  const trimmed = (code ?? "").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed === OTHER_COUNTRY_STATE_CODE
    ? OUTSIDE_INDIA_LABEL
    : stateNameFromCode(trimmed);
};
