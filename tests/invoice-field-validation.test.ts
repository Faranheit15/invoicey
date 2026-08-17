import { describe, it, expect } from "bun:test";
import {
  INVOICE_FIELD_ATTRIBUTE,
  collectInvoiceIssues,
  firstInvoiceIssue,
  focusFirstInvoiceIssue,
  focusInvoiceField,
  invoiceFieldSelector,
  type FocusableElement,
  type FocusableRoot,
} from "@/lib/invoice-field-validation";
import { validateInvoice } from "@/lib/invoice-domain";
import type { ValidatableInvoice } from "@/lib/invoice-domain";

const valid = (overrides: Partial<ValidatableInvoice> = {}): ValidatableInvoice => ({
  companyName: "Acme Studio",
  billTo: "Nova Health Pvt Ltd",
  invoiceNumber: "INV-2026-014",
  invoiceDate: "2026-08-01",
  dueDate: "2026-08-15",
  items: [{ description: "Monthly retainer" }],
  ...overrides,
});

const messages = (invoice: ValidatableInvoice) =>
  collectInvoiceIssues(invoice).issues.map((issue) => issue.message);

const fields = (invoice: ValidatableInvoice) =>
  collectInvoiceIssues(invoice).issues.map((issue) => issue.field);

describe("collectInvoiceIssues — agreement with the one validator", () => {
  it("reports nothing for a valid invoice", () => {
    const report = collectInvoiceIssues(valid());
    expect(report.isValid).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("is empty exactly when validateInvoice returns null", () => {
    const cases: ValidatableInvoice[] = [
      valid(),
      valid({ companyName: "" }),
      valid({ items: [] }),
      valid({ billToGstin: "NOTAGSTIN" }),
      valid({ taxTreatment: "gst", supplierStateCode: "" }),
    ];
    for (const invoice of cases) {
      const blocked = validateInvoice(invoice) !== null;
      expect(collectInvoiceIssues(invoice).issues.length > 0).toBe(blocked);
    }
  });

  it("puts the validator's own first error first", () => {
    const invoice = valid({ companyName: "", billTo: "" });
    // The friendly copy replaces the wording, so compare against the field.
    expect(fields(invoice)[0]).toBe("companyName");
    expect(validateInvoice(invoice)).toBe("Company name is required");
  });

  it("firstInvoiceIssue matches the head of the list", () => {
    const invoice = valid({ companyName: "", billTo: "" });
    expect(firstInvoiceIssue(invoice)).toEqual(collectInvoiceIssues(invoice).issues[0]);
    expect(firstInvoiceIssue(valid())).toBeNull();
  });
});

describe("collectInvoiceIssues — reporting every field at once", () => {
  it("reports all six required-field errors from one blank invoice", () => {
    // This is the audit's case: a blank form took up to six save attempts,
    // because the validator surfaces one error at a time.
    const blank: ValidatableInvoice = {
      companyName: "",
      billTo: "",
      invoiceNumber: "",
      invoiceDate: "",
      dueDate: "",
      items: [],
    };
    expect(fields(blank)).toEqual([
      "companyName",
      "billTo",
      "invoiceNumber",
      "invoiceDate",
      "dueDate",
      "items.0.description",
    ]);
  });

  it("reports both GSTINs when both are wrong", () => {
    const invoice = valid({ companyGstin: "NOPE", billToGstin: "ALSONOPE" });
    expect(fields(invoice)).toEqual(["companyGstin", "billToGstin"]);
  });

  it("reports a missing state and a missing place of supply together", () => {
    const invoice = valid({
      taxTreatment: "gst",
      supplierStateCode: "",
      placeOfSupplyStateCode: "",
    });
    expect(fields(invoice)).toEqual(["supplierStateCode", "placeOfSupplyStateCode"]);
  });

  it("reports a bad date alongside a GST problem", () => {
    const invoice = valid({
      dueDate: "not-a-date",
      taxTreatment: "gst",
      supplierStateCode: "",
      placeOfSupplyStateCode: "27",
    });
    expect(fields(invoice)).toEqual(["dueDate", "supplierStateCode"]);
  });

  it("names the offending line for a missing HSN code", () => {
    const invoice = valid({
      taxTreatment: "gst",
      supplierStateCode: "27",
      placeOfSupplyStateCode: "27",
      companyGstin: "27AAPFU0939F1ZV",
      items: [
        { description: "Consulting", hsnSac: "998314", taxRatePercent: 18 },
        { description: "Support", taxRatePercent: 18 },
      ],
    });
    const report = collectInvoiceIssues(invoice);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].field).toBe("items.1.hsnSac");
    expect(report.issues[0].itemIndex).toBe(1);
  });

  it("reports export country and LUT ARN together for a REGISTERED exporter", () => {
    const invoice = valid({
      taxTreatment: "gst",
      supplierStateCode: "27",
      placeOfSupplyStateCode: "96",
      companyGstin: "27AAPFU0939F1ZV",
      supplyKind: "export",
      countryOfDestination: "",
      withPaymentOfTax: false,
      lutArn: "",
    });
    expect(fields(invoice)).toEqual(["countryOfDestination", "lutArn"]);
  });

  // §1.2: an unregistered exporter is asked for the destination country and
  // nothing else. The LUT prompt was a dead end for them — see the validator.
  it("asks an UNREGISTERED exporter for the country and not for an LUT", () => {
    const invoice = valid({
      taxTreatment: "none",
      supplyKind: "export",
      countryOfDestination: "",
      withPaymentOfTax: false,
      lutArn: "",
    });
    expect(fields(invoice)).toEqual(["countryOfDestination"]);
  });

  it("points at the line carrying a rate GST does not have", () => {
    const invoice = valid({
      items: [
        { description: "Consulting", taxRatePercent: 18, hsnSac: "998314" },
        { description: "Support", taxRatePercent: 15 },
      ],
    });
    const report = collectInvoiceIssues(invoice);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].field).toBe("items.1.taxRatePercent");
    expect(report.issues[0].itemIndex).toBe(1);
  });

  it("focuses the number field for a Rule 46(b) charset break", () => {
    expect(fields(valid({ invoiceNumber: "INV#001" }))).toEqual([
      "invoiceNumber",
    ]);
    expect(fields(valid({ invoiceNumber: "INVOICE/2026-27/0001" }))).toEqual([
      "invoiceNumber",
    ]);
  });

  it("gives the state-mismatch error a control to focus", () => {
    const invoice = valid({
      companyGstin: "27AAPFU0939F1ZV",
      supplierStateCode: "29",
    });
    expect(fields(invoice)).toEqual(["supplierStateCode"]);
  });

  it("reports the SEZ/overseas contradiction against the SEZ flag", () => {
    const invoice = valid({ recipientIsSez: true, recipientIsOutsideIndia: true });
    expect(fields(invoice)).toEqual(["recipientIsSez"]);
  });

  it("gives a derivation tripwire no field — there is nothing to focus", () => {
    const invoice = valid({
      supplyKind: "inter",
      totals: { cgst: 90, sgst: 90, igst: 0 },
    });
    const report = collectInvoiceIssues(invoice);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].field).toBeNull();
    expect(report.issues[0].message).toContain("IGST");
  });
});

