import {
  CURRENCY_OPTIONS,
  type InvoiceFormItem,
  type InvoiceFormState,
} from "@/lib/invoices";
import {
  MAX_UNIT_LENGTH,
  isAcceptedGstRate,
  isValidHsnSac,
  placeOfSupplyLabelFor,
} from "@/lib/gst-rates";
import {
  GST_STATE_CODES,
  OTHER_COUNTRY_STATE_CODE,
  isValidGstin,
  normalizeGstin,
} from "@/lib/gstin";
import {
  isValidInvoiceNumber,
  normalizeInvoiceNumber,
} from "@/lib/invoice-number";
import {
  MAX_ITEM_QUANTITY,
  MAX_ITEM_UNIT_PRICE,
  MAX_MONEY_VALUE,
} from "@/lib/invoice-domain";
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

/**
 * A money amount, DROPPED rather than clamped when it exceeds the ceiling.
 *
 * The floor is a clamp — a negative is unambiguously a sign error and 0 is the
 * only sane reading. The ceiling is not, and the difference matters more now
 * that the input can be a pasted blob: extraction reads amounts out of someone
 * else's prose, where "2,50,000" and "2.5L" and a stray "9999999999999" in a
 * phone number all look like numbers. Clamping a runaway to
 * `MAX_ITEM_UNIT_PRICE` would put ₹10,00,00,000 on an invoice and call it the
 * user's intent; dropping it leaves the field empty, where they will see it.
 * `mapFormStateToPayload` and the API clamp too, but by then the number is
 * already in front of the user as if they had typed it.
 */
const toNonNegativeNumber = (
  value: unknown,
  limit: number = MAX_MONEY_VALUE
): number | undefined => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const rounded = Number(parsed.toFixed(2));
  if (rounded > limit) {
    return undefined;
  }
  return Math.max(0, rounded);
};

const toQuantity = (value: unknown): number | undefined => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const rounded = Number(parsed.toFixed(2));
  if (rounded > MAX_ITEM_QUANTITY) {
    return undefined;
  }
  return Math.max(1, rounded);
};

/**
 * A rate the model emitted, WHITELISTED against the real slab table.
 *
 * A hallucinated 15% must never reach form state — it would be printed on a
 * document, charged to a client, and filed in a return. A retired 12% is kept:
 * it is a real rate withdrawn on 22 Sep 2025, a back-dated invoice legitimately
 * carries it, and `validateInvoice` raises it as a warning rather than a drop.
 */
const normalizeTaxRate = (value: unknown): number | undefined => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const rounded = Number(parsed.toFixed(2));
  return isAcceptedGstRate(rounded) ? rounded : undefined;
};

/** Rule 46(f) format only — digits, 4/6/8 long. Anything else is dropped. */
const normalizeHsnSac = (value: unknown): string | undefined => {
  const raw = toTrimmedString(value);
  return isValidHsnSac(raw) ? raw : undefined;
};

/** UQC: free text, upper-cased and capped. A wrong unit is not worth a drop. */
const normalizeUnit = (value: unknown): string | undefined => {
  const raw = toTrimmedString(value).toUpperCase().slice(0, MAX_UNIT_LENGTH);
  return raw || undefined;
};

/**
 * The client's GSTIN, or nothing.
 *
 * DELIBERATELY OUTSIDE the generic `stringFieldKeys` loop: a GSTIN is not free
 * text, it is a checksummed identifier, and a wrong one is worse than an absent
 * one — the recipient loses their input tax credit and the supplier has to
 * issue a credit note plus a fresh invoice. So this hard-validates through
 * `lib/gstin` (structure AND mod-36 check digit) and DROPS silently on failure
 * rather than passing a plausible-looking hallucination through to a printed
 * document. Never write a second checksum: `isValidGstin` is the only one.
 */
const normalizeClientGstin = (value: unknown): string | undefined => {
  const gstin = normalizeGstin(toTrimmedString(value));
  return isValidGstin(gstin) ? gstin : undefined;
};

