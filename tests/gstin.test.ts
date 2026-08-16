import { describe, it, expect } from "bun:test";
import {
  GSTIN_ALPHABET,
  GSTIN_LENGTH,
  GSTIN_REGEX_STRICT,
  PAN_REGEX,
  GST_STATE_CODES,
  GST_STATE_PICKER_CODES,
  DISCONTINUED_GST_STATE_CODES,
  OTHER_COUNTRY_STATE_CODE,
  normalizeGstin,
  gstinCheckDigit,
  isValidGstin,
  isValidOptionalGstin,
  stateCodeFromGstin,
  stateNameFromCode,
  stateNameFromGstin,
  panFromGstin,
  isValidPan,
} from "@/lib/gstin";

/**
 * Four published, real GSTINs. These are the ground truth for this module: the
 * checksum was verified by execution against them, and every alternative
 * formulation of the algorithm that has been tried fails at least one of them.
 */
const VECTORS = [
  { gstin: "27AAPFU0939F1ZV", state: "27", stateName: "Maharashtra", pan: "AAPFU0939F" },
  { gstin: "29AAGCB7383J1Z4", state: "29", stateName: "Karnataka", pan: "AAGCB7383J" },
  { gstin: "24AAACC1206D1ZM", state: "24", stateName: "Gujarat", pan: "AAACC1206D" },
  { gstin: "09AAACH7409R1ZZ", state: "09", stateName: "Uttar Pradesh", pan: "AAACH7409R" },
] as const;

const VALID = VECTORS[0].gstin; // 27AAPFU0939F1ZV

/** Replace one character, so a test can say exactly what it corrupted. */
const mutate = (gstin: string, index: number, char: string): string =>
  gstin.slice(0, index) + char + gstin.slice(index + 1);

describe("the four published GSTINs", () => {
  for (const v of VECTORS) {
    it(`${v.gstin} validates, state ${v.state}, PAN ${v.pan}`, () => {
      expect(isValidGstin(v.gstin)).toBe(true);
      expect(stateCodeFromGstin(v.gstin)).toBe(v.state);
      expect(stateNameFromGstin(v.gstin)).toBe(v.stateName);
      expect(panFromGstin(v.gstin)).toBe(v.pan);
      expect(v.gstin.length).toBe(GSTIN_LENGTH);
    });
  }

  it("gstinCheckDigit reproduces the published 15th character of each", () => {
    // Pinning all four literally is the factor-variant regression test: the
    // factor-starts-at-1 variant yields T / O / J / E instead of V / 4 / M / Z,
    // i.e. it is wrong on every single one of them.
    expect(gstinCheckDigit("27AAPFU0939F1Z")).toBe("V");
    expect(gstinCheckDigit("29AAGCB7383J1Z")).toBe("4");
    expect(gstinCheckDigit("24AAACC1206D1Z")).toBe("M");
    expect(gstinCheckDigit("09AAACH7409R1Z")).toBe("Z");
  });
});

describe("checksum failures", () => {
  it("rejects a wrong check digit on all four", () => {
    // This is THE test that fails if someone drops the base-36 digit-sum step:
    // the naive variant computes W / 6 / N / 1 as the check character, so it
    // would happily accept a document whose real check character is V/4/M/Z.
    for (const v of VECTORS) {
      const next =
        GSTIN_ALPHABET[
          (GSTIN_ALPHABET.indexOf(v.gstin[14]) + 1) % GSTIN_ALPHABET.length
        ];
      expect(isValidGstin(mutate(v.gstin, 14, next))).toBe(false);
    }
    expect(isValidGstin("27AAPFU0939F1ZW")).toBe(false);
  });

  it("rejects a transposition inside the PAN", () => {
    // "0939" -> "9039". A check digit that cannot catch a transposition is not
    // doing its job; this is the single most common typing error there is.
    expect(isValidGstin("27AAPFU9039F1ZV")).toBe(false);
  });

  it("rejects a single mutated character at every position", () => {
    // Positions 0-1 (state), 2-6 (PAN letters), 7-10 (PAN digits), 11 (PAN
    // letter), 12 (entity), 14 (check). Position 13 is the literal Z and is
    // covered by the structural tests below.
    expect(isValidGstin(mutate(VALID, 0, "1"))).toBe(false); // 17...
    expect(isValidGstin(mutate(VALID, 1, "8"))).toBe(false); // 28...
    expect(isValidGstin(mutate(VALID, 2, "B"))).toBe(false); // PAN letter
    expect(isValidGstin(mutate(VALID, 6, "V"))).toBe(false); // PAN letter
    expect(isValidGstin(mutate(VALID, 7, "1"))).toBe(false); // PAN digit
    expect(isValidGstin(mutate(VALID, 10, "8"))).toBe(false); // PAN digit
    expect(isValidGstin(mutate(VALID, 11, "G"))).toBe(false); // PAN letter
    expect(isValidGstin(mutate(VALID, 12, "2"))).toBe(false); // entity number
    expect(isValidGstin(mutate(VALID, 14, "U"))).toBe(false); // check digit
  });

  it("rejects EVERY single-character mutation of all four vectors", () => {
    // Exhaustive: 4 GSTINs x 15 positions x 35 substitutions. The mod-36 Luhn
    // is provably single-substitution-complete (the per-character contribution
    // is injective mod 36 at both factors), so a single acceptance here means
    // the implementation has drifted from the algorithm.
    const accepted: string[] = [];
    for (const v of VECTORS) {
      for (let i = 0; i < GSTIN_LENGTH; i++) {
        for (const char of GSTIN_ALPHABET) {
          if (char === v.gstin[i]) continue;
          const candidate = mutate(v.gstin, i, char);
          if (isValidGstin(candidate)) accepted.push(candidate);
        }
      }
    }
    expect(accepted).toEqual([]);
  });
});

