import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import type { AdminContext } from "@/lib/server/admin";
import { authErrorResponse } from "@/lib/server/auth";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { logRouteError } from "@/lib/server/log";

/** Cheap identity/role probe for the client admin gate + sidebar. */
export async function GET(req: NextRequest) {
  let admin: AdminContext;
  try {
    admin = await requireAdmin(req);
  } catch (error: unknown) {
    return authErrorResponse(error);
  }

  try {
    await connectDB();
    const user = (await User.findOne(
      { uid: admin.uid },
      { name: 1, avatar: 1 }
    ).lean()) as { name?: string; avatar?: string } | null;

    return NextResponse.json({
      uid: admin.uid,
      email: admin.email,
      name: user?.name ?? "",
      avatar: user?.avatar ?? "",
      role: "admin",
      status: admin.status,
    });
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "GET /api/admin/me",
      userId: admin.uid,
      category: "admin",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
