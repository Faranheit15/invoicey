/**
 * Dashboard list state: search, status filter, sort, pagination.
 *
 * Pure and DOM-free. Everything here is either a query the dashboard sends to
 * the API or the client-side equivalent used while the list endpoint is still
 * unpaginated — the two are kept in one file precisely so they cannot disagree
 * about what "sort by due date, descending" means.
 *
 * The list endpoint returns every invoice a user has ever created, unfiltered
 * and unpaginated: a one-year-old account is roughly a megabyte of JSON on
 * every dashboard load, re-downloaded on every refresh. `buildInvoiceListQuery`
 * is the client half of fixing that; `lib/server/invoice-list-query.ts` is the
 * server half. Until the route lands, `selectInvoicePage` does the same work in
 * the browser so the UI is already correct and only the transport changes.
 */

import type { QueryParams } from "@/lib/api-client";
import type { InvoiceRecord, InvoiceStatus } from "@/lib/invoices";
import { resolveDisplayStatus, type AgeableInvoice } from "@/lib/invoice-status";

/** "" means "all statuses" — the absence of a filter, not a status. */
export type InvoiceStatusFilter = "" | InvoiceStatus;

export const INVOICE_STATUS_FILTERS: readonly {
  value: InvoiceStatusFilter;
  label: string;
}[] = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
];

export type InvoiceSortField =
  | "createdAt"
  | "invoiceDate"
  | "dueDate"
  | "total"
  | "invoiceNumber"
  | "billTo";

export type SortOrder = "asc" | "desc";

/**
 * Sort fields the API is allowed to honour. An allowlist rather than a
 * pass-through: `sort` reaches a Mongo `.sort()` call, and an arbitrary string
 * there is an unindexed-scan lever at best.
 */
export const INVOICE_SORT_FIELDS: readonly InvoiceSortField[] = [
  "createdAt",
  "invoiceDate",
  "dueDate",
  "total",
  "invoiceNumber",
  "billTo",
];

export const INVOICE_SORT_OPTIONS: readonly {
  value: string;
  label: string;
  field: InvoiceSortField;
  order: SortOrder;
}[] = [
  { value: "createdAt:desc", label: "Newest first", field: "createdAt", order: "desc" },
  { value: "createdAt:asc", label: "Oldest first", field: "createdAt", order: "asc" },
  { value: "dueDate:asc", label: "Due date (soonest)", field: "dueDate", order: "asc" },
  { value: "dueDate:desc", label: "Due date (latest)", field: "dueDate", order: "desc" },
  { value: "total:desc", label: "Amount (high to low)", field: "total", order: "desc" },
  { value: "total:asc", label: "Amount (low to high)", field: "total", order: "asc" },
  { value: "billTo:asc", label: "Client (A–Z)", field: "billTo", order: "asc" },
];

/**
 * 25 matches the admin tables and the shared `Pagination` default. It is also
 * about one screen of table rows on a laptop, so a page boundary lands where a
 * scroll would have anyway.
 */
export const INVOICE_PAGE_SIZE = 25;
export const DEFAULT_INVOICE_SORT: InvoiceSortField = "createdAt";
export const DEFAULT_INVOICE_ORDER: SortOrder = "desc";

export interface InvoiceListState {
  search: string;
  status: InvoiceStatusFilter;
  sort: InvoiceSortField;
  order: SortOrder;
  page: number;
  pageSize: number;
}

export const defaultInvoiceListState = (): InvoiceListState => ({
  search: "",
  status: "",
  sort: DEFAULT_INVOICE_SORT,
  order: DEFAULT_INVOICE_ORDER,
  page: 1,
  pageSize: INVOICE_PAGE_SIZE,
});

/** `"dueDate:asc"` -> its option, or the default when unrecognised. */
export const parseSortToken = (
  token: string
): { field: InvoiceSortField; order: SortOrder } => {
  const match = INVOICE_SORT_OPTIONS.find((option) => option.value === token);
  if (match) {
    return { field: match.field, order: match.order };
  }
  return { field: DEFAULT_INVOICE_SORT, order: DEFAULT_INVOICE_ORDER };
};

export const sortToken = (field: InvoiceSortField, order: SortOrder): string =>
  `${field}:${order}`;

/**
 * The query the dashboard sends. Empty values are omitted entirely rather than
 * sent blank, so the URL stays readable and `buildQuery` (which already drops
 * `""`) has nothing to strip.
 */
