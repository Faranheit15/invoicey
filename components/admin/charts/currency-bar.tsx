"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { ChartFrame, ChartTooltip, AXIS_TICK } from "./chart-container";
import { formatCurrency } from "@/lib/invoices";

/**
 * Revenue by currency — a horizontal bar handles a variable currency count
 * better than a donut, and never sums INR + USD into one meaningless number.
 */
export function CurrencyBar({
  data,
  animate = true,
}: {
  data: { currency: string; total: number }[];
  animate?: boolean;
}) {
  return (
    <ChartFrame height={Math.max(160, data.length * 52)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="currency"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
          content={
            <ChartTooltip
              valueFormatter={(v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            />
          }
        />
        <Bar
          dataKey="total"
          name="Revenue"
          radius={[0, 6, 6, 0]}
          fill="hsl(var(--chart-2))"
          isAnimationActive={animate}
          animationDuration={650}
        />
      </BarChart>
    </ChartFrame>
  );
}

/** A compact legend line under the bar, formatted per-currency. */
export function CurrencyLegend({
  data,
}: {
  data: { currency: string; total: number }[];
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
      {data.map((d) => (
        <span key={d.currency} className="tabular">
          <span className="font-semibold text-slate-700 dark:text-slate-200">
            {formatCurrency(d.total, d.currency)}
          </span>{" "}
          {d.currency}
        </span>
      ))}
    </div>
  );
}
