import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import type { AdminContext } from "@/lib/server/admin";
import { authErrorResponse } from "@/lib/server/auth";
import connectDB from "@/lib/mongodb";
import Invoice from "@/models/Invoice";
import { recordActivity, logRouteError } from "@/lib/server/log";

const ALLOWED_STATUS = ["draft", "sent", "paid", "overdue"];

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
    const body = (await req.json()) as { action?: string; status?: string };
    await connectDB();

    // Admin scope: locate by _id ONLY (deliberately cross-tenant).
    const invoice = await Invoice.findOne({ _id: id }).lean();
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    let action: string;
    if (body.action === "soft_delete") {
      await Invoice.updateOne({ _id: id }, { $set: { is_deleted: true } });
      action = "invoice_soft_delete";
    } else if (body.action === "restore") {
      await Invoice.updateOne({ _id: id }, { $set: { is_deleted: false } });
      action = "invoice_restore";
    } else if (body.status && ALLOWED_STATUS.includes(body.status)) {
      await Invoice.updateOne({ _id: id }, { $set: { status: body.status } });
      action = `invoice_status:${body.status}`;
    } else {
      return NextResponse.json(
        { error: "No valid action provided" },
        { status: 400 }
      );
    }

    recordActivity({
      userId: adminCtx.uid,
      type: "admin_action",
      invoiceId: id,
      meta: { action, invoiceId: id },
    });

    return NextResponse.json({ message: "Invoice updated successfully." });
  } catch (error: unknown) {
    if (isCastError(error)) {
      return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
    }
    logRouteError(error, {
      req,
      route: "PATCH /api/admin/invoices/[id]",
      userId: adminCtx.uid,
      category: "admin",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
