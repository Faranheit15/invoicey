import { describe, it, expect } from "bun:test";
import {
  INVOICE_PAGE_SIZE,
  INVOICE_SORT_OPTIONS,
  buildInvoiceListQuery,
  defaultInvoiceListState,
  isInvoiceListFiltered,
  matchesInvoiceSearch,
  matchesInvoiceStatus,
  parseSortToken,
  selectInvoicePage,
  sortInvoices,
  sortToken,
} from "@/lib/dashboard-query";
import type { InvoiceRecord } from "@/lib/invoices";

const TODAY = "2026-08-17";

type Row = Partial<InvoiceRecord>;

const row = (overrides: Row = {}): Row => ({
  _id: "1",
  invoiceNumber: "INV-001",
  billTo: "Nova Health Pvt Ltd",
  billToEmail: "ap@novahealth.example",
  status: "sent",
  dueDate: "2026-09-01",
  invoiceDate: "2026-08-01",
  createdAt: "2026-08-01T10:00:00.000Z",
  total: 1000,
  currency: "INR",
  ...overrides,
});

describe("buildInvoiceListQuery", () => {
  it("always sends page, limit, sort and order", () => {
    expect(buildInvoiceListQuery()).toEqual({
      page: 1,
      limit: INVOICE_PAGE_SIZE,
      sort: "createdAt",
      order: "desc",
    });
  });

  it("omits an empty search and an empty status rather than sending blanks", () => {
    const query = buildInvoiceListQuery({ search: "   ", status: "" });
    expect(query.q).toBeUndefined();
    expect(query.status).toBeUndefined();
  });

  it("trims the search term", () => {
    expect(buildInvoiceListQuery({ search: "  nova  " }).q).toBe("nova");
  });

  it("includes the status filter when one is set", () => {
    expect(buildInvoiceListQuery({ status: "overdue" }).status).toBe("overdue");
  });

  it("floors and clamps the page — page 0 and page -3 are page 1", () => {
    expect(buildInvoiceListQuery({ page: 0 }).page).toBe(1);
    expect(buildInvoiceListQuery({ page: -3 }).page).toBe(1);
    expect(buildInvoiceListQuery({ page: 2.9 }).page).toBe(2);
  });

  it("carries a custom page size through as `limit`", () => {
    expect(buildInvoiceListQuery({ pageSize: 10 }).limit).toBe(10);
  });
});

describe("sort tokens", () => {
  it("round-trips every advertised option", () => {
    for (const option of INVOICE_SORT_OPTIONS) {
      expect(sortToken(option.field, option.order)).toBe(option.value);
      expect(parseSortToken(option.value)).toEqual({
        field: option.field,
        order: option.order,
      });
    }
  });

  it("falls back to the default for an unknown token", () => {
    expect(parseSortToken("chaos:sideways")).toEqual({
      field: "createdAt",
      order: "desc",
    });
  });
});

describe("matchesInvoiceSearch", () => {
  it("matches the client name, case-insensitively", () => {
    expect(matchesInvoiceSearch(row(), "nova")).toBe(true);
    expect(matchesInvoiceSearch(row(), "NOVA HEALTH")).toBe(true);
  });

  it("matches the invoice number and the client email", () => {
    expect(matchesInvoiceSearch(row(), "inv-001")).toBe(true);
    expect(matchesInvoiceSearch(row(), "novahealth.example")).toBe(true);
  });

  it("does not match notes or terms — a boilerplate note would match everything", () => {
    expect(
      matchesInvoiceSearch(row({ notes: "Thanks for your business" }), "thanks")
    ).toBe(false);
  });

  it("an empty or whitespace query matches everything", () => {
    expect(matchesInvoiceSearch(row(), "")).toBe(true);
    expect(matchesInvoiceSearch(row(), "   ")).toBe(true);
  });

  it("returns false for a genuine miss", () => {
    expect(matchesInvoiceSearch(row(), "acme")).toBe(false);
  });
});

describe("matchesInvoiceStatus", () => {
  it("filters on the DERIVED status, so 'overdue' actually finds something", () => {
    // The write path never stores "overdue", so a stored-status filter would
    // return nothing here. This is the whole reason the filter is derived.
    const past = row({ status: "sent", dueDate: "2026-08-01" });
    expect(matchesInvoiceStatus(past, "overdue", TODAY)).toBe(true);
    expect(matchesInvoiceStatus(past, "sent", TODAY)).toBe(false);
  });

  it("keeps 'sent' and 'overdue' mutually exclusive", () => {
    const notYetDue = row({ status: "sent", dueDate: "2026-09-01" });
    expect(matchesInvoiceStatus(notYetDue, "sent", TODAY)).toBe(true);
    expect(matchesInvoiceStatus(notYetDue, "overdue", TODAY)).toBe(false);
  });

  it("never calls a paid invoice overdue", () => {
    const paid = row({ status: "paid", dueDate: "2020-01-01" });
    expect(matchesInvoiceStatus(paid, "overdue", TODAY)).toBe(false);
    expect(matchesInvoiceStatus(paid, "paid", TODAY)).toBe(true);
  });

  it("an empty filter matches everything", () => {
    expect(matchesInvoiceStatus(row({ status: "draft" }), "", TODAY)).toBe(true);
  });
});

