import {
  InvoiceRecord,
  formatCurrency,
  formatDateLong,
  getInvoiceStatus,
} from "@/lib/invoices";
import {
  resolveRecordAmounts,
  buildTotalsRows,
  type InvoiceTotals,
} from "@/lib/invoice-domain";
import {
  COMPOSITION_BANNER,
  DOCUMENT_TITLES,
  EXPORT_ENDORSEMENT_UNDER_LUT,
  EXPORT_ENDORSEMENT_WITH_TAX,
  TAX_SUPPRESSION_NOTES,
  documentTypeFor,
  type DocumentType,
  type SupplyKind,
} from "@/lib/gst-supply";
import { formatGstRate, placeOfSupplyLabelFor } from "@/lib/gst-rates";
import { amountInWordsIndian } from "@/lib/amount-in-words";

const escapeHtml = (value: string) => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

const toSafeValue = (value: string | undefined) => {
  return escapeHtml(value?.trim() || "-");
};

const toLineBreaks = (value: string | undefined) => {
  return toSafeValue(value).replaceAll("\n", "<br />");
};

// Neutralize spreadsheet formula injection: a cell beginning with =, +, -, @,
// tab or CR is treated as a formula by Excel/Sheets. Prefix such values with a
// single quote so they are rendered as literal text.
const neutralizeCsvValue = (value: string) => {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
};

const toSafeImageUrl = (value: string | undefined) => {
  const trimmed = value?.trim() || "";
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    const allowedProtocols = ["http:", "https:", "data:"];
    if (!allowedProtocols.includes(parsed.protocol)) {
      return "";
    }
    return escapeHtml(trimmed);
  } catch {
    return "";
  }
};

/* -------------------------------------------------------------------------- */
/* Shared line-item table                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The line-item table's columns, as a data structure both renderers read.
 *
 * WHY THIS LIVES IN THE EXPORT MODULE. It belongs next to `buildTotalsRows` in
 * `lib/invoice-domain.ts` — that is the module whose whole job is "one shape,
 * every renderer", and putting it there would let `components/InvoiceModal.tsx`
 * pick the new columns up as well. This change set is not allowed to edit
 * `lib/invoice-domain.ts`, and the only other file both the editor's preview
 * and the HTML/CSV exporters can share is this one. It is pure, imports no DOM
 * and no React, so living here costs nothing but the odd-looking import in the
 * editor. Move it to `lib/invoice-domain.ts` when that file is next open, and
 * route `InvoiceModal` through it at the same time.
 *
 * The point is drift: item 6 adds four columns to a table that exists twice in
 * JSX and once as a raw HTML string. Without a shared column list the three
 * renderings disagree about which columns exist, in what order, and what an
 * empty one means — exactly what `buildTotalsRows` was introduced to stop
 * happening to the totals.
 */
export type LineItemColumnKey =
  | "index"
  | "description"
  | "hsnSac"
  | "unit"
  | "quantity"
  | "unitPrice"
  | "discount"
  | "taxRate"
  | "tax"
  | "amount";

export interface LineItemColumn {
  key: LineItemColumnKey;
  label: string;
  align: "left" | "right";
  /**
   * Print hint. Exactly one column wraps (the description); everything else is
   * `white-space: nowrap` so an eight-column A4 table cannot collapse into
   * unreadable slivers. Item 8(6).
   */
  wrap: boolean;
}

/** Accepts a DB item (`name`/`price`) or a form item (`description`/`unitPrice`). */
export interface LineItemSource {
  name?: string;
  description?: string;
  quantity?: number;
  price?: number;
  unitPrice?: number;
  hsnSac?: string;
  unit?: string;
}

export interface LineItemTableInput {
  items: LineItemSource[];
  totals: InvoiceTotals;
  currency: string;
}

const ALL_LINE_ITEM_COLUMNS: LineItemColumn[] = [
  { key: "index", label: "#", align: "left", wrap: false },
  { key: "description", label: "Description", align: "left", wrap: true },
  { key: "hsnSac", label: "HSN/SAC", align: "left", wrap: false },
  { key: "unit", label: "UOM", align: "left", wrap: false },
  { key: "quantity", label: "Qty", align: "right", wrap: false },
  { key: "unitPrice", label: "Unit Price", align: "right", wrap: false },
  { key: "discount", label: "Discount", align: "right", wrap: false },
  { key: "taxRate", label: "Rate", align: "right", wrap: false },
  { key: "tax", label: "Tax", align: "right", wrap: false },
  { key: "amount", label: "Amount", align: "right", wrap: false },
];

