import { describe, it, expect } from "bun:test";
import {
  AGING_BUCKETS,
  agingBucketFor,
  agingBucketForDays,
  daysPastDue,
  isInvoiceOverdue,
  isReceivable,
  resolveDisplayStatus,
  summarizeAging,
  type AgeableInvoice,
} from "@/lib/invoice-status";

/**
 * "Today" for every case below. A fixed date, never `new Date()`: the whole
 * point of these tests is the day boundary, and a test that reads the clock
 * fails once a year at midnight for reasons nobody can reproduce.
 */
const TODAY = "2026-08-17";
const YESTERDAY = "2026-08-16";
const TOMORROW = "2026-08-18";

const invoice = (overrides: AgeableInvoice = {}): AgeableInvoice => ({
  status: "sent",
  dueDate: TODAY,
  ...overrides,
});

describe("daysPastDue", () => {
  it("is 0 on the due date itself", () => {
    expect(daysPastDue(invoice({ dueDate: TODAY }), TODAY)).toBe(0);
  });

  it("is 1 the day after the due date", () => {
    expect(daysPastDue(invoice({ dueDate: YESTERDAY }), TODAY)).toBe(1);
  });

  it("is negative before the due date", () => {
    expect(daysPastDue(invoice({ dueDate: TOMORROW }), TODAY)).toBe(-1);
  });

  it("distinguishes 'no due date' (null) from 'due today' (0)", () => {
    expect(daysPastDue(invoice({ dueDate: undefined }), TODAY)).toBeNull();
    expect(daysPastDue(invoice({ dueDate: "" }), TODAY)).toBeNull();
    expect(daysPastDue(invoice({ dueDate: null }), TODAY)).toBeNull();
    expect(daysPastDue(invoice({ dueDate: TODAY }), TODAY)).toBe(0);
  });

  it("returns null for an unparseable date rather than NaN", () => {
    expect(daysPastDue(invoice({ dueDate: "not a date" }), TODAY)).toBeNull();
    expect(daysPastDue(invoice({ dueDate: "2026-02-31" }), TODAY)).toBeNull();
  });

  it("counts across a month and a year boundary", () => {
    expect(daysPastDue(invoice({ dueDate: "2026-07-31" }), "2026-08-01")).toBe(1);
    expect(daysPastDue(invoice({ dueDate: "2025-12-31" }), "2026-01-01")).toBe(1);
    // 2028 is a leap year: 29 Feb exists, so 1 Mar is one day past it.
    expect(daysPastDue(invoice({ dueDate: "2028-02-29" }), "2028-03-01")).toBe(1);
  });

  it("reads a Mongo round-tripped midnight-UTC value as its own calendar date", () => {
    // The bug this guards: treating the instant as local time renders (and
    // compares) the previous day for anyone west of Greenwich.
    expect(
      daysPastDue(invoice({ dueDate: "2026-08-16T00:00:00.000Z" }), TODAY)
    ).toBe(1);
  });
});

describe("isInvoiceOverdue", () => {
  it("is false on the due date and true the day after", () => {
    expect(isInvoiceOverdue(invoice({ dueDate: TODAY }), TODAY)).toBe(false);
    expect(isInvoiceOverdue(invoice({ dueDate: YESTERDAY }), TODAY)).toBe(true);
  });

  it("is false with no due date", () => {
    expect(isInvoiceOverdue(invoice({ dueDate: undefined }), TODAY)).toBe(false);
  });

  it("is false for a paid invoice however old — money collected cannot age", () => {
    expect(
      isInvoiceOverdue({ status: "paid", dueDate: "2020-01-01" }, TODAY)
    ).toBe(false);
  });

  it("is false for a draft — nobody has been asked to pay it yet", () => {
    expect(
      isInvoiceOverdue({ status: "draft", dueDate: "2020-01-01" }, TODAY)
    ).toBe(false);
  });

  it("is false for a soft-deleted invoice — a cancelled document is not a receivable", () => {
    expect(
      isInvoiceOverdue(
        { status: "sent", dueDate: "2020-01-01", is_deleted: true },
        TODAY
      )
    ).toBe(false);
  });

  it("is true for an invoice with no stored status at all (pre-migration document)", () => {
    expect(isInvoiceOverdue({ dueDate: YESTERDAY }, TODAY)).toBe(true);
  });
});

describe("isReceivable", () => {
  it("excludes paid, draft and deleted; includes sent and overdue", () => {
    expect(isReceivable({ status: "paid" })).toBe(false);
    expect(isReceivable({ status: "draft" })).toBe(false);
    expect(isReceivable({ status: "sent", is_deleted: true })).toBe(false);
    expect(isReceivable({ status: "sent" })).toBe(true);
    expect(isReceivable({ status: "overdue" })).toBe(true);
    expect(isReceivable({})).toBe(true);
  });
});

