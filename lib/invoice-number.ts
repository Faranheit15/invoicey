/**
 * Invoice numbering: financial-year derivation, Rule 46(b) validation, and
 * series parsing / next-number suggestion.
 *
 * WHY THIS MODULE EXISTS
 *
 * The number used to be minted in the browser as
 * `INV-${Date.now().toString().slice(-6)}` (lib/invoices.ts). The last six
 * digits of the epoch in milliseconds wrap every 10^6 ms — 16 minutes and 40
 * seconds — so two invoices created 16m40s apart collide, and with no unique
 * index behind the field both saved silently. Two tabs open at the same instant
 * produced the same number by construction.
 *
 * CGST Rule 46(b) makes the number a legal object, not a label: at most 16
 * characters, drawn only from letters, digits, `-` and `/`, consecutive, and
 * unique within a financial year (1 April – 31 March). `INV #001` and `INV_001`
 * are both illegal documents.
 *
 * WHAT IS DELIBERATELY *NOT* HERE
 *
 * No counter. A counter that increments when a number is *suggested* burns a
 * number on every abandoned draft, and a gap in a series that Rule 46(b)
 * requires to be consecutive is itself an audit question. Suggestion is a read
 * of the highest existing number in the financial year; the unique index
 * (`{userId, financialYear, documentType, invoiceNumberKey}`) is what actually
 * guarantees uniqueness, and an E11000 on save is what the caller retries.
 *
 * This file is therefore pure: no database, no clock, no `Intl`, and — see
 * below — no reading of the host's local timezone. It may not import
 * `lib/invoices` or `lib/invoice-domain` (the no-runtime-cycle rule).
 *
 * TIMEZONE DECISION — read this before touching `deriveFinancialYear`
 *
 * The financial year is decided by the *civil date in India*, because the
 * financial year is a construct of Indian law. Concretely:
 *
 *   - A floating date string ("2026-04-01", or "2026-04-01T09:00:00" with no
 *     zone) already *is* a civil date. It is parsed lexically, never through
 *     `new Date`, so no timezone can enter.
 *   - A `Date`, or a string carrying `Z`/`±hh:mm`, denotes an *instant*. It is
 *     shifted by +05:30 and then read with UTC getters, which yields the civil
 *     date in IST.
 *
 * Two wrong alternatives, and why:
 *
 *   - Local getters (`getMonth()`) are non-deterministic across environments.
 *     The Docker runtime is UTC and developer machines are not.
 *     `new Date("2026-04-01")` is UTC midnight, so `getMonth()` anywhere west
 *     of UTC reports March and files a 1-April invoice into FY 2025-26 — the
 *     wrong *uniqueness scope*, which is the part that corrupts data rather
 *     than merely displaying wrongly.
 *   - Plain UTC getters are deterministic but still wrong at the boundary:
 *     1 April 04:00 IST is 2026-03-31T22:30:00Z, and UTC reads that as March.
 *     The IST shift costs nothing for the values this app actually stores —
 *     `invoiceDate` round-trips through `toISOString().split("T")[0]`, so a
 *     stored `Date` is UTC midnight, and shifting a UTC-midnight instant
 *     *forward* by less than 24 hours never moves the calendar day — while
 *     fixing the one case UTC gets wrong.
 *
 * (Related, and out of scope here: `createDefaultInvoiceFormState` seeds
 * `invoiceDate` from `new Date().toISOString()`, so an IST user creating an
 * invoice before 05:30 already gets yesterday's date in the form. That is a
 * seeding bug in `lib/invoices.ts`, not a derivation bug; this module reads
 * whatever date it is given.)
 */

/** Rule 46(b): sixteen characters, inclusive. */
export const MAX_INVOICE_NUMBER_LENGTH = 16;

/** India Standard Time is UTC+05:30 and has no daylight saving. */
export const IST_OFFSET_MINUTES = 330;

