import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import type { AdminContext } from "@/lib/server/admin";
import { authErrorResponse } from "@/lib/server/auth";
import connectDB from "@/lib/mongodb";
import LogEntry from "@/models/LogEntry";
import { escapeRegex } from "@/lib/server/pagination";
import { logRouteError } from "@/lib/server/log";
import { LOG_LEVELS, LOG_CATEGORIES } from "@/lib/logs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const parseDate = (value: string | null): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function GET(req: NextRequest) {
  let adminCtx: AdminContext;
  try {
    adminCtx = await requireAdmin(req);
  } catch (error: unknown) {
    return authErrorResponse(error);
  }

  try {
    await connectDB();
    const { searchParams } = new URL(req.url);

    const rawLimit = Number.parseInt(
      searchParams.get("limit") || String(DEFAULT_LIMIT),
      10
    );
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, MAX_LIMIT)
        : DEFAULT_LIMIT;

    const filter: Record<string, unknown> = {};

    const level = searchParams.get("level");
    if (level && (LOG_LEVELS as string[]).includes(level)) filter.level = level;
    const category = searchParams.get("category");
    if (category && (LOG_CATEGORIES as string[]).includes(category)) {
      filter.category = category;
    }
    const event = searchParams.get("event");
    if (event) filter.event = event;
    const userId = searchParams.get("userId");
    if (userId) filter.userId = userId;

    const q = (searchParams.get("q") || "").trim();
    if (q.length >= 3) filter.message = new RegExp(escapeRegex(q), "i");

    // Structured filters are indexed; the message regex runs on the narrowed set.
    const atRange: Record<string, Date> = {};
    const dateFrom = parseDate(searchParams.get("dateFrom"));
    const dateTo = parseDate(searchParams.get("dateTo"));
    const before = parseDate(searchParams.get("before")); // older than cursor
    const since = parseDate(searchParams.get("since")); // newer than (live tail)
    if (dateFrom) atRange.$gte = dateFrom;
    if (dateTo) atRange.$lte = dateTo;
    if (before) atRange.$lt = before;
    if (since) atRange.$gt = since;
    if (Object.keys(atRange).length) filter.at = atRange;

    const rows = await LogEntry.find(filter)
      .sort({ at: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = rows.length > limit;
    const entries = hasMore ? rows.slice(0, limit) : rows;
    const last = entries[entries.length - 1] as { at?: Date } | undefined;
    const nextCursor =
      hasMore && last?.at ? new Date(last.at).toISOString() : null;

    return NextResponse.json({ entries, nextCursor });
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "GET /api/admin/logs",
      userId: adminCtx.uid,
      category: "admin",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
