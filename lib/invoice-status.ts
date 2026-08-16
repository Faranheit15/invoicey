import { toCalendarParts } from "@/lib/format-date";
import type { InvoiceStatus } from "@/lib/invoices";

/**
 * Status pill styling, in one place.
 *
 * Two variants exist because the pill appears on two different grounds, and the
 * distinction is deliberate rather than drift:
 *
 * - `statusPillClass` sits on app chrome (dashboard table, mobile cards) and so
 *   inverts with the theme.
 * - `statusPillOnMastheadClass` sits on the invoice sheet's near-black masthead,
 *   which is near-black in *both* themes, so it must not invert. It is also what
 *   survives printing, where a dark tint would not.
 *
 * Import from here rather than re-declaring a local map; this module is
 * framework-free so server and client components can both use it.
 */
export const statusPillClass: Record<InvoiceStatus, string> = {
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200",
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/45 dark:text-emerald-200",
  overdue: "bg-rose-100 text-rose-700 dark:bg-rose-900/45 dark:text-rose-200",
};

export const statusPillOnMastheadClass: Record<InvoiceStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-blue-100 text-blue-700",
  paid: "bg-emerald-100 text-emerald-700",
  overdue: "bg-rose-100 text-rose-700",
};

/** Shape shared by every pill: only the color pair differs. */
export const STATUS_PILL_BASE =
  "inline-flex rounded-full px-2 py-1 text-xs font-semibold uppercase";

/* ------------------------------------------------------------------------- *
 * Derived overdue
 * ------------------------------------------------------------------------- */

/**
 * "Overdue" is a DERIVED DISPLAY STATE, not a stored one.
 *
 * It used to be neither. `getInvoiceStatus` in lib/invoices.ts had a due-date
 * branch that inferred "overdue" when no status was set — and it never ran,
 * because `normalizePayload` in the write path stamps a status on every single
 * invoice ("draft" when the client sends nothing). So the branch was tested,
 * believed to work, and unreachable: an invoice sat at "sent" forever, however
 * long its due date had been in the past. Nothing in the product ever aged.
 *
 * Making it a stored value instead would need a cron, a job runner, or a
 * write-on-read — none of which exist here, all of which would have to keep
 * running to stay correct. A pure function of (stored status, due date, today)
 * needs none of that and cannot go stale: it is recomputed every render.
 *
 * The rules, and why:
 *
 * - **Paid is never overdue.** Money already collected cannot age, whatever the
 *   due date says. This is the rule the old inference would have got wrong.
 * - **Draft is never overdue.** A draft has not been issued to anybody, so
 *   there is nobody who owes on it. Ageing an unsent draft would print
 *   "OVERDUE" on a document the client has not even seen (the export stamps the
 *   status into the masthead).
 * - **A deleted invoice is never overdue.** Soft delete is this app's only
 *   cancellation; a cancelled document is not a receivable.
 * - **A stored "overdue" is honoured** even with no due date. The editor
 *   exposes Status as a field, so that is the user saying so explicitly.
 * - **Due today is not yet overdue.** Payment is due *by* the end of that day;
 *   the invoice turns overdue the day after.
 *
 * Comparison is by CALENDAR DAY via `toCalendarParts`, never by instant. An
 * invoice due "2026-08-17" is not overdue at 23:00 IST on the 17th just because
 * it is already the 17th at 18:30 UTC — see the timezone note in
 * lib/format-date.ts, which this reuses rather than re-deriving.
 */
export interface AgeableInvoice {
  status?: InvoiceStatus;
  dueDate?: string | number | Date | null;
  is_deleted?: boolean;
  total?: number;
  currency?: string;
}

const MS_PER_DAY = 86_400_000;

/**
 * Days since the epoch for a calendar date, in no timezone at all. Only the
 * DIFFERENCE between two of these is ever used, so the epoch choice is
 * arbitrary; what matters is that both operands are read as calendar dates.
 */
const toDayNumber = (value?: string | number | Date | null): number | null => {
  const parts = toCalendarParts(value);
  if (!parts) {
    return null;
  }
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  // Date.UTC maps years 0-99 into 1900+; undo that so the arithmetic is honest.
  probe.setUTCFullYear(parts.year);
  return Math.round(probe.getTime() / MS_PER_DAY);
};

/**
 * Whether this invoice is one that can age at all: issued, unpaid, alive.
 * Separate from `isInvoiceOverdue` because the aging report needs the same
 * question asked without a due date in hand.
 */
export const isReceivable = (invoice: AgeableInvoice): boolean => {
  if (invoice.is_deleted) {
    return false;
  }
  const stored = invoice.status;
  return stored !== "paid" && stored !== "draft";
};

/**
 * Whole days the invoice is PAST its due date. 0 on the due date itself,
 * negative before it, and `null` when there is no usable due date — a distinct
 * answer from 0, because "no due date" is not "due today".
 *
 * Returns the raw day arithmetic for any invoice; it does not ask whether the
 * invoice is payable. Callers that care go through `isInvoiceOverdue`.
 */
