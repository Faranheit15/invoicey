import type {
  InvoiceAssistantPatch,
} from "@/lib/ai/invoice-assistant/contracts";
import {
  CURRENCY_OPTIONS,
  type InvoiceFormItem,
  type InvoiceFormState,
} from "@/lib/invoices";

const toDateInputValue = (value: string) => {
  const trimmed = value.trim();
  const exactDatePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (exactDatePattern.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const cleanString = (value: string | undefined) => {
  return typeof value === "string" ? value.trim() : "";
};

const normalizeItems = (items: InvoiceFormItem[] | undefined): InvoiceFormItem[] | null => {
  if (!items?.length) {
    return null;
  }

  const normalizedItems = items
    .map((item) => ({
      description: cleanString(item.description),
      quantity: Number.isFinite(item.quantity)
        ? Math.max(1, Number(item.quantity.toFixed(2)))
        : 1,
      unitPrice: Number.isFinite(item.unitPrice)
        ? Math.max(0, Number(item.unitPrice.toFixed(2)))
        : 0,
    }))
    .filter((item) => item.description.length > 0);

  return normalizedItems.length ? normalizedItems : null;
};

const toNonNegativeNumber = (value: number | undefined): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Number(value.toFixed(2)));
};

interface ApplyPatchResult {
  nextState: InvoiceFormState;
  appliedFields: string[];
}

export const applyInvoiceAssistantPatch = (
  currentState: InvoiceFormState,
  patch: InvoiceAssistantPatch
): ApplyPatchResult => {
  let nextState: InvoiceFormState = { ...currentState };
  const appliedFields: string[] = [];

  const applyStringField = (field: keyof InvoiceAssistantPatch) => {
    const value = cleanString(patch[field] as string | undefined);
    if (!value) {
      return;
    }

    nextState = {
      ...nextState,
      [field]: value,
    };
    appliedFields.push(field);
  };

  applyStringField("companyName");
  applyStringField("companyEmail");
  applyStringField("companyPhone");
  applyStringField("companyAddress");
  applyStringField("companyLogo");
  applyStringField("billTo");
  applyStringField("billToEmail");
  applyStringField("billToAddress");
  applyStringField("invoiceNumber");
  applyStringField("terms");
  applyStringField("notes");
  applyStringField("paymentInfo");

  const invoiceDate = patch.invoiceDate ? toDateInputValue(patch.invoiceDate) : "";
  if (invoiceDate) {
    nextState = {
      ...nextState,
      invoiceDate,
    };
    appliedFields.push("invoiceDate");
  }

  const dueDate = patch.dueDate ? toDateInputValue(patch.dueDate) : "";
  if (dueDate) {
    nextState = {
      ...nextState,
      dueDate,
    };
    appliedFields.push("dueDate");
  }

  const currency = cleanString(patch.currency).toUpperCase();
  if (currency && CURRENCY_OPTIONS.includes(currency)) {
    nextState = {
      ...nextState,
      currency,
    };
    appliedFields.push("currency");
  }

  const items = normalizeItems(patch.items);
  if (items) {
    nextState = {
      ...nextState,
      items,
    };
    appliedFields.push("items");
  }

  const discount = toNonNegativeNumber(patch.discount);
  if (discount !== null) {
    nextState = {
      ...nextState,
      discount,
    };
    appliedFields.push("discount");
  }

  const tax = toNonNegativeNumber(patch.tax);
  if (tax !== null) {
    nextState = {
      ...nextState,
      tax,
    };
    appliedFields.push("tax");
  }

  const convenienceCharge = toNonNegativeNumber(patch.convenienceCharge);
  if (convenienceCharge !== null) {
    nextState = {
      ...nextState,
      convenienceCharge,
    };
    appliedFields.push("convenienceCharge");
  }

  return {
    nextState,
    appliedFields,
  };
};
