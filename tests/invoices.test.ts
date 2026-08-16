import { describe, it, expect } from "bun:test";
import {
  calculateInvoiceTotals,
  mapInvoiceRecordToFormState,
  mapFormStateToPayload,
  getInvoiceStatus,
  formatCurrency,
  createDefaultInvoiceFormState,
  checkSupplierStateAgainstGstin,
  profileToSeed,
  type InvoiceRecord,
  type InvoiceFormState,
} from "@/lib/invoices";
import {
  GST_RATE_PICKER_VALUES,
  gstRateOptions,
  isAcceptedGstRate,
  isRetiredGstRate,
  isValidHsnSac,
  placeOfSupplyLabelFor,
} from "@/lib/gst-rates";

const items = (
  rows: Array<{ description?: string; quantity: number; unitPrice: number }>
) =>
  rows.map((r) => ({
    description: r.description ?? "Item",
    quantity: r.quantity,
    unitPrice: r.unitPrice,
  }));

describe("calculateInvoiceTotals", () => {
  it("sums line items and applies the standard formula", () => {
    const result = calculateInvoiceTotals({
      items: items([
        { quantity: 2, unitPrice: 100 },
        { quantity: 1, unitPrice: 50 },
      ]),
      discount: 25,
      cgst: 10,
      sgst: 10,
      convenienceCharge: 5,
    });
    expect(result.subtotal).toBe(250);
    // 250 - 25 + 10 + 10 + 5
    expect(result.total).toBe(250);
  });

  it("clamps an over-discounted total to 0 (never negative)", () => {
    const result = calculateInvoiceTotals({
      items: items([{ quantity: 1, unitPrice: 100 }]),
      discount: 150,
      cgst: 0,
      sgst: 0,
      convenienceCharge: 0,
    });
    expect(result.subtotal).toBe(100);
    expect(result.total).toBe(0);
  });

  it("clamps negative quantities and prices to 0 per line", () => {
    const result = calculateInvoiceTotals({
      items: items([
        { quantity: -5, unitPrice: 100 },
        { quantity: 2, unitPrice: -10 },
      ]),
      discount: 0,
      cgst: 0,
      sgst: 0,
      convenienceCharge: 0,
    });
    expect(result.subtotal).toBe(0);
    expect(result.total).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    const result = calculateInvoiceTotals({
      items: items([{ quantity: 3, unitPrice: 0.1 }]),
      discount: 0,
      cgst: 0,
      sgst: 0,
      convenienceCharge: 0,
    });
    expect(result.subtotal).toBe(0.3);
    expect(result.total).toBe(0.3);
  });
});

describe("mapInvoiceRecordToFormState (legacy tax fallback)", () => {
  const base: Partial<InvoiceRecord> = {
    companyName: "Acme",
    billTo: "Client",
    invoiceNumber: "INV-1",
    invoiceDate: "2026-01-01",
    dueDate: "2026-01-15",
    currency: "INR",
    items: [{ name: "Widget", price: 100, quantity: 2 }],
  };

  it("falls back to legacy `tax` when cgst is absent (un-migrated document)", () => {
    const form = mapInvoiceRecordToFormState({ ...base, tax: 18 });
    expect(form.cgst).toBe(18);
    expect(form.sgst).toBe(0);
  });

  it("prefers cgst over legacy tax when both exist", () => {
    const form = mapInvoiceRecordToFormState({ ...base, cgst: 9, tax: 18 });
    expect(form.cgst).toBe(9);
  });

  it("renames DB item fields (name/price) to form fields (description/unitPrice)", () => {
    const form = mapInvoiceRecordToFormState(base);
    expect(form.items[0]).toEqual({
      description: "Widget",
      quantity: 2,
      unitPrice: 100,
    });
  });
});

