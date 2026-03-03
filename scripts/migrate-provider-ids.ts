import mongoose from "mongoose";
import connectDB from "../lib/mongodb";
import User from "../models/User";
import { normalizeAvatarUrl, sanitizeProviderId } from "../lib/user-profile";

interface MigrationUser {
  _id: mongoose.Types.ObjectId;
  providerId?: unknown;
  providerIds?: unknown;
  avatar?: unknown;
}

const toProviderIds = (providerIds: unknown, providerId: unknown): string[] => {
  const next = new Set<string>();

  if (Array.isArray(providerIds)) {
    providerIds.forEach((provider) => {
      const sanitized = sanitizeProviderId(provider);
      if (sanitized) {
        next.add(sanitized);
      }
    });
  }

  const legacyProvider = sanitizeProviderId(providerId);
  if (legacyProvider) {
    next.add(legacyProvider);
  }

  if (next.size === 0) {
    next.add("password");
  }

  return Array.from(next);
};

const run = async () => {
  await connectDB();

  const users = (await User.find(
    {
      $or: [{ providerId: { $exists: true } }, { providerIds: { $exists: true } }],
    },
    { _id: 1, providerId: 1, providerIds: 1, avatar: 1 }
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
          $set: { providerIds, avatar: normalizeAvatarUrl(user.avatar) },
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
