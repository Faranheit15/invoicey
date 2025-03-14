"use client";

import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import Image from "next/image";
import { useRouter } from "next/navigation";
import UserSessionManager from "@/modules/UserSessionManager";
import { auth } from "@/lib/firebase";

const userSessionManager = new UserSessionManager();

interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export default function CreateInvoicePage() {
  const [invoice, setInvoice] = useState({
    userId: userSessionManager.user?.email || "",
    companyName: "",
    companyLogo: "",
    billTo: "",
    invoiceNumber: "",
    invoiceDate: "",
    dueDate: "",
    terms: "",
    items: [{ description: "", quantity: 1, unitPrice: 0 } as InvoiceItem],
    tax: 0,
    convenienceCharge: 0,
    paymentInfo: "",
  });
  const router = useRouter();

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setInvoice({ ...invoice, [e.target.name]: e.target.value });
  };

  const handleItemChange = (
    index: number,
    key: keyof InvoiceItem,
    value: string | number
  ) => {
    const updatedItems = [...invoice.items];
    updatedItems[index] = { ...updatedItems[index], [key]: value };
    setInvoice({ ...invoice, items: updatedItems });
  };

  const addItem = () => {
    setInvoice({
      ...invoice,
      items: [...invoice.items, { description: "", quantity: 1, unitPrice: 0 }],
    });
  };

  const removeItem = (index: number) => {
    const updatedItems = invoice.items.filter((_, i) => i !== index);
    setInvoice({ ...invoice, items: updatedItems });
  };

  const calculateTotal = () => {
    const subTotal = invoice.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0
    );
    return subTotal + Number(invoice.tax) + Number(invoice.convenienceCharge);
  };

  // const saveInvoice = async () => {
  //   const res = await fetch("/api/invoices", {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify(invoice),
  //   });
  //   if (res.ok) {
  //     router.push("/dashboard");
  //   }
  // };
  const saveInvoice = async () => {
    // Check if the user is logged in
    if (!auth.currentUser) {
      console.error("User not logged in.");
      return;
    }

    // Retrieve the Firebase ID token
    const token = await auth.currentUser.getIdToken();

    // Make the API request with the Authorization header
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(invoice),
    });

    if (res.ok) {
      router.push("/dashboard");
    } else {
      console.error("Failed to save invoice", await res.text());
    }
  };

  return (
    <div className="grid grid-cols-2 gap-4 p-6">
      {/* Left Side: Invoice Form */}
      <Card>
        <CardHeader>
          <CardTitle>Create Invoice</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Company Name"
            name="companyName"
            value={invoice.companyName}
            onChange={handleInputChange}
            className="mb-2"
          />
          <Input
            placeholder="Bill To"
            name="billTo"
            value={invoice.billTo}
            onChange={handleInputChange}
            className="mb-2"
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Invoice No"
              name="invoiceNumber"
              value={invoice.invoiceNumber}
              onChange={handleInputChange}
            />
            <Input
              placeholder="Invoice Date"
              name="invoiceDate"
              type="date"
              value={invoice.invoiceDate}
              onChange={handleInputChange}
            />
            <Input
              placeholder="Due Date"
              name="dueDate"
              type="date"
              value={invoice.dueDate}
              onChange={handleInputChange}
            />
            <Input
              placeholder="Terms"
              name="terms"
              value={invoice.terms}
              onChange={handleInputChange}
            />
          </div>
          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit Price</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.items.map((item, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Input
                      value={item.description}
                      onChange={(e) =>
                        handleItemChange(index, "description", e.target.value)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={item.quantity}
                      onChange={(e) =>
                        handleItemChange(
                          index,
                          "quantity",
                          Number(e.target.value)
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={item.unitPrice}
                      onChange={(e) =>
                        handleItemChange(
                          index,
                          "unitPrice",
                          Number(e.target.value)
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    ₹{(item.quantity * item.unitPrice).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Button onClick={() => removeItem(index)}>Remove</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button onClick={addItem} className="mt-2">
            Add Item
          </Button>
          <Input
            placeholder="Tax"
            name="tax"
            type="number"
            value={invoice.tax}
            onChange={handleInputChange}
            className="mt-4"
          />
          <Input
            placeholder="Convenience Charge"
            name="convenienceCharge"
            type="number"
            value={invoice.convenienceCharge}
            onChange={handleInputChange}
            className="mt-2"
          />
          <Textarea
            placeholder="Payment Information"
            name="paymentInfo"
            value={invoice.paymentInfo}
            onChange={handleInputChange}
            className="mt-4"
          />
        </CardContent>
        <Button onClick={saveInvoice} className="mt-4">
          Save Invoice
        </Button>
      </Card>

      {/* Right Side: Rendered Invoice Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Invoice Preview</CardTitle>
        </CardHeader>
        <CardContent>
          {invoice.companyLogo && (
            <Image
              src={invoice.companyLogo}
              alt="Company Logo"
              width={100}
              height={100}
            />
          )}
          <h2 className="text-xl font-bold">{invoice.companyName}</h2>
          <p>{invoice.billTo}</p>
          <p>Invoice No: {invoice.invoiceNumber}</p>
          <p>Invoice Date: {invoice.invoiceDate}</p>
          <p>Due Date: {invoice.dueDate}</p>
          <p>Terms: {invoice.terms}</p>
          <Table className="mt-4">
            <TableBody>
              {invoice.items.map((item, index) => (
                <TableRow key={index}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell>{item.quantity}</TableCell>
                  <TableCell>₹{item.unitPrice.toFixed(2)}</TableCell>
                  <TableCell>
                    ₹{(item.quantity * item.unitPrice).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-4">Total: ₹{calculateTotal().toFixed(2)}</p>
          <p className="text-gray-500">Generated by Invoicey</p>
        </CardContent>
      </Card>
    </div>
  );
}
