import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/server/auth";
import {
  DRAFT_TOO_LARGE_MESSAGE,
  generateInvoiceAssistantResponse,
  validateAssistantRequest,
} from "@/lib/ai/invoice-assistant/service";
import { reserveDailyAiQuota } from "@/lib/ai/invoice-assistant/quota";
import { logEvent } from "@/lib/server/log";
import { consumeRateLimit } from "@/lib/server/rate-limit";

const AI_AUTH_MESSAGES = {
  EmailNotVerified:
    "Please verify your email before using AI invoice assistant.",
} as const;

/**
 * This is the only endpoint that spends real money per call, so it is capped
 * twice. The burst limiter is in-memory and therefore per-lambda (see
 * lib/server/rate-limit.ts) — it stops a runaway client loop, not a determined
 * attacker. The durable per-user daily quota is the actual spend ceiling.
 *
 * 10/minute is far above any human pace: each turn is a ~2-20s round trip plus
 * the time to read the reply and type the next instruction, so a user cannot
 * reach it by hand, but a script hits it on the seventh second.
 */
const BURST_LIMIT = {
  namespace: "ai-invoice-assistant",
  limit: 10,
  windowMs: 60_000,
} as const;

// The draft is JSON-capped in the service; this rejects the absurd payload
// before Next has to buffer and parse it at all.
const MAX_BODY_BYTES = 64 * 1024;

const isClientError = (message: string) => {
  return (
    message.includes("Please enter a message") ||
    message.includes("Invoice draft context is required") ||
    message.includes(DRAFT_TOO_LARGE_MESSAGE)
  );
};

const classifyAiProviderError = (message: string) => {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("quota") ||
    normalized.includes("rate limit") ||
    normalized.includes("status 429") ||
    normalized.includes(" 429 ")
  ) {
    return {
      status: 429,
      error:
        "AI usage limit reached for the configured Gemini key. Check Gemini quota/billing and try again.",
    };
  }

  if (
    normalized.includes("api key not valid") ||
    normalized.includes("invalid api key") ||
    normalized.includes("permission denied") ||
    normalized.includes("service disabled") ||
    normalized.includes("access not configured")
  ) {
    return {
      status: 503,
      error:
        "Gemini API access is not configured for this key. Verify GEMINI_API_KEY, API enablement, and billing.",
    };
  }

  if (normalized.includes("timed out")) {
    return {
      status: 504,
      error: "AI request timed out. Please try again in a moment.",
    };
  }

  if (
    normalized.includes("invalid json payload") ||
    normalized.includes("no model output") ||
    normalized.includes("empty response")
  ) {
    return {
      status: 502,
      error: "AI provider returned an invalid response. Please retry.",
    };
  }

  if (normalized.includes("model") && normalized.includes("not found")) {
    return {
      status: 503,
      error:
        "Configured Gemini model is unavailable. Verify GEMINI_MODEL and provider access.",
    };
  }

  return null;
};

export async function POST(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await requireUser(req);
  } catch (error: unknown) {
    return authErrorResponse(error, AI_AUTH_MESSAGES);
  }

  if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: DRAFT_TOO_LARGE_MESSAGE },
      { status: 413 }
    );
  }

  const burst = consumeRateLimit(BURST_LIMIT, userUid);
  if (burst.limited) {
    return NextResponse.json(
      {
        error:
          "You're sending AI requests faster than we can bill for. Wait a moment and try again.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(burst.retryAfterSeconds) },
      }
    );
  }

  try {
    const rawPayload = await req.json();
    const request = validateAssistantRequest(rawPayload);

    // Reserved here, after validation and immediately before the provider call,
    // because the reservation IS the unit of spend: taking one for a request
    // that gets rejected as malformed would bill the user's allowance for a call
    // that never reaches Gemini.
    const quota = await reserveDailyAiQuota(userUid);
    if (quota.exceeded) {
      logEvent({
        level: "warn",
        category: "ai",
        event: "ai.quota_exceeded",
        userId: userUid,
        meta: { used: quota.used, limit: quota.limit },
      });
      return NextResponse.json(
        {
          error: `You've used your ${quota.limit} AI assistant requests for today. The limit resets on a rolling 24-hour basis — your invoice draft is untouched.`,
        },
        { status: 429 }
      );
    }

    const { response, telemetry } = await generateInvoiceAssistantResponse(
      request
    );

    // Full prompt captured per the owner's explicit ask; the writer size-caps
    // and redacts it. No key can leak — telemetry never carries the request URL.
    logEvent({
      category: "ai",
      event: "ai.request",
      userId: userUid,
      message: request.message,
      meta: {
        model: telemetry.model,
        provider: telemetry.provider,
        fullPrompt: telemetry.userPrompt,
        conversationLen: request.conversation.length,
        promptChars: telemetry.userPrompt.length,
      },
    });
    logEvent({
      category: "ai",
      event: "ai.response",
      userId: userUid,
      meta: {
        model: telemetry.model,
        durationMs: telemetry.durationMs,
        responseChars: telemetry.responseChars,
        finishReason: telemetry.finishReason,
        resolution: response.resolution,
        patchFields: Object.keys(response.patch ?? {}),
      },
    });

    return NextResponse.json(response);
  } catch (error: unknown) {
    const err = error as Error;

    // Log every non-validation failure as an AI error (provider/config/unknown).
    if (!isClientError(err.message)) {
      logEvent({
        level: "error",
        category: "ai",
        event: "ai.error",
        userId: userUid,
        message: err.message,
      });
    }

    if (err.message.includes("Missing GEMINI_API_KEY")) {
      return NextResponse.json(
        {
          error:
            "AI assistant is not configured on the server. Add GEMINI_API_KEY to environment variables.",
        },
        { status: 503 }
      );
    }
    if (err.message.includes("Unsupported AI provider")) {
      return NextResponse.json(
        { error: "Configured AI provider is not supported by this deployment." },
        { status: 503 }
      );
    }

    if (isClientError(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    const providerError = classifyAiProviderError(err.message);
    if (providerError) {
      return NextResponse.json(
        { error: providerError.error },
        { status: providerError.status }
      );
    }

    return NextResponse.json(
      { error: "Unable to process invoice details with AI right now." },
      { status: 500 }
    );
  }
}
