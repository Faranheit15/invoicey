import { describe, it, expect } from "bun:test";
import {
  BUSINESS_PROFILE_FIELDS_WITHHELD,
  INVOICE_FIELDS_WITHHELD,
  INVOICE_ITEM_FIELDS_WITHHELD,
  buildExportedBusinessProfile,
  buildExportedInvoice,
} from "@/lib/server/account-export";

/**
 * THE DRIFT GUARD.
 *
 * `lib/server/account-export.ts` is an allow-list, and it must stay one — a
 * `{ ...doc }` there would post a pre-migration user's Firebase refresh token
 * back over HTTP (see tests/account-export.test.ts). But an allow-list is only
 * correct on the day it is written. This one was written in Phase 1 and then
 * silently decayed: Phases 2 and 4 added GSTINs, PAN, IGST, taxable value,
 * round-off, TDS, the signature block, place of supply, the credit/debit-note
 * reference and the whole per-line tax breakdown to `models/Invoice.ts`, plus
 * an entire BusinessProfile collection holding the user's bank account, IFSC
 * and UPI VPA. None of it reached the export. Nothing failed. A GST-registered
 * user who followed the delete flow's own "download your data first" gate got a
 * file with no GSTIN, no HSN and no IGST in it, and then lost the originals.
 *
 * So the expected field set is DERIVED FROM THE MONGOOSE SCHEMA, never listed
 * by hand here — a hand-written list drifts exactly the way the allow-list did.
 * Every schema path must be either exported or named in the module's
 * `*_FIELDS_WITHHELD` list with a reason. Adding a field to `models/Invoice.ts`
 * or `models/BusinessProfile.ts` fails this file until someone decides which.
 *
 * WHY A SUBPROCESS. `tests/account-isolation.test.ts` calls
 * `mock.module("@/models/Invoice", ...)` with a fake model, and Bun's
 * `mock.module` is process-global and permanent for the run — importing the
 * model here would hand us that fake (its `.schema` is `undefined`) depending
 * on file order, which is precisely the order-dependence this repo has been
 * bitten by twice. Reading the schema out of a clean `bun` process is immune to
 * it, and to whatever the next test file decides to mock.
 */

interface SchemaPaths {
  invoice: string[];
  invoiceItem: string[];
  originalInvoice: string[];
  businessProfile: string[];
}

const REPO_ROOT = `${import.meta.dir}/..`;

const readSchemaPaths = (): SchemaPaths => {
  const script = `
    const invoice = (await import(${JSON.stringify(`${REPO_ROOT}/models/Invoice.ts`)})).default;
    const businessProfile = (await import(${JSON.stringify(`${REPO_ROOT}/models/BusinessProfile.ts`)})).default;
    const top = Object.keys(invoice.schema.paths);
    console.log(JSON.stringify({
      invoice: [...new Set(top.map((path) => path.split(".")[0]))],
      invoiceItem: Object.keys(invoice.schema.path("items").schema.paths),
      originalInvoice: top
        .filter((path) => path.startsWith("originalInvoice."))
        .map((path) => path.slice("originalInvoice.".length)),
      businessProfile: Object.keys(businessProfile.schema.paths),
    }));
  `;
  const result = Bun.spawnSync(["bun", "-e", script], { cwd: REPO_ROOT });
  const stdout = result.stdout.toString().trim();
  if (!result.success || !stdout) {
    throw new Error(
      `could not read the Mongoose schema paths: ${result.stderr.toString()}`
    );
  }
  // The model file may log; the JSON is the last line.
  return JSON.parse(stdout.split("\n").at(-1) as string) as SchemaPaths;
};

const paths = readSchemaPaths();

/**
 * Keys, not values. Every field is assigned unconditionally in the builder, so
 * `Object.keys` is the shape of the export regardless of what the document
 * happened to carry — an absent optional is `undefined`, which JSON drops.
 */
const exportedInvoiceKeys = Object.keys(
  buildExportedInvoice({
    items: [{}],
    originalInvoice: { invoiceNumber: "INV-1" },
  })
);
const exportedItemKeys = Object.keys(
  buildExportedInvoice({ items: [{}] }).items[0]
);
const exportedOriginalInvoiceKeys = Object.keys(
  buildExportedInvoice({ originalInvoice: { invoiceNumber: "INV-1" } })
    .originalInvoice as unknown as Record<string, unknown>
);
const exportedBusinessProfileKeys = Object.keys(
  buildExportedBusinessProfile({}) as unknown as Record<string, unknown>
);

