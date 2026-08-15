import { describe, it, expect } from "bun:test";
import {
  sanitizeNumericDraft,
  parseNumericDraft,
  liveNumericValue,
  commitNumericDraft,
  formatNumericValue,
  beginNumericEdit,
  changeNumericDraft,
  commitNumericEdit,
  shouldResyncNumericDraft,
  type NumericFieldSpec,
} from "@/lib/numeric-input";

const QTY: NumericFieldSpec = { min: 1, max: 100_000, decimals: 0 };
const MONEY: NumericFieldSpec = { min: 0, max: 100_000_000, decimals: 2 };
const PERCENT: NumericFieldSpec = { min: 0, max: 100, decimals: 2 };

describe("sanitizeNumericDraft", () => {
  it("accepts an empty draft — the reported bug was that it did not", () => {
    expect(sanitizeNumericDraft("", QTY)).toBe("");
    expect(sanitizeNumericDraft("", MONEY)).toBe("");
  });

  it("accepts a half-typed decimal when decimals are allowed", () => {
    expect(sanitizeNumericDraft("12.", MONEY)).toBe("12.");
    expect(sanitizeNumericDraft("0.", MONEY)).toBe("0.");
    expect(sanitizeNumericDraft(".", MONEY)).toBe(".");
  });

  it("rejects a decimal point on an integer field", () => {
    expect(sanitizeNumericDraft("12.", QTY)).toBeNull();
    expect(sanitizeNumericDraft("2.5", QTY)).toBeNull();
  });

  it("rejects more fractional digits than the field allows", () => {
    expect(sanitizeNumericDraft("12.34", MONEY)).toBe("12.34");
    expect(sanitizeNumericDraft("12.345", MONEY)).toBeNull();
  });

  it("rejects letters, signs, exponents and extra dots", () => {
    for (const raw of ["abc", "12a", "1e5", "-1", "+1", "1.2.3", " 12", "12 "]) {
      expect(sanitizeNumericDraft(raw, MONEY)).toBeNull();
    }
  });

  it("rejects an absurdly long integer part", () => {
    expect(sanitizeNumericDraft("9".repeat(15), MONEY)).toBe("9".repeat(15));
    expect(sanitizeNumericDraft("9".repeat(16), MONEY)).toBeNull();
  });

  it("collapses leading zeros without eating a decimal", () => {
    expect(sanitizeNumericDraft("007", MONEY)).toBe("7");
    expect(sanitizeNumericDraft("0.5", MONEY)).toBe("0.5");
    expect(sanitizeNumericDraft("0.", MONEY)).toBe("0.");
    expect(sanitizeNumericDraft("0", MONEY)).toBe("0");
  });

  it("leaves a grouped paste alone rather than mangling it", () => {
    // The preview formats en-IN, so "1,200.00" is copyable out of it. Turning
    // the comma into a dot would silently make it 1.2.
    expect(sanitizeNumericDraft("1,200.00", MONEY)).toBeNull();
  });
});

describe("parseNumericDraft", () => {
  it("returns null only for drafts with no digits", () => {
    expect(parseNumericDraft("")).toBeNull();
    expect(parseNumericDraft(".")).toBeNull();
  });

  it("reads a half-typed decimal as the number it already is", () => {
    expect(parseNumericDraft("12.")).toBe(12);
    expect(parseNumericDraft("0.")).toBe(0);
    expect(parseNumericDraft("12.5")).toBe(12.5);
  });
});

describe("liveNumericValue", () => {
  it("publishes the minimum for an empty draft, not a blanket 0", () => {
    expect(liveNumericValue("", QTY)).toBe(1);
    expect(liveNumericValue("", MONEY)).toBe(0);
  });

  it("caps as you type but does not floor as you type", () => {
    expect(liveNumericValue("999999", QTY)).toBe(100_000);
    expect(liveNumericValue("150", PERCENT)).toBe(100);
    // 0 in a min-1 field must survive the keystroke, or it can never be typed.
    expect(liveNumericValue("0", QTY)).toBe(0);
  });
});

