import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Level/status color carries meaning; outline/neutral stay quiet. Both themes
// legible, aligned with statusPillClass in lib/invoice-status.ts.
const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        neutral:
          "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
        outline:
          "border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300",
        info: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200",
        success:
          "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/45 dark:text-emerald-200",
        warning:
          "bg-amber-100 text-amber-700 dark:bg-amber-900/45 dark:text-amber-200",
        danger:
          "bg-rose-100 text-rose-700 dark:bg-rose-900/45 dark:text-rose-200",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
