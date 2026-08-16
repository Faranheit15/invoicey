import { after } from "next/server";
import type { NextRequest } from "next/server";
import connectDB from "@/lib/mongodb";
import LogEntry from "@/models/LogEntry";
import type { LogLevel, LogCategory } from "@/lib/logs";

/**
 * The unified application log writer. One collection powers both analytics
 * (DAU/heatmap/usage) and the admin log viewer. Every write is fire-and-forget:
 * it must NEVER slow or fail the request it describes.
 *
 * - `logEvent` schedules the write via Next's `after()` so it still runs after
 *   the response is sent on serverless (a bare unawaited promise can be frozen).
 * - All errors are swallowed; the function returns void so nothing can await it.
 * - `meta` is redacted (secrets stripped) and size-capped before it lands.
 */

interface LogInput {
  level?: LogLevel;
  category: LogCategory;
  event: string;
  userId?: string | null;
  message?: string;
  meta?: Record<string, unknown>;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Retention map (see plan Part C). Errors/admin-audit persist longest. */
const computeExpireAt = (level: LogLevel, category: LogCategory): Date => {
  let days: number;
  if (level === "error") days = 365;
  else if (category === "admin") days = 365;
  else if (level === "warn") days = 90;
  else if (category === "ai" || category === "client") days = 30;
  else if (level === "info" && (category === "auth" || category === "invoice"))
    days = 180;
  else days = 30;
  return new Date(Date.now() + days * DAY_MS);
};

const SENSITIVE_KEY =
  /token|secret|authorization|password|api[_-]?key|refresh|access|cookie|jwt/i;
const MAX_STRING = 16_000;
const MAX_META_BYTES = 32_768;
const MAX_DEPTH = 6;

interface SanitizeFlags {
  truncated: boolean;
}

const sanitizeValue = (
  value: unknown,
  depth: number,
  flags: SanitizeFlags
): unknown => {
  if (depth > MAX_DEPTH) return "[TRUNCATED_DEPTH]";
  if (typeof value === "string") {
    // Scrub anything that looks like an API key in a URL/query (Gemini key guard).
    if (/key=/i.test(value)) {
      flags.truncated = true;
      return "[REDACTED]";
    }
    if (value.length > MAX_STRING) {
      flags.truncated = true;
      return `${value.slice(0, MAX_STRING)}…[truncated]`;
    }
    return value;
  }
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1, flags));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = sanitizeValue(val, depth + 1, flags);
  }
  return out;
};

const sanitizeMeta = (
  meta: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!meta || typeof meta !== "object") return undefined;
  const flags: SanitizeFlags = { truncated: false };
  let clean = sanitizeValue(meta, 0, flags) as Record<string, unknown>;
  if (flags.truncated) clean.truncated = true;
  try {
    if (JSON.stringify(clean).length > MAX_META_BYTES) {
      clean = {
        truncated: true,
        note: "meta exceeded size cap",
        keys: Object.keys(meta),
      };
    }
  } catch {
    clean = { note: "meta not serializable" };
  }
  return clean;
};

const writeLog = async (input: LogInput): Promise<void> => {
  await connectDB();
  const level = input.level ?? "info";
  await LogEntry.create({
    at: new Date(),
    level,
    category: input.category,
    event: input.event,
    userId: input.userId ?? null,
    message: (input.message ?? "").slice(0, 2000),
    meta: sanitizeMeta(input.meta),
    requestId: input.requestId,
    ip: input.ip,
    userAgent: input.userAgent,
    expireAt: computeExpireAt(level, input.category),
  });
};

/**
 * The awaited variant. `logEvent` defers past the response, which is right for
 * telemetry and wrong for anything a later decision reads back: a caller that
 * needs the row to exist before it does something expensive has to know the
 * write landed. Unlike `logEvent` this one CAN throw — the caller is depending
 * on the write, so it has to be told when it failed.
 */
export const logEventNow = async (input: LogInput): Promise<void> => {
  await writeLog(input);
};

export const logEvent = (input: LogInput): void => {
  const run = () => {
    void writeLog(input).catch((err) => {
      console.error("logEvent failed (non-fatal):", err);
    });
  };
  try {
    // after() defers the write past the response, but is only valid inside a
    // request lifecycle. Outside one (scripts/tests) it throws — fall back to a
    // detached write so the contract "never throws" always holds.
    after(run);
  } catch {
    run();
  }
};

const categoryForActivity = (type: string): LogCategory => {
  if (type.startsWith("invoice")) return "invoice";
  if (type === "login" || type.startsWith("auth")) return "auth";
  if (type === "admin_action" || type.startsWith("admin")) return "admin";
  return "system";
};

/**
 * Typed analytics activity → logEvent. Kept as a thin alias so the invoice/login
 * call sites read as "record this business event".
 */
export const recordActivity = (activity: {
  userId: string;
  type: string;
  invoiceId?: string;
  amount?: number;
  currency?: string;
  level?: LogLevel;
  meta?: Record<string, unknown>;
}): void => {
  logEvent({
    level: activity.level ?? "info",
    category: categoryForActivity(activity.type),
    event: activity.type.replaceAll("_", "."),
    userId: activity.userId,
    meta: {
      invoiceId: activity.invoiceId,
      amount: activity.amount,
      currency: activity.currency,
      ...activity.meta,
    },
  });
};

const clientIp = (req?: NextRequest): string | undefined => {
  if (!req) return undefined;
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim();
  return req.headers.get("x-real-ip") ?? undefined;
};

/**
 * Emit an error log from a route catch block WITHOUT changing the response.
 * Preserves each route's carefully-tuned status codes — it only records.
 */
export const logRouteError = (
  err: unknown,
  ctx: {
    req?: NextRequest;
    route: string;
    statusCode?: number;
    userId?: string | null;
    requestId?: string;
    category?: LogCategory;
    event?: string;
  }
): void => {
  const e = err as Error;
  logEvent({
    level: "error",
    category: ctx.category ?? "system",
    event: ctx.event ?? "error.unhandled",
    userId: ctx.userId ?? null,
    message: e?.message ?? String(err),
    requestId: ctx.requestId,
    ip: clientIp(ctx.req),
    userAgent: ctx.req?.headers.get("user-agent") ?? undefined,
    meta: {
      route: ctx.route,
      method: ctx.req?.method,
      statusCode: ctx.statusCode ?? 500,
      stack: e?.stack,
    },
  });
};

type RouteHandler = (
  req: NextRequest,
  context: unknown
) => Promise<Response> | Response;

/** Safety-net wrapper for truly-unhandled throws; rethrows after logging. */
export const withRouteLogging =
  (route: string, handler: RouteHandler): RouteHandler =>
  async (req, context) => {
    try {
      return await handler(req, context);
    } catch (err) {
      logRouteError(err, { req, route, statusCode: 500 });
      throw err;
    }
  };

export { clientIp };
