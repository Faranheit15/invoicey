import mongoose from "mongoose";
import connectDB from "../lib/mongodb";
import User from "../models/User";

// Unlike migrate-provider-ids and migrate-tax-to-gst, which deliberately leave
// the legacy field in place so old and new document shapes can coexist, this one
// destroys what it touches — and that is the entire point. `accessToken` held a
// Firebase ID token and `refreshToken` a Firebase refresh token, which never
// expires and can be exchanged for ID tokens indefinitely until revoked. Every
// copy left in the collection is a standing account-takeover kit, so there is
// nothing worth preserving for reference. Not an inconsistency with the other
// migrations: a secret is not legacy data.
const run = async () => {
  await connectDB();

  const filter = {
    $or: [{ accessToken: { $exists: true } }, { refreshToken: { $exists: true } }],
  };

  const affected = await User.countDocuments(filter);

  if (!affected) {
    console.log("No user records carry a stored token.");
    return;
  }

  console.log(`Found ${affected} user record(s) with a stored token.`);

  // `strict: false` is load-bearing: the fields were just deleted from the
  // schema, and Mongoose's default strict mode silently drops unknown paths from
  // an update payload — the $unset would be a no-op that reports success.
  const result = await User.updateMany(
    filter,
    { $unset: { accessToken: "", refreshToken: "" } },
    { strict: false }
  );

  console.log(`Purge complete. Updated ${result.modifiedCount} user record(s).`);
  console.log(
    "The tokens are gone from the collection. Existing database backups and " +
      "snapshots still contain them — rotate or expire those separately, and " +
      "revoke refresh tokens in Firebase for any account you believe was exposed."
  );
};

run()
  .catch((error) => {
    console.error("Token purge failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
