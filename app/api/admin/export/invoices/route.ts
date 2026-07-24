import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import type { AdminContext } from "@/lib/server/admin";
import { authErrorResponse } from "@/lib/server/auth";
import connectDB from "@/lib/mongodb";
import Invoice from "@/models/Invoice";
import { toCsv } from "@/lib/server/admin-export";
import { ownerMapForInvoices } from "@/lib/server/admin-data";
import type { LeanInvoice } from "@/lib/server/admin-data";
import { recordActivity, logRouteError } from "@/lib/server/log";

const CAP = 50_000;
const toIso = (value: unknown): string =>
  value ? new Date(value as string).toISOString() : "";

export async function GET(req: NextRequest) {
  let adminCtx: AdminContext;
  try {
    adminCtx = await requireAdmin(req);
  } catch (error: unknown) {
    return authErrorResponse(error);
  }

  try {
    await connectDB();
    const format =
      new URL(req.url).searchParams.get("format") === "json" ? "json" : "csv";

    const invoicesRaw = await Invoice.find({})
      .sort({ createdAt: -1 })
      .limit(CAP + 1)
      .lean();
    const invoices = invoicesRaw as unknown as LeanInvoice[];
    const truncated = invoices.length > CAP;
    const data = truncated ? invoices.slice(0, CAP) : invoices;

    const owners = await ownerMapForInvoices(
      data.map((invoice) => invoice.userId)
    );
    const withOwner = data.map((invoice) => ({
      ...invoice,
      ownerEmail: owners.get(invoice.userId as string)?.email ?? "",
    }));

    recordActivity({
      userId: adminCtx.uid,
      type: "admin_action",
      meta: {
        action: "export_invoices",
        format,
        count: data.length,
        truncated,
      },
    });

    if (format === "json") {
      return new NextResponse(
        JSON.stringify({ invoices: withOwner, truncated }, null, 2),
        {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": 'attachment; filename="invoices-export.json"',
          },
        }
      );
    }

    const rows = [
      [
        "invoiceNumber",
        "ownerEmail",
        "companyName",
        "billTo",
        "status",
        "currency",
        "subtotal",
        "total",
        "invoiceDate",
        "dueDate",
        "createdAt",
        "is_deleted",
      ],
      ...withOwner.map((invoice) => [
        invoice.invoiceNumber,
        invoice.ownerEmail,
        invoice.companyName,
        invoice.billTo,
        invoice.status,
        invoice.currency,
        invoice.subtotal,
        invoice.total,
        toIso(invoice.invoiceDate),
        toIso(invoice.dueDate),
        toIso(invoice.createdAt),
        invoice.is_deleted ? "true" : "false",
      ]),
    ];

    return new NextResponse(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="invoices-export.csv"',
      },
    });
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "GET /api/admin/export/invoices",
      userId: adminCtx.uid,
      category: "admin",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
