"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import {
  ChartFrame,
  ChartTooltip,
  AXIS_TICK,
  GRID_STROKE,
  formatDay,
} from "./chart-container";

interface Series {
  key: string;
  label: string;
  color: string;
}

export function AreaTrendChart({
  data,
  series,
  animate = true,
}: {
  data: Record<string, string | number>[];
  series: Series[];
  animate?: boolean;
}) {
  return (
    <ChartFrame height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient
              key={s.key}
              id={`area-grad-${s.key}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="5%" stopColor={s.color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tick={AXIS_TICK}
          tickFormatter={formatDay}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={32}
          allowDecimals={false}
        />
        <Tooltip content={<ChartTooltip labelFormatter={formatDay} />} />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#area-grad-${s.key})`}
            isAnimationActive={animate}
            animationDuration={700}
          />
        ))}
      </AreaChart>
    </ChartFrame>
  );
}
