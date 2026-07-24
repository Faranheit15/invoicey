/**
 * Shared feedback taxonomy + presentation, framework-free so both the submit
 * form and the admin triage view import it. Class-string maps live under lib/**
 * so Tailwind's content glob keeps them.
 */

export type FeedbackCategory = "bug" | "idea" | "praise" | "other";
export type FeedbackStatus = "new" | "reviewed" | "archived";

export const FEEDBACK_CATEGORIES: FeedbackCategory[] = [
  "bug",
  "idea",
  "praise",
  "other",
];
export const FEEDBACK_STATUSES: FeedbackStatus[] = [
  "new",
  "reviewed",
  "archived",
];

export const FEEDBACK_CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: "Bug",
  idea: "Idea",
  praise: "Praise",
  other: "Other",
};

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "New",
  reviewed: "Reviewed",
  archived: "Archived",
};

/** Client-facing shape as returned by the feedback APIs (dates are ISO strings). */
export interface FeedbackRecord {
  _id: string;
  userId: string;
  message: string;
  rating?: number | null;
  category: FeedbackCategory;
  status: FeedbackStatus;
  page?: string;
  createdAt: string;
}

export interface FeedbackInput {
  message: string;
  rating?: number;
  category?: FeedbackCategory;
  page?: string;
}

export const MAX_FEEDBACK_LENGTH = 5000;
