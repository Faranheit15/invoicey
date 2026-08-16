import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import BusinessProfile, {
  BUSINESS_PROFILE_TAX_TREATMENTS,
  type BusinessProfileFields,
  type BusinessProfileTaxTreatment,
} from "@/models/BusinessProfile";
import { requireUser, authErrorResponse } from "@/lib/server/auth";
import {
  isValidGstin,
  isValidPan,
  normalizeGstin,
  panFromGstin,
  stateCodeFromGstin,
  GST_STATE_CODES,
} from "@/lib/gstin";
import { CURRENCY_OPTIONS } from "@/lib/invoices";
import {
  isValidAccountNumber,
  isValidIfsc,
  isValidVpa,
  normalizeAccountNumber,
  normalizeIfsc,
  normalizeVpa,
} from "@/lib/upi";
import { recordActivity, logRouteError } from "@/lib/server/log";

/**
 * The business profile: one document per user, read on every new invoice.
 *
 * Three rules this file exists to keep:
 *
 *  1. `userId` comes from `requireUser(req)` — the verified Firebase token —
 *     and from nowhere else. A `userId` in the body is ignored, exactly as the
 *     invoice route ignores one.
 *  2. GET never 404s. Having no profile yet is the normal state for every user
 *     who has not visited the page, and a 404 would make every caller special-
 *     case a cold start. It returns a fully-defaulted shape plus `exists:false`.
 *  3. Errors are bare. No exception text reaches the client.
 */

const PROFILE_AUTH_MESSAGES = {
  EmailNotVerified: "Please verify your email before editing your business profile.",
} as const;

/** Free-text caps. A profile is small by construction; nothing here is a document. */
const MAX_SHORT = 200;
const MAX_ADDRESS = 1000;
const MAX_LONG = 2000;
const MAX_URL = 2000;

export const MIN_DUE_DAYS = 0;
export const MAX_DUE_DAYS = 365;
export const DEFAULT_DUE_DAYS = 14;

interface RawBusinessProfile {
  companyName?: unknown;
  companyEmail?: unknown;
  companyPhone?: unknown;
  companyAddress?: unknown;
  companyLogo?: unknown;
  companyGstin?: unknown;
  companyPan?: unknown;
  supplierStateCode?: unknown;
  taxTreatment?: unknown;
  lutArn?: unknown;
  upiVpa?: unknown;
  bankAccountName?: unknown;
  bankAccountNumber?: unknown;
  bankIfsc?: unknown;
  bankName?: unknown;
  defaultCurrency?: unknown;
  defaultTerms?: unknown;
  defaultPaymentInfo?: unknown;
  defaultDueDays?: unknown;
  invoiceNumberPattern?: unknown;
  signatureLabel?: unknown;
  signatureImageUrl?: unknown;
}

export interface BusinessProfileResponse {
  profile: Required<BusinessProfileFields>;
  /** false when the user has never saved one. The shape is the same either way. */
  exists: boolean;
}

/** What GET returns before the user has ever saved. Every key present, all empty. */
export const emptyBusinessProfile = (): Required<BusinessProfileFields> => ({
  companyName: "",
  companyEmail: "",
  companyPhone: "",
  companyAddress: "",
  companyLogo: "",
  companyGstin: "",
  companyPan: "",
  supplierStateCode: "",
  taxTreatment: "none",
  lutArn: "",
  upiVpa: "",
  bankAccountName: "",
  bankAccountNumber: "",
  bankIfsc: "",
  bankName: "",
  defaultCurrency: "INR",
  defaultTerms: "",
  defaultPaymentInfo: "",
  defaultDueDays: DEFAULT_DUE_DAYS,
  invoiceNumberPattern: "",
  signatureLabel: "",
  signatureImageUrl: "",
});

const cleanString = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/**
 * Protocol allowlist for the logo and signature images, mirroring the exporter's
 * `toSafeImageUrl`: an image URL is interpolated into the printed HTML, and
 * `javascript:` in an `<img src>` is not a hypothetical. Storing only safe
 * values means the exporter's own guard is defence in depth rather than the
 * only line.
 */
