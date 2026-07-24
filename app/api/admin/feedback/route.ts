import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import type { AdminContext } from "@/lib/server/admin";
import { authErrorResponse } from "@/lib/server/auth";
import connectDB from "@/lib/mongodb";
import Feedback from "@/models/Feedback";
import { parsePagination, escapeRegex } from "@/lib/server/pagination";
import { ownerMapForInvoices } from "@/lib/server/admin-data";
import { logRouteError } from "@/lib/server/log";
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from "@/lib/feedback";

type LeanFeedback = {
  _id: unknown;
  userId: string;
  [key: string]: unknown;
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
    const { page, limit, skip } = parsePagination(searchParams, {
      defaultLimit: 25,
      maxLimit: 100,
    });

    const filter: Record<string, unknown> = {};
    const status = searchParams.get("status");
    if (status && (FEEDBACK_STATUSES as string[]).includes(status)) {
      filter.status = status;
    }
    const category = searchParams.get("category");
    if (category && (FEEDBACK_CATEGORIES as string[]).includes(category)) {
      filter.category = category;
    }
    const q = (searchParams.get("q") || "").trim();
    if (q.length >= 2) filter.message = new RegExp(escapeRegex(q), "i");

    const [total, feedbackRaw, countRows] = await Promise.all([
      Feedback.countDocuments(filter),
      Feedback.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Feedback.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);

    const feedback = feedbackRaw as unknown as LeanFeedback[];
    const owners = await ownerMapForInvoices(feedback.map((f) => f.userId));
    const rows = feedback.map((f) => {
      const owner = owners.get(f.userId);
      return {
        ...f,
        userEmail: owner?.email ?? "",
        userName: owner?.name ?? "",
      };
    });

    const counts = { new: 0, reviewed: 0, archived: 0, total: 0 };
    for (const row of countRows) {
      const s = row._id as string;
      if (s === "new") counts.new = row.count;
      else if (s === "reviewed") counts.reviewed = row.count;
      else if (s === "archived") counts.archived = row.count;
      counts.total += row.count;
    }

    return NextResponse.json({ feedback: rows, page, limit, total, counts });
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "GET /api/admin/feedback",
      userId: adminCtx.uid,
      category: "admin",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
