import { describe, it, expect } from "bun:test";
import {
  buildTotalsRows,
  computeTotals,
  resolveRecordAmounts,
  roundToRupee,
  validateInvoice,
  validateInvoiceDetailed,
  type InvoiceTotals,
  type TotalsTaxContext,
} from "@/lib/invoice-domain";
import type { SupplyKind, TaxTreatment } from "@/lib/gst-supply";
import type { InvoiceRecord } from "@/lib/invoices";

const derived = (
  over: Partial<Extract<TotalsTaxContext, { mode: "derived" }>> = {}
): TotalsTaxContext => ({
  mode: "derived",
  supplyKind: "intra",
  supplierStateCode: "29",
  withPaymentOfTax: false,
  ...over,
});

describe("computeTotals — legacy mode (pre-Phase-2 documents)", () => {
  it("applies the standard formula and clamps at 0", () => {
    expect(
      computeTotals({
        items: [{ quantity: 2, unitPrice: 100 }],
        discount: 250,
        cgst: 0,
        sgst: 0,
        convenienceCharge: 0,
      }).total
    ).toBe(0);
  });

  it("lets a line contribute nothing while its quantity box is empty", () => {
    // Clearing a Qty field publishes the field minimum, but a zero can still
    // reach the formula (typed, or from a record); it must not go negative.
    const totals = computeTotals({
      items: [
        { quantity: 0, unitPrice: 250 },
        { quantity: 2, unitPrice: 100 },
      ],
      discount: 0,
      cgst: 0,
      sgst: 0,
      convenienceCharge: 0,
    });
    expect(totals.subtotal).toBe(200);
    expect(totals.total).toBe(200);
  });

  it("matches the previous inline server formula for a normal invoice", () => {
    // THE regression that must never go red: no `tax` context, flat cgst/sgst,
    // and the six original numbers come out unchanged. The additive fields are
    // asserted here too, because `toEqual` is exact and the exactness is what
    // pins the contract.
    const t = computeTotals({
      items: [
        { quantity: 2, unitPrice: 100 },
        { quantity: 1, unitPrice: 50 },
      ],
      discount: 25,
      cgst: 10,
      sgst: 10,
      convenienceCharge: 5,
    });
    expect(t).toEqual({
      subtotal: 250,
      discount: 25,
      taxableValue: 225,
      lines: [
        {
          gross: 200,
          lineDiscount: 0,
          apportioned: 20,
          taxable: 180,
          ratePercent: 0,
          tax: { cgst: 0, sgst: 0, igst: 0 },
        },
        {
          gross: 50,
          lineDiscount: 0,
          apportioned: 5,
          taxable: 45,
          ratePercent: 0,
          tax: { cgst: 0, sgst: 0, igst: 0 },
        },
      ],
      taxRows: [
        { head: "cgst", label: "CGST", amount: 10 },
        { head: "sgst", label: "SGST", amount: 10 },
      ],
      cgst: 10,
      sgst: 10,
      igst: 0,
      convenienceCharge: 5,
      roundOff: 0,
      total: 250,
      suppressedBecause: null,
    });
  });

  it("keeps BOTH legacy tax rows when the document carried tax, zeros included", () => {
    const t = computeTotals({
      items: [{ quantity: 1, unitPrice: 100 }],
      discount: 0,
      cgst: 18,
      sgst: 0,
      convenienceCharge: 0,
    });
    expect(t.taxRows.map((row) => row.label)).toEqual(["CGST", "SGST"]);
    expect(t.taxRows[1].amount).toBe(0);
  });

  it("drops the two placeholder rows when the legacy document had no tax", () => {
    const t = computeTotals({
      items: [{ quantity: 1, unitPrice: 100 }],
      discount: 0,
      cgst: 0,
      sgst: 0,
      convenienceCharge: 0,
    });
    expect(t.taxRows).toEqual([]);
    expect(buildTotalsRows(t).map((row) => row.label)).toEqual([
      "Subtotal",
      "Discount",
      "Service Charge",
      "Total",
    ]);
  });

  it("never rounds a legacy total to the rupee", () => {
    const t = computeTotals({
      items: [{ quantity: 3, unitPrice: 0.1 }],
      discount: 0,
      cgst: 0,
      sgst: 0,
      convenienceCharge: 0,
    });
    expect(t.total).toBe(0.3);
    expect(t.roundOff).toBe(0);
  });
});

