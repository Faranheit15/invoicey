import { describe, it, expect, mock, beforeEach } from "bun:test";
import { NextResponse } from "next/server";
import * as realAuth from "@/lib/server/auth";
import {
  MAX_CLIENTS,
  MAX_INVOICES_SCANNED,
  buildClientDirectoryPipeline,
  clientGroupKey,
  clientKeyExpression,
  normalizeClientName,
  serializeClientRow,
} from "@/lib/clients";

/* -------------------------------------------------------------------------- */
/* A very small aggregation-expression interpreter                            */
/* -------------------------------------------------------------------------- */

/**
 * The grouping key exists twice — as a Mongo expression (`clientKeyExpression`)
 * and as a plain function (`clientGroupKey`) — because the grouping happens
 * inside the database but the picker, the tests and every reader need to be
 * able to reason about it here.
 *
 * Two implementations of one rule is exactly the drift this codebase keeps
 * fighting (preview vs export totals, three copies of `validateInvoice`). So
 * rather than trusting a comment, this evaluates the real aggregation
 * expression and asserts it agrees with the function on every case below. It
 * supports only the operators the expression actually uses; anything new throws
 * loudly rather than silently passing.
 */
type Doc = Record<string, unknown>;

const evaluate = (expr: unknown, doc: Doc, vars: Doc = {}): unknown => {
  if (typeof expr === "string") {
    if (expr.startsWith("$$")) {
      const name = expr.slice(2);
      if (!(name in vars)) throw new Error(`unbound variable ${expr}`);
      return vars[name];
    }
    if (expr.startsWith("$")) {
      return doc[expr.slice(1)];
    }
    return expr;
  }
  if (typeof expr !== "object" || expr === null) {
    return expr;
  }
  if (Array.isArray(expr)) {
    return expr.map((item) => evaluate(item, doc, vars));
  }

  const entries = Object.entries(expr as Record<string, unknown>);
  if (entries.length !== 1) {
    throw new Error(`expected a single operator, got ${entries.length}`);
  }
  const [op, argument] = entries[0];
  const arg = () => evaluate(argument, doc, vars);
  const spec = argument as Record<string, unknown>;

  switch (op) {
    case "$ifNull": {
      const [value, fallback] = arg() as unknown[];
      return value === null || value === undefined ? fallback : value;
    }
    case "$trim":
      return String(evaluate(spec.input, doc, vars) ?? "").trim();
    case "$toUpper":
      return String(arg() ?? "").toUpperCase();
    case "$toLower":
      return String(arg() ?? "").toLowerCase();
    case "$strLenCP":
      return Array.from(String(arg() ?? "")).length;
    case "$concat":
      return (arg() as unknown[]).map((part) => String(part ?? "")).join("");
    case "$eq": {
      const [left, right] = arg() as unknown[];
      return left === right;
    }
    case "$gt": {
      const [left, right] = arg() as unknown[];
      return (left as number) > (right as number);
    }
    case "$replaceAll":
      return String(evaluate(spec.input, doc, vars) ?? "").split(
        String(evaluate(spec.find, doc, vars))
      ).join(String(evaluate(spec.replacement, doc, vars)));
    case "$split": {
      const [value, separator] = arg() as [string, string];
      return String(value ?? "").split(separator);
    }
    case "$reduce": {
      const input = evaluate(spec.input, doc, vars) as unknown[];
      let value = evaluate(spec.initialValue, doc, vars);
      for (const item of input) {
        value = evaluate(spec.in, doc, { ...vars, this: item, value });
      }
      return value;
    }
    case "$cond": {
      const [condition, whenTrue, whenFalse] = argument as unknown[];
      return evaluate(condition, doc, vars)
        ? evaluate(whenTrue, doc, vars)
        : evaluate(whenFalse, doc, vars);
    }
    case "$let": {
      const declared = spec.vars as Record<string, unknown>;
      const next = { ...vars };
      for (const [name, valueExpr] of Object.entries(declared)) {
        next[name] = evaluate(valueExpr, doc, next);
      }
      return evaluate(spec.in, doc, next);
    }
    case "$switch": {
      const branches = spec.branches as { case: unknown; then: unknown }[];
      for (const branch of branches) {
        if (evaluate(branch.case, doc, vars)) {
          return evaluate(branch.then, doc, vars);
        }
      }
      return evaluate(spec.default, doc, vars);
    }
    default:
      throw new Error(`unsupported operator ${op}`);
  }
};

