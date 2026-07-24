import * as React from "react";
import { cn } from "@/lib/utils";

/** Shimmer placeholder for loading surfaces — the app's `animate-pulse` idiom. */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-slate-200/70 dark:bg-slate-700/50",
        className
      )}
      {...props}
    />
  );
}
