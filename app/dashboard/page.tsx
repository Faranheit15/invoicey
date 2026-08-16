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
import { PageShell } from "@/components/ui/page-shell";
import { ConfirmDialog } from "@/components/ui/modal";
import {
  InvoiceCardList,
  InvoiceRowActions,
} from "@/components/InvoiceList";
import { InvoiceFilterBar } from "@/components/dashboard/invoice-filter-bar";
import { Pagination } from "@/components/ui/pagination";
import {
  STATUS_PILL_BASE,
  resolveDisplayStatus,
  statusPillClass,
} from "@/lib/invoice-status";
import {
  invoicesApi,
  profileApi,
  describeRequestError,
  UnauthenticatedError,
  type QueryParams,
} from "@/lib/api-client";
import type { InvoicePaymentDetails } from "@/lib/invoice-export";
import {
  DEFAULT_INVOICE_ORDER,
  DEFAULT_INVOICE_SORT,
  INVOICE_PAGE_SIZE,
  isInvoiceListFiltered,
  type InvoiceListState,
  type InvoiceSortField,
  type InvoiceStatusFilter,
  type SortOrder,
} from "@/lib/dashboard-query";
import { useServerTable } from "@/lib/hooks/use-server-table";
import {
  InvoiceRecord,
  formatCurrency,
  formatDateLong,
} from "@/lib/invoices";

const DASHBOARD_AUTH_PATH = "/auth?next=%2Fdashboard";
import { PlusIcon, ReloadIcon } from "@radix-ui/react-icons";
import InvoiceModal from "@/components/InvoiceModal";
import UserSessionManager from "@/modules/UserSessionManager";