describe("mapFormStateToPayload", () => {
  it("trims strings and clamps numbers to non-negative", () => {
    const form: InvoiceFormState = {
      ...createDefaultInvoiceFormState(),
      companyName: "  Acme  ",
      discount: -5,
      items: [{ description: "  A  ", quantity: -2, unitPrice: -1 }],
    };
    const payload = mapFormStateToPayload(form);
    expect(payload.companyName).toBe("Acme");
    expect(payload.discount).toBe(0);
    expect(payload.items[0].quantity).toBe(1);
    expect(payload.items[0].unitPrice).toBe(0);
    expect(payload.items[0].description).toBe("A");
  });

  it("clamps numbers to the shared ceilings as well as the floors", () => {
    const form: InvoiceFormState = {
      ...createDefaultInvoiceFormState(),
      discount: 5_000_000_000,
      cgst: 5_000_000_000,
      items: [{ description: "A", quantity: 999_999, unitPrice: 500_000_000 }],
    };
    const payload = mapFormStateToPayload(form);
    expect(payload.items[0].quantity).toBe(100_000);
    expect(payload.items[0].unitPrice).toBe(100_000_000);
    expect(payload.discount).toBe(100_000_000);
    expect(payload.cgst).toBe(100_000_000);
  });

  it("keeps a fractional quantity — the assistant is allowed to set one", () => {
    const form: InvoiceFormState = {
      ...createDefaultInvoiceFormState(),
      items: [{ description: "A", quantity: 2.5, unitPrice: 10 }],
    };
    expect(mapFormStateToPayload(form).items[0].quantity).toBe(2.5);
  });
});

describe("getInvoiceStatus", () => {
  it("returns the explicit status when present", () => {
    expect(getInvoiceStatus({ status: "paid" })).toBe("paid");
  });

  it("infers overdue from a past due date when no status is set", () => {
    expect(getInvoiceStatus({ dueDate: "2000-01-01" })).toBe("overdue");
  });

  it("defaults to sent for a future due date when no status is set", () => {
    expect(getInvoiceStatus({ dueDate: "2999-01-01" })).toBe("sent");
  });
});

describe("formatCurrency", () => {
  it("formats zero and falsy amounts safely", () => {
    expect(formatCurrency(0, "USD")).toContain("0");
    expect(formatCurrency(NaN, "USD")).toContain("0");
  });
});

