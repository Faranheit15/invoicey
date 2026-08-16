import { describe, it, expect, beforeEach, mock } from "bun:test";
import { NextResponse } from "next/server";
import * as realAuth from "@/lib/server/auth";

/**
 * `GET /api/invoices` as a LIST endpoint: pagination, sort, filter — and the
 * two properties none of that is allowed to cost.
 *
 * The route used to return every invoice a user had ever created, unfiltered
 * and unpaginated. Wiring `buildInvoiceListFilter` + `parseInvoiceListSort` +
 * `parsePagination` into it introduced the first request-shaped input the list
 * query has ever had, so these tests assert, on EVERY path:
 *
 *   1. the filter is scoped to the caller's own uid, and
 *   2. `is_deleted: { $ne: true }` is present — "nothing is ever hard-deleted"
 *      is only true if every read honours it.
 *
 * Plus the compatibility rule the wiring depends on: with no `page`/`limit` the
 * response is still a bare ARRAY, because `invoicesApi.list()` (the dashboard's
 * summary cards, the account export) unwraps it as one.
 *
 * Bun's `mock.module` is process-global, so the auth module is spread rather
 * than replaced — see the note in tests/invoices-isolation.test.ts.
 */
mock.module("@/lib/server/auth", () => ({
  ...realAuth,
  requireUser: async () => "A",
  authErrorResponse: () =>
    NextResponse.json({ error: "unauthorized" }, { status: 401 }),
}));
mock.module("@/lib/mongodb", () => ({ default: async () => {} }));
mock.module("@/models/LogEntry", () => ({
  default: { create: async () => ({}) },
}));

type Doc = Record<string, unknown>;

/** The Mongo operators this route's filter can actually produce. */
const valueMatches = (value: unknown, condition: unknown): boolean => {
  if (condition instanceof RegExp) {
    return typeof value === "string" && condition.test(value);
  }
  if (condition && typeof condition === "object") {
    const ops = condition as Doc;
    return Object.entries(ops).every(([op, operand]) => {
      switch (op) {
        case "$ne":
          return (value ?? false) !== operand;
        case "$nin":
          return !(operand as unknown[]).includes(value);
        case "$lt":
          return value !== undefined && value !== null && (value as number) < (operand as number);
        case "$gte":
          return value !== undefined && value !== null && (value as number) >= (operand as number);
        case "$exists":
          return (value !== undefined) === operand;
        default:
          return false;
      }
    });
  }
  return value === condition;
};

const matches = (doc: Doc, filter: Doc): boolean =>
  Object.entries(filter).every(([key, condition]) => {
    if (key === "$and") {
      return (condition as Doc[]).every((clause) => matches(doc, clause));
    }
    if (key === "$or") {
      return (condition as Doc[]).some((clause) => matches(doc, clause));
    }
    return valueMatches(doc[key], condition);
  });

const compare = (a: unknown, b: unknown): number => {
  const left = a instanceof Date ? a.getTime() : a;
  const right = b instanceof Date ? b.getTime() : b;
  if ((left as number) < (right as number)) return -1;
  if ((left as number) > (right as number)) return 1;
  return 0;
};

const store: Doc[] = [];
/** Every filter the route handed the model, so the guarantees can be asserted. */
const findFilters: Doc[] = [];
const countFilters: Doc[] = [];
const sortSpecs: Doc[] = [];

/**
 * A thenable query, so both shapes the route uses work: `await find(f).sort(s)`
 * on the unpaginated path and `.sort().skip().limit().lean()` on the paged one.
 */
class FakeQuery {
  private rows: Doc[];
  constructor(rows: Doc[]) {
    this.rows = rows;
  }
  sort(spec: Doc) {
    sortSpecs.push(spec);
    const entries = Object.entries(spec);
    this.rows = [...this.rows].sort((a, b) => {
      for (const [field, direction] of entries) {
        const result = compare(a[field], b[field]) * (direction as number);
        if (result !== 0) return result;
      }
      return 0;
    });
    return this;
  }
  skip(n: number) {
    this.rows = this.rows.slice(n);
    return this;
  }
  limit(n: number) {
    this.rows = this.rows.slice(0, n);
    return this;
  }
  lean() {
    return this;
  }
  then<T>(resolve: (rows: Doc[]) => T) {
    return Promise.resolve(this.rows).then(resolve);
  }
}

