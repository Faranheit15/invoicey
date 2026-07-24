import { Schema, model, models } from "mongoose";
import { sanitizeProviderId } from "@/lib/user-profile";

const UserSchema = new Schema({
  uid: { type: String, required: true, unique: true }, // Firebase UID
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  avatar: { type: String }, // Profile picture URL
  providerIds: {
    type: [String],
    default: [],
    set: (values: unknown) => {
      if (!Array.isArray(values)) {
        return [];
      }

      return Array.from(
        new Set(
          values
            .map((providerId) => sanitizeProviderId(providerId))
            .filter((providerId): providerId is string => Boolean(providerId))
        )
      );
    },
  },
  lastLoginAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
  accessToken: { type: String }, // Store if needed
  refreshToken: { type: String }, // Store if needed
  // Authorization for the admin surface. Not `required` so legacy docs hydrate
  // and new docs get the defaults; admin reads use `.lean()`, which does NOT
  // apply schema defaults, so those code paths must `?? "user"` / `?? "active"`.
  role: { type: String, enum: ["user", "admin"], default: "user" },
  status: { type: String, enum: ["active", "suspended"], default: "active" },
  // Manual (not { timestamps: true }, which would collide with the manual
  // createdAt above and the login funnel). Set only by admin mutations.
  updatedAt: { type: Date },
});

// Admin-wide scans: the last-active-admin count and admin/suspended filters.
UserSchema.index({ role: 1, status: 1 });
// Active-user trends + default users-list sort.
UserSchema.index({ lastLoginAt: -1 });
// Signups-over-time.
UserSchema.index({ createdAt: 1 });

export default models.User || model("User", UserSchema);
