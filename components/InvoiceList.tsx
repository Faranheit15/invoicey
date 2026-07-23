"use client";

import { Button } from "@/components/ui/button";
import {
  InvoiceRecord,
  InvoiceStatus,
  formatCurrency,
  formatDateLong,
  getInvoiceStatus,
} from "@/lib/invoices";
import {
  STATUS_PILL_BASE,
  statusPillClass,
} from "@/lib/invoice-status";
import { EyeOpenIcon, Pencil1Icon } from "@radix-ui/react-icons";

export interface InvoiceActionHandlers {
  onView: () => void;
  onEdit: () => void;
  onSettle: () => void;
  onDelete: () => void;
}

interface RowActionsProps extends InvoiceActionHandlers {
  invoice: InvoiceRecord;
  status: InvoiceStatus;
  isActioning: boolean;
  /** Cards give each control a full 44px touch target; table rows stay compact. */
  touch?: boolean;
}

/**
 * One definition of the four invoice actions, rendered by both the desktop
 * table and the mobile card list. The editor's live preview and the export
 * template already showed what happens when two renderings of the same data
 * drift apart; this stops the dashboard's from starting.
 */
export function InvoiceRowActions({
  invoice,
  status,
  isActioning,
  onView,
  onEdit,
  onSettle,
  onDelete,
  touch = false,
}: RowActionsProps) {
  const sizeClass = touch ? "h-11 min-w-[88px] flex-1" : "";
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={onView}
        disabled={isActioning}
        aria-label={`View ${invoice.invoiceNumber}`}
        className={sizeClass}
      >
        <EyeOpenIcon className="w-4 h-4" />
        View
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onEdit}
        disabled={isActioning}
        aria-label={`Edit ${invoice.invoiceNumber}`}
        className={sizeClass}
      >
        <Pencil1Icon className="w-4 h-4" />
        Edit
      </Button>
      {status !== "paid" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={onSettle}
          disabled={isActioning}
          aria-label={`Mark ${invoice.invoiceNumber} as paid`}
          className={sizeClass}
        >
          Settle
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className={`border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/50 dark:text-rose-300 dark:hover:bg-rose-500/20 dark:hover:text-rose-200 ${sizeClass}`}
        onClick={onDelete}
        disabled={isActioning}
        aria-label={`Delete ${invoice.invoiceNumber}`}
      >
        Delete
      </Button>
    </>
  );
}

interface InvoiceCardListProps {
  invoices: InvoiceRecord[];
  activeActionInvoiceId: string | null;
  handlersFor: (invoice: InvoiceRecord) => InvoiceActionHandlers;
  className?: string;
}

/**
 * The narrow-viewport rendering of the invoice list.
 *
 * Below `md` the seven-column table is the wrong container: the two things a
 * user actually wants — the amount and the actions — sit furthest right, so a
 * horizontally scrolling table hides exactly what they opened the page for.
 * The card leads with client and amount and puts all four actions in reach.
 */
export function InvoiceCardList({
  invoices,
  activeActionInvoiceId,
  handlersFor,
  className,
}: InvoiceCardListProps) {
  return (
    <ul className={className}>
      {invoices.map((invoice) => {
        const status = getInvoiceStatus(invoice);
        const isActioning = activeActionInvoiceId === invoice._id;
        return (
          <li
            key={invoice._id}
            className="border-b border-slate-200 px-4 py-4 last:border-b-0 dark:border-slate-700"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-medium text-slate-800 dark:text-slate-100">
                  {invoice.billTo || "No client name"}
                </p>
                <p className="mt-0.5 truncate text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  {invoice.invoiceNumber}
                </p>
              </div>
              <span
                className={`${STATUS_PILL_BASE} shrink-0 ${statusPillClass[status]}`}
              >
                {status}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="tabular text-xl font-semibold text-slate-900 dark:text-slate-100">
                {formatCurrency(invoice.total, invoice.currency)}
              </p>
              <p className="tabular text-xs text-slate-600 dark:text-slate-400">
                Due {formatDateLong(invoice.dueDate)}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <InvoiceRowActions
                touch
                invoice={invoice}
                status={status}
                isActioning={isActioning}
                {...handlersFor(invoice)}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
