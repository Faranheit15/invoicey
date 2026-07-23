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
import { AlertBanner } from "@/components/ui/alert-banner";
import { ConfirmDialog } from "@/components/ui/modal";
import {
  InvoiceCardList,
  InvoiceRowActions,
  statusClassName,
} from "@/components/InvoiceRowActions";
import {
  invoicesApi,
  describeRequestError,
  UnauthenticatedError,
} from "@/lib/api-client";
import {
  InvoiceRecord,
  formatCurrency,
  formatDateLong,
  getInvoiceStatus,
} from "@/lib/invoices";

const DASHBOARD_AUTH_PATH = "/auth?next=%2Fdashboard";
import { PlusIcon, ReloadIcon } from "@radix-ui/react-icons";
import InvoiceModal from "@/components/InvoiceModal";
import UserSessionManager from "@/modules/UserSessionManager";


export default function DashboardPage() {
  const router = useRouter();

  const [user, setUser] = useState<{ name?: string } | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [canRetryLoad, setCanRetryLoad] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingDelete, setPendingDelete] = useState<InvoiceRecord | null>(null);
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
      setCanRetryLoad(false);

      const data = await invoicesApi.list();
      setInvoices(data || []);
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        if (error.reason === "verify-email") {
          setLoadError("Verify your email to reach your dashboard.");
          router.replace(`${DASHBOARD_AUTH_PATH}&reason=verify-email`);
        } else {
          router.replace(DASHBOARD_AUTH_PATH);
        }
        return;
      }
      const { message, canRetry } = describeRequestError(
        error,
        "Couldn't load your invoices."
      );
      setLoadError(message);
      setCanRetryLoad(canRetry);
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
        setCanRetryLoad(false);
        setNotice("");

        await invoicesApi.patch(invoiceId, payload);
        return true;
      } catch (error) {
        if (error instanceof UnauthenticatedError) {
          if (error.reason === "verify-email") {
            setLoadError("Verify your email before managing invoices.");
            router.replace(`${DASHBOARD_AUTH_PATH}&reason=verify-email`);
          } else {
            router.replace(DASHBOARD_AUTH_PATH);
          }
          return false;
        }
        const { message } = describeRequestError(
          error,
          "Couldn't update that invoice."
        );
        setLoadError(message);
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
      setNotice("Marked as paid.");
      await fetchInvoices();
    }
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    if (!target) {
      return;
    }

    const ok = await patchInvoice(target._id, { action: "soft_delete" });
    setPendingDelete(null);
    if (ok) {
      setSelectedInvoice(null);
      setNotice(`${target.invoiceNumber || "Invoice"} removed from your list.`);
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

    // Totals are only meaningful within one currency. This used to sum every
    // invoice into one number and label it with whatever currency the first
    // invoice happened to use, so an INR + USD account read a total that was
    // arithmetically real and financially meaningless. Group by currency and
    // report the dominant one, saying plainly when others are excluded.
    const sumByCurrency = (records: InvoiceRecord[]) =>
      records.reduce<Record<string, number>>((acc, invoice) => {
        const code = invoice.currency || "INR";
        acc[code] = (acc[code] || 0) + invoice.total;
        return acc;
      }, {});

    const counts = invoices.reduce<Record<string, number>>((acc, invoice) => {
      const code = invoice.currency || "INR";
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {});

    const currencies = Object.keys(counts);
    const primaryCurrency =
      currencies.sort((a, b) => counts[b] - counts[a])[0] || "INR";

    const revenueByCurrency = sumByCurrency(paid);
    const pendingByCurrency = sumByCurrency(outstanding);

    return {
      count: invoices.length,
      totalRevenue: revenueByCurrency[primaryCurrency] || 0,
      pendingAmount: pendingByCurrency[primaryCurrency] || 0,
      currency: primaryCurrency,
      otherCurrencyCount: currencies.length - 1,
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
              <p className="break-words text-3xl font-semibold text-slate-900 dark:text-slate-100">
                {formatCurrency(summary.totalRevenue, summary.currency)}
              </p>
              {summary.otherCurrencyCount > 0 ? (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {summary.currency} only — {summary.otherCurrencyCount} other{" "}
                  {summary.otherCurrencyCount === 1 ? "currency" : "currencies"} not
                  included
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card className="border-slate-200 dark:border-slate-700 dark:bg-slate-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500 dark:text-slate-300">
                Outstanding
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="break-words text-3xl font-semibold text-slate-900 dark:text-slate-100">
                {formatCurrency(summary.pendingAmount, summary.currency)}
              </p>
              {summary.otherCurrencyCount > 0 ? (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {summary.currency} only
                </p>
              ) : null}
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
              <div className="p-4">
                <AlertBanner
                  onRetry={canRetryLoad ? fetchInvoices : undefined}
                >
                  {loadError}
                </AlertBanner>
              </div>
            ) : null}

            {notice ? (
              <div className="p-4">
                <AlertBanner tone="success">{notice}</AlertBanner>
              </div>
            ) : null}

            {isLoading ? (
              <div className="flex items-center gap-2 px-6 py-8 text-slate-600 dark:text-slate-300">
                <ReloadIcon className="w-4 h-4 animate-spin" />
                Loading invoices...
              </div>
            ) : invoices.length ? (
              <>
                <InvoiceCardList
                  className="md:hidden"
                  invoices={invoices}
                  activeActionInvoiceId={activeActionInvoiceId}
                  handlersFor={(invoice) => ({
                    onView: () => setSelectedInvoice(invoice),
                    onEdit: () => router.push(`/create-invoice/${invoice._id}`),
                    onSettle: () => settleInvoice(invoice._id),
                    onDelete: () => setPendingDelete(invoice),
                  })}
                />

                {/* From md the table earns its place: seven columns compared
                    down a page is the whole point of a dashboard. min-w keeps
                    money and dates readable and lets the wrapper scroll rather
                    than crushing columns. */}
                <Table className="hidden min-w-[920px] md:table">
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
                        <TableCell className="max-w-[180px] truncate font-medium text-slate-800 dark:text-slate-100">
                          {invoice.invoiceNumber}
                        </TableCell>
                        <TableCell
                          className="max-w-[220px] truncate text-slate-600 dark:text-slate-300"
                          title={invoice.billTo}
                        >
                          {invoice.billTo}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold uppercase ${statusClassName[status]}`}
                          >
                            {status}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                          {formatDateLong(invoice.invoiceDate)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                          {formatDateLong(invoice.dueDate)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-medium text-slate-800 dark:text-slate-100">
                          {formatCurrency(invoice.total, invoice.currency)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <InvoiceRowActions
                              invoice={invoice}
                              status={status}
                              isActioning={isActioning}
                              onView={() => setSelectedInvoice(invoice)}
                              onEdit={() =>
                                router.push(`/create-invoice/${invoice._id}`)
                              }
                              onSettle={() => settleInvoice(invoice._id)}
                              onDelete={() => setPendingDelete(invoice)}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                </Table>
              </>
            ) : loadError ? null : (
              <div className="px-6 py-12 text-center">
                <p className="text-base font-medium text-slate-800 dark:text-slate-100">
                  No invoices yet
                </p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600 dark:text-slate-300">
                  Your first one takes about a minute — or describe the job in a
                  sentence and let the assistant fill it in.
                </p>
                <Button className="mt-5" onClick={() => router.push("/create-invoice")}>
                  <PlusIcon className="w-4 h-4" />
                  Create your first invoice
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Remove this invoice?"
        description={
          <>
            <strong className="font-semibold text-slate-800 dark:text-slate-100">
              {pendingDelete?.invoiceNumber || "This invoice"}
            </strong>{" "}
            for {pendingDelete?.billTo || "this client"} will disappear from your
            dashboard and stop counting toward your totals. It is not erased — the
            record is kept — but there is no way to bring it back from here.
          </>
        }
        confirmLabel="Remove invoice"
        isPending={Boolean(
          pendingDelete && activeActionInvoiceId === pendingDelete._id
        )}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {selectedInvoice ? (
        <InvoiceModal
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          onSettle={settleInvoice}
          onDelete={() => setPendingDelete(selectedInvoice)}
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
