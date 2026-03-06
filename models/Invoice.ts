import mongoose, { Schema, Document } from "mongoose";

export interface IInvoice extends Document {
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
  invoiceDate: Date;
  dueDate: Date;
  terms?: string;
  notes?: string;
  currency: string;
  items: { name: string; price: number; quantity: number }[];
  subtotal: number;
  discount: number;
  tax?: number;
  cgst: number;
  sgst: number;
  convenienceCharge: number;
  paymentInfo?: string;
  total: number;
  status: "draft" | "sent" | "paid" | "overdue";
  is_deleted: boolean;
  createdAt: Date;
}

const InvoiceSchema: Schema = new Schema({
  userId: { type: String, required: true },
  companyName: { type: String, required: true },
  companyEmail: { type: String, default: "" },
  companyPhone: { type: String, default: "" },
  companyAddress: { type: String, default: "" },
  companyLogo: { type: String, default: "" },
  billTo: { type: String, required: true },
  billToEmail: { type: String, default: "" },
  billToAddress: { type: String, default: "" },
  invoiceNumber: { type: String, required: true },
  invoiceDate: { type: Date, required: true },
  dueDate: { type: Date, required: true },
  terms: { type: String, default: "" },
  notes: { type: String, default: "" },
  currency: { type: String, default: "INR" },
  items: [
    {
      name: { type: String, required: true },
      price: { type: Number, required: true },
      quantity: { type: Number, required: true },
    },
  ],
  subtotal: { type: Number, required: true },
  discount: { type: Number, required: true, default: 0 },
  tax: { type: Number, default: 0 },
  cgst: { type: Number, required: true, default: 0 },
  sgst: { type: Number, required: true, default: 0 },
  convenienceCharge: { type: Number, required: true },
  paymentInfo: { type: String, default: "" },
  total: { type: Number, required: true },
  status: {
    type: String,
    enum: ["draft", "sent", "paid", "overdue"],
    default: "draft",
  },
  is_deleted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.models.Invoice ||
  mongoose.model<IInvoice>("Invoice", InvoiceSchema);