export default function DashboardPage() {
  const router = useRouter();

  const [user, setUser] = useState<{ name?: string } | null>(null);
  /**
   * The WHOLE account, for the summary cards only.
   *
   * The table below is paginated now, so its rows are one page of at most
   * INVOICE_PAGE_SIZE and are also narrowed by whatever filter is active. A
   * "total outstanding" computed from that would change every time the user
   * turned a page — a number that moves when you paginate is worse than no
   * number. So the cards keep their own unpaginated read (`invoicesApi.list()`,
   * unchanged), and the table gets its own paged one.
   */
  const [summaryInvoices, setSummaryInvoices] = useState<InvoiceRecord[]>([]);
  const [isSummaryLoading, setIsSummaryLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
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

  /**
   * True when the failure was "you are not signed in", after starting the
   * redirect. Callers stop rather than rendering an error the user cannot act
   * on from a page they are about to leave.
   */
  const handleAuthFailure = useCallback(
    (error: unknown, verifyMessage: string): boolean => {
      if (!(error instanceof UnauthenticatedError)) {
        return false;
      }
      if (error.reason === "verify-email") {
        setLoadError(verifyMessage);
        router.replace(`${DASHBOARD_AUTH_PATH}&reason=verify-email`);
      } else {
        router.replace(DASHBOARD_AUTH_PATH);
      }
      return true;
    },
    [router]
  );

  // Fetched once for the whole dashboard rather than per modal open: it is one
  // document per user and it does not change between invoices. A failure is
  // silent on purpose — a missing UPI block must not stop an invoice opening.
  const [payment, setPayment] = useState<InvoicePaymentDetails | undefined>();

  useEffect(() => {
    let cancelled = false;
    void profileApi
      .get()
      .then(({ profile }) => {
        if (cancelled || !profile) return;
        setPayment({
          upiVpa: profile.upiVpa,
          payeeName: profile.companyName,
          bankName: profile.bankName,
          bankAccountName: profile.bankAccountName,
          bankAccountNumber: profile.bankAccountNumber,
          bankIfsc: profile.bankIfsc,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      setIsSummaryLoading(true);
      setLoadError("");
      setCanRetryLoad(false);

      const data = await invoicesApi.list();
      setSummaryInvoices(data || []);
    } catch (error) {
      if (handleAuthFailure(error, "Verify your email to reach your dashboard.")) {
        return;
      }
      const { message, canRetry } = describeRequestError(
        error,
        "Couldn't load your invoices."
      );
      setLoadError(message);
      setCanRetryLoad(canRetry);
      setSummaryInvoices([]);
    } finally {
      setIsSummaryLoading(false);
    }
  }, [handleAuthFailure]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  /**
   * One page of rows. The redirect on an expired session happens here rather
   * than in the hook, which only knows how to turn an error into a message.
   */
  const fetchInvoicePage = useCallback(
    async (params: QueryParams) => {
      try {
        const response = await invoicesApi.page(params);
        return { data: response.invoices, total: response.total };
      } catch (error) {
        handleAuthFailure(error, "Verify your email to reach your dashboard.");
        throw error;
      }
    },
    [handleAuthFailure]
  );

  const table = useServerTable<InvoiceRecord>({
    fetcher: fetchInvoicePage,
    initialSort: DEFAULT_INVOICE_SORT,
    pageSize: INVOICE_PAGE_SIZE,
  });

  const { refetch: refetchTable, setSearch, setFilters } = table;

  /**
   * The filter bar's shape, read back off the hook so there is only one copy of
   * the state. Sort and order ride in `filters` rather than the hook's own
   * `setSort`, which can only toggle a direction it chose itself — the bar
   * offers "Due date (soonest)" and "Due date (latest)" as separate choices.
   */
  const listState: InvoiceListState = useMemo(
    () => ({
      search: table.search,
      status: (table.filters.status as InvoiceStatusFilter | undefined) || "",
      sort:
        (table.filters.sort as InvoiceSortField | undefined) ||
        DEFAULT_INVOICE_SORT,
      order: (table.filters.order as SortOrder | undefined) || DEFAULT_INVOICE_ORDER,
      page: table.page,
      pageSize: table.pageSize,
    }),
    [table.filters, table.page, table.pageSize, table.search]
  );

  const changeListState = useCallback(
    (next: Partial<InvoiceListState>) => {
      if (next.search !== undefined) {
        setSearch(next.search);
      }
      if (
        next.status !== undefined ||
        next.sort !== undefined ||
        next.order !== undefined
      ) {
        setFilters({
          ...(next.status !== undefined
            ? { status: next.status || undefined }
            : { status: listState.status || undefined }),
          sort: next.sort ?? listState.sort,
          order: next.order ?? listState.order,
        });
      }
    },
    [listState.order, listState.sort, listState.status, setFilters, setSearch]
  );

  const isFiltered = isInvoiceListFiltered(listState);

  /** Both reads: the page the user is looking at, and the account-wide totals. */
  const refreshAll = useCallback(() => {
    refetchTable();
    void fetchSummary();
  }, [fetchSummary, refetchTable]);

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
        if (handleAuthFailure(error, "Verify your email before managing invoices.")) {
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
    [handleAuthFailure]
  );

  const settleInvoice = async (invoiceId: string) => {
    const ok = await patchInvoice(invoiceId, { action: "settle" });
    if (ok) {
      setSelectedInvoice(null);
      setNotice("Marked as paid.");
      refreshAll();
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
      refreshAll();
    }
  };

  /**
   * Duplicate = open the editor on a NEW draft seeded from this invoice.
   *
   * Nothing is written here. The editor fetches the source through the existing
   * `GET ?id=`, resets the number, the dates and the status, and waits for the
   * user to save — see `lib/invoice-duplicate.ts` for why a server-side copy
   * would be wrong (an unreviewed saved document, and a number burnt out of a
   * series the law requires to be consecutive).
   */
  const duplicateInvoice = useCallback(
    (invoiceId: string) => {
      router.push(`/create-invoice?duplicate=${encodeURIComponent(invoiceId)}`);
    },
    [router]
  );

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

  // Computed over `summaryInvoices` — the whole account — NOT over the table's
  // current page, so paging or filtering never moves these numbers.
  const summary = useMemo(() => {
    const paid = summaryInvoices.filter(
      (invoice) => resolveDisplayStatus(invoice) === "paid"
    );
    const outstanding = summaryInvoices.filter((invoice) => {
      const status = resolveDisplayStatus(invoice);
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

    const counts = summaryInvoices.reduce<Record<string, number>>((acc, invoice) => {
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
      count: summaryInvoices.length,
      totalRevenue: revenueByCurrency[primaryCurrency] || 0,
      pendingAmount: pendingByCurrency[primaryCurrency] || 0,
      currency: primaryCurrency,
      otherCurrencyCount: currencies.length - 1,
    };
  }, [summaryInvoices]);

  return (
    <PageShell tone="app">
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
              <p className="tabular break-words text-3xl font-semibold text-slate-900 dark:text-slate-100">
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
              <p className="tabular break-words text-3xl font-semibold text-slate-900 dark:text-slate-100">
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
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={table.isLoading || isSummaryLoading}
            >
              <ReloadIcon
                className={`w-4 h-4 ${
                  table.isLoading || isSummaryLoading ? "animate-spin" : ""
                }`}
              />
              Refresh
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <InvoiceFilterBar
              state={listState}
              onChange={changeListState}
              total={table.total}
              isLoading={table.isLoading}
            />

            {loadError || table.error ? (
              <div className="p-4">
                <AlertBanner
                  onRetry={
                    loadError
                      ? canRetryLoad
                        ? refreshAll
                        : undefined
                      : table.canRetry
                        ? refetchTable
                        : undefined
                  }
                >
                  {loadError || table.error}
                </AlertBanner>
              </div>
            ) : null}

            {notice ? (
              <div className="p-4">
                <AlertBanner tone="success">{notice}</AlertBanner>
              </div>
            ) : null}

            {table.isLoading ? (
              <div className="flex items-center gap-2 px-6 py-8 text-slate-600 dark:text-slate-300">
                <ReloadIcon className="w-4 h-4 animate-spin" />
                Loading invoices…
              </div>
            ) : table.data.length ? (
              <>
                <InvoiceCardList
                  className="md:hidden"
                  invoices={table.data}
                  activeActionInvoiceId={activeActionInvoiceId}
                  handlersFor={(invoice) => ({
                    onView: () => setSelectedInvoice(invoice),
                    onEdit: () => router.push(`/create-invoice/${invoice._id}`),
                    onSettle: () => settleInvoice(invoice._id),
                    onDelete: () => setPendingDelete(invoice),
                    onDuplicate: () => duplicateInvoice(invoice._id),
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
                  {table.data.map((invoice) => {
                    const status = resolveDisplayStatus(invoice);
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
                            className={`${STATUS_PILL_BASE} ${statusPillClass[status]}`}
                          >
                            {status}
                          </span>
                        </TableCell>
                        <TableCell className="tabular whitespace-nowrap text-slate-600 dark:text-slate-300">
                          {formatDateLong(invoice.invoiceDate)}
                        </TableCell>
                        <TableCell className="tabular whitespace-nowrap text-slate-600 dark:text-slate-300">
                          {formatDateLong(invoice.dueDate)}
                        </TableCell>
                        <TableCell className="tabular whitespace-nowrap font-medium text-slate-800 dark:text-slate-100">
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
                              onDuplicate={() => duplicateInvoice(invoice._id)}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                </Table>
              </>
            ) : loadError || table.error ? null : isFiltered ? (
              /* An empty page under a filter is not an empty account. Offering
                 "create your first invoice" here would tell a user with ninety
                 invoices that they have none. */
              <div className="px-6 py-12 text-center">
                <p className="text-base font-medium text-slate-800 dark:text-slate-100">
                  No invoices match those filters
                </p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600 dark:text-slate-300">
                  Try a different search term, or clear the filters to see
                  everything again.
                </p>
                <Button
                  variant="outline"
                  className="mt-5"
                  onClick={() => changeListState({ search: "", status: "", page: 1 })}
                >
                  Clear filters
                </Button>
              </div>
            ) : (
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
          <Pagination
            page={table.page}
            limit={table.pageSize}
            total={table.total}
            onPageChange={table.setPage}
            isLoading={table.isLoading}
          />
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
          payment={payment}
          onClose={() => setSelectedInvoice(null)}
          onSettle={settleInvoice}
          onDelete={() => setPendingDelete(selectedInvoice)}
          isMutating={activeActionInvoiceId === selectedInvoice._id}
          onEdit={(id) => {
            setSelectedInvoice(null);
            router.push(`/create-invoice/${id}`);
          }}
          onDuplicate={(id) => {
            setSelectedInvoice(null);
            duplicateInvoice(id);
          }}
        />
      ) : null}
    </PageShell>
  );
}
