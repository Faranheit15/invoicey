import {
  CURRENCY_OPTIONS,
  type InvoiceFormItem,
  type InvoiceFormState,
} from "@/lib/invoices";
import type {
  InvoiceAssistantPatch,
  InvoiceAssistantResponse,
  InvoiceAssistantResolution,
} from "@/lib/ai/invoice-assistant/contracts";

const REQUIRED_FIELDS = [
  "companyName",
  "billTo",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "items",
] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];

const MAX_MESSAGE_LENGTH = 1200;
const MAX_QUESTION_LENGTH = 260;
const MAX_FIELDS_LENGTH = 48;

const toTrimmedString = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

const toSafeText = (value: unknown, fallback = ""): string => {
  const text = toTrimmedString(value);
  if (!text) {
    return fallback;
  }
  return text.slice(0, MAX_MESSAGE_LENGTH);
};

const isValidDateParts = (year: number, month: number, day: number) => {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() + 1 === month &&
    candidate.getUTCDate() === day
  );
};

const toDateInputValue = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizeDateInput = (value: unknown): string | undefined => {
  const raw = toTrimmedString(value);
  if (!raw) {
    return undefined;
  }

  const exactMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (exactMatch) {
    const year = Number(exactMatch[1]);
    const month = Number(exactMatch[2]);
    const day = Number(exactMatch[3]);
    if (isValidDateParts(year, month, day)) {
      return `${exactMatch[1]}-${exactMatch[2]}-${exactMatch[3]}`;
    }
    return undefined;
  }

  const parsedDate = new Date(raw);
  if (Number.isNaN(parsedDate.getTime())) {
    return undefined;
  }

  return toDateInputValue(parsedDate);
};

const toNonNegativeNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(0, Number(parsed.toFixed(2)));
};

const toQuantity = (value: unknown): number | undefined => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(1, Number(parsed.toFixed(2)));
};

const normalizeItems = (value: unknown): InvoiceFormItem[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((item) => {
      const itemObject = item as Record<string, unknown>;
      const description = toTrimmedString(itemObject.description).slice(0, 250);
      const quantity = toQuantity(itemObject.quantity);
      const unitPrice = toNonNegativeNumber(itemObject.unitPrice);

      if (!description || quantity === undefined || unitPrice === undefined) {
        return null;
      }

      return {
        description,
        quantity,
        unitPrice,
      };
    })
    .filter((item): item is InvoiceFormItem => Boolean(item));

  if (normalized.length === 0) {
    return undefined;
  }

  return normalized.slice(0, 40);
};

const buildPatch = (rawPatch: unknown): InvoiceAssistantPatch => {
  if (!rawPatch || typeof rawPatch !== "object") {
    return {};
  }

  const patchObject = rawPatch as Record<string, unknown>;
  const patch: InvoiceAssistantPatch = {};

  const stringFieldKeys: Array<keyof Omit<InvoiceFormState, "items" | "discount" | "cgst" | "sgst" | "convenienceCharge" | "status">> =
    [
      "companyName",
      "companyEmail",
      "companyPhone",
      "companyAddress",
      "companyLogo",
      "billTo",
      "billToEmail",
      "billToAddress",
      "invoiceNumber",
      "terms",
      "notes",
      "paymentInfo",
    ];

  for (const fieldKey of stringFieldKeys) {
    const value = toTrimmedString(patchObject[fieldKey]);
    if (value) {
      patch[fieldKey] = value;
    }
  }

  const invoiceDate = normalizeDateInput(patchObject.invoiceDate);
  if (invoiceDate) {
    patch.invoiceDate = invoiceDate;
  }

  const dueDate = normalizeDateInput(patchObject.dueDate);
  if (dueDate) {
    patch.dueDate = dueDate;
  }

  const currency = toTrimmedString(patchObject.currency).toUpperCase();
  if (currency && CURRENCY_OPTIONS.includes(currency)) {
    patch.currency = currency;
  }

  const normalizedItems = normalizeItems(patchObject.items);
  if (normalizedItems) {
    patch.items = normalizedItems;
  }

  const discount = toNonNegativeNumber(patchObject.discount);
  if (discount !== undefined) {
    patch.discount = discount;
  }

  const cgst = toNonNegativeNumber(patchObject.cgst);
  if (cgst !== undefined) {
    patch.cgst = cgst;
  }

  const sgst = toNonNegativeNumber(patchObject.sgst);
  if (sgst !== undefined) {
    patch.sgst = sgst;
  }

  const convenienceCharge = toNonNegativeNumber(patchObject.convenienceCharge);
  if (convenienceCharge !== undefined) {
    patch.convenienceCharge = convenienceCharge;
  }

  return patch;
};

const normalizeResolution = (value: unknown): InvoiceAssistantResolution => {
  return value === "ready" ? "ready" : "needs_clarification";
};

const normalizeQuestions = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((question) => toTrimmedString(question))
    .filter((question) => Boolean(question))
    .map((question) => question.slice(0, MAX_QUESTION_LENGTH))
    .slice(0, 3);
};

const normalizeMissingFields = (value: unknown): RequiredField[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((field) => toTrimmedString(field).slice(0, MAX_FIELDS_LENGTH))
    .filter((field): field is RequiredField =>
      REQUIRED_FIELDS.includes(field as RequiredField)
    )
    .slice(0, REQUIRED_FIELDS.length);
};

const findJsonObject = (value: string): string => {
  const fencedMatch = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = value.indexOf("{");
  const lastBrace = value.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return value.slice(firstBrace, lastBrace + 1);
  }

  return value.trim();
};

export const parseAssistantJsonPayload = (rawText: string): unknown => {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("AI model returned an empty response.");
  }

  const jsonCandidate = findJsonObject(trimmed);
  try {
    return JSON.parse(jsonCandidate) as unknown;
  } catch {
    throw new Error("AI model returned an invalid JSON payload.");
  }
};

export const normalizeAssistantResponse = (value: unknown): InvoiceAssistantResponse => {
  const raw = (value || {}) as Record<string, unknown>;

  const patch = buildPatch(raw.patch);
  const questions = normalizeQuestions(raw.clarifyingQuestions);
  const missingFields = normalizeMissingFields(raw.missingFields);

  const hasPatch = Object.keys(patch).length > 0;
  const hasQuestions = questions.length > 0;
  const hasMissingFields = missingFields.length > 0;

  const baseResolution = normalizeResolution(raw.resolution);
  const resolution: InvoiceAssistantResolution =
    baseResolution === "ready" && (hasQuestions || hasMissingFields) ? "needs_clarification" :
    baseResolution === "needs_clarification" && hasPatch && !hasQuestions && !hasMissingFields ? "ready" :
    baseResolution;

  const fallbackMessage =
    resolution === "ready"
      ? "I filled the invoice details in the form."
      : "I need a little more information to complete this invoice.";

  return {
    resolution,
    assistantMessage: toSafeText(raw.assistantMessage, fallbackMessage),
    clarifyingQuestions: questions,
    missingFields,
    patch,
  };
};
