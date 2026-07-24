"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ReloadIcon,
  ChevronDownIcon,
  StarFilledIcon,
} from "@radix-ui/react-icons";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard } from "@/components/admin/kpi-card";
import { EmptyState } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertBanner } from "@/components/ui/alert-banner";
import { SelectField } from "@/components/ui/select-field";
import { SearchInput } from "@/components/ui/search-input";
import { Pagination } from "@/components/ui/pagination";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { adminApi, describeRequestError } from "@/lib/api-client";
import { formatDateLong } from "@/lib/invoices";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABEL,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABEL,
} from "@/lib/feedback";
import type { FeedbackStatus } from "@/lib/feedback";
import type { AdminFeedbackRow } from "@/lib/admin-types";

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...FEEDBACK_STATUSES.map((s) => ({ value: s, label: FEEDBACK_STATUS_LABEL[s] })),
];
const CATEGORY_OPTIONS = [
  { value: "", label: "All types" },
  ...FEEDBACK_CATEGORIES.map((c) => ({
    value: c,
    label: FEEDBACK_CATEGORY_LABEL[c],
  })),
];

const statusVariant = (
  status: FeedbackStatus
): "info" | "success" | "neutral" =>
  status === "new" ? "info" : status === "reviewed" ? "success" : "neutral";

function StatusMenu({
  id,
  current,
  onChanged,
  onError,
}: {
  id: string;
  current: FeedbackStatus;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const set = async (status: string) => {
    try {
      setPending(true);
      await adminApi.feedbackAction(id, status);
      onChanged();
    } catch (e) {
      onError(describeRequestError(e, "Couldn't update status.").message);
    } finally {
      setPending(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending}>
          {pending ? (
            <ReloadIcon className="h-4 w-4 animate-spin" />
          ) : (
            <>
              Status
              <ChevronDownIcon className="h-4 w-4" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {FEEDBACK_STATUSES.map((s) => (
          <DropdownMenuItem
            key={s}
            disabled={s === current}
            onSelect={() => set(s)}
          >
            Mark {FEEDBACK_STATUS_LABEL[s]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function AdminFeedbackPage() {
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AdminFeedbackRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({
    new: 0,
    reviewed: 0,
    archived: 0,
    total: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError("");
      const res = await adminApi.feedback({
        page,
        limit: PAGE_SIZE,
        ...(status ? { status } : {}),
        ...(category ? { category } : {}),
        ...(search ? { q: search } : {}),
      });
      setRows(res.feedback);
      setTotal(res.total);
      setCounts(res.counts);
    } catch (e) {
      const d = describeRequestError(e, "Couldn't load feedback.");
      setError(d.message);
      setCanRetry(d.canRetry);
    } finally {
      setIsLoading(false);
    }
  }, [page, status, category, search]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <AdminPageHeader
        eyebrow="Feedback"
        title="Beta feedback"
        subtitle="What your testers are telling you — triage it, and turn it into the next improvement."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={isLoading}
          >
            <ReloadIcon className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="New" value={counts.new} accent="blue" />
        <KpiCard label="Reviewed" value={counts.reviewed} accent="emerald" />
        <KpiCard label="Archived" value={counts.archived} />
        <KpiCard label="Total" value={counts.total} />
      </div>

      {notice ? (
        <div className="mb-4">
          <AlertBanner tone="success">{notice}</AlertBanner>
        </div>
      ) : null}
      {error ? (
        <div className="mb-4">
          <AlertBanner onRetry={canRetry ? load : undefined}>{error}</AlertBanner>
        </div>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <SearchInput
            value={search}
            onDebouncedChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search feedback…"
            className="min-w-[200px] flex-1"
          />
          <SelectField
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={STATUS_OPTIONS}
            className="w-auto min-w-[150px]"
          />
          <SelectField
            value={category}
            onValueChange={(v) => {
              setCategory(v);
              setPage(1);
            }}
            options={CATEGORY_OPTIONS}
            className="w-auto min-w-[140px]"
          />
        </div>

        {isLoading ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-5 py-4">
                <Skeleton className="mb-2 h-4 w-40" />
                <Skeleton className="h-4 w-full max-w-lg" />
              </div>
            ))}
          </div>
        ) : rows.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((f) => (
              <li key={f._id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {FEEDBACK_CATEGORY_LABEL[f.category]}
                      </Badge>
                      {f.rating ? (
                        <span className="inline-flex items-center gap-0.5 text-xs text-amber-500">
                          <StarFilledIcon className="h-3.5 w-3.5" />
                          {f.rating}
                        </span>
                      ) : null}
                      <Badge variant={statusVariant(f.status)}>
                        {FEEDBACK_STATUS_LABEL[f.status]}
                      </Badge>
                      <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {f.userEmail || f.userId}
                      </span>
                      <span className="tabular text-xs text-slate-400 dark:text-slate-500">
                        · {formatDateLong(f.createdAt)}
                      </span>
                    </div>
                    <p className="whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">
                      {f.message}
                    </p>
                  </div>
                  <StatusMenu
                    id={f._id}
                    current={f.status}
                    onChanged={() => {
                      setNotice("");
                      load();
                    }}
                    onError={setNotice}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No feedback matches these filters"
            description="When testers send feedback, it lands here for triage."
          />
        )}

        {total > 0 ? (
          <Pagination
            page={page}
            limit={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
            isLoading={isLoading}
          />
        ) : null}
      </div>
    </div>
  );
}
