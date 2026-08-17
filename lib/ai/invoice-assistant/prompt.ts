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
    "billToGstin"?: string,
    "invoiceNumber"?: string,
    "invoiceDate"?: "YYYY-MM-DD",
    "dueDate"?: "YYYY-MM-DD",
    "terms"?: string,
    "notes"?: string,
    "currency"?: ${CURRENCY_OPTIONS.map((currency) => `"${currency}"`).join(" | ")},
    "items"?: Array<{
      "description": string,
      "quantity": number,
      "unitPrice": number,
      "hsnSac"?: string,
      "unit"?: string,
      "discount"?: number,
      "taxRatePercent"?: number
    }>,
    "discount"?: number,
    "convenienceCharge"?: number,
    "paymentInfo"?: string,
    "placeOfSupplyStateCode"?: string
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
11. Tax is per line. Emit "taxRatePercent" on each item, using only 0, 5, 18 or 40 (also 0.25 for rough stones and 3 for bullion). Never emit tax amounts, and never emit "cgst", "sgst" or "tax" — the app derives CGST, SGST and IGST from the rate and the place of supply. An even CGST/SGST split is wrong for an inter-State supply, so do not attempt one.
12. Never invent a GSTIN, a PAN or an HSN/SAC code. Only echo a GSTIN the user typed. "billToGstin" is the CLIENT's 15-character GSTIN and is the only GSTIN you may emit; never emit the user's own GSTIN. Emit "hsnSac" only when the user gave one; it is digits only, 4, 6 or 8 long, and a services code (SAC) always begins "99".
13. Never emit a registration status. Whether the user is registered under GST comes from the GSTIN saved on their business profile, never from a sentence.
14. "placeOfSupplyStateCode" is a two-digit GST state code (for example "27" for Maharashtra, "29" for Karnataka), or "96" when the recipient is outside India. Emit it only when the user names the client's state or country. Never emit a state name in this field.
15. Never invent an "invoiceNumber". The draft already carries the next number in the user's series; echo one only if the user states it themselves, and then only in the legal format — at most 16 characters, using letters, digits, "-" and "/" and nothing else (Rule 46(b)).
16. "unit" is a UQC code such as NOS, PCS, KGS, HRS or DAY; use OTH when unsure.
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
