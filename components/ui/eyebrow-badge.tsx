import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The kicker pill that opens every marketing surface and the auth page.
 *
 * Five surfaces rendered this as an identical 200-character class string with
 * only the icon and label changing. It is a badge, not a heading: it names the
 * page in the brand's voice and carries the sky accent that DESIGN.md reserves
 * for atmosphere rather than controls.
 */
interface EyebrowBadgeProps {
  children: React.ReactNode;
  /** Optional leading glyph, rendered at 14px to match the cap height. */
  icon?: React.ReactNode;
  className?: string;
}

export function EyebrowBadge({ children, icon, className }: EyebrowBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1",
        "text-[11px] font-semibold uppercase tracking-eyebrow text-sky-700",
        "dark:border-white/15 dark:bg-white/10 dark:text-sky-100",
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}
