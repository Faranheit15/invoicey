"use client";

import { PieChart, Pie, Cell, Tooltip } from "recharts";
import { ChartFrame, ChartTooltip } from "./chart-container";

// Match the status-pill hues so the donut and the table pills agree.
const STATUS_COLORS: Record<string, string> = {
  draft: "#94a3b8",
  sent: "#3b82f6",
  paid: "#10b981",
  overdue: "#f43f5e",
};

const colorFor = (status: string) => STATUS_COLORS[status] ?? "#94a3b8";

export function StatusDonut({
  data,
  animate = true,
}: {
  data: { status: string; count: number }[];
  animate?: boolean;
}) {
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div>
      <div className="relative">
        <ChartFrame height={220}>
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="status"
              innerRadius={62}
              outerRadius={90}
              paddingAngle={2}
              stroke="none"
              isAnimationActive={animate}
              animationDuration={700}
            >
              {data.map((d) => (
                <Cell key={d.status} fill={colorFor(d.status)} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ChartFrame>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-2xl font-semibold text-slate-900 dark:text-slate-100">
            {total}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            invoices
          </span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {data.map((d) => (
          <span
            key={d.status}
            className="flex items-center gap-1.5 text-xs capitalize text-slate-600 dark:text-slate-300"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: colorFor(d.status) }}
            />
            {d.status}
            <span className="tabular text-slate-400">{d.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
