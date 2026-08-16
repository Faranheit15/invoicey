/**
 * The server half of the dashboard list query: search, status filter and sort,
 * translated into a Mongo filter and a sort spec.
 *
 * Server-only by placement, not by dependency — this file imports nothing from
 * mongoose and touches no connection. It is here rather than beside
 * `lib/dashboard-query.ts` so the browser bundle never pulls in `escapeRegex`
 * and the regex-building code paths, and so it can be unit-tested as plain
 * objects with no database.
 *
 * `GET /api/invoices` currently returns every invoice a user has, unpaginated
 * and unfiltered. Wiring these two helpers plus `parsePagination` (already used
 * by every admin route) into it is the whole fix.
 */

import { escapeRegex } from "@/lib/server/pagination";

export type InvoiceListSortField =
  | "createdAt"
  | "invoiceDate"
  | "dueDate"
  | "total"
  | "invoiceNumber"
  | "billTo";

const SORT_FIELDS: readonly InvoiceListSortField[] = [
  "createdAt",
  "invoiceDate",
  "dueDate",
  "total",
  "invoiceNumber",
  "billTo",
];

const STATUS_FILTERS = ["draft", "sent", "paid", "overdue"] as const;
export type InvoiceListStatusFilter = (typeof STATUS_FILTERS)[number];

export interface InvoiceListSort {
  /** Ready to hand straight to `.sort()`. */
  spec: Record<string, 1 | -1>;
  field: InvoiceListSortField;
  order: "asc" | "desc";
}

/**
 * Sort, allowlisted. An arbitrary `sort` string reaching `.sort()` is a
 * free unindexed collection scan on request, so an unrecognised field silently
 * becomes the default rather than being passed through.
 *
 * `_id` is appended as a tiebreak on every sort: without it, two invoices
 * created in the same millisecond can swap places between page 1 and page 2 and
 * one of them is never shown.
 */
export const parseInvoiceListSort = (
  searchParams: URLSearchParams
): InvoiceListSort => {
  const rawField = (searchParams.get("sort") || "") as InvoiceListSortField;
  const field = SORT_FIELDS.includes(rawField) ? rawField : "createdAt";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const direction: 1 | -1 = order === "asc" ? 1 : -1;
  return { spec: { [field]: direction, _id: direction }, field, order };
};

/** UTC midnight of the given instant — the boundary "past due" is measured from. */
const startOfUtcDay = (now: Date): Date => {
  const start = new Date(now.getTime());
  start.setUTCHours(0, 0, 0, 0);
  return start;
};

/**
 * The status clause.
 *
 * "overdue" is not a stored value — the write path stamps "draft" or whatever
 * the client sent, and nothing ever ages a document in place. So the filter has
 * to reconstruct it: a receivable (not paid, not draft, not deleted) whose due
 * date is behind us, plus anything a user explicitly saved as overdue.
 *
 * "sent" is the mirror image and has to EXCLUDE the aged ones, or an invoice
 * would appear under both filters and the two counts would not add up to the
 * unfiltered total.
 *
 * The day boundary here is UTC, while the pill the user sees is computed from
 * their own calendar day (`resolveDisplayStatus`). They can disagree for a few
 * hours a day on an invoice due exactly today, for a user far from UTC. That is
 * accepted: the display is what the user reads, the filter is a coarse
 * server-side narrowing, and closing the gap would mean sending a timezone with
 * every request and giving up on ever indexing the query.
 */
const statusClause = (
  status: InvoiceListStatusFilter,
  now: Date
): Record<string, unknown> => {
  if (status === "paid" || status === "draft") {
    return { status };
  }

  const today = startOfUtcDay(now);
  const notDue = [
    { dueDate: { $gte: today } },
    { dueDate: null },
    { dueDate: { $exists: false } },
  ];

  if (status === "sent") {
    return { $and: [{ status: "sent" }, { $or: notDue }] };
  }

  // overdue
  return {
    $or: [
      { status: "overdue" },
      {
        status: { $nin: ["paid", "draft", "overdue"] },
        dueDate: { $lt: today },
      },
    ],
  };
};

export interface InvoiceListFilterOptions {
  userId: string;
  searchParams: URLSearchParams;
  /** Injected so the overdue boundary is testable without freezing the clock. */
  now?: Date;
}

/**
 * The Mongo filter for one user's list.
 *
 * Tenant scoping and the soft-delete rule are applied HERE and unconditionally,
 * so a future caller cannot add a filter and forget one of them. `q` is escaped
 * before it becomes a regex — an unescaped user string in a `$regex` is both a
 * ReDoS lever and a way to match documents the user did not ask for.
 */
export const buildInvoiceListFilter = ({
  userId,
  searchParams,
  now = new Date(),
}: InvoiceListFilterOptions): Record<string, unknown> => {
  const clauses: Record<string, unknown>[] = [
    { userId, is_deleted: { $ne: true } },
  ];

  const rawStatus = (searchParams.get("status") || "") as InvoiceListStatusFilter;
  if (STATUS_FILTERS.includes(rawStatus)) {
    clauses.push(statusClause(rawStatus, now));
  }

  const q = (searchParams.get("q") || "").trim().slice(0, 120);
  if (q) {
    const pattern = new RegExp(escapeRegex(q), "i");
    clauses.push({
      $or: [
        { invoiceNumber: pattern },
        { billTo: pattern },
        { billToEmail: pattern },
      ],
    });
  }

  return clauses.length === 1 ? clauses[0] : { $and: clauses };
};