const cleanImageUrl = (value: unknown): string => {
  const raw = cleanString(value, MAX_URL);
  if (!raw) return "";
  if (raw.startsWith("/")) return raw;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") return raw;
  if (parsed.protocol === "data:" && /^data:image\//i.test(raw)) return raw;
  return "";
};

const clampDueDays = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DUE_DAYS;
  return Math.min(MAX_DUE_DAYS, Math.max(MIN_DUE_DAYS, Math.round(parsed)));
};

/**
 * Normalize an untrusted body into exactly the stored shape.
 *
 * Returns an error string instead of throwing so the caller can answer 400 with
 * copy the user can act on. Normalisation (trim/upper) and rejection are kept
 * separate, as they are in the invoice route: a lowercased pasted GSTIN is
 * corrected, a wrong one is refused.
 */
export const normalizeBusinessProfile = (
  raw: RawBusinessProfile
): { profile: Required<BusinessProfileFields> } | { error: string } => {
  const companyGstin = normalizeGstin(
    typeof raw.companyGstin === "string" ? raw.companyGstin : ""
  );
  if (companyGstin && !isValidGstin(companyGstin)) {
    return { error: "That GSTIN is not valid. Check the 15 characters." };
  }

  // A GSTIN carries the state code and the PAN inside it, so when one is
  // present it is the authority for both — a user cannot claim Karnataka on a
  // Maharashtra registration, and never has to type their PAN at all.
  let supplierStateCode = companyGstin
    ? stateCodeFromGstin(companyGstin)
    : cleanString(raw.supplierStateCode, 2);
  if (supplierStateCode && !GST_STATE_CODES[supplierStateCode]) {
    return { error: "That state code is not a GST state code." };
  }
  supplierStateCode = supplierStateCode || "";

  let companyPan = companyGstin
    ? panFromGstin(companyGstin)
    : normalizeGstin(typeof raw.companyPan === "string" ? raw.companyPan : "");
  if (companyPan && !isValidPan(companyPan)) {
    return { error: "That PAN is not valid. It should look like AAAAA1111A." };
  }
  companyPan = companyPan || "";

  // Registration is derived, never asked (research: do not make the user answer
  // "are you registered?"). Composition is the one thing a GSTIN cannot tell us
  // — a composition dealer holds an ordinary GSTIN — so it stays an opt-in.
  const requested = raw.taxTreatment;
  const explicit =
    typeof requested === "string" &&
    (BUSINESS_PROFILE_TAX_TREATMENTS as string[]).includes(requested)
      ? (requested as BusinessProfileTaxTreatment)
      : "none";
  const taxTreatment: BusinessProfileTaxTreatment = companyGstin
    ? explicit === "composition"
      ? "composition"
      : "gst"
    : "none";

  // Payment identity. Each of the three validated ones is REFUSED rather than
  // silently dropped: a user who mistypes their VPA and is told nothing would
  // print invoices with no QR and never learn why. The normalise-then-reject
  // split is the same as the GSTIN's — a pasted "ACME@OKHDFCBANK" is corrected,
  // an "acme@" is refused.
  const upiVpa = normalizeVpa(
    typeof raw.upiVpa === "string" ? raw.upiVpa : ""
  ).slice(0, MAX_SHORT);
  if (upiVpa && !isValidVpa(upiVpa)) {
    return {
      error: "That UPI ID is not valid. It should look like yourname@bank.",
    };
  }

  const bankIfsc = normalizeIfsc(
    typeof raw.bankIfsc === "string" ? raw.bankIfsc : ""
  ).slice(0, 16);
  if (bankIfsc && !isValidIfsc(bankIfsc)) {
    return { error: "That IFSC is not valid. It should look like HDFC0000123." };
  }

  const bankAccountNumber = normalizeAccountNumber(
    typeof raw.bankAccountNumber === "string" ? raw.bankAccountNumber : ""
  ).slice(0, 20);
  if (bankAccountNumber && !isValidAccountNumber(bankAccountNumber)) {
    return { error: "That account number should be 6 to 20 digits." };
  }

  const currency = cleanString(raw.defaultCurrency, 8).toUpperCase();

  return {
    profile: {
      companyName: cleanString(raw.companyName, MAX_SHORT),
      companyEmail: cleanString(raw.companyEmail, MAX_SHORT),
      companyPhone: cleanString(raw.companyPhone, MAX_SHORT),
      companyAddress: cleanString(raw.companyAddress, MAX_ADDRESS),
      companyLogo: cleanImageUrl(raw.companyLogo),
      companyGstin,
      companyPan,
      supplierStateCode,
      taxTreatment,
      lutArn: cleanString(raw.lutArn, MAX_SHORT).toUpperCase(),
      upiVpa,
      bankAccountName: cleanString(raw.bankAccountName, MAX_SHORT),
      bankAccountNumber,
      bankIfsc,
      bankName: cleanString(raw.bankName, MAX_SHORT),
      defaultCurrency: CURRENCY_OPTIONS.includes(currency) ? currency : "INR",
      defaultTerms: cleanString(raw.defaultTerms, MAX_LONG),
      defaultPaymentInfo: cleanString(raw.defaultPaymentInfo, MAX_LONG),
      defaultDueDays: clampDueDays(raw.defaultDueDays),
      invoiceNumberPattern: cleanString(raw.invoiceNumberPattern, 64),
      signatureLabel: cleanString(raw.signatureLabel, MAX_SHORT),
      signatureImageUrl: cleanImageUrl(raw.signatureImageUrl),
    },
  };
};

