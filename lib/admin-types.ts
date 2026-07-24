/**
 * Wire shapes for the /api/admin/* surface. Shared by the typed adminApi client
 * (lib/api-client.ts) and the admin pages. Dates arrive as ISO strings.
 */
import type { InvoiceRecord } from "@/lib/invoices";
import type { LogEntry } from "@/lib/logs";

export type UserRole = "user" | "admin";
export type UserStatus = "active" | "suspended";

/** Identity returned by GET /api/admin/me — powers the gate + sidebar. */
export interface AdminMe {
  uid: string;
  email: string;
  name: string;
  avatar: string;
  role: "admin";
  status: UserStatus;
}

export interface CurrencyTotal {
  currency: string;
  total: number;
  count: number;
}

export interface TimePoint {
  date: string;
  count: number;
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface AdminOverview {
  totals: { users: number; invoices: number };
  activeUsers: { dau: number; wau: number; mau: number };
  revenueByCurrency: CurrencyTotal[];
  signupsOverTime: TimePoint[];
  invoicesOverTime: TimePoint[];
  statusBreakdown: StatusCount[];
  errors24h: number;
  ai: { callsToday: number; avgLatencyMs: number };
  errorRateSeries: TimePoint[];
}

export interface AdminUserRow {
  uid: string;
  email: string;
  name: string;
  avatar: string;
  role: UserRole;
  status: UserStatus;
  providerIds: string[];
  lastLoginAt: string | null;
  createdAt: string | null;
  invoiceCount: number;
  revenueByCurrency: { currency: string; total: number }[];
}

export interface Paginated<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

export type AdminUsersResponse = {
  users: AdminUserRow[];
  page: number;
  limit: number;
  total: number;
};

/** An invoice row in the admin cross-user table, with owner identity attached. */
export interface AdminInvoiceRow extends InvoiceRecord {
  ownerEmail?: string;
  ownerName?: string;
}

export interface AdminInvoicesResponse {
  invoices: AdminInvoiceRow[];
  page: number;
  limit: number;
  total: number;
}

export interface AdminUserDetail {
  user: AdminUserRow;
  invoices: AdminInvoiceRow[];
  invoicesTotal: number;
  activity: LogEntry[];
}

export interface HeatmapCell {
  dow: number; // 1..7 (Mongo $dayOfWeek: 1=Sunday)
  hour: number; // 0..23
  count: number;
}

export interface AdminActivityResponse {
  feed: LogEntry[];
  timeseries: TimePoint[];
  heatmap: HeatmapCell[];
}

export interface AdminLogsResponse {
  entries: LogEntry[];
  nextCursor: string | null;
}

export interface AdminActionResponse {
  message: string;
  user?: AdminUserRow;
  invoice?: AdminInvoiceRow;
}