describe("collectInvoiceIssues — the repair loop itself", () => {
  it("terminates on an invoice that is wrong in every way at once", () => {
    const disaster: ValidatableInvoice = {
      companyName: "",
      billTo: "",
      invoiceNumber: "",
      invoiceDate: "nope",
      dueDate: "nope",
      items: [{ description: "", taxRatePercent: 18 }],
      companyGstin: "BAD",
      billToGstin: "ALSOBAD",
      taxTreatment: "gst",
      supplierStateCode: "",
      placeOfSupplyStateCode: "",
      recipientIsSez: true,
      recipientIsOutsideIndia: true,
    };
    const report = collectInvoiceIssues(disaster);
    // Every issue is distinct and the loop stopped on its own.
    expect(report.issues.length).toBeGreaterThan(6);
    const seen = new Set(report.issues.map((issue) => issue.message));
    expect(seen.size).toBe(report.issues.length);
  });

  it("never mutates the invoice it was given", () => {
    const invoice = valid({ companyName: "", items: [{ description: "" }] });
    const snapshot = JSON.stringify(invoice);
    collectInvoiceIssues(invoice);
    expect(JSON.stringify(invoice)).toBe(snapshot);
  });

  it("is deterministic across repeated calls", () => {
    const invoice = valid({ companyName: "", billTo: "", invoiceNumber: "" });
    expect(messages(invoice)).toEqual(messages(invoice));
  });

  it("carries warnings from the FIRST pass, not the repaired invoice", () => {
    // Repairing an invalid GSTIN clears it, which manufactures the "a tax
    // invoice should carry your GSTIN" warning. The user cannot act on a
    // warning about a field they did fill in, so it must not appear.
    const invoice = valid({
      taxTreatment: "gst",
      supplierStateCode: "27",
      placeOfSupplyStateCode: "27",
      companyGstin: "27AAPFU0939F1ZV",
      billToGstin: "GARBAGE",
    });
    const report = collectInvoiceIssues(invoice);
    expect(report.issues.map((issue) => issue.field)).toEqual(["billToGstin"]);
    expect(report.warnings.join(" ")).not.toContain("should carry your GSTIN");
  });

  it("surfaces the warnings the invoice really has", () => {
    const invoice = valid({
      taxTreatment: "gst",
      supplierStateCode: "27",
      placeOfSupplyStateCode: "27",
    });
    expect(collectInvoiceIssues(invoice).warnings.join(" ")).toContain(
      "should carry your GSTIN"
    );
  });

  it("covers every message the validator can return with a spec", () => {
    // A rule added to `validateInvoiceDetailed` without a spec here still gets
    // REPORTED (verbatim, unfocusable) but stops the enumeration. This asserts
    // the known set is covered: none of these fall through to a null field
    // except the two derivation tripwires, which have no control by design.
    const withField: ValidatableInvoice[] = [
      valid({ companyName: "" }),
      valid({ billTo: "" }),
      valid({ invoiceNumber: "" }),
      valid({ invoiceDate: "x" }),
      valid({ dueDate: "x" }),
      valid({ items: [] }),
      valid({ companyGstin: "BAD" }),
      valid({ billToGstin: "BAD" }),
      valid({ companyGstin: "27AAPFU0939F1ZV", supplierStateCode: "29" }),
      valid({ recipientIsSez: true, recipientIsOutsideIndia: true }),
      valid({ taxTreatment: "gst", supplierStateCode: "" }),
      valid({ taxTreatment: "gst", supplierStateCode: "27", placeOfSupplyStateCode: "" }),
      valid({
        taxTreatment: "gst",
        supplierStateCode: "27",
        placeOfSupplyStateCode: "27",
        items: [{ description: "x", taxRatePercent: 18 }],
      }),
      valid({ supplyKind: "export", countryOfDestination: "" }),
      valid({
        taxTreatment: "gst",
        supplierStateCode: "27",
        placeOfSupplyStateCode: "96",
        companyGstin: "27AAPFU0939F1ZV",
        supplyKind: "export",
        countryOfDestination: "US",
        withPaymentOfTax: false,
        lutArn: "",
      }),
      valid({ invoiceNumber: "INV#001" }),
      valid({ invoiceNumber: "INVOICE/2026-27/0001" }),
      valid({ items: [{ description: "x", taxRatePercent: 15 }] }),
    ];
    for (const invoice of withField) {
      const issues = collectInvoiceIssues(invoice).issues;
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].field).not.toBeNull();
    }
  });
});

