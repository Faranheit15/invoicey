import { describe, it, expect } from "bun:test";
import {
  MAX_INVOICE_NUMBER_LENGTH,
  INVOICE_NUMBER_REGEX,
  DEFAULT_INVOICE_NUMBER_PATTERN,
  FALLBACK_INVOICE_NUMBER_PATTERN,
  deriveFinancialYear,
  isFinancialYear,
  shortFinancialYear,
  extractFinancialYear,
  normalizeInvoiceNumber,
  invoiceNumberKey,
  checkInvoiceNumber,
  isValidInvoiceNumber,
  invoiceNumberProblemMessage,
  parseInvoiceNumber,
  nextInvoiceNumber,
  formatInvoiceNumber,
  suggestInvoiceNumber,
} from "@/lib/invoice-number";

/* -------------------------------------------------------------------------- */
/* Financial year                                                             */
/* -------------------------------------------------------------------------- */

describe("deriveFinancialYear — the April boundary", () => {
  it("opens a new financial year on 1 April and not a day earlier", () => {
    expect(deriveFinancialYear("2026-03-31")).toBe("2025-26");
    expect(deriveFinancialYear("2026-04-01")).toBe("2026-27");
  });

  it("closes it on 31 March of the following year", () => {
    expect(deriveFinancialYear("2027-03-31")).toBe("2026-27");
    expect(deriveFinancialYear("2027-04-01")).toBe("2027-28");
  });

  it("keeps the whole April-to-March span in one year", () => {
    for (const date of [
      "2026-04-01",
      "2026-04-30",
      "2026-08-17",
      "2026-12-31",
      "2027-01-01",
      "2027-02-11",
      "2027-03-31",
    ]) {
      expect(deriveFinancialYear(date)).toBe("2026-27");
    }
  });

  it("files January into the BACK half of the year, not the front of the next", () => {
    // The off-by-one that matters: January 2027 belongs to FY 2026-27.
    expect(deriveFinancialYear("2027-01-15")).toBe("2026-27");
    expect(deriveFinancialYear("2026-01-15")).toBe("2025-26");
    expect(deriveFinancialYear("2026-02-28")).toBe("2025-26");
    expect(deriveFinancialYear("2026-03-01")).toBe("2025-26");
  });

  it("handles leap days on both sides of a boundary", () => {
    expect(deriveFinancialYear("2024-02-29")).toBe("2023-24");
    expect(deriveFinancialYear("2024-03-31")).toBe("2023-24");
    expect(deriveFinancialYear("2024-04-01")).toBe("2024-25");
    expect(deriveFinancialYear("2028-02-29")).toBe("2027-28");
    // 2100 is NOT a leap year; the derivation never touches day-of-month
    // arithmetic, so this is here to prove it cannot be broken by one.
    expect(deriveFinancialYear("2100-02-28")).toBe("2099-00");
  });

  it("rolls the two-digit second half over the century", () => {
    expect(deriveFinancialYear("2099-04-01")).toBe("2099-00");
    expect(deriveFinancialYear("2100-01-01")).toBe("2099-00");
  });

  it("returns '' for anything unparseable rather than guessing or throwing", () => {
    // Pinned: "" means "no financial year". A caller must treat it as a
    // validation failure — never store it, never index on it.
    expect(deriveFinancialYear("")).toBe("");
    expect(deriveFinancialYear("not a date")).toBe("");
    expect(deriveFinancialYear("2026-13-01")).toBe(""); // month out of range
    expect(deriveFinancialYear("2026-04-00")).toBe(""); // day out of range
    expect(deriveFinancialYear(new Date("nope"))).toBe("");
  });
});