/** A real GST state code, or "96" (outside India). Never a free-text state. */
const normalizeStateCode = (value: unknown): string | undefined => {
  const raw = toTrimmedString(value);
  if (raw === OTHER_COUNTRY_STATE_CODE) {
    return raw;
  }
  return Object.prototype.hasOwnProperty.call(GST_STATE_CODES, raw)
    ? raw
    : undefined;
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
      const unitPrice = toNonNegativeNumber(
        itemObject.unitPrice,
        MAX_ITEM_UNIT_PRICE
      );

      if (!description || quantity === undefined || unitPrice === undefined) {
        return null;
      }

      const hsnSac = normalizeHsnSac(itemObject.hsnSac);
      const unit = normalizeUnit(itemObject.unit);
      const discount = toNonNegativeNumber(itemObject.discount);
      const taxRatePercent = normalizeTaxRate(itemObject.taxRatePercent);

      // Spread-when-present, never `?? 0`: an ABSENT rate means "this line was
      // never given one", and writing a 0 would claim the model chose zero-rated.
      return {
        description,
        quantity,
        unitPrice,
        ...(hsnSac !== undefined ? { hsnSac } : {}),
        ...(unit !== undefined ? { unit } : {}),
        ...(discount !== undefined ? { discount } : {}),
        ...(taxRatePercent !== undefined ? { taxRatePercent } : {}),
      };
    })
    .filter((item): item is InvoiceFormItem => Boolean(item));

  if (normalized.length === 0) {
    return undefined;
  }

  return normalized.slice(0, 40);
};

/** The keys of `T` whose type is exactly `string` (unions and enums excluded). */
type StringKeys<T> = {
  [K in keyof T]-?: string extends NonNullable<T[K]> ? K : never;
}[keyof T];

const buildPatch = (rawPatch: unknown): InvoiceAssistantPatch => {
  if (!rawPatch || typeof rawPatch !== "object") {
    return {};
  }

  const patchObject = rawPatch as Record<string, unknown>;
  const patch: InvoiceAssistantPatch = {};

  // Every key that is a plain `string` on BOTH the patch and the form state.
  // Deriving it from the intersection (rather than `keyof Omit<InvoiceFormState,
  // ...>`, as this did) is what lets the patch be a strict SUBSET of the form:
  // adding a form field no longer breaks this file, while renaming or retyping
  // one still does — which is the half of the coupling worth keeping.
  const stringFieldKeys: Array<
    Extract<StringKeys<InvoiceAssistantPatch>, StringKeys<InvoiceFormState>>
  > =
    [
      "companyName",
      "companyEmail",
      "companyPhone",
      "companyAddress",
      "companyLogo",
      "billTo",
      "billToEmail",
      "billToAddress",
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

  /**
   * The invoice number is handled apart from the other string fields because it
   * is the one with a statutory format. Rule 46(b) allows 16 characters of
   * letters, digits, `-` and `/`; a model that returns "INV #2026/0001" would
   * otherwise land it in form state and block the save it was meant to speed
   * up. DROPPED rather than corrected — the draft already carries the number
   * the server suggested, and an invented one is worse than none.
   */
  const suggestedNumber = normalizeInvoiceNumber(
    toTrimmedString(patchObject.invoiceNumber)
  );
  if (suggestedNumber && isValidInvoiceNumber(suggestedNumber)) {
    patch.invoiceNumber = suggestedNumber;
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

  // `cgst`, `sgst`, `tax`, `taxTreatment` and `companyGstin` are READ AND
  // DISCARDED. They are absent from `InvoiceAssistantPatch` (see the comment
  // there), so a model that emits them simply has them ignored — no field, no
  // application, no drift. `billToGstin` is the one identity field accepted,
  // and only because it validates against its own check digit.
  const billToGstin = normalizeClientGstin(patchObject.billToGstin);
  if (billToGstin !== undefined) {
    patch.billToGstin = billToGstin;
  }

  const placeOfSupplyStateCode = normalizeStateCode(
    patchObject.placeOfSupplyStateCode
  );
  if (placeOfSupplyStateCode !== undefined) {
    patch.placeOfSupplyStateCode = placeOfSupplyStateCode;
    // The LABEL is ours, derived from our own table. A model-supplied place
    // name is the one part of this that gets printed on the document, so it
    // never comes from the model.
    patch.placeOfSupplyLabel = placeOfSupplyLabelFor(placeOfSupplyStateCode);
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
