"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { auth } from "@/lib/firebase";
import { requiresEmailVerification } from "@/lib/auth-client";
import {
  InvoiceRecord,
  formatCurrency,
  formatDateLong,
  getInvoiceStatus,
} from "@/lib/invoices";
import {
  EyeOpenIcon,
  Pencil1Icon,
  PlusIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import InvoiceModal from "@/components/InvoiceModal";
import UserSessionManager from "@/modules/UserSessionManager";

const statusClassName = {
  draft:
    "bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200",
  paid:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/45 dark:text-emerald-200",
  overdue: "bg-rose-100 text-rose-700 dark:bg-rose-900/45 dark:text-rose-200",
};

export default function DashboardPage() {
  const router = useRouter();

  const [user, setUser] = useState<{ name?: string } | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [activeActionInvoiceId, setActiveActionInvoiceId] = useState<string | null>(
    null
  );

  useEffect(() => {
    const userSessionManager = new UserSessionManager();
    setUser(userSessionManager.user || null);
  }, []);

  const fetchInvoices = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError("");

      const currentUser = auth.currentUser;
      if (!currentUser) {
        router.replace("/auth?next=%2Fdashboard");
        return;
      }
      if (requiresEmailVerification(currentUser)) {
        setLoadError("Please verify your email before accessing your dashboard.");
        router.replace("/auth?next=%2Fdashboard&reason=verify-email");
        return;
      }

      const token = await currentUser.getIdToken();
      const response = await fetch("/api/invoices", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorPayload = (await response.json()) as { error?: string };
        setLoadError(errorPayload.error || "Failed to fetch invoices.");
        setInvoices([]);
        return;
      }

      const data = (await response.json()) as InvoiceRecord[];
      setInvoices(data || []);
    } catch {
      setLoadError("Failed to fetch invoices.");
      setInvoices([]);
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const patchInvoice = useCallback(
    async (invoiceId: string, payload: Record<string, string>) => {
      try {
        setActiveActionInvoiceId(invoiceId);
        setLoadError("");

        const currentUser = auth.currentUser;
        if (!currentUser) {
          router.replace("/auth?next=%2Fdashboard");
          return false;
        }
        if (requiresEmailVerification(currentUser)) {
          setLoadError("Please verify your email before managing invoices.");
          router.replace("/auth?next=%2Fdashboard&reason=verify-email");
          return false;
        }

        const token = await currentUser.getIdToken();
        const response = await fetch(
          `/api/invoices?id=${encodeURIComponent(invoiceId)}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          }
        );

        if (!response.ok) {
          const errorPayload = (await response.json()) as { error?: string };
          setLoadError(errorPayload.error || "Failed to update invoice.");
          return false;
        }

        return true;
      } catch {
        setLoadError("Failed to update invoice.");
        return false;
      } finally {
        setActiveActionInvoiceId(null);
      }
    },
    [router]
  );

  const settleInvoice = async (invoiceId: string) => {
    const ok = await patchInvoice(invoiceId, { action: "settle" });
    if (ok) {
      setSelectedInvoice(null);
      await fetchInvoices();
    }
  };

  const softDeleteInvoice = async (invoiceId: string) => {
    const confirmed = window.confirm(
      "Delete this invoice from active lists? You can keep it in the database."
    );
    if (!confirmed) {
      return;
    }

    const ok = await patchInvoice(invoiceId, { action: "soft_delete" });
    if (ok) {
      setSelectedInvoice(null);
      await fetchInvoices();
    }
  };

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) {
      return "Good morning";
    }
    if (hour < 18) {
      return "Good afternoon";
    }
    return "Good evening";
  }, []);

  const summary = useMemo(() => {
    const paid = invoices.filter((invoice) => getInvoiceStatus(invoice) === "paid");
    const outstanding = invoices.filter((invoice) => {
      const status = getInvoiceStatus(invoice);
      return status === "sent" || status === "overdue";
    });

    const totalRevenue = paid.reduce((sum, invoice) => sum + invoice.total, 0);
    const pendingAmount = outstanding.reduce((sum, invoice) => sum + invoice.total, 0);

    return {
      count: invoices.length,
      totalRevenue,
      pendingAmount,
      currency: invoices[0]?.currency || "INR",
    };
  }, [invoices]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 via-slate-50 to-white px-4 py-8 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 sm:px-6 lg:px-10">
      <div className="mx-auto space-y-6 max-w-7xl">
        <section className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100">
              {greeting}
              {user?.name ? `, ${user.name}` : ""}
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Manage, review, edit, and export all your invoices from one place.
            </p>
          </div>
          <Button onClick={() => router.push("/create-invoice")}>
            <PlusIcon className="w-4 h-4" />
            New Invoice
          </Button>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Card className="border-slate-200 dark:border-slate-700 dark:bg-slate-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500 dark:text-slate-300">
                Total Invoices
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-slate-900 dark:text-slate-100">
                {summary.count}
              </p>
            </CardContent>
          </Card>
          <Card className="border-slate-200 dark:border-slate-700 dark:bg-slate-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500 dark:text-slate-300">
                Collected Revenue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-slate-900 dark:text-slate-100">
                {formatCurrency(summary.totalRevenue, summary.currency)}
              </p>
            </CardContent>
          </Card>
          <Card className="border-slate-200 dark:border-slate-700 dark:bg-slate-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500 dark:text-slate-300">
                Outstanding
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-slate-900 dark:text-slate-100">
                {formatCurrency(summary.pendingAmount, summary.currency)}
              </p>
            </CardContent>
          </Card>
        </section>

        <Card className="border-slate-200 dark:border-slate-700 dark:bg-slate-900">
          <CardHeader className="flex-row items-center justify-between border-b border-slate-200 pb-3 space-y-0 dark:border-slate-700">
            <CardTitle className="text-xl text-slate-900 dark:text-slate-100">
              Your Invoices
            </CardTitle>
            <Button variant="outline" size="sm" onClick={fetchInvoices} disabled={isLoading}>
              <ReloadIcon className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {loadError ? (
              <div className="border-l-4 border-rose-300 bg-rose-50 px-6 py-5 text-sm text-rose-700 dark:border-rose-400/60 dark:bg-rose-500/15 dark:text-rose-200">
                {loadError}
              </div>
            ) : null}

            {isLoading ? (
              <div className="flex items-center gap-2 px-6 py-8 text-slate-600 dark:text-slate-300">
                <ReloadIcon className="w-4 h-4 animate-spin" />
                Loading invoices...
              </div>
            ) : invoices.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Invoice Date</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => {
                    const status = getInvoiceStatus(invoice);
                    const isActioning = activeActionInvoiceId === invoice._id;
                    return (
                      <TableRow key={invoice._id}>
                        <TableCell className="font-medium text-slate-800 dark:text-slate-100">
                          {invoice.invoiceNumber}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300">
                          {invoice.billTo}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold uppercase ${statusClassName[status]}`}
                          >
                            {status}
                          </span>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300">
                          {formatDateLong(invoice.invoiceDate)}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300">
                          {formatDateLong(invoice.dueDate)}
                        </TableCell>
                        <TableCell className="font-medium text-slate-800 dark:text-slate-100">
                          {formatCurrency(invoice.total, invoice.currency)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedInvoice(invoice)}
                              disabled={isActioning}
                            >
                              <EyeOpenIcon className="w-4 h-4" />
                              View
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => router.push(`/create-invoice/${invoice._id}`)}
                              disabled={isActioning}
                            >
                              <Pencil1Icon className="w-4 h-4" />
                              Edit
                            </Button>
                            {status !== "paid" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => settleInvoice(invoice._id)}
                                disabled={isActioning}
                              >
                                Settle
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/50 dark:text-rose-300 dark:hover:bg-rose-500/20 dark:hover:text-rose-200"
                              onClick={() => softDeleteInvoice(invoice._id)}
                              disabled={isActioning}
                            >
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="px-6 py-10 text-center">
                <p className="text-slate-600 dark:text-slate-300">No invoices yet.</p>
                <Button className="mt-4" onClick={() => router.push("/create-invoice")}>
                  <PlusIcon className="w-4 h-4" />
                  Create your first invoice
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedInvoice ? (
        <InvoiceModal
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          onSettle={settleInvoice}
          onDelete={softDeleteInvoice}
          isMutating={activeActionInvoiceId === selectedInvoice._id}
          onEdit={(id) => {
            setSelectedInvoice(null);
            router.push(`/create-invoice/${id}`);
          }}
        />
      ) : null}
    </main>
  );
}
