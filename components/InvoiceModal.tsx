"use client";

import React, { useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { Cross1Icon } from "@radix-ui/react-icons";

export interface Invoice {
  _id: string;
  userId: string;
  companyName: string;
  billTo: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  terms: string;
  items: {
    name: string;
    price: number;
    quantity: number;
  }[];
  tax: number;
  convenienceCharge: number;
  paymentInfo: string;
  total: number;
  createdAt: string;
  companyLogo?: string;
}

interface InvoiceModalProps {
  invoice: Invoice;
  onClose: () => void;
}

const InvoiceModal: React.FC<InvoiceModalProps> = ({ invoice, onClose }) => {
  const invoiceRef = useRef<HTMLDivElement>(null);

  const calculateTotal = () => {
    const subTotal = invoice?.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    return subTotal + Number(invoice?.tax) + Number(invoice?.convenienceCharge);
  };

  const downloadInvoice = () => {
    if (!invoiceRef.current) return;
    const printContent = invoiceRef.current.innerHTML;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Invoice ${invoice?.invoiceNumber}</title>
          <style>
            body { font-family: sans-serif; padding: 20px; }
            .card { border: 1px solid #ddd; border-radius: 8px; padding: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
          </style>
        </head>
        <body>
          ${printContent}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
      <div className="relative w-full max-w-3xl p-6 bg-white rounded-lg shadow-lg">
        <Cross1Icon
          className="absolute -m-2 text-2xl font-bold text-gray-600 cursor-pointer top-4 right-4 hover:text-gray-800"
          onClick={onClose}
        />
        <div ref={invoiceRef}>
          <Card>
            <CardHeader className="p-4 text-white rounded-t-lg bg-gradient-to-r from-blue-500 to-indigo-500">
              <CardTitle className="text-2xl font-bold">
                Invoice #{invoice?.invoiceNumber}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {invoice?.companyLogo && (
                <Image
                  src={invoice?.companyLogo}
                  alt="Company Logo"
                  className="object-contain w-24 h-24 mb-4"
                />
              )}
              <h2 className="text-xl font-semibold">{invoice?.companyName}</h2>
              <p className="mt-1 text-gray-700">{invoice?.billTo}</p>
              <div className="mt-4 space-y-1">
                <p>
                  <span className="font-semibold">Invoice Date:</span>{" "}
                  {new Date(invoice?.invoiceDate).toLocaleDateString()}
                </p>
                <p>
                  <span className="font-semibold">Due Date:</span>{" "}
                  {new Date(invoice?.dueDate).toLocaleDateString()}
                </p>
                <p>
                  <span className="font-semibold">Terms:</span> {invoice?.terms}
                </p>
              </div>
              <div className="mt-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Unit Price</TableHead>
                      <TableHead>Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice?.items.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">
                          {item?.name}
                        </TableCell>
                        <TableCell>{item?.quantity}</TableCell>
                        <TableCell>₹{item?.price.toFixed(2)}</TableCell>
                        <TableCell>
                          ₹{(item?.quantity * item?.price).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-4 text-right">
                <p className="text-lg font-bold">
                  Total: ₹{calculateTotal().toFixed(2)}
                </p>
              </div>
              <p className="mt-4 text-sm text-gray-500">
                Generated by Invoicey
              </p>
            </CardContent>
          </Card>
        </div>
        <div className="flex justify-end mt-4 space-x-4">
          <Button onClick={downloadInvoice} variant="outline">
            Download Invoice
          </Button>
        </div>
      </div>
    </div>
  );
};

export default InvoiceModal;