/* --------------------------------------------------------------------------- *
 * Focus
 * --------------------------------------------------------------------------- */

class FakeElement implements FocusableElement {
  focused = false;
  scrolled = false;
  focusOptions: { preventScroll?: boolean } | undefined;
  focus(options?: { preventScroll?: boolean }) {
    this.focused = true;
    this.focusOptions = options;
  }
  scrollIntoView() {
    this.scrolled = true;
  }
}

class FakeRoot implements FocusableRoot {
  queries: string[] = [];
  constructor(private elements: Record<string, FakeElement>) {}
  querySelector(selector: string) {
    this.queries.push(selector);
    return this.elements[selector] ?? null;
  }
}

describe("focus helpers", () => {
  it("builds the data-attribute selector the editor stamps", () => {
    expect(invoiceFieldSelector("companyName")).toBe(
      `[${INVOICE_FIELD_ATTRIBUTE}="companyName"]`
    );
    expect(invoiceFieldSelector("items.3.hsnSac")).toBe(
      `[${INVOICE_FIELD_ATTRIBUTE}="items.3.hsnSac"]`
    );
  });

  it("escapes a quote rather than letting it end the selector early", () => {
    expect(invoiceFieldSelector('a"b')).toBe(
      `[${INVOICE_FIELD_ATTRIBUTE}="a\\"b"]`
    );
  });

  it("scrolls the field into the centre, then focuses without scrolling again", () => {
    // Focusing first would slam the control to the viewport edge with its label
    // off screen — the user then cannot see what is being asked of them.
    const element = new FakeElement();
    const root = new FakeRoot({
      [`[${INVOICE_FIELD_ATTRIBUTE}="companyName"]`]: element,
    });
    expect(focusInvoiceField("companyName", root)).toBe(true);
    expect(element.scrolled).toBe(true);
    expect(element.focused).toBe(true);
    expect(element.focusOptions).toEqual({ preventScroll: true });
  });

  it("reports false for a field the editor has not stamped", () => {
    expect(focusInvoiceField("companyName", new FakeRoot({}))).toBe(false);
  });

  it("focuses the first issue that has a findable control", () => {
    const target = new FakeElement();
    const root = new FakeRoot({
      [`[${INVOICE_FIELD_ATTRIBUTE}="billTo"]`]: target,
    });
    const focused = focusFirstInvoiceIssue(
      [
        { field: null, message: "no control" },
        { field: "companyName", message: "not in the DOM" },
        { field: "billTo", message: "this one" },
      ],
      root
    );
    expect(focused?.message).toBe("this one");
    expect(target.focused).toBe(true);
  });

  it("returns null when nothing can be focused", () => {
    expect(
      focusFirstInvoiceIssue([{ field: null, message: "banner only" }], new FakeRoot({}))
    ).toBeNull();
  });

  it("returns null for an empty issue list", () => {
    expect(focusFirstInvoiceIssue([], new FakeRoot({}))).toBeNull();
  });
});

