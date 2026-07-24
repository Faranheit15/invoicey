"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard } from "@/components/admin/kpi-card";
import { ChartCard } from "@/components/admin/charts/chart-container";
import { AreaTrendChart } from "@/components/admin/charts/area-trend-chart";
import { StatusDonut } from "@/components/admin/charts/status-donut";
import { CurrencyBar, CurrencyLegend } from "@/components/admin/charts/currency-bar";
import { ActivityHeatmap } from "@/components/admin/charts/activity-heatmap";
import { MicroLabel } from "@/components/ui/micro-label";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertBanner } from "@/components/ui/alert-banner";
import { adminApi, describeRequestError } from "@/lib/api-client";
import type { AdminOverview, AdminActivityResponse } from "@/lib/admin-types";

const formatLatency = (ms: number): string =>
  ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-slate-600 dark:text-slate-400">{label}</span>
      <span className="tabular text-sm font-semibold text-slate-900 dark:text-slate-100">
        {value}
      </span>
    </div>
  );
}

export default function AdminOverviewPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [activity, setActivity] = useState<AdminActivityResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [canRetry, setCanRetry] = useState(false);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError("");
      const [o, a] = await Promise.all([adminApi.overview(), adminApi.activity()]);
      setOverview(o);
      setActivity(a);
    } catch (error) {
      const { message, canRetry: retry } = describeRequestError(
        error,
        "Couldn't load the overview."
      );
      setLoadError(message);
      setCanRetry(retry);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const trendData = useMemo(() => {
    if (!overview) return [];
    const map = new Map<
      string,
      { date: string; signups: number; invoices: number }
    >();
    for (const p of overview.signupsOverTime) {
      map.set(p.date, { date: p.date, signups: p.count, invoices: 0 });
    }
    for (const p of overview.invoicesOverTime) {
      const existing = map.get(p.date) ?? {
        date: p.date,
        signups: 0,
        invoices: 0,
      };
      existing.invoices = p.count;
      map.set(p.date, existing);
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [overview]);

  return (
    <div>
      <AdminPageHeader
        eyebrow="Overview"
        title="Control Room"
        subtitle="Who's using Invoicey, how much, and what's happening under the hood."
      />

      {loadError ? (
        <div className="mb-6">
          <AlertBanner onRetry={canRetry ? load : undefined}>{loadError}</AlertBanner>
        </div>
      ) : null}

      {isLoading || !overview ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-lg" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Skeleton className="h-80 rounded-lg lg:col-span-2" />
            <Skeleton className="h-80 rounded-lg" />
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* KPI row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Total Users"
              value={overview.totals.users}
              hint={`${overview.activeUsers.dau} active today`}
            />
            <KpiCard
              label="Total Invoices"
              value={overview.totals.invoices}
              hint={`${overview.activeUsers.wau} weekly active users`}
            />
            <KpiCard
              label="Active Users · 30d"
              value={overview.activeUsers.mau}
              accent="blue"
              hint="Distinct users with activity"
            />
            <KpiCard
              label="Errors · 24h"
              value={overview.errors24h}
              accent={overview.errors24h > 0 ? "rose" : "emerald"}
              hint="Server-side error logs"
              href="/admin/logs?level=error"
            />
          </div>

          {/* Trend + status */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ChartCard title="Signups & invoices · 30 days" className="lg:col-span-2">
              {trendData.length ? (
                <AreaTrendChart
                  data={trendData}
                  series={[
                    { key: "signups", label: "Signups", color: "hsl(var(--chart-2))" },
                    { key: "invoices", label: "Invoices", color: "hsl(var(--chart-1))" },
                  ]}
                />
              ) : (
                <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
                  No activity in the last 30 days yet.
                </p>
              )}
            </ChartCard>
            <ChartCard title="Invoice status">
              {overview.statusBreakdown.length ? (
                <StatusDonut data={overview.statusBreakdown} />
              ) : (
                <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
                  No invoices yet.
                </p>
              )}
            </ChartCard>
          </div>

          {/* Revenue + signals */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ChartCard title="Revenue by currency · paid" className="lg:col-span-2">
              {overview.revenueByCurrency.length ? (
                <>
                  <CurrencyBar
                    data={overview.revenueByCurrency.map((r) => ({
                      currency: r.currency,
                      total: r.total,
                    }))}
                  />
                  <CurrencyLegend data={overview.revenueByCurrency} />
                </>
              ) : (
                <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
                  No paid invoices yet.
                </p>
              )}
            </ChartCard>
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <MicroLabel variant="section" as="h2">
                Signals
              </MicroLabel>
              <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                <StatRow label="Active today" value={String(overview.activeUsers.dau)} />
                <StatRow label="Active this week" value={String(overview.activeUsers.wau)} />
                <StatRow label="AI calls · 24h" value={String(overview.ai.callsToday)} />
                <StatRow
                  label="Avg AI latency"
                  value={overview.ai.callsToday ? formatLatency(overview.ai.avgLatencyMs) : "—"}
                />
              </div>
            </div>
          </div>

          {/* Heatmap */}
          <ChartCard title="When people use Invoicey · last 30 days">
            {activity && activity.heatmap.length ? (
              <ActivityHeatmap data={activity.heatmap} />
            ) : (
              <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                Not enough activity to chart yet.
              </p>
            )}
          </ChartCard>
        </div>
      )}
    </div>
  );
}
