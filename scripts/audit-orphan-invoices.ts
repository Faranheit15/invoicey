import mongoose from "mongoose";
import connectDB from "../lib/mongodb";
import Invoice from "../models/Invoice";

/**
 * Find (and optionally quarantine) legacy "orphan" invoices — rows with a
 * missing/null/empty userId that predate the non-empty userId guard. These
 * cannot leak through the app's userId-scoped queries, but they should not sit
 * in the collection untenanted either.
 *
 *   bun run audit:orphan-invoices            # dry run: list them
 *   bun run audit:orphan-invoices --apply    # soft-delete (quarantine) them
 *
 * Never hard-deletes: originals are preserved (is_deleted + quarantinedAt),
 * matching the repo's soft-delete convention.
 */
const APPLY = process.argv.includes("--apply");

const run = async () => {
  await connectDB();

  const orphanFilter = {
    $or: [
      { userId: { $exists: false } },
      { userId: null },
      { userId: "" },
    ],
  };

  const orphans = (await Invoice.find(orphanFilter, { _id: 1 }).lean()) as unknown as {
    _id: unknown;
  }[];

  if (!orphans.length) {
    console.log("No orphan invoices found. Every invoice has a userId.");
    return;
  }

  console.log(`Found ${orphans.length} orphan invoice(s) (missing/empty userId):`);
  orphans.forEach((o) => console.log(`  ${String(o._id)}`));

  if (!APPLY) {
    console.log(
      "\nDry run. Re-run with --apply to soft-delete (quarantine) these rows."
    );
    return;
  }

  const operations = orphans.map((o) => ({
    updateOne: {
      filter: { _id: o._id },
      update: { $set: { is_deleted: true, quarantinedAt: new Date() } },
    },
  }));

  const result = await Invoice.bulkWrite(operations, { ordered: false });
  console.log(
    `Quarantined ${result.modifiedCount} orphan invoice(s) (soft-deleted; originals preserved).`
  );
};

run()
  .catch((error) => {
    console.error("Orphan-invoice audit failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
