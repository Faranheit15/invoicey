import connectDB from "@/lib/mongodb";
import LogEntry from "@/models/LogEntry";
import { logEventNow } from "@/lib/server/log";

/**
 * The durable half of the account-export cap.
 *
 * The burst limiter in the route is in-memory and therefore per-lambda (see
 * lib/server/rate-limit.ts) — a brake on a runaway loop, not a limit. This one
 * counts what the database already knows, in `LogEntry`, exactly as
 * `lib/ai/invoice-assistant/quota.ts` does against `ai.attempt`. No new schema,
 * no second store to keep in sync.
 *
 * Why cap a read at all: `GET /api/account/export` reads an entire tenant
 * unpaginated — every invoice including deleted ones, plus feedback and
 * activity. Three a day is generous for a human exercising a data-subject
 * right and ruinous for a script.
 *
 * `admin`-category entries are retained 365 days, far longer than the 24h
 * window, so the TTL index cannot silently refund the allowance. `{ userId: 1,
 * at: -1 }` is indexed, so the count is a range scan over one uid.
 */

const DEFAULT_DAILY_LIMIT = 3;
const WINDOW_MS = 24 * 60 * 60 * 1000;

/** The event the quota counts. Written BEFORE the read — see below. */
export const ACCOUNT_EXPORT_EVENT = "account.export";

/**
 * `ACCOUNT_EXPORT_DAILY_LIMIT` exports per rolling 24h per user. Zero or
 * negative disables the quota (self-hosters running their own cluster).
 */
export const getDailyExportLimit = (): number => {
  const raw = process.env.ACCOUNT_EXPORT_DAILY_LIMIT?.trim();
  if (!raw) return DEFAULT_DAILY_LIMIT;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed) : DEFAULT_DAILY_LIMIT;
};

export interface ExportQuotaVerdict {
  exceeded: boolean;
  limit: number;
  /** null when the count could not be read — see the fail-open note. */
  used: number | null;
}

/**
 * Count the window, then reserve a slot, BEFORE the expensive read runs.
 *
 * Counting completed exports instead would leave every failed export free and
 * unlimited — and the failure mode we are protecting against (a full-tenant
 * scan) costs the same whether or not the response ever serializes. The cost
 * is the attempt, so the attempt is what is counted. This is the same lesson
 * the AI quota learned about billed-but-failed provider calls.
 */
export const reserveDailyExportQuota = async (
  userId: string,
  format: "json" | "csv"
): Promise<ExportQuotaVerdict> => {
  const limit = getDailyExportLimit();
  if (limit <= 0) return { exceeded: false, limit, used: null };

  try {
    await connectDB();
    const used = await LogEntry.countDocuments({
      userId,
      event: ACCOUNT_EXPORT_EVENT,
      at: { $gte: new Date(Date.now() - WINDOW_MS) },
    });
    if (used >= limit) return { exceeded: true, limit, used };

    // Awaited, not deferred through `logEvent`: `after()` would land the write
    // past the response and let concurrent requests all read the same
    // pre-spend count.
    await logEventNow({
      category: "admin",
      event: ACCOUNT_EXPORT_EVENT,
      userId,
      meta: { format, used: used + 1, limit },
    });
    return { exceeded: false, limit, used: used + 1 };
  } catch {
    // Fail OPEN. A database blip must not block someone exercising a statutory
    // right, and the burst limiter still bounds the damage in the meantime.
    return { exceeded: false, limit, used: null };
  }
};