/**
 * Rule 46(b) charset and length in one expression. ASCII only — the ranges are
 * spelled out rather than using `\w`/`\d` so that Arabic-Indic, Devanagari and
 * full-width digits are rejected, which is the point. The trailing `-` inside
 * the class is a literal, not a range.
 */
export const INVOICE_NUMBER_REGEX = /^[A-Za-z0-9/-]{1,16}$/;

/** The default series. `INV/2026-27/001` is 15 characters — one to spare. */
export const DEFAULT_INVOICE_NUMBER_PATTERN = "INV/{FY}/{SEQ:3}";

/**
 * The escape hatch when the default does not fit. `INV/26-27/0001` is 14
 * characters, against 16 for `INV/2026-27/0001` — which is legal but has zero
 * headroom, so its 1000th invoice cannot be numbered at all.
 */
export const FALLBACK_INVOICE_NUMBER_PATTERN = "INV/{FY2}/{SEQ:4}";

/* -------------------------------------------------------------------------- */
/* Financial year                                                             */
/* -------------------------------------------------------------------------- */

/** A floating (zone-less) date or date-time: the string is a civil date. */
const FLOATING_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]*)?$/;

/** "2026-27". Both halves are checked for consecutiveness, not just shape. */
const FINANCIAL_YEAR_PATTERN = /^(\d{4})-(\d{2})$/;

/**
 * Is `value` a well-formed financial year like "2026-27"?
 *
 * "2026-28" is rejected: a financial year spans exactly one April boundary, so
 * the second half is always the first plus one, modulo 100 ("2099-00").
 */
export const isFinancialYear = (value: string): boolean => {
  const match = FINANCIAL_YEAR_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const startYear = Number(match[1]);
  return String((startYear + 1) % 100).padStart(2, "0") === match[2];
};

