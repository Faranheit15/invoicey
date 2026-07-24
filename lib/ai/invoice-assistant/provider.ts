import type {
  InvoiceAssistantProviderInput,
  InvoiceAssistantProviderOutput,
} from "@/lib/ai/invoice-assistant/contracts";
import {
  INVOICE_ASSISTANT_SYSTEM_PROMPT,
  buildInvoiceAssistantUserPrompt,
} from "@/lib/ai/invoice-assistant/prompt";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_PROVIDER = "gemini";
const REQUEST_TIMEOUT_MS = 20_000;

interface GeminiPart {
  text?: string;
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[];
  };
  finishReason?: string;
}

interface GeminiPromptFeedback {
  blockReason?: string;
}

interface GeminiError {
  message?: string;
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: GeminiPromptFeedback;
  error?: GeminiError;
}

const getGeminiModel = () => {
  const model = process.env.GEMINI_MODEL?.trim();
  return model || DEFAULT_GEMINI_MODEL;
};

const getProvider = () => {
  return (process.env.INVOICE_AI_PROVIDER?.trim().toLowerCase() || DEFAULT_PROVIDER);
};

const getGeminiApiKey = () => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }
  return apiKey;
};

const extractResponseText = (response: GeminiGenerateContentResponse): string => {
  if (response.error?.message) {
    throw new Error(response.error.message);
  }

  if (response.promptFeedback?.blockReason) {
    throw new Error(
      `Prompt blocked by model safety filters: ${response.promptFeedback.blockReason}`
    );
  }

  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts
    .map((part) => part.text || "")
    .join("\n")
    .trim();

  if (!text) {
    if (candidate?.finishReason) {
      throw new Error(`No model output. Finish reason: ${candidate.finishReason}`);
    }
    throw new Error("No model output returned.");
  }

  return text;
};

export const generateInvoiceAssistantCompletion = async ({
  message,
  conversation,
  draft,
}: InvoiceAssistantProviderInput): Promise<InvoiceAssistantProviderOutput> => {
  const provider = getProvider();
  if (provider !== "gemini") {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }

  const apiKey = getGeminiApiKey();
  const model = getGeminiModel();

  const userPrompt = buildInvoiceAssistantUserPrompt({
    message,
    conversation,
    draft,
    currentDate: new Date().toISOString().slice(0, 10),
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: INVOICE_ASSISTANT_SYSTEM_PROMPT }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: userPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
            responseMimeType: "application/json",
          },
        }),
        signal: controller.signal,
      }
    );

    const payload = (await response.json()) as GeminiGenerateContentResponse;

    if (!response.ok) {
      throw new Error(
        payload?.error?.message ||
          `Gemini API request failed with status ${response.status}`
      );
    }

    const text = extractResponseText(payload);
    const candidate = payload.candidates?.[0];

    return {
      text,
      // Telemetry for observability. NEVER include the request URL — it carries
      // the Gemini API key in the query string.
      telemetry: {
        model,
        provider,
        userPrompt,
        durationMs: Date.now() - startedAt,
        responseChars: text.length,
        finishReason: candidate?.finishReason,
      },
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("AI request timed out. Please try again.");
    }

    const err = error as Error;
    throw new Error(`Unable to generate invoice draft: ${err.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
};
