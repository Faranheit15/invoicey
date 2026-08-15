/**
 * Numeric text-field editing: the pure state machine behind
 * `components/ui/numeric-input.tsx`.
 *
 * The editor used to bind `<input type="number">` straight to a `number` in
 * form state and coerce on every keystroke, which made a field impossible to
 * clear: backspacing to "" fell back to the minimum, React re-rendered that
 * number with the caret at the end, and the next keypress appended to it
 * ("1" -> can only ever become 12, 18, 19...). Partially typed decimals were
 * lost the same way, because `type="number"` reports "" for "12." — the browser
 * cannot tell "cleared" from "half typed", which is why the control is a text
 * input with an explicit draft string instead.
 *
 * The rule the whole module follows: while a field is being edited, the DRAFT
 * STRING is what the user sees, and the committed number is only ever a
 * best-effort reading of it. The lower bound is deferred to blur (it is what
 * made "1" unremovable); the upper bound and the rounding are applied on every
 * keystroke, because nothing downstream enforces a ceiling.
 *
 * No React and no DOM here — this repo has no DOM test harness, so the logic
 * that can actually be wrong lives where `bun test` can reach it.
 */

export interface NumericFieldSpec {
  /** Committed floor. Applied on blur only, never while typing. */
  min: number;
  /** Committed ceiling. Applied on every keystroke. */
  max: number;
  /** Fractional digits allowed. 0 = integers only (rejects "."). */
  decimals: number;
}

/**
 * The outcome of one edit step: what the field should now display, and what (if
 * anything) to hand back to the parent. `emit: null` means "do not touch the
 * committed value" — distinct from emitting 0.
 */
export interface NumericTransition {
  draft: string | null;
  emit: number | null;
  /** True when the keystroke was refused and `draft` is the previous text. */
  rejected: boolean;
}

/** Digits, optionally one dot, optionally a fractional part. No sign, no exponent. */
const DRAFT_PATTERN = /^\d*(\.\d*)?$/;

/**
 * Guards against precision nonsense from a paste or a stuck key. Every real
 * ceiling in the app is 9 digits, so this only ever fires on garbage.
 */
const MAX_INTEGER_DIGITS = 15;

const roundTo = (value: number, decimals: number): number =>
  Number(value.toFixed(decimals));

/**
 * Sanitize one keystroke's worth of input.
 *
 * Returns the text the field should show, or `null` to refuse the change and
 * leave the previous draft in place. "" is a legal draft — that is the whole
 * point of this module.
 */
export const sanitizeNumericDraft = (
  raw: string,
  spec: NumericFieldSpec
): string | null => {
  if (raw === "") {
    return "";
  }
  if (!DRAFT_PATTERN.test(raw)) {
    return null;
  }

  const [integerPart, fractionPart = ""] = raw.split(".");
  const hasDot = raw.includes(".");

  if (hasDot && spec.decimals <= 0) {
    return null;
  }
  if (fractionPart.length > spec.decimals) {
    return null;
  }
  if (integerPart.length > MAX_INTEGER_DIGITS) {
    return null;
  }

  // "007" -> "7", but "0.5" and a mid-typing "0." keep their leading zero.
  const trimmedInteger = integerPart.replace(/^0+(?=\d)/, "");
  return hasDot ? `${trimmedInteger}.${fractionPart}` : trimmedInteger;
};

/**
 * Read a draft as a number. `null` only for drafts that carry no digits at all
 * ("" and "."); "12." is a perfectly good 12, which is what keeps the totals
 * from flickering to zero halfway through typing a decimal.
 */
export const parseNumericDraft = (draft: string): number | null => {
  if (draft === "" || draft === ".") {
    return null;
  }
  const parsed = Number(draft);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * The value to publish while typing: rounded and capped, but NOT floored — the
 * floor is what a half-finished entry would fight with. An empty draft
 * publishes the minimum (a blank Qty means 1, a blank Discount means 0) rather
 * than 0 across the board, so clearing Qty cannot momentarily zero the subtotal
 * and, through the percent-mode effects, the stored CGST/SGST.
 */
export const liveNumericValue = (
  draft: string,
  spec: NumericFieldSpec
): number => {
  const parsed = parseNumericDraft(draft);
  if (parsed === null) {
    return spec.min;
  }
  return Math.min(spec.max, roundTo(parsed, spec.decimals));
};

/** The value to publish on blur: rounded, then clamped into [min, max]. */
export const commitNumericDraft = (
  draft: string,
  spec: NumericFieldSpec
): number => {
  const parsed = parseNumericDraft(draft);
  if (parsed === null) {
    return spec.min;
  }
  return Math.min(spec.max, Math.max(spec.min, roundTo(parsed, spec.decimals)));
};

/**
 * Render a committed value as editable text. Deliberately NOT `toFixed`:
 * padding would rewrite every money field at rest from "0" to "0.00", and would
 * misreport a fractional quantity the AI assistant is allowed to set.
 */
export const formatNumericValue = (value: number): string =>
  Number.isFinite(value) ? String(value) : "0";

/** Focus: seed the draft from the committed value. Publishes nothing. */
export const beginNumericEdit = (value: number): NumericTransition => ({
  draft: formatNumericValue(value),
  emit: null,
  rejected: false,
});

/** Keystroke: sanitize, then publish the live reading of the new draft. */
export const changeNumericDraft = (
  raw: string,
  previousDraft: string | null,
  value: number,
  spec: NumericFieldSpec
): NumericTransition => {
  const sanitized = sanitizeNumericDraft(raw, spec);
  if (sanitized === null) {
    return {
      draft: previousDraft ?? formatNumericValue(value),
      emit: null,
      rejected: true,
    };
  }
  return {
    draft: sanitized,
    emit: liveNumericValue(sanitized, spec),
    rejected: false,
  };
};

/**
 * Blur: clamp and hand the draft back. A field that was never typed into
 * (`draft === null`) publishes nothing, so merely tabbing through cannot turn a
 * pristine value into an edited one.
 */
export const commitNumericEdit = (
  draft: string | null,
  spec: NumericFieldSpec
): NumericTransition => {
  if (draft === null) {
    return { draft: null, emit: null, rejected: false };
  }
  return { draft: null, emit: commitNumericDraft(draft, spec), rejected: false };
};

/**
 * Should the draft be dropped because the committed value moved underneath us?
 *
 * `lastEmitted` is the last number this field itself published. Anything else —
 * an AI patch replacing the line items, a row removed above this one (rows are
 * keyed by index), a %/₹ toggle — means the text on screen belongs to data that
 * is no longer there.
 */
export const shouldResyncNumericDraft = (
  value: number,
  lastEmitted: number | null
): boolean => lastEmitted !== null && lastEmitted !== value;
