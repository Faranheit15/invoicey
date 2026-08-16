/**
 * Amount in words, Indian numbering system.
 *
 * Not a Rule 46 particular, but per `docs/LAUNCH-PLAN.md` it is the single most
 * commonly remarked-on omission when an Indian accountant reads a foreign-built
 * invoice, so the printed document carries it under the totals block
 * (`docs/design/phase-2-gst-correctness.md` §7.1).
 *
 * The thing that actually goes wrong here is the GROUPING. Every off-the-shelf
 * number-to-words routine groups in threes — thousand / million / billion — and
 * 1234567 comes out "One Million Two Hundred Thirty Four Thousand ...". The
 * Indian system groups 3 then 2 then 2 (12,34,56,789) with lakh = 10^5 and
 * crore = 10^7, so the same number is "Twelve Lakh Thirty Four Thousand Five
 * Hundred Sixty Seven". That is why this module exists instead of a dependency:
 * the scale table below is the whole point, and it is pinned by tests.
 *
 * Above a crore the Indian system technically continues arab (10^9) / kharab
 * (10^11), but no Indian invoice prints those — accounting practice stacks the
 * multiplier back onto "Crore" (10^11 reads "Ten Thousand Crore"). This module
 * follows practice: `Crore` is the largest scale word, and the count in front of
 * it is itself spelled with the same lakh/thousand/hundred machinery.
 *
 * Phrasing (§7.1 fixes the shape, the rest is the conventional Indian invoice
 * form): `"Indian Rupees One Lakh Twenty Three Thousand Four Hundred Fifty and
 * Sixty Paise Only"`. Currency word first, "and <n> Paise" only when there are
 * paise, always terminated by "Only". The trailing "Only" is not decoration — it
 * is the anti-tampering convention that stops anything being appended to a
 * handwritten-looking amount.
 *
 * No React, no DOM, no `Intl`, no dependencies: pure string assembly, so
 * `bun test` can pin every branch.
 */

/** How one currency names its major and minor units, singular and plural. */
export interface CurrencyWords {
  majorSingular: string;
  majorPlural: string;
  minorSingular: string;
  minorPlural: string;
}

/**
 * The five currencies the editor offers (`CURRENCY_SYMBOLS` in `lib/invoices.ts`).
 * An unknown code degrades to the code itself plus a generic minor unit rather
 * than silently claiming rupees — printing "Rupees" on a JPY invoice would be a
 * worse failure than printing "JPY".
 */
const CURRENCY_WORDS: Record<string, CurrencyWords> = {
  INR: {
    majorSingular: "Indian Rupee",
    majorPlural: "Indian Rupees",
    minorSingular: "Paisa",
    minorPlural: "Paise",
  },
  USD: {
    majorSingular: "US Dollar",
    majorPlural: "US Dollars",
    minorSingular: "Cent",
    minorPlural: "Cents",
  },
  EUR: {
    majorSingular: "Euro",
    majorPlural: "Euros",
    minorSingular: "Cent",
    minorPlural: "Cents",
  },
  GBP: {
    majorSingular: "Pound Sterling",
    majorPlural: "Pounds Sterling",
    minorSingular: "Penny",
    minorPlural: "Pence",
  },
  AED: {
    majorSingular: "UAE Dirham",
    majorPlural: "UAE Dirhams",
    minorSingular: "Fils",
    minorPlural: "Fils",
  },
};

/** Words for a currency code; unknown codes keep their code as the unit name. */
export const currencyWords = (currency = "INR"): CurrencyWords => {
  const code = (currency || "INR").trim().toUpperCase();
  const known = CURRENCY_WORDS[code];
  if (known) {
    return known;
  }
  return {
    majorSingular: code || "INR",
    majorPlural: code || "INR",
    minorSingular: "Cent",
    minorPlural: "Cents",
  };
};

const ONES = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

/**
 * The Indian scale ladder, largest first. `Crore` sits at the top on purpose:
 * `numberToWordsIndian` recurses on the crore count, so 10^9 becomes
 * "One Hundred Crore" and 10^11 "Ten Thousand Crore" — the way Indian ledgers
 * actually read, instead of arab/kharab that nobody prints.
 */
const SCALES: ReadonlyArray<{ value: number; name: string }> = [
  { value: 10_000_000, name: "Crore" },
  { value: 100_000, name: "Lakh" },
  { value: 1_000, name: "Thousand" },
  { value: 100, name: "Hundred" },
];

