/**
 * GSTIN: structure, mod-36 check digit, state codes, PAN extraction.
 *
 * A GSTIN is 15 characters:
 *
 *     27  AAPFU0939F   1    Z    V
 *     ^^  ^^^^^^^^^^   ^    ^    ^
 *     |   |            |    |    +-- 15: mod-36 check character
 *     |   |            |    +------- 14: literal 'Z' (reserved)
 *     |   |            +------------ 13: entity/branch number within the state
 *     |   +------------------------- 3-12: the holder's 10-character PAN
 *     +----------------------------- 1-2: GST state code (numeric)
 *
 * A regex-valid GSTIN is trivially forgeable, so the format check is worthless
 * on its own — every public entry point here pairs it with the checksum.
 *
 * Two traps, both of which produce a validator that looks fine and silently
 * accepts invalid GSTINs:
 *
 *  1. `Math.floor(d / 36) + (d % 36)` in `gstinCheckDigit` is ESSENTIAL. It is
 *     the base-36 equivalent of Luhn's "add the digits of the doubled value".
 *     Dropping it (plain `sum += factor * codePoint`) is the most common wrong
 *     implementation on the web.
 *  2. The factor starts at 2 at the RIGHTMOST of the 14 characters, not at 1.
 *     The factor-starts-at-1 variant fails all four of the published GSTINs
 *     pinned in `tests/gstin.test.ts`.
 *
 * Both traps are covered by tests that fail loudly if either is reintroduced,
 * because neither is visible by reading the code.
 *
 * ABSENCE IS NOT AN ERROR. Registration is only mandatory above the turnover
 * thresholds (broadly Rs 20 lakh for services, Rs 40 lakh for goods), so most
 * users legitimately have no GSTIN at all. `isValidGstin("")` is `false` — ""
 * is not a valid GSTIN — but callers validating a user-supplied *optional*
 * field must use `isValidOptionalGstin`, which treats absence as acceptable.
 * A validator that rejected an empty GSTIN would force every unregistered user
 * to invent one.
 *
 * Zero dependencies, fully offline: there is no network call here and there
 * must never be one. This module imports nothing from `lib/invoices` or
 * `lib/invoice-domain`, so it stays independently testable.
 */

/** Mod-36 alphabet: '0'->0 ... '9'->9, 'A'->10 ... 'Z'->35. */
export const GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const GSTIN_LENGTH = 15;

/**
 * Format only. Strict on the state code: accepts 01-38, rejects 00 and 39-99.
 *
 * Position 14 is pinned to a literal `Z`, which is correct for every ordinary
 * registration. UIN/OIDAR and a handful of special registrations legitimately
 * carry something else there, and the research recommends surfacing that
 * rejection as an overridable warning rather than a hard block. Deferred; kept
 * strict, because relaxing it to `[A-Z]` widens the accepted set for everyone
 * to accommodate a category this app does not yet model.
 */