describe("deriveFinancialYear — the timezone decision", () => {
  // DECISION: the financial year is the civil date IN INDIA (UTC+05:30).
  //   - a floating string is already a civil date and is read lexically;
  //   - a Date, or a string with Z / an offset, is an instant and is shifted
  //     to IST before its calendar fields are read.
  // The host's local timezone is never consulted.

  it("reads a date-only string lexically, so no Date parsing is involved", () => {
    expect(deriveFinancialYear("2026-04-01")).toBe("2026-27");
    // Same string, but a zone-less time component — still a civil date.
    expect(deriveFinancialYear("2026-04-01T00:00:00")).toBe("2026-27");
    expect(deriveFinancialYear("2026-03-31T23:59:59")).toBe("2025-26");
  });

  it("treats a UTC-midnight Date as its own calendar day (the stored shape)", () => {
    // invoiceDate round-trips through toISOString().split("T")[0], so every
    // Date that comes back out of Mongo is UTC midnight. Shifting FORWARD by
    // less than 24h cannot move the calendar day, which is why the IST rule is
    // free here.
    expect(deriveFinancialYear(new Date("2026-04-01T00:00:00Z"))).toBe("2026-27");
    expect(deriveFinancialYear(new Date("2026-03-31T00:00:00Z"))).toBe("2025-26");
  });

  it("puts the IST boundary at 18:30Z, not at 00:00Z", () => {
    // 2026-03-31T18:29:59Z is 31 March 23:59:59 IST — still last year.
    expect(deriveFinancialYear(new Date("2026-03-31T18:29:59Z"))).toBe("2025-26");
    // 2026-03-31T18:30:00Z is 1 April 00:00:00 IST — the new year.
    expect(deriveFinancialYear(new Date("2026-03-31T18:30:00Z"))).toBe("2026-27");
  });

  it("gets the two cases plain-UTC derivation would get wrong", () => {
    // 31 March 23:00 IST = 31 March 17:30 UTC. UTC agrees here.
    expect(deriveFinancialYear(new Date("2026-03-31T17:30:00Z"))).toBe("2025-26");
    // 1 April 04:00 IST = 31 March 22:30 UTC. Plain UTC getters would report
    // March and file this invoice into FY 2025-26 — the wrong uniqueness scope.
    expect(deriveFinancialYear(new Date("2026-03-31T22:30:00Z"))).toBe("2026-27");
  });

  it("distinguishes a zoned instant from a floating civil date in string form", () => {
    // Same digits; the trailing Z changes what they mean, and the split is
    // deliberate rather than accidental.
    expect(deriveFinancialYear("2026-03-31T22:30:00Z")).toBe("2026-27");
    expect(deriveFinancialYear("2026-03-31T22:30:00")).toBe("2025-26");
    expect(deriveFinancialYear("2026-04-01T00:00:00+05:30")).toBe("2026-27");
    // An IST-midnight timestamp expressed in UTC.
    expect(deriveFinancialYear("2026-04-01T18:30:00.000Z")).toBe("2026-27");
  });

  it("does not depend on process.env.TZ", () => {
    // The real pin: run the boundary cases in fresh processes under a timezone
    // west of UTC and one east of it. Local getters would disagree here.
    const modulePath = new URL("../lib/invoice-number.ts", import.meta.url).pathname;
    const cases = [
      ['"2026-04-01"', "2026-27"],
      ['"2026-03-31"', "2025-26"],
      ['new Date("2026-04-01T00:00:00Z")', "2026-27"],
      ['new Date("2026-03-31T22:30:00Z")', "2026-27"],
      ['new Date("2026-03-31T18:29:59Z")', "2025-26"],
    ] as const;

    for (const tz of ["America/Los_Angeles", "Asia/Kolkata", "UTC", "Pacific/Kiritimati"]) {
      const script = `const m = await import(${JSON.stringify(modulePath)});
        process.stdout.write(JSON.stringify([${cases
          .map(([expr]) => `m.deriveFinancialYear(${expr})`)
          .join(",")}]));`;
      const result = Bun.spawnSync(["bun", "-e", script], {
        env: { ...process.env, TZ: tz },
      });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toEqual(cases.map(([, fy]) => fy));
    }
  }, 30_000);
});

