import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import type { AdminContext } from "@/lib/server/admin";
import { authErrorResponse } from "@/lib/server/auth";
import connectDB from "@/lib/mongodb";
import Invoice from "@/models/Invoice";
import User from "@/models/User";
import LogEntry from "@/models/LogEntry";
import { logRouteError } from "@/lib/server/log";

const DAY = 24 * 60 * 60 * 1000;

interface SeriesRow {
  _id: string;
  count: number;
}

const mapSeries = (rows: SeriesRow[]) =>
  rows.map((row) => ({ date: row._id, count: row.count }));

/** Distinct users with ANY logged activity in the window (login/invoice/ai). */
const distinctActiveUsers = async (since: Date): Promise<number> => {
  const rows = await LogEntry.aggregate([
    { $match: { at: { $gte: since }, userId: { $ne: null } } },
    { $group: { _id: null, users: { $addToSet: "$userId" } } },
    { $project: { count: { $size: "$users" } } },
  ]);
  return rows[0]?.count ?? 0;
};

export async function GET(req: NextRequest) {
  let admin: AdminContext;
  try {
    admin = await requireAdmin(req);
  } catch (error: unknown) {
    return authErrorResponse(error);
  }

  try {
    await connectDB();
    const now = Date.now();
    const since1d = new Date(now - DAY);
    const since7d = new Date(now - 7 * DAY);
    const since30d = new Date(now - 30 * DAY);

    const [
      totalUsers,
      totalInvoices,
      dau,
      wau,
      mau,
      revenueRows,
      signupRows,
      invoiceSeriesRows,
      statusRows,
      errors24h,
      aiRows,
      errorRows,
    ] = await Promise.all([
      User.estimatedDocumentCount(),
      Invoice.countDocuments({ is_deleted: { $ne: true } }),
      distinctActiveUsers(since1d),
      distinctActiveUsers(since7d),
      distinctActiveUsers(since30d),
      Invoice.aggregate([
        { $match: { is_deleted: { $ne: true }, status: "paid" } },
        {
          $group: {
            _id: "$currency",
            total: { $sum: "$total" },
            count: { $sum: 1 },
          },
        },
        { $sort: { total: -1 } },
      ]),
      User.aggregate([
        { $match: { createdAt: { $gte: since30d } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Invoice.aggregate([
        { $match: { is_deleted: { $ne: true }, createdAt: { $gte: since30d } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Invoice.aggregate([
        { $match: { is_deleted: { $ne: true } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      LogEntry.countDocuments({ level: "error", at: { $gte: since1d } }),
      LogEntry.aggregate([
        { $match: { event: "ai.response", at: { $gte: since1d } } },
        { $group: { _id: null, count: { $sum: 1 }, avg: { $avg: "$meta.durationMs" } } },
      ]),
      LogEntry.aggregate([
        { $match: { level: "error", at: { $gte: since7d } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$at" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    return NextResponse.json({
      totals: { users: totalUsers, invoices: totalInvoices },
      activeUsers: { dau, wau, mau },
      revenueByCurrency: revenueRows.map((row) => ({
        currency: row._id || "INR",
        total: row.total,
        count: row.count,
      })),
      signupsOverTime: mapSeries(signupRows),
      invoicesOverTime: mapSeries(invoiceSeriesRows),
      statusBreakdown: statusRows.map((row) => ({
        status: row._id || "draft",
        count: row.count,
      })),
      errors24h,
      ai: {
        callsToday: aiRows[0]?.count ?? 0,
        avgLatencyMs: Math.round(aiRows[0]?.avg ?? 0),
      },
      errorRateSeries: mapSeries(errorRows),
    });
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "GET /api/admin/overview",
      userId: admin.uid,
      category: "admin",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
