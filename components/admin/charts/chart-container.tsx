"use client";

import * as React from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { MicroLabel } from "@/components/ui/micro-label";

// Chart chrome uses the inverting tokens so light/dark parity is free; series
// colors come from --chart-* (which now have dark overrides in globals.css).
export const AXIS_TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 12 };
export const GRID_STROKE = "hsl(var(--border))";

export const formatDay = (value: string | number): string => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/** Fixed-height frame so ResponsiveContainer always has a box to fill. */
export function ChartFrame({
  children,
  height = 280,
  className,
}: {
  children: React.ReactElement;
  height?: number;
  className?: string;
}) {
  return (
    <div className={cn("tabular w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: { color?: string; name?: string; value?: number }[];
  valueFormatter?: (value: number) => string;
  labelFormatter?: (value: string | number) => string;
}

/** One tooltip look for every chart — popover tokens, not recharts' white box. */
export function ChartTooltip({
  active,
  label,
  payload,
  valueFormatter,
  labelFormatter,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {label !== undefined && label !== "" ? (
        <div className="mb-1 font-medium text-slate-500 dark:text-slate-400">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      ) : null}
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: entry.color }}
          />
          {entry.name ? (
            <span className="text-slate-600 dark:text-slate-300">
              {entry.name}
            </span>
          ) : null}
          <span className="tabular ml-auto pl-3 font-semibold text-slate-900 dark:text-slate-100">
            {valueFormatter && typeof entry.value === "number"
              ? valueFormatter(entry.value)
              : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A titled card that wraps a chart, matching the flat app card idiom. */
export function ChartCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900",
        className
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <MicroLabel variant="section" as="h2">
          {title}
        </MicroLabel>
        {action}
      </div>
      {children}
    </div>
  );
}
