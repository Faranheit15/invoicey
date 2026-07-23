import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  CheckCircledIcon,
  ExclamationTriangleIcon,
  InfoCircledIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";

type AlertTone = "error" | "success" | "info";

/**
 * The one feedback surface for errors, confirmations, and notices.
 *
 * Every message the app surfaces goes through here so it is announced to
 * assistive tech: `error` uses role="alert" (assertive — the user's action just
 * failed), the quieter tones use role="status" (polite — don't interrupt).
 * Structure stays a 1px hairline per the system's border-only depth rule.
 */
const toneStyles: Record<AlertTone, string> = {
  error:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/40 dark:bg-rose-500/15 dark:text-rose-200",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-200",
  info:
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200",
};

const toneIcon: Record<AlertTone, React.ReactNode> = {
  error: <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />,
  success: <CheckCircledIcon className="mt-0.5 h-4 w-4 shrink-0" />,
  info: <InfoCircledIcon className="mt-0.5 h-4 w-4 shrink-0" />,
};

interface AlertBannerProps {
  tone?: AlertTone;
  children: React.ReactNode;
  /** Renders a retry control. Only pass when repeating the action can succeed. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function AlertBanner({
  tone = "error",
  children,
  onRetry,
  retryLabel = "Try again",
  className,
}: AlertBannerProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border px-4 py-3 text-sm",
        toneStyles[tone],
        className
      )}
    >
      {toneIcon[tone]}
      <p className="min-w-0 flex-1 break-words">{children}</p>
      {onRetry ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRetry}
          className="shrink-0 border-current bg-transparent text-inherit hover:bg-black/5 hover:text-inherit dark:hover:bg-white/10"
        >
          <ReloadIcon className="h-4 w-4" />
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Invisible polite live region for transient progress the user should hear but
 * not see twice ("Saving invoice…", "Applied 6 fields"). Always mounted so
 * screen readers register it before the text changes; an element that appears
 * and announces in the same tick is unreliable across readers.
 */
export function LiveStatus({ children }: { children?: React.ReactNode }) {
  return (
    <p aria-live="polite" className="sr-only">
      {children}
    </p>
  );
}