const keyInMongo = (doc: Doc): string =>
  evaluate(clientKeyExpression(), doc) as string;

/* -------------------------------------------------------------------------- */
/* The grouping key                                                           */
/* -------------------------------------------------------------------------- */

// A real, checksum-valid GSTIN and a second one for a different registration.
const NOVA_GSTIN = "29AAGCB7383J1Z4";
const OTHER_GSTIN = "27AAPFU0939F1ZV";

describe("clientGroupKey — identity strength order", () => {
  it("prefers a full GSTIN over the email and the name", () => {
    expect(
      clientGroupKey({
        billTo: "Nova Health Pvt Ltd",
        billToEmail: "accounts@novahealth.in",
        billToGstin: NOVA_GSTIN,
      })
    ).toBe(`gstin:${NOVA_GSTIN}`);
  });

  it("ignores a partially typed GSTIN and falls through to the email", () => {
    // 12 characters is not a registration, and grouping on it would invent an
    // identity out of an unfinished field.
    expect(
      clientGroupKey({
        billTo: "Nova Health",
        billToEmail: "accounts@novahealth.in",
        billToGstin: "29AAGCB7383J",
      })
    ).toBe("email:accounts@novahealth.in");
  });

  it("falls back to the normalised name when there is neither", () => {
    expect(clientGroupKey({ billTo: "Nova Health Pvt Ltd" })).toBe(
      "name:nova health pvt ltd"
    );
  });

  it("groups two spellings of one name together", () => {
    // The SPLIT failure the audit describes: one client, typed twice.
    const a = clientGroupKey({ billTo: "Nova Health Pvt. Ltd." });
    const b = clientGroupKey({ billTo: "nova   health pvt ltd" });
    const c = clientGroupKey({ billTo: "Nova Health, Pvt Ltd" });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("keeps two different legal forms of a similar name apart", () => {
    // Suffix stripping would merge these, and they are different persons.
    expect(clientGroupKey({ billTo: "Nova Health LLP" })).not.toBe(
      clientGroupKey({ billTo: "Nova Health Pvt Ltd" })
    );
  });

  it("keeps two same-named clients apart when their emails differ", () => {
    // The MERGE failure: `billTo` alone would put these in one row.
    expect(
      clientGroupKey({
        billTo: "Sharma Associates",
        billToEmail: "pune@sharma.co.in",
      })
    ).not.toBe(
      clientGroupKey({
        billTo: "Sharma Associates",
        billToEmail: "jaipur@sharma.co.in",
      })
    );
  });

  it("keeps two same-named clients apart when their GSTINs differ", () => {
    expect(
      clientGroupKey({ billTo: "Sharma Associates", billToGstin: NOVA_GSTIN })
    ).not.toBe(
      clientGroupKey({ billTo: "Sharma Associates", billToGstin: OTHER_GSTIN })
    );
  });

  it("groups one client across case and spacing differences in the email", () => {
    expect(
      clientGroupKey({ billTo: "Nova", billToEmail: "  Accounts@Nova.IN " })
    ).toBe(clientGroupKey({ billTo: "Nova Health", billToEmail: "accounts@nova.in" }));
  });

  it("namespaces the key so a name cannot collide with an email", () => {
    expect(clientGroupKey({ billTo: "accounts@nova.in" })).not.toBe(
      clientGroupKey({ billTo: "x", billToEmail: "accounts@nova.in" })
    );
  });

  it("normalizeClientName drops punctuation and collapses runs of spaces", () => {
    expect(normalizeClientName("  Nova.,  Health   Pvt. Ltd.  ")).toBe(
      "nova health pvt ltd"
    );
    expect(normalizeClientName(undefined)).toBe("");
  });
});

describe("clientKeyExpression agrees with clientGroupKey", () => {
  const cases: Doc[] = [
    {},
    { billTo: "Nova Health Pvt Ltd" },
    { billTo: "Nova Health Pvt. Ltd." },
    { billTo: "nova   health pvt ltd" },
    { billTo: "Nova Health, Pvt Ltd" },
    { billTo: "  spaced  out  " },
    { billTo: "Nova", billToEmail: "  Accounts@Nova.IN " },
    { billTo: "Nova", billToEmail: "", billToGstin: "" },
    { billTo: "Nova", billToEmail: "a@b.in", billToGstin: NOVA_GSTIN },
    { billTo: "Nova", billToGstin: " 29aagcb7383j1z4 " },
    { billTo: "Nova", billToGstin: "29AAGCB7383J" },
    { billTo: null, billToEmail: null, billToGstin: null },
  ];

  for (const doc of cases) {
    it(`matches for ${JSON.stringify(doc)}`, () => {
      expect(keyInMongo(doc)).toBe(
        clientGroupKey(
          doc as {
            billTo?: string | null;
            billToEmail?: string | null;
            billToGstin?: string | null;
          }
        )
      );
    });
  }
});

/* -------------------------------------------------------------------------- */
/* The pipeline's shape                                                       */
/* -------------------------------------------------------------------------- */

const stageNamed = (pipeline: Record<string, unknown>[], name: string) =>
  pipeline.filter((stage) => Object.keys(stage)[0] === name);

describe("buildClientDirectoryPipeline", () => {
  const pipeline = buildClientDirectoryPipeline({
    userId: "user-A",
    skip: 0,
    limit: 25,
  });

  it("scopes to the tenant and excludes soft-deleted invoices in the FIRST stage", () => {
    // First stage specifically: any later stage that forgot these would already
    // have read another user's rows.
    expect(pipeline[0]).toEqual({
      $match: {
        userId: "user-A",
        is_deleted: { $ne: true },
        billTo: { $type: "string", $ne: "" },
      },
    });
  });

  it("bounds the scan BEFORE grouping, not just the output", () => {
    const limits = stageNamed(pipeline, "$limit");
    const groupIndex = pipeline.findIndex((stage) => "$group" in stage);
    const scanLimitIndex = pipeline.findIndex(
      (stage) => (stage as { $limit?: number }).$limit === MAX_INVOICES_SCANNED
    );
    expect(scanLimitIndex).toBeGreaterThan(-1);
    expect(scanLimitIndex).toBeLessThan(groupIndex);
    expect(limits.map((stage) => (stage as { $limit: number }).$limit)).toContain(
      MAX_CLIENTS
    );
  });

  it("returns the page and the count from one round trip", () => {
    const facet = pipeline[pipeline.length - 1] as {
      $facet: { rows: unknown[]; total: unknown[] };
    };
    expect(facet.$facet.rows).toEqual([{ $skip: 0 }, { $limit: 25 }]);
    expect(facet.$facet.total).toEqual([{ $count: "value" }]);
  });

  it("adds no search stage when there is no query", () => {
    expect(pipeline.filter((stage) => "$match" in stage)).toHaveLength(1);
  });

  it("escapes search text before it reaches a regex", () => {
    const withSearch = buildClientDirectoryPipeline({
      userId: "user-A",
      skip: 0,
      limit: 25,
      search: "a.b*c(",
    });
    const searchStage = withSearch.filter((stage) => "$match" in stage)[1] as {
      $match: { $or: { [key: string]: { $regex: string } }[] };
    };
    for (const clause of searchStage.$match.$or) {
      const [field] = Object.keys(clause);
      expect(clause[field].$regex).toBe("a\\.b\\*c\\(");
    }
  });

  it("caps the search text length", () => {
    const withSearch = buildClientDirectoryPipeline({
      userId: "user-A",
      skip: 0,
      limit: 25,
      search: "x".repeat(500),
    });
    const searchStage = withSearch.filter((stage) => "$match" in stage)[1] as {
      $match: { $or: { name: { $regex: string } }[] };
    };
    expect(searchStage.$match.$or[0].name.$regex.length).toBe(80);
  });
});

describe("serializeClientRow", () => {
  it("normalises a well-formed row", () => {
    expect(
      serializeClientRow({
        key: "gstin:X",
        name: "  Nova Health  ",
        email: "a@b.in",
        address: "Mumbai",
        gstin: NOVA_GSTIN,
        currency: "USD",
        invoiceCount: 4,
        lastInvoiceDate: new Date("2026-07-01T00:00:00.000Z"),
        lastInvoiceNumber: "INV/2026-27/004",
      })
    ).toEqual({
      key: "gstin:X",
      name: "Nova Health",
      email: "a@b.in",
      address: "Mumbai",
      gstin: NOVA_GSTIN,
      currency: "USD",
      invoiceCount: 4,
      lastInvoiceDate: "2026-07-01T00:00:00.000Z",
      lastInvoiceNumber: "INV/2026-27/004",
    });
  });

  it("never throws on a malformed row", () => {
    expect(serializeClientRow({})).toEqual({
      key: "",
      name: "",
      email: "",
      address: "",
      gstin: "",
      currency: "INR",
      invoiceCount: 0,
      lastInvoiceDate: "",
      lastInvoiceNumber: "",
    });
    expect(
      serializeClientRow({ lastInvoiceDate: "not a date", invoiceCount: NaN })
        .lastInvoiceDate
    ).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/* The route                                                                  */
/* -------------------------------------------------------------------------- */

// The logged-in user is always "A". Same shape as tests/invoices-isolation:
// the factory SPREADS the real module, because Bun's mock.module is process-
// global and replaces the whole module — a partial factory makes every other
// export vanish for every suite that runs after this one.
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

/**
 * An in-memory Invoice that RUNS the tenant filter for real: `aggregate` reads
 * the pipeline's own `$match` stage and applies it to the store, then does the
 * grouping in JavaScript through `clientGroupKey`. So "user A never sees user
 * B's clients" is asserted on the pipeline the route actually built, not on a
 * stub that was told the right answer.
 */
const store: Doc[] = [];
const pipelines: Record<string, unknown>[][] = [];

const matchesFilter = (doc: Doc, filter: Doc): boolean => {
  for (const [key, condition] of Object.entries(filter)) {
    const value = doc[key];
    if (condition && typeof condition === "object" && !Array.isArray(condition)) {
      const spec = condition as Record<string, unknown>;
      if ("$ne" in spec && (value ?? false) === spec.$ne) return false;
      if ("$type" in spec && spec.$type === "string" && typeof value !== "string")
        return false;
      continue;
    }
    if (value !== condition) return false;
  }
  return true;
};

class FakeInvoice {
  static async aggregate(pipeline: Record<string, unknown>[]) {
    pipelines.push(pipeline);
    const match = (pipeline[0] as { $match: Doc }).$match;
    const facet = pipeline[pipeline.length - 1] as {
      $facet: { rows: { $skip?: number; $limit?: number }[] };
    };
    const skip = facet.$facet.rows[0].$skip ?? 0;
    const limit = facet.$facet.rows[1].$limit ?? 50;

    const grouped = new Map<string, Doc>();
    for (const doc of store) {
      if (!matchesFilter(doc, match)) continue;
      const key = clientGroupKey(
        doc as { billTo?: string; billToEmail?: string; billToGstin?: string }
      );
      const existing = grouped.get(key);
      if (existing) {
        existing.invoiceCount = (existing.invoiceCount as number) + 1;
        continue;
      }
      grouped.set(key, {
        key,
        name: doc.billTo,
        email: doc.billToEmail ?? "",
        address: doc.billToAddress ?? "",
        gstin: doc.billToGstin ?? "",
        currency: doc.currency ?? "INR",
        invoiceCount: 1,
        lastInvoiceDate: doc.invoiceDate,
        lastInvoiceNumber: doc.invoiceNumber ?? "",
      });
    }

    const rows = [...grouped.values()];
    return [
      {
        rows: rows.slice(skip, skip + limit),
        total: [{ value: rows.length }],
      },
    ];
  }

  static async countDocuments(filter: Doc) {
    return store.filter((doc) => matchesFilter(doc, filter)).length;
  }
}

mock.module("@/models/Invoice", () => ({ default: FakeInvoice }));

const { GET } = await import("@/app/api/clients/route");

const makeReq = (url: string) =>
  ({
    url,
    headers: { get: () => null },
    json: async () => ({}),
  }) as unknown as import("next/server").NextRequest;

beforeEach(() => {
  store.length = 0;
  pipelines.length = 0;
  store.push(
    {
      userId: "A",
      is_deleted: false,
      billTo: "Nova Health Pvt Ltd",
      billToEmail: "accounts@novahealth.in",
      billToAddress: "Mumbai",
      billToGstin: NOVA_GSTIN,
      invoiceNumber: "INV/2026-27/001",
      invoiceDate: new Date("2026-05-01T00:00:00.000Z"),
      currency: "INR",
    },
    {
      userId: "A",
      is_deleted: false,
      billTo: "Nova Health Pvt. Ltd.",
      billToEmail: "accounts@novahealth.in",
      billToGstin: NOVA_GSTIN,
      invoiceNumber: "INV/2026-27/002",
      invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
      currency: "INR",
    },
    {
      userId: "A",
      is_deleted: true,
      billTo: "Deleted Client Ltd",
      invoiceNumber: "INV/2026-27/003",
      invoiceDate: new Date("2026-06-15T00:00:00.000Z"),
    },
    {
      userId: "B",
      is_deleted: false,
      billTo: "Other User's Client",
      billToEmail: "someone@else.example",
      invoiceNumber: "B-1",
      invoiceDate: new Date("2026-06-20T00:00:00.000Z"),
    }
  );
});

describe("GET /api/clients", () => {
  it("returns only the caller's own clients", async () => {
    const res = await GET(makeReq("http://x/api/clients"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { clients: { name: string }[] };
    const names = body.clients.map((client) => client.name);
    expect(names).toContain("Nova Health Pvt Ltd");
    expect(names).not.toContain("Other User's Client");
  });

  it("ignores a userId supplied in the query string", async () => {
    const res = await GET(makeReq("http://x/api/clients?userId=B&q="));
    const body = (await res.json()) as { clients: { name: string }[] };
    expect(body.clients.map((client) => client.name)).not.toContain(
      "Other User's Client"
    );
    expect((pipelines[0][0] as { $match: { userId: string } }).$match.userId).toBe(
      "A"
    );
  });

  it("excludes soft-deleted invoices", async () => {
    const res = await GET(makeReq("http://x/api/clients"));
    const body = (await res.json()) as { clients: { name: string }[] };
    expect(body.clients.map((client) => client.name)).not.toContain(
      "Deleted Client Ltd"
    );
  });

  it("merges two spellings of one client into a single row", async () => {
    const res = await GET(makeReq("http://x/api/clients"));
    const body = (await res.json()) as {
      clients: { name: string; invoiceCount: number }[];
      total: number;
    };
    expect(body.clients).toHaveLength(1);
    expect(body.clients[0].invoiceCount).toBe(2);
    expect(body.total).toBe(1);
  });

  it("clamps the requested page size", async () => {
    await GET(makeReq("http://x/api/clients?limit=9999"));
    const facet = pipelines[0][pipelines[0].length - 1] as {
      $facet: { rows: { $limit?: number }[] };
    };
    expect(facet.$facet.rows[1].$limit).toBe(100);
  });

  it("reports truncation only once the scan window is full", async () => {
    const res = await GET(makeReq("http://x/api/clients"));
    const body = (await res.json()) as { truncated: boolean; hasMore: boolean };
    expect(body.truncated).toBe(false);
    expect(body.hasMore).toBe(false);
  });
});