describe("isFinancialYear / shortFinancialYear", () => {
  it("requires the two halves to be consecutive, not merely two numbers", () => {
    expect(isFinancialYear("2026-27")).toBe(true);
    expect(isFinancialYear("2099-00")).toBe(true);
    expect(isFinancialYear("2026-28")).toBe(false);
    expect(isFinancialYear("2026-26")).toBe(false);
    expect(isFinancialYear("2026-2027")).toBe(false);
    expect(isFinancialYear("26-27")).toBe(false);
    expect(isFinancialYear("")).toBe(false);
  });

  it("shortens for the {FY2} token and refuses garbage", () => {
    expect(shortFinancialYear("2026-27")).toBe("26-27");
    expect(shortFinancialYear("2026-28")).toBe("");
  });
});

describe("extractFinancialYear", () => {
  it("finds a year embedded in either form", () => {
    expect(extractFinancialYear("INV/2026-27/001")).toBe("2026-27");
    expect(extractFinancialYear("26-27/0042")).toBe("2026-27");
    expect(extractFinancialYear("INV-2025-26-007")).toBe("2025-26");
  });

  it("returns null when the number carries no year — 'no opinion', not 'different year'", () => {
    expect(extractFinancialYear("INV-123456")).toBeNull();
    expect(extractFinancialYear("001")).toBeNull();
    expect(extractFinancialYear("INV/2026-29/001")).toBeNull(); // not consecutive
  });
});

/* -------------------------------------------------------------------------- */
/* Charset and length                                                         */
/* -------------------------------------------------------------------------- */

describe("isValidInvoiceNumber — Rule 46(b) charset", () => {
  it("accepts letters, digits, hyphen and slash", () => {
    for (const value of [
      "INV/2026-27/001",
      "INV-001",
      "26-27/0042",
      "A",
      "1",
      "abc/DEF-123",
      "1234567890123456",
    ]) {
      expect(isValidInvoiceNumber(value)).toBe(true);
    }
  });

  it("rejects space, underscore, hash and dot", () => {
    for (const value of ["INV #001", "INV_001", "INV.001", "INV 001", "INV,001", "INV(1)"]) {
      expect(isValidInvoiceNumber(value)).toBe(false);
    }
  });

  it("rejects a non-breaking space, which a paste out of a PDF carries", () => {
    expect(isValidInvoiceNumber("INV 001")).toBe(false);
    expect(isValidInvoiceNumber("INV-001﻿")).toBe(false);
  });

  it("rejects non-ASCII digits that LOOK like digits", () => {
    expect(isValidInvoiceNumber("INV-٠١٢")).toBe(false); // Arabic-Indic
    expect(isValidInvoiceNumber("INV-०१")).toBe(false); // Devanagari
    expect(isValidInvoiceNumber("INV-０１")).toBe(false); // full-width
    expect(isValidInvoiceNumber("INV-001©")).toBe(false);
  });

  it("rejects the characters people reach for instead of a hyphen", () => {
    expect(isValidInvoiceNumber("INV–2026")).toBe(false); // en dash
    expect(isValidInvoiceNumber("INV—2026")).toBe(false); // em dash
    expect(isValidInvoiceNumber("INV⁄2026")).toBe(false); // fraction slash
  });
});

