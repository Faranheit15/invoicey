import { describe, it, expect } from "bun:test";
import {
  consumeRateLimit,
  createRateLimiter,
  type RateLimitRule,
} from "@/lib/server/rate-limit";

// The bucket map is module-global by design (one process, many routes), so every
// test uses its own namespace rather than a reset hook — which also exercises
// the namespacing that keeps the three routes off each other's budget.
const ruleFor = (namespace: string, limit = 3): RateLimitRule => ({
  namespace,
  limit,
  windowMs: 60_000,
});

describe("consumeRateLimit — the limit boundary", () => {
  it("allows exactly `limit` hits and rejects the next one", () => {
    const rule = ruleFor("boundary");
    const verdicts = [1, 2, 3, 4].map(
      () => consumeRateLimit(rule, "uid", 1_000).limited
    );
    expect(verdicts).toEqual([false, false, false, true]);
  });

  it("stays limited for every further hit inside the window", () => {
    const rule = ruleFor("sticky", 1);
    consumeRateLimit(rule, "uid", 1_000);
    expect(consumeRateLimit(rule, "uid", 2_000).limited).toBe(true);
    expect(consumeRateLimit(rule, "uid", 3_000).limited).toBe(true);
  });
});

describe("consumeRateLimit — window rollover", () => {
  it("resets once the window has elapsed", () => {
    const rule = ruleFor("rollover", 2);
    consumeRateLimit(rule, "uid", 0);
    consumeRateLimit(rule, "uid", 0);
    expect(consumeRateLimit(rule, "uid", 0).limited).toBe(true);

    // One millisecond before the window closes the caller is still limited.
    expect(consumeRateLimit(rule, "uid", 59_999).limited).toBe(true);
    expect(consumeRateLimit(rule, "uid", 60_001).limited).toBe(false);
  });

  it("reports the seconds remaining so the route can send Retry-After", () => {
    const rule = ruleFor("retry-after", 1);
    const first = consumeRateLimit(rule, "uid", 0);
    expect(first.resetAt).toBe(60_000);
    expect(first.retryAfterSeconds).toBe(60);

    const later = consumeRateLimit(rule, "uid", 30_500);
    expect(later.limited).toBe(true);
    expect(later.retryAfterSeconds).toBe(30);
  });
});

describe("consumeRateLimit — isolation", () => {
  it("keeps namespaces independent, so one route cannot drain another", () => {
    const events = ruleFor("iso-events", 1);
    const feedback = ruleFor("iso-feedback", 1);

    expect(consumeRateLimit(events, "uid", 1_000).limited).toBe(false);
    expect(consumeRateLimit(feedback, "uid", 1_000).limited).toBe(false);
    expect(consumeRateLimit(events, "uid", 1_000).limited).toBe(true);
    // Same uid, same instant, other namespace: untouched.
    expect(consumeRateLimit(feedback, "uid", 1_000).limited).toBe(true);
  });

  it("keeps callers within a namespace independent", () => {
    const rule = ruleFor("iso-callers", 1);
    expect(consumeRateLimit(rule, "alice", 1_000).limited).toBe(false);
    expect(consumeRateLimit(rule, "alice", 1_000).limited).toBe(true);
    expect(consumeRateLimit(rule, "bob", 1_000).limited).toBe(false);
  });
});

describe("createRateLimiter", () => {
  it("returns the boolean shorthand the routes use", () => {
    const rateLimited = createRateLimiter(ruleFor("shorthand", 2));
    expect(rateLimited("uid", 1_000)).toBe(false);
    expect(rateLimited("uid", 1_000)).toBe(false);
    expect(rateLimited("uid", 1_000)).toBe(true);
  });
});
