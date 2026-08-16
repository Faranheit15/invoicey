import type { InvoiceFormItem, InvoiceFormState } from "@/lib/invoices";

export type AssistantConversationRole = "user" | "assistant";

export interface AssistantConversationEntry {
  role: AssistantConversationRole;
  content: string;
}

/**
 * What the assistant is allowed to write into the draft.
 *
 * A STRICT SUBSET of `InvoiceFormState`, and deliberately so. Three field
 * groups are missing on purpose, and each absence is a rule:
 *
 *  - **`cgst` / `sgst`.** Tax is per line now and is DERIVED from the rate and
 *    the place of supply. The old prompt told the model to split a single "tax"
 *    request evenly between the two heads, which is right for an intra-State
 *    supply and silently wrong for an inter-State one. The model emits
 *    `items[].taxRatePercent`; the app does the arithmetic.
 *  - **`taxTreatment`.** Registration status is derived from the GSTIN on the
 *    user's business profile, never asserted by a sentence. A model that could
 *    set it could turn an unregistered person's document into one headed "TAX
 *    INVOICE" — the exact shape §32 CGST exists to prevent.
 *  - **`companyGstin`.** The supplier's own registration is not a thing a
 *    sentence asserts — it is copied from the business profile, which is the
 *    only place it can be verified against the user's actual registration. A
 *    model that could set it could also silently re-head an unregistered
 *    person's document as a tax invoice via the derivation.
 *
 * `billToGstin` IS accepted, and is the one identity field that is: the client's
 * GSTIN is a plausible thing to read out of "bill Nova Health, GSTIN
 * 27AAPFU0939F1ZV". It carries its own checksum, so a hallucinated one does not
 * survive `normalization.ts` — which is a stronger guarantee than any other
 * string field in this patch has, and the reason it is safe to accept while
 * `companyGstin` is not.
 *
 * The field set here must stay identical to `prompt.ts`, `normalization.ts` and
 * `apply-patch.ts` (CLAUDE.md). It does NOT have to match `InvoiceFormState`.
 */
export interface InvoiceAssistantPatch {
  companyName?: string;
  companyEmail?: string;
  companyPhone?: string;
  companyAddress?: string;
  companyLogo?: string;
  billTo?: string;
  billToEmail?: string;
  billToAddress?: string;
  /** The CLIENT's GSTIN. Checksum-validated, and dropped outright if wrong. */
  billToGstin?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  terms?: string;
  notes?: string;
  currency?: string;
  items?: InvoiceFormItem[];
  discount?: number;
  convenienceCharge?: number;
  paymentInfo?: string;
  /** Two-digit GST state code, or "96" for a recipient outside India. */
  placeOfSupplyStateCode?: string;
  /** Printed name for the code above. Derived by us, never taken from the model. */
  placeOfSupplyLabel?: string;
}

export interface InvoiceAssistantRequest {
  message: string;
  conversation: AssistantConversationEntry[];
  draft: InvoiceFormState;
}

export type InvoiceAssistantResolution = "ready" | "needs_clarification";

export interface InvoiceAssistantResponse {
  resolution: InvoiceAssistantResolution;
  assistantMessage: string;
  clarifyingQuestions: string[];
  missingFields: string[];
  patch: InvoiceAssistantPatch;
}

export interface InvoiceAssistantProviderInput {
  message: string;
  conversation: AssistantConversationEntry[];
  draft: InvoiceFormState;
}

export interface InvoiceAssistantTelemetry {
  model: string;
  provider: string;
  /** The full user prompt sent to the model (system prompt + serialized draft). */
  userPrompt: string;
  durationMs: number;
  responseChars: number;
  finishReason?: string;
}

export interface InvoiceAssistantProviderOutput {
  text: string;
  telemetry: InvoiceAssistantTelemetry;
}