describe("resolveDisplayStatus", () => {
  it("promotes a past-due sent invoice to overdue", () => {
    expect(resolveDisplayStatus(invoice({ dueDate: YESTERDAY }), TODAY)).toBe(
      "overdue"
    );
  });

  it("leaves a sent invoice due today alone", () => {
    expect(resolveDisplayStatus(invoice({ dueDate: TODAY }), TODAY)).toBe("sent");
  });

  it("never promotes paid or draft", () => {
    expect(
      resolveDisplayStatus({ status: "paid", dueDate: "2020-01-01" }, TODAY)
    ).toBe("paid");
    expect(
      resolveDisplayStatus({ status: "draft", dueDate: "2020-01-01" }, TODAY)
    ).toBe("draft");
  });

  it("honours a stored overdue even with a future due date — the user said so", () => {
    expect(
      resolveDisplayStatus({ status: "overdue", dueDate: TOMORROW }, TODAY)
    ).toBe("overdue");
  });

  it("falls back to 'sent' for a document with no stored status", () => {
    expect(resolveDisplayStatus({ dueDate: TOMORROW }, TODAY)).toBe("sent");
  });

  it("does not promote a deleted invoice", () => {
    expect(
      resolveDisplayStatus(
        { status: "sent", dueDate: "2020-01-01", is_deleted: true },
        TODAY
      )
    ).toBe("sent");
  });
});

describe("agingBucketForDays", () => {
  it("puts everything not yet past due in 'current', including no due date", () => {
    expect(agingBucketForDays(null)).toBe("current");
    expect(agingBucketForDays(-5)).toBe("current");
    expect(agingBucketForDays(0)).toBe("current");
  });

  it("holds the bucket boundaries exactly", () => {
    expect(agingBucketForDays(1)).toBe("1-30");
    expect(agingBucketForDays(30)).toBe("1-30");
    expect(agingBucketForDays(31)).toBe("31-60");
    expect(agingBucketForDays(60)).toBe("31-60");
    expect(agingBucketForDays(61)).toBe("60+");
    expect(agingBucketForDays(3650)).toBe("60+");
  });

  it("covers every day count with exactly one bucket", () => {
    for (let days = -5; days <= 120; days += 1) {
      const key = agingBucketForDays(days);
      const matching = AGING_BUCKETS.filter(
        (bucket) =>
          days >= bucket.minDays && (bucket.maxDays === null || days <= bucket.maxDays)
      );
      expect(matching).toHaveLength(1);
      expect(matching[0].key).toBe(key);
    }
  });
});

describe("agingBucketFor", () => {
  it("buckets a receivable by how late it is", () => {
    expect(agingBucketFor(invoice({ dueDate: "2026-07-18" }), TODAY)).toBe("1-30");
    expect(agingBucketFor(invoice({ dueDate: "2026-07-17" }), TODAY)).toBe("31-60");
    expect(agingBucketFor(invoice({ dueDate: "2026-06-17" }), TODAY)).toBe("60+");
  });

  it("calls anything not receivable 'current' — it is not an outstanding balance", () => {
    expect(
      agingBucketFor({ status: "paid", dueDate: "2020-01-01" }, TODAY)
    ).toBe("current");
    expect(
      agingBucketFor({ status: "draft", dueDate: "2020-01-01" }, TODAY)
    ).toBe("current");
  });
});

describe("summarizeAging", () => {
  const ledger: AgeableInvoice[] = [
    { status: "sent", dueDate: TOMORROW, total: 100, currency: "INR" },
    { status: "sent", dueDate: YESTERDAY, total: 200, currency: "INR" },
    { status: "sent", dueDate: "2026-07-01", total: 400, currency: "INR" }, // 47 days
    { status: "sent", dueDate: "2026-01-01", total: 800, currency: "INR" }, // 228 days
    { status: "paid", dueDate: "2020-01-01", total: 9999, currency: "INR" },
    { status: "draft", dueDate: "2020-01-01", total: 9999, currency: "INR" },
    { status: "sent", dueDate: "2020-01-01", total: 9999, is_deleted: true },
    { status: "sent", dueDate: YESTERDAY, total: 50, currency: "USD" },
  ];

  it("counts and sums each bucket over receivables in one currency", () => {
    const report = summarizeAging(ledger, { now: TODAY, currency: "INR" });
    expect(report.map((bucket) => [bucket.key, bucket.count, bucket.amount])).toEqual([
      ["current", 1, 100],
      ["1-30", 1, 200],
      ["31-60", 1, 400],
      ["60+", 1, 800],
    ]);
  });

  it("excludes paid, draft and deleted rather than sweeping them into 'current'", () => {
    const report = summarizeAging(ledger, { now: TODAY, currency: "INR" });
    const total = report.reduce((sum, bucket) => sum + bucket.count, 0);
    expect(total).toBe(4);
  });

  it("excludes other currencies — summing INR and USD is meaningless", () => {
    const usd = summarizeAging(ledger, { now: TODAY, currency: "USD" });
    expect(usd.find((bucket) => bucket.key === "1-30")).toMatchObject({
      count: 1,
      amount: 50,
    });
  });

  it("always returns all four buckets, in ladder order, even when empty", () => {
    const report = summarizeAging([], { now: TODAY });
    expect(report.map((bucket) => bucket.key)).toEqual([
      "current",
      "1-30",
      "31-60",
      "60+",
    ]);
    expect(report.every((bucket) => bucket.count === 0 && bucket.amount === 0)).toBe(
      true
    );
  });

  it("treats a missing total as 0 rather than NaN", () => {
    const report = summarizeAging([{ status: "sent", dueDate: YESTERDAY }], {
      now: TODAY,
    });
    expect(report.find((bucket) => bucket.key === "1-30")?.amount).toBe(0);
  });
});
