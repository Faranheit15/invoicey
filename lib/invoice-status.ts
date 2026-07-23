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
