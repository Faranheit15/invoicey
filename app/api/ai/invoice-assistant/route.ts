import { NextRequest, NextResponse } from "next/server";
import admin, { ensureFirebaseAdmin } from "@/lib/firebase-admin";
import {
  generateInvoiceAssistantResponse,
  validateAssistantRequest,
} from "@/lib/ai/invoice-assistant/service";

const verifyAuth = async (req: NextRequest): Promise<string> => {
  try {
    ensureFirebaseAdmin();
  } catch (error: unknown) {
    throw new Error("AuthConfigurationError", { cause: error });
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }

  const token = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    if (!decodedToken.uid) {
      throw new Error("Unauthorized");
    }
    if (
      decodedToken.firebase?.sign_in_provider === "password" &&
      !decodedToken.email_verified
    ) {
      throw new Error("EmailNotVerified");
    }
    return decodedToken.uid;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "EmailNotVerified") {
      throw error;
    }
    throw new Error("Unauthorized", { cause: error });
  }
};

const authErrorResponse = (error: unknown) => {
  const err = error as Error;
  if (err.message === "AuthConfigurationError") {
    return NextResponse.json(
      { error: "Server authentication is misconfigured" },
      { status: 500 }
    );
  }
  if (err.message === "EmailNotVerified") {
    return NextResponse.json(
      { error: "Please verify your email before using AI invoice assistant." },
      { status: 403 }
    );
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
};

const isClientError = (message: string) => {
  return (
    message.includes("Please enter a message") ||
    message.includes("Invoice draft context is required")
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
  try {
    await verifyAuth(req);
  } catch (error: unknown) {
    return authErrorResponse(error);
  }

  try {
    const rawPayload = await req.json();
    const request = validateAssistantRequest(rawPayload);
    const response = await generateInvoiceAssistantResponse(request);

    return NextResponse.json(response);
  } catch (error: unknown) {
    const err = error as Error;

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