describe("structural failures", () => {
  it("rejects the wrong length", () => {
    expect(isValidGstin(VALID.slice(0, 14))).toBe(false); // 14 chars
    expect(isValidGstin(VALID + "V")).toBe(false); // 16 chars
    expect(isValidGstin("27AAPFU0939F1Z")).toBe(false); // check digit missing
  });

  it("rejects an out-of-range state code even with a correct checksum", () => {
    // Built from a real prefix so only the state code is at fault: the strict
    // regex must reject 00 and 39-99 before the checksum is ever consulted.
    for (const code of ["00", "39", "40", "97", "99"]) {
      const body = "AAPFU0939F1Z";
      const first14 = code + body;
      const wellFormed = first14 + gstinCheckDigit(first14);
      expect(isValidGstin(wellFormed)).toBe(false);
    }
    // ...and 01 / 38, the boundaries, are inside the accepted range.
    expect(GSTIN_REGEX_STRICT.test("01AAPFU0939F1ZV")).toBe(true);
    expect(GSTIN_REGEX_STRICT.test("38AAPFU0939F1ZV")).toBe(true);
    expect(GSTIN_REGEX_STRICT.test("00AAPFU0939F1ZV")).toBe(false);
    expect(GSTIN_REGEX_STRICT.test("39AAPFU0939F1ZV")).toBe(false);
  });

  it("rejects a wrong PAN pattern in positions 3-12", () => {
    expect(isValidGstin("27AAPF10939F1ZV")).toBe(false); // digit among the 5 letters
    expect(isValidGstin("27AAPFUO939F1ZV")).toBe(false); // letter O among the 4 digits
    expect(isValidGstin("27AAPFU09391ZZV")).toBe(false); // digit where the 10th letter goes
  });

  it("rejects a zero entity number", () => {
    // Position 13 (index 12) is 1-9 then A-Z; there is no branch zero.
    expect(GSTIN_REGEX_STRICT.test("27AAPFU0939F0ZV")).toBe(false);
  });

  it("rejects a missing Z in position 14", () => {
    // Kept strict deliberately. UIN / OIDAR and a few special registrations
    // legitimately carry something other than Z here, and the research suggests
    // surfacing that as an overridable warning rather than a hard rejection.
    // That is deferred; until then this module rejects them, and this test
    // records that the rejection is a decision rather than an oversight.
    expect(isValidGstin("27AAPFU0939F1YV")).toBe(false);
    expect(isValidGstin(mutate(VALID, 13, "A"))).toBe(false);
    expect(GSTIN_REGEX_STRICT.test("27AAPFU0939F1ZV")).toBe(true);
  });

  it("rejects characters outside the mod-36 alphabet without throwing", () => {
    for (const bad of ["27AAPFU0939F1Z*", "27AAPFU0939F1Z-", "27-AAPFU0939F1Z", "!!!!!!!!!!!!!!!"]) {
      expect(isValidGstin(bad)).toBe(false);
    }
  });
});

