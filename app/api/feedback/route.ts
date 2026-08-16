import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/server/auth";
import connectDB from "@/lib/mongodb";
import Feedback from "@/models/Feedback";
import { recordActivity, logRouteError } from "@/lib/server/log";
import { FEEDBACK_CATEGORIES, MAX_FEEDBACK_LENGTH } from "@/lib/feedback";
import { createRateLimiter } from "@/lib/server/rate-limit";

const FEEDBACK_AUTH_MESSAGES = {
  EmailNotVerified: "Please verify your email before sending feedback.",
} as const;

const rateLimited = createRateLimiter({
  namespace: "feedback",
  limit: 10,
  windowMs: 10 * 60 * 1000,
});

export async function POST(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await requireUser(req);
  } catch (error: unknown) {
    return authErrorResponse(error, FEEDBACK_AUTH_MESSAGES);
  }

  await connectDB();
  try {
    if (rateLimited(userUid)) {
      return NextResponse.json(
        { error: "You've sent a lot of feedback just now. Try again shortly." },
        { status: 429 }
      );
    }

    const raw = (await req.json()) as {
      message?: unknown;
      rating?: unknown;
      category?: unknown;
      page?: unknown;
    };

    const message = typeof raw.message === "string" ? raw.message.trim() : "";
    if (!message) {
      return NextResponse.json(
        { error: "Please enter your feedback before sending." },
        { status: 400 }
      );
    }

    const category =
      typeof raw.category === "string" &&
      (FEEDBACK_CATEGORIES as string[]).includes(raw.category)
        ? raw.category
        : "other";

    let rating: number | undefined;
    const parsedRating = Number(raw.rating);
    if (Number.isFinite(parsedRating) && parsedRating >= 1 && parsedRating <= 5) {
      rating = Math.round(parsedRating);
    }

    const page = typeof raw.page === "string" ? raw.page.slice(0, 200) : "";

    const feedback = await Feedback.create({
      userId: userUid,
      message: message.slice(0, MAX_FEEDBACK_LENGTH),
      rating,
      category,
      page,
      status: "new",
    });

    recordActivity({
      userId: userUid,
      type: "feedback_submitted",
      meta: { category, rating },
    });

    return NextResponse.json(
      { message: "Thanks — your feedback was sent.", feedback },
      { status: 201 }
    );
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "POST /api/feedback",
      userId: userUid,
      category: "system",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await requireUser(req);
  } catch (error: unknown) {
    return authErrorResponse(error, FEEDBACK_AUTH_MESSAGES);
  }

  await connectDB();
  try {
    const feedback = await Feedback.find({ userId: userUid })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return NextResponse.json({ feedback });
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "GET /api/feedback",
      userId: userUid,
      category: "system",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
