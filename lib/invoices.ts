import {
  MAX_ITEM_QUANTITY,
  MAX_ITEM_UNIT_PRICE,
  MAX_MONEY_VALUE,
  clampToLimit,
  computeTotals,
  resolveTaxContext,
} from "@/lib/invoice-domain";
import {
  deriveSupplyKind,
  documentTypeFor,
  type DocumentType,
  type SupplyKind,
  type TaxTreatment,
} from "@/lib/gst-supply";
import {
  isValidGstin,
  stateCodeFromGstin,
  stateNameFromCode,
} from "@/lib/gstin";
import { formatDateLong as formatCalendarDateLong } from "@/lib/format-date";

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

export interface InvoiceLineItem {
  name: string;
  quantity: number;
  price: number;
  /** Rule 46(f). Digits only; SAC (services) always begins "99". */
  hsnSac?: string;
  /** UQC code — free text, capped, `OTH` as the fallback. */
  unit?: string;
  /** Per-line discount, absolute. */
  discount?: number;
  /** Full GST rate for this line. */
  taxRatePercent?: number;
  /**
   * Derived but STORED: an issued document must keep the numbers it was issued
   * with, whatever a later rate-table edit says.
   */
  taxableValue?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
}

export interface InvoiceRecord {
  _id: string;
  userId: string;
  companyName: string;
  companyEmail?: string;
  companyPhone?: string;
  companyAddress?: string;
  companyLogo?: string;
  billTo: string;
  billToEmail?: string;
  billToAddress?: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  terms?: string;
  notes?: string;
  currency: string;
  items: InvoiceLineItem[];
  subtotal?: number;
  discount?: number;
  /** Pre-migration single tax field. Still read, never written. */
  tax?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  taxableValue?: number;
  roundOff?: number;
  convenienceCharge: number;
  paymentInfo?: string;
  status?: InvoiceStatus;
  is_deleted?: boolean;
  total: number;
  createdAt: string;

  // --- Phase 2 GST fields. ALL optional: Mongo holds documents written by four
  // different versions of this app, and an ABSENT `taxTreatment` is what marks
  // a document as pre-Phase-2 (see `resolveTaxContext`).
  taxTreatment?: TaxTreatment;
  /** Derived from `taxTreatment`, stored so the printed heading cannot drift. */
  documentType?: DocumentType;
  reverseCharge?: boolean;
  supplierStateCode?: string;
  placeOfSupplyStateCode?: string;
  placeOfSupplyLabel?: string;
  placeOfSupplyOverridden?: boolean;
  /** Derived from the geography, stored for the audit trail. */
  supplyKind?: SupplyKind;
  recipientIsSez?: boolean;
  recipientIsOutsideIndia?: boolean;
  /** Export/SEZ: IGST-with-refund (true) vs LUT/bond (false). */
  withPaymentOfTax?: boolean;
  lutArn?: string;
  countryOfDestination?: string;
}

export interface InvoiceFormItem {
  description: string;
  quantity: number;
  unitPrice: number;
  hsnSac?: string;
  unit?: string;
  discount?: number;
  taxRatePercent?: number;
}

/**
 * The invoice-level GST fields, as the editor holds them.
 *
 * These are now MEMBERS of `InvoiceFormState` (via `extends` below) rather than
 * a separate intersection. They were kept apart while the domain layer landed
 * because `lib/ai/invoice-assistant/normalization.ts` derived its string-field
 * key list from `keyof Omit<InvoiceFormState, ...>` and assigned each key into
 * `InvoiceAssistantPatch`, so any new form key failed to typecheck until the AI
 * contract grew the same key. That coupling is gone: the normalizer now derives
 * its list from the INTERSECTION of the two types' string fields, so the patch
 * is free to be a strict subset of the form.
 *
 * `taxTreatment` is the one OPTIONAL member, and its optionality is
 * load-bearing. An absent `taxTreatment` means "written before Phase 2" and is
 * what keeps such a document on the legacy money formula (see
 * `resolveTaxContext`). It must stay distinguishable from an explicit "none".
 */
export interface InvoiceGstFormFields {
  /** ABSENT means pre-Phase-2. Never give this a default in a mapper. */
  taxTreatment?: TaxTreatment;
  reverseCharge: boolean;
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
  placeOfSupplyLabel: string;
  placeOfSupplyOverridden: boolean;
  recipientIsSez: boolean;
  recipientIsOutsideIndia: boolean;
  withPaymentOfTax: boolean;
  lutArn: string;
  countryOfDestination: string;
}

