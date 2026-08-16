import { describe, it, expect } from "bun:test";
import {
  amountInWordsIndian,
  currencyWords,
  numberToWordsIndian,
  splitAmountUnits,
  MAX_AMOUNT_IN_WORDS,
} from "@/lib/amount-in-words";

describe("numberToWordsIndian — the small numbers", () => {
  it("spells zero through nineteen from the table", () => {
    expect(numberToWordsIndian(0)).toBe("Zero");
    expect(numberToWordsIndian(1)).toBe("One");
    expect(numberToWordsIndian(9)).toBe("Nine");
    expect(numberToWordsIndian(10)).toBe("Ten");
    expect(numberToWordsIndian(19)).toBe("Nineteen");
  });

  it("spells the tens and their compounds", () => {
    expect(numberToWordsIndian(20)).toBe("Twenty");
    expect(numberToWordsIndian(21)).toBe("Twenty One");
    expect(numberToWordsIndian(40)).toBe("Forty");
    expect(numberToWordsIndian(56)).toBe("Fifty Six");
    expect(numberToWordsIndian(99)).toBe("Ninety Nine");
  });

  it("spells hundreds without an 'and' before the remainder", () => {
    expect(numberToWordsIndian(100)).toBe("One Hundred");
    expect(numberToWordsIndian(105)).toBe("One Hundred Five");
    expect(numberToWordsIndian(999)).toBe("Nine Hundred Ninety Nine");
  });
});