describe("isValidInvoiceNumber — length", () => {
  it("accepts exactly 16 and rejects 17", () => {
    const sixteen = "A".repeat(MAX_INVOICE_NUMBER_LENGTH);
    expect(sixteen.length).toBe(16);
    expect(isValidInvoiceNumber(sixteen)).toBe(true);
    expect(isValidInvoiceNumber("A".repeat(17))).toBe(false);
  });

  it("rejects empty", () => {
    expect(isValidInvoiceNumber("")).toBe(false);
  });

  it("rejects the trap the research names: INVOICE/2026-27/0001 is 20", () => {
    expect("INVOICE/2026-27/0001".length).toBe(20);
    expect(isValidInvoiceNumber("INVOICE/2026-27/0001")).toBe(false);
    // ...while the default series has a character to spare.
    expect("INV/2026-27/001".length).toBe(15);
    expect(isValidInvoiceNumber("INV/2026-27/001")).toBe(true);
  });

  it("agrees with the exported regex on every ASCII case", () => {
    for (const value of [
      "INV/2026-27/001",
      "A",
      "1234567890123456",
      "A".repeat(17),
      "",
      "INV #001",
      "INV_001",
    ]) {
      expect(isValidInvoiceNumber(value)).toBe(INVOICE_NUMBER_REGEX.test(value));
    }
  });
});

describe("checkInvoiceNumber — which rule was broken", () => {
  it("names the offending characters, deduplicated, in first-seen order", () => {
    expect(checkInvoiceNumber("INV #0 01")).toEqual({
      code: "illegal_characters",
      characters: [" ", "#"],
    });
    expect(checkInvoiceNumber("INV_001")).toEqual({
      code: "illegal_characters",
      characters: ["_"],
    });
  });

  it("reports an emoji as one character, not two lone surrogates", () => {
    const problem = checkInvoiceNumber("INV\u{1F600}1");
    expect(problem).toEqual({ code: "illegal_characters", characters: ["\u{1F600}"] });
  });

  it("reports the actual length when too long", () => {
    expect(checkInvoiceNumber("INVOICE/2026-27/0001")).toEqual({
      code: "too_long",
      length: 20,
      max: 16,
    });
  });

  it("reports empty before anything else", () => {
    expect(checkInvoiceNumber("")).toEqual({ code: "empty" });
  });

  it("reports charset before length when a number breaks both", () => {
    // Pinned ordering: telling the user to shorten "INVOICE #2026-27/00001"
    // first would send them round the loop a second time for the '#'.
    expect(checkInvoiceNumber("INVOICE #2026-27/00001")).toEqual({
      code: "illegal_characters",
      characters: [" ", "#"],
    });
  });

  it("returns null for a legal number", () => {
    expect(checkInvoiceNumber("INV/2026-27/001")).toBeNull();
  });

  it("produces a message that names the broken rule", () => {
    expect(invoiceNumberProblemMessage({ code: "empty" })).toBe(
      "Invoice number is required."
    );
    expect(
      invoiceNumberProblemMessage({ code: "too_long", length: 20, max: 16 })
    ).toContain("16 characters or fewer");
    expect(
      invoiceNumberProblemMessage({ code: "illegal_characters", characters: [" ", "#"] })
    ).toBe('Invoice number cannot contain spaces, "#". Use only letters, numbers, - and /.');
  });
});

describe("normalizeInvoiceNumber / invoiceNumberKey", () => {
  it("trims and removes internal whitespace entirely", () => {
    expect(normalizeInvoiceNumber(" inv/2026-27/001 ")).toBe("inv/2026-27/001");
    // A space is not a legal character, so collapsing to one space would still
    // leave an invalid number. Removing it is the only salvage.
    expect(normalizeInvoiceNumber("INV 001")).toBe("INV001");
    expect(normalizeInvoiceNumber("INV 001")).toBe("INV001");
    expect(normalizeInvoiceNumber("INV\t\n001")).toBe("INV001");
  });

  it("does not change case", () => {
    expect(normalizeInvoiceNumber(" inv/2026-27/001 ")).toBe("inv/2026-27/001");
  });

  it("uppercases for the index key", () => {
    expect(invoiceNumberKey(" inv/2026-27/001 ")).toBe("INV/2026-27/001");
  });

  it("gives two case-only variants the same key — that is the whole point", () => {
    expect(invoiceNumberKey("inv/2026-27/001")).toBe(invoiceNumberKey("INV/2026-27/001"));
    expect(invoiceNumberKey("Inv/2026-27/001")).toBe(invoiceNumberKey("INV/2026-27/001"));
  });

  it("folds case locale-independently", () => {
    // toLocaleUpperCase under tr-TR maps "i" to "İ", which would split one
    // series into two depending on the server's locale.
    expect(invoiceNumberKey("inv-1")).toBe("INV-1");
    expect(invoiceNumberKey("inv-1")).not.toContain("İ");
  });
});

