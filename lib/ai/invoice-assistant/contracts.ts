import type { InvoiceFormItem, InvoiceFormState } from "@/lib/invoices";

export type AssistantConversationRole = "user" | "assistant";

export interface AssistantConversationEntry {
  role: AssistantConversationRole;
  content: string;
}

export interface InvoiceAssistantPatch {
  companyName?: string;
  companyEmail?: string;
  companyPhone?: string;
  companyAddress?: string;
  companyLogo?: string;
  billTo?: string;
  billToEmail?: string;
  billToAddress?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  terms?: string;
  notes?: string;
  currency?: string;
  items?: InvoiceFormItem[];
  discount?: number;
  cgst?: number;
  sgst?: number;
  convenienceCharge?: number;
  paymentInfo?: string;
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
