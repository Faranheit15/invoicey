/**
 * CLIENT MEMORY — the distinct clients a user has invoiced, derived from that
 * user's own invoice history.
 *
 * WHY THERE IS NO `Client` COLLECTION
 *
 * Every field a client picker needs (`billTo`, `billToEmail`, `billToAddress`,
 * `billToGstin`) is already written onto every invoice, because an invoice is a
 * historical record and must keep the identity it was issued with. A separate
 * collection would therefore be a *copy* of data the invoice already owns, and
 * copies drift: editing a client row would either silently restate documents a
 * client already holds (wrong) or diverge from them (useless). Deriving the
 * directory costs one aggregation over an index this app already has
 * (`{ userId, is_deleted, createdAt }`) and cannot go stale by construction.
 *
 * THE GROUPING KEY, AND WHY IT IS NOT THE NAME
 *
 * `billTo` alone is wrong in both directions:
 *
 *   - it MERGES two genuinely different clients that happen to share a name
 *     ("Sharma Associates" in Pune and in Jaipur), and
 *   - it SPLITS one client whose name was typed slightly differently
 *     ("Nova Health Pvt. Ltd." vs "Nova Health Pvt Ltd").
 *
 * So identity is taken in strength order:
 *
 *   1. `billToGstin`, when it is a full 15-character GSTIN. A GSTIN is a legal
 *      registration identifier — it is the strongest statement of "this is the
 *      same legal person" the invoice carries.
 *   2. `billToEmail`, lower-cased. Not legally unique, but in this product it is
 *      the address the invoice is actually sent to, so two invoices sharing one
 *      are overwhelmingly the same payer.
 *   3. The NORMALISED name — lower-cased, `.` and `,` dropped, runs of spaces
 *      collapsed. This fixes the split case above without pretending to fix the
 *      merge case, which no data on the invoice can fix.
 *
 * The accepted cost: a client invoiced once WITH a GSTIN and once without lands
 * in two rows. That is the safe failure — showing one client twice costs a
 * scroll, whereas silently merging two payers would put the wrong billing
 * address on a tax invoice. Rows are ordered newest-first so the most recently
 * used (and most complete) spelling leads.
 *
 * TWO IMPLEMENTATIONS, ONE RULE
 *
 * The key has to be computed inside MongoDB (that is where the grouping
 * happens), so it exists twice: `clientKeyExpression()` as an aggregation
 * expression and `clientGroupKey()` as a plain function. They are written to be
 * character-for-character equivalent, and `tests/client-directory.test.ts`
 * evaluates the aggregation expression with a small interpreter and asserts it
 * agrees with the function on every case. Change one, change the other.
 *
 * This module is PURE: no mongoose, no `NextRequest`, no clock. The route
 * supplies the userId (from the verified token, never from the request) and
 * runs the pipeline; the browser imports only the types.
 */

import { GSTIN_LENGTH } from "@/lib/gstin";

/* -------------------------------------------------------------------------- */
/* Bounds                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How many invoices the aggregation is allowed to look at, newest first.
 *
 * The list endpoint next door is still unpaginated, and this one must not
 * inherit that: a user with thousands of invoices would otherwise pay a full
 * collection group on every keystroke of the picker's search box. Bounding the
 * SCAN rather than only the output is the part that matters — a `$limit` after
 * a `$group` still grouped everything first.
 *
 * What it costs: a client last invoiced more than 2000 invoices ago drops out
 * of the directory. At this product's scale (a handful of invoices a month)
 * that is roughly thirty years of history.
 */
export const MAX_INVOICES_SCANNED = 2000;

/** Hard ceiling on distinct clients returned across all pages. */
export const MAX_CLIENTS = 500;

export const DEFAULT_CLIENT_PAGE_SIZE = 50;
export const MAX_CLIENT_PAGE_SIZE = 100;

/** Cap on the picker's search text, so `q` cannot become a giant regex. */
export const MAX_CLIENT_QUERY_LENGTH = 80;

/* -------------------------------------------------------------------------- */
/* Wire types                                                                 */
/* -------------------------------------------------------------------------- */

/** One derived client. Every string field is always present, possibly "". */
export interface ClientSummary {
  /** The grouping key. Stable for as long as the identity fields are. */
  key: string;
  name: string;
  email: string;
  address: string;
  gstin: string;
  /** The currency of the most recent invoice to this client. */
  currency: string;
  invoiceCount: number;
  /** ISO date of the most recent invoice, or "" when unparseable. */
  lastInvoiceDate: string;
  lastInvoiceNumber: string;
}