/** `_id` is exported under a friendlier name; every other key matches a path. */
const RENAMED = { _id: "id" } as const;

const assertCovers = (
  schemaPaths: string[],
  exportedKeys: string[],
  withheld: readonly string[],
  what: string
) => {
  const covered = new Set([...exportedKeys, ...withheld]);
  const missing = schemaPaths.filter((path) => !covered.has(path));
  expect(
    missing,
    `${what}: these schema fields reach neither the export nor its withheld list — ` +
      `add them to lib/server/account-export.ts, or name them as withheld with a reason`
  ).toEqual([]);
};

describe("account export — the field set is derived from the schema", () => {
  it("reads real schema paths (the guard is not silently inert)", () => {
    expect(paths.invoice).toContain("companyGstin");
    expect(paths.invoiceItem).toContain("hsnSac");
    expect(paths.businessProfile).toContain("bankAccountNumber");
  });

  it("exports or explicitly withholds every Invoice field", () => {
    assertCovers(
      paths.invoice,
      exportedInvoiceKeys,
      INVOICE_FIELDS_WITHHELD,
      "Invoice"
    );
  });

  it("exports or explicitly withholds every line-item field", () => {
    assertCovers(
      paths.invoiceItem,
      exportedItemKeys,
      INVOICE_ITEM_FIELDS_WITHHELD,
      "Invoice.items"
    );
  });

  it("exports every field of the credit/debit-note reference", () => {
    assertCovers(
      paths.originalInvoice,
      exportedOriginalInvoiceKeys,
      [],
      "Invoice.originalInvoice"
    );
  });

  it("exports or explicitly withholds every BusinessProfile field", () => {
    assertCovers(
      paths.businessProfile,
      exportedBusinessProfileKeys,
      BUSINESS_PROFILE_FIELDS_WITHHELD,
      "BusinessProfile"
    );
  });

  it("withholds nothing that is not actually in the schema", () => {
    // Keeps the withheld list from rotting the other way: a field renamed or
    // dropped from the model must not leave a stale excuse behind.
    for (const field of INVOICE_FIELDS_WITHHELD) {
      expect(paths.invoice, `withheld Invoice.${field}`).toContain(field);
    }
    for (const field of INVOICE_ITEM_FIELDS_WITHHELD) {
      expect(paths.invoiceItem, `withheld Invoice.items.${field}`).toContain(field);
    }
    for (const field of BUSINESS_PROFILE_FIELDS_WITHHELD) {
      expect(paths.businessProfile, `withheld BusinessProfile.${field}`).toContain(
        field
      );
    }
  });

  it("exports no field the schema does not have", () => {
    const invoicePaths = new Set(paths.invoice);
    for (const key of exportedInvoiceKeys) {
      if (key === RENAMED._id) continue;
      expect(invoicePaths, `exported Invoice.${key}`).toContain(key);
    }
    const itemPaths = new Set(paths.invoiceItem);
    for (const key of exportedItemKeys) {
      expect(itemPaths, `exported Invoice.items.${key}`).toContain(key);
    }
    const profilePaths = new Set(paths.businessProfile);
    for (const key of exportedBusinessProfileKeys) {
      expect(profilePaths, `exported BusinessProfile.${key}`).toContain(key);
    }
  });
});

