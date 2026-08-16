import type {
  InvoiceAssistantPatch,
} from "@/lib/ai/invoice-assistant/contracts";
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
import { GST_STATE_CODES, OTHER_COUNTRY_STATE_CODE } from "@/lib/gstin";

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

/**
 * Defence in depth. `normalization.ts` already whitelists these on the server;
 * this runs client-side, and the client is the last line before a value reaches
 * the form and then the printed document. Both copies drop silently rather than
 * coercing — a rate we do not recognise is not a rate we should charge.
 */
const cleanHsnSac = (value: string | undefined): string | undefined => {
  const raw = cleanString(value);
  return isValidHsnSac(raw) ? raw : undefined;
};

const cleanUnit = (value: string | undefined): string | undefined => {
  const raw = cleanString(value).toUpperCase().slice(0, MAX_UNIT_LENGTH);
  return raw || undefined;
};

const cleanTaxRate = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Number(value.toFixed(2));
  return isAcceptedGstRate(rounded) ? rounded : undefined;
};

const cleanStateCode = (value: string | undefined): string | undefined => {
  const raw = cleanString(value);
  if (raw === OTHER_COUNTRY_STATE_CODE) {
    return raw;
  }
  return Object.prototype.hasOwnProperty.call(GST_STATE_CODES, raw)
    ? raw
    : undefined;
};

const normalizeItems = (items: InvoiceFormItem[] | undefined): InvoiceFormItem[] | null => {
  if (!items?.length) {
    return null;
  }

  const normalizedItems = items
    .map((item) => {
      const hsnSac = cleanHsnSac(item.hsnSac);
      const unit = cleanUnit(item.unit);
      const discount = toNonNegativeNumber(item.discount);
      const taxRatePercent = cleanTaxRate(item.taxRatePercent);

      return {
        description: cleanString(item.description),
        quantity: Number.isFinite(item.quantity)
          ? Math.max(1, Number(item.quantity.toFixed(2)))
          : 1,
        unitPrice: Number.isFinite(item.unitPrice)
          ? Math.max(0, Number(item.unitPrice.toFixed(2)))
          : 0,
        // Spread-when-present: an absent field must stay absent, because that
        // absence is how a line says "written before per-line tax existed".
        ...(hsnSac !== undefined ? { hsnSac } : {}),
        ...(unit !== undefined ? { unit } : {}),
        ...(discount !== null ? { discount } : {}),
        ...(taxRatePercent !== undefined ? { taxRatePercent } : {}),
      };
    })
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

  // No `cgst`/`sgst` blocks: the assistant cannot set tax amounts any more.
  // Tax is derived from `items[].taxRatePercent` and the supply geography, and
  // an even CGST/SGST split — what the old prompt asked for — is silently wrong
  // for every inter-State supply.
  const placeOfSupplyStateCode = cleanStateCode(patch.placeOfSupplyStateCode);
  if (placeOfSupplyStateCode !== undefined) {
    nextState = {
      ...nextState,
      placeOfSupplyStateCode,
      // The label is derived here too, never taken from the patch: it is the
      // part that gets printed.
      placeOfSupplyLabel: placeOfSupplyLabelFor(placeOfSupplyStateCode),
      // The user did not move this; the assistant did, from what they described.
      placeOfSupplyOverridden: true,
    };
    appliedFields.push("placeOfSupplyStateCode");
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
