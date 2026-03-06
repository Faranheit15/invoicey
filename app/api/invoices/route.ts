import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Invoice from "@/models/Invoice";
import admin, { ensureFirebaseAdmin } from "@/lib/firebase-admin";

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

const verifyAuth = async (req: NextRequest): Promise<string> => {
  try {
    ensureFirebaseAdmin();
  } catch (error: unknown) {
    throw new Error("AuthConfigurationError", { cause: error });
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }

  const token = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    if (!decodedToken.uid) {
      throw new Error("Unauthorized");
    }
    if (
      decodedToken.firebase?.sign_in_provider === "password" &&
      !decodedToken.email_verified
    ) {
      throw new Error("EmailNotVerified");
    }
    return decodedToken.uid;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "EmailNotVerified") {
      throw error;
    }
    throw new Error("Unauthorized", { cause: error });
  }
};

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
      const quantity = Math.max(1, toNumber(item.quantity, 1));
      const price = Math.max(0, toNumber(item.unitPrice ?? item.price, 0));
      return { name, quantity, price };
    })
    .filter((item) => item.name.length > 0);
};

const normalizePayload = (raw: RawInvoicePayload): NormalizedInvoicePayload => {
  const items = normalizeItems(raw.items || []);
  const subtotal = Number(
    items
      .reduce((sum, item) => sum + item.quantity * item.price, 0)
      .toFixed(2)
  );
  const discount = Number(Math.max(0, toNumber(raw.discount, 0)).toFixed(2));
  const cgst = Number(Math.max(0, toNumber(raw.cgst, 0)).toFixed(2));
  const sgst = Number(Math.max(0, toNumber(raw.sgst, 0)).toFixed(2));
  const convenienceCharge = Number(
    Math.max(0, toNumber(raw.convenienceCharge, 0)).toFixed(2)
  );
  const total = Number(
    Math.max(0, subtotal - discount + cgst + sgst + convenienceCharge).toFixed(2)
  );

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
    subtotal,
    discount,
    cgst,
    sgst,
    convenienceCharge,
    paymentInfo: cleanString(raw.paymentInfo),
    status,
    total,
  };
};

const isValidDate = (value: string): boolean => {
  if (!value) {
    return false;
  }
  return !Number.isNaN(new Date(value).getTime());
};

const validatePayload = (payload: NormalizedInvoicePayload): string | null => {
  if (!payload.companyName) {
    return "Company name is required";
  }
  if (!payload.billTo) {
    return "Bill to is required";
  }
  if (!payload.invoiceNumber) {
    return "Invoice number is required";
  }
  if (!isValidDate(payload.invoiceDate)) {
    return "Invoice date is invalid";
  }
  if (!isValidDate(payload.dueDate)) {
    return "Due date is invalid";
  }
  if (payload.items.length === 0) {
    return "At least one line item is required";
  }
  return null;
};

const isNotFoundOrInvalidIdError = (error: unknown): boolean => {
  const err = error as { name?: string };
  return err?.name === "CastError";
};

const allowedStatuses: InvoiceStatus[] = ["draft", "sent", "paid", "overdue"];

const authErrorResponse = (error: unknown) => {
  const err = error as Error;
  if (err.message === "AuthConfigurationError") {
    return NextResponse.json(
      { error: "Server authentication is misconfigured" },
      { status: 500 }
    );
  }
  if (err.message === "EmailNotVerified") {
    return NextResponse.json(
      { error: "Please verify your email before accessing invoices." },
      { status: 403 }
    );
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
};

export async function GET(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await verifyAuth(req);
  } catch (error: unknown) {
    return authErrorResponse(error);
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
    userUid = await verifyAuth(req);
  } catch (error: unknown) {
    return authErrorResponse(error);
  }

  await connectDB();

  try {
    const rawPayload = (await req.json()) as RawInvoicePayload;
    const payload = normalizePayload(rawPayload);
    const validationError = validatePayload(payload);

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const invoice = new Invoice({
      userId: userUid,
      is_deleted: false,
      ...payload,
    });

    await invoice.save();
    return NextResponse.json(
      {
        message: "Invoice created successfully",
        invoice,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Error creating invoice:", err.message);
    return NextResponse.json(
      { error: "Internal Server Error", details: err.message },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await verifyAuth(req);
  } catch (error: unknown) {
    return authErrorResponse(error);
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
    const validationError = validatePayload(payload);

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    Object.assign(existingInvoice, payload);
    await existingInvoice.save();

    return NextResponse.json({
      message: "Invoice updated successfully",
      invoice: existingInvoice,
    });
  } catch (error: unknown) {
    if (isNotFoundOrInvalidIdError(error)) {
      return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
    }

    const err = error as Error;
    console.error("Error updating invoice:", err.message);
    return NextResponse.json(
      { error: "Internal Server Error", details: err.message },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await verifyAuth(req);
  } catch (error: unknown) {
    return authErrorResponse(error);
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

    if (rawPayload.action === "soft_delete") {
      await Invoice.updateOne({ _id: invoiceId }, { $set: { is_deleted: true } });
      return NextResponse.json({ message: "Invoice deleted successfully" });
    }

    if (rawPayload.action === "settle") {
      await Invoice.updateOne({ _id: invoiceId }, { $set: { status: "paid" } });
      return NextResponse.json({
        message: "Invoice settled successfully",
        invoice: { ...invoice.toObject(), status: "paid" },
      });
    }

    if (rawPayload.status && allowedStatuses.includes(rawPayload.status)) {
      await Invoice.updateOne({ _id: invoiceId }, { $set: { status: rawPayload.status } });
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

    const err = error as Error;
    return NextResponse.json(
      { error: "Internal Server Error", details: err.message },
      { status: 500 }
    );
  }
}