describe("editor-local checks", () => {
  it("reports a due date that falls before the invoice date", () => {
    // Not a GST rule and not something the API rejects, so it is not in the
    // shared validator — but the editor has always blocked on it.
    const invoice = valid({ invoiceDate: "2026-08-15", dueDate: "2026-08-01" });
    const report = collectInvoiceIssues(invoice);
    expect(report.isValid).toBe(false);
    expect(report.issues).toEqual([
      {
        field: "dueDate",
        message: "The due date falls before the invoice date. Check both dates.",
      },
    ]);
  });

  it("allows a due date equal to the invoice date", () => {
    expect(
      collectInvoiceIssues(valid({ invoiceDate: "2026-08-15", dueDate: "2026-08-15" }))
        .isValid
    ).toBe(true);
  });

  it("appends after the shared validator's own errors", () => {
    const invoice = valid({
      companyName: "",
      invoiceDate: "2026-08-15",
      dueDate: "2026-08-01",
    });
    expect(fields(invoice)).toEqual(["companyName", "dueDate"]);
  });

  it("stays quiet when either date is unparseable — that error is reported already", () => {
    const invoice = valid({ invoiceDate: "nope", dueDate: "2026-08-01" });
    expect(fields(invoice)).toEqual(["invoiceDate"]);
  });
});
