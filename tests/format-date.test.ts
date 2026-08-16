import { describe, it, expect } from "bun:test";
import {
  formatCalendarParts,
  formatDateLong,
  toCalendarParts,
  DEFAULT_DATE_FALLBACK,
} from "@/lib/format-date";

const MODULE_PATH = `${import.meta.dir}/../lib/format-date.ts`;

/**
 * Run an expression against the module in a fixed IANA timezone. A timezone can
 * only be chosen at process start, and the off-by-one this module exists to
 * prevent only reproduces west of Greenwich — never on a developer machine in
 * IST — so the interesting cases have to be run out-of-process.
 */
const inTimeZone = (timeZone: string, expression: string): string => {
  const script = `
    const { formatDateLong, toCalendarParts } = await import(${JSON.stringify(MODULE_PATH)});
    void toCalendarParts;
    process.stdout.write(String(${expression}));
  `;
  const result = Bun.spawnSync({
    cmd: ["bun", "-e", script],
    env: { ...process.env, TZ: timeZone },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  return new TextDecoder().decode(result.stdout);
};

describe("formatDateLong — the en-GB day-first shape", () => {
  it("renders '17 Aug 2026', not the en-US 'Aug 17, 2026'", () => {
    expect(formatDateLong("2026-08-17")).toBe("17 Aug 2026");
    expect(formatDateLong("2026-08-17")).not.toContain(",");
  });

  it("accepts a date-only string, an ISO instant, a Date and epoch millis", () => {
    expect(formatDateLong("2026-08-17")).toBe("17 Aug 2026");
    expect(formatDateLong("2026-08-17T00:00:00.000Z")).toBe("17 Aug 2026");
    expect(formatDateLong(new Date(2026, 7, 17))).toBe("17 Aug 2026");
    expect(formatDateLong(new Date(2026, 7, 17).getTime())).toBe("17 Aug 2026");
  });

  it("does not zero-pad the day and keeps a four-digit year", () => {
    expect(formatDateLong("2026-01-01")).toBe("1 Jan 2026");
    expect(formatDateLong("2026-12-31")).toBe("31 Dec 2026");
    expect(formatDateLong("2026-09-03")).toBe("3 Sep 2026");
  });

  it("uses a three-letter September, unlike CLDR en-GB's 'Sept'", () => {
    // Pinned deliberately: `toLocaleDateString("en-GB", { month: "short" })`
    // renders "Sept" on current ICU, which drifts by runtime and looks wrong
    // beside eleven three-letter siblings on a printed invoice.
    expect(formatDateLong("2026-09-17")).toBe("17 Sep 2026");
  });

  it("spells every month the same way on the first of each", () => {
    const months = [
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
    months.forEach((label, index) => {
      const month = String(index + 1).padStart(2, "0");
      expect(formatDateLong(`2026-${month}-01`)).toBe(`1 ${label} 2026`);
    });
  });

  it("handles a leap day and rejects the 29th of a non-leap February", () => {
    expect(formatDateLong("2024-02-29")).toBe("29 Feb 2024");
    expect(formatDateLong("2025-02-29")).toBe(DEFAULT_DATE_FALLBACK);
  });
});

describe("formatDateLong — nothing renders 'Invalid Date'", () => {
  it("falls back for empty, whitespace, null and undefined", () => {
    expect(formatDateLong("")).toBe("-");
    expect(formatDateLong("   ")).toBe("-");
    expect(formatDateLong(null)).toBe("-");
    expect(formatDateLong(undefined)).toBe("-");
    expect(formatDateLong()).toBe("-");
  });

  it("falls back for garbage rather than throwing", () => {
    expect(formatDateLong("not a date")).toBe("-");
    expect(formatDateLong("2026-13-45")).toBe("-");
    expect(formatDateLong("2026-02-31")).toBe("-");
    expect(formatDateLong(new Date("nope"))).toBe("-");
    expect(formatDateLong(Number.NaN)).toBe("-");
    expect(() => formatDateLong({} as unknown as string)).not.toThrow();
    expect(formatDateLong({} as unknown as string)).toBe("-");
  });

  it("lets the caller choose the fallback text", () => {
    expect(formatDateLong("", { fallback: "—" })).toBe("—");
    expect(formatDateLong(undefined, { fallback: "Select date" })).toBe("Select date");
    expect(formatDateLong("2026-08-17", { fallback: "—" })).toBe("17 Aug 2026");
  });
});

describe("toCalendarParts — the timezone decision", () => {
  it("reads a form field's 'YYYY-MM-DD' as digits, with no Date in the path", () => {
    expect(toCalendarParts("2026-08-17")).toEqual({ year: 2026, month: 8, day: 17 });
  });

  it("reads a Mongo-round-tripped UTC midnight as that UTC calendar date", () => {
    expect(toCalendarParts("2026-08-17T00:00:00.000Z")).toEqual({
      year: 2026,
      month: 8,
      day: 17,
    });
    expect(toCalendarParts("2026-08-17T00:00:00Z")).toEqual({
      year: 2026,
      month: 8,
      day: 17,
    });
    expect(toCalendarParts("2026-08-17T00:00Z")).toEqual({
      year: 2026,
      month: 8,
      day: 17,
    });
  });

  it("reads a Date as its local calendar date — a picker means local midnight", () => {
    expect(toCalendarParts(new Date(2026, 7, 17))).toEqual({
      year: 2026,
      month: 8,
      day: 17,
    });
    expect(toCalendarParts(new Date(2026, 7, 17, 23, 59, 59))).toEqual({
      year: 2026,
      month: 8,
      day: 17,
    });
  });

  it("honours an explicit timeZone over the heuristic", () => {
    // 18:30 UTC on the 16th is already the 17th in IST, and still the 16th in UTC.
    const instant = "2026-08-16T18:30:00.000Z";
    expect(toCalendarParts(instant, "Asia/Kolkata")).toEqual({
      year: 2026,
      month: 8,
      day: 17,
    });
    expect(toCalendarParts(instant, "UTC")).toEqual({
      year: 2026,
      month: 8,
      day: 16,
    });
    expect(formatDateLong(instant, { timeZone: "UTC" })).toBe("16 Aug 2026");
    expect(formatDateLong(instant, { timeZone: "Asia/Kolkata" })).toBe("17 Aug 2026");
  });

  it("an explicit timeZone also overrides the UTC-midnight shortcut", () => {
    // Midnight UTC on the 17th is 5:30am on the 17th in IST, and still the 16th
    // in Los Angeles — the caller asked for a real instant reading, so give it.
    expect(toCalendarParts("2026-08-17T00:00:00.000Z", "America/Los_Angeles")).toEqual({
      year: 2026,
      month: 8,
      day: 16,
    });
    expect(toCalendarParts("2026-08-17T00:00:00.000Z", "Asia/Kolkata")).toEqual({
      year: 2026,
      month: 8,
      day: 17,
    });
  });

  it("falls back to the heuristic for a bogus timezone name instead of throwing", () => {
    expect(() => formatDateLong("2026-08-17", { timeZone: "Mars/Olympus" })).not.toThrow();
    expect(formatDateLong("2026-08-17", { timeZone: "Mars/Olympus" })).toBe("17 Aug 2026");
    expect(formatDateLong(new Date(2026, 7, 17), { timeZone: "Mars/Olympus" })).toBe(
      "17 Aug 2026"
    );
  });

  it("returns null for everything unusable", () => {
    expect(toCalendarParts(undefined)).toBeNull();
    expect(toCalendarParts(null)).toBeNull();
    expect(toCalendarParts("")).toBeNull();
    expect(toCalendarParts("2026-02-31")).toBeNull();
    expect(toCalendarParts(new Date("nope"))).toBeNull();
  });
});

describe("the calendar date survives the reader's timezone", () => {
  it("does not slip to the previous day west of Greenwich — the whole point", () => {
    expect(
      inTimeZone(
        "America/Los_Angeles",
        `formatDateLong("2026-08-17T00:00:00.000Z")`
      )
    ).toBe("17 Aug 2026");

    // The bug being prevented, reproduced with the naive call in the same process.
    expect(
      inTimeZone(
        "America/Los_Angeles",
        `new Date("2026-08-17T00:00:00.000Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })`
      )
    ).toBe("16 Aug 2026");
  });

  it("renders the same invoice date in IST, UTC and Los Angeles", () => {
    for (const zone of ["Asia/Kolkata", "UTC", "America/Los_Angeles", "Pacific/Apia"]) {
      expect(inTimeZone(zone, `formatDateLong("2026-08-17")`)).toBe("17 Aug 2026");
      expect(inTimeZone(zone, `formatDateLong("2026-08-17T00:00:00.000Z")`)).toBe(
        "17 Aug 2026"
      );
      expect(inTimeZone(zone, `formatDateLong("2026-01-01T00:00:00.000Z")`)).toBe(
        "1 Jan 2026"
      );
      expect(inTimeZone(zone, `formatDateLong("2025-12-31T00:00:00.000Z")`)).toBe(
        "31 Dec 2025"
      );
    }
  });

  it("keeps a locally built Date on its local day, in both offset directions", () => {
    // The mirror failure: local midnight in IST is 18:30Z the day before, so
    // formatting a picker selection "in UTC" would print the previous day.
    expect(
      inTimeZone("Asia/Kolkata", `formatDateLong(new Date(2026, 7, 17))`)
    ).toBe("17 Aug 2026");
    expect(
      inTimeZone(
        "Asia/Kolkata",
        `formatDateLong(new Date(2026, 7, 17), { timeZone: "UTC" })`
      )
    ).toBe("16 Aug 2026");
    expect(
      inTimeZone("America/Los_Angeles", `formatDateLong(new Date(2026, 7, 17))`)
    ).toBe("17 Aug 2026");
    expect(
      inTimeZone("Pacific/Apia", `formatDateLong(new Date(2026, 0, 1))`)
    ).toBe("1 Jan 2026");
  });

  it("keeps a late-evening timestamp on the reader's own day", () => {
    // 23:30 IST on the 17th is 18:00Z on the 17th — a genuine instant, so each
    // reader sees it on their own calendar rather than a frozen UTC one.
    expect(
      inTimeZone("Asia/Kolkata", `formatDateLong("2026-08-17T18:00:00.000Z")`)
    ).toBe("17 Aug 2026");
    expect(
      inTimeZone("America/Los_Angeles", `formatDateLong("2026-08-17T18:00:00.000Z")`)
    ).toBe("17 Aug 2026");
    expect(
      inTimeZone("Asia/Kolkata", `formatDateLong("2026-08-17T20:00:00.000Z")`)
    ).toBe("18 Aug 2026");
  });
});

describe("formatCalendarParts", () => {
  it("formats parts straight through", () => {
    expect(formatCalendarParts({ year: 2026, month: 8, day: 17 })).toBe("17 Aug 2026");
    expect(formatCalendarParts({ year: 1999, month: 12, day: 31 })).toBe("31 Dec 1999");
  });
});
