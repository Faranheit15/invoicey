import { describe, it, expect } from "bun:test";
import {
  DOCUMENT_TITLES,
  UTGST_STATE_CODES,
  deriveSupplyKind,
  documentTypeFor,
  inferLegacyTaxTreatment,
  isRetiredGstRate,
  isServiceHsnSac,
  resolveTaxPresentation,
  splitLineTax,
  type SupplyKind,
  type TaxTreatment,
} from "@/lib/gst-supply";

const ctx = (over: Partial<Parameters<typeof deriveSupplyKind>[0]> = {}) => ({
  supplierStateCode: "29",
  placeOfSupplyStateCode: "29",
  recipientIsSez: false,
  recipientIsOutsideIndia: false,
  ...over,
});

describe("deriveSupplyKind", () => {
  it("returns intra when the supplier's state is the place of supply", () => {
    expect(deriveSupplyKind(ctx({ placeOfSupplyStateCode: "29" }))).toBe("intra");
  });

  it("returns inter when the place of supply is another state", () => {
    expect(deriveSupplyKind(ctx({ placeOfSupplyStateCode: "27" }))).toBe("inter");
  });

  it("returns export when the recipient is outside India", () => {
    expect(deriveSupplyKind(ctx({ recipientIsOutsideIndia: true }))).toBe(
      "export"
    );
  });

  it("returns export for place of supply 96, even without the overseas flag", () => {
    expect(
      deriveSupplyKind(
        ctx({ placeOfSupplyStateCode: "96", recipientIsOutsideIndia: false })
      )
    ).toBe("export");
  });

  it("SEZ IS ALWAYS INTER-STATE — even when the SEZ is in the supplier's own state", () => {
    // IGST s.7(5)/s.8(1) proviso. This is the carve-out every implementation
    // misses, and the one a later "simplification" would delete first.
    expect(
      deriveSupplyKind(
        ctx({ placeOfSupplyStateCode: "29", recipientIsSez: true })
      )
    ).toBe("sez");
    expect(
      deriveSupplyKind(
        ctx({ placeOfSupplyStateCode: "27", recipientIsSez: true })
      )
    ).toBe("sez");
  });

  it("prefers export over SEZ when the data is contradictory", () => {
    // An SEZ unit is inside India, so both flags cannot be true. The function
    // stays total; validateInvoice is what makes the user resolve it.
    expect(
      deriveSupplyKind(ctx({ recipientIsSez: true, recipientIsOutsideIndia: true }))
    ).toBe("export");
  });

  it("falls back to intra when either code is unknown", () => {
    // Unreachable for a SAVED gst invoice (validateInvoice requires both), and
    // reachable in the live preview before the fields are filled.
    expect(deriveSupplyKind(ctx({ supplierStateCode: "" }))).toBe("intra");
    expect(deriveSupplyKind(ctx({ placeOfSupplyStateCode: "" }))).toBe("intra");
    expect(
      deriveSupplyKind(ctx({ supplierStateCode: "", placeOfSupplyStateCode: "" }))
    ).toBe("intra");
  });
});

