import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildAgingRows,
  selectAgeableInvoices,
} from "@/components/dashboard/aging-summary";
import { AGING_BUCKETS } from "@/lib/invoice-status";
import type { InvoiceRecord } from "@/lib/invoices";

/**
 * The receivables ladder was built and tested in Phase 3 and then had NO
 * CALLER: `AGING_BUCKETS`, `agingBucketFor`, `summarizeAging` and friends were
 * exercised only by their own unit tests, so the product shipped a
 * fully-verified feature nobody could see. `docs/LAUNCH-PROGRESS.md` marked
 * "Derived overdue + aging buckets" done, and half of it was.
 *
 * These tests cover the surface that closes that gap: the dashboard card, its
 * two selection rules, and — last test in the file — the fact that the module
 * has a consumer outside `tests/` at all.
 */

const NOW = "2026-08-17";

const invoice = (over: Partial<InvoiceRecord>): InvoiceRecord =>
  ({
    _id: over._id ?? "id",
    userId: "u",
    companyName: "Acme",
    billTo: "Client",
    invoiceNumber: "INV-1",
    invoiceDate: "2026-01-01",
    dueDate: "2026-08-17",
    currency: "INR",
    items: [],
    convenienceCharge: 0,
    total: 1000,
    status: "sent",
    createdAt: "2026-01-01",
    ...over,
  }) as InvoiceRecord;

const amountOf = (rows: ReturnType<typeof buildAgingRows>, key: string) =>
  rows.find((row) => row.key === key)?.amount ?? 0;
const countOf = (rows: ReturnType<typeof buildAgingRows>, key: string) =>
  rows.find((row) => row.key === key)?.count ?? 0;

describe("dashboard ageing — the buckets a freelancer chases", () => {
  const rows = buildAgingRows(
    [
      // Due today: payment is due BY the end of today, so not yet late.
      invoice({ _id: "a", dueDate: "2026-08-17", total: 1000 }),
      invoice({ _id: "b", dueDate: "2026-08-10", total: 2000 }), // 7 days
      invoice({ _id: "c", dueDate: "2026-07-01", total: 4000 }), // 47 days
      invoice({ _id: "d", dueDate: "2026-01-01", total: 8000 }), // 228 days
      // Not receivables: banked, unissued, binned.
      invoice({ _id: "e", dueDate: "2026-01-01", total: 9999, status: "paid" }),
      invoice({ _id: "f", dueDate: "2026-01-01", total: 9999, status: "draft" }),
      invoice({ _id: "g", dueDate: "2026-01-01", total: 9999, is_deleted: true }),
    ],
    "INR",
    NOW
  );

  it("returns the standard ladder, in order", () => {
    expect(rows.map((row) => row.key)).toEqual(
      AGING_BUCKETS.map((bucket) => bucket.key)
    );
  });

  it("puts each unpaid invoice in the bucket for how late it is", () => {
    expect(amountOf(rows, "current")).toBe(1000);
    expect(amountOf(rows, "1-30")).toBe(2000);
    expect(amountOf(rows, "31-60")).toBe(4000);
    expect(amountOf(rows, "60+")).toBe(8000);
  });

  it("counts paid, draft and deleted invoices as nothing owed", () => {
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(4);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(15000);
  });
});

describe("dashboard ageing — what it refuses to count", () => {
  it("ages invoices only: a proforma is a quote, a credit note is a reduction", () => {
    const records = [
      invoice({ _id: "inv", dueDate: "2026-06-01", total: 5000 }),
      invoice({
        _id: "pro",
        dueDate: "2026-06-01",
        total: 90000,
        documentKind: "proforma",
      }),
      invoice({
        _id: "cn",
        dueDate: "2026-06-01",
        total: 70000,
        documentKind: "credit_note",
      }),
    ];
    expect(selectAgeableInvoices(records).map((r) => r._id)).toEqual(["inv"]);
    const rows = buildAgingRows(records, "INR", NOW);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(5000);
  });

  it("never sums two currencies into one figure", () => {
    const rows = buildAgingRows(
      [
        invoice({ _id: "inr", dueDate: "2026-06-01", total: 5000 }),
        invoice({
          _id: "usd",
          dueDate: "2026-06-01",
          total: 900,
          currency: "USD",
        }),
      ],
      "INR",
      NOW
    );
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(5000);
    expect(countOf(rows, "31-60") + countOf(rows, "60+")).toBe(1);
  });

  it("treats an invoice with no due date as current, not as late", () => {
    const rows = buildAgingRows(
      [invoice({ _id: "x", dueDate: "", total: 1200 })],
      "INR",
      NOW
    );
    expect(amountOf(rows, "current")).toBe(1200);
    expect(amountOf(rows, "60+")).toBe(0);
  });
});

/**
 * A SOURCE-LEVEL guard, for the same reason as the one in tests/invoices.test.ts:
 * there is no DOM harness in this repo, and the defect being prevented is not a
 * wrong number — it is a correct module with nobody rendering it.
 */
describe("the ageing ladder is actually on screen", () => {
  const read = (path: string) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

  it("is rendered by the dashboard, over the whole account", () => {
    const source = read("app/dashboard/page.tsx");
    expect(source).toContain("<AgingSummary");
    // The unpaginated read, not the current page: a bucket that changes when
    // you turn a page is worse than no bucket.
    expect(source).toContain("invoices={summaryInvoices}");
  });

  it("has a consumer outside tests/ — nothing tested may be dead", () => {
    const consumers = Bun.spawnSync(
      [
        "grep",
        "-rl",
        "--include=*.ts",
        "--include=*.tsx",
        "summarizeAging",
        "app",
        "components",
        "lib",
      ],
      { cwd: new URL("../", import.meta.url).pathname }
    )
      .stdout.toString()
      .split("\n")
      .filter(Boolean)
      // The module that defines it does not count as a use of it.
      .filter((file) => file !== "lib/invoice-status.ts");
    expect(consumers.length).toBeGreaterThan(0);
  });
});