describe("account export — the fields Phase 1 dropped", () => {
  /** A GST-registered user's credit note, with every Phase 2/4 field set. */
  const creditNote = {
    _id: "inv-1",
    invoiceNumber: "CN/2026-27/003",
    financialYear: "2026-27",
    companyGstin: "27AAPFU0939F1ZV",
    companyPan: "AAPFU0939F",
    billToGstin: "29AAGCB1286Q1ZG",
    documentKind: "credit_note",
    documentType: "tax_invoice",
    taxTreatment: "gst",
    originalInvoice: {
      invoiceId: "inv-0",
      invoiceNumber: "INV/2026-27/012",
      invoiceDate: new Date("2026-05-01T00:00:00.000Z"),
    },
    reasonForIssue: "Scope reduced",
    igst: 180,
    taxableValue: 1000,
    roundOff: -0.4,
    tdsSection: "194J_professional",
    tdsRatePercent: 10,
    tdsAmount: 100,
    signatureLabel: "For Acme",
    signatureImageUrl: "https://example.com/sign.png",
    supplierStateCode: "27",
    placeOfSupplyStateCode: "29",
    placeOfSupplyLabel: "Karnataka",
    supplyKind: "inter",
    recipientIsSez: false,
    withPaymentOfTax: true,
    lutArn: "AD270526000123A",
    countryOfDestination: "IN",
    reverseCharge: false,
    items: [
      {
        name: "Consulting",
        price: 1000,
        quantity: 1,
        hsnSac: "998311",
        unit: "HRS",
        discount: 0,
        taxRatePercent: 18,
        taxableValue: 1000,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 180,
      },
    ],
  };

  const exported = buildExportedInvoice(creditNote);

  it("carries both parties' GSTINs and the supplier PAN", () => {
    expect(exported.companyGstin).toBe("27AAPFU0939F1ZV");
    expect(exported.companyPan).toBe("AAPFU0939F");
    expect(exported.billToGstin).toBe("29AAGCB1286Q1ZG");
  });

  it("distinguishes a credit note from an invoice, and names what it corrects", () => {
    expect(exported.documentKind).toBe("credit_note");
    expect(exported.originalInvoice?.invoiceNumber).toBe("INV/2026-27/012");
    expect(exported.reasonForIssue).toBe("Scope reduced");
    // An ordinary invoice stores the field ABSENT; the export keeps that.
    expect(buildExportedInvoice({}).documentKind).toBeUndefined();
  });

  it("carries IGST, taxable value, round-off and the TDS block", () => {
    expect(exported.igst).toBe(180);
    expect(exported.taxableValue).toBe(1000);
    expect(exported.roundOff).toBe(-0.4);
    expect(exported.tdsSection).toBe("194J_professional");
    expect(exported.tdsAmount).toBe(100);
  });

  it("carries the per-line HSN, unit and tax breakdown", () => {
    const [line] = exported.items;
    expect(line.hsnSac).toBe("998311");
    expect(line.unit).toBe("HRS");
    expect(line.taxRatePercent).toBe(18);
    expect(line.igstAmount).toBe(180);
    expect(line.taxableValue).toBe(1000);
  });

  it("carries the supply geography and the export declaration", () => {
    expect(exported.supplyKind).toBe("inter");
    expect(exported.placeOfSupplyStateCode).toBe("29");
    expect(exported.lutArn).toBe("AD270526000123A");
    expect(exported.withPaymentOfTax).toBe(true);
  });

  it("still drops anything the schema does not declare", () => {
    const withJunk = buildExportedInvoice({
      ...creditNote,
      someFutureSecret: "do-not-ship",
      items: [{ ...creditNote.items[0], internalCostPrice: 42 }],
    });
    expect(JSON.stringify(withJunk)).not.toContain("do-not-ship");
    expect(JSON.stringify(withJunk)).not.toContain("internalCostPrice");
  });
});

describe("account export — the business profile", () => {
  const profileDoc = {
    _id: "bp-1",
    __v: 0,
    userId: "user-A",
    companyName: "Acme Consulting",
    companyGstin: "27AAPFU0939F1ZV",
    companyPan: "AAPFU0939F",
    companyAddress: "12 MG Road, Pune",
    supplierStateCode: "27",
    taxTreatment: "gst",
    lutArn: "AD270526000123A",
    upiVpa: "acme@okhdfcbank",
    bankAccountName: "Acme Consulting",
    bankAccountNumber: "50100123456789",
    bankIfsc: "HDFC0000123",
    bankName: "HDFC Bank",
    defaultCurrency: "INR",
    defaultDueDays: 14,
    invoiceNumberPattern: "INV/{FY}/{SEQ:3}",
    signatureLabel: "For Acme Consulting",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  };

  it("ships the details the account delete destroys and cannot restore", () => {
    const profile = buildExportedBusinessProfile(profileDoc)!;
    expect(profile.companyGstin).toBe("27AAPFU0939F1ZV");
    expect(profile.companyPan).toBe("AAPFU0939F");
    expect(profile.bankAccountNumber).toBe("50100123456789");
    expect(profile.bankIfsc).toBe("HDFC0000123");
    expect(profile.upiVpa).toBe("acme@okhdfcbank");
    expect(profile.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("is null for a user who never saved one, not an empty object", () => {
    expect(buildExportedBusinessProfile(null)).toBeNull();
  });

  it("stays an allow-list — no spread, no plumbing, no unknown key", () => {
    const profile = buildExportedBusinessProfile({
      ...profileDoc,
      someFutureSecret: "do-not-ship",
    })!;
    const keys = Object.keys(profile);
    expect(keys).not.toContain("_id");
    expect(keys).not.toContain("__v");
    expect(keys).not.toContain("userId");
    expect(JSON.stringify(profile)).not.toContain("do-not-ship");
  });
});
