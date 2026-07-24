import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import type { AdminContext } from "@/lib/server/admin";
import { authErrorResponse } from "@/lib/server/auth";
import connectDB from "@/lib/mongodb";
import Feedback from "@/models/Feedback";
import { recordActivity, logRouteError } from "@/lib/server/log";
import { FEEDBACK_STATUSES } from "@/lib/feedback";

const isCastError = (error: unknown): boolean =>
  (error as { name?: string })?.name === "CastError";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  let adminCtx: AdminContext;
  try {
    adminCtx = await requireAdmin(req);
  } catch (error: unknown) {
    return authErrorResponse(error);
  }

  try {
    const { id } = await params;
    const body = (await req.json()) as { status?: string };
    const status = body.status;

    if (!status || !(FEEDBACK_STATUSES as string[]).includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    await connectDB();
    const result = await Feedback.updateOne(
      { _id: id },
      { $set: { status } }
    );
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Feedback not found" }, { status: 404 });
    }

    recordActivity({
      userId: adminCtx.uid,
      type: "admin_action",
      meta: { action: `feedback_status:${status}`, feedbackId: id },
    });

    return NextResponse.json({ message: "Feedback updated." });
  } catch (error: unknown) {
    if (isCastError(error)) {
      return NextResponse.json({ error: "Invalid feedback id" }, { status: 400 });
    }
    logRouteError(error, {
      req,
      route: "PATCH /api/admin/feedback/[id]",
      userId: adminCtx.uid,
      category: "admin",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
