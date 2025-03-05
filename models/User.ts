import { Schema, model, models } from "mongoose";

const UserSchema = new Schema({
  uid: { type: String, required: true, unique: true }, // Firebase UID
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  avatar: { type: String }, // Profile picture URL
  providerId: { type: String, default: "google.com" },
  lastLoginAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
  accessToken: { type: String }, // Store if needed
  refreshToken: { type: String }, // Store if needed
});

export default models.User || model("User", UserSchema);
