import mongoose from "mongoose";
import connectDB from "../lib/mongodb";
import User from "../models/User";

/**
 * Backfill `role` / `status` on legacy User docs that predate those fields, so
 * admin aggregations and `.lean()` reads (which do NOT apply schema defaults)
 * and the last-active-admin count behave predictably.
 *
 *   bun run backfill:user-role
 */
const run = async () => {
  await connectDB();

  const roleResult = await User.updateMany(
    { role: { $exists: false } },
    { $set: { role: "user" } }
  );
  const statusResult = await User.updateMany(
    { status: { $exists: false } },
    { $set: { status: "active" } }
  );

  console.log(
    `Backfill complete. role set on ${roleResult.modifiedCount} user(s), ` +
      `status set on ${statusResult.modifiedCount} user(s).`
  );
};

run()
  .catch((error) => {
    console.error("User role/status backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