/**
 * @deprecated The GST fields are part of `InvoiceFormState` now. Kept as an
 * alias so the mappers' call sites and any in-flight code keep compiling.
 */
export type InvoiceFormStateWithGst = InvoiceFormState;

export interface InvoiceFormState extends InvoiceGstFormFields {
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  companyAddress: string;
  companyLogo: string;
  billTo: string;
  billToEmail: string;
  billToAddress: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  terms: string;
  notes: string;
  currency: string;
  status: InvoiceStatus;
  items: InvoiceFormItem[];
  discount: number;
  cgst: number;
  sgst: number;
  convenienceCharge: number;
  paymentInfo: string;
}

export interface InvoicePayload extends Partial<InvoiceGstFormFields> {
  /** Derived server-side from `taxTreatment`; sent only as a hint. */
  documentType?: DocumentType;
  /** Derived server-side from the geography; sent only as a hint. */
  supplyKind?: SupplyKind;
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  companyAddress: string;
  companyLogo: string;
  billTo: string;
  billToEmail: string;
  billToAddress: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  terms: string;
  notes: string;
  currency: string;
  status: InvoiceStatus;
  items: InvoiceFormItem[];
  discount: number;
  cgst: number;
  sgst: number;
  convenienceCharge: number;
  paymentInfo: string;
}

export const CURRENCY_OPTIONS = ["INR", "USD", "EUR", "GBP", "AED"];

export const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  AED: "د.إ",
};

const toDateInputValue = (date: Date) => {
  return date.toISOString().split("T")[0];
};

const toSafeDateInputValue = (value?: string) => {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return toDateInputValue(date);
};

/**
 * The seller-side values a saved business profile can pre-fill. Deliberately a
 * plain optional bag rather than the profile type itself: this module is pure
 * and is used by tests and by the AI patch path, so it must not learn about a
 * Mongoose model.
 */
export interface InvoiceFormSeed {
  companyName?: string;
  companyEmail?: string;
  companyPhone?: string;
  companyAddress?: string;
  companyLogo?: string;
  currency?: string;
  terms?: string;
  paymentInfo?: string;
  dueDays?: number;
  /**
   * Seller-side GST identity, carried over from the saved profile.
   *
   * `taxTreatment` is NOT a question the editor asks. The profile route derives
   * it from the GSTIN the user typed there (a valid GSTIN ⇒ "gst", none ⇒
   * "none", composition being the one explicit opt-in), and it arrives here
   * already decided. See docs/design/phase-2-gst-correctness.md §2.3.
   */
  taxTreatment?: TaxTreatment;
  supplierStateCode?: string;
  lutArn?: string;
}

/**
 * Profile -> seed. Empty strings become `undefined` so a half-filled profile
 * falls back to the defaults rather than blanking a field the user expected to
 * see prefilled.
 */
export const profileToSeed = (
  profile:
    | {
        companyName?: string;
        companyEmail?: string;
        companyPhone?: string;
        companyAddress?: string;
        companyLogo?: string;
        defaultCurrency?: string;
        defaultTerms?: string;
        defaultPaymentInfo?: string;
        defaultDueDays?: number;
        taxTreatment?: TaxTreatment;
        supplierStateCode?: string;
        lutArn?: string;
      }
    | null
    | undefined
): InvoiceFormSeed =>
  !profile
    ? {}
    : {
        companyName: profile.companyName || undefined,
        companyEmail: profile.companyEmail || undefined,
        companyPhone: profile.companyPhone || undefined,
        companyAddress: profile.companyAddress || undefined,
        companyLogo: profile.companyLogo || undefined,
        currency: profile.defaultCurrency || undefined,
        terms: profile.defaultTerms || undefined,
        paymentInfo: profile.defaultPaymentInfo || undefined,
        dueDays: profile.defaultDueDays,
        taxTreatment: profile.taxTreatment || undefined,
        supplierStateCode: profile.supplierStateCode || undefined,
        lutArn: profile.lutArn || undefined,
      };