describe("normalisation: trim, uppercase, strip inner whitespace", () => {
  // Decision: NORMALISE rather than reject. GSTINs are pasted out of PDFs and
  // emails, where they arrive lowercased or split into groups. The GSTIN
  // alphabet contains no lowercase letters and no spaces, so folding them loses
  // nothing, and rejecting a correct paste over invisible characters is exactly
  // the sort of validation that makes users retype a field they got right.
  it("accepts a fully lowercase GSTIN", () => {
    expect(isValidGstin("27aapfu0939f1zv")).toBe(true);
  });

  it("accepts surrounding whitespace", () => {
    expect(isValidGstin(" 27AAPFU0939F1ZV ")).toBe(true);
    expect(isValidGstin("\t27AAPFU0939F1ZV\n")).toBe(true);
  });

  it("accepts the grouped form people paste from documents", () => {
    expect(isValidGstin("27 AAPFU0939F 1ZV")).toBe(true);
    expect(isValidGstin("27  aapfu 0939 f1zv")).toBe(true);
  });

  it("normalizeGstin is the single place that folding happens", () => {
    expect(normalizeGstin(" 27 aapfu0939f1zv ")).toBe("27AAPFU0939F1ZV");
    expect(normalizeGstin("")).toBe("");
    expect(normalizeGstin(undefined)).toBe("");
    expect(normalizeGstin(null)).toBe("");
  });

  it("derived getters see through the folding too", () => {
    expect(stateCodeFromGstin(" 27aapfu0939f1zv ")).toBe("27");
    expect(panFromGstin(" 27aapfu0939f1zv ")).toBe("AAPFU0939F");
  });
});

describe("absence", () => {
  // The point of the whole section: registration is only mandatory above the
  // turnover thresholds (broadly Rs 20 lakh services / Rs 40 lakh goods), so
  // MOST users have no GSTIN. Absence is the majority case and must be
  // acceptable — a validator that rejected an empty GSTIN would force every
  // unregistered user to fake one.
  it("treats an absent GSTIN as ACCEPTABLE on an optional field", () => {
    expect(isValidOptionalGstin("")).toBe(true);
    expect(isValidOptionalGstin("   ")).toBe(true);
    expect(isValidOptionalGstin(undefined)).toBe(true);
    expect(isValidOptionalGstin(null)).toBe(true);
  });

  it("still rejects a present-but-wrong GSTIN on that same field", () => {
    // Absence is excused; a typo is not. Otherwise the leniency above would
    // swallow every real mistake.
    expect(isValidOptionalGstin("27AAPFU0939F1ZW")).toBe(false);
    expect(isValidOptionalGstin("nonsense")).toBe(false);
    expect(isValidOptionalGstin(VALID)).toBe(true);
  });

  it("isValidGstin itself says false for empty/null/undefined, and never throws", () => {
    // "" is not a GSTIN. The distinction from isValidOptionalGstin is
    // deliberate: callers must choose which question they are asking.
    expect(isValidGstin("")).toBe(false);
    expect(isValidGstin("   ")).toBe(false);
    expect(isValidGstin(undefined)).toBe(false);
    expect(isValidGstin(null)).toBe(false);
    expect(() => isValidGstin(undefined)).not.toThrow();
    expect(() => isValidGstin(null)).not.toThrow();
  });

  it("derived getters return '' rather than a garbage substring", () => {
    for (const bad of ["", "   ", "nonsense", "27AAPFU0939F1ZW", "1234567890"]) {
      expect(stateCodeFromGstin(bad)).toBe("");
      expect(panFromGstin(bad)).toBe("");
      expect(stateNameFromGstin(bad)).toBe("");
    }
    expect(stateCodeFromGstin(undefined)).toBe("");
    expect(panFromGstin(null)).toBe("");
  });
});

