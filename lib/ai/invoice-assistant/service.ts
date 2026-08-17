import type {
  AssistantConversationEntry,
  AssistantInputSource,
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
 * The extraction cap, and it is deliberately a different number from
 * `MAX_MESSAGE_LENGTH`.
 *
 * A composed description is a sentence or two; 4,000 characters is already
 * generous and silently truncating one loses nothing. A PASTE is different in
 * both directions: it is legitimately longer (a client mail with a signature
 * block and a quoted thread runs past 4,000 easily), and it is the one input
 * where truncation is dangerous — cutting a mail in half drops line items, and
 * the user gets a confidently short invoice with no sign anything was lost.
 *
 * So a paste gets 8,000 characters (~2K tokens, roughly ₹0.05 of Gemini input
 * at 2.5 Flash rates) and is REJECTED rather than truncated when it exceeds
 * them. Eight thousand is about four pages of email — past any real client
 * brief, and far short of a payload worth abusing. The route's 64 KB body cap
 * and the 24 KB draft cap still bound the request independently.
 */
export const MAX_PASTED_TEXT_LENGTH = 8_000;

/** Wired into `isClientError` in the route; keep the two in sync. */
export const PASTED_TEXT_TOO_LARGE_MESSAGE =
  "That paste is too long for the assistant. Trim it to the part describing the work (about 8,000 characters) and try again.";

const normalizeSource = (value: unknown): AssistantInputSource =>
  value === "paste" ? "paste" : "prompt";

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

const cleanPastedText = (value: unknown): string => {
  return typeof value === "string"
    ? value.trim().slice(0, MAX_PASTED_TEXT_LENGTH)
    : "";
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
  const source = normalizeSource(payload.source);

  // Length is checked BEFORE any trimming for a paste, so an over-long one is
  // refused out loud instead of quietly losing its second half.
  if (
    source === "paste" &&
    typeof payload.message === "string" &&
    payload.message.trim().length > MAX_PASTED_TEXT_LENGTH
  ) {
    throw new Error(PASTED_TEXT_TOO_LARGE_MESSAGE);
  }

  const message =
    source === "paste"
      ? cleanPastedText(payload.message)
      : cleanMessage(payload.message);

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
    source,
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
