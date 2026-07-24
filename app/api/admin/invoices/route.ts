import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import type { AdminContext } from "@/lib/server/admin";
import { authErrorResponse } from "@/lib/server/auth";
import connectDB from "@/lib/mongodb";
import Invoice from "@/models/Invoice";
import { parsePagination } from "@/lib/server/pagination";
import { ownerMapForInvoices } from "@/lib/server/admin-data";
import type { LeanInvoice } from "@/lib/server/admin-data";
import { logRouteError } from "@/lib/server/log";

const ALLOWED_STATUS = ["draft", "sent", "paid", "overdue"];

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
    if (searchParams.get("includeDeleted") !== "true") {
      filter.is_deleted = { $ne: true };
    }
    const userId = searchParams.get("userId");
    if (userId) filter.userId = userId;
    const status = searchParams.get("status");
    if (status && ALLOWED_STATUS.includes(status)) filter.status = status;

    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const range: Record<string, Date> = {};
    if (dateFrom) {
      const d = new Date(dateFrom);
      if (!Number.isNaN(d.getTime())) range.$gte = d;
    }
    if (dateTo) {
      const d = new Date(dateTo);
      if (!Number.isNaN(d.getTime())) range.$lte = d;
    }
    if (Object.keys(range).length) filter.createdAt = range;

    const [total, invoicesRaw] = await Promise.all([
      Invoice.countDocuments(filter),
      Invoice.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);
    const invoices = invoicesRaw as unknown as LeanInvoice[];

    const owners = await ownerMapForInvoices(
      invoices.map((invoice) => invoice.userId)
    );
    const rows = invoices.map((invoice) => {
      const owner = owners.get(invoice.userId);
      return {
        ...invoice,
        ownerEmail: owner?.email ?? "",
        ownerName: owner?.name ?? "",
      };
    });

    return NextResponse.json({ invoices: rows, page, limit, total });
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "GET /api/admin/invoices",
      userId: adminCtx.uid,
      category: "admin",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