describe("computeTotals — derived mode", () => {
  it("splits a single-rate intra-State invoice into equal CGST and SGST", () => {
    const t = computeTotals({
      items: [
        { quantity: 1, unitPrice: 50_000, taxRatePercent: 18 },
        { quantity: 1, unitPrice: 2_000, taxRatePercent: 0 },
      ],
      discount: 0,
      convenienceCharge: 0,
      tax: derived(),
    });
    expect(t.taxableValue).toBe(52_000);
    expect(t.cgst).toBe(4_500);
    expect(t.sgst).toBe(4_500);
    expect(t.igst).toBe(0);
    expect(t.total).toBe(61_000);
    expect(t.taxRows.map((row) => row.label)).toEqual([
      "CGST @ 9%",
      "SGST @ 9%",
    ]);
  });

  it("charges the same invoice as IGST when it crosses a state line", () => {
    const t = computeTotals({
      items: [
        { quantity: 1, unitPrice: 50_000, taxRatePercent: 18 },
        { quantity: 1, unitPrice: 2_000, taxRatePercent: 0 },
      ],
      discount: 0,
      convenienceCharge: 0,
      tax: derived({ supplyKind: "inter" }),
    });
    expect(t.igst).toBe(9_000);
    expect(t.cgst).toBe(0);
    expect(t.sgst).toBe(0);
    expect(t.taxRows).toHaveLength(1);
    expect(t.taxRows[0]).toEqual({ head: "igst", label: "IGST @ 18%", amount: 9_000 });
    expect(t.total).toBe(61_000);
  });

  it("drops the rate suffix on a mixed-rate invoice", () => {
    // Rule 46(k) is satisfied by the per-line rate column, not by the totals
    // block, so naming one rate up there would be a lie.
    const t = computeTotals({
      items: [
        { quantity: 1, unitPrice: 1_000, taxRatePercent: 18 },
        { quantity: 1, unitPrice: 1_000, taxRatePercent: 5 },
      ],
      discount: 0,
      convenienceCharge: 0,
      tax: derived(),
    });
    expect(t.taxRows.map((row) => row.label)).toEqual(["CGST", "SGST"]);
  });

  it("carries UTGST in the sgst slot for a union territory without a legislature", () => {
    const t = computeTotals({
      items: [{ quantity: 1, unitPrice: 1_000, taxRatePercent: 18 }],
      discount: 0,
      convenienceCharge: 0,
      tax: derived({ supplierStateCode: "04" }),
    });
    // The FIELD NAME LIES: `sgst` holds the UTGST amount. Only the label differs.
    expect(t.sgst).toBe(90);
    expect(t.taxRows[1].head).toBe("utgst");
    expect(t.taxRows[1].label.startsWith("UTGST")).toBe(true);
    expect(t.taxRows[1].amount).toBe(90);
  });

  it("charges nothing on an export under LUT, whatever rate the lines carry", () => {
    const t = computeTotals({
      items: [{ quantity: 1, unitPrice: 1_000, taxRatePercent: 18 }],
      discount: 0,
      convenienceCharge: 0,
      tax: derived({ supplyKind: "export", withPaymentOfTax: false }),
    });
    expect(t.cgst + t.sgst + t.igst).toBe(0);
    expect(t.taxRows).toEqual([]);
    expect(t.suppressedBecause).toBe("zero_rated_lut");
    expect(t.total).toBe(1_000);
  });

  it("charges full IGST on an export with payment of tax", () => {
    const t = computeTotals({
      items: [{ quantity: 1, unitPrice: 1_000, taxRatePercent: 18 }],
      discount: 0,
      convenienceCharge: 0,
      tax: derived({ supplyKind: "export", withPaymentOfTax: true }),
    });
    expect(t.igst).toBe(180);
    expect(t.suppressedBecause).toBeNull();
  });

  it("prefers a stored per-line split over recomputing it", () => {
    // An issued document must keep the numbers it was issued with, whatever a
    // later edit to the rate table says.
    const t = computeTotals({
      items: [
        {
          quantity: 1,
          unitPrice: 1_000,
          taxRatePercent: 18,
          storedTax: { cgst: 60, sgst: 60, igst: 0 },
        },
      ],
      discount: 0,
      convenienceCharge: 0,
      tax: derived(),
    });
    expect(t.cgst).toBe(60);
    expect(t.sgst).toBe(60);
  });
});

