import { NextRequest, NextResponse } from "next/server";
import firebaseAdmin, { ensureFirebaseAdmin } from "@/lib/firebase-admin";
import {
  requireAdmin,
  assertNotSelf,
  assertNotLastActiveAdmin,
} from "@/lib/server/admin";
import type { AdminContext } from "@/lib/server/admin";
import { authErrorResponse, AuthError } from "@/lib/server/auth";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Invoice from "@/models/Invoice";
import LogEntry from "@/models/LogEntry";
import { parsePagination } from "@/lib/server/pagination";
import {
  invoiceRollupForUsers,
  serializeUserRow,
} from "@/lib/server/admin-data";
import type { LeanUser } from "@/lib/server/admin-data";
import { recordActivity, logRouteError } from "@/lib/server/log";

type Params = { params: Promise<{ uid: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  let adminCtx: AdminContext;
  try {
    adminCtx = await requireAdmin(req);
  } catch (error: unknown) {
    return authErrorResponse(error);
  }

  try {
    const { uid } = await params;
    await connectDB();

    const userDoc = (await User.findOne(
      { uid },
      { accessToken: 0, refreshToken: 0 }
    ).lean()) as LeanUser | null;
    if (!userDoc) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const { skip, limit } = parsePagination(searchParams, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const includeDeleted = searchParams.get("includeDeleted") === "true";
    const invoiceFilter = {
      userId: uid,
      ...(includeDeleted ? {} : { is_deleted: { $ne: true } }),
    };

    const [rollups, invoicesTotal, invoices, activity] = await Promise.all([
      invoiceRollupForUsers([uid]),
      Invoice.countDocuments(invoiceFilter),
      Invoice.find(invoiceFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      LogEntry.find({ userId: uid }).sort({ at: -1 }).limit(50).lean(),
    ]);

    return NextResponse.json({
      user: serializeUserRow(userDoc, rollups.get(uid)),
      invoices,
      invoicesTotal,
      activity,
    });
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "GET /api/admin/users/[uid]",
      userId: adminCtx.uid,
      category: "admin",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  let adminCtx: AdminContext;
  try {
    adminCtx = await requireAdmin(req);
  } catch (error: unknown) {
    return authErrorResponse(error);
  }

  try {
    const { uid } = await params;
    const body = (await req.json()) as { action?: string };
    const action = body.action;
    await connectDB();

    const target = await User.findOne({ uid }, { uid: 1 }).lean();
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const now = new Date();

    if (action === "promote") {
      await User.updateOne(
        { uid },
        { $set: { role: "admin", updatedAt: now } }
      );
    } else if (action === "revoke") {
      assertNotSelf(adminCtx, uid);
      await assertNotLastActiveAdmin(uid);
      await User.updateOne({ uid }, { $set: { role: "user", updatedAt: now } });
    } else if (action === "suspend") {
      assertNotSelf(adminCtx, uid);
      await assertNotLastActiveAdmin(uid);
      await User.updateOne(
        { uid },
        { $set: { status: "suspended", updatedAt: now } }
      );
      // Enforce at the token layer: disable the Firebase account and revoke
      // refresh tokens so verifyIdToken(checkRevoked) rejects the very next
      // request on any route.
      ensureFirebaseAdmin();
      await firebaseAdmin.auth().updateUser(uid, { disabled: true });
      await firebaseAdmin.auth().revokeRefreshTokens(uid);
    } else if (action === "unsuspend") {
      await User.updateOne(
        { uid },
        { $set: { status: "active", updatedAt: now } }
      );
      ensureFirebaseAdmin();
      await firebaseAdmin.auth().updateUser(uid, { disabled: false });
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    recordActivity({
      userId: adminCtx.uid,
      type: "admin_action",
      meta: { action, targetUid: uid },
    });

    const updated = (await User.findOne(
      { uid },
      { accessToken: 0, refreshToken: 0 }
    ).lean()) as LeanUser | null;
    const rollups = await invoiceRollupForUsers([uid]);

    return NextResponse.json({
      message: `User ${action} succeeded.`,
      user: updated ? serializeUserRow(updated, rollups.get(uid)) : null,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    logRouteError(error, {
      req,
      route: "PATCH /api/admin/users/[uid]",
      userId: adminCtx.uid,
      category: "admin",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
