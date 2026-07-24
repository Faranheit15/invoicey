"use client";

import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { ArrowTopRightIcon } from "@radix-ui/react-icons";
import { useCountUp } from "@/lib/hooks/use-count-up";
import { MicroLabel } from "@/components/ui/micro-label";
import { cn } from "@/lib/utils";

type Accent = "slate" | "rose" | "emerald" | "amber" | "blue" | "violet";

const accentText: Record<Accent, string> = {
  slate: "text-slate-900 dark:text-slate-100",
  rose: "text-rose-600 dark:text-rose-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  blue: "text-blue-600 dark:text-blue-400",
  violet: "text-violet-600 dark:text-violet-400",
};

interface KpiCardProps {
  label: string;
  value: number;
  format?: (value: number) => string;
  hint?: string;
  accent?: Accent;
  href?: string;
}

export function KpiCard({
  label,
  value,
  format,
  hint,
  accent = "slate",
  href,
}: KpiCardProps) {
  const reduce = useReducedMotion();
  const animated = useCountUp(value, { enabled: !reduce });
  const shown = reduce ? value : animated;
  const display = format
    ? format(shown)
    : Math.round(shown).toLocaleString();

  const body = (
    <div className="group relative h-full rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <MicroLabel variant="meta">{label}</MicroLabel>
        {href ? (
          <ArrowTopRightIcon className="h-3.5 w-3.5 text-slate-300 transition-colors group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-400" />
        ) : null}
      </div>
      <p className={cn("tabular mt-2 text-3xl font-semibold", accentText[accent])}>
        {display}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      ) : null}
    </div>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}
