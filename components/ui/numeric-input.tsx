"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import {
  beginNumericEdit,
  changeNumericDraft,
  commitNumericEdit,
  formatNumericValue,
  shouldResyncNumericDraft,
  type NumericFieldSpec,
} from "@/lib/numeric-input";

/**
 * The resync below must not paint stale text, but this component is rendered on
 * the server too (client components are still prerendered), where a layout
 * effect would only warn.
 */
const useBrowserLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

export interface NumericInputProps
  extends Omit<
    React.ComponentProps<"input">,
    "value" | "onChange" | "type" | "min" | "max" | "step" | "inputMode"
  > {
  value: number;
  onValueChange: (value: number) => void;
  /** Committed floor, applied on blur. Defaults to 0. */
  min?: number;
  /** Committed ceiling, applied on every keystroke. */
  max: number;
  /** Fractional digits allowed. 0 = integers only. Defaults to 2. */
  decimals?: number;
}

/**
 * A number field you can actually empty.
 *
 * It is a TEXT input on purpose: `type="number"` reports "" for both a cleared
 * field and a half-typed "12.", so a control bound to a number can neither be
 * cleared nor accept a decimal. Here the raw keystrokes live in a local draft
 * string for as long as the field is focused, and the parent still only ever
 * sees numbers. `inputMode` keeps the numeric keypad on mobile.
 *
 * All of the decision-making is in `lib/numeric-input.ts`, where it is tested;
 * this component is the DOM adapter.
 */
export const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  function NumericInput(
    { value, onValueChange, min = 0, max, decimals = 2, onFocus, onBlur, ...props },
    ref
  ) {
    const spec = React.useMemo<NumericFieldSpec>(
      () => ({ min, max, decimals }),
      [min, max, decimals]
    );
    const [draft, setDraft] = React.useState<string | null>(null);
    /** The last number this field published; anything else is an outside edit. */
    const lastEmitted = React.useRef<number | null>(null);

    const publish = (next: number | null) => {
      if (next === null) {
        return;
      }
      lastEmitted.current = next;
      if (next !== value) {
        onValueChange(next);
      }
    };

    // Drop the draft when the committed value moves underneath us — an AI patch
    // replacing the line items, a row removed above this one, a %/₹ toggle.
    useBrowserLayoutEffect(() => {
      if (shouldResyncNumericDraft(value, lastEmitted.current)) {
        lastEmitted.current = null;
        setDraft(null);
      }
    }, [value]);

    const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
      lastEmitted.current = value;
      setDraft(beginNumericEdit(value).draft);
      // A lone "0" reads as a placeholder, not a number the user chose.
      if (event.target.value === "0") {
        event.target.select();
      }
      onFocus?.(event);
    };

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const transition = changeNumericDraft(event.target.value, draft, value, spec);

      if (transition.rejected) {
        // React will not re-render (state is unchanged), so the refused
        // character would otherwise stay in the DOM. Put the text back and
        // leave the caret where it was.
        const restored = transition.draft ?? "";
        const removed = event.target.value.length - restored.length;
        const caret = Math.max(0, (event.target.selectionStart ?? restored.length) - removed);
        event.target.value = restored;
        event.target.setSelectionRange(caret, caret);
        return;
      }

      setDraft(transition.draft);
      publish(transition.emit);
    };

    const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
      const transition = commitNumericEdit(draft, spec);
      setDraft(null);
      publish(transition.emit);
      onBlur?.(event);
    };

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode={decimals > 0 ? "decimal" : "numeric"}
        autoComplete="off"
        value={draft ?? formatNumericValue(value)}
        onFocus={handleFocus}
        onChange={handleChange}
        onBlur={handleBlur}
      />
    );
  }
);