export const GSTIN_REGEX_STRICT =
  /^(0[1-9]|[1-2][0-9]|3[0-8])[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** PAN: 5 letters, 4 digits, 1 letter. The 4th letter is the entity type. */
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * Trim, uppercase, and strip ALL internal whitespace.
 *
 * Normalising rather than rejecting is deliberate: users paste GSTINs out of
 * PDFs and emails, where they arrive lowercased or broken into groups
 * ("27 AAPFU0939F 1ZV"). Every one of those is unambiguously the same
 * identifier — a GSTIN has no lowercase letters and no spaces in its alphabet,
 * so nothing is lost by folding them, and rejecting a correct paste over
 * invisible characters is the kind of validation users rightly hate.
 *
 * Accepts `null`/`undefined` so callers never have to guard first.
 */
export const normalizeGstin = (value: string | null | undefined): string =>
  (value || "").trim().toUpperCase().replace(/\s+/g, "");

/**
 * Luhn mod-36 over the first 14 characters. Returns the expected 15th.
 *
 * Expects an already-normalised 14-character string; a character outside the
 * alphabet gives `indexOf` of -1, which poisons the sum rather than throwing —
 * that is fine, because the only caller has already run the strict regex.
 */
export function gstinCheckDigit(first14: string): string {
  const mod = GSTIN_ALPHABET.length; // 36
  let factor = 2;
  let sum = 0;
  for (let i = first14.length - 1; i >= 0; i--) {
    const codePoint = GSTIN_ALPHABET.indexOf(first14[i]);
    let digit = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    // Base-36 "digit sum". Removing this line is the classic bug: it makes the
    // checksum blind to a whole family of single-character errors.
    digit = Math.floor(digit / mod) + (digit % mod);
    sum += digit;
  }
  return GSTIN_ALPHABET[(mod - (sum % mod)) % mod];
}

/**
 * Structure AND checksum. `""`, `null` and `undefined` are `false` — they are
 * not GSTINs. For an optional field, use `isValidOptionalGstin`.
 */
export function isValidGstin(value: string | null | undefined): boolean {
  const gstin = normalizeGstin(value);
  if (!GSTIN_REGEX_STRICT.test(gstin)) return false;
  return gstinCheckDigit(gstin.slice(0, 14)) === gstin[14];
}

/**
 * The form-field predicate: absent is fine, present must be correct.
 *
 * This is what `validateInvoice` and the API normaliser should call for
 * `companyGstin` / `billToGstin`. Below the registration thresholds a user has
 * no GSTIN, and that is the majority case, not an edge case.
 */
export const isValidOptionalGstin = (
  value: string | null | undefined
): boolean => {
  const gstin = normalizeGstin(value);
  return gstin === "" || isValidGstin(gstin);
};

/** The two leading digits, or "" if the GSTIN is not valid. */
export const stateCodeFromGstin = (value: string | null | undefined): string =>
  isValidGstin(value) ? normalizeGstin(value).slice(0, 2) : "";

/**
 * PAN is GSTIN characters 3-12, i.e. `slice(2, 12)`. Free: a registered user
 * never has to type their PAN separately, which is what makes the TDS block on
 * the invoice cost nothing to fill in.
 *
 * Returns "" for anything that does not fully validate, rather than a garbage
 * substring — a wrong PAN printed on a document is worse than no PAN.
 */
export const panFromGstin = (value: string | null | undefined): string =>
  isValidGstin(value) ? normalizeGstin(value).slice(2, 12) : "";

/** Format check for a directly-entered PAN (unregistered users have no GSTIN). */
export const isValidPan = (value: string | null | undefined): boolean =>
  PAN_REGEX.test(normalizeGstin(value));

/**
 * GST state codes. Keys are always exactly two characters, zero-padded.
 *
 * Note that 97 and 99 appear here but are rejected by `GSTIN_REGEX_STRICT`
 * (01-38 only). That is intended: the table doubles as the place-of-supply
 * vocabulary, which is wider than the set of codes that open a GSTIN.
 */
export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman & Diu", // DISCONTINUED - merged into 26. Legacy GSTINs only.
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (before bifurcation)", // DISCONTINUED - superseded by 37.
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory", // Confirmed official.
  "99": "Centre Jurisdiction / OIDAR",
};

/**
 * 25 (merged into 26) and 28 (superseded by 37) no longer issue registrations.
 * Existing GSTINs carrying them are still valid and must keep validating, so
 * they stay in `GST_STATE_CODES`; they are only kept out of the picker.
 */
export const DISCONTINUED_GST_STATE_CODES: readonly string[] = ["25", "28"];

/**
 * "Other Country" — an Invoicey-internal place-of-supply sentinel for exports.
 * UNVERIFIED as an official GST code, which is exactly why it is not in
 * `GST_STATE_CODES`: never print "96" on a document, print the country name.
 */
export const OTHER_COUNTRY_STATE_CODE = "96";

/**
 * What a state picker may offer: the table minus the two discontinued codes and
 * minus 99 (Centre jurisdiction is not a place a user is located in). Derived
 * from `GST_STATE_CODES` rather than hand-listed so the picker and the
 * validator cannot drift apart.
 */
export const GST_STATE_PICKER_CODES: readonly string[] = Object.keys(
  GST_STATE_CODES
)
  .filter(
    (code) => !DISCONTINUED_GST_STATE_CODES.includes(code) && code !== "99"
  )
  .sort();

/** State name for a code, or "" if the code is unassigned. */
export const stateNameFromCode = (
  code: string | null | undefined
): string => GST_STATE_CODES[normalizeGstin(code)] ?? "";

/** State name for a GSTIN, or "" if the GSTIN is not valid. */
export const stateNameFromGstin = (
  value: string | null | undefined
): string => stateNameFromCode(stateCodeFromGstin(value));