describe("sortInvoices", () => {
  const rows = [
    row({ _id: "a", total: 300, billTo: "Cortex", createdAt: "2026-01-03" }),
    row({ _id: "b", total: 100, billTo: "apex", createdAt: "2026-01-01" }),
    row({ _id: "c", total: 200, billTo: "Beacon", createdAt: "2026-01-02" }),
  ];

  it("sorts numerically by total, both directions", () => {
    expect(sortInvoices(rows, "total", "asc").map((r) => r._id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(sortInvoices(rows, "total", "desc").map((r) => r._id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("sorts client names case-insensitively", () => {
    expect(sortInvoices(rows, "billTo", "asc").map((r) => r._id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("sorts dates chronologically, not as strings", () => {
    const dated = [
      row({ _id: "a", dueDate: "2026-09-02" }),
      row({ _id: "b", dueDate: "2026-10-01" }),
      row({ _id: "c", dueDate: "2026-08-30" }),
    ];
    expect(sortInvoices(dated, "dueDate", "asc").map((r) => r._id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("clusters missing and unparseable dates at one end instead of scattering", () => {
    const dated = [
      row({ _id: "a", dueDate: "2026-09-02" }),
      row({ _id: "b", dueDate: undefined }),
      row({ _id: "c", dueDate: "nonsense" }),
    ];
    expect(sortInvoices(dated, "dueDate", "asc").map((r) => r._id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("is stable: equal keys keep their incoming order", () => {
    const tied = [
      row({ _id: "a", total: 5 }),
      row({ _id: "b", total: 5 }),
      row({ _id: "c", total: 5 }),
    ];
    expect(sortInvoices(tied, "total", "desc").map((r) => r._id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("does not mutate its input", () => {
    const input = [row({ _id: "a", total: 1 }), row({ _id: "b", total: 2 })];
    sortInvoices(input, "total", "desc");
    expect(input.map((r) => r._id)).toEqual(["a", "b"]);
  });
});

describe("selectInvoicePage", () => {
  const many = Array.from({ length: 57 }, (_, index) =>
    row({
      _id: String(index),
      invoiceNumber: `INV-${String(index).padStart(3, "0")}`,
      total: index,
      createdAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
    })
  );

  it("returns one page and the full matching total", () => {
    const page = selectInvoicePage(many, { pageSize: 25, page: 1 }, TODAY);
    expect(page.data).toHaveLength(25);
    expect(page.total).toBe(57);
    expect(page.pageCount).toBe(3);
  });

  it("returns the remainder on the last page", () => {
    const page = selectInvoicePage(many, { pageSize: 25, page: 3 }, TODAY);
    expect(page.data).toHaveLength(7);
    expect(page.page).toBe(3);
  });

  it("clamps a page past the end rather than showing an empty table", () => {
    // The case: you are on page 3, you delete the last few invoices, and the
    // list refetches. Returning an empty page 3 with no way back is the bug.
    const page = selectInvoicePage(many, { pageSize: 25, page: 99 }, TODAY);
    expect(page.page).toBe(3);
    expect(page.data).toHaveLength(7);
  });

  it("clamps page 0 to page 1", () => {
    expect(selectInvoicePage(many, { page: 0 }, TODAY).page).toBe(1);
  });

  it("reports at least one page for an empty result", () => {
    const page = selectInvoicePage([], {}, TODAY);
    expect(page.total).toBe(0);
    expect(page.pageCount).toBe(1);
    expect(page.data).toEqual([]);
  });

  it("filters before it paginates", () => {
    const page = selectInvoicePage(many, { search: "INV-00", pageSize: 25 }, TODAY);
    expect(page.total).toBe(10);
    expect(page.data).toHaveLength(10);
  });

  it("applies search and status together", () => {
    const mixed = [
      row({ _id: "a", billTo: "Nova", status: "paid" }),
      row({ _id: "b", billTo: "Nova", status: "sent", dueDate: "2026-09-01" }),
      row({
        _id: "c",
        billTo: "Acme",
        billToEmail: "ap@acme.example",
        status: "sent",
        dueDate: "2026-09-01",
      }),
    ];
    const page = selectInvoicePage(mixed, { search: "nova", status: "sent" }, TODAY);
    expect(page.data.map((r) => r._id)).toEqual(["b"]);
  });

  it("sorts the filtered set, not the page", () => {
    const page = selectInvoicePage(
      many,
      { sort: "total", order: "desc", pageSize: 5, page: 1 },
      TODAY
    );
    expect(page.data.map((r) => r.total)).toEqual([56, 55, 54, 53, 52]);
  });

  it("defaults to newest-first, matching the current dashboard order", () => {
    const state = defaultInvoiceListState();
    expect(state.sort).toBe("createdAt");
    expect(state.order).toBe("desc");
    const page = selectInvoicePage(many, {}, TODAY);
    expect(page.data[0]._id).toBe("56");
  });
});

describe("isInvoiceListFiltered", () => {
  it("is false for the default state and true once anything narrows it", () => {
    expect(isInvoiceListFiltered(defaultInvoiceListState())).toBe(false);
    expect(isInvoiceListFiltered({ search: "  " })).toBe(false);
    expect(isInvoiceListFiltered({ search: "nova" })).toBe(true);
    expect(isInvoiceListFiltered({ status: "paid" })).toBe(true);
  });
});
