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

/**
 * Total characters of history we are willing to pay to re-send on every turn.
 * Item-count alone was not a cost cap: 12 entries x MAX_MESSAGE_LENGTH is ~48k
 * characters of prompt per request, billed to the owner's key. Oldest entries
 * are dropped first, so the turn the user is actually replying to survives.
 */
const MAX_CONVERSATION_CHARS = 12_000;

/**
 * `draft` is serialized wholesale into the prompt, so its size IS the request
 * cost. Unbounded, a single POST could bill a megabyte of tokens. A real draft
 * — full company/client blocks plus dozens of line items — is a few KB, so this
 * leaves ample headroom while making the abuse case impossible.
 */
export const MAX_DRAFT_BYTES = 24_000;

/** Wired into `isClientError` in the route; keep the two in sync. */
export const DRAFT_TOO_LARGE_MESSAGE =
  "Invoice draft is too large to send to the AI assistant. Remove some line items and try again.";

const cleanMessage = (value: unknown): string => {
  return typeof value === "string" ? value.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
};

const draftByteLength = (draft: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(draft)).length;
  } catch {
    // Cyclic or otherwise non-serializable: it can never reach the prompt, so
    // treat it as over the cap rather than letting provider.ts throw a 500.
    return Number.POSITIVE_INFINITY;
  }
};

/** Newest-first budget: keep as much recent history as the char cap allows. */
const trimConversation = (
  entries: AssistantConversationEntry[]
): AssistantConversationEntry[] => {
  const kept: AssistantConversationEntry[] = [];
  let budget = MAX_CONVERSATION_CHARS;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    budget -= entry.content.length;
    if (budget < 0) break;
    kept.unshift(entry);
  }
  return kept;
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

  if (draftByteLength(payload.draft) > MAX_DRAFT_BYTES) {
    throw new Error(DRAFT_TOO_LARGE_MESSAGE);
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
    conversation: trimConversation(conversation),
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
