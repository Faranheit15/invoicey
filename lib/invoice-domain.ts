import type { InvoiceRecord } from "@/lib/invoices";

/**
 * Invoice domain: the single source of truth for the money formula, the display
 * amount resolution (including the legacy `tax` fallback), the ordered totals
 * rows shared by the live preview and the export, and invoice validation.
 *
 * This module imports only TYPES from lib/invoices (erased at compile time), so
 * lib/invoices can import computeTotals from here without a runtime cycle.
 */

export const round2 = (value: number): number => Number((value || 0).toFixed(2));

export interface LineItemAmount {
  quantity: number;
  unitPrice: number;
}

export interface TotalsInput {
  items: LineItemAmount[];
  discount: number;
  cgst: number;
  sgst: number;
  convenienceCharge: number;
}

export interface InvoiceTotals {
  subtotal: number;
  discount: number;
  cgst: number;
  sgst: number;
  convenienceCharge: number;
  total: number;
}

/**
 * The one totals formula: subtotal - discount + cgst + sgst + convenienceCharge,
 * clamped at 0, each value rounded to 2 dp. Per-line quantity and price are
 * clamped non-negative. Every other computation of a total must call this.
 */
export const computeTotals = (input: TotalsInput): InvoiceTotals => {
  const subtotal = round2(
    input.items.reduce(
      (sum, item) =>
        sum +
        Math.max(0, item.quantity || 0) * Math.max(0, item.unitPrice || 0),
      0
    )
  );
  const discount = round2(Math.max(0, input.discount || 0));
  const cgst = round2(Math.max(0, input.cgst || 0));
  const sgst = round2(Math.max(0, input.sgst || 0));
  const convenienceCharge = round2(Math.max(0, input.convenienceCharge || 0));
  const total = round2(
    Math.max(0, subtotal - discount + cgst + sgst + convenienceCharge)
  );

  return { subtotal, discount, cgst, sgst, convenienceCharge, total };
};

/**
 * Resolve the amounts to DISPLAY for a persisted record. Honors server-stored
 * subtotal/total when present (?? keeps a legitimate 0), and applies the legacy
 * `cgst ?? tax` fallback for documents written before the CGST/SGST migration.
 */
export const resolveRecordAmounts = (invoice: InvoiceRecord): InvoiceTotals => {
  const computed = computeTotals({
    items: (invoice.items || []).map((item) => ({
      quantity: item.quantity,
      unitPrice: item.price,
    })),
    discount: invoice.discount ?? 0,
    cgst: invoice.cgst ?? invoice.tax ?? 0,
    sgst: invoice.sgst ?? 0,
    convenienceCharge: invoice.convenienceCharge ?? 0,
  });

  return {
    ...computed,
    subtotal: invoice.subtotal ?? computed.subtotal,
    total: invoice.total ?? computed.total,
  };
};

export type TotalsRowKind = "line" | "discount" | "grand";

export interface TotalsRow {
  label: string;
  amount: number;
  kind: TotalsRowKind;
}

/**
 * The ordered, labeled totals rows. The live preview and the export template both
 * render from this list so their totals section cannot drift in label, order, or
 * which amount is shown. `convenienceCharge` is labeled "Service Charge".
 */
export const buildTotalsRows = (amounts: InvoiceTotals): TotalsRow[] => [
  { label: "Subtotal", amount: amounts.subtotal, kind: "line" },
  { label: "Discount", amount: amounts.discount, kind: "discount" },
  { label: "CGST", amount: amounts.cgst, kind: "line" },
  { label: "SGST", amount: amounts.sgst, kind: "line" },
  { label: "Service Charge", amount: amounts.convenienceCharge, kind: "line" },
  { label: "Total", amount: amounts.total, kind: "grand" },
];

export interface ValidatableInvoice {
  companyName: string;
  billTo: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  items: Array<{ description?: string; name?: string }>;
}

const isValidDate = (value: string): boolean =>
  Boolean(value) && !Number.isNaN(new Date(value).getTime());

/**
 * The one invoice validator, shared by the editor (before save) and the API
 * (before persist). Returns the first error message, or null when valid.
 */
export const validateInvoice = (invoice: ValidatableInvoice): string | null => {
  if (!invoice.companyName.trim()) {
    return "Company name is required";
  }
  if (!invoice.billTo.trim()) {
    return "Bill to is required";
  }
  if (!invoice.invoiceNumber.trim()) {
    return "Invoice number is required";
  }
  if (!isValidDate(invoice.invoiceDate)) {
    return "Invoice date is invalid";
  }
  if (!isValidDate(invoice.dueDate)) {
    return "Due date is invalid";
  }
  const hasLineItem = invoice.items.some((item) =>
    ((item.description ?? item.name) || "").trim()
  );
  if (!hasLineItem) {
    return "At least one line item is required";
  }
  return null;
};