describe("resolveTaxPresentation", () => {
  const base = {
    taxTreatment: "gst" as TaxTreatment,
    supplyKind: "intra" as SupplyKind,
    supplierStateCode: "29",
    withPaymentOfTax: false,
    reverseCharge: false,
  };
  const kinds: SupplyKind[] = ["intra", "inter", "export", "sez"];

  it("suppresses every tax row for an unregistered supplier, whatever the geography", () => {
    for (const supplyKind of kinds) {
      const p = resolveTaxPresentation({ ...base, taxTreatment: "none", supplyKind });
      expect(p.heads).toEqual([]);
      expect(p.suppressedBecause).toBe("unregistered");
    }
  });

  it("suppresses every tax row for a composition dealer, whatever the geography", () => {
    for (const supplyKind of kinds) {
      const p = resolveTaxPresentation({
        ...base,
        taxTreatment: "composition",
        supplyKind,
      });
      expect(p.heads).toEqual([]);
      expect(p.suppressedBecause).toBe("composition");
    }
  });

  it("reverse charge beats geography", () => {
    const p = resolveTaxPresentation({ ...base, reverseCharge: true });
    expect(p.heads).toEqual([]);
    expect(p.suppressedBecause).toBe("reverse_charge");
  });

  it("intra-State in a state with a legislature is CGST + SGST", () => {
    expect(resolveTaxPresentation({ ...base, supplierStateCode: "29" }).heads).toEqual([
      "cgst",
      "sgst",
    ]);
  });

  it("intra-State in a union territory WITHOUT a legislature is CGST + UTGST", () => {
    expect(resolveTaxPresentation({ ...base, supplierStateCode: "04" }).heads).toEqual([
      "cgst",
      "utgst",
    ]);
  });

  it("Delhi, Puducherry and J&K have legislatures, so they charge SGST", () => {
    for (const code of ["07", "34", "01"]) {
      expect(
        resolveTaxPresentation({ ...base, supplierStateCode: code }).heads
      ).toEqual(["cgst", "sgst"]);
      expect(UTGST_STATE_CODES.has(code)).toBe(false);
    }
  });

  it("inter-State is IGST and never CGST or SGST", () => {
    const p = resolveTaxPresentation({ ...base, supplyKind: "inter" });
    expect(p.heads).toEqual(["igst"]);
    expect(p.suppressedBecause).toBeNull();
  });

  it("SEZ with payment of tax is IGST even for an in-state supplier", () => {
    expect(
      resolveTaxPresentation({
        ...base,
        supplyKind: "sez",
        withPaymentOfTax: true,
      }).heads
    ).toEqual(["igst"]);
  });

  it("export under LUT shows no tax rows at all", () => {
    const p = resolveTaxPresentation({
      ...base,
      supplyKind: "export",
      withPaymentOfTax: false,
    });
    expect(p.heads).toEqual([]);
    expect(p.suppressedBecause).toBe("zero_rated_lut");
  });

  it("never emits an impossible head set over the whole cross-product", () => {
    const treatments: TaxTreatment[] = ["none", "gst", "composition"];
    for (const taxTreatment of treatments) {
      for (const supplyKind of kinds) {
        for (const withPaymentOfTax of [true, false]) {
          for (const reverseCharge of [true, false]) {
            for (const supplierStateCode of ["29", "04", "07", ""]) {
              const { heads } = resolveTaxPresentation({
                taxTreatment,
                supplyKind,
                supplierStateCode,
                withPaymentOfTax,
                reverseCharge,
              });
              expect(heads.length).toBeLessThan(3);
              expect(heads.includes("igst") && heads.includes("cgst")).toBe(false);
              expect(heads.includes("sgst") && heads.includes("utgst")).toBe(false);
            }
          }
        }
      }
    }
  });
});

