"use client";

import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { SelectField } from "@/components/ui/select-field";
import {
  INVOICE_SORT_OPTIONS,
  INVOICE_STATUS_FILTERS,
  isInvoiceListFiltered,
  parseSortToken,
  sortToken,
  type InvoiceListState,
  type InvoiceStatusFilter,
} from "@/lib/dashboard-query";

interface InvoiceFilterBarProps {
  state: InvoiceListState;
  onChange: (next: Partial<InvoiceListState>) => void;
  /** Matching rows across all pages, for the "showing N" line. */
  total: number;
  isLoading?: boolean;
}

/**
 * Search + status filter + sort for the dashboard list.
 *
 * `SearchInput` and `SelectField` already existed and were used only by the
 * admin panel — the customer-facing list had no way to find "that invoice for
 * Nova Health" other than scrolling. Nothing new is built here; the debounce,
 * the clear button and the 44px targets all come from the shared components.
 *
 * Every change resets to page 1. Staying on page 4 after narrowing a 90-invoice
 * list to 3 results shows an empty table and reads as "no results".
 */
export function InvoiceFilterBar({
  state,
  onChange,
  total,
  isLoading,
}: InvoiceFilterBarProps) {
  const filtered = isInvoiceListFiltered(state);

  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700 sm:flex-row sm:items-center">
      <SearchInput
        value={state.search}
        onDebouncedChange={(value) => onChange({ search: value, page: 1 })}
        placeholder="Search by client or invoice number"
        aria-label="Search invoices"
        className="sm:max-w-xs"
      />
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <SelectField
          value={state.status}
          onValueChange={(value) =>
            onChange({ status: value as InvoiceStatusFilter, page: 1 })
          }
          options={INVOICE_STATUS_FILTERS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          className="w-full sm:w-40"
          aria-label="Filter by status"
        />
        <SelectField
          value={sortToken(state.sort, state.order)}
          onValueChange={(value) => {
            const { field, order } = parseSortToken(value);
            onChange({ sort: field, order, page: 1 });
          }}
          options={INVOICE_SORT_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          className="w-full sm:w-48"
          aria-label="Sort invoices"
        />
        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ search: "", status: "", page: 1 })}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
      {/* aria-live so a screen reader hears the result count change after a
          search, which is otherwise a silent update. */}
      <p
        aria-live="polite"
        className="tabular shrink-0 text-xs text-slate-500 dark:text-slate-400"
      >
        {isLoading
          ? "Loading…"
          : `${total} ${total === 1 ? "invoice" : "invoices"}${
              filtered ? " matching" : ""
            }`}
      </p>
    </div>
  );
}
