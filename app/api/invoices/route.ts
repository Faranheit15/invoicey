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
  validateInvoice,
} from "@/lib/invoice-domain";
import { recordActivity, logRouteError } from "@/lib/server/log";

type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

interface RawInvoiceItem {
  description?: string;
  name?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  price?: number | string;
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
}

interface PatchInvoicePayload {
  id?: string;
  action?: "settle" | "soft_delete";
  status?: InvoiceStatus;
}

interface NormalizedInvoicePayload {
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
  items: { name: string; quantity: number; price: number }[];
  subtotal: number;
  discount: number;
  cgst: number;
  sgst: number;
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

const normalizeItems = (items: RawInvoiceItem[] = []) => {
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
      return { name, quantity, price };
    })
    .filter((item) => item.name.length > 0);
};

const normalizePayload = (raw: RawInvoicePayload): NormalizedInvoicePayload => {
  const items = normalizeItems(raw.items || []);
  // Single source of truth for the money math — the server never trusts client
  // numbers, and this is the same formula the editor preview and export use.
  const totals = computeTotals({
    items: items.map((item) => ({
      quantity: item.quantity,
      unitPrice: item.price,
    })),
    discount: clampToLimit(toNumber(raw.discount, 0), MAX_MONEY_VALUE),
    cgst: clampToLimit(toNumber(raw.cgst, 0), MAX_MONEY_VALUE),
    sgst: clampToLimit(toNumber(raw.sgst, 0), MAX_MONEY_VALUE),
    convenienceCharge: clampToLimit(
      toNumber(raw.convenienceCharge, 0),
      MAX_MONEY_VALUE
    ),
  });

  const allowedStatuses: InvoiceStatus[] = ["draft", "sent", "paid", "overdue"];
  const status =
    raw.status && allowedStatuses.includes(raw.status) ? raw.status : "draft";

  return {
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
    items,
    subtotal: totals.subtotal,
    discount: totals.discount,
    cgst: totals.cgst,
    sgst: totals.sgst,
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
    const err = error as Error;
    return NextResponse.json(
      { error: "Internal Server Error", details: err.message },
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
    const validationError = validateInvoice(payload);

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
    const err = error as Error;
    return NextResponse.json(
      { error: "Internal Server Error", details: err.message },
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
    const validationError = validateInvoice(payload);

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
    const err = error as Error;
    return NextResponse.json(
      { error: "Internal Server Error", details: err.message },
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
    const err = error as Error;
    return NextResponse.json(
      { error: "Internal Server Error", details: err.message },
      { status: 500 }
    );
  }
}