/* -------------------------------------------------------------------------- */
/* Series parsing and the next number                                         */
/* -------------------------------------------------------------------------- */

describe("parseInvoiceNumber", () => {
  it("splits a prefix from a zero-padded trailing sequence", () => {
    expect(parseInvoiceNumber("INV/2026-27/001")).toEqual({
      prefix: "INV/2026-27/",
      sequence: 1,
      width: 3,
    });
  });

  it("handles a bare sequence with no prefix", () => {
    expect(parseInvoiceNumber("001")).toEqual({ prefix: "", sequence: 1, width: 3 });
  });

  it("takes the LAST digit run, so digits inside the prefix stay in the prefix", () => {
    expect(parseInvoiceNumber("INV-123456")).toEqual({
      prefix: "INV-",
      sequence: 123456,
      width: 6,
    });
    expect(parseInvoiceNumber("26-27/0042")).toEqual({
      prefix: "26-27/",
      sequence: 42,
      width: 4,
    });
  });

  it("returns null when there is no trailing digit run to increment", () => {
    expect(parseInvoiceNumber("ABC")).toBeNull();
    expect(parseInvoiceNumber("")).toBeNull();
    expect(parseInvoiceNumber("INV/2026-27/")).toBeNull();
  });

  it("is structural, not a validator — it reads illegal legacy numbers too", () => {
    // Legacy rows predate any validation; the suggester still wants their
    // series. Legality is enforced on the OUTPUT, in nextInvoiceNumber.
    expect(parseInvoiceNumber("INV_001")).toEqual({
      prefix: "INV_",
      sequence: 1,
      width: 3,
    });
  });

  it("refuses a digit run it cannot represent exactly", () => {
    // 9999999999999999 > Number.MAX_SAFE_INTEGER; incrementing it would
    // fabricate a number rather than produce the next one.
    expect(parseInvoiceNumber("9".repeat(16))).toBeNull();
    expect(parseInvoiceNumber("1234567890123456")).toEqual({
      prefix: "",
      sequence: 1234567890123456,
      width: 16,
    });
  });
});

