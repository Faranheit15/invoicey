/**
 * The shared in-process rate limiter, extracted from the byte-identical copies
 * that lived in /api/events and /api/feedback.
 *
 * BEST-EFFORT, NOT A REAL LIMIT. This app runs on Vercel serverless: the bucket
 * map lives inside one lambda instance, so a caller spread across N warm
 * instances gets up to N x the limit, and a cold start forgets every bucket.
 * It is a cheap brake on runaway client loops and casual hammering — anything
 * that has to actually hold (a spend cap, a daily allowance) must be durable
 * and live in the database instead.
 *
 * Each caller passes its own `namespace` so the three routes cannot drain one
 * another's budget through a shared map.
 */

export interface RateLimitRule {
  /** Keeps each route's buckets separate inside the one process-wide map. */
  namespace: string;
  /** Requests allowed per window; the (limit + 1)th is rejected. */
  limit: number;
  windowMs: number;
}

export interface RateLimitVerdict {
  limited: boolean;
  /** Epoch ms at which this caller's current window rolls over. */
  resetAt: number;
  /** Whole seconds until the window rolls over, for a `Retry-After` header. */
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Nothing evicts a bucket on its own, so a long-lived instance seeing many
// distinct uids would grow the map forever. Sweeping expired buckets when we
// cross this threshold is invisible behaviourally — an expired bucket is reset
// on its next touch anyway.
const MAX_TRACKED_KEYS = 10_000;

const sweepExpired = (now: number): void => {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
};

/**
 * Records one hit against `key` and reports whether it should be rejected.
 * `now` is injectable so the window rollover is testable without fake timers.
 */
export const consumeRateLimit = (
  rule: RateLimitRule,
  key: string,
  now: number = Date.now()
): RateLimitVerdict => {
  const bucketKey = `${rule.namespace}:${key}`;
  const bucket = buckets.get(bucketKey);

  if (!bucket || bucket.resetAt < now) {
    if (buckets.size >= MAX_TRACKED_KEYS) sweepExpired(now);
    const resetAt = now + rule.windowMs;
    buckets.set(bucketKey, { count: 1, resetAt });
    return {
      limited: false,
      resetAt,
      retryAfterSeconds: Math.ceil(rule.windowMs / 1000),
    };
  }

  bucket.count += 1;
  return {
    limited: bucket.count > rule.limit,
    resetAt: bucket.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
};

/**
 * Boolean-only shorthand matching the shape the routes already used
 * (`rateLimited(uid)`), for call sites that do not need `Retry-After`.
 */
export const createRateLimiter = (rule: RateLimitRule) => {
  return (key: string, now?: number): boolean =>
    consumeRateLimit(rule, key, now).limited;
};
