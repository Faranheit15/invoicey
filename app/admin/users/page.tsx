"use client";

import { useState } from "react";
import { ReloadIcon } from "@radix-ui/react-icons";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { RoleBadge, StatusBadge } from "@/components/admin/badges";
import { UserRowActions } from "@/components/admin/user-row-actions";
import { ExportMenu } from "@/components/admin/export-menu";
import { useAdmin } from "@/components/admin/admin-context";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { SelectField } from "@/components/ui/select-field";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useServerTable } from "@/lib/hooks/use-server-table";
import { adminApi } from "@/lib/api-client";
import { formatCurrency, formatDateLong } from "@/lib/invoices";
import type { AdminUserRow } from "@/lib/admin-types";

const ROLE_OPTIONS = [
  { value: "", label: "All roles" },
  { value: "admin", label: "Admins" },
  { value: "user", label: "Users" },
];
const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
];

export default function AdminUsersPage() {
  const admin = useAdmin();
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState("");

  const table = useServerTable<AdminUserRow>({
    fetcher: (params) =>
      adminApi.users(params).then((r) => ({ data: r.users, total: r.total })),
    initialSort: "lastLoginAt",
    pageSize: 25,
  });

  const applyFilters = (nextRole: string, nextStatus: string) =>
    table.setFilters({
      ...(nextRole ? { role: nextRole } : {}),
      ...(nextStatus ? { status: nextStatus } : {}),
    });

  const columns: Column<AdminUserRow>[] = [
    {
      key: "email",
      header: "User",
      sortable: true,
      render: (u) => (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={u.avatar || "/default-user-avatar.svg"}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full border border-slate-200 object-cover dark:border-slate-700"
          />
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-800 dark:text-slate-100">
              {u.name || "—"}
            </div>
            <div className="truncate text-xs text-slate-500 dark:text-slate-400">
              {u.email}
            </div>
          </div>
        </div>
      ),
    },
    { key: "role", header: "Role", render: (u) => <RoleBadge role={u.role} /> },
    {
      key: "status",
      header: "Status",
      render: (u) => <StatusBadge status={u.status} />,
    },
    {
      key: "invoiceCount",
      header: "Invoices",
      className: "tabular",
      render: (u) => u.invoiceCount,
    },
    {
      key: "revenue",
      header: "Revenue",
      render: (u) => {
        if (!u.revenueByCurrency.length) {
          return <span className="text-slate-400">—</span>;
        }
        const top = [...u.revenueByCurrency].sort((a, b) => b.total - a.total)[0];
        const extra = u.revenueByCurrency.length - 1;
        return (
          <span className="tabular whitespace-nowrap">
            {formatCurrency(top.total, top.currency)}
            {extra > 0 ? (
              <span className="text-slate-400"> +{extra}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "lastLoginAt",
      header: "Last login",
      sortable: true,
      className: "tabular whitespace-nowrap",
      render: (u) => (u.lastLoginAt ? formatDateLong(u.lastLoginAt) : "—"),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (u) => (
        <div className="flex justify-end">
          <UserRowActions
            user={u}
            currentUid={admin?.uid}
            onDone={() => {
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
        eyebrow="Users"
        title="People"
        subtitle="Everyone with an Invoicey account, what they've billed, and when they were last seen."
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
            <ExportMenu onExport={adminApi.exportUsers} onError={setNotice} />
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
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <SearchInput
            value={table.search}
            onDebouncedChange={table.setSearch}
            placeholder="Search name or email…"
            className="min-w-[200px] flex-1"
          />
          <SelectField
            value={role}
            onValueChange={(v) => {
              setRole(v);
              applyFilters(v, status);
            }}
            options={ROLE_OPTIONS}
            className="w-auto min-w-[140px]"
          />
          <SelectField
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              applyFilters(role, v);
            }}
            options={STATUS_OPTIONS}
            className="w-auto min-w-[150px]"
          />
        </div>

        <DataTable
          columns={columns}
          rows={table.data}
          rowKey={(u) => u.uid}
          sort={table.sort}
          order={table.order}
          onSort={table.setSort}
          isLoading={table.isLoading}
          minWidth={900}
          emptyState={
            <EmptyState
              title="No users match these filters"
              description="Try clearing the search or filters."
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
    </div>
  );
}