export const createDefaultInvoiceFormState = (
  seed: InvoiceFormSeed = {}
): InvoiceFormState => {
  const invoiceDate = new Date();
  const dueDate = new Date();
  // Clamped here rather than trusted: the seed comes from a stored profile, and
  // a nonsense dueDays would otherwise produce an invalid date silently.
  const dueDays = Number.isFinite(seed.dueDays)
    ? Math.min(365, Math.max(0, Math.round(seed.dueDays as number)))
    : 14;
  dueDate.setDate(dueDate.getDate() + dueDays);

  return {
    companyName: seed.companyName ?? "",
    companyEmail: seed.companyEmail ?? "",
    companyPhone: seed.companyPhone ?? "",
    companyAddress: seed.companyAddress ?? "",
    companyLogo: seed.companyLogo ?? "",
    billTo: "",
    billToEmail: "",
    billToAddress: "",
    invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
    invoiceDate: toDateInputValue(invoiceDate),
    dueDate: toDateInputValue(dueDate),
    terms: seed.terms ?? "Payment due within 14 days.",
    notes: "",
    currency: seed.currency ?? "INR",
    status: "draft",
    items: [{ description: "", quantity: 1, unitPrice: 0 }],
    discount: 0,
    cgst: 0,
    sgst: 0,
    convenienceCharge: 0,
    paymentInfo: seed.paymentInfo ?? "",

    // A NEW invoice always has an explicit treatment: "none" until the profile
    // says otherwise. This is safe only because the editor no longer offers the
    // hand-typed CGST/SGST boxes — while it did, defaulting here would have
    // silently zeroed the tax a user typed. Absence still means "pre-Phase-2",
    // and only `mapInvoiceRecordToFormState` can produce it.
    taxTreatment: seed.taxTreatment ?? "none",
    reverseCharge: false,
    supplierStateCode: seed.supplierStateCode ?? "",
    placeOfSupplyStateCode: seed.supplierStateCode ?? "",
    placeOfSupplyLabel: seed.supplierStateCode
      ? stateNameFromCode(seed.supplierStateCode)
      : "",
    placeOfSupplyOverridden: false,
    recipientIsSez: false,
    recipientIsOutsideIndia: false,
    withPaymentOfTax: false,
    lutArn: seed.lutArn ?? "",
    countryOfDestination: "",
  };
};

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * The editor's live preview. Takes the same route as the server: one
 * `resolveTaxContext` call decides whether the two flat amounts still drive the
 * tax (a draft that has never been through the GST fields) or the per-line
 * rates do. Nothing here recomputes anything the server would compute
 * differently.
 */
export const calculateInvoiceTotals = (
  form: {
    items: InvoiceFormItem[];
    cgst: number;
    sgst: number;
    discount: number;
    convenienceCharge: number;
  } & Partial<InvoiceGstFormFields>
) =>
  computeTotals({
    items: form.items,
    discount: form.discount,
    convenienceCharge: form.convenienceCharge,
    tax: resolveTaxContext({
      taxTreatment: form.taxTreatment,
      reverseCharge: form.reverseCharge,
      supplyKind: supplyKindForForm(form),
      supplierStateCode: form.supplierStateCode,
      withPaymentOfTax: form.withPaymentOfTax,
      legacyCgst: form.cgst,
      legacySgst: form.sgst,
    }),
  });

/**
 * `supplyKind` is never stored on form state — it is a pure function of the
 * geography fields, and a stored copy is one more thing that can go stale while
 * the user is still typing. It is derived here, derived again server-side, and
 * only the server's answer is persisted.
 */
const supplyKindForForm = (
  form: Partial<InvoiceGstFormFields>
): SupplyKind | undefined =>
  form.taxTreatment === undefined
    ? undefined
    : deriveSupplyKind({
        supplierStateCode: form.supplierStateCode ?? "",
        placeOfSupplyStateCode: form.placeOfSupplyStateCode ?? "",
        recipientIsSez: form.recipientIsSez ?? false,
        recipientIsOutsideIndia: form.recipientIsOutsideIndia ?? false,
      });

/**
 * DB shape -> UI shape.
 *
 * The GST fields are copied through only when the record HAS them: an absent
 * `taxTreatment` must stay absent all the way back to the payload, because that
 * absence is what keeps a pre-Phase-2 invoice on the legacy money formula when
 * it is re-saved.
 */
