/**
 * Proves a RESTORED database is usable — the other half of scripts/backup-to-r2.ts.
 *
 * An untested backup is a hypothesis. This script is what turns "the bytes came
 * back" into "the data is usable", and it is meant to run against a throwaway
 * mongod that the restore drill has just `mongorestore`d into. It NEVER touches
 * the live database: it refuses to run against process.env.MONGODB_URI and
 * takes its own VERIFY_MONGODB_URI instead, because a verification script that
 * can be pointed at production by a typo is a liability.
 *
 * Usage (see docs/runbooks/backup-and-restore.md for the full drill):
 *   VERIFY_MONGODB_URI="mongodb://127.0.0.1:27017/invoicey" bun run backup:verify
 *
 * Optional: BACKUP_MIN_INVOICES / BACKUP_MIN_USERS to assert against the
 * previous drill's counts, so a restore that came back 90% empty fails loudly
 * rather than passing on "non-zero".
 */

import mongoose from "mongoose";
import Invoice from "../models/Invoice";
import User from "../models/User";
import Feedback from "../models/Feedback";
import LogEntry from "../models/LogEntry";
import { resolveRecordAmounts } from "../lib/invoice-domain";
import type { InvoiceRecord } from "../lib/invoices";

const failures: string[] = [];
const check = (ok: boolean, description: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${description}`);
  if (!ok) failures.push(description);
};

const verify = async () => {
  const uri = process.env.VERIFY_MONGODB_URI;
  if (!uri) throw new Error("VERIFY_MONGODB_URI is not set.");
  if (process.env.MONGODB_URI && uri === process.env.MONGODB_URI) {
    throw new Error(
      "VERIFY_MONGODB_URI equals MONGODB_URI. Point this at the restored throwaway instance, never at production."
    );
  }

  // `autoIndex: false` is load-bearing, not tidiness. Mongoose creates a
  // schema's indexes on first model use by default — which would build the very
  // indexes this script then checks for, and the check would pass on a restore
  // that had lost every one of them. That matters most for LogEntry's
  // `expireAt` TTL, whose silent absence ends log retention without any error.
  // It also keeps a verification run read-only against the database it is
  // pointed at.
  await mongoose.connect(uri, { autoIndex: false });
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database handle after connect.");

  const models = [Invoice, User, Feedback, LogEntry];

  const present = new Set(
    (await db.listCollections().toArray()).map((c) => c.name)
  );
  for (const model of models) {
    check(present.has(model.collection.name), `collection ${model.collection.name} exists`);
  }

  // Non-zero, not "some": a restore that produced empty collections is the
  // failure this whole exercise exists to catch, and it looks like success from
  // every angle except this one.
  const invoiceCount = await Invoice.estimatedDocumentCount();
  const userCount = await User.estimatedDocumentCount();
  check(invoiceCount > 0, `invoices restored (${invoiceCount})`);
  check(userCount > 0, `users restored (${userCount})`);
  check(
    invoiceCount >= Number(process.env.BACKUP_MIN_INVOICES || 1),
    `invoice count at or above the previous drill's floor`
  );
  check(
    userCount >= Number(process.env.BACKUP_MIN_USERS || 1),
    `user count at or above the previous drill's floor`
  );

  // Indexes are the silent casualty of a bad dump/restore. Losing LogEntry's
  // `expireAt` TTL index would not break a single query — it would just turn
  // log retention off forever, which is a compliance failure nobody notices.
  for (const model of models) {
    const live = await db.collection(model.collection.name).indexes();
    const liveKeys = new Set(live.map((index) => JSON.stringify(index.key)));
    for (const [key] of model.schema.indexes()) {
      check(
        liveKeys.has(JSON.stringify(key)),
        `${model.collection.name} index ${JSON.stringify(key)} survived the restore`
      );
    }
  }
  const logIndexes = await db.collection(LogEntry.collection.name).indexes();
  check(
    logIndexes.some((index) => index.expireAfterSeconds !== undefined),
    "LogEntry TTL index still has expireAfterSeconds (retention still enforced)"
  );

  // The difference between "the bytes came back" and "the data is usable":
  // recompute one invoice's money from its restored line items and confirm it
  // still lands on the total that was stored with it.
  const sample = (await Invoice.findOne({ is_deleted: { $ne: true } })
    .lean()
    .exec()) as unknown as (InvoiceRecord & { total?: number }) | null;
  if (!sample) {
    check(false, "a sample invoice could be read back");
  } else if (typeof sample.total !== "number") {
    // Older documents predate stored totals; nothing to compare against.
    console.log("SKIP  sampled invoice has no stored total to compare");
  } else {
    // subtotal/total are stripped first: resolveRecordAmounts honours stored
    // values with `??`, so leaving them in would compare the number to itself.
    const { subtotal, total, ...withoutTotals } = sample;
    void subtotal;
    void total;
    const recomputed = resolveRecordAmounts(withoutTotals as unknown as InvoiceRecord);
    check(
      Math.abs(recomputed.total - sample.total) < 0.01,
      `sampled invoice recomputes to its stored total (${recomputed.total} vs ${sample.total})`
    );
  }

  if (failures.length) {
    throw new Error(`${failures.length} restore check(s) failed:\n - ${failures.join("\n - ")}`);
  }
  console.log(
    `\nRestore verified at ${new Date().toISOString()}. ` +
      "Record this date in docs/runbooks/backup-and-restore.md — " +
      '"when was the last successful restore?" must have an answer with a date on it.'
  );
};

verify()
  .catch((error) => {
    console.error("RESTORE VERIFICATION FAILED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
