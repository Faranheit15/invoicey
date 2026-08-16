import { describe, it, expect } from "bun:test";
import {
  buildLineItemColumns,
  buildTotalsRows,
  resolveRecordAmounts,
} from "@/lib/invoice-domain";
import {
  buildLineItemCells,
  createInvoiceCsv,
  createInvoiceHtml,
} from "@/lib/invoice-export";
import { formatCurrency } from "@/lib/invoices";
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

/**
 * The formula the view modal used to carry inline — a fourth copy that used `||`
 * on the stored total and applied neither the clamp nor the rounding. Kept here
 * only so the tests below can show what routing the modal through
 * `resolveRecordAmounts` actually changed on screen.
 */
const legacyModalTotals = (invoice: InvoiceRecord) => {
  const subtotal =
    invoice.subtotal ??
    invoice.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const discount = invoice.discount || 0;
  const cgst = invoice.cgst ?? invoice.tax ?? 0;
  const sgst = invoice.sgst || 0;
  const convenienceCharge = invoice.convenienceCharge || 0;
  return {
    subtotal,
    total:
      invoice.total ||
      subtotal - discount + cgst + sgst + convenienceCharge,
  };
};

/** What the modal renders, in the order it renders it. */
const modalTotalsRows = (invoice: InvoiceRecord) =>
  buildTotalsRows(resolveRecordAmounts(invoice)).map((row) => [
    row.label,
    `${row.kind === "discount" ? "- " : ""}${formatCurrency(
      row.amount,
      invoice.currency || "INR"
    )}`,
  ]);

describe("InvoiceModal totals", () => {
  it("honors a legitimately-zero stored total instead of recomputing it", () => {
    // A settled-to-zero or fully-discounted invoice: `||` treated the stored 0
    // as absent and printed a recomputed figure the server never agreed to.
    const invoice = makeRecord({ discount: 40, total: 0 });
    expect(legacyModalTotals(invoice).total).toBe(60);
    expect(resolveRecordAmounts(invoice).total).toBe(0);
  });

  it("clamps an over-discounted invoice at 0 rather than showing a negative total", () => {
    const invoice = makeRecord({
      discount: 150,
      total: undefined as unknown as number,
    });
    expect(legacyModalTotals(invoice).total).toBe(-50);
    expect(resolveRecordAmounts(invoice).total).toBe(0);
  });

  it("rounds the accumulated subtotal to 2dp", () => {
    const invoice = makeRecord({
      items: [{ name: "Hours", price: 10.1, quantity: 3 }],
      subtotal: undefined,
      total: undefined as unknown as number,
    });
    expect(legacyModalTotals(invoice).subtotal).toBe(30.299999999999997);
    expect(resolveRecordAmounts(invoice).subtotal).toBe(30.3);
  });

  it("keeps the legacy `tax` fallback for pre-migration documents", () => {
    const invoice = makeRecord({ cgst: undefined, tax: 18, total: undefined as unknown as number });
    const cgstRow = modalTotalsRows(invoice).find(([label]) => label === "CGST");
    expect(cgstRow?.[1]).toBe(formatCurrency(18, "INR"));
  });

  it("renders the same rows, labels and amounts as the export", () => {
    // The modal and the exported document are two renderings of one invoice;
    // this is the drift guard that the JSX preview already has.
    const invoice = makeRecord({
      items: [{ name: "Widget", price: 100, quantity: 3 }],
      discount: 25,
      cgst: 18,
      sgst: 18,
      convenienceCharge: 5,
      subtotal: undefined,
      total: undefined as unknown as number,
    });
    // The totals block is the last section, after the final blank line. It is
    // no longer the last thing in the file — "Amount in words" and the
    // tax-suppression note are printed after the Total, exactly as they are on
    // the document — so locate the section rather than counting back from the
    // end.
    const csvLines = createInvoiceCsv(invoice).split("\n");
    const csvTotals = csvLines
      .slice(csvLines.lastIndexOf("") + 1)
      .map((line) => line.split(",").map((cell) => cell.slice(1, -1)))
      .filter(([label]) => !["Amount in words", "Note"].includes(label));

    expect(modalTotalsRows(invoice).map(([label]) => label)).toEqual(
      csvTotals.map(([label]) => label)
    );
    expect(resolveRecordAmounts(invoice).total).toBe(316);
    expect(csvTotals.at(-1)).toEqual(["Total", "316.00"]);
  });
});

describe("InvoiceModal print document", () => {
  it("carries no self-print script when built for the print iframe", () => {
    // The modal drives `print()` from the iframe's load event so a failure is
    // observable; the document must not also print itself, or the dialog opens
    // twice.
    expect(createInvoiceHtml(makeRecord())).not.toContain("window.print()");
  });

  it("still emits the self-print script when explicitly asked", () => {
    expect(
      createInvoiceHtml(makeRecord(), { autoPrint: true })
    ).toContain("window.print()");
  });
});

describe("InvoiceModal line items", () => {
  it("renders the same columns as the exported document, in the same order", () => {
    // The modal used to hard-code five columns, so HSN/SAC, UOM, per-line rate
    // and per-line tax were invisible on the last screen the user checks before
    // sending. Both now read `buildLineItemColumns`.
    const invoice = makeRecord({
      taxTreatment: "gst",
      supplyKind: "intra",
      supplierStateCode: "29",
      placeOfSupplyStateCode: "29",
      items: [
        {
          name: "Consulting",
          price: 10_000,
          quantity: 1,
          hsnSac: "998314",
          unit: "HRS",
          taxRatePercent: 18,
        },
      ],
      subtotal: undefined,
      total: undefined as unknown as number,
    });
    const amounts = resolveRecordAmounts(invoice);
    const columns = buildLineItemColumns({
      items: invoice.items,
      totals: amounts,
      currency: invoice.currency,
    });
    expect(columns.map((column) => column.key)).toEqual([
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

    // The same cells the export writes into the printed table.
    expect(buildLineItemCells(columns, {
      items: invoice.items,
      totals: amounts,
      currency: invoice.currency,
    }, 0)).toEqual([
      "1",
      "Consulting",
      "998314",
      "HRS",
      "1",
      formatCurrency(10_000, "INR"),
      "18%",
      formatCurrency(1_800, "INR"),
      formatCurrency(10_000, "INR"),
    ]);
  });
});