describe("GST fields on the mappers (Phase 2)", () => {
  const legacyRecord: Partial<InvoiceRecord> = {
    companyName: "Acme",
    billTo: "Client",
    invoiceNumber: "INV-1",
    invoiceDate: "2026-01-01",
    dueDate: "2026-01-15",
    currency: "INR",
    items: [{ name: "Widget", price: 100, quantity: 2 }],
    cgst: 9,
    sgst: 9,
  };

  it("leaves a pre-Phase-2 record without any GST fields at all", () => {
    // ABSENCE is the signal that keeps the legacy money formula in play. A
    // `taxTreatment: "none"` here would zero the tax the document carries.
    const form = mapInvoiceRecordToFormState(legacyRecord);
    expect("taxTreatment" in form).toBe(false);
    const payload = mapFormStateToPayload(form);
    expect("taxTreatment" in payload).toBe(false);
    expect("documentType" in payload).toBe(false);
    expect("supplyKind" in payload).toBe(false);
    expect(payload.cgst).toBe(9);
  });

  it("round-trips the GST fields and re-derives documentType and supplyKind", () => {
    const form = mapInvoiceRecordToFormState({
      ...legacyRecord,
      taxTreatment: "gst",
      supplierStateCode: "29",
      placeOfSupplyStateCode: "27",
      lutArn: "AD290123",
    });
    expect(form.taxTreatment).toBe("gst");
    expect(form.supplierStateCode).toBe("29");
    expect(form.recipientIsSez).toBe(false);

    const payload = mapFormStateToPayload(form);
    expect(payload.taxTreatment).toBe("gst");
    expect(payload.documentType).toBe("tax_invoice");
    expect(payload.supplyKind).toBe("inter");
  });

  it("derives sez even when the SEZ unit is in the supplier's own state", () => {
    const form = mapInvoiceRecordToFormState({
      ...legacyRecord,
      taxTreatment: "gst",
      supplierStateCode: "29",
      placeOfSupplyStateCode: "29",
      recipientIsSez: true,
    });
    expect(mapFormStateToPayload(form).supplyKind).toBe("sez");
  });

  it("round-trips the per-line GST fields without inventing them", () => {
    const form = mapInvoiceRecordToFormState({
      ...legacyRecord,
      items: [
        { name: "Consulting", price: 100, quantity: 1, hsnSac: "998314", taxRatePercent: 18 },
        { name: "Widget", price: 50, quantity: 1 },
      ],
    });
    expect(form.items[0].hsnSac).toBe("998314");
    expect(form.items[0].taxRatePercent).toBe(18);
    expect("hsnSac" in form.items[1]).toBe(false);
    expect("taxRatePercent" in form.items[1]).toBe(false);

    const payload = mapFormStateToPayload(form);
    expect(payload.items[0].taxRatePercent).toBe(18);
    expect("taxRatePercent" in payload.items[1]).toBe(false);
  });

  it("drives the live preview through the same path as the server", () => {
    const totals = calculateInvoiceTotals({
      items: items([{ quantity: 1, unitPrice: 1_000 }]).map((item) => ({
        ...item,
        taxRatePercent: 18,
      })),
      discount: 0,
      cgst: 0,
      sgst: 0,
      convenienceCharge: 0,
      taxTreatment: "gst",
      supplierStateCode: "29",
      placeOfSupplyStateCode: "27",
    });
    expect(totals.igst).toBe(180);
    expect(totals.cgst).toBe(0);
    expect(totals.taxRows).toHaveLength(1);
  });

  it("keeps the legacy preview on the flat amounts when there is no treatment", () => {
    const totals = calculateInvoiceTotals({
      items: items([{ quantity: 1, unitPrice: 1_000 }]),
      discount: 0,
      cgst: 90,
      sgst: 90,
      convenienceCharge: 0,
    });
    expect(totals.cgst).toBe(90);
    expect(totals.igst).toBe(0);
    expect(totals.total).toBe(1_180);
  });
});

describe("createDefaultInvoiceFormState — the GST defaults (Phase 2)", () => {
  it("gives a NEW invoice an explicit taxTreatment of none", () => {
    // Explicit, not absent: absence means "written before Phase 2". This is
    // only safe because the editor no longer has hand-typed CGST/SGST boxes to
    // silently zero.
    const form = createDefaultInvoiceFormState();
    expect(form.taxTreatment).toBe("none");
    expect(form.reverseCharge).toBe(false);
    expect(form.supplierStateCode).toBe("");
  });

  it("seeds the GST identity from a saved profile", () => {
    const form = createDefaultInvoiceFormState(
      profileToSeed({
        companyName: "Acme",
        taxTreatment: "gst",
        supplierStateCode: "29",
        lutArn: "AD290123456789A",
        defaultDueDays: 30,
      })
    );
    expect(form.companyName).toBe("Acme");
    expect(form.taxTreatment).toBe("gst");
    expect(form.supplierStateCode).toBe("29");
    expect(form.lutArn).toBe("AD290123456789A");
    // Intra-State is the common case, so the place of supply follows the
    // supplier's own state until the user moves it.
    expect(form.placeOfSupplyStateCode).toBe("29");
    expect(form.placeOfSupplyLabel).toBe("Karnataka");
  });

  it("falls back cleanly for a user with no profile at all", () => {
    const form = createDefaultInvoiceFormState(profileToSeed(null));
    expect(form.taxTreatment).toBe("none");
    expect(form.currency).toBe("INR");
    expect(form.placeOfSupplyStateCode).toBe("");
  });
});

