import mongoose from "mongoose";
import connectDB from "../lib/mongodb";
import User from "../models/User";

interface MigrationUser {
  _id: mongoose.Types.ObjectId;
  providerId?: unknown;
  providerIds?: unknown;
}

const toProviderIds = (providerIds: unknown, providerId: unknown): string[] => {
  const next = new Set<string>();

  if (Array.isArray(providerIds)) {
    providerIds.forEach((provider) => {
      if (typeof provider === "string" && provider.trim()) {
        next.add(provider.trim());
      }
    });
  }

  if (typeof providerId === "string" && providerId.trim()) {
    next.add(providerId.trim());
  }

  return Array.from(next);
};

const run = async () => {
  await connectDB();

  const users = (await User.find(
    {
      $or: [{ providerId: { $exists: true } }, { providerIds: { $exists: true } }],
    },
    { _id: 1, providerId: 1, providerIds: 1 }
  ).lean()) as MigrationUser[];

  if (!users.length) {
    console.log("No user records found to migrate.");
    return;
  }

  const operations = users.map((user) => {
    const providerIds = toProviderIds(user.providerIds, user.providerId);

    return {
      updateOne: {
        filter: { _id: user._id },
        update: {
          $set: { providerIds },
          $unset: { providerId: "" },
        },
      },
    };
  });

  const result = await User.bulkWrite(operations, { ordered: false });

  const totalUpdated = result.modifiedCount || 0;
  console.log(`Migration complete. Updated ${totalUpdated} user record(s).`);
};

run()
  .catch((error) => {
    console.error("Provider migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
