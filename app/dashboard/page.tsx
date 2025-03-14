"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import UserSessionManager from "@/modules/UserSessionManager";
import { PlusIcon, EyeOpenIcon } from "@radix-ui/react-icons";
import InvoiceModal, { Invoice } from "@/components/InvoiceModal";
import { auth } from "@/lib/firebase";

const DashboardPage = () => {
  const [user, setUser] = useState<{ name: string } | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const router = useRouter();
  const userSessionManager = new UserSessionManager();

  useEffect(() => {
    setUser(userSessionManager.user || null);
  }, []);

  const getGreeting = () => {
    if (typeof window === "undefined") return "";
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  const getEmoji = () => {
    if (typeof window === "undefined") return "";
    const hour = new Date().getHours();
    if (hour < 12) return "☀️";
    if (hour < 18) return "🌇";
    return "🌒";
  };

  useEffect(() => {
    const fetchInvoices = async () => {
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
          router.push("/auth");
          return;
        }
        const token = await currentUser.getIdToken();
        const res = await fetch("/api/invoices", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          console.error("Failed to fetch invoices", await res.text());
          setInvoices([]);
          return;
        }
        const data = await res.json();
        setInvoices(data || []);
      } catch (error) {
        console.error("Error fetching invoices:", error);
        setInvoices([]);
      }
    };

    fetchInvoices();
  }, [router]);

  return (
    <div className="container py-10 mx-auto">
      <div className="flex items-center justify-between mb-6">
        {user ? (
          <h1 className="text-3xl font-bold">
            {getGreeting()} {user.name} {getEmoji()}
          </h1>
        ) : (
          <h1 className="text-3xl font-bold">Loading...</h1>
        )}
        <Button onClick={() => router.push("/create-invoice")}>
          <PlusIcon />
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Your Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice No</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Invoice Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice?._id}>
                    <TableCell>{invoice?.invoiceNumber}</TableCell>
                    <TableCell>{invoice?.companyName}</TableCell>
                    <TableCell>₹ {invoice?.total.toFixed(2)}</TableCell>
                    <TableCell>
                      {new Date(invoice?.invoiceDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button onClick={() => setSelectedInvoice(invoice)}>
                        <EyeOpenIcon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-gray-500">
              No invoices found. Create a new one to get started.
            </p>
          )}
        </CardContent>
      </Card>
      {selectedInvoice && (
        <InvoiceModal
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
        />
      )}
    </div>
  );
};

export default DashboardPage;
