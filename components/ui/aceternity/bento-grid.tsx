import { cn } from "@/lib/utils";
import { MicroLabel } from "@/components/ui/micro-label";
import type { ReactNode } from "react";

interface BentoGridProps {
  className?: string;
  children: ReactNode;
}

interface BentoGridItemProps {
  className?: string;
  title: string;
  description: string;
  icon?: ReactNode;
  eyebrow?: string;
}

export function BentoGrid({ className, children }: BentoGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3",
        className
      )}
    >
      {children}
    </div>
  );
}

export function BentoGridItem({
  className,
  title,
  description,
  icon,
  eyebrow,
}: BentoGridItemProps) {
  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-slate-200 bg-white/80 p-5 backdrop-blur-sm transition-all duration-300 dark:border-white/10 dark:bg-white/5",
        "hover:border-sky-300/40 hover:bg-white hover:shadow-[0_20px_60px_rgba(14,165,233,0.12)] dark:hover:bg-white/[0.09]",
        className
      )}
    >
      <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.15),transparent_50%)]" />
      <div className="relative">
        {icon ? (
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-2 text-sky-700 dark:border-white/15 dark:bg-slate-900/70 dark:text-sky-200">
            {icon}
          </div>
        ) : null}
        {eyebrow ? (
          <MicroLabel variant="meta" className="mt-3">
            {eyebrow}
          </MicroLabel>
        ) : null}
        <h3 className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">
          {title}
        </h3>
        <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {description}
        </p>
      </div>
    </article>
  );
}
