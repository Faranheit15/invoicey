/**
 * DUPLICATE INVOICE — turning an issued invoice back into a fresh draft.
 *
 * The archetypal use of this product is a monthly retainer to the same client:
 * identical seller block, identical client block, identical line items, new
 * number and new dates. Without this, invoice #12 costs exactly what invoice #1
 * cost — which every audit named as the top structural reason a user does not
 * come back.
 *
 * WHY DUPLICATION IS A CLIENT-SIDE OPERATION
 *
 * A duplicate is a DRAFT, not a document. Nothing here writes to the database:
 * the editor loads the source record through the existing `GET ?id=`, maps it
 * with `mapInvoiceRecordToFormState`, runs it through `buildDuplicateFormState`
 * and hands the result to the user, who still has to press Save — the same
 * contract the AI assistant already has.
 *
 * A server-side `POST { action: "duplicate" }` would do two things this product
 * must not do. It would create a saved invoice the user never reviewed (and a
 * saved invoice is a legal document, not a scratchpad). And it would consume a
 * number out of a series that CGST Rule 46(b) requires to be *consecutive* —
 * `lib/invoice-number.ts` spells out why a number burnt on an abandoned draft
 * is itself an audit question. Suggesting a number is safe; issuing one is not.
 *
 * WHAT IS NOT COPIED, AND WHY IT CANNOT BE
 *
 * `_id`, `createdAt`, `updatedAt`, `is_deleted`, `userId` and every stored total
 * are not members of `InvoiceFormState` at all, so a duplicate cannot carry them
 * even by accident — the type is the guard. `status` IS a member, so it is reset
 * explicitly: duplicating a paid invoice must never produce a second invoice
 * that claims to already be paid.
 */

import {
  normalizeInvoiceNumber,
  parseInvoiceNumber,
  isFinancialYear,
} from "@/lib/invoice-number";
import type { InvoiceFormState } from "@/lib/invoices";

/** A payment term longer than a year is a typo, not a term. */
export const MAX_DUPLICATE_TERM_DAYS = 365;

/** Used when the source invoice's own dates are missing or nonsensical. */
export const DEFAULT_DUPLICATE_TERM_DAYS = 14;

/** `Date` -> the `yyyy-mm-dd` a date input binds to. */
export const toDateInputValue = (date: Date): string =>
  date.toISOString().split("T")[0];

/* -------------------------------------------------------------------------- */
/* Financial-year window                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The half-open `[start, end)` UTC window of an Indian financial year, for
 * querying `invoiceDate`.
 *
 * UTC because that is how the dates were stored: `invoiceDate` round-trips
 * through `toISOString().split("T")[0]` on the way in, so every stored value is
 * UTC midnight. Building the bounds with local getters would shift the window
 * by the server's offset and file the 1-April invoice into the wrong year — the
 * exact bug `lib/invoice-number.ts` documents at length.
 *
 * Returns null for a malformed financial year rather than guessing.
 */
export const financialYearRange = (
  financialYear: string
): { start: Date; end: Date } | null => {
  if (!isFinancialYear(financialYear)) {
    return null;
  }
  const startYear = Number(financialYear.slice(0, 4));
  return {
    start: new Date(Date.UTC(startYear, 3, 1)),
    end: new Date(Date.UTC(startYear + 1, 3, 1)),
  };
};

/**
 * The highest number in a set, by trailing sequence — the `previous` that
 * `suggestInvoiceNumber` wants.
 *
 * "Highest" is by SEQUENCE, not lexicographic order: "INV/2026-27/9" sorts
 * above "INV/2026-27/10" as a string, and suggesting "INV/2026-27/10" when 10
 * already exists is a collision. Numbers with no trailing digits are skipped
 * rather than compared — there is nothing in them to increment.
 *
 * Ties keep the FIRST entry, so callers should pass their list newest-first.
 */
export const highestInvoiceNumber = (
  numbers: readonly (string | null | undefined)[]
): string | null => {
  let best: string | null = null;
  let bestSequence = -1;

  for (const raw of numbers) {
    const value = normalizeInvoiceNumber(raw ?? "");
    if (value === "") {
      continue;
    }
    const parsed = parseInvoiceNumber(value);
    if (!parsed) {
      continue;
    }
    if (parsed.sequence > bestSequence) {
      bestSequence = parsed.sequence;
      best = value;
    }
  }

  return best;
};

/* -------------------------------------------------------------------------- */
/* The duplicate itself                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How many days the source invoice gave the client to pay.
 *
 * Carried over rather than reset to a default: a retainer billed net-30 stays
 * net-30. A due date that fell BEFORE the invoice date is a broken source
 * record, not a negative term, so it falls back to the default instead of
 * producing a duplicate that is overdue on the day it is created.
 */
export const duplicateTermDays = (
  invoiceDate: string | null | undefined,
  dueDate: string | null | undefined
): number => {
  const start = Date.parse(invoiceDate ?? "");
  const end = Date.parse(dueDate ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return DEFAULT_DUPLICATE_TERM_DAYS;
  }
  const days = Math.round((end - start) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) {
    return DEFAULT_DUPLICATE_TERM_DAYS;
  }
  return Math.min(days, MAX_DUPLICATE_TERM_DAYS);
};

export interface DuplicateOptions {
  /**
   * The fresh number, from `suggestInvoiceNumber` via `GET
   * /api/invoices?suggest_number=1`. May be "" when the series is exhausted or
   * the server could not be reached — the field stays editable and
   * `saveInvoice` refuses an empty one, which is the right place to stop.
   */
  invoiceNumber: string;
  /** Injectable so the mapping is testable without freezing the clock. */
  today?: Date;
}

/**
 * Source form state -> a new draft.
 *
 * Everything the user would otherwise retype carries over untouched: client
 * identity and address, GSTIN, line items with their HSN/SAC, UQC and per-line
 * rates, the whole GST block (treatment, place of supply, reverse charge,
 * LUT/export flags), TDS section, terms, notes, bank details and signature.
 *
 * Exactly four things change, and they are the four that MUST:
 *   - `invoiceNumber` — a number is unique within its financial year.
 *   - `invoiceDate`   — today.
 *   - `dueDate`       — today plus the source's own payment term.
 *   - `status`        — back to draft, whatever the source was settled to.
 */
export const buildDuplicateFormState = (
  source: InvoiceFormState,
  options: DuplicateOptions
): InvoiceFormState => {
  const today = options.today ?? new Date();
  const dueDate = new Date(today.getTime());
  dueDate.setUTCDate(
    dueDate.getUTCDate() + duplicateTermDays(source.invoiceDate, source.dueDate)
  );

  return {
    ...source,
    // Copied per row, not by reference: the caller's source object must not
    // start sharing line-item objects with the draft the user is about to edit.
    items: source.items.map((item) => ({ ...item })),
    invoiceNumber: options.invoiceNumber,
    invoiceDate: toDateInputValue(today),
    dueDate: toDateInputValue(dueDate),
    status: "draft",
  };
};
