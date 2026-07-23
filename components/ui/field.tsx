"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Spread straight onto the control. Deliberately contains only real DOM
 * attributes — anything else here would land on the element and make React warn
 * about an unrecognized prop.
 */
interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
}

interface FieldProps {
  label: string;
  /**
   * `control` spreads onto the element. `labelId` is passed separately because
   * button-backed controls (select, date picker) need
   * `aria-labelledby={`${labelId} ${control.id}`}` rather than `htmlFor`: a
   * `<label for>` alone replaces the trigger's own text, so the field would
   * announce as "Currency" and swallow the selected value. Listing both ids
   * yields "Currency INR".
   */
  children: (control: FieldControlProps, labelId: string) => React.ReactNode;
  hint?: React.ReactNode;
  optional?: boolean;
  className?: string;
}

/**
 * Label + control pairing for the invoice editor.
 *
 * The editor used to identify most of its fields by `placeholder` alone, which
 * left them nameless to assistive tech and — for everyone — erased the field
 * name the moment you started typing. This renders the same visible label
 * treatment the Discount/CGST/SGST group already used, and generates the
 * id/aria-describedby wiring so no caller has to remember it.
 */
export function Field({ label, children, hint, optional, className }: FieldProps) {
  const id = React.useId();
  const labelId = `${id}-label`;
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        id={labelId}
        htmlFor={id}
        // No tracking: this label is sentence case, not uppercase, and letter-
        // spacing on lowercase text at 12px only loosens it. Case is what
        // separates a field label from the uppercase section label above it —
        // the two were previously distinguished by 0.3px of tracking alone.
        className="flex items-baseline gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300"
      >
        {label}
        {/* The leading space is load-bearing: without a text node between the
            two elements the accessible name concatenates to "Company phoneoptional". */}
        {optional ? (
          <>
            {" "}
            {/* slate-500/400 rather than a lighter grey: at 12px the lighter
                pair measured 2.56:1 on light and 3.75:1 on dark, under AA. */}
            <span className="font-normal text-slate-500 dark:text-slate-400">
              (optional)
            </span>
          </>
        ) : null}
      </label>
      {children({ id, "aria-describedby": hintId }, labelId)}
      {hint ? (
        <p id={hintId} className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