describe("commitNumericDraft", () => {
  it("falls back to the minimum when the field is left empty", () => {
    expect(commitNumericDraft("", QTY)).toBe(1);
    expect(commitNumericDraft("", MONEY)).toBe(0);
    expect(commitNumericDraft(".", MONEY)).toBe(0);
  });

  it("rounds to the field's precision", () => {
    expect(commitNumericDraft("2.5", QTY)).toBe(3);
    expect(commitNumericDraft("2.4", QTY)).toBe(2);
    expect(commitNumericDraft("12.", MONEY)).toBe(12);
    expect(commitNumericDraft("12.5", MONEY)).toBe(12.5);
  });

  it("clamps into [min, max]", () => {
    expect(commitNumericDraft("0.5", QTY)).toBe(1);
    expect(commitNumericDraft("0", QTY)).toBe(1);
    expect(commitNumericDraft("999999999", QTY)).toBe(100_000);
    expect(commitNumericDraft("150", PERCENT)).toBe(100);
    expect(commitNumericDraft("999999999999", MONEY)).toBe(100_000_000);
  });
});

describe("formatNumericValue", () => {
  it("does not pad — a money field at rest still reads 0, not 0.00", () => {
    expect(formatNumericValue(0)).toBe("0");
    expect(formatNumericValue(1200)).toBe("1200");
    expect(formatNumericValue(1200.5)).toBe("1200.5");
  });

  it("survives a value the field itself could not have produced", () => {
    // The AI assistant may set a fractional quantity on an integer field.
    expect(formatNumericValue(2.5)).toBe("2.5");
    expect(formatNumericValue(Number.NaN)).toBe("0");
  });

  it("round-trips: format -> sanitize -> parse -> commit is idempotent", () => {
    for (const [value, spec] of [
      [0, MONEY],
      [1, QTY],
      [12.5, MONEY],
      [1200, MONEY],
      [100_000, QTY],
    ] as Array<[number, NumericFieldSpec]>) {
      const text = formatNumericValue(value);
      expect(sanitizeNumericDraft(text, spec)).toBe(text);
      expect(commitNumericDraft(text, spec)).toBe(value);
    }
  });
});

describe("edit transitions", () => {
  it("clears a field and retypes it — 1 -> '' -> 8 gives 8, never 18", () => {
    const focused = beginNumericEdit(1);
    expect(focused.draft).toBe("1");
    expect(focused.emit).toBeNull();

    const cleared = changeNumericDraft("", focused.draft, 1, QTY);
    expect(cleared.draft).toBe("");
    expect(cleared.emit).toBe(1);

    const retyped = changeNumericDraft("8", cleared.draft, 1, QTY);
    expect(retyped.draft).toBe("8");
    expect(retyped.emit).toBe(8);
  });

  it("types a decimal without collapsing to 0 partway through", () => {
    const steps = ["1", "12", "12.", "12.5"];
    let draft: string | null = "0";
    const emitted: Array<number | null> = [];
    for (const raw of steps) {
      const transition = changeNumericDraft(raw, draft, 0, MONEY);
      draft = transition.draft;
      emitted.push(transition.emit);
    }
    expect(draft).toBe("12.5");
    expect(emitted).toEqual([1, 12, 12, 12.5]);
  });

  it("refuses a bad keystroke and keeps the draft it had", () => {
    const rejected = changeNumericDraft("12a", "12", 12, MONEY);
    expect(rejected.rejected).toBe(true);
    expect(rejected.draft).toBe("12");
    expect(rejected.emit).toBeNull();
  });

  it("publishes nothing when a field is left without being typed into", () => {
    expect(commitNumericEdit(null, QTY).emit).toBeNull();
  });

  it("commits the draft on the way out", () => {
    const committed = commitNumericEdit("", QTY);
    expect(committed.draft).toBeNull();
    expect(committed.emit).toBe(1);
  });
});

describe("shouldResyncNumericDraft", () => {
  it("keeps the draft when the parent is echoing this field's own value", () => {
    expect(shouldResyncNumericDraft(12, 12)).toBe(false);
  });

  it("drops the draft when the value is changed from outside", () => {
    // An AI patch replacing the line items, or a row removed above this one.
    expect(shouldResyncNumericDraft(40, 12)).toBe(true);
  });

  it("does nothing for a field that has published nothing yet", () => {
    expect(shouldResyncNumericDraft(12, null)).toBe(false);
  });
});