describe("nextInvoiceNumber", () => {
  it("preserves the zero padding — 001 -> 002, never 2", () => {
    expect(nextInvoiceNumber("INV/2026-27/001")).toBe("INV/2026-27/002");
    expect(nextInvoiceNumber("001")).toBe("002");
    expect(nextInvoiceNumber("INV/2026-27/008")).toBe("INV/2026-27/009");
  });

  it("rolls over within the width", () => {
    expect(nextInvoiceNumber("INV/2026-27/009")).toBe("INV/2026-27/010");
    expect(nextInvoiceNumber("INV/2026-27/099")).toBe("INV/2026-27/100");
  });

  it("grows past the width rather than wrapping to 000", () => {
    // 16 characters exactly: legal, so it is returned.
    expect(nextInvoiceNumber("INV/2026-27/999")).toBe("INV/2026-27/1000");
    expect("INV/2026-27/1000".length).toBe(16);
  });

  it("returns null when the next number would exceed 16 characters", () => {
    expect("INV/2026-27/9999".length).toBe(16);
    expect(nextInvoiceNumber("INV/2026-27/9999")).toBeNull();
  });

  it("continues the current generated shape", () => {
    expect(nextInvoiceNumber("INV-123456")).toBe("INV-123457");
  });

  it("returns null for a series with no numeric tail", () => {
    expect(nextInvoiceNumber("ABC")).toBeNull();
    expect(nextInvoiceNumber("")).toBeNull();
  });

  it("refuses to breed a new number from an illegal legacy one", () => {
    // "INV_001" is an invalid document today; "INV_002" must not become a
    // second one just because the first exists.
    expect(nextInvoiceNumber("INV_001")).toBeNull();
    expect(nextInvoiceNumber("INVOICE/2026-27/0001")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

describe("formatInvoiceNumber", () => {
  it("renders the default pattern to 15 characters", () => {
    const result = formatInvoiceNumber(DEFAULT_INVOICE_NUMBER_PATTERN, {
      financialYear: "2026-27",
      sequence: 1,
    });
    expect(result).toBe("INV/2026-27/001");
    expect(result).not.toBeNull();
    expect(result!.length).toBe(15);
  });

  it("renders the short-year fallback to 14", () => {
    const result = formatInvoiceNumber(FALLBACK_INVOICE_NUMBER_PATTERN, {
      financialYear: "2026-27",
      sequence: 1,
    });
    expect(result).toBe("INV/26-27/0001");
    expect(result!.length).toBe(14);
  });

  it("returns null rather than a 20-character illegal number", () => {
    expect(
      formatInvoiceNumber("INVOICE/{FY}/{SEQ:4}", {
        financialYear: "2026-27",
        sequence: 1,
      })
    ).toBeNull();
  });

  it("pads without truncating, so the 1000th invoice of the year exists", () => {
    const result = formatInvoiceNumber("INV/{FY}/{SEQ:3}", {
      financialYear: "2026-27",
      sequence: 1000,
    });
    expect(result).toBe("INV/2026-27/1000");
    expect(result!.length).toBe(16);
    // ...but the 10000th does not fit and must not be silently mangled.
    expect(
      formatInvoiceNumber("INV/{FY}/{SEQ:3}", { financialYear: "2026-27", sequence: 10000 })
    ).toBeNull();
  });

  it("supports an unpadded {SEQ}", () => {
    expect(
      formatInvoiceNumber("INV/{FY}/{SEQ}", { financialYear: "2026-27", sequence: 7 })
    ).toBe("INV/2026-27/7");
  });

  it("rejects a pattern whose literal text is itself illegal", () => {
    expect(
      formatInvoiceNumber("INV #{SEQ:3}", { financialYear: "2026-27", sequence: 1 })
    ).toBeNull();
    expect(
      formatInvoiceNumber("INV_{SEQ:3}", { financialYear: "2026-27", sequence: 1 })
    ).toBeNull();
  });

  it("rejects an unknown token instead of emitting an empty gap", () => {
    expect(
      formatInvoiceNumber("INV/{YEAR}/{SEQ:3}", { financialYear: "2026-27", sequence: 1 })
    ).toBeNull();
  });

  it("rejects a malformed financial year or sequence", () => {
    expect(
      formatInvoiceNumber(DEFAULT_INVOICE_NUMBER_PATTERN, {
        financialYear: "2026-29",
        sequence: 1,
      })
    ).toBeNull();
    expect(
      formatInvoiceNumber(DEFAULT_INVOICE_NUMBER_PATTERN, {
        financialYear: "",
        sequence: 1,
      })
    ).toBeNull();
    expect(
      formatInvoiceNumber(DEFAULT_INVOICE_NUMBER_PATTERN, {
        financialYear: "2026-27",
        sequence: -1,
      })
    ).toBeNull();
    expect(
      formatInvoiceNumber(DEFAULT_INVOICE_NUMBER_PATTERN, {
        financialYear: "2026-27",
        sequence: 1.5,
      })
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Suggestion                                                                 */
/* -------------------------------------------------------------------------- */

describe("suggestInvoiceNumber", () => {
  it("starts the year at 001 when there is nothing to continue", () => {
    expect(suggestInvoiceNumber({ financialYear: "2026-27" })).toBe("INV/2026-27/001");
    expect(suggestInvoiceNumber({ financialYear: "2026-27", previous: null })).toBe(
      "INV/2026-27/001"
    );
    expect(suggestInvoiceNumber({ financialYear: "2026-27", previous: "   " })).toBe(
      "INV/2026-27/001"
    );
  });

  it("continues a series from the same financial year", () => {
    expect(
      suggestInvoiceNumber({ financialYear: "2026-27", previous: "INV/2026-27/007" })
    ).toBe("INV/2026-27/008");
    expect(
      suggestInvoiceNumber({ financialYear: "2026-27", previous: "26-27/0042" })
    ).toBe("26-27/0043");
  });

  it("RESTARTS at 001 when the previous number belongs to another year", () => {
    // Continuing last year's counter would make "INV/2026-27/148" the first
    // invoice of the year, which reads as 147 missing documents.
    expect(
      suggestInvoiceNumber({ financialYear: "2026-27", previous: "INV/2025-26/147" })
    ).toBe("INV/2026-27/001");
  });

  it("continues a series that carries no year at all", () => {
    // "no year token" is no opinion, not "different year" — the caller already
    // scoped the query to this financial year.
    expect(
      suggestInvoiceNumber({ financialYear: "2026-27", previous: "INV-123456" })
    ).toBe("INV-123457");
    expect(suggestInvoiceNumber({ financialYear: "2026-27", previous: "0042" })).toBe(
      "0043"
    );
  });

  it("falls back to the short-year pattern only when the default will not fit", () => {
    expect(
      suggestInvoiceNumber({
        financialYear: "2026-27",
        pattern: "INVOICE/{FY}/{SEQ:4}",
      })
    ).toBe("INV/26-27/0001");
  });

  it("returns null when the series is exhausted, rather than colliding", () => {
    // Falling back to the pattern here would suggest "INV/2026-27/001", which
    // already exists. The user has to decide.
    expect(
      suggestInvoiceNumber({ financialYear: "2026-27", previous: "INV/2026-27/9999" })
    ).toBeNull();
    expect(
      suggestInvoiceNumber({ financialYear: "2026-27", previous: "INV_001" })
    ).toBeNull();
  });

  it("returns null when the financial year itself is unusable", () => {
    // deriveFinancialYear returns "" for an unparseable date; that must not
    // become "INV//001".
    expect(suggestInvoiceNumber({ financialYear: "" })).toBeNull();
    expect(suggestInvoiceNumber({ financialYear: "2026-29" })).toBeNull();
  });

  it("always suggests something legal", () => {
    for (const previous of [
      null,
      "INV/2026-27/001",
      "INV/2026-27/999",
      "INV-123456",
      "0042",
    ]) {
      const suggestion = suggestInvoiceNumber({ financialYear: "2026-27", previous });
      if (suggestion !== null) {
        expect(isValidInvoiceNumber(suggestion)).toBe(true);
      }
    }
  });
});

describe("end to end: a date becomes a legal number", () => {
  it("takes today's date through to a suggestion", () => {
    const financialYear = deriveFinancialYear("2026-08-17");
    expect(financialYear).toBe("2026-27");
    const first = suggestInvoiceNumber({ financialYear });
    expect(first).toBe("INV/2026-27/001");
    expect(isValidInvoiceNumber(first!)).toBe(true);
    expect(invoiceNumberKey(first!)).toBe("INV/2026-27/001");
    expect(extractFinancialYear(first!)).toBe(financialYear);
    // ...and the next one, and the one after.
    expect(suggestInvoiceNumber({ financialYear, previous: first })).toBe(
      "INV/2026-27/002"
    );
  });

  it("a February date lands in the same year as the previous August", () => {
    expect(deriveFinancialYear("2027-02-11")).toBe(deriveFinancialYear("2026-08-17"));
  });
});