describe("numberToWordsIndian — Indian grouping, not Western", () => {
  it("uses thousand up to 99,999", () => {
    expect(numberToWordsIndian(1_000)).toBe("One Thousand");
    expect(numberToWordsIndian(1_234)).toBe("One Thousand Two Hundred Thirty Four");
    expect(numberToWordsIndian(99_999)).toBe(
      "Ninety Nine Thousand Nine Hundred Ninety Nine"
    );
  });

  it("switches to lakh at 10^5, never 'hundred thousand'", () => {
    expect(numberToWordsIndian(100_000)).toBe("One Lakh");
    expect(numberToWordsIndian(100_000)).not.toContain("Hundred Thousand");
    expect(numberToWordsIndian(123_450)).toBe(
      "One Lakh Twenty Three Thousand Four Hundred Fifty"
    );
    expect(numberToWordsIndian(9_99_999)).toBe(
      "Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine"
    );
  });

  it("groups 1234567 as 12,34,567 — the classic Western-grouping bug", () => {
    expect(numberToWordsIndian(1_234_567)).toBe(
      "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven"
    );
    expect(numberToWordsIndian(1_234_567)).not.toContain("Million");
  });

  it("switches to crore at 10^7, never 'ten million'", () => {
    expect(numberToWordsIndian(9_999_999)).toBe(
      "Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine"
    );
    expect(numberToWordsIndian(10_000_000)).toBe("One Crore");
    expect(numberToWordsIndian(10_000_000)).not.toContain("Million");
    expect(numberToWordsIndian(12_34_56_789)).toBe(
      "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine"
    );
  });

  it("stacks multipliers onto crore beyond 10^9 instead of arab/kharab", () => {
    expect(numberToWordsIndian(1_000_000_000)).toBe("One Hundred Crore");
    expect(numberToWordsIndian(100_000_000_000)).toBe("Ten Thousand Crore");
    expect(numberToWordsIndian(1_234_56_78_90_123)).toBe(
      "One Lakh Twenty Three Thousand Four Hundred Fifty Six Crore Seventy Eight Lakh Ninety Thousand One Hundred Twenty Three"
    );
    expect(numberToWordsIndian(1_000_000_000)).not.toContain("Arab");
  });

  it("ignores a fractional part and a sign — it spells integers only", () => {
    expect(numberToWordsIndian(1_234.99)).toBe("One Thousand Two Hundred Thirty Four");
    expect(numberToWordsIndian(-5)).toBe("Five");
    expect(numberToWordsIndian(Number.NaN)).toBe("");
    expect(numberToWordsIndian(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("splitAmountUnits", () => {
  it("splits rupees from paise", () => {
    expect(splitAmountUnits(1_234.56)).toEqual({
      negative: false,
      major: 1_234,
      minor: 56,
    });
  });

  it("reads .5 and .50 as fifty paise, not five", () => {
    expect(splitAmountUnits(0.5)).toEqual({ negative: false, major: 0, minor: 50 });
    expect(splitAmountUnits(0.5)).toEqual(splitAmountUnits(0.50));
  });

  it("keeps .05 as five paise", () => {
    expect(splitAmountUnits(0.05)).toEqual({ negative: false, major: 0, minor: 5 });
  });

  it("rounds the third decimal the way the printed figure does", () => {
    expect(splitAmountUnits(0.994)).toEqual({ negative: false, major: 0, minor: 99 });
    // Carries out of the paise into a whole rupee.
    expect(splitAmountUnits(0.999)).toEqual({ negative: false, major: 1, minor: 0 });
    expect(splitAmountUnits(9.999)).toEqual({ negative: false, major: 10, minor: 0 });
  });

  it("rounds the way computeTotals does, not the way v * 100 does", () => {
    // The words must agree with the figure beside them, and every stored money
    // value in the app has already been through `toFixed(2)`. At 0.015 the two
    // roundings disagree: `Math.round(0.015 * 100)` is 2, `(0.015).toFixed(2)`
    // is "0.01" — and 0.01 is what computeTotals would have stored.
    expect(Math.round(0.015 * 100)).toBe(2);
    expect((0.015).toFixed(2)).toBe("0.01");
    expect(splitAmountUnits(0.015)).toEqual({ negative: false, major: 0, minor: 1 });
  });

  it("marks negatives, but never -0", () => {
    expect(splitAmountUnits(-12.34)).toEqual({ negative: true, major: 12, minor: 34 });
    expect(splitAmountUnits(-0)).toEqual({ negative: false, major: 0, minor: 0 });
    expect(splitAmountUnits(-0.001)).toEqual({ negative: false, major: 0, minor: 0 });
  });

  it("refuses non-finite input and anything past the safe-integer paise ceiling", () => {
    expect(splitAmountUnits(Number.NaN)).toBeNull();
    expect(splitAmountUnits(Number.POSITIVE_INFINITY)).toBeNull();
    expect(splitAmountUnits(MAX_AMOUNT_IN_WORDS + 1_000_000)).toBeNull();
    expect(splitAmountUnits(-(MAX_AMOUNT_IN_WORDS + 1_000_000))).toBeNull();
    expect(splitAmountUnits(MAX_AMOUNT_IN_WORDS)).not.toBeNull();
  });
});

describe("amountInWordsIndian — phrasing", () => {
  it("prints the §7.1 shape for an amount with paise", () => {
    expect(amountInWordsIndian(123_450.6)).toBe(
      "Indian Rupees One Lakh Twenty Three Thousand Four Hundred Fifty and Sixty Paise Only"
    );
    expect(amountInWordsIndian(1_234.56)).toBe(
      "Indian Rupees One Thousand Two Hundred Thirty Four and Fifty Six Paise Only"
    );
  });

  it("omits the paise clause entirely for an exact amount", () => {
    expect(amountInWordsIndian(1_234)).toBe(
      "Indian Rupees One Thousand Two Hundred Thirty Four Only"
    );
    expect(amountInWordsIndian(1_234)).not.toContain("Zero Paise");
    expect(amountInWordsIndian(1_234.0)).toBe(amountInWordsIndian(1_234));
  });

  it("says Zero rather than nothing for a zero amount", () => {
    expect(amountInWordsIndian(0)).toBe("Indian Rupees Zero Only");
  });

  it("uses the singular unit word for exactly one", () => {
    expect(amountInWordsIndian(1)).toBe("Indian Rupee One Only");
    expect(amountInWordsIndian(2)).toBe("Indian Rupees Two Only");
  });

  it("drops the rupee clause when the amount is under a rupee", () => {
    expect(amountInWordsIndian(0.05)).toBe("Five Paise Only");
    expect(amountInWordsIndian(0.5)).toBe("Fifty Paise Only");
    expect(amountInWordsIndian(0.5)).toBe(amountInWordsIndian(0.50));
    expect(amountInWordsIndian(0.99)).toBe("Ninety Nine Paise Only");
  });

  it("uses the singular minor unit for a single paisa", () => {
    expect(amountInWordsIndian(0.01)).toBe("One Paisa Only");
    expect(amountInWordsIndian(1.01)).toBe("Indian Rupee One and One Paisa Only");
  });

  it("rounds a third decimal, carrying into the rupees", () => {
    expect(amountInWordsIndian(0.999)).toBe("Indian Rupee One Only");
    expect(amountInWordsIndian(0.994)).toBe("Ninety Nine Paise Only");
    expect(amountInWordsIndian(1_234.565)).toBe(
      "Indian Rupees One Thousand Two Hundred Thirty Four and Fifty Seven Paise Only"
    );
  });

  it("always ends in Only — the anti-tampering convention", () => {
    for (const amount of [0, 0.01, 1, 99.99, 100_000, 10_000_000]) {
      expect(amountInWordsIndian(amount).endsWith(" Only")).toBe(true);
    }
  });
});

describe("amountInWordsIndian — scale, sign and currency", () => {
  it("keeps lakh and crore in the printed string", () => {
    expect(amountInWordsIndian(100_000)).toBe("Indian Rupees One Lakh Only");
    expect(amountInWordsIndian(10_000_000)).toBe("Indian Rupees One Crore Only");
    expect(amountInWordsIndian(9_999_999.99)).toBe(
      "Indian Rupees Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine and Ninety Nine Paise Only"
    );
    expect(amountInWordsIndian(1_234_567.89)).toBe(
      "Indian Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Eighty Nine Paise Only"
    );
  });

  it("prefixes Minus for a credit-note-style negative", () => {
    expect(amountInWordsIndian(-1_234.56)).toBe(
      "Minus Indian Rupees One Thousand Two Hundred Thirty Four and Fifty Six Paise Only"
    );
    expect(amountInWordsIndian(-0.05)).toBe("Minus Five Paise Only");
    expect(amountInWordsIndian(-0)).toBe("Indian Rupees Zero Only");
  });

  it("returns an empty string instead of a wrong legal amount", () => {
    expect(amountInWordsIndian(Number.NaN)).toBe("");
    expect(amountInWordsIndian(Number.POSITIVE_INFINITY)).toBe("");
    expect(amountInWordsIndian(MAX_AMOUNT_IN_WORDS * 10)).toBe("");
  });

  it("names the currency instead of assuming rupees", () => {
    expect(amountInWordsIndian(2.5, "USD")).toBe(
      "US Dollars Two and Fifty Cents Only"
    );
    expect(amountInWordsIndian(1, "USD")).toBe("US Dollar One Only");
    expect(amountInWordsIndian(1.01, "GBP")).toBe(
      "Pound Sterling One and One Penny Only"
    );
    expect(amountInWordsIndian(3.02, "GBP")).toBe(
      "Pounds Sterling Three and Two Pence Only"
    );
    expect(amountInWordsIndian(5, "EUR")).toBe("Euros Five Only");
    expect(amountInWordsIndian(5, "AED")).toBe("UAE Dirhams Five Only");
  });

  it("defaults to INR and tolerates casing and whitespace", () => {
    expect(amountInWordsIndian(5)).toBe(amountInWordsIndian(5, "INR"));
    expect(amountInWordsIndian(5, " inr ")).toBe("Indian Rupees Five Only");
    expect(amountInWordsIndian(5, "")).toBe("Indian Rupees Five Only");
  });

  it("falls back to the raw code for a currency it does not know", () => {
    expect(amountInWordsIndian(5, "JPY")).toBe("JPY Five Only");
    expect(amountInWordsIndian(5, "JPY")).not.toContain("Rupee");
  });
});

describe("currencyWords", () => {
  it("returns singular and plural for a known code", () => {
    expect(currencyWords("INR")).toEqual({
      majorSingular: "Indian Rupee",
      majorPlural: "Indian Rupees",
      minorSingular: "Paisa",
      minorPlural: "Paise",
    });
  });

  it("degrades an unknown code without claiming rupees", () => {
    expect(currencyWords("XYZ")).toEqual({
      majorSingular: "XYZ",
      majorPlural: "XYZ",
      minorSingular: "Cent",
      minorPlural: "Cents",
    });
  });
});
