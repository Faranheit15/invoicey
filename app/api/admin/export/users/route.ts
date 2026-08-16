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

/**
 * Both export formats are built from an explicit field list, never from the raw
 * document. `.lean()` returns what the driver returned, not what the schema
 * declares, so a field that has been dropped from `models/User.ts` is still
 * present on every document written before the drop — deleting the field is not
 * the same as deleting the data. This route used to project two such fields out
 * by name (the persisted Firebase tokens); an allow-list is the version of that
 * defence which also covers whatever gets added next.
 */
const toText = (value: unknown): string =>
  typeof value === "string" ? value : "";

const serializeUser = (user: Record<string, unknown>) => ({
  uid: toText(user.uid),
  email: toText(user.email),
  name: toText(user.name),
  avatar: toText(user.avatar),
  role: toText(user.role) || "user",
  status: toText(user.status) || "active",
  providerIds: Array.isArray(user.providerIds)
    ? user.providerIds.map(toText)
    : [],
  lastLoginAt: toIso(user.lastLoginAt),
  createdAt: toIso(user.createdAt),
});

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

    const users = await User.find({}).limit(CAP + 1).lean();
    const truncated = users.length > CAP;
    const data = (truncated ? users.slice(0, CAP) : users).map(serializeUser);

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
        user.role,
        user.status,
        user.providerIds.join("|"),
        user.lastLoginAt,
        user.createdAt,
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
