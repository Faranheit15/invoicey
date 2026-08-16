import { describe, it, expect, mock, beforeEach } from "bun:test";

// The quota's whole job is to bound spend, so what it counts has to be what
// costs money. Gemini bills for a call whose output then fails to parse, and
// those calls never reach the route's success log — so a quota counting
// successes would hand out unlimited billed failures to anyone able to provoke
// one. These pin that the reservation is taken BEFORE the provider call and
// survives the call failing.

interface Row {
  event: string;
  userId: string;
  at: Date;
}

const rows: Row[] = [];

mock.module("@/lib/mongodb", () => ({ default: async () => {} }));
mock.module("@/models/LogEntry", () => ({
  default: {
    countDocuments: async (filter: {
      userId: string;
      event: string;
      at: { $gte: Date };
    }) =>
      rows.filter(
        (row) =>
          row.userId === filter.userId &&
          row.event === filter.event &&
          row.at >= filter.at.$gte
      ).length,
    create: async (doc: Row) => {
      rows.push({ event: doc.event, userId: doc.userId, at: doc.at });
      return doc;
    },
  },
}));

const { reserveDailyAiQuota, QUOTA_EVENT } = await import(
  "@/lib/ai/invoice-assistant/quota"
);

describe("reserveDailyAiQuota", () => {
  beforeEach(() => {
    rows.length = 0;
    process.env.INVOICE_AI_DAILY_LIMIT = "3";
  });

  it("consumes an allowance slot at reservation time, not at success time", async () => {
    // No success is ever recorded here — this is the billed-then-failed call.
    const first = await reserveDailyAiQuota("u1");
    expect(first.exceeded).toBe(false);
    expect(first.used).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].event).toBe(QUOTA_EVENT);
  });

  it("refuses the request that would exceed the limit", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await reserveDailyAiQuota("u1")).exceeded).toBe(false);
    }
    const blocked = await reserveDailyAiQuota("u1");
    expect(blocked.exceeded).toBe(true);
    expect(blocked.used).toBe(3);
    // A refused request must not burn a slot on top of being refused.
    expect(rows).toHaveLength(3);
  });

  it("counts per user", async () => {
    await reserveDailyAiQuota("u1");
    await reserveDailyAiQuota("u1");
    expect((await reserveDailyAiQuota("u2")).used).toBe(1);
  });

  it("ignores reservations that have aged out of the rolling window", async () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    rows.push(
      { event: QUOTA_EVENT, userId: "u1", at: yesterday },
      { event: QUOTA_EVENT, userId: "u1", at: yesterday },
      { event: QUOTA_EVENT, userId: "u1", at: yesterday }
    );
    expect((await reserveDailyAiQuota("u1")).exceeded).toBe(false);
  });

  it("is disabled by a non-positive limit", async () => {
    process.env.INVOICE_AI_DAILY_LIMIT = "0";
    for (let i = 0; i < 10; i += 1) {
      expect((await reserveDailyAiQuota("u1")).exceeded).toBe(false);
    }
    expect(rows).toHaveLength(0);
  });
});
