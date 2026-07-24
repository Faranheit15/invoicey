import mongoose, { Schema, Document } from "mongoose";
import type { FeedbackCategory, FeedbackStatus } from "@/lib/feedback";

export interface IFeedback extends Document {
  userId: string;
  message: string;
  rating?: number;
  category: FeedbackCategory;
  status: FeedbackStatus;
  page?: string;
  createdAt: Date;
}

const FeedbackSchema: Schema = new Schema({
  userId: { type: String, required: true },
  message: { type: String, required: true },
  rating: { type: Number, min: 1, max: 5 },
  category: {
    type: String,
    enum: ["bug", "idea", "praise", "other"],
    default: "other",
  },
  status: {
    type: String,
    enum: ["new", "reviewed", "archived"],
    default: "new",
  },
  page: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});

// Admin triage queue (by status) + per-user timeline + global recent.
FeedbackSchema.index({ status: 1, createdAt: -1 });
FeedbackSchema.index({ userId: 1, createdAt: -1 });
FeedbackSchema.index({ createdAt: -1 });

export default mongoose.models.Feedback ||
  mongoose.model<IFeedback>("Feedback", FeedbackSchema);
