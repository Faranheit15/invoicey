import { describe, it, expect } from "bun:test";
import {
  buildLineItemColumns,
  createInvoiceCsv,
  createInvoiceHtml,
} from "@/lib/invoice-export";
import { resolveRecordAmounts } from "@/lib/invoice-domain";
import {
  COMPOSITION_BANNER,
  EXPORT_ENDORSEMENT_UNDER_LUT,
  EXPORT_ENDORSEMENT_WITH_TAX,
} from "@/lib/gst-supply";
import type { InvoiceRecord } from "@/lib/invoices";

const makeRecord = (overrides: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  _id: "abc123",
  userId: "user-1",
  companyName: "Acme Inc",
  billTo: "Client Co",
  invoiceNumber: "INV-1",
  invoiceDate: "2026-01-01",
  dueDate: "2026-01-15",
  currency: "INR",
  items: [{ name: "Widget", price: 100, quantity: 1 }],
  convenienceCharge: 0,
  total: 100,
  createdAt: "2026-01-01",
  ...overrides,
});

describe("createInvoiceCsv — formula injection", () => {
  it("prefixes a leading = with a single quote so spreadsheets treat it as text", () => {
    const csv = createInvoiceCsv(
      makeRecord({ companyName: '=HYPERLINK("http://evil","x")' })
    );
    expect(csv).toContain('"\'=HYPERLINK');
    expect(csv).not.toContain('"=HYPERLINK');
  });

  it("neutralizes +, -, and @ leading characters", () => {
    const plus = createInvoiceCsv(makeRecord({ billTo: "+1+1" }));
    expect(plus).toContain("\"'+1+1\"");

    const at = createInvoiceCsv(makeRecord({ companyName: "@SUM(A1)" }));
    expect(at).toContain("\"'@SUM(A1)\"");
  });

  it("leaves ordinary values untouched", () => {
    const csv = createInvoiceCsv(makeRecord({ companyName: "Acme Inc" }));
    expect(csv).toContain('"Acme Inc"');
    expect(csv).not.toContain("'Acme");
  });
});

describe("createInvoiceCsv — totals clamp", () => {
  it("renders 0.00 (not negative) for an over-discounted invoice with no stored total", () => {
    const csv = createInvoiceCsv(
      makeRecord({
        items: [{ name: "Widget", price: 100, quantity: 1 }],
        discount: 150,
        total: undefined,
        subtotal: undefined,
      })
    );
    expect(csv).toContain('"Total","0.00"');
    expect(csv).not.toContain("-50.00");
  });

  it("respects a legitimately-zero stored total instead of recomputing", () => {
    const csv = createInvoiceCsv(
      makeRecord({ items: [{ name: "W", price: 100, quantity: 1 }], discount: 150, total: 0 })
    );
    expect(csv).toContain('"Total","0.00"');
  });
});