class FakeInvoice {
  static find(filter: Doc) {
    findFilters.push(filter);
    return new FakeQuery(store.filter((doc) => matches(doc, filter)));
  }
  static async countDocuments(filter: Doc) {
    countFilters.push(filter);
    return store.filter((doc) => matches(doc, filter)).length;
  }
  static async findOne(filter: Doc) {
    return store.find((doc) => matches(doc, filter)) ?? null;
  }
}

mock.module("@/models/Invoice", () => ({ default: FakeInvoice }));

const { GET } = await import("@/app/api/invoices/route");

const makeReq = (url: string) =>
  ({
    url,
    headers: { get: () => null },
    json: async () => ({}),
  }) as unknown as import("next/server").NextRequest;

interface PagedBody {
  invoices: Doc[];
  page: number;
  limit: number;
  total: number;
}

/** Every clause in a filter, flattened out of any `$and` nesting. */
const clausesOf = (filter: Doc): Doc[] =>
  Array.isArray(filter.$and) ? (filter.$and as Doc[]) : [filter];

const isTenantScoped = (filter: Doc, userId = "A"): boolean =>
  clausesOf(filter).some((clause) => clause.userId === userId);

const excludesDeleted = (filter: Doc): boolean =>
  clausesOf(filter).some(
    (clause) =>
      JSON.stringify(clause.is_deleted) === JSON.stringify({ $ne: true })
  );

beforeEach(() => {
  store.length = 0;
  findFilters.length = 0;
  countFilters.length = 0;
  sortSpecs.length = 0;

  for (let index = 1; index <= 5; index += 1) {
    store.push({
      _id: `a-${index}`,
      userId: "A",
      is_deleted: false,
      invoiceNumber: `A-${index}`,
      billTo: index === 1 ? "Nova Health" : `Client ${index}`,
      billToEmail: `client${index}@example.com`,
      status: "sent",
      total: index * 100,
      createdAt: new Date(2026, 0, index),
      dueDate: new Date(2030, 0, 1),
    });
  }
  store.push({
    _id: "a-deleted",
    userId: "A",
    is_deleted: true,
    invoiceNumber: "A-GONE",
    billTo: "Nova Health",
    status: "sent",
    total: 9_999,
    createdAt: new Date(2026, 5, 1),
  });
  store.push({
    _id: "b-1",
    userId: "B",
    is_deleted: false,
    invoiceNumber: "B-1",
    billTo: "Nova Health",
    status: "sent",
    total: 500,
    createdAt: new Date(2026, 6, 1),
  });
});

