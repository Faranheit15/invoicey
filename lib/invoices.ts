export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

export interface InvoiceLineItem {
  name: string;
  quantity: number;
  price: number;
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
  tax: number;
  convenienceCharge: number;
  paymentInfo?: string;
  status?: InvoiceStatus;
  is_deleted?: boolean;
  total: number;
  createdAt: string;
}

export interface InvoiceFormItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface InvoiceFormState {
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
  tax: number;
  convenienceCharge: number;
  paymentInfo: string;
}

export interface InvoicePayload {
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
  tax: number;
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

export const createDefaultInvoiceFormState = (): InvoiceFormState => {
  const invoiceDate = new Date();
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 14);

  return {
    companyName: "",
    companyEmail: "",
    companyPhone: "",
    companyAddress: "",
    companyLogo: "",
    billTo: "",
    billToEmail: "",
    billToAddress: "",
    invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
    invoiceDate: toDateInputValue(invoiceDate),
    dueDate: toDateInputValue(dueDate),
    terms: "Payment due within 14 days.",
    notes: "",
    currency: "INR",
    status: "draft",
    items: [{ description: "", quantity: 1, unitPrice: 0 }],
    discount: 0,
    tax: 0,
    convenienceCharge: 0,
    paymentInfo: "",
  };
};

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const calculateInvoiceTotals = (form: {
  items: InvoiceFormItem[];
  tax: number;
  discount: number;
  convenienceCharge: number;
}) => {
  const subtotal = Number(
    form.items
      .reduce(
        (sum, item) =>
          sum + Math.max(0, item.quantity || 0) * Math.max(0, item.unitPrice || 0),
        0
      )
      .toFixed(2)
  );

  const discount = Number(Math.max(0, form.discount || 0).toFixed(2));
  const tax = Number(Math.max(0, form.tax || 0).toFixed(2));
  const convenienceCharge = Number(
    Math.max(0, form.convenienceCharge || 0).toFixed(2)
  );

  const total = Number(
    Math.max(0, subtotal - discount + tax + convenienceCharge).toFixed(2)
  );

  return {
    subtotal,
    discount,
    tax,
    convenienceCharge,
    total,
  };
};

export const mapInvoiceRecordToFormState = (
  invoice: Partial<InvoiceRecord>
): InvoiceFormState => {
  return {
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
          }))
        : [{ description: "", quantity: 1, unitPrice: 0 }],
    discount: toNumber(invoice.discount, 0),
    tax: toNumber(invoice.tax, 0),
    convenienceCharge: toNumber(invoice.convenienceCharge, 0),
    paymentInfo: invoice.paymentInfo || "",
  };
};

export const mapFormStateToPayload = (form: InvoiceFormState): InvoicePayload => {
  return {
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
    items: form.items.map((item) => ({
      description: item.description.trim(),
      quantity: Math.max(1, toNumber(item.quantity, 1)),
      unitPrice: Math.max(0, toNumber(item.unitPrice, 0)),
    })),
    discount: Math.max(0, toNumber(form.discount, 0)),
    tax: Math.max(0, toNumber(form.tax, 0)),
    convenienceCharge: Math.max(0, toNumber(form.convenienceCharge, 0)),
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

export const formatDateLong = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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
