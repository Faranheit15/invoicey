import type { NextRequest } from "next/server";
import { verifyRequestToken, AuthError } from "@/lib/server/auth";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import type { UserRole, UserStatus } from "@/lib/admin-types";

/**
 * The admin authorization gate — the app's ONE deliberately cross-tenant
 * surface, so it is fail-closed at every step. Role/status are read fresh from
 * Mongo against the verified Firebase token; the client's stored role is never
 * trusted. Reuses the single token path (`verifyRequestToken`) so admin and
 * regular auth can never diverge.
 */

export interface AdminContext {
  uid: string;
  email: string;
  role: "admin";
  status: UserStatus;
}

interface UserRoleRow {
  uid: string;
  email: string;
  role?: UserRole;
  status?: UserStatus;
}

export const requireAdmin = async (req: NextRequest): Promise<AdminContext> => {
  const decoded = await verifyRequestToken(req);
  await connectDB();

  const user = (await User.findOne(
    { uid: decoded.uid },
    { uid: 1, email: 1, role: 1, status: 1 }
  ).lean()) as UserRoleRow | null;

  // Defaults are NOT applied by .lean(), so fall back explicitly.
  if (!user) throw new AuthError("AdminForbidden", 403); // no row → fail closed
  const status = user.status ?? "active";
  const role = user.role ?? "user";
  if (status === "suspended") throw new AuthError("Suspended", 403);
  if (role !== "admin") throw new AuthError("AdminForbidden", 403);

  return { uid: user.uid, email: user.email, role: "admin", status: "active" };
};

/** Refuse an admin acting destructively on their own account. */
export const assertNotSelf = (ctx: AdminContext, targetUid: string): void => {
  if (ctx.uid === targetUid) {
    throw new AuthError(
      "AdminForbidden",
      403,
      "You cannot perform this action on your own account."
    );
  }
};

/**
 * Refuse demoting/suspending the last active admin — otherwise the panel could
 * lock everyone out. Only guards when the target is currently an active admin.
 */
export const assertNotLastActiveAdmin = async (
  targetUid: string
): Promise<void> => {
  const target = (await User.findOne(
    { uid: targetUid },
    { role: 1, status: 1 }
  ).lean()) as UserRoleRow | null;
  if (!target) return;

  const targetIsActiveAdmin =
    (target.role ?? "user") === "admin" &&
    (target.status ?? "active") !== "suspended";
  if (!targetIsActiveAdmin) return;

  const activeAdmins = await User.countDocuments({
    role: "admin",
    status: { $ne: "suspended" },
  });
  if (activeAdmins <= 1) {
    throw new AuthError(
      "AdminForbidden",
      403,
      "You cannot remove or suspend the last remaining admin."
    );
  }
};
