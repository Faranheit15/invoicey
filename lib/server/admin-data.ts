import Invoice from "@/models/Invoice";
import User from "@/models/User";
import type { AdminUserRow } from "@/lib/admin-types";

const toIso = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export interface UserRollup {
  invoiceCount: number;
  revenueByCurrency: { currency: string; total: number }[];
}

export interface LeanUser {
  uid: string;
  email?: string;
  name?: string;
  avatar?: string;
  role?: string;
  status?: string;
  providerIds?: string[];
  lastLoginAt?: unknown;
  createdAt?: unknown;
}

/**
 * Plain shape for a `.lean()` invoice. Mongoose's typed-lean result is a complex
 * intersection that loses named fields when spread, so route code casts to this.
 */
export interface LeanInvoice {
  _id: unknown;
  userId: string;
  invoiceNumber?: string;
  companyName?: string;
  billTo?: string;
  status?: string;
  currency?: string;
  subtotal?: number;
  total?: number;
  invoiceDate?: unknown;
  dueDate?: unknown;
  createdAt?: unknown;
  is_deleted?: boolean;
  [key: string]: unknown;
}

/**
 * Per-user invoice count + revenue grouped by currency, for a page of uids.
 * One `$in` aggregation over the existing { userId, ... } index. Revenue is NOT
 * summed across currencies — INR + USD are reported separately.
 */
export const invoiceRollupForUsers = async (
  uids: string[]
): Promise<Map<string, UserRollup>> => {
  const map = new Map<string, UserRollup>();
  if (!uids.length) return map;

  const rows = await Invoice.aggregate([
    { $match: { userId: { $in: uids }, is_deleted: { $ne: true } } },
    {
      $group: {
        _id: { userId: "$userId", currency: "$currency" },
        count: { $sum: 1 },
        total: { $sum: "$total" },
      },
    },
  ]);

  for (const row of rows) {
    const uid = row._id.userId as string;
    const currency = (row._id.currency as string) || "INR";
    const existing = map.get(uid) ?? { invoiceCount: 0, revenueByCurrency: [] };
    existing.invoiceCount += row.count;
    existing.revenueByCurrency.push({ currency, total: row.total });
    map.set(uid, existing);
  }
  return map;
};

export const serializeUserRow = (
  user: LeanUser,
  rollup?: UserRollup
): AdminUserRow => ({
  uid: user.uid,
  email: user.email ?? "",
  name: user.name ?? "",
  avatar: user.avatar ?? "",
  role: user.role === "admin" ? "admin" : "user",
  status: user.status === "suspended" ? "suspended" : "active",
  providerIds: Array.isArray(user.providerIds) ? user.providerIds : [],
  lastLoginAt: toIso(user.lastLoginAt),
  createdAt: toIso(user.createdAt),
  invoiceCount: rollup?.invoiceCount ?? 0,
  revenueByCurrency: rollup?.revenueByCurrency ?? [],
});

/** Map uid -> { email, name } for attaching owner identity to invoice rows. */
export const ownerMapForInvoices = async (
  userIds: string[]
): Promise<Map<string, { email: string; name: string }>> => {
  const map = new Map<string, { email: string; name: string }>();
  const unique = Array.from(new Set(userIds));
  if (!unique.length) return map;

  const users = (await User.find(
    { uid: { $in: unique } },
    { uid: 1, email: 1, name: 1 }
  ).lean()) as unknown as LeanUser[];

  for (const user of users) {
    map.set(user.uid, { email: user.email ?? "", name: user.name ?? "" });
  }
  return map;
};
