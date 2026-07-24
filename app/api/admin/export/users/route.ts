import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import type { AdminContext } from "@/lib/server/admin";
import { authErrorResponse } from "@/lib/server/auth";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { toCsv } from "@/lib/server/admin-export";
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

    // Tokens are always projected out of exports.
    const users = await User.find(
      {},
      { accessToken: 0, refreshToken: 0 }
    )
      .limit(CAP + 1)
      .lean();
    const truncated = users.length > CAP;
    const data = truncated ? users.slice(0, CAP) : users;

    recordActivity({
      userId: adminCtx.uid,
      type: "admin_action",
      meta: { action: "export_users", format, count: data.length, truncated },
    });

    if (format === "json") {
      return new NextResponse(JSON.stringify({ users: data, truncated }, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": 'attachment; filename="users-export.json"',
        },
      });
    }

    const rows = [
      [
        "uid",
        "email",
        "name",
        "role",
        "status",
        "providerIds",
        "lastLoginAt",
        "createdAt",
      ],
      ...data.map((user) => [
        user.uid,
        user.email,
        user.name,
        user.role ?? "user",
        user.status ?? "active",
        Array.isArray(user.providerIds) ? user.providerIds.join("|") : "",
        toIso(user.lastLoginAt),
        toIso(user.createdAt),
      ]),
    ];

    return new NextResponse(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="users-export.csv"',
      },
    });
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "GET /api/admin/export/users",
      userId: adminCtx.uid,
      category: "admin",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