export const mapInvoiceRecordToFormState = (
  invoice: Partial<InvoiceRecord>
): InvoiceFormState => {
  // Only `taxTreatment` is conditional: its ABSENCE is the pre-Phase-2 marker,
  // and `"taxTreatment" in form` has to stay false for such a record. The rest
  // are ordinary defaulted form fields, so they are always present — a "" state
  // code cannot be mistaken for anything, and having them always defined is
  // what lets the editor bind to them without a `?? ""` at every input.
  const treatment: Partial<Pick<InvoiceGstFormFields, "taxTreatment">> =
    invoice.taxTreatment !== undefined
      ? { taxTreatment: invoice.taxTreatment }
      : {};

  return {
    ...treatment,
    reverseCharge: invoice.reverseCharge ?? false,
    supplierStateCode: invoice.supplierStateCode ?? "",
    placeOfSupplyStateCode: invoice.placeOfSupplyStateCode ?? "",
    placeOfSupplyLabel: invoice.placeOfSupplyLabel ?? "",
    placeOfSupplyOverridden: invoice.placeOfSupplyOverridden ?? false,
    recipientIsSez: invoice.recipientIsSez ?? false,
    recipientIsOutsideIndia: invoice.recipientIsOutsideIndia ?? false,
    withPaymentOfTax: invoice.withPaymentOfTax ?? false,
    lutArn: invoice.lutArn ?? "",
    countryOfDestination: invoice.countryOfDestination ?? "",
    companyName: invoice.companyName || "",
    companyEmail: invoice.companyEmail || "",
    companyPhone: invoice.companyPhone || "",
    companyAddress: invoice.companyAddress || "",
    companyLogo: invoice.companyLogo || "",
    billTo: invoice.billTo || "",
    billToEmail: invoice.billToEmail || "",
    billToAddress: invoice.billToAddress || "",
    invoiceNumber: invoice.invoiceNumber || "",
    invoiceDate: toSafeDateInputValue(invoice.invoiceDate),
    dueDate: toSafeDateInputValue(invoice.dueDate),
    terms: invoice.terms || "",
    notes: invoice.notes || "",
    currency: invoice.currency || "INR",
    status: invoice.status || "draft",
    items:
      invoice.items?.length
        ? invoice.items.map((item) => ({
            description: item.name || "",
            quantity: toNumber(item.quantity, 1),
            unitPrice: toNumber(item.price, 0),
            ...(item.hsnSac !== undefined ? { hsnSac: item.hsnSac } : {}),
            ...(item.unit !== undefined ? { unit: item.unit } : {}),
            ...(item.discount !== undefined
              ? { discount: toNumber(item.discount, 0) }
              : {}),
            ...(item.taxRatePercent !== undefined
              ? { taxRatePercent: toNumber(item.taxRatePercent, 0) }
              : {}),
          }))
        : [{ description: "", quantity: 1, unitPrice: 0 }],
    discount: toNumber(invoice.discount, 0),
    cgst: toNumber(invoice.cgst ?? invoice.tax, 0),
    sgst: toNumber(invoice.sgst, 0),
    convenienceCharge: toNumber(invoice.convenienceCharge, 0),
    paymentInfo: invoice.paymentInfo || "",
  };
};

/**
 * UI shape -> wire shape. Ceilings as well as floors, and the derived GST
 * fields (`documentType`, `supplyKind`) computed here purely as a hint: the API
 * re-derives both and ignores whatever arrives, so a client cannot head an
 * unregistered document "TAX INVOICE".
 */
