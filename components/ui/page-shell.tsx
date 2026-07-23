import * as React from "react";
import { cn } from "@/lib/utils";
import { Atmosphere } from "@/components/ui/atmosphere";

/**
 * The outermost `<main>` for a page.
 *
 * DESIGN.md records two registers, and each had its page shell copy-pasted:
 * the marketing/auth surfaces shared a byte-identical 140-character class
 * string across four files, and the two app surfaces shared another. Both are
 * expressed here so the difference between them stays a deliberate choice
 * rather than a divergence nobody notices.
 *
 * `tone="marketing"` also brings the spotlight atmosphere with it, because on
 * those surfaces the two always travelled together.
 */
const toneClass = {
  /** Marketing and auth: flat slate ground, generous vertical rhythm. */
  marketing:
    "relative min-h-screen overflow-hidden bg-slate-100 py-14 text-slate-900 dark:bg-slate-950 dark:text-slate-100",
  /** Dashboard and editor: quiet vertical gradient, tighter rhythm. */
  app:
    "min-h-screen bg-gradient-to-b from-slate-100 via-slate-50 to-white py-8 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950",
  /** The landing page, which owns its own section padding. */
  bare:
    "relative overflow-hidden bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100",
} as const;

export type PageTone = keyof typeof toneClass;

interface PageShellProps {
  tone: PageTone;
  children: React.ReactNode;
  /** Set false to compose the atmosphere yourself (the landing page does). */
  atmosphere?: boolean;
  /** Which bottom corner the orange counterweight takes; alternates by page. */
  counterweight?: "left" | "right";
  className?: string;
}

export function PageShell({
  tone,
  children,
  atmosphere = tone === "marketing",
  counterweight = "left",
  className,
}: PageShellProps) {
  return (
    <main
      className={cn(
        toneClass[tone],
        // The one horizontal padding ramp every surface shares.
        tone !== "bare" && "px-4 sm:px-6 lg:px-10",
        className
      )}
    >
      {atmosphere ? <Atmosphere counterweight={counterweight} /> : null}
      {children}
    </main>
  );
}
