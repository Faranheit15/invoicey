import type { ReactNode } from "react";
import { MicroLabel } from "@/components/ui/micro-label";

export function AdminPageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        {eyebrow ? <MicroLabel variant="meta">{eyebrow}</MicroLabel> : null}
        <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
