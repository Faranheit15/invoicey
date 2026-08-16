import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Invoice from "@/models/Invoice";
import { requireUser, authErrorResponse } from "@/lib/server/auth";
import {
  MAX_ITEM_QUANTITY,
  MAX_ITEM_UNIT_PRICE,
  MAX_MONEY_VALUE,
  clampToLimit,
  computeTotals,
  resolveTaxContext,
  validateInvoice,
} from "@/lib/invoice-domain";
import {
  deriveSupplyKind,
  documentTypeFor,
  type DocumentType,
  type SupplyKind,
  type TaxTreatment,
} from "@/lib/gst-supply";
import {
  MAX_UNIT_LENGTH,
  isAcceptedGstRate,
  isValidHsnSac,
  placeOfSupplyLabelFor,
} from "@/lib/gst-rates";
import { GST_STATE_CODES, OTHER_COUNTRY_STATE_CODE } from "@/lib/gstin";
import { recordActivity, logRouteError } from "@/lib/server/log";

type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

interface RawInvoiceItem {
  description?: string;
  name?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  price?: number | string;
  hsnSac?: string;
  unit?: string;
  discount?: number | string;
  taxRatePercent?: number | string;
}

interface RawInvoicePayload {
  id?: string;
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
  items?: RawInvoiceItem[];
  discount?: number | string;
  tax?: number | string;
  cgst?: number | string;
  sgst?: number | string;
  convenienceCharge?: number | string;
  paymentInfo?: string;
  status?: InvoiceStatus;
  taxTreatment?: string;
  reverseCharge?: boolean;
  supplierStateCode?: string;
  placeOfSupplyStateCode?: string;
  placeOfSupplyLabel?: string;
  placeOfSupplyOverridden?: boolean;
  recipientIsSez?: boolean;
  recipientIsOutsideIndia?: boolean;
  withPaymentOfTax?: boolean;
  lutArn?: string;
  countryOfDestination?: string;
  // `documentType` and `supplyKind` are deliberately NOT read from the request:
  // both are re-derived below so a client cannot head an unregistered document
  // "TAX INVOICE" or claim an intra-State supply is inter-State.
}

interface PatchInvoicePayload {
  id?: string;
  action?: "settle" | "soft_delete";
  status?: InvoiceStatus;
}

interface NormalizedInvoiceItem {
  name: string;
  quantity: number;
  price: number;
  hsnSac?: string;
  unit?: string;
  discount?: number;
  taxRatePercent?: number;
  taxableValue?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
}

