import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import type { AdminContext } from "@/lib/server/admin";
import { authErrorResponse } from "@/lib/server/auth";
import connectDB from "@/lib/mongodb";
import LogEntry from "@/models/LogEntry";
import { logRouteError } from "@/lib/server/log";

const DAY = 24 * 60 * 60 * 1000;

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
    // $hour/$dayOfWeek default to UTC; a configured tz reflects real local usage.
    const tz = process.env.APP_TZ || "UTC";
    const since = new Date(Date.now() - 30 * DAY);

    const baseFilter: Record<string, unknown> = {};
    const event = searchParams.get("event");
    if (event) baseFilter.event = event;
    const userId = searchParams.get("userId");
    if (userId) baseFilter.userId = userId;

    const [feed, timeseries, heatmap] = await Promise.all([
      LogEntry.find(baseFilter).sort({ at: -1 }).limit(100).lean(),
      LogEntry.aggregate([
        { $match: { at: { $gte: since }, ...baseFilter } },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$at", timezone: tz },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      LogEntry.aggregate([
        { $match: { at: { $gte: since }, userId: { $ne: null }, ...baseFilter } },
        {
          $group: {
            _id: {
              dow: { $dayOfWeek: { date: "$at", timezone: tz } },
              hour: { $hour: { date: "$at", timezone: tz } },
            },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    return NextResponse.json({
      feed,
      timeseries: timeseries.map((row) => ({ date: row._id, count: row.count })),
      heatmap: heatmap.map((row) => ({
        dow: row._id.dow,
        hour: row._id.hour,
        count: row.count,
      })),
    });
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "GET /api/admin/activity",
      userId: adminCtx.uid,
      category: "admin",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
