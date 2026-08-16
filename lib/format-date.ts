/**
 * Invoice date formatting: day-first short dates, and the timezone rule that
 * keeps them off by zero days.
 *
 * Two separate bugs live here.
 *
 * 1. LOCALE. The app formats every date `en-US` ("Aug 17, 2026") on an
 *    India-first product whose currency is already correctly `en-IN`. The
 *    convention on an Indian tax invoice is day-first: "17 Aug 2026"
 *    (`docs/design/phase-2-gst-correctness.md` §7.2).
 *
 * 2. TIMEZONE, which is the one that can actually make the document wrong. An
 *    invoice date is a CALENDAR DATE, not an instant. Mongo stores it as a
 *    `Date`, so it arrives over the wire as "2026-08-17T00:00:00.000Z"; feeding
 *    that to `toLocaleDateString` in any negative-offset timezone renders
 *    "16 Aug 2026" — a visible off-by-one on a legal document, and one that only
 *    reproduces for users west of Greenwich, i.e. never on the developer's
 *    machine in IST. The mirror of it is just as real: a `Date` built by the
 *    date picker is LOCAL midnight, and formatting that with `timeZone: "UTC"`
 *    in IST renders the previous day instead. There is no single timezone that
 *    is right for both, so this module does not pick one — it extracts the
 *    calendar fields in whichever frame the value was authored in, and only
 *    then formats:
 *
 *      - "YYYY-MM-DD"                 -> those digits, no `Date` involved at all
 *      - an instant at exactly 00:00Z -> its UTC calendar date (how Mongo stores
 *                                        a date-only field)
 *      - any other instant / `Date`   -> its LOCAL calendar date (a real
 *                                        timestamp: `createdAt`, `new Date()`,
 *                                        a picker selection)
 *
 *    Pass an explicit `timeZone` to override the heuristic when the caller knows
 *    better.
 *
 * The month names are a fixed table rather than `Intl`: current CLDR `en-GB`
 * renders September as "Sept" (four letters), which looks wrong next to eleven
 * three-letter siblings on a printed invoice, and it drifts with the ICU version
 * shipped by Node/Bun/the browser, which would make these tests environment
 * dependent. The output is exactly the "17 Aug 2026" shape §7.2 asks for.
 *
 * Pure, no DOM, no dependencies.
 */

/** A calendar date with no instant, no offset, and no time attached. */
export interface CalendarParts {
  year: number;
  /** 1-12, not the `Date` 0-11. */
  month: number;
  day: number;
}

export interface FormatDateOptions {
  /** Rendered for missing or unparseable input. Default "-", as today. */
  fallback?: string;
  /**
   * Force the frame the calendar date is read in ("UTC", "Asia/Kolkata", ...),
   * bypassing the heuristic. Invalid zone names fall back to the heuristic.
   */
  timeZone?: string;
}

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const DEFAULT_DATE_FALLBACK = "-";

/** "2026-08-17" and nothing else — no time, no offset. */
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * An ISO instant pinned to exactly midnight UTC. That is what a date-only value
 * looks like after a round trip through Mongo, and the only instant shape safe
 * to read as a UTC calendar date.
 */
const UTC_MIDNIGHT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T00:00(?::00(?:\.0{1,9})?)?Z$/;

/** Rejects "2026-02-31" and friends, which `Date` would roll over to March. */
const isRealCalendarDate = (parts: CalendarParts): boolean => {
  const { year, month, day } = parts;
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  // Years 0-99 are shifted into 1900+ by Date.UTC; setUTCFullYear undoes that.
  probe.setUTCFullYear(year);
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
};

/** Read the calendar fields an instant has in a named IANA zone. */
const partsInTimeZone = (date: Date, timeZone: string): CalendarParts | null => {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    // "en-CA" is ISO-ordered: "2026-08-17".
    const match = DATE_ONLY_PATTERN.exec(formatter.format(date));
    if (!match) {
      return null;
    }
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    };
  } catch {
    return null;
  }
};

/**
 * Reduce any accepted input to the calendar date it denotes, or `null` if it
 * denotes none. This is the whole timezone decision, isolated so it can be
 * tested without going near formatting.
 */
export const toCalendarParts = (
  value?: string | number | Date | null,
  timeZone?: string
): CalendarParts | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return null;
    }

    // A form field's "YYYY-MM-DD" never becomes a Date, so no zone can shift it.
    const dateOnly = DATE_ONLY_PATTERN.exec(trimmed);
    if (dateOnly) {
      const parts = {
        year: Number(dateOnly[1]),
        month: Number(dateOnly[2]),
        day: Number(dateOnly[3]),
      };
      return isRealCalendarDate(parts) ? parts : null;
    }

    // Mongo's round-tripped date-only value: read it in UTC, where it was written.
    if (!timeZone) {
      const utcMidnight = UTC_MIDNIGHT_PATTERN.exec(trimmed);
      if (utcMidnight) {
        const parts = {
          year: Number(utcMidnight[1]),
          month: Number(utcMidnight[2]),
          day: Number(utcMidnight[3]),
        };
        return isRealCalendarDate(parts) ? parts : null;
      }
    }

    return toCalendarParts(new Date(trimmed), timeZone);
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (timeZone) {
    const zoned = partsInTimeZone(date, timeZone);
    if (zoned) {
      return zoned;
    }
  }

  // A `Date` in hand is an instant someone built locally (a picker selection,
  // `new Date()`), so its local calendar fields are the date they meant.
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
};

/** "17 Aug 2026". Assumes already-validated parts. */
export const formatCalendarParts = (parts: CalendarParts): string =>
  `${parts.day} ${MONTHS_SHORT[parts.month - 1]} ${parts.year}`;

/**
 * The shared invoice date formatter: day-first, short month, four-digit year.
 *
 * Never throws and never renders "Invalid Date" — empty, undefined, null and
 * unparseable input all return `fallback` ("-").
 */
export const formatDateLong = (
  value?: string | number | Date | null,
  options: FormatDateOptions = {}
): string => {
  const fallback = options.fallback ?? DEFAULT_DATE_FALLBACK;
  const parts = toCalendarParts(value, options.timeZone);
  if (!parts) {
    return fallback;
  }
  return formatCalendarParts(parts);
};
