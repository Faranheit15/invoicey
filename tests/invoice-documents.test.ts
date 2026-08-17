import { describe, it, expect } from "bun:test";
import {
  DOCUMENT_KIND_SPECS,
  INVOICE_DOCUMENT_KINDS,
  NOTE_BEFORE_ORIGINAL_ERROR,
  NOTE_ORIGINAL_DATE_ERROR,
  NOTE_WITHOUT_ORIGINAL_ERROR,
  buildTotalsRows,
  computeTotals,
  creditNoteDeclarationDeadline,
  documentKindSpecFor,
  documentTaxNoticeFor,
  documentTitleFor,
  isCreditOrDebitNote,
  resolveDocumentKind,
  resolveRecordAmounts,
  validateInvoiceDetailed,
  type InvoiceDocumentKind,
  type ValidatableInvoice,
} from "@/lib/invoice-domain";
import {
  formatInvoiceNumber,
  isValidInvoiceNumber,
  suggestInvoiceNumber,
} from "@/lib/invoice-number";
import { createInvoiceCsv, createInvoiceHtml } from "@/lib/invoice-export";
import {
  applyDocumentKindToDraft,
  createDefaultInvoiceFormState,
  mapFormStateToPayload,
  mapInvoiceRecordToFormState,
} from "@/lib/invoices";
import { buildDuplicateFormState } from "@/lib/invoice-duplicate";
import { invoiceDraftKey } from "@/lib/invoice-draft";
import type { InvoiceRecord } from "@/lib/invoices";

/**
 * Phase 4: proforma / quotation, and §34 credit and debit notes.
 *
 * The properties this file exists to hold, all of which are ways of getting the
 * same thing wrong:
 *
 *   - a proforma may never be headed "TAX INVOICE", whatever its author's GST
 *     registration says, and must say what it is not;
 *   - the four new series may never borrow a number from the invoice series;
 *   - a credit note is defined by the invoice it corrects (Rule 53(1A)) and may
 *     not produce a negative total;
 *   - and none of it may change what a document written before any of it
 *     existed prints.
 */

const record = (overrides: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  _id: "doc-1",
  userId: "user-1",
  companyName: "Acme Consulting",
  billTo: "Client Co",
  invoiceNumber: "INV/2026-27/001",
  invoiceDate: "2026-07-01",
  dueDate: "2026-07-15",
  currency: "INR",
  items: [{ name: "Consulting", price: 1000, quantity: 1 }],
  convenienceCharge: 0,
  total: 1000,
  createdAt: "2026-07-01",
  ...overrides,
});

const gstRecord = (overrides: Partial<InvoiceRecord> = {}): InvoiceRecord =>
  record({
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
        taxRatePercent: 18,
      },
    ],
    subtotal: undefined,
    total: undefined as unknown as number,
    ...overrides,
  });

/* -------------------------------------------------------------------------- */
/* The kind itself                                                            */
/* -------------------------------------------------------------------------- */