export const daysPastDue = (
  invoice: AgeableInvoice,
  now: Date | number | string = new Date()
): number | null => {
  const due = toDayNumber(invoice.dueDate);
  if (due === null) {
    return null;
  }
  const today = toDayNumber(now);
  if (today === null) {
    return null;
  }
  return today - due;
};

/** A receivable whose due date has passed. */
export const isInvoiceOverdue = (
  invoice: AgeableInvoice,
  now: Date | number | string = new Date()
): boolean => {
  if (!isReceivable(invoice)) {
    return false;
  }
  const past = daysPastDue(invoice, now);
  return past !== null && past > 0;
};

/**
 * The status to SHOW. Never written back to the database — the stored status
 * stays whatever the user chose, and this is layered on top at render time.
 *
 * Supersedes `getInvoiceStatus` for display. That function is still the right
 * one when you need the invoice's own stored status (the export masthead of a
 * historical document, the admin table), which is why it is left alone.
 */
export const resolveDisplayStatus = (
  invoice: AgeableInvoice,
  now: Date | number | string = new Date()
): InvoiceStatus => {
  const stored = invoice.status;
  if (stored === "paid" || stored === "draft" || stored === "overdue") {
    return stored;
  }
  if (isInvoiceOverdue(invoice, now)) {
    return "overdue";
  }
  // Matches the historical fallback in `getInvoiceStatus`: a document with no
  // stored status at all predates the write path that stamps one.
  return stored ?? "sent";
};

/* ------------------------------------------------------------------------- *
 * Aging buckets
 * ------------------------------------------------------------------------- */

export type AgingBucketKey = "current" | "1-30" | "31-60" | "60+";

export interface AgingBucket {
  key: AgingBucketKey;
  label: string;
  /** Inclusive lower bound in days past due. */
  minDays: number;
  /** Inclusive upper bound, or `null` for the open-ended tail. */
  maxDays: number | null;
}

/**
 * The standard receivables ladder, in order. "current" holds everything not yet
 * overdue — including invoices with no due date, which cannot age.
 */
export const AGING_BUCKETS: readonly AgingBucket[] = [
  { key: "current", label: "Current", minDays: Number.NEGATIVE_INFINITY, maxDays: 0 },
  { key: "1-30", label: "1–30 days", minDays: 1, maxDays: 30 },
  { key: "31-60", label: "31–60 days", minDays: 31, maxDays: 60 },
  { key: "60+", label: "60+ days", minDays: 61, maxDays: null },
];

/**
 * Bucket for a day count. `null` (no due date) lands in "current": an invoice
 * with no due date has no date to be past.
 */
export const agingBucketForDays = (past: number | null): AgingBucketKey => {
  if (past === null || past <= 0) {
    return "current";
  }
  if (past <= 30) {
    return "1-30";
  }
  if (past <= 60) {
    return "31-60";
  }
  return "60+";
};

/**
 * Bucket for an invoice. Anything not receivable — paid, draft, deleted — is
 * "current" by definition: it is not an outstanding balance, so it cannot be an
 * aged one.
 */
export const agingBucketFor = (
  invoice: AgeableInvoice,
  now: Date | number | string = new Date()
): AgingBucketKey => {
  if (!isReceivable(invoice)) {
    return "current";
  }
  return agingBucketForDays(daysPastDue(invoice, now));
};

export interface AgingBucketTotal {
  key: AgingBucketKey;
  label: string;
  count: number;
  amount: number;
}

/**
 * The aging report: count and amount per bucket, over RECEIVABLES ONLY. Paid,
 * draft and deleted invoices are excluded entirely rather than swept into
 * "current", because the report answers "what is owed to me and how late is
 * it" — money already banked is not part of that answer.
 *
 * `currency` is not optional in spirit even though it is in the signature:
 * summing INR and USD into one number produces something arithmetically real
 * and financially meaningless, which is the exact bug the dashboard summary
 * cards were already fixed for. Pass one; omitting it sums everything and is
 * only safe for a single-currency account.
 */
export const summarizeAging = (
  invoices: readonly AgeableInvoice[],
  options: { now?: Date | number | string; currency?: string } = {}
): AgingBucketTotal[] => {
  const now = options.now ?? new Date();
  const totals = new Map<AgingBucketKey, { count: number; amount: number }>(
    AGING_BUCKETS.map((bucket) => [bucket.key, { count: 0, amount: 0 }])
  );

  for (const invoice of invoices) {
    if (!isReceivable(invoice)) {
      continue;
    }
    if (options.currency && (invoice.currency || "INR") !== options.currency) {
      continue;
    }
    const entry = totals.get(agingBucketFor(invoice, now));
    if (!entry) {
      continue;
    }
    entry.count += 1;
    entry.amount += Number.isFinite(invoice.total) ? (invoice.total as number) : 0;
  }

  return AGING_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    ...(totals.get(bucket.key) as { count: number; amount: number }),
  }));
};
