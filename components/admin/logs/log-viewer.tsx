"use client";

import { useEffect, useRef } from "react";
import { useLogsQuery } from "@/lib/hooks/use-logs-query";
import type { LogFilters } from "@/lib/hooks/use-logs-query";
import { LogRow } from "./log-row";
import { LogFilterBar } from "./log-filter-bar";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/admin/empty-state";

export function LogViewer({ initialFilters }: { initialFilters?: LogFilters }) {
  const logs = useLogsQuery(initialFilters);
  const { nextCursor, tailing, loadMore } = logs;
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !nextCursor || tailing) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [nextCursor, tailing, loadMore]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 p-4 dark:border-slate-800">
        <LogFilterBar
          filters={logs.filters}
          onFilters={logs.setFilters}
          tailing={logs.tailing}
          onToggleTail={logs.toggleTail}
        />
      </div>

      {logs.error ? (
        <div className="p-4">
          <AlertBanner onRetry={logs.canRetry ? logs.refetch : undefined}>
            {logs.error}
          </AlertBanner>
        </div>
      ) : null}

      {logs.isLoading ? (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="px-4 py-3">
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      ) : logs.entries.length ? (
        <>
          <ul>
            {logs.entries.map((log) => (
              <LogRow key={log._id} log={log} />
            ))}
          </ul>
          {logs.nextCursor && !logs.tailing ? (
            <div ref={sentinelRef} className="p-4 text-center">
              <button
                type="button"
                onClick={logs.loadMore}
                disabled={logs.isLoadingMore}
                className="text-sm text-slate-500 transition-colors hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-100"
              >
                {logs.isLoadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="No logs match these filters"
          description="Try a broader level, a different category, or clear the search."
        />
      )}
    </div>
  );
}