describe("GET /api/invoices — list shape", () => {
  it("returns a bare array when neither page nor limit is asked for", async () => {
    // `invoicesApi.list()` unwraps this as an array. Paginating unconditionally
    // would silently break the dashboard's summary cards and the account export.
    const res = await GET(makeReq("http://x/api/invoices"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect((body as Doc[]).map((row) => row._id)).toEqual([
      "a-5",
      "a-4",
      "a-3",
      "a-2",
      "a-1",
    ]);
  });

  it("returns a paged envelope as soon as page or limit is present", async () => {
    const res = await GET(makeReq("http://x/api/invoices?page=2&limit=2"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PagedBody;
    expect(body.page).toBe(2);
    expect(body.limit).toBe(2);
    expect(body.total).toBe(5);
    expect(body.invoices.map((row) => row._id)).toEqual(["a-3", "a-2"]);
  });

  it("paginates on `limit` alone, without a page", async () => {
    const body = (await (
      await GET(makeReq("http://x/api/invoices?limit=3"))
    ).json()) as PagedBody;
    expect(body.page).toBe(1);
    expect(body.invoices).toHaveLength(3);
    expect(body.total).toBe(5);
  });

  it("clamps a hostile limit to 100 rather than serving an unbounded page", async () => {
    const body = (await (
      await GET(makeReq("http://x/api/invoices?limit=100000"))
    ).json()) as PagedBody;
    expect(body.limit).toBe(100);
  });

  it("falls back to page 1 for a nonsense page number", async () => {
    const body = (await (
      await GET(makeReq("http://x/api/invoices?page=-4&limit=2"))
    ).json()) as PagedBody;
    expect(body.page).toBe(1);
    expect(body.invoices.map((row) => row._id)).toEqual(["a-5", "a-4"]);
  });
});

describe("GET /api/invoices — the soft-delete filter is unconditional", () => {
  /**
   * The single most important property of this route. "Nothing is ever
   * hard-deleted" only holds if every read filters the tombstones out, so this
   * is asserted on the response AND on the filter object for every combination
   * of the new query params.
   */
  const queries = [
    "",
    "?page=1&limit=50",
    "?q=Nova",
    "?q=Nova&page=1&limit=10",
    "?status=sent",
    "?status=overdue&page=1&limit=10",
    "?status=paid",
    "?status=draft&limit=5",
    "?sort=total&order=asc&page=1&limit=10",
    "?sort=companyAddress&order=sideways",
  ];

  for (const query of queries) {
    it(`excludes soft-deleted rows and scopes to the caller for "${query || "(no params)"}"`, async () => {
      const res = await GET(makeReq(`http://x/api/invoices${query}`));
      expect(res.status).toBe(200);

      const body = await res.json();
      const rows = Array.isArray(body) ? (body as Doc[]) : (body as PagedBody).invoices;
      expect(rows.every((row) => row.is_deleted !== true)).toBe(true);
      expect(rows.every((row) => row.userId === "A")).toBe(true);

      for (const filter of [...findFilters, ...countFilters]) {
        expect(isTenantScoped(filter)).toBe(true);
        expect(excludesDeleted(filter)).toBe(true);
      }
    });
  }

  it("never counts a soft-deleted or another user's invoice in `total`", async () => {
    // "Nova Health" matches three rows: one live, one deleted, one owned by B.
    const body = (await (
      await GET(makeReq("http://x/api/invoices?q=Nova&page=1&limit=10"))
    ).json()) as PagedBody;
    expect(body.total).toBe(1);
    expect(body.invoices.map((row) => row._id)).toEqual(["a-1"]);
  });
});

describe("GET /api/invoices — sort", () => {
  it("defaults to newest first, with `_id` as the tiebreak", async () => {
    await GET(makeReq("http://x/api/invoices?page=1&limit=2"));
    expect(sortSpecs[0]).toEqual({ createdAt: -1, _id: -1 });
  });

  it("honours an allowlisted field and direction", async () => {
    const body = (await (
      await GET(makeReq("http://x/api/invoices?sort=total&order=asc&page=1&limit=3"))
    ).json()) as PagedBody;
    expect(sortSpecs[0]).toEqual({ total: 1, _id: 1 });
    expect(body.invoices.map((row) => row.total)).toEqual([100, 200, 300]);
  });

  it("ignores a field that is not on the allowlist", async () => {
    // An arbitrary `sort` reaching `.sort()` is a free unindexed scan per request.
    await GET(makeReq("http://x/api/invoices?sort=companyAddress&page=1&limit=2"));
    expect(sortSpecs[0]).toEqual({ createdAt: -1, _id: -1 });
  });
});

describe("GET /api/invoices — search and status still narrow the list", () => {
  it("matches the search against the invoice number, client and client email", async () => {
    const body = (await (
      await GET(makeReq("http://x/api/invoices?q=client3%40example.com&limit=10"))
    ).json()) as PagedBody;
    expect(body.invoices.map((row) => row._id)).toEqual(["a-3"]);
  });

  it("treats a regex metacharacter in the search as a literal", async () => {
    const body = (await (
      await GET(makeReq("http://x/api/invoices?q=.%2A&limit=10"))
    ).json()) as PagedBody;
    expect(body.total).toBe(0);
  });

  it("returns nothing for a status no invoice is in", async () => {
    const body = (await (
      await GET(makeReq("http://x/api/invoices?status=paid&limit=10"))
    ).json()) as PagedBody;
    expect(body.total).toBe(0);
  });
});
