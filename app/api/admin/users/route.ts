import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import type { AdminContext } from "@/lib/server/admin";
import { authErrorResponse } from "@/lib/server/auth";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { parsePagination, escapeRegex } from "@/lib/server/pagination";
import {
  invoiceRollupForUsers,
  serializeUserRow,
} from "@/lib/server/admin-data";
import type { LeanUser } from "@/lib/server/admin-data";
import { logRouteError } from "@/lib/server/log";

const SORT_FIELDS: Record<string, string> = {
  lastLoginAt: "lastLoginAt",
  createdAt: "createdAt",
  email: "email",
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
    const { searchParams } = new URL(req.url);
    const { page, limit, skip } = parsePagination(searchParams, {
      defaultLimit: 25,
      maxLimit: 100,
    });

    const filter: Record<string, unknown> = {};

    const q = (searchParams.get("q") || "").trim();
    if (q.length >= 2) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ email: rx }, { name: rx }];
    }

    const role = searchParams.get("role");
    if (role === "admin") filter.role = "admin";
    else if (role === "user") filter.role = { $ne: "admin" };

    const status = searchParams.get("status");
    // Legacy docs without a status field count as active.
    if (status === "suspended") filter.status = "suspended";
    else if (status === "active") filter.status = { $ne: "suspended" };

    const sortField = SORT_FIELDS[searchParams.get("sort") || ""] || "lastLoginAt";
    const order = searchParams.get("order") === "asc" ? 1 : -1;

    const [total, usersRaw] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter, { accessToken: 0, refreshToken: 0 })
        .sort({ [sortField]: order })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);
    const users = usersRaw as unknown as LeanUser[];

    const uids = users.map((user) => user.uid);
    const rollups = await invoiceRollupForUsers(uids);
    const rows = users.map((user) =>
      serializeUserRow(user, rollups.get(user.uid))
    );

    return NextResponse.json({ users: rows, page, limit, total });
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "GET /api/admin/users",
      userId: admin.uid,
      category: "admin",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
