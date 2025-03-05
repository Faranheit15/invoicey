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
import { PlusIcon } from "@radix-ui/react-icons";

interface Invoice {
  _id: string;
  title: string;
  amount: number;
  createdAt: string;
}

const DashboardPage = () => {
  const [user, setUser] = useState<{ name: string } | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const router = useRouter();
  const userSessionManager = new UserSessionManager();

  // Load user data only on the client
  useEffect(() => {
    setUser(userSessionManager.user || null);
  }, []);

  const getGreeting = () => {
    if (typeof window === "undefined") return ""; // Prevents SSR mismatch
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  const getEmoji = () => {
    if (typeof window === "undefined") return ""; // Prevents SSR mismatch
    const hour = new Date().getHours();
    if (hour < 12) return "☀️";
    if (hour < 18) return "🌇";
    return "🌒";
  };

  useEffect(() => {
    const fetchInvoices = async () => {
      try {
        const sessionToken = userSessionManager.sessionToken;
        if (!sessionToken) {
          router.push("/auth");
          return;
        }

        const res = await fetch("/api/invoices", {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });

        if (!res.ok) {
          console.error("Failed to fetch invoices");
          setInvoices([]); // Ensure invoices is at least an empty array
          return;
        }

        const data = await res.json();
        setInvoices(data.invoices || []); // Default to an empty array if `data.invoices` is undefined
      } catch (error) {
        console.error("Error fetching invoices:", error);
        setInvoices([]); // Ensure invoices is at least an empty array
      }
    };

    fetchInvoices();
  }, [router]);

  return (
    <div className="container py-10 mx-auto">
      <div className="flex items-center justify-between mb-6">
        {/* Prevent rendering until user data is available */}
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
          {invoices?.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices?.map((invoice) => (
                  <TableRow key={invoice._id}>
                    <TableCell>{invoice.title}</TableCell>
                    <TableCell>${invoice.amount.toFixed(2)}</TableCell>
                    <TableCell>
                      {new Date(invoice.createdAt).toLocaleDateString()}
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
    </div>
  );
};

export default DashboardPage;
