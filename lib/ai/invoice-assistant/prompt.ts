import {
  CURRENCY_OPTIONS,
  type InvoiceFormState,
  type InvoiceStatus,
} from "@/lib/invoices";
import type { AssistantConversationEntry } from "@/lib/ai/invoice-assistant/contracts";

const REQUIRED_FIELDS = [
  "companyName",
  "billTo",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "items",
] as const;

const SUPPORTED_STATUSES: InvoiceStatus[] = ["draft", "sent", "paid", "overdue"];

interface BuildInvoiceAssistantPromptParams {
  message: string;
  conversation: AssistantConversationEntry[];
  draft: InvoiceFormState;
  currentDate: string;
}

export const INVOICE_ASSISTANT_SYSTEM_PROMPT = `You are Invoicey's invoice extraction assistant.
You transform natural language into structured invoice fields.
Return only valid JSON, with no markdown and no code fences.

Output JSON schema:
{
  "resolution": "ready" | "needs_clarification",
  "assistantMessage": string,
  "clarifyingQuestions": string[],
  "missingFields": string[],
  "patch": {
    "companyName"?: string,
    "companyEmail"?: string,
    "companyPhone"?: string,
    "companyAddress"?: string,
    "companyLogo"?: string,
    "billTo"?: string,
    "billToEmail"?: string,
    "billToAddress"?: string,
    "invoiceNumber"?: string,
    "invoiceDate"?: "YYYY-MM-DD",
    "dueDate"?: "YYYY-MM-DD",
    "terms"?: string,
    "notes"?: string,
    "currency"?: ${CURRENCY_OPTIONS.map((currency) => `"${currency}"`).join(" | ")},
    "items"?: Array<{"description": string, "quantity": number, "unitPrice": number}>,
    "discount"?: number,
    "cgst"?: number,
    "sgst"?: number,
    "convenienceCharge"?: number,
    "paymentInfo"?: string
  }
}

Rules:
1. Never invent values that are not implied by user input or existing draft.
2. Use the current draft as context and only include changed/new fields in patch.
3. Keep quantity >= 1 and unitPrice >= 0.
4. For relative dates (for example: "due in 30 days"), compute concrete YYYY-MM-DD values using today's date.
5. Set "resolution" to "needs_clarification" when required invoice fields are still missing or ambiguous.
6. Ask concise follow-up questions in "clarifyingQuestions".
7. Include missing required fields in "missingFields" using exact keys.
8. Keep "assistantMessage" concise and practical.
9. Keep status unchanged unless explicitly asked; do not emit status in patch.
10. If currency is unknown, ask for clarification.
11. Tax is expressed as CGST and SGST amounts (not percentages). When the user asks for a single tax (for example "include 10% tax"), compute the tax amount on the pre-tax subtotal and split it evenly between "cgst" and "sgst" (half each). Emit absolute amounts, never percentages, and never emit a "tax" field.
`;

const serializeConversation = (conversation: AssistantConversationEntry[]) => {
  if (!conversation.length) {
    return "[]";
  }

  const limited = conversation.slice(-10);
  return JSON.stringify(limited, null, 2);
};

const serializeDraft = (draft: InvoiceFormState) => {
  return JSON.stringify(
    {
      ...draft,
      status: SUPPORTED_STATUSES.includes(draft.status) ? draft.status : "draft",
      requiredFields: REQUIRED_FIELDS,
    },
    null,
    2
  );
};

export const buildInvoiceAssistantUserPrompt = ({
  message,
  conversation,
  draft,
  currentDate,
}: BuildInvoiceAssistantPromptParams) => {
  return [
    `Today: ${currentDate}`,
    `Supported currencies: ${CURRENCY_OPTIONS.join(", ")}`,
    "Current draft:",
    serializeDraft(draft),
    "Conversation history:",
    serializeConversation(conversation),
    "Latest user message:",
    message.trim(),
  ].join("\n\n");
};
