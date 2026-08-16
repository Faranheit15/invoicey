"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface StickyActionBarProps {
  children: React.ReactNode;
  /** Optional status line above the buttons ("Draft saved", "3 fields need attention"). */
  status?: React.ReactNode;
  className?: string;
  "aria-label"?: string;
}

/**
 * The mobile action bar: primary actions pinned to the bottom of the viewport.
 *
 * The editor puts Save Draft and Create Invoice in the PAGE HEADER, at the top
 * of a form that runs to roughly 2,400px on a phone. Filling the last field and
 * then having to scroll the whole way back up to save is the shape of the
 * problem; validation errors rendering up there too is what turns it into a
 * loop.
 *
 * Below `md` only. On a laptop the header buttons are visible without scrolling
 * and a fixed bar would just eat rows of the live preview.
 *
 * Two details that are easy to get wrong and are already solved elsewhere in
 * this app, so they are followed rather than reinvented:
 *
 * - **44px targets** come free. `app/globals.css` sizes every `button` under
 *   `@media (pointer: coarse)` to a 44px minimum — keyed off input method, not
 *   viewport width, so a touchscreen laptop gets them too. Nothing here sets a
 *   height.
 * - **Safe-area inset.** `viewport-fit=cover` lets content reach the physical
 *   edge, so the bar would otherwise sit under the home indicator on a notched
 *   phone. `max()` keeps the normal padding on hardware with no inset — the
 *   same shape `globals.css` uses for the body and the sticky header. It is an
 *   inline style because the value has to be computed by the browser.
 *
 * `sticky`, not `fixed`: a fixed bar is lifted out of flow and overlaps the end
 * of the form, hiding the last field behind itself. Sticky keeps the height in
 * the layout, so the form's own bottom padding still works.
 */
export function StickyActionBar({
  children,
  status,
  className,
  "aria-label": ariaLabel = "Invoice actions",
}: StickyActionBarProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
      }}
      className={cn(
        "sticky bottom-0 z-30 -mx-4 mt-6 border-t border-slate-200 bg-white/95 px-4 pt-3 backdrop-blur-md md:hidden",
        "dark:border-slate-700 dark:bg-slate-950/95",
        className
      )}
    >
      {status ? (
        <p className="mb-2 text-xs text-slate-600 dark:text-slate-300">{status}</p>
      ) : null}
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