export const mapFormStateToPayload = (
  form: InvoiceFormState
): InvoicePayload => {
  const gst: Partial<InvoiceGstFormFields> & {
    documentType?: DocumentType;
    supplyKind?: SupplyKind;
  } = {};
  if (form.taxTreatment !== undefined) {
    gst.taxTreatment = form.taxTreatment;
    gst.documentType = documentTypeFor(form.taxTreatment);
    gst.supplyKind = supplyKindForForm(form);
    gst.reverseCharge = form.reverseCharge ?? false;
    gst.supplierStateCode = (form.supplierStateCode ?? "").trim();
    gst.placeOfSupplyStateCode = (form.placeOfSupplyStateCode ?? "").trim();
    gst.placeOfSupplyLabel = (form.placeOfSupplyLabel ?? "").trim();
    gst.placeOfSupplyOverridden = form.placeOfSupplyOverridden ?? false;
    gst.recipientIsSez = form.recipientIsSez ?? false;
    gst.recipientIsOutsideIndia = form.recipientIsOutsideIndia ?? false;
    gst.withPaymentOfTax = form.withPaymentOfTax ?? false;
    gst.lutArn = (form.lutArn ?? "").trim();
    gst.countryOfDestination = (form.countryOfDestination ?? "").trim();
  }

  return {
    ...gst,
    companyName: form.companyName.trim(),
    companyEmail: form.companyEmail.trim(),
    companyPhone: form.companyPhone.trim(),
    companyAddress: form.companyAddress.trim(),
    companyLogo: form.companyLogo.trim(),
    billTo: form.billTo.trim(),
    billToEmail: form.billToEmail.trim(),
    billToAddress: form.billToAddress.trim(),
    invoiceNumber: form.invoiceNumber.trim(),
    invoiceDate: form.invoiceDate,
    dueDate: form.dueDate,
    terms: form.terms.trim(),
    notes: form.notes.trim(),
    currency: form.currency,
    status: form.status,
    // Ceilings as well as floors: the fields clamp as you type, but nothing
    // guarantees a value reached this mapper through a field at all (the AI
    // patch and a restored draft both bypass them). Quantity is deliberately
    // not rounded here — the assistant is allowed to set a fractional one.
    items: form.items.map((item) => ({
      description: item.description.trim(),
      quantity: clampToLimit(toNumber(item.quantity, 1), MAX_ITEM_QUANTITY, 1),
      unitPrice: clampToLimit(toNumber(item.unitPrice, 0), MAX_ITEM_UNIT_PRICE),
      ...(item.hsnSac !== undefined
        ? { hsnSac: item.hsnSac.trim().slice(0, 8) }
        : {}),
      ...(item.unit !== undefined ? { unit: item.unit.trim().slice(0, 8) } : {}),
      ...(item.discount !== undefined
        ? { discount: clampToLimit(toNumber(item.discount, 0), MAX_MONEY_VALUE) }
        : {}),
      ...(item.taxRatePercent !== undefined
        ? {
            taxRatePercent: clampToLimit(
              toNumber(item.taxRatePercent, 0),
              100
            ),
          }
        : {}),
    })),
    discount: clampToLimit(toNumber(form.discount, 0), MAX_MONEY_VALUE),
    cgst: clampToLimit(toNumber(form.cgst, 0), MAX_MONEY_VALUE),
    sgst: clampToLimit(toNumber(form.sgst, 0), MAX_MONEY_VALUE),
    convenienceCharge: clampToLimit(
      toNumber(form.convenienceCharge, 0),
      MAX_MONEY_VALUE
    ),
    paymentInfo: form.paymentInfo.trim(),
  };
};

export const formatCurrency = (value: number, currency = "INR") => {
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value || 0);
  } catch {
    const symbol = CURRENCY_SYMBOLS[currency] || "₹";
    return `${symbol}${(value || 0).toFixed(2)}`;
  }
};

/**
 * The invoice date formatter, re-exported from `lib/format-date`.
 *
 * It used to be a local `toLocaleDateString("en-US")` here, which printed
 * "Jan 1, 2026" on an India-first product where every other document the user
 * handles is day-first, and which rendered "Invalid Date" for unparseable
 * input. `lib/format-date` is the day-first, never-throws, timezone-stable
 * implementation; keeping the name exported from this module means every
 * existing call site (dashboard, list, modal, admin, date picker, export)
 * switched over without touching those files.
 */
export const formatDateLong = formatCalendarDateLong;

/**
 * §5.9's GSTIN-prefix rule, as a CALLER-SIDE check.
 *
 * It cannot live inside `validateInvoice`: the invoice document has no
 * `companyGstin` column (the GSTIN lives on the business profile), so the
 * validator has nothing to compare against. Callers that DO hold a GSTIN — the
 * editor, which fetched the profile to seed the form — pass it here right after
 * `validateInvoice` returns clean.
 *
 * All GSTIN knowledge comes from `lib/gstin.ts`; nothing here parses a GSTIN by
 * hand. A blank or invalid GSTIN is not this rule's business (the profile form
 * rejects it at the source), so both cases return null rather than shadowing
 * the profile's own error message.
 */
export const checkSupplierStateAgainstGstin = (input: {
  companyGstin?: string;
  supplierStateCode?: string;
  taxTreatment?: TaxTreatment;
}): string | null => {
  if (input.taxTreatment !== "gst") {
    return null;
  }
  const gstin = (input.companyGstin ?? "").trim();
  const stateCode = (input.supplierStateCode ?? "").trim();
  if (!gstin || !stateCode || !isValidGstin(gstin)) {
    return null;
  }
  return stateCodeFromGstin(gstin) === stateCode
    ? null
    : "Your state must match the first two digits of your GSTIN.";
};

export const getInvoiceStatus = (invoice: Partial<InvoiceRecord>): InvoiceStatus => {
  if (invoice.status) {
    return invoice.status;
  }

  const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
  const now = new Date();

  if (dueDate && dueDate.getTime() < now.getTime()) {
    return "overdue";
  }

  return "sent";
};
