import mongoose, { Schema, Document } from "mongoose";

export interface IInvoice extends Document {
  userId: string; // now represents Firebase UID
  companyName: string;
  billTo: string;
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  terms: string;
  items: { name: string; price: number; quantity: number }[];
  tax: number;
  convenienceCharge: number;
  paymentInfo: string;
  total: number;
  createdAt: Date;
}

const InvoiceSchema: Schema = new Schema({
  userId: { type: String, required: true },
  companyName: { type: String, required: true },
  billTo: { type: String, required: true },
  invoiceNumber: { type: String, required: true },
  invoiceDate: { type: Date, required: true },
  dueDate: { type: Date, required: true },
  terms: { type: String },
  items: [
    {
      name: { type: String, required: true },
      price: { type: Number, required: true },
      quantity: { type: Number, required: true },
    },
  ],
  tax: { type: Number, required: true },
  convenienceCharge: { type: Number, required: true },
  paymentInfo: { type: String },
  total: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.models.Invoice ||
  mongoose.model<IInvoice>("Invoice", InvoiceSchema);
