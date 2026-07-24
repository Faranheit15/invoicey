import type {
  AssistantConversationEntry,
  InvoiceAssistantRequest,
  InvoiceAssistantResponse,
  InvoiceAssistantTelemetry,
} from "@/lib/ai/invoice-assistant/contracts";
import { generateInvoiceAssistantCompletion } from "@/lib/ai/invoice-assistant/provider";
import {
  normalizeAssistantResponse,
  parseAssistantJsonPayload,
} from "@/lib/ai/invoice-assistant/normalization";

const MAX_MESSAGE_LENGTH = 4000;
const MAX_CONVERSATION_ITEMS = 12;

const cleanMessage = (value: unknown): string => {
  return typeof value === "string" ? value.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
};

export const validateAssistantRequest = (value: unknown): InvoiceAssistantRequest => {
  const payload = (value || {}) as Partial<InvoiceAssistantRequest>;
  const message = cleanMessage(payload.message);

  if (!message) {
    throw new Error("Please enter a message describing the invoice.");
  }

  if (!payload.draft || typeof payload.draft !== "object") {
    throw new Error("Invoice draft context is required.");
  }

  const conversation: AssistantConversationEntry[] = Array.isArray(payload.conversation)
    ? payload.conversation
        .filter((entry) => entry && typeof entry === "object")
        .map((entry): AssistantConversationEntry => ({
          role: entry.role === "assistant" ? "assistant" : "user",
          content: cleanMessage(entry.content),
        }))
        .filter((entry) => entry.content.length > 0)
        .slice(-MAX_CONVERSATION_ITEMS)
    : [];

  return {
    message,
    conversation,
    draft: payload.draft as InvoiceAssistantRequest["draft"],
  };
};

export interface InvoiceAssistantResult {
  response: InvoiceAssistantResponse;
  telemetry: InvoiceAssistantTelemetry;
}

export const generateInvoiceAssistantResponse = async (
  request: InvoiceAssistantRequest
): Promise<InvoiceAssistantResult> => {
  const completion = await generateInvoiceAssistantCompletion(request);
  const rawPayload = parseAssistantJsonPayload(completion.text);
  const response = normalizeAssistantResponse(rawPayload);
  return { response, telemetry: completion.telemetry };
};