describe("resolveDocumentKind", () => {
  it("reads absence, an unknown value and rubbish all as an ordinary invoice", () => {
    // Absence is the storage representation of "invoice" — see the unique
    // index — so this is the property the whole series design rests on.
    expect(resolveDocumentKind(undefined)).toBe("invoice");
    expect(resolveDocumentKind(null)).toBe("invoice");
    expect(resolveDocumentKind("")).toBe("invoice");
    expect(resolveDocumentKind("tax_invoice")).toBe("invoice");
    expect(resolveDocumentKind("../../etc/passwd")).toBe("invoice");
  });

  it("keeps every real kind", () => {
    for (const kind of INVOICE_DOCUMENT_KINDS) {
      expect(resolveDocumentKind(kind)).toBe(kind);
    }
  });

  it("knows which kinds are §34 notes", () => {
    expect(isCreditOrDebitNote("credit_note")).toBe(true);
    expect(isCreditOrDebitNote("debit_note")).toBe(true);
    expect(isCreditOrDebitNote("proforma")).toBe(false);
    expect(isCreditOrDebitNote(undefined)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Headings                                                                   */
/* -------------------------------------------------------------------------- */

describe("documentTitleFor", () => {
  it("never heads a proforma TAX INVOICE, whatever the supplier is registered as", () => {
    // The one that matters. `documentType` is derived from `taxTreatment` and
    // says "tax_invoice" for a registered supplier; the kind has to win, or a
    // pre-supply quote goes out claiming to be a Rule 46 document.
    for (const taxTreatment of ["gst", "composition", "none"] as const) {
      expect(
        documentTitleFor({
          documentKind: "proforma",
          documentType: "tax_invoice",
          taxTreatment,
        })
      ).toBe("PROFORMA INVOICE");
    }
  });

  it("heads each new kind with its own words", () => {
    expect(documentTitleFor({ documentKind: "quotation" })).toBe("QUOTATION");
    // Rule 53(1A): the words "Credit Note" prominently.
    expect(documentTitleFor({ documentKind: "credit_note" })).toBe("CREDIT NOTE");
    expect(documentTitleFor({ documentKind: "debit_note" })).toBe("DEBIT NOTE");
  });

  it("leaves an ordinary invoice on the Phase 2 tax-shape titles", () => {
    expect(
      documentTitleFor({ documentKind: "invoice", taxTreatment: "gst" })
    ).toBe("TAX INVOICE");
    expect(
      documentTitleFor({ documentKind: "invoice", taxTreatment: "composition" })
    ).toBe("BILL OF SUPPLY");
    expect(
      documentTitleFor({ documentKind: "invoice", taxTreatment: "none" })
    ).toBe("INVOICE");
  });

  it("keeps a pre-Phase-2 record on the plain INVOICE it has always printed", () => {
    // No kind, no type, no treatment: a document a client already holds must
    // not change its heading because the app grew new document types.
    expect(documentTitleFor({})).toBe("INVOICE");
  });
});

/* -------------------------------------------------------------------------- */
/* Tax language                                                               */
/* -------------------------------------------------------------------------- */

describe("documentTaxNoticeFor", () => {
  it("says a proforma is not a tax invoice, for every treatment", () => {
    for (const taxTreatment of ["gst", "composition", "none"] as const) {
      const notice = documentTaxNoticeFor({
        documentKind: "proforma",
        taxTreatment,
      });
      expect(notice).toContain("not a tax invoice");
    }
  });

  it("promises a registered supplier's client a tax invoice, and no one else's", () => {
    const gst = documentTaxNoticeFor({
      documentKind: "proforma",
      taxTreatment: "gst",
    })!;
    expect(gst).toContain("GST shown is indicative");
    expect(gst).toContain("will be charged on the tax invoice");

    // §32 forbids an unregistered person from collecting tax, so their
    // proforma must not promise a tax invoice is coming.
    const none = documentTaxNoticeFor({
      documentKind: "proforma",
      taxTreatment: "none",
    })!;
    expect(none).not.toContain("will be charged on the tax invoice");
    expect(none).toContain("creates no tax liability");

    // A composition dealer issues a BILL OF SUPPLY, never a tax invoice.
    const composition = documentTaxNoticeFor({
      documentKind: "proforma",
      taxTreatment: "composition",
    })!;
    expect(composition).toContain("bill of supply");
  });

  it("names a quotation as a quotation rather than a proforma", () => {
    expect(
      documentTaxNoticeFor({ documentKind: "quotation", taxTreatment: "none" })
    ).toContain("quotation");
  });

  it("leaves a registered supplier's §34 note undisclaimed, and disclaims everyone else's", () => {
    // A §34 credit note from a registered supplier IS a tax document.
    expect(
      documentTaxNoticeFor({ documentKind: "credit_note", taxTreatment: "gst" })
    ).toBeNull();
    expect(
      documentTaxNoticeFor({ documentKind: "credit_note", taxTreatment: "none" })
    ).toContain("commercial credit note");
    expect(
      documentTaxNoticeFor({ documentKind: "debit_note", taxTreatment: "none" })
    ).toContain("commercial debit note");
  });

  it("says nothing at all on an invoice, including a legacy one", () => {
    expect(documentTaxNoticeFor({ documentKind: "invoice", taxTreatment: "gst" })).toBeNull();
    expect(documentTaxNoticeFor({})).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Numbering series                                                           */
/* -------------------------------------------------------------------------- */

describe("numbering series isolation", () => {
  it("gives every kind its own prefix, and no two the same", () => {
    const patterns = INVOICE_DOCUMENT_KINDS.map(
      (kind) => DOCUMENT_KIND_SPECS[kind].numberPattern
    );
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it("renders every series inside Rule 46(b)'s sixteen characters", () => {
    for (const kind of INVOICE_DOCUMENT_KINDS) {
      const spec = DOCUMENT_KIND_SPECS[kind];
      // 999 is the last number the 3-wide pattern renders without growing.
      for (const sequence of [1, 999]) {
        const rendered = formatInvoiceNumber(spec.numberPattern, {
          financialYear: "2026-27",
          sequence,
        });
        expect(rendered).not.toBeNull();
        expect(isValidInvoiceNumber(rendered!)).toBe(true);
      }
      const fallback = formatInvoiceNumber(spec.fallbackNumberPattern, {
        financialYear: "2026-27",
        sequence: 9999,
      });
      expect(fallback).not.toBeNull();
      expect(isValidInvoiceNumber(fallback!)).toBe(true);
    }
  });

  it("starts each series at 1 in its own prefix", () => {
    const first = (kind: InvoiceDocumentKind) =>
      suggestInvoiceNumber({
        financialYear: "2026-27",
        previous: null,
        pattern: DOCUMENT_KIND_SPECS[kind].numberPattern,
        fallbackPattern: DOCUMENT_KIND_SPECS[kind].fallbackNumberPattern,
      });
    expect(first("invoice")).toBe("INV/2026-27/001");
    expect(first("proforma")).toBe("PI/2026-27/001");
    expect(first("quotation")).toBe("QT/2026-27/001");
    expect(first("credit_note")).toBe("CN/2026-27/001");
    expect(first("debit_note")).toBe("DN/2026-27/001");
  });

  it("continues a series from its OWN highest number, not another's", () => {
    // The proforma suggester is only ever given proforma numbers (the route
    // filters by kind), so seven invoices cannot advance the proforma counter.
    expect(
      suggestInvoiceNumber({
        financialYear: "2026-27",
        previous: "PI/2026-27/007",
        pattern: DOCUMENT_KIND_SPECS.proforma.numberPattern,
      })
    ).toBe("PI/2026-27/008");
  });
});

/* -------------------------------------------------------------------------- */
/* Totals                                                                     */
/* -------------------------------------------------------------------------- */

describe("computeTotals across document kinds", () => {
  const input = {
    items: [{ quantity: 2, unitPrice: 100, taxRatePercent: 18 }],
    discount: 0,
    convenienceCharge: 0,
    currency: "INR",
    tax: {
      mode: "derived" as const,
      supplyKind: "intra" as const,
      supplierStateCode: "29",
      withPaymentOfTax: false,
    },
  };

  it("arrives at the same money for every kind — only the label moves", () => {
    // THE decision this asserts: a credit note flows through the one money
    // formula unchanged. Rule 53(1A) asks for "the amount of tax credited",
    // i.e. a positive magnitude; the direction is a property of the document,
    // and negating it here would give `computeTotals` a second meaning.
    const results = INVOICE_DOCUMENT_KINDS.map((documentKind) =>
      computeTotals({ ...input, documentKind })
    );
    for (const totals of results) {
      expect(totals.subtotal).toBe(200);
      expect(totals.cgst).toBe(18);
      expect(totals.sgst).toBe(18);
      expect(totals.total).toBe(236);
    }
    expect(results.map((totals) => totals.grandTotalLabel)).toEqual([
      "Total",
      "Total",
      "Total",
      "Total Credited",
      "Total Debited",
    ]);
  });

  it("names the grand-total row after the document in every renderer", () => {
    const rows = buildTotalsRows(
      computeTotals({ ...input, documentKind: "credit_note" })
    );
    const grand = rows.filter((row) => row.kind === "grand");
    expect(grand).toHaveLength(1);
    expect(grand[0].label).toBe("Total Credited");
    expect(grand[0].amount).toBe(236);
  });

  it("never lets a note reach a negative total", () => {
    // An over-stated discount clamps at zero exactly as it does on an invoice.
    // "Total Credited: -₹50" is not a meaningful thing to hand a client.
    const totals = computeTotals({
      items: [{ quantity: 1, unitPrice: 100 }],
      discount: 500,
      convenienceCharge: 0,
      documentKind: "credit_note",
    });
    expect(totals.total).toBe(0);
    expect(totals.total).toBeGreaterThanOrEqual(0);
  });

  it("carries the kind through to a stored record's display amounts", () => {
    const amounts = resolveRecordAmounts(
      record({ documentKind: "credit_note", total: 1000 })
    );
    expect(amounts.grandTotalLabel).toBe("Total Credited");
    expect(amounts.total).toBe(1000);
  });

  it("still calls a legacy document's grand total 'Total'", () => {
    const amounts = resolveRecordAmounts(record({ cgst: undefined, tax: 18 }));
    expect(amounts.grandTotalLabel).toBe("Total");
    expect(buildTotalsRows(amounts).at(-1)?.label).toBe("Total");
  });
});

/* -------------------------------------------------------------------------- */
/* Rule 53 validation                                                         */
/* -------------------------------------------------------------------------- */

const validatable = (
  overrides: Partial<ValidatableInvoice> = {}
): ValidatableInvoice => ({
  companyName: "Acme Consulting",
  billTo: "Client Co",
  invoiceNumber: "CN/2026-27/001",
  invoiceDate: "2026-08-01",
  dueDate: "2026-08-01",
  items: [{ description: "Consulting" }],
  ...overrides,
});

describe("validateInvoiceDetailed — §34 / Rule 53", () => {
  it("refuses a credit note that names no invoice", () => {
    const result = validateInvoiceDetailed(
      validatable({ documentKind: "credit_note" })
    );
    expect(result.error).toBe(NOTE_WITHOUT_ORIGINAL_ERROR);
  });

  it("refuses a debit note whose original date is unreadable", () => {
    const result = validateInvoiceDetailed(
      validatable({
        documentKind: "debit_note",
        originalInvoice: { invoiceNumber: "INV/2026-27/001", invoiceDate: "nope" },
      })
    );
    expect(result.error).toBe(NOTE_ORIGINAL_DATE_ERROR);
  });

  it("refuses a note dated before the invoice it corrects", () => {
    const result = validateInvoiceDetailed(
      validatable({
        documentKind: "credit_note",
        invoiceDate: "2026-06-01",
        originalInvoice: {
          invoiceNumber: "INV/2026-27/001",
          invoiceDate: "2026-07-01",
        },
      })
    );
    expect(result.error).toBe(NOTE_BEFORE_ORIGINAL_ERROR);
  });

  it("accepts a same-day note", () => {
    const result = validateInvoiceDetailed(
      validatable({
        documentKind: "credit_note",
        invoiceDate: "2026-07-01",
        originalInvoice: {
          invoiceNumber: "INV/2026-27/001",
          invoiceDate: "2026-07-01",
        },
      })
    );
    expect(result.error).toBeNull();
  });

  it("warns about the 30 November declaration deadline without blocking", () => {
    const result = validateInvoiceDetailed(
      validatable({
        documentKind: "credit_note",
        taxTreatment: "gst",
        supplierStateCode: "27",
        placeOfSupplyStateCode: "27",
        companyGstin: "27AAPFU0939F1ZV",
        originalInvoice: {
          invoiceNumber: "INV/2026-27/001",
          invoiceDate: "2026-07-01",
        },
      })
    );
    // No time limit on ISSUING one — only on declaring it.
    expect(result.error).toBeNull();
    expect(result.warnings.join(" ")).toContain("30 November 2027");
  });

  it("asks nothing extra of a proforma, a quotation or an invoice", () => {
    for (const documentKind of ["invoice", "proforma", "quotation"] as const) {
      expect(
        validateInvoiceDetailed(validatable({ documentKind })).error
      ).toBeNull();
    }
    // And a pre-Phase-4 document, which carries no kind at all.
    expect(validateInvoiceDetailed(validatable()).error).toBeNull();
  });
});

describe("creditNoteDeclarationDeadline", () => {
  it("is the 30 November FOLLOWING the end of the original's financial year", () => {
    // FY 2026-27 ends 31 March 2027, so the deadline is 30 November 2027.
    expect(creditNoteDeclarationDeadline("2026-07-01")).toBe("30 November 2027");
    // A March invoice is still in FY 2026-27.
    expect(creditNoteDeclarationDeadline("2027-03-31")).toBe("30 November 2027");
    // One day later opens FY 2027-28.
    expect(creditNoteDeclarationDeadline("2027-04-01")).toBe("30 November 2028");
  });

  it("guesses nothing when the date cannot be read", () => {
    expect(creditNoteDeclarationDeadline("")).toBeNull();
    expect(creditNoteDeclarationDeadline("not a date")).toBeNull();
    expect(creditNoteDeclarationDeadline(undefined)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Form state and the derived-document mappers                                */
/* -------------------------------------------------------------------------- */

describe("form state carries the kind", () => {
  it("defaults a new document to an invoice", () => {
    expect(createDefaultInvoiceFormState().documentKind).toBe("invoice");
    expect(createDefaultInvoiceFormState({ documentKind: "proforma" }).documentKind).toBe(
      "proforma"
    );
  });

  it("reads a record with no kind as an invoice, and round-trips a note's reference", () => {
    expect(mapInvoiceRecordToFormState(record()).documentKind).toBe("invoice");

    const form = mapInvoiceRecordToFormState(
      record({
        documentKind: "credit_note",
        reasonForIssue: "Sales return",
        originalInvoice: {
          invoiceId: "inv-1",
          invoiceNumber: "INV/2026-27/001",
          invoiceDate: "2026-07-01T00:00:00.000Z",
        },
      })
    );
    expect(form.documentKind).toBe("credit_note");
    expect(form.reasonForIssue).toBe("Sales return");
    // Normalised to the yyyy-mm-dd a date input binds to.
    expect(form.originalInvoice?.invoiceDate).toBe("2026-07-01");
  });

  it("sends the kind and the reference on the wire", () => {
    const payload = mapFormStateToPayload(
      applyDocumentKindToDraft(createDefaultInvoiceFormState(), {
        documentKind: "credit_note",
        source: {
          _id: "inv-1",
          invoiceNumber: "INV/2026-27/001",
          invoiceDate: "2026-07-01",
        },
      })
    );
    expect(payload.documentKind).toBe("credit_note");
    expect(payload.originalInvoice).toEqual({
      invoiceId: "inv-1",
      invoiceNumber: "INV/2026-27/001",
      invoiceDate: "2026-07-01",
    });
  });
});

describe("applyDocumentKindToDraft", () => {
  const source = record({
    _id: "inv-9",
    documentKind: "proforma",
    invoiceNumber: "PI/2026-27/004",
    invoiceDate: "2026-05-01",
    dueDate: "2026-05-15",
    status: "sent",
    tdsSection: "194J_professional",
    tdsRatePercent: 10,
  });

  it("converts a proforma into an invoice with a FRESH number and today's dates", () => {
    // The whole point of a proforma. Carrying "PI/2026-27/004" onto the invoice
    // would put a proforma serial on a tax invoice and leave a hole in the
    // invoice sequence Rule 46(b) requires to be consecutive.
    const today = new Date("2026-09-10T00:00:00.000Z");
    const draft = applyDocumentKindToDraft(
      buildDuplicateFormState(mapInvoiceRecordToFormState(source), {
        invoiceNumber: "INV/2026-27/012",
        today,
      }),
      { documentKind: "invoice" }
    );

    expect(draft.documentKind).toBe("invoice");
    expect(draft.invoiceNumber).toBe("INV/2026-27/012");
    expect(draft.invoiceNumber).not.toBe(source.invoiceNumber);
    expect(draft.invoiceDate).toBe("2026-09-10");
    // The source's own 14-day term, applied from today rather than carried.
    expect(draft.dueDate).toBe("2026-09-24");
    expect(draft.status).toBe("draft");
    // Everything worth retyping came across.
    expect(draft.billTo).toBe("Client Co");
    expect(draft.items[0].description).toBe("Consulting");
    // And no Rule 53 reference: an invoice corrects nothing.
    expect(draft.originalInvoice).toBeUndefined();
    expect(draft.reasonForIssue).toBe("");
  });

  it("attaches the Rule 53 reference to a note and drops the client's TDS", () => {
    const invoice = record({
      _id: "inv-3",
      invoiceNumber: "INV/2026-27/003",
      invoiceDate: "2026-07-01",
      tdsSection: "194J_professional",
      tdsRatePercent: 10,
    });
    const draft = applyDocumentKindToDraft(
      mapInvoiceRecordToFormState(invoice),
      { documentKind: "credit_note", source: invoice }
    );

    expect(draft.documentKind).toBe("credit_note");
    expect(draft.originalInvoice).toEqual({
      invoiceId: "inv-3",
      invoiceNumber: "INV/2026-27/003",
      invoiceDate: "2026-07-01",
    });
    // TDS is the CLIENT's withholding against the invoice; re-stating it on the
    // note would double-count it against the supplier's PAN.
    expect(draft.tdsSection).toBe("none");
    expect(draft.tdsRatePercent).toBe(0);
    expect(draft.status).toBe("draft");
  });
});

/* -------------------------------------------------------------------------- */
/* What actually gets printed                                                 */
/* -------------------------------------------------------------------------- */

describe("createInvoiceHtml — proforma", () => {
  const proforma = gstRecord({
    documentKind: "proforma",
    invoiceNumber: "PI/2026-27/001",
  });

  it("heads it PROFORMA INVOICE even though the supplier is registered", () => {
    const html = createInvoiceHtml(proforma);
    expect(html).toContain("<h1>PROFORMA INVOICE</h1>");
    expect(html).not.toContain("<h1>TAX INVOICE</h1>");
  });

  it("prints the not-a-tax-invoice statement", () => {
    expect(createInvoiceHtml(proforma)).toContain("not a tax invoice");
  });

  it("labels the meta block for a proforma rather than an invoice", () => {
    const html = createInvoiceHtml(proforma);
    expect(html).toContain("Proforma Number");
    expect(html).toContain("Valid Until");
    expect(html).not.toContain(">Invoice Number<");
  });
});

describe("createInvoiceHtml — credit note", () => {
  const creditNote = gstRecord({
    documentKind: "credit_note",
    invoiceNumber: "CN/2026-27/001",
    reasonForIssue: "Sales return",
    originalInvoice: {
      invoiceId: "inv-1",
      invoiceNumber: "INV/2026-27/007",
      invoiceDate: "2026-07-01",
    },
  });

  it("carries Rule 53(1A)'s mandatory particulars", () => {
    const html = createInvoiceHtml(creditNote);
    expect(html).toContain("CREDIT NOTE");
    expect(html).toContain("Original Invoice Number");
    expect(html).toContain("INV/2026-27/007");
    expect(html).toContain("Original Invoice Date");
    expect(html).toContain("Reason");
    expect(html).toContain("Sales return");
  });

  it("calls the grand total what it is", () => {
    expect(createInvoiceHtml(creditNote)).toContain("Total Credited");
  });

  it("escapes the reference and the reason, like every other interpolation", () => {
    // The sheet renders in a same-origin iframe; nothing here may be markup.
    const html = createInvoiceHtml(
      gstRecord({
        documentKind: "credit_note",
        reasonForIssue: '<script>alert("x")</script>',
        originalInvoice: {
          invoiceId: "inv-1",
          invoiceNumber: '<img src=x onerror=alert(1)>',
          invoiceDate: "2026-07-01",
        },
      })
    );
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x onerror");
    expect(html).toContain("&lt;script&gt;");
  });

  it("adds no disclaimer for a registered supplier and one for everyone else", () => {
    expect(createInvoiceHtml(creditNote)).not.toContain("commercial credit note");
    const unregistered = createInvoiceHtml(
      record({
        documentKind: "credit_note",
        taxTreatment: "none",
        documentType: "invoice",
        originalInvoice: {
          invoiceId: "inv-1",
          invoiceNumber: "INV-7",
          invoiceDate: "2026-07-01",
        },
      })
    );
    expect(unregistered).toContain("commercial credit note");
  });
});

describe("createInvoiceCsv — new document kinds", () => {
  it("names the document and its reference", () => {
    const csv = createInvoiceCsv(
      gstRecord({
        documentKind: "credit_note",
        invoiceNumber: "CN/2026-27/001",
        reasonForIssue: "Post-supply discount",
        originalInvoice: {
          invoiceId: "inv-1",
          invoiceNumber: "INV/2026-27/007",
          invoiceDate: "2026-07-01",
        },
      })
    );
    expect(csv).toContain('"Document Type","CREDIT NOTE"');
    expect(csv).toContain('"Original Invoice Number","INV/2026-27/007"');
    expect(csv).toContain('"Total Credited"');
  });

  it("carries a proforma's declaration", () => {
    const csv = createInvoiceCsv(gstRecord({ documentKind: "proforma" }));
    expect(csv).toContain('"Document Type","PROFORMA INVOICE"');
    expect(csv).toContain("not a tax invoice");
  });
});

describe("a document written before any of this existed", () => {
  // The regression that must never go red: no kind, no treatment, flat legacy
  // tax. Everything it printed before, it still prints.
  const legacy = record({ cgst: undefined, sgst: undefined, tax: 18, total: 118 });

  it("keeps its heading, its labels and its totals", () => {
    const html = createInvoiceHtml(legacy);
    expect(html).toContain("<h1>INVOICE</h1>");
    expect(html).toContain("Invoice Number");
    expect(html).toContain("Due Date");
    expect(html).not.toContain("not a tax invoice");
    expect(html).not.toContain("Original Invoice");

    const amounts = resolveRecordAmounts(legacy);
    expect(amounts.total).toBe(118);
    expect(buildTotalsRows(amounts).map((row) => row.label)).toEqual([
      "Subtotal",
      "Discount",
      "CGST",
      "SGST",
      "Service Charge",
      "Total",
    ]);
  });

  it("is offered the invoice series, because absence IS the invoice series", () => {
    expect(documentKindSpecFor(legacy.documentKind).numberPattern).toBe(
      "INV/{FY}/{SEQ:3}"
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Drafts                                                                     */
/* -------------------------------------------------------------------------- */

describe("invoiceDraftKey — one slot per document kind", () => {
  it("keeps a proforma draft out of the invoice draft's slot", () => {
    const invoice = invoiceDraftKey({ userId: "u1", mode: "create" });
    const proforma = invoiceDraftKey({
      userId: "u1",
      mode: "create",
      documentKind: "proforma",
    });
    expect(proforma).not.toBe(invoice);
    expect(proforma).toBe("invoicey-draft:u1:create:proforma");
  });

  it("leaves the invoice key byte-for-byte as it was, so old drafts restore", () => {
    // Absence and "invoice" are the same slot — the same trick the unique index
    // uses, and the reason no draft written before Phase 4 is lost.
    expect(invoiceDraftKey({ userId: "u1", mode: "create" })).toBe(
      "invoicey-draft:u1:create"
    );
    expect(
      invoiceDraftKey({ userId: "u1", mode: "create", documentKind: "invoice" })
    ).toBe("invoicey-draft:u1:create");
  });

  it("ignores the kind in edit mode, where the invoice id already keys it", () => {
    expect(
      invoiceDraftKey({
        userId: "u1",
        mode: "edit",
        invoiceId: "abc",
        documentKind: "credit_note",
      })
    ).toBe("invoicey-draft:u1:edit:abc");
  });
});