const formatFinancialYear = (startYear: number): string =>
  `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;

/**
 * The financial year a civil (year, 1-based month) falls in. April onwards
 * opens the year that carries its own name: April 2026 is FY 2026-27, and
 * January 2027 is the *back half* of that same FY, not the front of 2027-28.
 * This is the classic off-by-one — `month >= 4`, not `> 4` and not `>= 3`.
 */
const financialYearOf = (year: number, month: number): string =>
  formatFinancialYear(month >= 4 ? year : year - 1);

/**
 * "2026-27" for the financial year containing `date`.
 *
 * Derived from the invoice's own date, never from today: back-dating an
 * invoice into the previous financial year must put it in that year's
 * uniqueness scope.
 *
 * Returns "" — never throws, and never guesses — for anything unparseable, so
 * a caller can tell "no financial year" from a wrong one. Callers must treat ""
 * as a validation failure rather than storing it.
 */
export const deriveFinancialYear = (date: string | Date): string => {
  if (typeof date === "string") {
    const floating = FLOATING_DATE_PATTERN.exec(date.trim());
    if (floating) {
      const year = Number(floating[1]);
      const month = Number(floating[2]);
      const day = Number(floating[3]);
      // Shape alone is not enough: "2026-13-01" matches the pattern and would
      // otherwise be filed as April-or-later.
      if (month < 1 || month > 12 || day < 1 || day > 31) {
        return "";
      }
      return financialYearOf(year, month);
    }
    // Anything else (an instant with Z or an offset, "01/04/2026", garbage)
    // goes through Date, which is the only thing that can interpret a zone.
    return deriveFinancialYear(new Date(date));
  }

  const time = date.getTime();
  if (!Number.isFinite(time)) {
    return "";
  }
  // Read the instant as a wall clock in IST: shift, then use UTC getters. Never
  // getMonth()/getFullYear(), which would leak the host's timezone in.
  const ist = new Date(time + IST_OFFSET_MINUTES * 60_000);
  return financialYearOf(ist.getUTCFullYear(), ist.getUTCMonth() + 1);
};

/**
 * "2026-27" -> "26-27". The short form used by `{FY2}` when the long one will
 * not fit in sixteen characters. Returns "" for a malformed financial year.
 */
export const shortFinancialYear = (financialYear: string): string =>
  isFinancialYear(financialYear) ? financialYear.slice(2) : "";

/**
 * The financial year embedded in a number, if it has one: "INV/2026-27/001"
 * and "26-27/0042" both yield "2026-27".
 *
 * Used to tell "continue this series" from "this number belongs to a different
 * year, restart at 1". Returns null when the number carries no year token — a
 * plain running series like "INV-123456" — which the caller should read as
 * "no opinion", not as "different year".
 *
 * The two-digit form is assumed to be 20xx. There is no way to recover the
 * century from the number itself, and this app did not exist in 1926.
 */
export const extractFinancialYear = (value: string): string | null => {
  const long = /(\d{4})-(\d{2})(?!\d)/.exec(value);
  if (long && isFinancialYear(`${long[1]}-${long[2]}`)) {
    return `${long[1]}-${long[2]}`;
  }
  const short = /(?<!\d)(\d{2})-(\d{2})(?!\d)/.exec(value);
  if (short) {
    const candidate = `20${short[1]}-${short[2]}`;
    if (isFinancialYear(candidate)) {
      return candidate;
    }
  }
  return null;
};

/* -------------------------------------------------------------------------- */
/* Normalization and validation                                               */
/* -------------------------------------------------------------------------- */

/**
 * Trim, and remove internal whitespace entirely rather than collapsing it to a
 * space — a space is not a legal character, so "INV 001" can only be salvaged
 * by becoming "INV001". JavaScript's `\s` already covers the non-breaking space
 * (U+00A0) and the BOM (U+FEFF), which are exactly what a paste out of a PDF or
 * a spreadsheet carries.
 *
 * Case is deliberately untouched: this is the value the user sees and the value
 * printed on the document. Only `invoiceNumberKey` folds case.
 */
export const normalizeInvoiceNumber = (value: string): string =>
  value.replace(/\s+/g, "");

/**
 * The case-insensitive key the unique index is built on. `inv/2026-27/001` and
 * `INV/2026-27/001` are the same series in any real accounting sense, so a
 * case-only difference is a typo rather than an intention.
 *
 * `toUpperCase`, not `toLocaleUpperCase`: the latter maps "i" to "İ" under a
 * Turkish locale, which would make the stored key depend on the server's
 * locale and split one series into two.
 */
export const invoiceNumberKey = (value: string): string =>
  normalizeInvoiceNumber(value).toUpperCase();

/**
 * Why the number was rejected. A boolean cannot be turned into a message that
 * tells the user *which* rule they broke, and "invalid invoice number" in front
 * of a legally-constrained field is a dead end.
 */
export type InvoiceNumberProblem =
  | { code: "empty" }
  | { code: "illegal_characters"; characters: string[] }
  | { code: "too_long"; length: number; max: number };

const isLegalInvoiceNumberChar = (char: string): boolean =>
  char.length === 1 && /^[A-Za-z0-9/-]$/.test(char);

/**
 * The single reason to reject `value`, or null when it is legal.
 *
 * Does NOT trim — run `normalizeInvoiceNumber` first if the value came from an
 * input, otherwise a trailing space is reported as an illegal character.
 *
 * Reasons are checked in a fixed order — empty, then charset, then length — so
 * that a number that breaks two rules always reports the same one. Charset
 * beats length because it is the more specific complaint: "INVOICE #2026/00001"
 * is over the limit *and* contains a `#`, and telling the user to shorten it
 * would send them round the loop a second time.
 */
export const checkInvoiceNumber = (value: string): InvoiceNumberProblem | null => {
  if (value.length === 0) {
    return { code: "empty" };
  }

  // Iterate code points, not UTF-16 units, so an emoji is reported as one
  // character instead of a pair of unreadable lone surrogates.
  const illegal: string[] = [];
  for (const char of Array.from(value)) {
    if (!isLegalInvoiceNumberChar(char) && !illegal.includes(char)) {
      illegal.push(char);
    }
  }
  if (illegal.length > 0) {
    return { code: "illegal_characters", characters: illegal };
  }

  // Measured in code points as well. Every legal character is ASCII by the time
  // we get here, so the two agree — but only because the charset check ran
  // first, which is worth not relying on accidentally.
  const length = Array.from(value).length;
  if (length > MAX_INVOICE_NUMBER_LENGTH) {
    return { code: "too_long", length, max: MAX_INVOICE_NUMBER_LENGTH };
  }

  return null;
};