/** The invoice-level GST block. Absent entirely for a pre-Phase-2 client. */
interface NormalizedGstFields {
  taxTreatment: TaxTreatment;
  documentType: DocumentType;
  supplyKind: SupplyKind;
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

interface NormalizedInvoicePayload extends Partial<NormalizedGstFields> {
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
  items: NormalizedInvoiceItem[];
  subtotal: number;
  discount: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxableValue: number;
  roundOff: number;
  convenienceCharge: number;
  paymentInfo: string;
  status: InvoiceStatus;
  total: number;
}

const INVOICE_AUTH_MESSAGES = {
  EmailNotVerified: "Please verify your email before accessing invoices.",
} as const;

const toNumber = (value: number | string | undefined, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const cleanString = (value: string | undefined): string => {
  return typeof value === "string" ? value.trim() : "";
};

/**
 * A REAL GST state code, or "" — two digits is not enough. "88" is two digits
 * and is not a state; accepting it would put an unresolvable place of supply on
 * a printed document and make `deriveSupplyKind` compare against a fiction.
 * "96" (outside India) is allowed: it is Invoicey's place-of-supply sentinel.
 */
const cleanStateCode = (value: string | undefined): string => {
  const digits = cleanString(value).replace(/\D/g, "");
  if (digits === OTHER_COUNTRY_STATE_CODE) {
    return digits;
  }
  return Object.prototype.hasOwnProperty.call(GST_STATE_CODES, digits)
    ? digits
    : "";
};

/**
 * HSN/SAC, Rule 46(f) format: digits only, 4/6/8 long. A code of any other
 * length is DROPPED rather than truncated — silently turning a mistyped 5-digit
 * code into a valid-looking 4-digit one would print a classification the user
 * never chose.
 */
const cleanHsnSac = (value: string | undefined): string => {
  const digits = cleanString(value).replace(/\D/g, "");
  return isValidHsnSac(digits) ? digits : "";
};

const ALLOWED_TAX_TREATMENTS: TaxTreatment[] = ["none", "gst", "composition"];

const normalizeItems = (items: RawInvoiceItem[] = []): NormalizedInvoiceItem[] => {
  return items
    .map((item) => {
      const name = cleanString(item.description || item.name);
      // Clamped both ways here too: the editor's fields are not the only way a
      // request reaches this handler.
      const quantity = clampToLimit(toNumber(item.quantity, 1), MAX_ITEM_QUANTITY, 1);
      const price = clampToLimit(
        toNumber(item.unitPrice ?? item.price, 0),
        MAX_ITEM_UNIT_PRICE
      );
      const hsnSac = cleanHsnSac(item.hsnSac);
      const unit = cleanString(item.unit).slice(0, MAX_UNIT_LENGTH).toUpperCase();
      const normalized: NormalizedInvoiceItem = { name, quantity, price };
      // Only SET what the client actually sent: an absent HSN/SAC or rate is
      // how a line says "written before per-line tax existed", and writing an
      // empty string or a 0 would erase that.
      if (hsnSac) {
        normalized.hsnSac = hsnSac;
      }
      if (unit) {
        normalized.unit = unit;
      }
      if (item.discount !== undefined) {
        normalized.discount = clampToLimit(
          toNumber(item.discount, 0),
          MAX_MONEY_VALUE
        );
      }
      if (item.taxRatePercent !== undefined) {
        // WHITELISTED, not clamped. GST has a fixed slab table; a 15% line is
        // not a rate that needs bringing into range, it is a rate that does not
        // exist, and charging it to a client is worse than charging nothing.
        // Retired slabs (12, 28) pass — a back-dated document carries them
        // legitimately and `validateInvoice` warns rather than blocks.
        const rate = Number(toNumber(item.taxRatePercent, 0).toFixed(2));
        if (isAcceptedGstRate(rate)) {
          normalized.taxRatePercent = rate;
        }
      }
      return normalized;
    })
    .filter((item) => item.name.length > 0);
};

/**
 * The invoice-level GST block, re-derived server-side.
 *
 * Returns `undefined` when the client sent no `taxTreatment` at all — that is a
 * pre-Phase-2 client (or a pre-Phase-2 document being re-saved), and it must
 * stay on the legacy money formula rather than being silently switched to
 * "unregistered", which would zero the tax it typed in.
 *
 * `documentType` and `supplyKind` are computed here and never read from the
 * request.
 */
const normalizeGstFields = (
  raw: RawInvoicePayload
): NormalizedGstFields | undefined => {
  if (raw.taxTreatment === undefined || raw.taxTreatment === null) {
    return undefined;
  }

  const taxTreatment = ALLOWED_TAX_TREATMENTS.includes(
    raw.taxTreatment as TaxTreatment
  )
    ? (raw.taxTreatment as TaxTreatment)
    : "none";

  const supplierStateCode = cleanStateCode(raw.supplierStateCode);
  const placeOfSupplyStateCode = cleanStateCode(raw.placeOfSupplyStateCode);
  const recipientIsSez = raw.recipientIsSez === true;
  const recipientIsOutsideIndia = raw.recipientIsOutsideIndia === true;

  return {
    taxTreatment,
    documentType: documentTypeFor(taxTreatment),
    supplyKind: deriveSupplyKind({
      supplierStateCode,
      placeOfSupplyStateCode,
      recipientIsSez,
      recipientIsOutsideIndia,
    }),
    reverseCharge: raw.reverseCharge === true,
    supplierStateCode,
    placeOfSupplyStateCode,
    // The label is what gets PRINTED. A client-supplied one is kept (an export's
    // place of supply is a country name, which no table of ours knows) but a
    // blank one falls back to our own state table rather than printing nothing
    // — or worse, printing the bare code "27".
    placeOfSupplyLabel:
      cleanString(raw.placeOfSupplyLabel).slice(0, 120) ||
      placeOfSupplyLabelFor(placeOfSupplyStateCode),
    placeOfSupplyOverridden: raw.placeOfSupplyOverridden === true,
    recipientIsSez,
    recipientIsOutsideIndia,
    withPaymentOfTax: raw.withPaymentOfTax === true,
    lutArn: cleanString(raw.lutArn).slice(0, 60),
    countryOfDestination: cleanString(raw.countryOfDestination).slice(0, 120),
  };
};

const normalizePayload = (raw: RawInvoicePayload): NormalizedInvoicePayload => {
  const items = normalizeItems(raw.items || []);
  const gst = normalizeGstFields(raw);

  // Single source of truth for the money math — the server never trusts client
  // numbers, and this is the same formula the editor preview and export use.
  // In particular the per-head amounts are DERIVED from the line rates and the
  // supply geography; a client-supplied `cgst`/`sgst` only survives on the
  // legacy path, where there is nothing else to go on.
  const totals = computeTotals({
    items: items.map((item) => ({
      quantity: item.quantity,
      unitPrice: item.price,
      discount: item.discount,
      taxRatePercent: item.taxRatePercent,
    })),
    discount: clampToLimit(toNumber(raw.discount, 0), MAX_MONEY_VALUE),
    convenienceCharge: clampToLimit(
      toNumber(raw.convenienceCharge, 0),
      MAX_MONEY_VALUE
    ),
    tax: resolveTaxContext({
      taxTreatment: gst?.taxTreatment,
      reverseCharge: gst?.reverseCharge,
      supplyKind: gst?.supplyKind,
      supplierStateCode: gst?.supplierStateCode,
      withPaymentOfTax: gst?.withPaymentOfTax,
      legacyCgst: clampToLimit(toNumber(raw.cgst, 0), MAX_MONEY_VALUE),
      legacySgst: clampToLimit(toNumber(raw.sgst, 0), MAX_MONEY_VALUE),
    }),
  });

  // Store the derived per-line amounts, but only on the derived path: writing
  // zeros onto a legacy document would later be read back as a stored split and
  // would suppress the real tax the moment that document gained a treatment.
  const storedItems: NormalizedInvoiceItem[] =
    gst && gst.taxTreatment === "gst" && !gst.reverseCharge
      ? items.map((item, index) => ({
          ...item,
          taxableValue: totals.lines[index].taxable,
          cgstAmount: totals.lines[index].tax.cgst,
          sgstAmount: totals.lines[index].tax.sgst,
          igstAmount: totals.lines[index].tax.igst,
        }))
      : items;

  const allowedStatuses: InvoiceStatus[] = ["draft", "sent", "paid", "overdue"];
  const status =
    raw.status && allowedStatuses.includes(raw.status) ? raw.status : "draft";

  return {
    ...(gst ?? {}),
    companyName: cleanString(raw.companyName),
    companyEmail: cleanString(raw.companyEmail),
    companyPhone: cleanString(raw.companyPhone),
    companyAddress: cleanString(raw.companyAddress),
    companyLogo: cleanString(raw.companyLogo),
    billTo: cleanString(raw.billTo),
    billToEmail: cleanString(raw.billToEmail),
    billToAddress: cleanString(raw.billToAddress),
    invoiceNumber: cleanString(raw.invoiceNumber),
    invoiceDate: cleanString(raw.invoiceDate),
    dueDate: cleanString(raw.dueDate),
    terms: cleanString(raw.terms),
    notes: cleanString(raw.notes),
    currency: cleanString(raw.currency) || "INR",
    items: storedItems,
    subtotal: totals.subtotal,
    discount: totals.discount,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    taxableValue: totals.taxableValue,
    roundOff: totals.roundOff,
    convenienceCharge: totals.convenienceCharge,
    paymentInfo: cleanString(raw.paymentInfo),
    status,
    total: totals.total,
  };
};

const isNotFoundOrInvalidIdError = (error: unknown): boolean => {
  const err = error as { name?: string };
  return err?.name === "CastError";
};

const allowedStatuses: InvoiceStatus[] = ["draft", "sent", "paid", "overdue"];

export async function GET(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await requireUser(req);
  } catch (error: unknown) {
    return authErrorResponse(error, INVOICE_AUTH_MESSAGES);
  }

  await connectDB();

  const { searchParams } = new URL(req.url);
  const invoiceId = searchParams.get("id");

  try {
    if (invoiceId) {
      const invoice = await Invoice.findOne({
        _id: invoiceId,
        userId: userUid,
        is_deleted: { $ne: true },
      });
      if (!invoice) {
        return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
      }
      return NextResponse.json(invoice);
    }

    const invoices = await Invoice.find({
      userId: userUid,
      is_deleted: { $ne: true },
    }).sort({ createdAt: -1 });
    return NextResponse.json(invoices);
  } catch (error: unknown) {
    if (isNotFoundOrInvalidIdError(error)) {
      return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
    }

    logRouteError(error, {
      req,
      route: "GET /api/invoices",
      userId: userUid,
      category: "invoice",
    });
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await requireUser(req);
  } catch (error: unknown) {
    return authErrorResponse(error, INVOICE_AUTH_MESSAGES);
  }

  await connectDB();

  try {
    const rawPayload = (await req.json()) as RawInvoicePayload;
    const payload = normalizePayload(rawPayload);
    // The head rollups go in as a tripwire: an inter-State supply that somehow
    // produced CGST/SGST (or the reverse) is a bug in the derivation, not a
    // user error, and it must not reach a client's inbox.
    const validationError = validateInvoice({
      ...payload,
      totals: {
        cgst: payload.cgst,
        sgst: payload.sgst,
        igst: payload.igst,
      },
    });

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const invoice = new Invoice({
      userId: userUid,
      is_deleted: false,
      ...payload,
    });

    await invoice.save();
    recordActivity({
      userId: userUid,
      type: "invoice_create",
      invoiceId: String(invoice._id),
      amount: payload.total,
      currency: payload.currency,
    });
    return NextResponse.json(
      {
        message: "Invoice created successfully",
        invoice,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "POST /api/invoices",
      userId: userUid,
      category: "invoice",
    });
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await requireUser(req);
  } catch (error: unknown) {
    return authErrorResponse(error, INVOICE_AUTH_MESSAGES);
  }

  await connectDB();

  try {
    const rawPayload = (await req.json()) as RawInvoicePayload;
    const { searchParams } = new URL(req.url);
    const invoiceId = searchParams.get("id") || cleanString(rawPayload.id);

    if (!invoiceId) {
      return NextResponse.json(
        { error: "Invoice id is required for updates" },
        { status: 400 }
      );
    }

    const existingInvoice = await Invoice.findOne({
      _id: invoiceId,
      userId: userUid,
      is_deleted: { $ne: true },
    });
    if (!existingInvoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const payload = normalizePayload(rawPayload);
    // The head rollups go in as a tripwire: an inter-State supply that somehow
    // produced CGST/SGST (or the reverse) is a bug in the derivation, not a
    // user error, and it must not reach a client's inbox.
    const validationError = validateInvoice({
      ...payload,
      totals: {
        cgst: payload.cgst,
        sgst: payload.sgst,
        igst: payload.igst,
      },
    });

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    Object.assign(existingInvoice, payload);
    await existingInvoice.save();

    recordActivity({
      userId: userUid,
      type: "invoice_update",
      invoiceId: invoiceId,
      amount: payload.total,
      currency: payload.currency,
    });

    return NextResponse.json({
      message: "Invoice updated successfully",
      invoice: existingInvoice,
    });
  } catch (error: unknown) {
    if (isNotFoundOrInvalidIdError(error)) {
      return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
    }

    logRouteError(error, {
      req,
      route: "PUT /api/invoices",
      userId: userUid,
      category: "invoice",
    });
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await requireUser(req);
  } catch (error: unknown) {
    return authErrorResponse(error, INVOICE_AUTH_MESSAGES);
  }

  await connectDB();

  try {
    const rawPayload = (await req.json()) as PatchInvoicePayload;
    const { searchParams } = new URL(req.url);
    const invoiceId = searchParams.get("id") || cleanString(rawPayload.id);

    if (!invoiceId) {
      return NextResponse.json(
        { error: "Invoice id is required" },
        { status: 400 }
      );
    }

    const invoice = await Invoice.findOne({
      _id: invoiceId,
      userId: userUid,
      is_deleted: { $ne: true },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Scope every write by userId as well (defense in depth): the findOne above
    // already proves ownership, but keeping the predicate on the write means a
    // future refactor cannot silently turn these into cross-tenant updates.
    const ownedFilter = { _id: invoiceId, userId: userUid };

    if (rawPayload.action === "soft_delete") {
      await Invoice.updateOne(ownedFilter, { $set: { is_deleted: true } });
      recordActivity({
        userId: userUid,
        type: "invoice_delete",
        invoiceId,
      });
      return NextResponse.json({ message: "Invoice deleted successfully" });
    }

    if (rawPayload.action === "settle") {
      await Invoice.updateOne(ownedFilter, { $set: { status: "paid" } });
      recordActivity({
        userId: userUid,
        type: "invoice_settle",
        invoiceId,
        amount: invoice.total,
        currency: invoice.currency,
      });
      return NextResponse.json({
        message: "Invoice settled successfully",
        invoice: { ...invoice.toObject(), status: "paid" },
      });
    }

    if (rawPayload.status && allowedStatuses.includes(rawPayload.status)) {
      await Invoice.updateOne(ownedFilter, { $set: { status: rawPayload.status } });
      recordActivity({
        userId: userUid,
        type: "invoice_status_change",
        invoiceId,
        meta: { from: invoice.status, to: rawPayload.status },
      });
      return NextResponse.json({
        message: "Invoice status updated successfully",
        invoice: { ...invoice.toObject(), status: rawPayload.status },
      });
    }

    return NextResponse.json(
      { error: "No valid patch action provided" },
      { status: 400 }
    );
  } catch (error: unknown) {
    if (isNotFoundOrInvalidIdError(error)) {
      return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
    }

    logRouteError(error, {
      req,
      route: "PATCH /api/invoices",
      userId: userUid,
      category: "invoice",
    });
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