describe("checkSupplierStateAgainstGstin (§5.9, caller-side)", () => {
  it("rejects a state that contradicts the GSTIN prefix", () => {
    expect(
      checkSupplierStateAgainstGstin({
        companyGstin: "29AAGCB7383J1Z4",
        supplierStateCode: "27",
        taxTreatment: "gst",
      })
    ).toBe("Your state must match the first two digits of your GSTIN.");
  });

  it("passes when they agree", () => {
    expect(
      checkSupplierStateAgainstGstin({
        companyGstin: "29AAGCB7383J1Z4",
        supplierStateCode: "29",
        taxTreatment: "gst",
      })
    ).toBeNull();
  });

  it("stays silent when there is nothing to compare, or nothing to compare it for", () => {
    // No GSTIN, an invalid GSTIN, no state, or a non-GST document: all cases
    // where this rule has no opinion. An invalid GSTIN is the profile form's
    // error to raise, not this one's.
    expect(
      checkSupplierStateAgainstGstin({ supplierStateCode: "27", taxTreatment: "gst" })
    ).toBeNull();
    expect(
      checkSupplierStateAgainstGstin({
        companyGstin: "NOPE",
        supplierStateCode: "27",
        taxTreatment: "gst",
      })
    ).toBeNull();
    expect(
      checkSupplierStateAgainstGstin({
        companyGstin: "29AAGCB7383J1Z4",
        supplierStateCode: "",
        taxTreatment: "gst",
      })
    ).toBeNull();
    expect(
      checkSupplierStateAgainstGstin({
        companyGstin: "29AAGCB7383J1Z4",
        supplierStateCode: "27",
        taxTreatment: "none",
      })
    ).toBeNull();
  });
});

describe("lib/gst-rates — the picker never offers a withdrawn slab", () => {
  it("offers 0, 0.25, 3, 5, 18 and 40 and nothing else", () => {
    expect(GST_RATE_PICKER_VALUES).toEqual([0, 0.25, 3, 5, 18, 40]);
    expect(GST_RATE_PICKER_VALUES).not.toContain(12);
    expect(GST_RATE_PICKER_VALUES).not.toContain(28);
    expect(gstRateOptions().map((option) => option.value)).not.toContain("12");
  });

  it("still SHOWS a stored retired rate, labelled as withdrawn", () => {
    // An issued document keeps the numbers it was issued with; an editor that
    // cannot display a value it loaded is worse than one that warns.
    const options = gstRateOptions(12);
    expect(options.map((option) => option.value)).toContain("12");
    expect(options.find((option) => option.value === "12")?.label).toBe(
      "12% (withdrawn)"
    );
    expect(isRetiredGstRate(12)).toBe(true);
    expect(isRetiredGstRate(18)).toBe(false);
  });

  it("accepts retired rates on read but rejects rates that never existed", () => {
    expect(isAcceptedGstRate(12)).toBe(true);
    expect(isAcceptedGstRate(18)).toBe(true);
    expect(isAcceptedGstRate(15)).toBe(false);
    expect(isAcceptedGstRate("18")).toBe(false);
  });

  it("validates HSN/SAC by FORMAT only — the digit count is turnover-based", () => {
    expect(isValidHsnSac("8471")).toBe(true);
    expect(isValidHsnSac("998314")).toBe(true);
    expect(isValidHsnSac("84713010")).toBe(true);
    expect(isValidHsnSac("99831")).toBe(false);
    expect(isValidHsnSac("99A314")).toBe(false);
    expect(isValidHsnSac(undefined)).toBe(false);
  });

  it("never prints the outside-India code as a code", () => {
    expect(placeOfSupplyLabelFor("96")).toBe("Outside India");
    expect(placeOfSupplyLabelFor("29")).toBe("Karnataka");
    expect(placeOfSupplyLabelFor("")).toBe("");
  });
});
