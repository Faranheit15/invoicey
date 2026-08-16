import mongoose, { Schema, Document } from "mongoose";
import type { TaxTreatment } from "@/lib/gst-supply";

/**
 * The seller side of an invoice, saved once per user.
 *
 * Why a separate collection rather than fields on `User`: `User` is the auth
 * aggregate — `lib/auth-user-sync.ts` is the single funnel that writes it, and
 * it is shaped by what Firebase hands back on sign-in. Invoicing defaults are
 * not auth state, they change on a different schedule, and mixing them would
 * put a business-configuration write path through the account-linking funnel.
 *
 * `is_deleted` is deliberately ABSENT. The repo's blanket rule is "nothing is
 * ever hard-deleted", and this is the documented exception: a business profile
 * is user-owned configuration, not a business record, so it carries no audit or
 * statutory retention duty. Account deletion should hard-delete it outright
 * (see the integration note in the route) — keeping a soft-deleted copy of
 * someone's address, GSTIN and PAN after they asked to be forgotten would be
 * the wrong default.
 *
 * The tax treatment union has exactly one definition, in `lib/gst-supply.ts`;
 * the alias below exists only so this module's consumers do not all have to
 * import from two places.
 */
export type BusinessProfileTaxTreatment = TaxTreatment;

export const BUSINESS_PROFILE_TAX_TREATMENTS: readonly BusinessProfileTaxTreatment[] =
  ["none", "gst", "composition"];

/**
 * The profile's data fields, with no Mongoose in sight.
 *
 * Split out from `IBusinessProfile` so it can be the wire shape as well: the
 * route returns exactly these keys and `lib/api-client.ts` re-exports the type
 * for the UI. That import MUST stay `import type` — this module pulls in
 * mongoose, and a value import would drag the driver into the browser bundle.
 */
export interface BusinessProfileFields {
  // Identity — printed in the "from" block of every invoice.
  companyName?: string;
  companyEmail?: string;
  companyPhone?: string;
  companyAddress?: string;
  companyLogo?: string;

  // GST identity. `supplierStateCode` is the first two digits of the GSTIN
  // whenever one is present; it exists separately because an unregistered user
  // still has a state, and place-of-supply (item 5) needs it either way.
  companyGstin?: string;
  companyPan?: string;
  supplierStateCode?: string;
  /**
   * Sticky default for new invoices. NO Mongoose `default:` — design decision
   * D5: absence must stay distinguishable from an explicit choice, or a
   * re-saved old document becomes indistinguishable from a new one.
   */
  taxTreatment?: BusinessProfileTaxTreatment;
  /** LUT ARN, for zero-rated exports/SEZ supplies without payment of tax. */
  lutArn?: string;

  /**
   * How the client actually pays. Structured, not free text, because the
   * exporter turns these into a printed bank block and a UPI QR, and both need
   * to know which value is which. The existing `defaultPaymentInfo` blob stays
   * — it is where anything that is not one of these five things goes.
   *
   * `upiVpa` is validated (`lib/upi.ts`) before it is stored: an invalid VPA
   * produces a QR that fails inside the client's banking app, which is worse
   * than printing no QR. Nothing here is a payment integration — the URI is
   * built offline and the client's own bank moves the money.
   */
  upiVpa?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankName?: string;

  // Invoice defaults.
  defaultCurrency?: string;
  defaultTerms?: string;
  defaultPaymentInfo?: string;
  /** Replaces the hardcoded +14 days in `createDefaultInvoiceFormState`. */
  defaultDueDays?: number;
  /** e.g. "INV/{FY}/{SEQ:3}" — consumed by item 4's numbering. */
  invoiceNumberPattern?: string;

  // Signature block (item 7).
  signatureLabel?: string;
  signatureImageUrl?: string;
}

export interface IBusinessProfile extends Document, BusinessProfileFields {
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

const BusinessProfileSchema: Schema = new Schema(
  {
    userId: { type: String, required: true },

    companyName: { type: String, default: "" },
    companyEmail: { type: String, default: "" },
    companyPhone: { type: String, default: "" },
    companyAddress: { type: String, default: "" },
    companyLogo: { type: String, default: "" },

    companyGstin: { type: String, uppercase: true, trim: true, default: "" },
    companyPan: { type: String, uppercase: true, trim: true, default: "" },
    supplierStateCode: { type: String, default: "" },
    taxTreatment: {
      type: String,
      enum: ["none", "gst", "composition"],
      // No `default` on purpose — see D5 above.
    },
    lutArn: { type: String, trim: true, default: "" },

    upiVpa: { type: String, lowercase: true, trim: true, default: "" },
    bankAccountName: { type: String, default: "" },
    bankAccountNumber: { type: String, trim: true, default: "" },
    bankIfsc: { type: String, uppercase: true, trim: true, default: "" },
    bankName: { type: String, default: "" },

    defaultCurrency: { type: String, default: "INR" },
    defaultTerms: { type: String, default: "" },
    defaultPaymentInfo: { type: String, default: "" },
    defaultDueDays: { type: Number, default: 14, min: 0, max: 365 },
    invoiceNumberPattern: { type: String, default: "" },

    signatureLabel: { type: String, default: "" },
    signatureImageUrl: { type: String, default: "" },
  },
  { timestamps: true }
);

// One profile per user. This is a correctness constraint, not an optimisation:
// the route upserts on `{ userId }`, and two documents for one user would make
// "which of my two profiles seeds this invoice" a coin toss.
BusinessProfileSchema.index({ userId: 1 }, { unique: true });

export default mongoose.models.BusinessProfile ||
  mongoose.model<IBusinessProfile>("BusinessProfile", BusinessProfileSchema);