/**
 * The largest amount this module will spell. Everything is done in integer
 * paise, so the ceiling is `Number.MAX_SAFE_INTEGER` paise — past that the
 * arithmetic silently loses whole rupees, and a wrong amount in words on a legal
 * document is worse than none. Beyond it (and for NaN / Infinity)
 * `amountInWordsIndian` returns "" so the caller renders nothing.
 */
export const MAX_AMOUNT_IN_WORDS = Number.MAX_SAFE_INTEGER / 100;

/**
 * Spell a non-negative integer in the Indian system.
 *
 * No "and" is inserted before the last group ("One Hundred Five", not "One
 * Hundred and Five"): the only "and" in the output separates rupees from paise,
 * which is what makes that boundary unambiguous when the line is read aloud.
 */
export const numberToWordsIndian = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "";
  }
  const n = Math.floor(Math.abs(value));
  if (n < 20) {
    return ONES[n];
  }
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)];
    const unit = n % 10;
    return unit ? `${tens} ${ONES[unit]}` : tens;
  }
  for (const scale of SCALES) {
    if (n >= scale.value) {
      const head = numberToWordsIndian(Math.floor(n / scale.value));
      const tail = n % scale.value;
      return tail
        ? `${head} ${scale.name} ${numberToWordsIndian(tail)}`
        : `${head} ${scale.name}`;
    }
  }
  /* c8 ignore next -- unreachable: every n >= 100 is caught by SCALES */
  return ONES[0];
};

/** A rounded amount split into whole major units and 0-99 minor units. */
export interface AmountUnits {
  negative: boolean;
  major: number;
  minor: number;
}

/**
 * Split a decimal amount into major/minor units, rounded to two places.
 *
 * Rounding goes through `toFixed(2)` rather than `Math.round(value * 100)` so
 * that a third decimal rounds exactly the way `computeTotals` rounds — the
 * words and the figure printed beside them must never disagree. The two do
 * diverge on binary-float edges (`Math.round(0.015 * 100)` is 2 paise,
 * `(0.015).toFixed(2)` is 1, and 1 is what the stored total would say). A carry
 * out of the minor units (0.999 -> 100 paise) is folded into the major unit.
 *
 * Returns `null` for non-finite input or anything past `MAX_AMOUNT_IN_WORDS`.
 */
export const splitAmountUnits = (value: number): AmountUnits | null => {
  if (!Number.isFinite(value)) {
    return null;
  }
  const absolute = Math.abs(value);
  if (absolute > MAX_AMOUNT_IN_WORDS) {
    return null;
  }
  const rounded = Number(absolute.toFixed(2));
  let major = Math.floor(rounded);
  let minor = Math.round((rounded - major) * 100);
  if (minor >= 100) {
    major += 1;
    minor -= 100;
  }
  // -0 must not print as "Minus".
  return { negative: value < 0 && rounded !== 0, major, minor };
};

/**
 * Spell an invoice amount.
 *
 * Shapes, in order of the branches below:
 * - `1234.56`  -> "Indian Rupees One Thousand Two Hundred Thirty Four and Fifty Six Paise Only"
 * - `1234`     -> "Indian Rupees One Thousand Two Hundred Thirty Four Only"
 *                 (an exact amount omits the paise clause entirely; "and Zero
 *                 Paise" is not how an invoice is written)
 * - `1`        -> "Indian Rupee One Only" (singular unit word)
 * - `0.05`     -> "Five Paise Only" (under a rupee, only the paise clause is
 *                 printed — "Indian Rupees Zero and Five Paise" is noise)
 * - `0`        -> "Indian Rupees Zero Only"
 * - negative   -> prefixed "Minus". An invoice total is clamped at 0 so this is
 *                 currently unreachable, but a credit note is a signed document
 *                 and will need it.
 *
 * Out-of-range or non-finite input returns "" — the caller should print nothing
 * rather than a wrong legal amount.
 */
export const amountInWordsIndian = (value: number, currency = "INR"): string => {
  const units = splitAmountUnits(value);
  if (!units) {
    return "";
  }

  const words = currencyWords(currency);
  const { negative, major, minor } = units;
  const parts: string[] = [];

  if (negative) {
    parts.push("Minus");
  }

  if (major > 0 || minor === 0) {
    parts.push(major === 1 ? words.majorSingular : words.majorPlural);
    parts.push(numberToWordsIndian(major));
    if (minor > 0) {
      parts.push("and");
    }
  }

  if (minor > 0) {
    parts.push(numberToWordsIndian(minor));
    parts.push(minor === 1 ? words.minorSingular : words.minorPlural);
  }

  parts.push("Only");
  return parts.join(" ");
};
