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
});

export default models.User || model("User", UserSchema);