/** Rule 46(b) charset + length. Does not trim — normalize first. */
export const isValidInvoiceNumber = (value: string): boolean =>
  checkInvoiceNumber(value) === null;

/**
 * One user-facing sentence per problem, kept here so the editor, the API error
 * body and any future importer cannot drift in what they claim the rule is.
 */
export const invoiceNumberProblemMessage = (
  problem: InvoiceNumberProblem
): string => {
  switch (problem.code) {
    case "empty":
      return "Invoice number is required.";
    case "illegal_characters":
      return `Invoice number cannot contain ${problem.characters
        .map((char) => (char.trim() === "" ? "spaces" : `"${char}"`))
        .join(", ")}. Use only letters, numbers, - and /.`;
    case "too_long":
      return `Invoice number must be ${problem.max} characters or fewer (this one is ${problem.length}).`;
  }
};

/* -------------------------------------------------------------------------- */
/* Series parsing and the next number                                         */
/* -------------------------------------------------------------------------- */

export interface ParsedInvoiceNumber {
  /** Everything before the trailing digits. "" when the number is all digits. */
  prefix: string;
  /** The trailing digit run, as a number. */
  sequence: number;
  /** How many digits it was written with, so "001" stays three wide. */
  width: number;
}

/**
 * `(.*[^0-9])?` — greedy, and forced to end on a non-digit — makes the last
 * digit run the sequence: "INV/2026-27/001" splits after the final "/", and
 * "001" splits with an empty prefix.
 */
const SERIES_PATTERN = /^(.*[^0-9])?([0-9]+)$/;

/**
 * Split a number into a fixed prefix and a trailing zero-padded sequence, or
 * null when it has no trailing digits to increment ("ABC", "").
 *
 * Structural only — it does not require `value` to be a *legal* number, because
 * legacy rows predate any validation and the suggester still wants to read
 * their series. `nextInvoiceNumber` is where legality is enforced, on the
 * output, where it can actually be acted on.
 */
export const parseInvoiceNumber = (value: string): ParsedInvoiceNumber | null => {
  const match = SERIES_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const digits = match[2];
  const sequence = Number(digits);
  // A 16-digit run can still be read exactly; 9999999999999999 cannot, and
  // silently incrementing it to 10000000000000000 would be a fabricated number.
  if (!Number.isSafeInteger(sequence)) {
    return null;
  }
  return { prefix: match[1] ?? "", sequence, width: digits.length };
};

/**
 * The next number in the same series, or null when there isn't one.
 *
 * The width is a floor, not a cap: "099" -> "100" keeps three digits, and
 * "999" -> "1000" grows to four rather than wrapping to "000". Growing can push
 * the number past sixteen characters, which is why the result is re-validated
 * and null is a real outcome — "INV/2026-27/9999" is exactly 16 and has no
 * successor. Null also covers a legacy number whose own charset is illegal:
 * "INV_001" must not breed "INV_002".
 */
export const nextInvoiceNumber = (previous: string): string | null => {
  const parsed = parseInvoiceNumber(previous);
  if (!parsed) {
    return null;
  }
  const sequence = parsed.sequence + 1;
  if (!Number.isSafeInteger(sequence)) {
    return null;
  }
  const candidate = `${parsed.prefix}${String(sequence).padStart(parsed.width, "0")}`;
  return isValidInvoiceNumber(candidate) ? candidate : null;
};

/** `{FY}`, `{FY2}`, `{SEQ}` or `{SEQ:4}`. Anything else fails the format. */
const PATTERN_TOKEN = /\{([A-Z0-9]+)(?::(\d+))?\}/g;

