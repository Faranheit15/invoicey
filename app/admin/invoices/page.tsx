"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReloadIcon } from "@radix-ui/react-icons";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { InvoiceAdminRowActions } from "@/components/admin/invoice-admin-row-actions";
import { ExportMenu } from "@/components/admin/export-menu";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { SelectField } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Badge } from "@/components/ui/badge";
import InvoiceModal from "@/components/InvoiceModal";
import { useServerTable } from "@/lib/hooks/use-server-table";
import { adminApi } from "@/lib/api-client";
import {
  formatCurrency,
  formatDateLong,
  getInvoiceStatus,
} from "@/lib/invoices";
import { STATUS_PILL_BASE, statusPillClass } from "@/lib/invoice-status";
import type { AdminInvoiceRow } from "@/lib/admin-types";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

function InvoicesContent() {
  const searchParams = useSearchParams();
  const userIdFilter = searchParams.get("userId") || "";
  const [status, setStatus] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<AdminInvoiceRow | null>(null);

  const initialFilters = useMemo(
    () => (userIdFilter ? { userId: userIdFilter } : {}),
    [userIdFilter]
  );

  const table = useServerTable<AdminInvoiceRow>({
    fetcher: (params) =>
      adminApi
        .invoices(params)
        .then((r) => ({ data: r.invoices, total: r.total })),
    pageSize: 25,
    initialFilters,
  });

  const applyFilters = (nextStatus: string, nextIncludeDeleted: boolean) =>
    table.setFilters({
      ...(userIdFilter ? { userId: userIdFilter } : {}),
      ...(nextStatus ? { status: nextStatus } : {}),
      ...(nextIncludeDeleted ? { includeDeleted: true } : {}),
    });

  const columns: Column<AdminInvoiceRow>[] = [
    {
      key: "invoiceNumber",
      header: "Invoice",
      className: "font-medium text-slate-800 dark:text-slate-100",
      render: (inv) => (
        <span className="inline-flex items-center gap-2">
          {inv.invoiceNumber || "—"}
          {inv.is_deleted ? <Badge variant="danger">Deleted</Badge> : null}
        </span>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      className: "max-w-[200px]",
      render: (inv) => (
        <span className="block truncate text-slate-600 dark:text-slate-300">
          {inv.ownerEmail || inv.userId}
        </span>
      ),
    },
    {
      key: "billTo",
      header: "Client",
      className: "max-w-[180px]",
      render: (inv) => (
        <span className="block truncate text-slate-600 dark:text-slate-300">
          {inv.billTo}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (inv) => {
        const s = getInvoiceStatus(inv);
        return (
          <span className={`${STATUS_PILL_BASE} ${statusPillClass[s]}`}>{s}</span>
        );
      },
    },
    {
      key: "total",
      header: "Total",
      className: "tabular whitespace-nowrap font-medium text-slate-800 dark:text-slate-100",
      render: (inv) => formatCurrency(inv.total ?? 0, inv.currency || "INR"),
    },
    {
      key: "invoiceDate",
      header: "Date",
      className: "tabular whitespace-nowrap text-slate-600 dark:text-slate-300",
      render: (inv) => formatDateLong(inv.invoiceDate),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (inv) => (
        <div className="flex justify-end">
          <InvoiceAdminRowActions
            invoice={inv}
            onView={setSelected}
            onChanged={() => {
              setNotice("");
              table.refetch();
            }}
            onError={setNotice}
          />
        </div>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        eyebrow="Invoices"
        title="All invoices"
        subtitle="Every invoice across all users. View, re-status, or soft-delete any of them."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={table.refetch}
              disabled={table.isLoading}
            >
              <ReloadIcon
                className={`h-4 w-4 ${table.isLoading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <ExportMenu onExport={adminApi.exportInvoices} onError={setNotice} />
          </>
        }
      />

      {notice ? (
        <div className="mb-4">
          <AlertBanner>{notice}</AlertBanner>
        </div>
      ) : null}
      {table.error ? (
        <div className="mb-4">
          <AlertBanner onRetry={table.canRetry ? table.refetch : undefined}>
            {table.error}
          </AlertBanner>
        </div>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 p-4 dark:border-slate-800">
          <SelectField
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              applyFilters(v, includeDeleted);
            }}
            options={STATUS_OPTIONS}
            className="w-auto min-w-[150px]"
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Switch
              checked={includeDeleted}
              onCheckedChange={(checked) => {
                setIncludeDeleted(checked);
                applyFilters(status, checked);
              }}
            />
            Show deleted
          </label>
          {userIdFilter ? (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Filtered to one user
            </span>
          ) : null}
        </div>

        <DataTable
          columns={columns}
          rows={table.data}
          rowKey={(inv) => inv._id}
          isLoading={table.isLoading}
          minWidth={920}
          emptyState={
            <EmptyState
              title="No invoices match these filters"
              description="Try a different status or turn off the deleted filter."
            />
          }
        />

        {table.total > 0 ? (
          <Pagination
            page={table.page}
            limit={table.pageSize}
            total={table.total}
            onPageChange={table.setPage}
            isLoading={table.isLoading}
          />
        ) : null}
      </div>

      {selected ? (
        <InvoiceModal invoice={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

export default function AdminInvoicesPage() {
  return (
    <Suspense
      fallback={
        <AdminPageHeader eyebrow="Invoices" title="All invoices" />
      }
    >
      <InvoicesContent />
    </Suspense>
  );
}