describe("splitLineTax", () => {
  it("halves the rate for an intra-State supply", () => {
    expect(
      splitLineTax({ taxableValue: 1000, ratePercent: 18, kind: "intra" })
    ).toEqual({ cgst: 90, sgst: 90, igst: 0 });
  });

  it("charges the FULL rate as IGST for an inter-State supply", () => {
    expect(
      splitLineTax({ taxableValue: 1000, ratePercent: 18, kind: "inter" })
    ).toEqual({ cgst: 0, sgst: 0, igst: 180 });
  });

  it("rounds the half and then doubles it, so the halves stay equal", () => {
    // 1000.05 * 9% = 90.0045 -> 90.00 each. cgst + sgst is 180.00 while the
    // full-rate figure is 180.01. Equal halves beat an exact sum: unequal
    // CGST/SGST is a reporting red flag in GSTR-1.
    const tax = splitLineTax({
      taxableValue: 1000.05,
      ratePercent: 18,
      kind: "intra",
    });
    expect(tax.cgst).toBe(90);
    expect(tax.sgst).toBe(90);
    expect(Number((tax.cgst + tax.sgst).toFixed(2))).toBe(180);
    expect(Number(((1000.05 * 18) / 100).toFixed(2))).toBe(180.01);
  });

  it("charges nothing on an export or SEZ supply under LUT", () => {
    for (const kind of ["export", "sez"] as SupplyKind[]) {
      expect(
        splitLineTax({ taxableValue: 1000, ratePercent: 18, kind })
      ).toEqual({ cgst: 0, sgst: 0, igst: 0 });
      expect(
        splitLineTax({
          taxableValue: 1000,
          ratePercent: 18,
          kind,
          withPaymentOfTax: false,
        })
      ).toEqual({ cgst: 0, sgst: 0, igst: 0 });
    }
  });

  it("charges full IGST on an export or SEZ supply WITH payment of tax", () => {
    for (const kind of ["export", "sez"] as SupplyKind[]) {
      expect(
        splitLineTax({
          taxableValue: 1000,
          ratePercent: 18,
          kind,
          withPaymentOfTax: true,
        })
      ).toEqual({ cgst: 0, sgst: 0, igst: 180 });
    }
  });

  it("returns zeros for every degenerate input rather than throwing", () => {
    const kinds: SupplyKind[] = ["intra", "inter", "export", "sez"];
    const degenerate = [
      { taxableValue: 1000, ratePercent: 0 },
      { taxableValue: 0, ratePercent: 18 },
      { taxableValue: -5, ratePercent: 18 },
      { taxableValue: 1000, ratePercent: -18 },
      { taxableValue: Number.NaN, ratePercent: 18 },
      { taxableValue: 1000, ratePercent: Number.NaN },
      { taxableValue: Number.POSITIVE_INFINITY, ratePercent: 18 },
      { taxableValue: 1000, ratePercent: Number.POSITIVE_INFINITY },
    ];
    for (const kind of kinds) {
      for (const input of degenerate) {
        expect(
          splitLineTax({ ...input, kind, withPaymentOfTax: true })
        ).toEqual({ cgst: 0, sgst: 0, igst: 0 });
      }
    }
  });

  it("never charges IGST alongside CGST or SGST, at any rate or kind", () => {
    const kinds: SupplyKind[] = ["intra", "inter", "export", "sez"];
    for (const kind of kinds) {
      for (const ratePercent of [0, 0.25, 3, 5, 12, 18, 28, 40]) {
        for (const withPaymentOfTax of [true, false]) {
          const tax = splitLineTax({
            taxableValue: 1234.56,
            ratePercent,
            kind,
            withPaymentOfTax,
          });
          expect(tax.igst > 0 && (tax.cgst > 0 || tax.sgst > 0)).toBe(false);
        }
      }
    }
  });
});

describe("inferLegacyTaxTreatment", () => {
  it("treats a document with no tax at all as unregistered", () => {
    expect(inferLegacyTaxTreatment({})).toBe("none");
    expect(inferLegacyTaxTreatment({ cgst: 0, sgst: 0 })).toBe("none");
    expect(inferLegacyTaxTreatment({ cgst: 0, sgst: 0, tax: 0 })).toBe("none");
  });

  it("treats a document that carried tax as gst, so its rows survive verbatim", () => {
    expect(inferLegacyTaxTreatment({ cgst: 9 })).toBe("gst");
    expect(inferLegacyTaxTreatment({ sgst: 9 })).toBe("gst");
    // The pre-migration single `tax` field counts too.
    expect(inferLegacyTaxTreatment({ tax: 18 })).toBe("gst");
  });
});

describe("documentTypeFor / DOCUMENT_TITLES", () => {
  it("maps each treatment to the heading the law requires", () => {
    expect(DOCUMENT_TITLES[documentTypeFor("none")]).toBe("INVOICE");
    expect(DOCUMENT_TITLES[documentTypeFor("gst")]).toBe("TAX INVOICE");
    expect(DOCUMENT_TITLES[documentTypeFor("composition")]).toBe(
      "BILL OF SUPPLY"
    );
  });
});

describe("small predicates", () => {
  it("identifies a SAC by its leading 99", () => {
    expect(isServiceHsnSac("998314")).toBe(true);
    expect(isServiceHsnSac("8471")).toBe(false);
    expect(isServiceHsnSac(undefined)).toBe(false);
  });

  it("knows which rates GST 2.0 withdrew on 22 Sep 2025", () => {
    expect(isRetiredGstRate(12)).toBe(true);
    expect(isRetiredGstRate(28)).toBe(true);
    expect(isRetiredGstRate(18)).toBe(false);
    expect(isRetiredGstRate(40)).toBe(false);
  });
});