const hasText = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Which columns this invoice actually needs.
 *
 * An optional column appears only when at least one line populates it. A column
 * of empty cells is worse than no column at A4 width (item 8(6)), and an
 * "HSN/SAC" heading over eight blanks reads as a document that forgot to fill
 * itself in rather than one that never needed the field.
 */
export const buildLineItemColumns = (
  input: LineItemTableInput
): LineItemColumn[] => {
  const lines = input.totals.lines ?? [];
  const present = new Set<LineItemColumnKey>([
    "index",
    "description",
    "quantity",
    "unitPrice",
    "amount",
  ]);

  if (input.items.some((item) => hasText(item.hsnSac))) {
    present.add("hsnSac");
  }
  if (input.items.some((item) => hasText(item.unit))) {
    present.add("unit");
  }
  if (lines.some((line) => line.lineDiscount > 0)) {
    present.add("discount");
  }
  if (lines.some((line) => line.ratePercent > 0)) {
    present.add("taxRate");
  }
  // The per-line tax column tracks the TOTALS block: if no tax row is printed
  // (unregistered, composition, reverse charge, zero-rated under LUT) then no
  // tax was charged, and a per-line tax column of zeros would contradict that.
  if ((input.totals.taxRows ?? []).length > 0) {
    present.add("tax");
  }

  return ALL_LINE_ITEM_COLUMNS.filter((column) => present.has(column.key));
};

/**
 * One row's cells, as PLAIN TEXT aligned to `columns`.
 *
 * Text, never markup: the HTML renderer escapes every cell, the CSV renderer
 * neutralizes every cell, and React escapes by construction. A helper that
 * returned HTML would make the escaping the caller's problem in three places.
 */
export interface LineItemCellOptions {
  /**
   * Emit bare numbers ("50000.00", "18") instead of display text
   * ("₹50,000.00", "18%").
   *
   * The CSV sets this. A spreadsheet cell holding "₹50,000.00" is a STRING —
   * it will not sum, and the CSV existed to be summed. The HTML and the live
   * preview want the formatted form, and both read the same column list either
   * way, which is the whole point of the shared builder.
   */
  rawNumbers?: boolean;
}

export const buildLineItemCells = (
  columns: LineItemColumn[],
  input: LineItemTableInput,
  index: number,
  options: LineItemCellOptions = {}
): string[] => {
  const item = input.items[index] ?? {};
  const line = input.totals.lines?.[index];
  const currency = input.currency || "INR";
  const quantity = Number(item.quantity ?? 0);
  const unitPrice = Number(item.unitPrice ?? item.price ?? 0);
  const lineTax = line
    ? line.tax.cgst + line.tax.sgst + line.tax.igst
    : 0;
  const money = (value: number): string =>
    options.rawNumbers ? value.toFixed(2) : formatCurrency(value, currency);

  return columns.map((column) => {
    switch (column.key) {
      case "index":
        return String(index + 1);
      case "description":
        return (item.description ?? item.name ?? "").trim();
      case "hsnSac":
        return (item.hsnSac ?? "").trim();
      case "unit":
        return (item.unit ?? "").trim();
      case "quantity":
        return String(quantity);
      case "unitPrice":
        return money(unitPrice);
      case "discount":
        return money(line?.lineDiscount ?? 0);
      case "taxRate":
        if (!line || line.ratePercent <= 0) {
          return options.rawNumbers ? "0" : "-";
        }
        return options.rawNumbers
          ? String(line.ratePercent)
          : formatGstRate(line.ratePercent);
      case "tax":
        return money(lineTax);
      case "amount":
        return money(line ? line.gross : quantity * unitPrice);
      default:
        return "";
    }
  });
};

/* -------------------------------------------------------------------------- */
/* GST presentation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The document heading. A record written before Phase 2 carries no
 * `taxTreatment` at all and keeps the plain "INVOICE" it has always printed —
 * re-printing a document a client already holds must not change its heading.
 */
const documentTypeForRecord = (invoice: InvoiceRecord): DocumentType => {
  if (invoice.documentType) {
    return invoice.documentType;
  }
  return invoice.taxTreatment
    ? documentTypeFor(invoice.taxTreatment)
    : "invoice";
};