/** Project a stored document onto the wire shape, filling anything absent. */
const toResponseShape = (
  doc: Partial<BusinessProfileFields> | null
): Required<BusinessProfileFields> => {
  const empty = emptyBusinessProfile();
  if (!doc) return empty;
  return {
    ...empty,
    ...(Object.fromEntries(
      Object.keys(empty)
        .filter((key) => doc[key as keyof BusinessProfileFields] !== undefined)
        .filter((key) => doc[key as keyof BusinessProfileFields] !== null)
        .map((key) => [key, doc[key as keyof BusinessProfileFields]])
    ) as Partial<Required<BusinessProfileFields>>),
  };
};

export async function GET(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await requireUser(req);
  } catch (error: unknown) {
    return authErrorResponse(error, PROFILE_AUTH_MESSAGES);
  }

  await connectDB();
  try {
    const doc = (await BusinessProfile.findOne({
      userId: userUid,
    }).lean()) as Partial<BusinessProfileFields> | null;

    return NextResponse.json({
      profile: toResponseShape(doc),
      exists: Boolean(doc),
    } satisfies BusinessProfileResponse);
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "GET /api/profile",
      userId: userUid,
      category: "system",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

/**
 * Upsert the caller's profile.
 *
 * One handler for both verbs: there is no create-vs-update distinction to
 * express here (a user has exactly one profile, whether or not the row exists
 * yet), so POST would otherwise be a 409-generating trap for a client that
 * saved twice. `upsert: true` on `{ userId }` plus the unique index makes a
 * concurrent double-save converge on one document instead of two.
 */
const upsertProfile = async (req: NextRequest) => {
  let userUid: string;
  try {
    userUid = await requireUser(req);
  } catch (error: unknown) {
    return authErrorResponse(error, PROFILE_AUTH_MESSAGES);
  }

  await connectDB();
  try {
    let raw: RawBusinessProfile;
    try {
      raw = ((await req.json()) ?? {}) as RawBusinessProfile;
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const normalized = normalizeBusinessProfile(raw);
    if ("error" in normalized) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const doc = (await BusinessProfile.findOneAndUpdate(
      { userId: userUid },
      { $set: { ...normalized.profile, userId: userUid } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()) as Partial<BusinessProfileFields> | null;

    recordActivity({
      userId: userUid,
      type: "business_profile_saved",
      meta: { hasGstin: Boolean(normalized.profile.companyGstin) },
    });

    return NextResponse.json({
      message: "Saved. New invoices will start with these details.",
      profile: toResponseShape(doc ?? normalized.profile),
      exists: true,
    });
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "PUT /api/profile",
      userId: userUid,
      category: "system",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
};

export async function PUT(req: NextRequest) {
  return upsertProfile(req);
}

export async function POST(req: NextRequest) {
  return upsertProfile(req);
}