export interface InvoiceNumberFormatInput {
  financialYear: string;
  sequence: number;
}

/**
 * Render a pattern: "INV/{FY}/{SEQ:3}" + FY 2026-27 + 1 -> "INV/2026-27/001".
 *
 * Returns null rather than an illegal number. That covers the trap the research
 * calls out by name — "INVOICE/{FY}/{SEQ:4}" renders to twenty characters, and
 * a twenty-character invoice number is not a shorter invoice number, it is an
 * invalid tax document. The caller is expected to retry with
 * `FALLBACK_INVOICE_NUMBER_PATTERN`.
 *
 * Padding never truncates: `{SEQ:3}` with sequence 1000 gives "1000", so the
 * thousandth invoice of the year is numbered rather than colliding with the
 * first.
 */
export const formatInvoiceNumber = (
  pattern: string,
  input: InvoiceNumberFormatInput
): string | null => {
  if (!isFinancialYear(input.financialYear)) {
    return null;
  }
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
    return null;
  }

  let unknownToken = false;
  const rendered = pattern.replace(PATTERN_TOKEN, (_match, name: string, width?: string) => {
    switch (name) {
      case "FY":
        return input.financialYear;
      case "FY2":
        return shortFinancialYear(input.financialYear);
      case "SEQ":
        return width
          ? String(input.sequence).padStart(Number(width), "0")
          : String(input.sequence);
      default:
        unknownToken = true;
        return "";
    }
  });
  if (unknownToken) {
    return null;
  }

  // Validates the literal parts of the pattern too, so a pattern someone typed
  // as "INV #{SEQ:3}" is rejected here rather than saved onto a document.
  return isValidInvoiceNumber(rendered) ? rendered : null;
};

export interface InvoiceNumberSuggestionInput {
  /** The financial year being numbered, from `deriveFinancialYear`. */
  financialYear: string;
  /**
   * The highest existing number in `(userId, financialYear, documentType)`, or
   * null/"" when this is the year's first invoice. Read from the database by
   * the caller — this module never queries anything.
   */
  previous?: string | null;
  /** Defaults to `INV/{FY}/{SEQ:3}`. */
  pattern?: string;
  /** Tried when `pattern` renders too long. Defaults to `INV/{FY2}/{SEQ:4}`. */
  fallbackPattern?: string;
}

/**
 * The number to pre-fill, or null when the caller must ask the user.
 *
 * Three cases:
 *
 *   1. No previous number -> the first of the year from the pattern.
 *   2. A previous number from *another* financial year -> restart at 1. Rule
 *      46(b) scopes uniqueness to the year, and continuing last year's counter
 *      would make "INV/2026-27/148" the first invoice of the year, which reads
 *      as 147 missing documents.
 *   3. A previous number from this year, or one carrying no year at all (a
 *      plain running series like "INV-123456") -> increment it, preserving its
 *      padding.
 *
 * A suggestion is advisory. The field stays editable, and the unique index —
 * not this function — is what prevents a duplicate.
 */
export const suggestInvoiceNumber = (
  input: InvoiceNumberSuggestionInput
): string | null => {
  const pattern = input.pattern ?? DEFAULT_INVOICE_NUMBER_PATTERN;
  const fallbackPattern = input.fallbackPattern ?? FALLBACK_INVOICE_NUMBER_PATTERN;
  const previous = normalizeInvoiceNumber(input.previous ?? "");

  if (previous !== "") {
    const previousYear = extractFinancialYear(previous);
    if (previousYear === null || previousYear === input.financialYear) {
      // Null here means the series is exhausted ("INV/2026-27/9999") or was
      // never legal. Deliberately not falling through to the pattern: that
      // would suggest "INV/2026-27/001", which already exists.
      return nextInvoiceNumber(previous);
    }
  }

  return (
    formatInvoiceNumber(pattern, { financialYear: input.financialYear, sequence: 1 }) ??
    formatInvoiceNumber(fallbackPattern, {
      financialYear: input.financialYear,
      sequence: 1,
    })
  );
};
