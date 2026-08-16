import connectDB from "@/lib/mongodb";
import LogEntry from "@/models/LogEntry";
import { logEventNow } from "@/lib/server/log";

/**
 * The durable half of the AI cost cap.
 *
 * The short-window limiter in the route is in-memory and therefore per-lambda —
 * fine as a brake on hammering, useless as a spend cap, because a daily
 * allowance that resets whenever an instance recycles is not an allowance. So
 * this one counts what the database already knows, in the `LogEntry`
 * collection, so the quota needs no new schema and no second store to keep in
 * sync with reality.
 *
 * It counts `ai.attempt`, written BEFORE the provider call, and deliberately
 * not the `ai.request` entry the route writes after one succeeds. Gemini bills
 * for a call whose output then fails to parse — an empty candidate, a safety
 * block, a truncated JSON body — and every one of those throws before the
 * success log is reached. Counting successes therefore hands out an unlimited
 * supply of billed failures to anyone who can reliably provoke one ("reply with
 * the word OK" is enough), which is the opposite of a spend cap. What costs
 * money is the attempt, so the attempt is what is counted.
 *
 * Two properties of that reuse are load-bearing, and both were verified against
 * lib/server/log.ts and models/LogEntry.ts before relying on them:
 *  - `ai`-category entries are retained 30 days, comfortably longer than the
 *    24h window, so the TTL index can never silently refund a user's quota.
 *  - `{ userId: 1, at: -1 }` is indexed, so the count is an index range scan
 *    over one user's recent entries rather than a collection scan. `event` is
 *    not in that index and is applied as a residual filter over the matched
 *    docs — acceptable because the range is one uid over 24 hours.
 *
 * It is a ROLLING 24 hours, not a calendar day: no timezone question to get
 * wrong, and no midnight boundary where a user can spend two days' budget in
 * two minutes.
 */

const DEFAULT_DAILY_LIMIT = 50;
const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * `INVOICE_AI_DAILY_LIMIT` requests per rolling 24h per user. Zero or negative
 * disables the quota entirely (self-hosters running their own paid key).
 */
export const getDailyAiLimit = (): number => {
  const raw = process.env.INVOICE_AI_DAILY_LIMIT?.trim();
  if (!raw) return DEFAULT_DAILY_LIMIT;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed) : DEFAULT_DAILY_LIMIT;
};

export interface DailyAiQuotaVerdict {
  exceeded: boolean;
  limit: number;
  /** null when the count could not be read — see the fail-open note below. */
  used: number | null;
}

export const QUOTA_EVENT = "ai.attempt";

/**
 * Count the window, then reserve a slot. Call this immediately before the
 * provider call and nowhere else — a reservation is a unit of spend, so making
 * one without spending it silently shrinks the user's allowance.
 *
 * The reservation write is awaited rather than deferred through `logEvent`,
 * whose `after()` would land it past the response and let concurrent requests
 * all read the same pre-spend count. A narrow race survives — two requests can
 * both count before either writes — but it is bounded by the round trip of one
 * insert instead of by the 2-20s provider call, and the burst limiter caps how
 * many a single client can start inside it.
 */
export const reserveDailyAiQuota = async (
  userId: string
): Promise<DailyAiQuotaVerdict> => {
  const limit = getDailyAiLimit();
  if (limit <= 0) return { exceeded: false, limit, used: null };

  try {
    await connectDB();
    const used = await LogEntry.countDocuments({
      userId,
      event: QUOTA_EVENT,
      at: { $gte: new Date(Date.now() - WINDOW_MS) },
    });
    if (used >= limit) return { exceeded: true, limit, used };

    await logEventNow({
      category: "ai",
      event: QUOTA_EVENT,
      userId,
      meta: { used: used + 1, limit },
    });
    return { exceeded: false, limit, used: used + 1 };
  } catch {
    // Fail OPEN. A database blip must not take the assistant down, and spend is
    // still bounded by the route's short-window limiter in the meantime. The
    // caller logs the degradation.
    return { exceeded: false, limit, used: null };
  }
};