export interface ClientDirectoryResponse {
  clients: ClientSummary[];
  page: number;
  limit: number;
  /** Distinct clients matching the query, capped at MAX_CLIENTS. */
  total: number;
  hasMore: boolean;
  /**
   * True when the scan window was full, i.e. the user has more than
   * MAX_INVOICES_SCANNED invoices and older clients may be missing. The UI says
   * so rather than pretending the list is complete.
   */
  truncated: boolean;
}

/* -------------------------------------------------------------------------- */
/* The grouping key — plain-JavaScript half                                   */
/* -------------------------------------------------------------------------- */

/**
 * Stored GSTINs are already normalised on the way in (the invoice route's
 * `cleanGstin` runs `normalizeGstin`, and the schema declares
 * `uppercase: true, trim: true`), so trim + upper-case is all that is left to
 * do here — and it is exactly what the aggregation can express.
 */
const normalizeStoredGstin = (value: string | null | undefined): string =>
  (value ?? "").trim().toUpperCase();

const normalizeEmail = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase();

/**
 * The name, reduced to what two spellings of the same client have in common:
 * case folded, `.` and `,` treated as separators, empty runs dropped.
 *
 * Deliberately does NOT strip legal suffixes. "Nova Health LLP" and
 * "Nova Health Pvt Ltd" are different legal persons, and merging them would put
 * the wrong entity on a tax invoice.
 *
 * Splits on the literal space rather than `\s+` because `$split` in the
 * aggregation can only split on a literal — the two halves have to agree.
 */
export const normalizeClientName = (value: string | null | undefined): string =>
  (value ?? "")
    .replace(/[.,]/g, " ")
    .toLowerCase()
    .split(" ")
    .filter((part) => part.length > 0)
    .join(" ");

/**
 * The identity of the client on one invoice. Namespaced (`gstin:` / `email:` /
 * `name:`) so a name that happens to look like an email cannot collide with a
 * real one.
 */
export const clientGroupKey = (invoice: {
  billTo?: string | null;
  billToEmail?: string | null;
  billToGstin?: string | null;
}): string => {
  const gstin = normalizeStoredGstin(invoice.billToGstin);
  if (gstin.length === GSTIN_LENGTH) {
    return `gstin:${gstin}`;
  }
  const email = normalizeEmail(invoice.billToEmail);
  if (email.length > 0) {
    return `email:${email}`;
  }
  return `name:${normalizeClientName(invoice.billTo)}`;
};

/* -------------------------------------------------------------------------- */
/* The grouping key — aggregation half                                        */
/* -------------------------------------------------------------------------- */

/** `$trim` needs a string; a missing field is null. */
const str = (field: string) => ({ $ifNull: [field, ""] });

const gstinExpression = { $toUpper: { $trim: { input: str("$billToGstin") } } };

const emailExpression = { $toLower: { $trim: { input: str("$billToEmail") } } };

/**
 * The aggregation twin of `normalizeClientName`. `$reduce` over `$split` is how
 * you collapse repeated separators without a regex-replace operator.
 */
const nameKeyExpression = {
  $reduce: {
    input: {
      $split: [
        {
          $toLower: {
            $replaceAll: {
              input: {
                $replaceAll: { input: str("$billTo"), find: ".", replacement: " " },
              },
              find: ",",
              replacement: " ",
            },
          },
        },
        " ",
      ],
    },
    initialValue: "",
    in: {
      $cond: [
        { $eq: ["$$this", ""] },
        "$$value",
        {
          $cond: [
            { $eq: ["$$value", ""] },
            "$$this",
            { $concat: ["$$value", " ", "$$this"] },
          ],
        },
      ],
    },
  },
};

/**
 * The `$group` `_id`. Exported so the test can evaluate it and compare against
 * `clientGroupKey` — the two must not be allowed to drift.
 */
export const clientKeyExpression = () => ({
  $let: {
    vars: {
      gstin: gstinExpression,
      email: emailExpression,
      nameKey: nameKeyExpression,
    },
    in: {
      $switch: {
        branches: [
          {
            case: { $eq: [{ $strLenCP: "$$gstin" }, GSTIN_LENGTH] },
            then: { $concat: ["gstin:", "$$gstin"] },
          },
          {
            case: { $gt: [{ $strLenCP: "$$email" }, 0] },
            then: { $concat: ["email:", "$$email"] },
          },
        ],
        default: { $concat: ["name:", "$$nameKey"] },
      },
    },
  },
});

/* -------------------------------------------------------------------------- */
/* The pipeline                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Prefer the value from the most recent invoice, falling back to any non-empty
 * value ever seen.
 *
 * `$first` after a newest-first sort is "what the user typed last", which is
 * the right answer for an address that changed. But the latest invoice may have
 * left a field blank while an older one filled it, and a picker that answers
 * with "" when it holds the email is useless — so `$max` (any non-empty string
 * sorts above "") is the fallback.
 */
