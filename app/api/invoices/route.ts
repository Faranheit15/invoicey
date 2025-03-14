import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Invoice from "@/models/Invoice";
import admin from "firebase-admin";

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  const serviceAccountStr = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!serviceAccountStr) {
    throw new Error("Missing FIREBASE_ADMIN_CREDENTIALS environment variable");
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountStr);
  } catch (error: unknown) {
    throw new Error("Invalid JSON format in FIREBASE_ADMIN_CREDENTIALS", {
      cause: error,
    });
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// Helper function to verify JWT and return a non-null UID
const verifyAuth = async (req: NextRequest): Promise<string> => {
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
    return decodedToken.uid;
  } catch (error: unknown) {
    throw new Error("Unauthorized", { cause: error });
  }
};

export async function GET(req: NextRequest) {
  await connectDB();
  let userUid: string;
  try {
    userUid = await verifyAuth(req);
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const invoiceId = searchParams.get("id");

  if (invoiceId) {
    // Fetch specific invoice by ID
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    // Check if the invoice belongs to the authenticated user
    if (invoice.userId !== userUid) {
      return NextResponse.json(
        { error: "Unauthorized access" },
        { status: 403 }
      );
    }
    return NextResponse.json(invoice);
  }

  // Fetch all invoices for the authenticated user
  const invoices = await Invoice.find({ userId: userUid });
  return NextResponse.json(invoices);
}

export async function POST(req: NextRequest) {
  await connectDB();
  let userUid: string;
  try {
    userUid = await verifyAuth(req);
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 401 });
  }

  try {
    const {
      companyName,
      billTo,
      invoiceNumber,
      invoiceDate,
      dueDate,
      terms,
      items,
      tax,
      convenienceCharge,
      paymentInfo,
    }: {
      companyName: string;
      billTo: string;
      invoiceNumber: string;
      invoiceDate: string;
      dueDate: string;
      terms: string;
      items: { description: string; quantity: number; unitPrice: number }[];
      tax: number;
      convenienceCharge: number;
      paymentInfo: string;
    } = await req.json();

    if (
      !companyName ||
      !billTo ||
      !invoiceNumber ||
      !invoiceDate ||
      !dueDate ||
      !items.length
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const formattedItems = items.map((item) => ({
      name: item.description,
      price: item.unitPrice,
      quantity: item.quantity,
    }));

    const total =
      formattedItems.reduce(
        (sum: number, item: { price: number; quantity: number }) =>
          sum + item.price * item.quantity,
        0
      ) +
      Number(tax) +
      Number(convenienceCharge);

    // Use the verified UID instead of client-sent userId
    const invoice = new Invoice({
      userId: userUid,
      companyName,
      billTo,
      invoiceNumber,
      invoiceDate,
      dueDate,
      terms,
      items: formattedItems,
      tax,
      convenienceCharge,
      paymentInfo,
      total,
    });

    await invoice.save();
    return NextResponse.json({
      message: "Invoice created successfully",
      invoice,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Error creating invoice:", err.message);
    return NextResponse.json(
      { error: "Internal Server Error", details: err.message },
      { status: 500 }
    );
  }
}