describe("state-code table", () => {
  it("keys are all exactly two characters", () => {
    for (const code of Object.keys(GST_STATE_CODES)) {
      expect(code).toHaveLength(2);
      expect(code).toMatch(/^[0-9]{2}$/);
    }
  });

  it("looks up assigned codes", () => {
    expect(stateNameFromCode("27")).toBe("Maharashtra");
    expect(stateNameFromCode("07")).toBe("Delhi");
    expect(stateNameFromCode("37")).toBe("Andhra Pradesh");
    expect(stateNameFromCode("97")).toBe("Other Territory");
  });

  it("returns '' for unassigned codes rather than undefined", () => {
    // 39-95 were never assigned, and 96 is not in the table on purpose.
    for (const code of ["00", "39", "50", "96", "98", "7", "abc", "", "__proto__"]) {
      expect(stateNameFromCode(code)).toBe("");
    }
    expect(stateNameFromCode(undefined)).toBe("");
    expect(stateNameFromCode(null)).toBe("");
  });

  it("keeps the discontinued codes valid for existing registrations", () => {
    // 25 merged into 26 and 28 was superseded by 37. No new registration uses
    // them, but GSTINs already carrying them are live documents and must not
    // start failing validation.
    expect(GST_STATE_CODES["25"]).toBeDefined();
    expect(GST_STATE_CODES["28"]).toBeDefined();
    expect(GSTIN_REGEX_STRICT.test("25AAPFU0939F1ZV")).toBe(true);
    expect(GSTIN_REGEX_STRICT.test("28AAPFU0939F1ZV")).toBe(true);
  });

  it("the picker excludes 25, 28 and 99 and nothing else", () => {
    expect(GST_STATE_PICKER_CODES).not.toContain("25");
    expect(GST_STATE_PICKER_CODES).not.toContain("28");
    expect(GST_STATE_PICKER_CODES).not.toContain("99");
    expect(GST_STATE_PICKER_CODES).toContain("26");
    expect(GST_STATE_PICKER_CODES).toContain("37");
    expect(GST_STATE_PICKER_CODES).toContain("97");
    expect(GST_STATE_PICKER_CODES).toHaveLength(
      Object.keys(GST_STATE_CODES).length - 3
    );
    // Derived from the table, so the picker and the validator cannot drift.
    for (const code of GST_STATE_PICKER_CODES) {
      expect(GST_STATE_CODES[code]).toBeDefined();
    }
    expect(DISCONTINUED_GST_STATE_CODES).toEqual(["25", "28"]);
  });

  it("96 is an internal export sentinel, deliberately not a state name", () => {
    // UNVERIFIED as an official code. Keeping it out of the table is what stops
    // "96" from ever being printed on a document in place of a country name.
    expect(OTHER_COUNTRY_STATE_CODE).toBe("96");
    expect(GST_STATE_CODES["96"]).toBeUndefined();
  });
});

describe("PAN", () => {
  it("extracts the PAN from a GSTIN — characters 3-12, zero extra typing", () => {
    // This is why the GSTIN field is worth more than it looks: the TDS block on
    // the invoice needs the supplier's PAN, and a registered user has already
    // typed it inside their GSTIN.
    for (const v of VECTORS) {
      expect(panFromGstin(v.gstin)).toBe(v.pan);
      expect(v.gstin.slice(2, 12)).toBe(v.pan);
      expect(isValidPan(panFromGstin(v.gstin))).toBe(true);
    }
  });

  it("PAN_REGEX accepts a well-formed PAN", () => {
    expect(PAN_REGEX.test("AAPFU0939F")).toBe(true);
    expect(PAN_REGEX.test("ABCDE1234Z")).toBe(true);
  });

  it("PAN_REGEX rejects the wrong shape", () => {
    expect(PAN_REGEX.test("AAPFU0939")).toBe(false); // 9 chars
    expect(PAN_REGEX.test("AAPF10939F")).toBe(false); // digit among the 5 letters
    expect(PAN_REGEX.test("AAPFU09391")).toBe(false); // digit in the last slot
    expect(PAN_REGEX.test("AAPFU0939FX")).toBe(false); // 11 chars
    expect(PAN_REGEX.test("aapfu0939f")).toBe(false); // regex itself is case-sensitive
  });

  it("isValidPan normalises before matching, unlike the raw regex", () => {
    expect(isValidPan(" aapfu0939f ")).toBe(true);
    expect(isValidPan("AAPFU0939")).toBe(false);
    expect(isValidPan("")).toBe(false);
    expect(isValidPan(undefined)).toBe(false);
    expect(isValidPan(null)).toBe(false);
  });
});

describe("gstinCheckDigit", () => {
  it("returns a character from the mod-36 alphabet", () => {
    for (const v of VECTORS) {
      expect(GSTIN_ALPHABET).toContain(gstinCheckDigit(v.gstin.slice(0, 14)));
    }
  });

  it("closes the loop: appending its output always validates", () => {
    // Round-trip over every state code the regex accepts, which also proves the
    // "(mod - sum % mod) % mod" wrap handles a zero remainder (it would produce
    // an out-of-range index if written as `mod - (sum % mod)`).
    for (let code = 1; code <= 38; code++) {
      const first14 = String(code).padStart(2, "0") + "AAPFU0939F1Z";
      expect(isValidGstin(first14 + gstinCheckDigit(first14))).toBe(true);
    }
  });
});