const preferLatest = (latest: string, anySeen: string) => ({
  $cond: [{ $gt: [{ $strLenCP: { $ifNull: [latest, ""] } }, 0] }, latest, { $ifNull: [anySeen, ""] }],
});

/** Escape user text before it reaches a Mongo regex (ReDoS / injection guard). */
const escapeForRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface ClientDirectoryQuery {
  /** ALWAYS the uid from the verified token. Never a request field. */
  userId: string;
  skip: number;
  limit: number;
  /** Free text from the picker's search box. Optional. */
  search?: string;
}

/**
 * The whole directory in one aggregation, ending in a `$facet` so the page and
 * the count come back from a single round trip.
 *
 * Stage order is load-bearing:
 *   `$match` (tenant + soft-delete)  ->  `$sort` newest-first  ->  `$limit`
 *   (bound the SCAN)  ->  `$group`  ->  `$match` (search)  ->  `$sort`
 *   ->  `$limit` (bound the DIRECTORY)  ->  `$facet` (page + total).
 *
 * The first three stages are exactly the shape of the
 * `{ userId: 1, is_deleted: 1, createdAt: -1 }` index, so the scan window is an
 * index scan, not a collection scan.
 */
export const buildClientDirectoryPipeline = (
  query: ClientDirectoryQuery
): Record<string, unknown>[] => {
  const search = (query.search ?? "").trim().slice(0, MAX_CLIENT_QUERY_LENGTH);

  const searchStages = search
    ? [
        {
          $match: {
            $or: [
              { name: { $regex: escapeForRegex(search), $options: "i" } },
              { email: { $regex: escapeForRegex(search), $options: "i" } },
              { gstin: { $regex: escapeForRegex(search), $options: "i" } },
            ],
          },
        },
      ]
    : [];

  return [
    // TENANT SCOPE + SOFT DELETE. Both live in the first stage on purpose: any
    // later stage that forgot them would already have read another user's rows.
    {
      $match: {
        userId: query.userId,
        is_deleted: { $ne: true },
        billTo: { $type: "string", $ne: "" },
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: MAX_INVOICES_SCANNED },
    { $addFields: { clientKey: clientKeyExpression() } },
    {
      $group: {
        _id: "$clientKey",
        name: { $first: str("$billTo") },
        nameAny: { $max: str("$billTo") },
        email: { $first: emailExpression },
        emailAny: { $max: emailExpression },
        address: { $first: str("$billToAddress") },
        addressAny: { $max: str("$billToAddress") },
        gstin: { $first: gstinExpression },
        gstinAny: { $max: gstinExpression },
        currency: { $first: { $ifNull: ["$currency", "INR"] } },
        invoiceCount: { $sum: 1 },
        lastInvoiceDate: { $max: "$invoiceDate" },
        lastInvoiceNumber: { $first: str("$invoiceNumber") },
        lastCreatedAt: { $max: "$createdAt" },
      },
    },
    {
      $project: {
        _id: 0,
        key: "$_id",
        name: preferLatest("$name", "$nameAny"),
        email: preferLatest("$email", "$emailAny"),
        address: preferLatest("$address", "$addressAny"),
        gstin: preferLatest("$gstin", "$gstinAny"),
        currency: 1,
        invoiceCount: 1,
        lastInvoiceDate: 1,
        lastInvoiceNumber: 1,
        lastCreatedAt: 1,
      },
    },
    ...searchStages,
    { $sort: { lastCreatedAt: -1, name: 1 } },
    { $limit: MAX_CLIENTS },
    {
      $facet: {
        rows: [{ $skip: query.skip }, { $limit: query.limit }],
        total: [{ $count: "value" }],
      },
    },
  ];
};

/* -------------------------------------------------------------------------- */
/* Serialization                                                              */
/* -------------------------------------------------------------------------- */

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

const asIsoDate = (value: unknown): string => {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
  }
  return "";
};

/** One `$facet` row -> the wire shape. Never throws on a malformed row. */
export const serializeClientRow = (row: Record<string, unknown>): ClientSummary => ({
  key: asString(row.key),
  name: asString(row.name).trim(),
  email: asString(row.email).trim(),
  address: asString(row.address).trim(),
  gstin: asString(row.gstin).trim(),
  currency: asString(row.currency) || "INR",
  invoiceCount:
    typeof row.invoiceCount === "number" && Number.isFinite(row.invoiceCount)
      ? row.invoiceCount
      : 0,
  lastInvoiceDate: asIsoDate(row.lastInvoiceDate),
  lastInvoiceNumber: asString(row.lastInvoiceNumber).trim(),
});
