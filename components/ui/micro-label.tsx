import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The uppercase, wide-tracked micro-label.
 *
 * DESIGN.md names this the system's signature typographic device — the one
 * thread running through the marketing, app, and document registers. It was
 * implemented fourteen different ways across the codebase, drifting in size
 * (11px vs 12px), tracking (wide / wider / 0.18em / 0.2em), and colour
 * (slate-500 vs slate-600) with no intent behind the differences.
 *
 * Variants are named for their role rather than exposing size/tracking/colour
 * as free axes, so a new call site has to pick a meaning rather than invent a
 * new combination.
 */
const variantClass = {
  /** Groups a form or page section. The dominant use; pair with `as="h2"`. */
  section:
    "text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400",
  /** Names a value beneath it — "Client", "Total", "Invoice Date". */
  meta:
    "text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400",
  /** Sits on the invoice sheet's near-black masthead, in both themes. */
  onDark: "text-xs uppercase tracking-eyebrow text-slate-300",
  /** Carries the sky accent, for the AI panel and other tinted surfaces. */
  accent:
    "text-xs font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300",
} as const;

export type MicroLabelVariant = keyof typeof variantClass;

interface MicroLabelProps extends React.HTMLAttributes<HTMLElement> {
  variant?: MicroLabelVariant;
  /** Rendered element. Use "h2" when the label really is a section heading. */
  as?: "p" | "span" | "div" | "h2" | "h3" | "h4";
  children: React.ReactNode;
}

export function MicroLabel({
  variant = "section",
  as: Component = "p",
  className,
  children,
  ...props
}: MicroLabelProps) {
  return (
    <Component className={cn(variantClass[variant], className)} {...props}>
      {children}
    </Component>
  );
}
