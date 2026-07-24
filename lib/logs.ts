/**
 * Shared log taxonomy + presentation, framework-free so both the server writer
 * (lib/server/log.ts) and the client log viewer can import it. The class-string
 * maps live under lib/** so Tailwind's content glob keeps them (the config
 * comment warns that maps outside those globs get tree-shaken).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogCategory =
  | "auth"
  | "invoice"
  | "ai"
  | "export"
  | "admin"
  | "system"
  | "client";

export const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

export const LOG_CATEGORIES: LogCategory[] = [
  "auth",
  "invoice",
  "ai",
  "export",
  "admin",
  "system",
  "client",
];

/**
 * The client-facing shape of a log entry as returned by /api/admin/logs. Dates
 * arrive as ISO strings over JSON; `meta` is arbitrary structured context.
 */
export interface LogEntry {
  _id: string;
  at: string;
  level: LogLevel;
  category: LogCategory;
  event: string;
  userId: string | null;
  message: string;
  meta?: Record<string, unknown> | null;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

/** Events the low-trust client beacon (POST /api/events) accepts. */
export type ClientEventType = "report.generated" | "invoice.viewed";

export interface ClientEventInput {
  event: ClientEventType;
  meta?: Record<string, unknown>;
}

/**
 * Level carries the color; category chips stay neutral so they don't compete.
 * Both-theme legible, aligned with statusPillClass in lib/invoice-status.ts.
 */
export const LOG_LEVEL_STYLES: Record<LogLevel, string> = {
  debug: "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-900/45 dark:text-amber-200",
  error: "bg-rose-100 text-rose-700 dark:bg-rose-900/45 dark:text-rose-200",
};

export const LOG_LEVEL_DOT: Record<LogLevel, string> = {
  debug: "bg-slate-400",
  info: "bg-blue-500",
  warn: "bg-amber-500",
  error: "bg-rose-500",
};

export const LOG_CATEGORY_LABEL: Record<LogCategory, string> = {
  auth: "Auth",
  invoice: "Invoice",
  ai: "AI",
  export: "Export",
  admin: "Admin",
  system: "System",
  client: "Client",
};

/** Shape shared by every log chip/badge: only the color pair differs. */
export const LOG_CHIP_BASE =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold";
