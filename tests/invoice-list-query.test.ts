import { describe, it, expect } from "bun:test";
import {
  buildInvoiceListFilter,
  parseInvoiceListSort,
} from "@/lib/server/invoice-list-query";

const NOW = new Date("2026-08-17T09:30:00.000Z");
const TODAY_UTC = new Date("2026-08-17T00:00:00.000Z");

const params = (query: string) => new URLSearchParams(query);
const filter = (query: string, userId = "uid-1") =>
  buildInvoiceListFilter({ userId, searchParams: params(query), now: NOW });

describe("parseInvoiceListSort", () => {
  it("defaults to newest first, the order the dashboard already shows", () => {
    expect(parseInvoiceListSort(params(""))).toEqual({
      spec: { createdAt: -1, _id: -1 },
      field: "createdAt",
      order: "desc",
    });
  });

  it("honours every allowlisted field", () => {
    for (const field of [
      "createdAt",
      "invoiceDate",
      "dueDate",
      "total",
      "invoiceNumber",
      "billTo",
    ] as const) {
      expect(parseInvoiceListSort(params(`sort=${field}&order=asc`)).field).toBe(field);
    }
  });

  it("falls back to the default for a field not on the allowlist", () => {
    // An arbitrary `sort` reaching `.sort()` is a free unindexed scan per request.
    expect(parseInvoiceListSort(params("sort=companyAddress")).field).toBe("createdAt");
    expect(parseInvoiceListSort(params("sort[$ne]=1")).field).toBe("createdAt");
  });

  it("treats any order but 'asc' as descending", () => {
    expect(parseInvoiceListSort(params("order=asc")).order).toBe("asc");
    expect(parseInvoiceListSort(params("order=desc")).order).toBe("desc");
    expect(parseInvoiceListSort(params("order=sideways")).order).toBe("desc");
  });

  it("always adds an _id tiebreak so paging cannot drop a row", () => {
    // Two invoices created in the same millisecond can otherwise swap between
    // page 1 and page 2, and one of them is never shown.
    expect(parseInvoiceListSort(params("sort=total&order=asc")).spec).toEqual({
      total: 1,
      _id: 1,
    });
  });
});

describe("buildInvoiceListFilter — scoping", () => {
  it("always scopes to the user and excludes soft deletes", () => {
    expect(filter("")).toEqual({ userId: "uid-1", is_deleted: { $ne: true } });
  });

  it("keeps the tenant scope when a filter is added", () => {
    const built = filter("status=paid") as { $and: Record<string, unknown>[] };
    expect(built.$and[0]).toEqual({ userId: "uid-1", is_deleted: { $ne: true } });
  });

  it("never lets a query parameter override the scope", () => {
    const built = filter("userId=someone-else&is_deleted=false") as Record<
      string,
      unknown
    >;
    expect(built).toEqual({ userId: "uid-1", is_deleted: { $ne: true } });
  });
});

describe("buildInvoiceListFilter — status", () => {
  it("matches paid and draft on the stored value", () => {
    const built = filter("status=paid") as { $and: Record<string, unknown>[] };
    expect(built.$and[1]).toEqual({ status: "paid" });
  });

  it("reconstructs overdue, because nothing is ever stored as overdue", () => {
    const built = filter("status=overdue") as { $and: Record<string, unknown>[] };
    expect(built.$and[1]).toEqual({
      $or: [
        { status: "overdue" },
        {
          status: { $nin: ["paid", "draft", "overdue"] },
          dueDate: { $lt: TODAY_UTC },
        },
      ],
    });
  });

  it("excludes aged invoices from 'sent', so the two filters do not overlap", () => {
    const built = filter("status=sent") as { $and: Record<string, unknown>[] };
    expect(built.$and[1]).toEqual({
      $and: [
        { status: "sent" },
        {
          $or: [
            { dueDate: { $gte: TODAY_UTC } },
            { dueDate: null },
            { dueDate: { $exists: false } },
          ],
        },
      ],
    });
  });

  it("measures 'past due' from UTC midnight, not from the request instant", () => {
    // Otherwise an invoice due today would count as overdue from 00:00:01.
    const built = filter("status=overdue") as { $and: Record<string, unknown>[] };
    const clause = built.$and[1] as { $or: { dueDate?: { $lt: Date } }[] };
    expect(clause.$or[1].dueDate?.$lt.toISOString()).toBe("2026-08-17T00:00:00.000Z");
  });

  it("ignores an unrecognised status rather than returning nothing", () => {
    expect(filter("status=cancelled")).toEqual({
      userId: "uid-1",
      is_deleted: { $ne: true },
    });
  });
});

describe("buildInvoiceListFilter — search", () => {
  it("searches invoice number, client name and client email", () => {
    const built = filter("q=nova") as { $and: Record<string, unknown>[] };
    const clause = built.$and[1] as { $or: Record<string, RegExp>[] };
    expect(Object.keys(clause.$or[0])).toEqual(["invoiceNumber"]);
    expect(Object.keys(clause.$or[1])).toEqual(["billTo"]);
    expect(Object.keys(clause.$or[2])).toEqual(["billToEmail"]);
    expect(clause.$or[1].billTo.flags).toContain("i");
    expect("Nova Health".match(clause.$or[1].billTo)).not.toBeNull();
  });

  it("escapes regex metacharacters instead of executing them", () => {
    // ".*" unescaped matches every invoice the user has; "(a+)+" is a ReDoS.
    const built = filter("q=.*") as { $and: Record<string, unknown>[] };
    const clause = built.$and[1] as { $or: Record<string, RegExp>[] };
    expect(clause.$or[1].billTo.source).toBe("\\.\\*");
    expect("Nova Health".match(clause.$or[1].billTo)).toBeNull();
    expect(".*".match(clause.$or[1].billTo)).not.toBeNull();
  });

  it("ignores an empty or whitespace-only query", () => {
    expect(filter("q=")).toEqual({ userId: "uid-1", is_deleted: { $ne: true } });
    expect(filter("q=%20%20")).toEqual({ userId: "uid-1", is_deleted: { $ne: true } });
  });

  it("caps the search term so a megabyte of regex cannot be submitted", () => {
    const long = "a".repeat(500);
    const built = filter(`q=${long}`) as { $and: Record<string, unknown>[] };
    const clause = built.$and[1] as { $or: Record<string, RegExp>[] };
    expect(clause.$or[1].billTo.source).toHaveLength(120);
  });

  it("combines status and search as separate AND clauses", () => {
    const built = filter("status=paid&q=nova") as { $and: unknown[] };
    expect(built.$and).toHaveLength(3);
  });
});
