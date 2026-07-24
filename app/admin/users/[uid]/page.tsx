"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { MicroLabel } from "@/components/ui/micro-label";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RoleBadge, StatusBadge } from "@/components/admin/badges";
import { UserRowActions } from "@/components/admin/user-row-actions";
import { EmptyState } from "@/components/admin/empty-state";
import { useAdmin } from "@/components/admin/admin-context";
import InvoiceModal from "@/components/InvoiceModal";
import { adminApi, describeRequestError } from "@/lib/api-client";
import {
  formatCurrency,
  formatDateLong,
  getInvoiceStatus,
} from "@/lib/invoices";
import { STATUS_PILL_BASE, statusPillClass } from "@/lib/invoice-status";
import { LOG_CHIP_BASE, LOG_LEVEL_STYLES } from "@/lib/logs";
import type { AdminInvoiceRow, AdminUserDetail } from "@/lib/admin-types";

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <MicroLabel variant="meta">{label}</MicroLabel>
      <p className="tabular mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
        {value}
      </p>
    </div>
  );
}

export default function AdminUserDetailPage() {
  const params = useParams();
  const uid = String(params.uid);
  const admin = useAdmin();
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<AdminInvoiceRow | null>(null);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError("");
      const data = await adminApi.user(uid);
      setDetail(data);
    } catch (error) {
      setLoadError(describeRequestError(error, "Couldn't load this user.").message);
    } finally {
      setIsLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    load();
  }, [load]);

  const topRevenue = detail?.user.revenueByCurrency.length
    ? [...detail.user.revenueByCurrency].sort((a, b) => b.total - a.total)[0]
    : null;

  return (
    <div>
      <Link
        href="/admin/users"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        All users
      </Link>

      {loadError ? (
        <AlertBanner onRetry={load}>{loadError}</AlertBanner>
      ) : isLoading || !detail ? (
        <div className="space-y-6">
          <Skeleton className="h-20 w-full rounded-lg" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : (
        <>
          {notice ? (
            <div className="mb-4">
              <AlertBanner>{notice}</AlertBanner>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={detail.user.avatar || "/default-user-avatar.svg"}
                alt=""
                className="h-14 w-14 rounded-full border border-slate-200 object-cover dark:border-slate-700"
              />
              <div>
                <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                  {detail.user.name || "—"}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {detail.user.email}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <RoleBadge role={detail.user.role} />
                  <StatusBadge status={detail.user.status} />
                  {detail.user.providerIds.map((p) => (
                    <span
                      key={p}
                      className="text-xs text-slate-400 dark:text-slate-500"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <UserRowActions
              user={detail.user}
              currentUid={admin?.uid}
              onDone={() => {
                setNotice("");
                load();
              }}
              onError={setNotice}
            />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Invoices" value={String(detail.user.invoiceCount)} />
            <Stat
              label="Revenue"
              value={
                topRevenue
                  ? formatCurrency(topRevenue.total, topRevenue.currency)
                  : "—"
              }
            />
            <Stat
              label="Last login"
              value={
                detail.user.lastLoginAt
                  ? formatDateLong(detail.user.lastLoginAt)
                  : "—"
              }
            />
            <Stat
              label="Joined"
              value={
                detail.user.createdAt
                  ? formatDateLong(detail.user.createdAt)
                  : "—"
              }
            />
          </div>

          <div className="mt-6">
            <Tabs defaultValue="invoices">
              <TabsList>
                <TabsTrigger value="invoices">
                  Invoices ({detail.invoicesTotal})
                </TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>

              <TabsContent value="invoices" className="mt-4">
                <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  {detail.invoices.length ? (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {detail.invoices.map((inv) => {
                        const s = getInvoiceStatus(inv);
                        return (
                          <li
                            key={inv._id}
                            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                          >
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => setSelected(inv)}
                                className="truncate font-medium text-slate-800 hover:underline dark:text-slate-100"
                              >
                                {inv.invoiceNumber || "Invoice"}
                              </button>
                              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                {inv.billTo} · {formatDateLong(inv.invoiceDate)}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span
                                className={`${STATUS_PILL_BASE} ${statusPillClass[s]}`}
                              >
                                {s}
                              </span>
                              <span className="tabular font-medium text-slate-800 dark:text-slate-100">
                                {formatCurrency(inv.total ?? 0, inv.currency || "INR")}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <EmptyState title="No invoices for this user yet" />
                  )}
                  {detail.invoicesTotal > detail.invoices.length ? (
                    <div className="border-t border-slate-200 p-3 text-center dark:border-slate-800">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/admin/invoices?userId=${uid}`}>
                          View all {detail.invoicesTotal} invoices
                        </Link>
                      </Button>
                    </div>
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent value="activity" className="mt-4">
                <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  {detail.activity.length ? (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {detail.activity.map((log) => (
                        <li
                          key={log._id}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm"
                        >
                          <span
                            className={`${LOG_CHIP_BASE} ${LOG_LEVEL_STYLES[log.level]}`}
                          >
                            {log.event}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
                            {log.message || "—"}
                          </span>
                          <span className="tabular shrink-0 text-xs text-slate-400 dark:text-slate-500">
                            {formatDateTime(log.at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState title="No recorded activity yet" />
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </>
      )}

      {selected ? (
        <InvoiceModal invoice={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}
