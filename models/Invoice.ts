import mongoose, { Schema, Document } from 'mongoose';

export interface IInvoice extends Document {
  userId: string;
  customerName: string;
  items: { name: string; price: number; quantity: number }[];
  total: number;
  createdAt: Date;
}

const InvoiceSchema: Schema = new Schema({
  userId: { type: String, required: true },
  customerName: { type: String, required: true },
  items: [
    {
      name: { type: String, required: true },
      price: { type: Number, required: true },
      quantity: { type: Number, required: true },
    },
  ],
  total: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.models.Invoice || mongoose.model<IInvoice>('Invoice', InvoiceSchema);
