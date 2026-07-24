import mongoose, { Schema, Document } from "mongoose";
import type { LogLevel, LogCategory } from "@/lib/logs";

export interface ILogEntry extends Document {
  at: Date;
  level: LogLevel;
  category: LogCategory;
  event: string;
  userId: string | null;
  message: string;
  meta?: Record<string, unknown>;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  expireAt: Date;
}

const LogEntrySchema: Schema = new Schema({
  at: { type: Date, default: Date.now, required: true },
  level: {
    type: String,
    enum: ["debug", "info", "warn", "error"],
    default: "info",
    required: true,
  },
  category: { type: String, required: true },
  event: { type: String, required: true },
  userId: { type: String, default: null },
  message: { type: String, default: "" },
  // Arbitrary structured context (invoiceId, amount, prompt, stack, statusCode,
  // durationMs, ...). Redacted + size-capped by the writer before it lands here.
  meta: { type: Schema.Types.Mixed },
  requestId: { type: String },
  ip: { type: String },
  userAgent: { type: String },
  // Per-document TTL anchor. The writer computes this from level + category so
  // errors/audit persist far longer than verbose info/AI logs (see lib/server/log.ts).
  expireAt: { type: Date, required: true },
});

// Heterogeneous retention: each doc expires at its own `expireAt` (not a fixed
// collection-level TTL). expireAfterSeconds:0 means "expire at the date value".
LogEntrySchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
// Global stream (cursor sort) + the analytics/filter access paths.
LogEntrySchema.index({ at: -1 });
LogEntrySchema.index({ userId: 1, at: -1 });
LogEntrySchema.index({ category: 1, at: -1 });
LogEntrySchema.index({ level: 1, at: -1 });
LogEntrySchema.index({ event: 1, at: -1 });

export default mongoose.models.LogEntry ||
  mongoose.model<ILogEntry>("LogEntry", LogEntrySchema);
