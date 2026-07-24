"use client";

import { useCallback, useEffect, useState } from "react";
import { ReloadIcon } from "@radix-ui/react-icons";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { ChartCard } from "@/components/admin/charts/chart-container";
import { AreaTrendChart } from "@/components/admin/charts/area-trend-chart";
import { ActivityHeatmap } from "@/components/admin/charts/activity-heatmap";
import { EmptyState } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertBanner } from "@/components/ui/alert-banner";
import { MicroLabel } from "@/components/ui/micro-label";
import { adminApi, describeRequestError } from "@/lib/api-client";
import { LOG_CHIP_BASE, LOG_LEVEL_STYLES } from "@/lib/logs";
import type { AdminActivityResponse } from "@/lib/admin-types";

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

export default function AdminActivityPage() {
  const [activity, setActivity] = useState<AdminActivityResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [canRetry, setCanRetry] = useState(false);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError("");
      setActivity(await adminApi.activity());
    } catch (error) {
      const described = describeRequestError(error, "Couldn't load activity.");
      setLoadError(described.message);
      setCanRetry(described.canRetry);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <AdminPageHeader
        eyebrow="Activity"
        title="Usage & activity"
        subtitle="How much and when people use Invoicey, plus a live feed of what's happening."
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

      {loadError ? (
        <div className="mb-6">
          <AlertBanner onRetry={canRetry ? load : undefined}>
            {loadError}
          </AlertBanner>
        </div>
      ) : null}

      {isLoading || !activity ? (
        <div className="space-y-6">
          <Skeleton className="h-72 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : (
        <div className="space-y-6">
          <ChartCard title="Activity · last 30 days">
            {activity.timeseries.length ? (
              <AreaTrendChart
                data={activity.timeseries.map((p) => ({
                  date: p.date,
                  count: p.count,
                }))}
                series={[
                  {
                    key: "count",
                    label: "Events",
                    color: "hsl(var(--chart-3))",
                  },
                ]}
              />
            ) : (
              <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
                No activity recorded in the last 30 days.
              </p>
            )}
          </ChartCard>

          <ChartCard title="Time-of-day heatmap">
            {activity.heatmap.length ? (
              <ActivityHeatmap data={activity.heatmap} />
            ) : (
              <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                Not enough activity to chart yet.
              </p>
            )}
          </ChartCard>

          <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 p-4 dark:border-slate-800">
              <MicroLabel variant="section" as="h2">
                Recent activity
              </MicroLabel>
            </div>
            {activity.feed.length ? (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {activity.feed.map((log) => (
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
                      {log.message || log.userId || "—"}
                    </span>
                    <span className="tabular shrink-0 text-xs text-slate-400 dark:text-slate-500">
                      {formatDateTime(log.at)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No activity yet" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