/**
 * The Rule 46 proviso endorsement, VERBATIM from `lib/gst-supply.ts`.
 *
 * Statutory wording: it is returned by identity, never rebuilt from parts, so
 * the string on the page is byte-for-byte the constant. Do not reflow, re-case,
 * or "improve" it, and do not interpolate anything into it.
 */
export const exportEndorsementFor = (input: {
  supplyKind?: SupplyKind;
  withPaymentOfTax?: boolean;
}): string | null => {
  if (input.supplyKind !== "export" && input.supplyKind !== "sez") {
    return null;
  }
  return input.withPaymentOfTax
    ? EXPORT_ENDORSEMENT_WITH_TAX
    : EXPORT_ENDORSEMENT_UNDER_LUT;
};

/** The printed place of supply: the stored label, else the code's own name. */
const placeOfSupplyText = (invoice: InvoiceRecord): string => {
  const stored = (invoice.placeOfSupplyLabel ?? "").trim();
  if (stored) {
    return stored;
  }
  return placeOfSupplyLabelFor(invoice.placeOfSupplyStateCode);
};

/** GST particulars, as label/value pairs. Empty when the document has none. */
const gstDetailRows = (invoice: InvoiceRecord): Array<[string, string]> => {
  if (!invoice.taxTreatment) {
    return [];
  }

  const rows: Array<[string, string]> = [];
  const placeOfSupply = placeOfSupplyText(invoice);
  if (placeOfSupply) {
    rows.push(["Place of Supply", placeOfSupply]);
  }
  if ((invoice.countryOfDestination ?? "").trim()) {
    rows.push(["Country of Destination", invoice.countryOfDestination!.trim()]);
  }
  if ((invoice.lutArn ?? "").trim()) {
    rows.push(["LUT ARN", invoice.lutArn!.trim()]);
  }
  // Rule 46(o) asks for the INDICATOR, not the flag: print it even when it is
  // "No", on every GST document.
  if (invoice.taxTreatment !== "none") {
    rows.push(["Reverse Charge", invoice.reverseCharge ? "Yes" : "No"]);
  }
  return rows;
};

/** "This is a computer-generated invoice…" — ubiquitous practice, not a safe harbour. */
const COMPUTER_GENERATED_NOTE =
  "This is a computer-generated invoice and does not require a signature.";

interface CreateInvoiceHtmlOptions {
  autoPrint?: boolean;
}

