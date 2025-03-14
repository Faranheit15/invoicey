import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Invoice from "@/models/Invoice";

export async function GET(req: NextRequest) {
  await connectDB();
  const { searchParams } = new URL(req.url);
  const invoiceId = searchParams.get("id");

  if (invoiceId) {
    // Fetch specific invoice by ID
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    return NextResponse.json(invoice);
  }

  // Fetch all invoices
  const invoices = await Invoice.find();
  return NextResponse.json(invoices);
}

export async function POST(req: NextRequest) {
  await connectDB();
  try {
    const {
      userId,
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
      userId: string;
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
      !userId ||
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

    const invoice = new Invoice({
      userId,
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
    // Assert error type to 'Error' to access properties like message
    const err = error as Error;
    console.error("Error creating invoice:", err.message);
    return NextResponse.json(
      { error: "Internal Server Error", details: err.message },
      { status: 500 }
    );
  }
}