describe("createInvoiceHtml — escaping", () => {
  it("escapes HTML-significant characters in user fields", () => {
    const html = createInvoiceHtml(
      makeRecord({ companyName: "<script>alert(1)</script>" })
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("drops a javascript: logo URL (protocol allowlist)", () => {
    const html = createInvoiceHtml(
      makeRecord({ companyLogo: "javascript:alert(1)" })
    );
    expect(html).not.toContain("javascript:alert(1)");
  });

  it("uses the legacy tax value when cgst is absent", () => {
    const html = createInvoiceHtml(
      makeRecord({ cgst: undefined, tax: 18, currency: "USD" })
    );
    // CGST row should reflect the 18 fallback, formatted as currency.
    expect(html).toContain("18");
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 2: GST rendering                                                      */
/* -------------------------------------------------------------------------- */

const gstRecord = (overrides: Partial<InvoiceRecord> = {}): InvoiceRecord =>
  makeRecord({
    taxTreatment: "gst",
    documentType: "tax_invoice",
    supplierStateCode: "29",
    placeOfSupplyStateCode: "29",
    placeOfSupplyLabel: "Karnataka",
    supplyKind: "intra",
    items: [
      {
        name: "Consulting",
        price: 1000,
        quantity: 1,
        hsnSac: "998314",
        unit: "HRS",
        taxRatePercent: 18,
      },
    ],
    subtotal: undefined,
    total: undefined as unknown as number,
    ...overrides,
  });

describe("createInvoiceHtml — Rule 46 export/SEZ endorsement", () => {
  it("prints the with-payment-of-tax wording verbatim", () => {
    const html = createInvoiceHtml(
      gstRecord({
        supplyKind: "export",
        placeOfSupplyStateCode: "96",
        placeOfSupplyLabel: "United States",
        countryOfDestination: "United States",
        recipientIsOutsideIndia: true,
        withPaymentOfTax: true,
      })
    );
    // Byte-identical to the constant. Statutory wording: not reflowed, not
    // re-cased, not rebuilt from parts.
    expect(html).toContain(EXPORT_ENDORSEMENT_WITH_TAX);
    expect(html).not.toContain(EXPORT_ENDORSEMENT_UNDER_LUT);
  });

  it("prints the LUT wording verbatim when there is no payment of tax", () => {
    const html = createInvoiceHtml(
      gstRecord({
        supplyKind: "export",
        placeOfSupplyStateCode: "96",
        countryOfDestination: "Germany",
        recipientIsOutsideIndia: true,
        withPaymentOfTax: false,
        lutArn: "AD290123456789A",
      })
    );
    expect(html).toContain(EXPORT_ENDORSEMENT_UNDER_LUT);
    expect(html).not.toContain(EXPORT_ENDORSEMENT_WITH_TAX);
  });

  it("prints the SEZ endorsement too — sez is the same proviso", () => {
    const html = createInvoiceHtml(
      gstRecord({ supplyKind: "sez", recipientIsSez: true, withPaymentOfTax: true })
    );
    expect(html).toContain(EXPORT_ENDORSEMENT_WITH_TAX);
  });

  it("prints no endorsement on an ordinary domestic supply", () => {
    const html = createInvoiceHtml(gstRecord());
    expect(html).not.toContain("SUPPLY MEANT FOR EXPORT");
  });

  it("carries the endorsement into the CSV, neutralized like every other cell", () => {
    const csv = createInvoiceCsv(
      gstRecord({ supplyKind: "sez", recipientIsSez: true, withPaymentOfTax: false })
    );
    expect(csv).toContain(`"Endorsement","${EXPORT_ENDORSEMENT_UNDER_LUT}"`);
  });

  it("prints the composition declaration verbatim on a bill of supply", () => {
    const html = createInvoiceHtml(
      gstRecord({ taxTreatment: "composition", documentType: "bill_of_supply" })
    );
    expect(html).toContain(COMPOSITION_BANNER);
    expect(html).toContain("<h1>BILL OF SUPPLY</h1>");
  });
});

describe("createInvoiceHtml — escaping of the Phase 2 fields", () => {
  const hostile = '<script>alert("xss")</script>';

  it("entity-escapes every new invoice-level field", () => {
    const html = createInvoiceHtml(
      gstRecord({
        placeOfSupplyLabel: hostile,
        countryOfDestination: hostile,
        lutArn: hostile,
        supplyKind: "export",
        recipientIsOutsideIndia: true,
        withPaymentOfTax: false,
      })
    );
    expect(html).not.toContain(hostile);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("entity-escapes the new per-line columns", () => {
    const html = createInvoiceHtml(
      gstRecord({
        items: [
          {
            name: hostile,
            price: 10,
            quantity: 1,
            hsnSac: hostile,
            unit: hostile,
            taxRatePercent: 18,
          },
        ],
      })
    );
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes the signature block, which is built from the company name", () => {
    const html = createInvoiceHtml(gstRecord({ companyName: hostile }));
    expect(html).toContain("For &lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("suffixes a single-rate tax row with the rate, per head", () => {
    // The label is interpolated into a raw string template and now carries
    // computed text, so it goes through escapeHtml like every other value.
    const html = createInvoiceHtml(gstRecord());
    expect(html).toContain("CGST @ 9%");
    expect(html).toContain("SGST @ 9%");
  });
});

describe("createInvoiceCsv — the new columns are neutralized too", () => {
  it("prefixes a formula in an HSN/SAC, a unit and a place-of-supply label", () => {
    const csv = createInvoiceCsv(
      gstRecord({
        placeOfSupplyLabel: "=cmd|'/c calc'!A1",
        items: [
          {
            name: "Widget",
            price: 10,
            quantity: 1,
            hsnSac: "=1+1",
            unit: "@SUM(A1)",
            taxRatePercent: 18,
          },
        ],
      })
    );
    expect(csv).toContain(`"'=cmd`);
    expect(csv).toContain(`"'=1+1"`);
    expect(csv).toContain(`"'@SUM(A1)"`);
  });
});

describe("createInvoiceCsv — line-item cells stay numeric", () => {
  it("emits bare numbers, not currency strings, so a spreadsheet can sum them", () => {
    // The CSV shares its column list with the HTML but not its formatting: a
    // cell holding "₹50,000.00" is a string and will not add up.
    const csv = createInvoiceCsv(gstRecord());
    expect(csv).toContain('"1","Consulting","998314","HRS","1","1000.00","18"');
    expect(csv).not.toContain("₹1,000.00");
  });
});

describe("buildLineItemColumns — a column only exists when a line fills it", () => {
  const columnsFor = (invoice: InvoiceRecord) => {
    const totals = resolveRecordAmounts(invoice);
    return buildLineItemColumns({
      items: invoice.items,
      totals,
      currency: invoice.currency,
    }).map((column) => column.key);
  };

  it("keeps a legacy invoice on exactly the five columns it always had", () => {
    expect(columnsFor(makeRecord())).toEqual([
      "index",
      "description",
      "quantity",
      "unitPrice",
      "amount",
    ]);
  });

  it("adds HSN/SAC, UOM, rate and tax for a taxed GST line", () => {
    expect(columnsFor(gstRecord())).toEqual([
      "index",
      "description",
      "hsnSac",
      "unit",
      "quantity",
      "unitPrice",
      "taxRate",
      "tax",
      "amount",
    ]);
  });

  it("drops the tax column when no tax is charged (zero-rated under LUT)", () => {
    const columns = columnsFor(
      gstRecord({
        supplyKind: "export",
        recipientIsOutsideIndia: true,
        withPaymentOfTax: false,
      })
    );
    expect(columns).not.toContain("tax");
    // The RATE still prints: Rule 46(k) is satisfied per line even when the
    // amount collected is nil.
    expect(columns).toContain("taxRate");
  });

  it("adds a discount column only when a line actually carries one", () => {
    expect(columnsFor(gstRecord())).not.toContain("discount");
    expect(
      columnsFor(
        gstRecord({
          items: [
            { name: "A", price: 100, quantity: 1, discount: 10, taxRatePercent: 18 },
          ],
        })
      )
    ).toContain("discount");
  });
});

describe("createInvoiceHtml — item 7 particulars", () => {
  it("prints the amount in words", () => {
    const html = createInvoiceHtml(gstRecord());
    expect(html).toContain("Amount in words:");
    expect(html).toContain("Indian Rupees One Thousand One Hundred Eighty Only");
  });

  it("prints dates day-first, not en-US", () => {
    const html = createInvoiceHtml(makeRecord({ invoiceDate: "2026-01-01" }));
    expect(html).toContain("1 Jan 2026");
    expect(html).not.toContain("Jan 1, 2026");
  });

  it("prints the reverse-charge indicator even when the answer is No", () => {
    expect(createInvoiceHtml(gstRecord())).toContain("Reverse Charge");
    expect(createInvoiceHtml(gstRecord())).toContain(">No<");
  });

  it("prints the signature block with the computer-generated caveat", () => {
    const html = createInvoiceHtml(gstRecord());
    expect(html).toContain("For Acme Inc");
    expect(html).toContain("Authorised Signatory");
    expect(html).toContain(
      "This is a computer-generated invoice and does not require a signature."
    );
  });

  it("explains an absent tax row instead of leaving a silent gap", () => {
    const html = createInvoiceHtml(
      gstRecord({ taxTreatment: "none", documentType: "invoice" })
    );
    expect(html).toContain("GST not applicable");
  });
});

describe("createInvoiceHtml — a pre-Phase-2 invoice is unchanged", () => {
  const legacy = makeRecord({
    items: [{ name: "Widget", price: 100, quantity: 3 }],
    discount: 25,
    cgst: 18,
    sgst: 18,
    convenienceCharge: 5,
    subtotal: undefined,
    total: undefined as unknown as number,
  });

  it("still heads the document INVOICE and carries both legacy tax rows", () => {
    const html = createInvoiceHtml(legacy);
    expect(html).toContain("<h1>INVOICE</h1>");
    expect(html).toContain(">CGST<");
    expect(html).toContain(">SGST<");
  });

  it("prints none of the GST particulars a legacy document never had", () => {
    const html = createInvoiceHtml(legacy);
    expect(html).not.toContain("Place of Supply");
    expect(html).not.toContain("Reverse Charge");
    expect(html).not.toContain("SUPPLY MEANT FOR EXPORT");
    expect(html).not.toContain("HSN/SAC");
  });

  it("prints the same total it always did — no rupee rounding on the legacy path", () => {
    expect(resolveRecordAmounts(legacy).total).toBe(316);
    expect(createInvoiceCsv(legacy)).toContain('"Total","316.00"');
  });
});

describe("print CSS hardening (item 8)", () => {
  const html = createInvoiceHtml(gstRecord());

  it("repeats the table header across pages", () => {
    expect(html).toContain("display: table-header-group");
  });

  it("never splits a line item across a page break", () => {
    expect(html).toContain("break-inside: avoid");
    expect(html).toContain("page-break-inside: avoid");
  });

  it("undoes the sheet's overflow clip when printing", () => {
    expect(html).toContain("overflow: visible");
  });

  it("sets orphans and widows", () => {
    expect(html).toContain("orphans: 3");
    expect(html).toContain("widows: 3");
  });

  it("waits for fonts and images before opening the print dialog", () => {
    const printable = createInvoiceHtml(gstRecord(), { autoPrint: true });
    expect(printable).toContain("document.fonts");
    expect(printable).toContain("Promise.race");
    expect(printable).toContain("window.print()");
  });
});