export const buildInvoiceListQuery = (
  state: Partial<InvoiceListState> = {}
): QueryParams => {
  const merged = { ...defaultInvoiceListState(), ...state };
  const search = merged.search.trim();
  return {
    page: Math.max(1, Math.floor(merged.page) || 1),
    limit: merged.pageSize,
    sort: merged.sort,
    order: merged.order,
    ...(search ? { q: search } : {}),
    ...(merged.status ? { status: merged.status } : {}),
  };
};

/* ------------------------------------------------------------------------- *
 * Client-side equivalent
 * ------------------------------------------------------------------------- */

/**
 * Fields the search box looks at. Deliberately short: the audit's example is
 * "that invoice for Nova Health", and a search that also matched notes and
 * terms would return every invoice sharing a boilerplate payment note.
 */
const SEARCHABLE_FIELDS: readonly (keyof InvoiceRecord)[] = [
  "invoiceNumber",
  "billTo",
  "billToEmail",
];

/** Case- and whitespace-insensitive substring match over the search fields. */
export const matchesInvoiceSearch = (
  invoice: Partial<InvoiceRecord>,
  query: string
): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return SEARCHABLE_FIELDS.some((key) => {
    const value = invoice[key];
    return typeof value === "string" && value.toLowerCase().includes(needle);
  });
};

/**
 * Status match against the DERIVED status, not the stored one. Filtering on the
 * stored value would make the "Overdue" filter return nothing at all, because
 * nothing is ever stored as overdue by the write path.
 */
export const matchesInvoiceStatus = (
  invoice: AgeableInvoice,
  status: InvoiceStatusFilter,
  now: Date | number | string = new Date()
): boolean => {
  if (!status) {
    return true;
  }
  return resolveDisplayStatus(invoice, now) === status;
};

const comparableValue = (
  invoice: Partial<InvoiceRecord>,
  field: InvoiceSortField
): string | number => {
  if (field === "total") {
    return Number.isFinite(invoice.total) ? (invoice.total as number) : 0;
  }
  if (field === "billTo" || field === "invoiceNumber") {
    return (invoice[field] ?? "").toString().toLowerCase();
  }
  const raw = invoice[field];
  if (!raw) {
    // Missing dates sort as the far past so they cluster at one end rather than
    // scattering through the list wherever NaN happens to land.
    return Number.NEGATIVE_INFINITY;
  }
  const time = new Date(raw as string).getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
};

/** Stable sort: equal keys keep their incoming order. */
export const sortInvoices = <T extends Partial<InvoiceRecord>>(
  invoices: readonly T[],
  field: InvoiceSortField,
  order: SortOrder
): T[] => {
  const direction = order === "asc" ? 1 : -1;
  return invoices
    .map((invoice, index) => ({ invoice, index }))
    .sort((a, b) => {
      const left = comparableValue(a.invoice, field);
      const right = comparableValue(b.invoice, field);
      if (left < right) return -1 * direction;
      if (left > right) return 1 * direction;
      return a.index - b.index;
    })
    .map((entry) => entry.invoice);
};

export interface InvoicePage<T> {
  /** The rows for the requested page. */
  data: T[];
  /** Rows matching the filter, across all pages. */
  total: number;
  /** The page actually returned — clamped when the request overshot the end. */
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * Filter, sort and slice in the browser.
 *
 * This is the interim implementation while `GET /api/invoices` still returns
 * everything, and it stays useful afterwards as the definition the server-side
 * query is tested against. It also keeps one behaviour the server cannot easily
 * reproduce: the "overdue" filter is evaluated against the derived status.
 */
export const selectInvoicePage = <T extends Partial<InvoiceRecord> & AgeableInvoice>(
  invoices: readonly T[],
  state: Partial<InvoiceListState> = {},
  now: Date | number | string = new Date()
): InvoicePage<T> => {
  const merged = { ...defaultInvoiceListState(), ...state };
  const pageSize = Math.max(1, Math.floor(merged.pageSize) || INVOICE_PAGE_SIZE);

  const matched = invoices.filter(
    (invoice) =>
      matchesInvoiceSearch(invoice, merged.search) &&
      matchesInvoiceStatus(invoice, merged.status, now)
  );
  const sorted = sortInvoices(matched, merged.sort, merged.order);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Clamp rather than return an empty page: deleting the last invoice on page 3
  // must not leave the user staring at "0–0 of 51" with no way back.
  const page = Math.min(Math.max(1, Math.floor(merged.page) || 1), pageCount);
  const start = (page - 1) * pageSize;

  return {
    data: sorted.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    pageCount,
  };
};

/** Whether anything is narrowing the list — drives the "Clear filters" affordance. */
export const isInvoiceListFiltered = (state: Partial<InvoiceListState>): boolean =>
  Boolean((state.search ?? "").trim()) || Boolean(state.status);