describe("computeTotals — discount apportionment", () => {
  it("splits an invoice discount pro-rata and taxes the reduced value", () => {
    const t = computeTotals({
      items: [
        { quantity: 1, unitPrice: 1_000, taxRatePercent: 18 },
        { quantity: 1, unitPrice: 1_000, taxRatePercent: 5 },
      ],
      discount: 200,
      convenienceCharge: 0,
      tax: derived(),
    });
    expect(t.lines.map((line) => line.apportioned)).toEqual([100, 100]);
    expect(t.lines.map((line) => line.taxable)).toEqual([900, 900]);
    expect(t.taxableValue).toBe(1_800);
    // round2(900 * 18/200) + round2(900 * 5/200) = 81 + 22.5
    expect(t.cgst).toBe(103.5);
    expect(t.sgst).toBe(103.5);
    expect(t.total).toBe(2_007);
  });

  it("gives the residual to the last non-zero line so no paisa is lost", () => {
    // Naive pro-rata gives 33.33 x 3 = 99.99 and the printed Discount row then
    // disagrees with the sum of the line reductions by a paisa.
    const t = computeTotals({
      items: [
        { quantity: 1, unitPrice: 1_000, taxRatePercent: 18 },
        { quantity: 1, unitPrice: 1_000, taxRatePercent: 18 },
        { quantity: 1, unitPrice: 1_000, taxRatePercent: 18 },
      ],
      discount: 100,
      convenienceCharge: 0,
      tax: derived(),
    });
    expect(t.lines.map((line) => line.apportioned)).toEqual([33.33, 33.33, 33.34]);
    const apportionedSum = Number(
      t.lines.reduce((sum, line) => sum + line.apportioned, 0).toFixed(2)
    );
    expect(apportionedSum).toBe(100);
    expect(t.discount).toBe(100);
  });

  it("keeps the printed Discount row equal to the sum of the line reductions", () => {
    // The invariant, over a spread of awkward splits.
    const cases: Array<{ prices: number[]; discount: number }> = [
      { prices: [1_000, 1_000, 1_000], discount: 100 },
      { prices: [999.99, 0.01], discount: 33.33 },
      { prices: [10, 20, 30, 40], discount: 7.77 },
      { prices: [3, 3, 3, 3, 3, 3, 3], discount: 1 },
      { prices: [1_234.56, 0, 8_765.44], discount: 999.99 },
    ];
    for (const { prices, discount } of cases) {
      const t = computeTotals({
        items: prices.map((unitPrice) => ({
          quantity: 1,
          unitPrice,
          taxRatePercent: 18,
        })),
        discount,
        convenienceCharge: 0,
        tax: derived(),
      });
      const applied = Number(
        t.lines
          .reduce((sum, line) => sum + line.lineDiscount + line.apportioned, 0)
          .toFixed(2)
      );
      expect(applied).toBe(t.discount);
    }
  });

  it("applies a per-line discount before the invoice-level one", () => {
    const t = computeTotals({
      items: [
        { quantity: 1, unitPrice: 1_000, discount: 200, taxRatePercent: 18 },
        { quantity: 1, unitPrice: 1_000, taxRatePercent: 18 },
      ],
      discount: 180,
      convenienceCharge: 0,
      tax: derived(),
    });
    expect(t.lines[0].lineDiscount).toBe(200);
    // Pro-rata over the POST-line-discount values, 800 : 1000.
    expect(t.lines[0].apportioned).toBe(80);
    expect(t.lines[1].apportioned).toBe(100);
    expect(t.discount).toBe(380);
    expect(t.taxableValue).toBe(1_620);
  });

  it("clamps a discount larger than the invoice and leaves only the service charge", () => {
    const t = computeTotals({
      items: [{ quantity: 1, unitPrice: 100, taxRatePercent: 18 }],
      discount: 500,
      convenienceCharge: 50,
      tax: derived(),
    });
    expect(t.discount).toBe(100);
    expect(t.taxableValue).toBe(0);
    expect(t.cgst + t.sgst + t.igst).toBe(0);
    expect(t.total).toBe(50);
  });

  it("does not divide by zero when every line is worth nothing", () => {
    const t = computeTotals({
      items: [{ quantity: 0, unitPrice: 250, taxRatePercent: 18 }],
      discount: 10,
      convenienceCharge: 0,
      tax: derived(),
    });
    for (const value of [
      t.subtotal,
      t.discount,
      t.taxableValue,
      t.cgst,
      t.sgst,
      t.igst,
      t.total,
      t.roundOff,
      t.lines[0].apportioned,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(t.discount).toBe(0);
    expect(t.total).toBe(0);
  });

  it("skips lines with nothing left when picking the residual line", () => {
    const t = computeTotals({
      items: [
        { quantity: 1, unitPrice: 1_000, taxRatePercent: 18 },
        { quantity: 0, unitPrice: 500, taxRatePercent: 18 },
      ],
      discount: 100,
      convenienceCharge: 0,
      tax: derived(),
    });
    expect(t.lines[1].apportioned).toBe(0);
    expect(t.lines[0].apportioned).toBe(100);
  });
});

describe("computeTotals — §170 rounding", () => {
  it("rounds a tax invoice to the nearest rupee and reports the delta", () => {
    const up = computeTotals({
      items: [{ quantity: 1, unitPrice: 1_234.56 }],
      discount: 0,
      convenienceCharge: 0,
      tax: derived(),
    });
    expect(up.total).toBe(1_235);
    expect(up.roundOff).toBe(0.44);

    const down = computeTotals({
      items: [{ quantity: 1, unitPrice: 1_234.49 }],
      discount: 0,
      convenienceCharge: 0,
      tax: derived(),
    });
    expect(down.total).toBe(1_234);
    expect(down.roundOff).toBe(-0.49);
  });

  it("emits no Round Off row when there is nothing to round", () => {
    const t = computeTotals({
      items: [{ quantity: 1, unitPrice: 1_234 }],
      discount: 0,
      convenienceCharge: 0,
      tax: derived(),
    });
    expect(t.roundOff).toBe(0);
    expect(buildTotalsRows(t).some((row) => row.label === "Round Off")).toBe(false);
  });

  it("emits the Round Off row, in order, when there is", () => {
    const t = computeTotals({
      items: [{ quantity: 1, unitPrice: 1_234.56, taxRatePercent: 18 }],
      discount: 0,
      convenienceCharge: 0,
      tax: derived(),
    });
    expect(buildTotalsRows(t).map((row) => row.label)).toEqual([
      "Subtotal",
      "Discount",
      "CGST @ 9%",
      "SGST @ 9%",
      "Service Charge",
      "Round Off",
      "Total",
    ]);
  });

  it("rounds half up, not banker's and not always up", () => {
    expect(roundToRupee(0.5)).toBe(1);
    expect(roundToRupee(1.5)).toBe(2);
    expect(roundToRupee(2.5)).toBe(3);
    expect(roundToRupee(0.49)).toBe(0);
    expect(roundToRupee(Number.NaN)).toBe(0);
  });
});

describe("computeTotals — suppressed mode", () => {
  it("emits no tax rows and adds nothing to the total", () => {
    const t = computeTotals({
      items: [{ quantity: 2, unitPrice: 500, taxRatePercent: 18 }],
      discount: 0,
      convenienceCharge: 25,
      tax: { mode: "none", suppressedBecause: "unregistered" },
    });
    expect(t.taxRows).toEqual([]);
    expect(t.cgst).toBe(0);
    expect(t.sgst).toBe(0);
    expect(t.igst).toBe(0);
    expect(t.suppressedBecause).toBe("unregistered");
    expect(t.total).toBe(t.taxableValue + t.convenienceCharge);
  });

  it("does not round an untaxed document to the rupee", () => {
    const t = computeTotals({
      items: [{ quantity: 1, unitPrice: 1_234.56 }],
      discount: 0,
      convenienceCharge: 0,
      tax: { mode: "none", suppressedBecause: "composition" },
    });
    expect(t.total).toBe(1_234.56);
    expect(t.roundOff).toBe(0);
  });
});

describe("buildTotalsRows", () => {
  it("produces the ordered, labeled rows for a legacy invoice", () => {
    const rows = buildTotalsRows(
      computeTotals({
        items: [{ quantity: 1, unitPrice: 100 }],
        discount: 10,
        cgst: 5,
        sgst: 5,
        convenienceCharge: 2,
      })
    );
    expect(rows.map((r) => r.label)).toEqual([
      "Subtotal",
      "Discount",
      "CGST",
      "SGST",
      "Service Charge",
      "Total",
    ]);
    expect(rows.find((r) => r.label === "Discount")?.kind).toBe("discount");
    expect(rows.find((r) => r.label === "Total")?.kind).toBe("grand");
  });

  it("never draws a zero tax row or two contradictory heads, over the cross-product", () => {
    const treatments: TaxTreatment[] = ["none", "gst", "composition"];
    const kinds: SupplyKind[] = ["intra", "inter", "export", "sez"];
    for (const treatment of treatments) {
      for (const kind of kinds) {
        for (const withPaymentOfTax of [true, false]) {
          for (const supplierStateCode of ["29", "04"]) {
            const tax: TotalsTaxContext =
              treatment === "gst"
                ? { mode: "derived", supplyKind: kind, supplierStateCode, withPaymentOfTax }
                : {
                    mode: "none",
                    suppressedBecause:
                      treatment === "none" ? "unregistered" : "composition",
                  };
            const totals = computeTotals({
              items: [{ quantity: 1, unitPrice: 1_000, taxRatePercent: 18 }],
              discount: 0,
              convenienceCharge: 0,
              tax,
            });
            const labels = buildTotalsRows(totals)
              .filter((row) => row.head)
              .map((row) => row.label);
            for (const row of totals.taxRows) {
              expect(row.amount).not.toBe(0);
            }
            const hasIgst = labels.some((l) => l.startsWith("IGST"));
            const hasCgst = labels.some((l) => l.startsWith("CGST"));
            expect(hasIgst && hasCgst).toBe(false);
          }
        }
      }
    }
  });
});

describe("resolveRecordAmounts", () => {
  const base: InvoiceRecord = {
    _id: "1",
    userId: "u",
    companyName: "Acme",
    billTo: "Client",
    invoiceNumber: "INV-1",
    invoiceDate: "2026-01-01",
    dueDate: "2026-01-15",
    currency: "INR",
    items: [{ name: "W", price: 100, quantity: 1 }],
    convenienceCharge: 0,
    total: 100,
    createdAt: "2026-01-01",
  };

  it("honors a legitimately-zero stored total (does not recompute)", () => {
    const amounts = resolveRecordAmounts({ ...base, discount: 150, total: 0 });
    expect(amounts.total).toBe(0);
  });

  it("recomputes with a clamp when total is absent (legacy)", () => {
    const amounts = resolveRecordAmounts({
      ...base,
      discount: 150,
      total: undefined as unknown as number,
      subtotal: undefined,
    });
    expect(amounts.total).toBe(0);
  });

  it("falls back to legacy `tax` for cgst", () => {
    const amounts = resolveRecordAmounts({
      ...base,
      cgst: undefined,
      tax: 18,
    });
    expect(amounts.cgst).toBe(18);
  });

  it("replays a pre-Phase-2 document through the legacy formula, field by field", () => {
    // Only `tax`; no cgst/sgst, no taxTreatment, no supplyKind, no rates.
    const amounts = resolveRecordAmounts({
      ...base,
      items: [{ name: "W", price: 100, quantity: 2 }],
      discount: 25,
      tax: 18,
      cgst: undefined,
      sgst: undefined,
      convenienceCharge: 5,
      subtotal: undefined,
      total: undefined as unknown as number,
    });
    expect(amounts.subtotal).toBe(200);
    expect(amounts.discount).toBe(25);
    expect(amounts.cgst).toBe(18);
    expect(amounts.sgst).toBe(0);
    expect(amounts.igst).toBe(0);
    expect(amounts.roundOff).toBe(0);
    // 200 - 25 + 18 + 0 + 5
    expect(amounts.total).toBe(198);
    expect(amounts.taxRows.map((row) => row.label)).toEqual(["CGST", "SGST"]);
    expect(amounts.suppressedBecause).toBeNull();
  });

  it("drops the placeholder tax rows from a legacy document that carried no tax", () => {
    const amounts = resolveRecordAmounts({ ...base, cgst: 0, sgst: 0 });
    expect(amounts.taxRows).toEqual([]);
  });

  it("emits no tax rows for an explicitly unregistered document", () => {
    const amounts = resolveRecordAmounts({
      ...base,
      taxTreatment: "none",
      cgst: 9,
      sgst: 9,
      total: undefined as unknown as number,
    });
    expect(amounts.taxRows).toEqual([]);
    expect(amounts.cgst).toBe(0);
    expect(amounts.sgst).toBe(0);
    expect(amounts.suppressedBecause).toBe("unregistered");
    expect(amounts.total).toBe(100);
  });

  it("derives IGST for a stored inter-State tax invoice", () => {
    const amounts = resolveRecordAmounts({
      ...base,
      taxTreatment: "gst",
      supplyKind: "inter",
      supplierStateCode: "29",
      placeOfSupplyStateCode: "27",
      items: [{ name: "W", price: 1_000, quantity: 1, taxRatePercent: 18 }],
      subtotal: undefined,
      total: undefined as unknown as number,
    });
    expect(amounts.igst).toBe(180);
    expect(amounts.cgst).toBe(0);
    expect(amounts.total).toBe(1_180);
  });

  it("suppresses tax on a reverse-charge invoice", () => {
    const amounts = resolveRecordAmounts({
      ...base,
      taxTreatment: "gst",
      reverseCharge: true,
      supplyKind: "intra",
      items: [{ name: "W", price: 1_000, quantity: 1, taxRatePercent: 18 }],
      subtotal: undefined,
      total: undefined as unknown as number,
    });
    expect(amounts.taxRows).toEqual([]);
    expect(amounts.suppressedBecause).toBe("reverse_charge");
    expect(amounts.total).toBe(1_000);
  });

  it("honors a stored roundOff rather than recomputing one", () => {
    const amounts = resolveRecordAmounts({
      ...base,
      taxTreatment: "gst",
      supplyKind: "intra",
      supplierStateCode: "29",
      roundOff: 0.31,
      total: undefined as unknown as number,
    });
    expect(amounts.roundOff).toBe(0.31);
  });
});

describe("validateInvoice", () => {
  const valid = {
    companyName: "Acme",
    billTo: "Client",
    invoiceNumber: "INV-1",
    invoiceDate: "2026-01-01",
    dueDate: "2026-01-15",
    items: [{ description: "Widget" }],
  };

  it("returns null for a valid invoice", () => {
    expect(validateInvoice(valid)).toBeNull();
  });

  it("flags each required field", () => {
    expect(validateInvoice({ ...valid, companyName: " " })).toBe(
      "Company name is required"
    );
    expect(validateInvoice({ ...valid, billTo: "" })).toBe("Bill to is required");
    expect(validateInvoice({ ...valid, invoiceNumber: "" })).toBe(
      "Invoice number is required"
    );
    expect(validateInvoice({ ...valid, invoiceDate: "not-a-date" })).toBe(
      "Invoice date is invalid"
    );
    expect(validateInvoice({ ...valid, dueDate: "" })).toBe(
      "Due date is invalid"
    );
    expect(validateInvoice({ ...valid, items: [{ description: "  " }] })).toBe(
      "At least one line item is required"
    );
  });

  it("accepts DB-shaped items (name instead of description)", () => {
    expect(validateInvoice({ ...valid, items: [{ name: "Widget" }] })).toBeNull();
  });

  it("leaves a pre-Phase-2 invoice alone (no taxTreatment, no new rules)", () => {
    expect(validateInvoiceDetailed(valid)).toEqual({ error: null, warnings: [] });
  });

  it("requires both state codes on a GST invoice", () => {
    expect(validateInvoice({ ...valid, taxTreatment: "gst" })).toBe(
      "Select the state you're registered in."
    );
    expect(
      validateInvoice({
        ...valid,
        taxTreatment: "gst",
        supplierStateCode: "29",
      })
    ).toBe("Select the place of supply.");
  });

  it("requires an HSN/SAC on every taxed line", () => {
    expect(
      validateInvoice({
        ...valid,
        taxTreatment: "gst",
        supplierStateCode: "29",
        placeOfSupplyStateCode: "27",
        items: [{ description: "Widget", taxRatePercent: 18 }],
      })
    ).toBe("Add an HSN or SAC code for every taxed line.");
  });

  it("requires a country of destination on an export", () => {
    expect(
      validateInvoice({
        ...valid,
        supplyKind: "export",
        withPaymentOfTax: true,
      })
    ).toBe("Country of destination is required on an export invoice.");
  });

  it("requires an LUT ARN when exporting without payment of tax", () => {
    expect(
      validateInvoice({
        ...valid,
        supplyKind: "sez",
        withPaymentOfTax: false,
      })
    ).toBe("Enter your LUT ARN, or switch to 'with payment of tax'.");
  });

  it("rejects a recipient that is both in an SEZ and overseas", () => {
    expect(
      validateInvoice({
        ...valid,
        recipientIsSez: true,
        recipientIsOutsideIndia: true,
      })
    ).toBe(
      "An SEZ unit is inside India — clear either the SEZ flag or the overseas recipient."
    );
  });

  it("trips on a head set that contradicts the supply kind", () => {
    expect(
      validateInvoice({
        ...valid,
        supplyKind: "inter",
        totals: { cgst: 90, sgst: 90, igst: 0 },
      })
    ).toBe("An inter-State supply must be taxed as IGST, not CGST/SGST.");
    expect(
      validateInvoice({
        ...valid,
        supplyKind: "intra",
        totals: { cgst: 0, sgst: 0, igst: 180 },
      })
    ).toBe("An intra-State supply must be taxed as CGST/SGST, not IGST.");
  });

  it("blocks a composition dealer's inter-State goods but only warns on services", () => {
    expect(
      validateInvoice({
        ...valid,
        taxTreatment: "composition",
        supplyKind: "inter",
        items: [{ description: "Widget", hsnSac: "8471" }],
      })
    ).toBe("A composition dealer cannot make an inter-State supply of goods.");

    const services = validateInvoiceDetailed({
      ...valid,
      taxTreatment: "composition",
      supplyKind: "inter",
      items: [{ description: "Consulting", hsnSac: "998314" }],
    });
    expect(services.error).toBeNull();
    expect(services.warnings).toHaveLength(1);
  });

  it("warns about a withdrawn rate without blocking the save", () => {
    const result = validateInvoiceDetailed({
      ...valid,
      items: [{ description: "Widget", taxRatePercent: 28 }],
    });
    expect(result.error).toBeNull();
    expect(result.warnings).toEqual([
      "12% and 28% were withdrawn on 22 Sep 2025.",
    ]);
  });
});

describe("InvoiceTotals shape", () => {
  it("is fully populated by computeTotals in every mode", () => {
    const contexts: TotalsTaxContext[] = [
      { mode: "legacy", cgst: 1, sgst: 1 },
      { mode: "none", suppressedBecause: "unregistered" },
      derived(),
    ];
    for (const tax of contexts) {
      const totals: InvoiceTotals = computeTotals({
        items: [{ quantity: 1, unitPrice: 100, taxRatePercent: 18 }],
        discount: 0,
        convenienceCharge: 0,
        tax,
      });
      expect(Object.keys(totals).sort()).toEqual(
        [
          "cgst",
          "convenienceCharge",
          "discount",
          "igst",
          "lines",
          "roundOff",
          "sgst",
          "subtotal",
          "suppressedBecause",
          "taxRows",
          "taxableValue",
          "total",
        ].sort()
      );
    }
  });
});
