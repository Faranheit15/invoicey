"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { summarizeAging, type AgingBucketTotal } from "@/lib/invoice-status";
import { resolveDocumentKind } from "@/lib/invoice-domain";
import { formatCurrency, type InvoiceRecord } from "@/lib/invoices";

/**
 * Receivables ageing: what is owed, and how late it is.
 *
 * The ladder itself (`AGING_BUCKETS`, `summarizeAging`) was built and tested in
 * Phase 3 and then had no caller at all — a tested module the product never
 * showed anybody. Chasing payment is the job this audience actually does after
 * the invoice is sent, and "Outstanding: ₹2,40,000" does not distinguish an
 * invoice sent last Tuesday from one that is ninety days late. This is that one
 * number, split by how long it has been owed.
 *
 * TWO SELECTION RULES, both inherited from the summary cards above it rather
 * than reinvented:
 *
 *  - INVOICES ONLY. A proforma is a quote and a credit note is a reduction of
 *    an invoice already counted; neither is money someone owes, and ageing
 *    either would invent a receivable.
 *  - ONE CURRENCY. Summing INR and USD produces a number that is arithmetically
 *    real and financially meaningless — the bug the summary cards were already
 *    fixed for. The dominant currency is passed in and the rest are excluded,
 *    with the card saying so.
 *
 * `summarizeAging` does the rest: paid, draft and deleted rows are not
 * receivables and never enter the ladder.
 */

/** Invoices only — the same filter the summary cards use. Exported for tests. */
export const selectAgeableInvoices = (
  invoices: readonly InvoiceRecord[]
): InvoiceRecord[] =>
  invoices.filter(
    (invoice) => resolveDocumentKind(invoice.documentKind) === "invoice"
  );

export const buildAgingRows = (
  invoices: readonly InvoiceRecord[],
  currency: string,
  now: Date | number | string = new Date()
): AgingBucketTotal[] =>
  summarizeAging(selectAgeableInvoices(invoices), { currency, now });

interface AgingSummaryProps {
  /** The WHOLE account, not the current page — a bucket that moves when you
   *  paginate is worse than no bucket. */
  invoices: readonly InvoiceRecord[];
  currency: string;
  /** Currencies excluded from the figures, so the card can say so. */
  otherCurrencyCount?: number;
  isLoading?: boolean;
}

/** Late money reads red; not-yet-due reads neutral. */
const toneFor = (key: AgingBucketTotal["key"]) => {
  switch (key) {
    case "current":
      return "text-slate-900 dark:text-slate-100";
    case "1-30":
      return "text-amber-700 dark:text-amber-300";
    case "31-60":
      return "text-orange-700 dark:text-orange-300";
    default:
      return "text-rose-700 dark:text-rose-300";
  }
};

export function AgingSummary({
  invoices,
  currency,
  otherCurrencyCount = 0,
  isLoading = false,
}: AgingSummaryProps) {
  // Nothing to age and nothing to explain: a brand-new account should not meet
  // an empty receivables report before it has met its first invoice.
  if (!isLoading && invoices.length === 0) {
    return null;
  }

  const rows = buildAgingRows(invoices, currency);
  const outstanding = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <Card className="border-slate-200 dark:border-slate-700 dark:bg-slate-900">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-500 dark:text-slate-300">
          Outstanding by age
        </CardTitle>
      </CardHeader>
      <CardContent>
        {outstanding === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Nothing outstanding. Every invoice you have sent is settled.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {rows.map((row) => (
                <div key={row.key}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {row.label}
                  </dt>
                  <dd
                    className={`tabular break-words text-xl font-semibold ${toneFor(
                      row.key
                    )}`}
                  >
                    {formatCurrency(row.amount, currency)}
                  </dd>
                  <dd className="text-xs text-slate-500 dark:text-slate-400">
                    {row.count} {row.count === 1 ? "invoice" : "invoices"}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Counted by days past the due date, for invoices you have sent and
              not been paid for.
              {otherCurrencyCount > 0
                ? ` ${currency} only — ${otherCurrencyCount} other ${
                    otherCurrencyCount === 1 ? "currency" : "currencies"
                  } not included.`
                : ""}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