export const createInvoiceHtml = (
  invoice: InvoiceRecord,
  options: CreateInvoiceHtmlOptions = {}
) => {
  const amounts = resolveRecordAmounts(invoice);
  const status = getInvoiceStatus(invoice).toUpperCase();
  const currency = invoice.currency || "INR";
  const logoUrl = toSafeImageUrl(invoice.companyLogo);
  const documentType = documentTypeForRecord(invoice);
  const tableInput: LineItemTableInput = {
    items: invoice.items || [],
    totals: amounts,
    currency,
  };
  const columns = buildLineItemColumns(tableInput);
  const endorsement = exportEndorsementFor(invoice);
  const suppressionNote = amounts.suppressedBecause
    ? TAX_SUPPRESSION_NOTES[amounts.suppressedBecause]
    : "";
  const amountInWords = amountInWordsIndian(amounts.total, currency);
  const gstRows = gstDetailRows(invoice);
  const signatureLabel = `For ${invoice.companyName?.trim() || "us"}`;

  // One class list per column, shared by the header and every body cell, so a
  // column cannot be right-aligned in the head and left-aligned in the body.
  const columnClass = (column: LineItemColumn) =>
    [
      `col-${column.key}`,
      column.wrap ? "wrap" : "",
      column.align === "right" ? "align-right" : "",
    ]
      .filter(Boolean)
      .join(" ");

  const headCells = columns
    .map(
      (column) =>
        `<th class="${columnClass(column)}">${escapeHtml(column.label)}</th>`
    )
    .join("");

  const rows = (invoice.items || [])
    .map((_, index) => {
      const cells = buildLineItemCells(columns, tableInput, index)
        .map(
          (cell, cellIndex) =>
            `<td class="${columnClass(columns[cellIndex])}">${escapeHtml(
              cell || "-"
            )}</td>`
        )
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(DOCUMENT_TITLES[documentType])} ${toSafeValue(
    invoice.invoiceNumber
  )}</title>
    <style>
      :root {
        color-scheme: only light;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 24px;
        /* Same Helvetica stack as the app, so the document the client
           receives is set in the same face the user composed it in. */
        font-family: "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif;
        color: #111827;
        background: #f3f4f6;
        /* Never strand one line of a paragraph on its own page. */
        orphans: 3;
        widows: 3;
      }

      .sheet {
        max-width: 880px;
        margin: 0 auto;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 14px;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(15, 23, 42, 0.1);
      }

      .header {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        padding: 28px;
        border-bottom: 2px solid #0f172a;
      }

      .brand h1 {
        margin: 0;
        font-size: 28px;
        letter-spacing: 0.04em;
      }

      .brand-wrap {
        display: flex;
        align-items: flex-start;
        gap: 14px;
      }

      .brand-logo {
        width: 54px;
        height: 54px;
        border-radius: 10px;
        border: 1px solid #d1d5db;
        object-fit: contain;
        padding: 6px;
        background: #ffffff;
        flex-shrink: 0;
      }

      .brand p {
        margin: 8px 0 0;
        color: #4b5563;
        line-height: 1.5;
      }

      .meta {
        min-width: 260px;
      }

      .meta .label {
        color: #6b7280;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .meta .value {
        color: #111827;
        font-size: 14px;
        font-weight: 600;
        margin: 3px 0 12px;
      }

      .status {
        display: inline-block;
        padding: 6px 10px;
        background: #0f172a;
        color: #ffffff;
        border-radius: 999px;
        font-size: 12px;
        letter-spacing: 0.06em;
      }

      /* Statutory strips: the composition declaration (Rule 5(f)) and the
         export/SEZ endorsement (Rule 46 proviso). Both are printed verbatim. */
      .statute {
        margin: 0;
        padding: 12px 28px;
        border-bottom: 1px solid #e5e7eb;
        background: #f8fafc;
        color: #0f172a;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.02em;
        line-height: 1.5;
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .addresses {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        padding: 24px 28px;
      }

      .box {
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 14px;
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .box-title {
        margin: 0 0 8px;
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #6b7280;
      }

      .box-value {
        margin: 0;
        white-space: pre-line;
        color: #1f2937;
        line-height: 1.45;
      }

      .gst-details {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px 20px;
        padding: 0 28px 20px;
        font-size: 12px;
      }

      .gst-details .label {
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-size: 11px;
      }

      .gst-details .value {
        color: #111827;
        font-weight: 600;
        margin-top: 2px;
      }

      table {
        width: calc(100% - 56px);
        margin: 0 28px 24px;
        border-collapse: collapse;
      }

      /* Item 8(1): without these, page two of a two-page invoice has an
         unlabelled item table. */
      thead {
        display: table-header-group;
      }

      tfoot {
        display: table-footer-group;
      }

      /* Item 8(2): never split one line item across a page break. */
      tbody tr {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      thead th {
        text-align: left;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #6b7280;
        padding: 12px 10px;
        border-bottom: 1px solid #d1d5db;
        white-space: nowrap;
      }

      tbody td {
        font-size: 13px;
        color: #111827;
        padding: 12px 10px;
        border-bottom: 1px solid #f1f5f9;
        vertical-align: top;
        white-space: nowrap;
      }

      /* Item 8(6): the description absorbs the slack; every other column keeps
         its content on one line so eight columns still fit A4. */
      th.wrap,
      td.wrap {
        white-space: normal;
        width: 100%;
      }

      tbody tr:last-child td {
        border-bottom: none;
      }

      .summary {
        display: flex;
        justify-content: flex-end;
        padding: 0 28px 24px;
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .summary table {
        width: 320px;
        margin: 0;
      }

      .summary td {
        border-bottom: none;
        padding: 7px 0;
        white-space: nowrap;
      }

      .summary .amount {
        text-align: right;
        font-weight: 600;
      }

      .align-right {
        text-align: right;
      }

      /* Every figure that stacks: line-item columns and the totals ladder. */
      .summary td,
      tbody td.align-right,
      thead th.align-right {
        font-variant-numeric: tabular-nums;
        font-feature-settings: "tnum";
      }

      .summary .grand td {
        border-top: 1px solid #d1d5db;
        padding-top: 10px;
        font-size: 15px;
        font-weight: 700;
      }

      .tax-note {
        padding: 0 28px 16px;
        margin: -12px 0 0;
        color: #4b5563;
        font-size: 12px;
        text-align: right;
      }

      .words {
        padding: 0 28px 20px;
        color: #374151;
        font-size: 12px;
        line-height: 1.5;
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .words strong {
        color: #111827;
      }

      .notes {
        padding: 0 28px 28px;
        color: #374151;
        font-size: 13px;
        line-height: 1.5;
      }

      .notes h3 {
        margin: 0 0 8px;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #6b7280;
      }

      .notes h3 + p {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .signature {
        display: flex;
        justify-content: flex-end;
        padding: 0 28px 24px;
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .signature-block {
        width: 260px;
        text-align: right;
        color: #374151;
        font-size: 12px;
      }

      .signature-rule {
        margin-top: 48px;
        border-top: 1px solid #9ca3af;
        padding-top: 6px;
        color: #6b7280;
      }

      .footer {
        border-top: 1px solid #e5e7eb;
        padding: 14px 28px;
        font-size: 11px;
        color: #6b7280;
      }

      @page {
        size: A4;
        margin: 14mm;
      }

      @media print {
        body {
          background: #ffffff;
          padding: 0;
        }

        .sheet {
          border: none;
          box-shadow: none;
          max-width: none;
          border-radius: 0;
          /* Item 8(3): overflow:hidden is a rounded-corner trick that some
             print engines read as "clip to one page", silently dropping
             everything after the first. */
          overflow: visible;
        }
      }
    </style>
  </head>
  <body>
    <article class="sheet">
      <section class="header">
        <div class="brand-wrap">
          ${
            logoUrl
              ? `<img src="${logoUrl}" alt="Company logo" class="brand-logo" />`
              : ""
          }
          <div class="brand">
            <h1>${escapeHtml(DOCUMENT_TITLES[documentType])}</h1>
            <p>
              <strong>${toSafeValue(invoice.companyName)}</strong><br />
              ${toLineBreaks(invoice.companyAddress)}<br />
              ${toSafeValue(invoice.companyEmail)}${
    invoice.companyPhone ? ` · ${toSafeValue(invoice.companyPhone)}` : ""
  }
            </p>
          </div>
        </div>
        <div class="meta">
          <div class="label">Invoice Number</div>
          <div class="value">${toSafeValue(invoice.invoiceNumber)}</div>
          <div class="label">Invoice Date</div>
          <div class="value">${escapeHtml(formatDateLong(invoice.invoiceDate))}</div>
          <div class="label">Due Date</div>
          <div class="value">${escapeHtml(formatDateLong(invoice.dueDate))}</div>
          <span class="status">${escapeHtml(status)}</span>
        </div>
      </section>

      ${
        invoice.taxTreatment === "composition"
          ? `<p class="statute">${escapeHtml(COMPOSITION_BANNER)}</p>`
          : ""
      }
      ${
        endorsement
          ? `<p class="statute">${escapeHtml(endorsement)}</p>`
          : ""
      }

      <section class="addresses">
        <div class="box">
          <h2 class="box-title">Bill From</h2>
          <p class="box-value">
            ${toSafeValue(invoice.companyName)}
            ${invoice.companyAddress ? `<br />${toLineBreaks(invoice.companyAddress)}` : ""}
            ${invoice.companyEmail ? `<br />${toSafeValue(invoice.companyEmail)}` : ""}
          </p>
        </div>
        <div class="box">
          <h2 class="box-title">Bill To</h2>
          <p class="box-value">
            ${toSafeValue(invoice.billTo)}
            ${invoice.billToAddress ? `<br />${toLineBreaks(invoice.billToAddress)}` : ""}
            ${invoice.billToEmail ? `<br />${toSafeValue(invoice.billToEmail)}` : ""}
          </p>
        </div>
      </section>

      ${
        gstRows.length
          ? `<section class="gst-details">
            ${gstRows
              .map(
                ([label, value]) =>
                  `<div><div class="label">${escapeHtml(
                    label
                  )}</div><div class="value">${escapeHtml(value)}</div></div>`
              )
              .join("\n            ")}
          </section>`
          : ""
      }

      <table>
        <thead>
          <tr>${headCells}</tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>

      <section class="summary">
        <table>
          <tbody>
            ${buildTotalsRows(amounts)
              .map((row) => {
                const prefix = row.kind === "discount" ? "- " : "";
                const rowClass = row.kind === "grand" ? ' class="grand"' : "";
                return `<tr${rowClass}>
              <td>${escapeHtml(row.label)}</td>
              <td class="amount">${prefix}${escapeHtml(
                  formatCurrency(row.amount, currency)
                )}</td>
            </tr>`;
              })
              .join("\n            ")}
          </tbody>
        </table>
      </section>

      ${
        suppressionNote
          ? `<p class="tax-note">${escapeHtml(suppressionNote)}</p>`
          : ""
      }

      ${
        amountInWords
          ? `<section class="words"><strong>Amount in words:</strong> ${escapeHtml(
              amountInWords
            )}</section>`
          : ""
      }

      <section class="notes">
        ${
          invoice.terms
            ? `<h3>Terms</h3><p>${toLineBreaks(invoice.terms)}</p>`
            : ""
        }
        ${
          invoice.paymentInfo
            ? `<h3>Payment Information</h3><p>${toLineBreaks(invoice.paymentInfo)}</p>`
            : ""
        }
        ${
          invoice.notes
            ? `<h3>Additional Notes</h3><p>${toLineBreaks(invoice.notes)}</p>`
            : ""
        }
      </section>

      <section class="signature">
        <div class="signature-block">
          <div>${escapeHtml(signatureLabel)}</div>
          <div class="signature-rule">Authorised Signatory</div>
          <div style="margin-top: 10px">${escapeHtml(
            COMPUTER_GENERATED_NOTE
          )}</div>
        </div>
      </section>

      <footer class="footer">
        Generated by Invoicey • ${escapeHtml(formatDateLong(new Date()))}
      </footer>
    </article>
    ${
      options.autoPrint
        ? `<script>
            window.addEventListener("load", function () {
              // Item 8(4): the load event fires before web fonts settle and
              // before a remote logo decodes, so the print dialog could capture
              // a logo-less, fallback-font page. The 3s race is not optional —
              // a company logo pointing at a dead host must never stop the user
              // printing.
              var images = Array.prototype.slice.call(document.images).map(
                function (img) {
                  return img.complete
                    ? Promise.resolve()
                    : img.decode
                      ? img.decode().catch(function () {})
                      : new Promise(function (done) {
                          img.addEventListener("load", done);
                          img.addEventListener("error", done);
                        });
                }
              );
              var fonts = document.fonts ? document.fonts.ready : Promise.resolve();
              var settled = Promise.all([fonts].concat(images));
              var deadline = new Promise(function (done) {
                setTimeout(done, 3000);
              });
              Promise.race([settled, deadline]).then(function () {
                window.focus();
                window.print();
              });
            });
          </script>`
        : ""
    }
  </body>
</html>
  `.trim();
};

export const createInvoiceCsv = (invoice: InvoiceRecord) => {
  const amounts = resolveRecordAmounts(invoice);
  const currency = invoice.currency || "INR";
  const tableInput: LineItemTableInput = {
    items: invoice.items || [],
    totals: amounts,
    currency,
  };
  const columns = buildLineItemColumns(tableInput);
  const endorsement = exportEndorsementFor(invoice);
  const amountInWords = amountInWordsIndian(amounts.total, currency);

  const rows: Array<Array<string | undefined>> = [
    ["Invoice Number", invoice.invoiceNumber],
    ["Document Type", DOCUMENT_TITLES[documentTypeForRecord(invoice)]],
    ["Company", invoice.companyName],
    ["Client", invoice.billTo],
    ["Invoice Date", formatDateLong(invoice.invoiceDate)],
    ["Due Date", formatDateLong(invoice.dueDate)],
    ["Currency", currency],
    // Same label/value pairs the HTML prints, from the same builder.
    ...gstDetailRows(invoice).map(([label, value]) => [label, value]),
    ...(invoice.taxTreatment === "composition"
      ? [["Declaration", COMPOSITION_BANNER]]
      : []),
    ...(endorsement ? [["Endorsement", endorsement]] : []),
    [],
    columns.map((column) => column.label),
    ...(invoice.items || []).map((_, index) =>
      buildLineItemCells(columns, tableInput, index, { rawNumbers: true })
    ),
    [],
    ...buildTotalsRows(amounts).map((row) => [
      row.label,
      String(row.amount.toFixed(2)),
    ]),
    ...(amounts.suppressedBecause
      ? [["Note", TAX_SUPPRESSION_NOTES[amounts.suppressedBecause]]]
      : []),
    ...(amountInWords ? [["Amount in words", amountInWords]] : []),
  ];

  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell === undefined) {
            return "";
          }
          const value = neutralizeCsvValue(String(cell));
          return `"${value.replaceAll('"', '""')}"`;
        })
        .join(",")
    )
    .join("\n");
};
