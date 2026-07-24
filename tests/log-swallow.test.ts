import { describe, it, expect, mock } from "bun:test";

// Force the write path to fail so we can prove the writer swallows it.
mock.module("@/lib/mongodb", () => ({ default: async () => {} }));
mock.module("@/models/LogEntry", () => ({
  default: {
    create: async () => {
      throw new Error("write rejected");
    },
  },
}));

const { logEvent, recordActivity, logRouteError } = await import(
  "@/lib/server/log"
);

describe("log writer — fire-and-forget safety", () => {
  it("logEvent never throws even when the DB write fails", () => {
    expect(() =>
      logEvent({ category: "system", event: "test.event", message: "hi" })
    ).not.toThrow();
  });

  it("recordActivity never throws", () => {
    expect(() =>
      recordActivity({ userId: "u", type: "invoice_create" })
    ).not.toThrow();
  });

  it("logRouteError never throws", () => {
    expect(() =>
      logRouteError(new Error("boom"), { route: "TEST /x" })
    ).not.toThrow();
  });

  it("returns void, so a handler cannot await/block on it", () => {
    expect(logEvent({ category: "system", event: "x" })).toBeUndefined();
  });
});
