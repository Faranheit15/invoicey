import {
  InvoiceRecord,
  formatCurrency,
  formatDateLong,
  getInvoiceStatus,
} from "@/lib/invoices";
import {
  resolveRecordAmounts,
  buildLineItemColumns,
  buildTotalsRows,
  documentKindSpecFor,
  documentTaxNoticeFor,
  documentTitleFor,
  isCreditOrDebitNote,
  type LineItemColumn,
  type LineItemTableInput,
} from "@/lib/invoice-domain";
import {
  COMPOSITION_BANNER,
  EXPORT_ENDORSEMENT_UNDER_LUT,
  EXPORT_ENDORSEMENT_WITH_TAX,
  TAX_SUPPRESSION_NOTES,
  type SupplyKind,
  type TaxTreatment,
} from "@/lib/gst-supply";
import { formatGstRate, placeOfSupplyLabelFor } from "@/lib/gst-rates";
import { amountInWordsIndian } from "@/lib/amount-in-words";
import {
  buildUpiLink,
  isValidVpa,
  normalizeAccountNumber,
  normalizeIfsc,
  normalizeVpa,
  supportsUpi,
  toUpiReference,
  type UpiLink,
} from "@/lib/upi";
import { createQrSvg } from "@/lib/qr";

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
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return escapeHtml(trimmed);
    }
    // `data:` is narrowed to images, matching what the profile route and the
    // invoice route will actually store. A bare `data:` allowance let a
    // `data:text/html,…` through — inert in an `<img src>`, but this template
    // is rendered in a SAME-ORIGIN iframe, so it should not be one copy-paste
    // away from being a document source.
    if (parsed.protocol === "data:" && /^data:image\//i.test(trimmed)) {
      return escapeHtml(trimmed);
    }
    return "";
  } catch {
    return "";
  }
};

/* -------------------------------------------------------------------------- */
/* Shared line-item table                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `buildLineItemColumns` and its types now live in `lib/invoice-domain.ts`,
 * beside `buildTotalsRows`, on the same anti-drift principle — all three
 * renderers (editor preview, view modal, HTML/CSV export) read one column list.
 * Re-exported here so the two halves of the table stay importable from one
 * place for the exporters.
 */
export {
  buildLineItemColumns,
  type LineItemColumn,
  type LineItemColumnKey,
  type LineItemSource,
  type LineItemTableInput,
} from "@/lib/invoice-domain";

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
      // Rule 46(j). This is the base the line's tax was charged on — gross,
      // less the line's own discount, less its pro-rata share of the
      // invoice-level one — so `taxRate` x this equals `tax` on the page.
      case "taxable":
        return money(line ? line.taxable : quantity * unitPrice);
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
 * The document heading, from the SHARED resolver in `lib/invoice-domain.ts`.
 *
 * Two axes collapse here: `documentKind` says what the document is (a proforma
 * is never a tax invoice, whatever its author's GST status), and `documentType`
 * says what tax shape it has. A record written before Phase 2 carries neither
 * and keeps the plain "INVOICE" it has always printed — re-printing a document
 * a client already holds must not change its heading.
 */
const documentTitleForRecord = (invoice: InvoiceRecord): string =>
  documentTitleFor({
    documentKind: invoice.documentKind,
    documentType: invoice.documentType,
    taxTreatment: invoice.taxTreatment,
  });

/**
 * Rule 53(1A): a credit or debit note must carry the serial number and date of
 * the invoice it corrects, and (by convention, and because it is the first
 * thing anyone reading it asks) why it was issued.
 *
 * Printed for notes only, and independently of `gstDetailRows` — those rows are
 * gated on the document having a `taxTreatment`, while these particulars are
 * required of a note whether or not its author is registered.
 */
const noteReferenceRows = (invoice: InvoiceRecord): Array<[string, string]> => {
  if (!isCreditOrDebitNote(invoice.documentKind)) {
    return [];
  }
  const rows: Array<[string, string]> = [];
  const number = (invoice.originalInvoice?.invoiceNumber ?? "").trim();
  if (number) {
    rows.push(["Original Invoice Number", number]);
  }
  const date = invoice.originalInvoice?.invoiceDate;
  if (date) {
    rows.push(["Original Invoice Date", formatDateLong(date)]);
  }
  const reason = (invoice.reasonForIssue ?? "").trim();
  if (reason) {
    rows.push(["Reason", reason]);
  }
  return rows;
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
  /**
   * ABSENT means a pre-Phase-2 record, which carries no `supplyKind` either and
   * so never reaches the endorsement. Present and not `"gst"` is the case this
   * gate exists for.
   */
  taxTreatment?: TaxTreatment;
}): string | null => {
  // Both endorsements are declarations made UNDER a GST registration: one says
  // integrated tax was paid on this export, the other that it was not paid
  // because a Letter of Undertaking is on file. An unregistered supplier (§1.2,
  // the `none` + `export` row) and a composition dealer have no registration to
  // make either statement under, and printing one over their INVOICE or BILL OF
  // SUPPLY — which carries no GSTIN at all — is a false statement on a legal
  // document. They export on a plain invoice with no GST language on it.
  if (input.taxTreatment !== "gst") {
    return null;
  }
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

/**
 * The two parties' tax identities, as label/value pairs.
 *
 * Rule 46(a) and 46(e) require the supplier's and the recipient's GSTIN on a
 * tax invoice; without them the document is not one, whatever it is headed.
 * They are read from the INVOICE, never from the live business profile — an
 * invoice is a historical record, and a user who changes registration later
 * must not retroactively alter documents a client already holds.
 *
 * The supplier's PAN rides along because every Indian client deducting TDS
 * needs the payee's PAN; without it they are obliged to deduct at 20%.
 *
 * Absent values are omitted rather than printed empty: an unregistered supplier
 * is the majority case and their document should simply not mention GSTIN.
 */
const partyIdentityRows = (invoice: InvoiceRecord): Array<[string, string]> => {
  const rows: Array<[string, string]> = [];
  const companyGstin = (invoice.companyGstin ?? "").trim();
  const companyPan = (invoice.companyPan ?? "").trim();
  const billToGstin = (invoice.billToGstin ?? "").trim();
  if (companyGstin) {
    rows.push(["Supplier GSTIN", companyGstin]);
  }
  if (companyPan) {
    rows.push(["Supplier PAN", companyPan]);
  }
  if (billToGstin) {
    rows.push(["Client GSTIN", billToGstin]);
  }
  return rows;
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

/* -------------------------------------------------------------------------- */
/* Payment block                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The seller's payment identity, as held by the BUSINESS PROFILE.
 *
 * It arrives as an option rather than off the `InvoiceRecord` because it is not
 * part of the document: an invoice is a historical record, and where the money
 * goes is current configuration. Re-printing last year's invoice after changing
 * banks should show the account that can actually be paid today, not one that
 * has been closed. (The opposite argument — snapshot it, like the GSTIN — is
 * defensible and is what Rule 46 forces for the tax identities; it is not
 * forced here, and the live value is the more useful of the two.)
 */
export interface InvoicePaymentDetails {
  /** UPI VPA. Re-validated here; an invalid one prints nothing at all. */
  upiVpa?: string;
  /** Name shown to the payer in their app. Falls back to the invoice's company name. */
  payeeName?: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
}

export interface InvoicePaymentBlock {
  /** Bank particulars as label/value pairs. May be empty. */
  rows: Array<[string, string]>;
  /** The UPI link, or null when there is no valid VPA or the invoice is not in INR. */
  upi: UpiLink | null;
}

/**
 * Decide what the "How to pay" block contains — with no markup involved, so the
 * conditions can be tested directly.
 *
 * TWO RULES, both about not printing something wrong:
 *
 *  1. The QR is INR-ONLY. A `upi://pay` URI cannot carry another currency, so a
 *     QR on a USD invoice would ask the payer for that number of RUPEES. There
 *     is no partially-correct version of this; the QR is omitted.
 *  2. An invalid VPA prints nothing. It would produce a code that opens the
 *     client's banking app and fails there, in front of the client, which is a
 *     worse outcome for the user than an invoice with no QR on it.
 *
 * Bank particulars are NOT INR-gated: an overseas client paying by wire still
 * needs the account, and nothing about those rows can be silently wrong.
 */
export const buildPaymentBlock = (
  invoice: InvoiceRecord,
  payment: InvoicePaymentDetails | undefined,
  total: number
): InvoicePaymentBlock | null => {
  if (!payment) {
    return null;
  }

  const vpa = normalizeVpa(payment.upiVpa);
  const currency = invoice.currency || "INR";
  const upi =
    isValidVpa(vpa) && supportsUpi(currency)
      ? buildUpiLink({
          vpa,
          payeeName: payment.payeeName || invoice.companyName,
          amount: total,
          currency,
          note: invoice.invoiceNumber
            ? `Invoice ${invoice.invoiceNumber}`
            : "Invoice",
          reference: toUpiReference(invoice.invoiceNumber),
        })
      : null;

  const rows: Array<[string, string]> = [];
  if (upi) {
    rows.push(["UPI ID", upi.vpa]);
  }
  const accountName = (payment.bankAccountName ?? "").trim();
  if (accountName) {
    rows.push(["Account name", accountName]);
  }
  const bankName = (payment.bankName ?? "").trim();
  if (bankName) {
    rows.push(["Bank", bankName]);
  }
  const accountNumber = normalizeAccountNumber(payment.bankAccountNumber);
  if (accountNumber) {
    rows.push(["Account number", accountNumber]);
  }
  const ifsc = normalizeIfsc(payment.bankIfsc);
  if (ifsc) {
    rows.push(["IFSC", ifsc]);
  }

  if (!upi && rows.length === 0) {
    return null;
  }
  return { rows, upi };
};

interface CreateInvoiceHtmlOptions {
  autoPrint?: boolean;
  payment?: InvoicePaymentDetails;
}

export const createInvoiceHtml = (
  invoice: InvoiceRecord,
  options: CreateInvoiceHtmlOptions = {}
) => {
  const amounts = resolveRecordAmounts(invoice);
  const status = getInvoiceStatus(invoice).toUpperCase();
  const currency = invoice.currency || "INR";
  const logoUrl = toSafeImageUrl(invoice.companyLogo);
  const documentTitle = documentTitleForRecord(invoice);
  const documentSpec = documentKindSpecFor(invoice.documentKind);
  // "This is not a tax invoice." on a proforma or a quotation; the commercial
  // disclaimer on a note from an unregistered supplier; nothing otherwise.
  const documentNotice = documentTaxNoticeFor({
    documentKind: invoice.documentKind,
    documentType: invoice.documentType,
    taxTreatment: invoice.taxTreatment,
  });
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
  const gstRows = [...noteReferenceRows(invoice), ...gstDetailRows(invoice)];
  const companyGstin = (invoice.companyGstin ?? "").trim();
  const companyPan = (invoice.companyPan ?? "").trim();
  const billToGstin = (invoice.billToGstin ?? "").trim();
  // Item 7.4. The label defaults to the conventional "For <company>"; the image
  // goes through the SAME protocol allowlist as the logo, because it is an
  // `<img src>` interpolated into a document rendered in a same-origin iframe.
  const signatureLabel =
    (invoice.signatureLabel ?? "").trim() ||
    `For ${invoice.companyName?.trim() || "us"}`;
  const signatureImageUrl = toSafeImageUrl(invoice.signatureImageUrl);

  // The pay block. `createQrSvg` returns null rather than throwing if a payload
  // will not fit any QR version, so an unprintable code costs the invoice
  // nothing — it prints without one.
  const payment = buildPaymentBlock(invoice, options.payment, amounts.total);
  const qrSvg = payment?.upi
    ? createQrSvg(payment.upi.uri, {
        quietZone: 4,
        label: `UPI payment QR code for ${payment.upi.vpa}`,
      })
    : null;
  // The SVG is markup WE generate — a background rect and one path of module
  // geometry, no user text in the document at all. The one user-derived string
  // it carries is the aria-label, which `renderQrSvg` escapes itself. Every
  // other interpolation below goes through `escapeHtml`.
  const paymentBlockHtml = payment
    ? `<section class="payment">
        <h3>How to pay</h3>
        <div class="payment-grid">
          <table class="payment-rows">
            ${payment.rows
              .map(
                ([label, value]) =>
                  `<tr><td class="label">${escapeHtml(
                    label
                  )}</td><td class="value">${escapeHtml(value)}</td></tr>`
              )
              .join("")}
          </table>
          ${
            qrSvg
              ? `<figure class="payment-qr">${qrSvg}<figcaption>Scan with any UPI app</figcaption></figure>`
              : ""
          }
        </div>
      </section>`
    : "";

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
    <title>${escapeHtml(documentTitle)} ${toSafeValue(
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

      /* Rule 46(a)/(e): each party's GSTIN sits with that party's name and
         address, which is where a reader (and an auditor) looks for it. */
      .box-id {
        margin: 8px 0 0;
        font-size: 12px;
        color: #111827;
        font-weight: 600;
        letter-spacing: 0.02em;
      }

      .box-id span {
        color: #6b7280;
        font-weight: 400;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-size: 11px;
        margin-right: 4px;
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

      /* An "info" row is displayed inside the ladder but is not part of the
         arithmetic (TDS is withheld by the client). Styled quieter than a real
         line so it cannot be read as a reduction of the invoice's value. */
      .summary .info td {
        color: #6b7280;
        font-size: 12px;
        font-weight: 500;
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

      /* The pay block sits between the totals and the notes: the reader has
         just seen what they owe, and this is how they settle it. It must not
         be split across a page break — half a QR is an unscannable QR. */
      .payment {
        padding: 0 28px 24px;
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .payment h3 {
        margin: 0 0 8px;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #6b7280;
      }

      .payment-grid {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 14px 16px;
      }

      .payment-rows {
        width: auto;
        border-collapse: collapse;
        font-size: 12px;
        color: #374151;
      }

      .payment-rows td {
        border-bottom: none;
        padding: 3px 0;
        vertical-align: top;
      }

      .payment-rows .label {
        padding-right: 16px;
        color: #6b7280;
        white-space: nowrap;
      }

      .payment-rows .value {
        color: #111827;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }

      .payment-qr {
        margin: 0;
        text-align: center;
        flex: none;
      }

      /* A QR must print as a QR, not as a grey approximation of one: force the
         browser to keep the black, and never scale it below scanning size. */
      .payment-qr svg {
        display: block;
        width: 118px;
        height: 118px;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .payment-qr figcaption {
        margin-top: 6px;
        font-size: 10px;
        color: #6b7280;
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

      .signature-image {
        display: block;
        margin: 8px 0 0 auto;
        max-width: 200px;
        max-height: 64px;
        object-fit: contain;
      }

      .signature-rule {
        margin-top: 48px;
        border-top: 1px solid #9ca3af;
        padding-top: 6px;
        color: #6b7280;
      }

      /* With a signature image there is no need to leave room to sign by hand. */
      .signature-image + .signature-rule {
        margin-top: 8px;
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
            <h1>${escapeHtml(documentTitle)}</h1>
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
          <div class="label">${escapeHtml(documentSpec.printedNumberLabel)}</div>
          <div class="value">${toSafeValue(invoice.invoiceNumber)}</div>
          <div class="label">${escapeHtml(documentSpec.printedDateLabel)}</div>
          <div class="value">${escapeHtml(formatDateLong(invoice.invoiceDate))}</div>
          <div class="label">${escapeHtml(documentSpec.printedDueDateLabel)}</div>
          <div class="value">${escapeHtml(formatDateLong(invoice.dueDate))}</div>
          <span class="status">${escapeHtml(status)}</span>
        </div>
      </section>

      ${
        documentNotice
          ? `<p class="statute">${escapeHtml(documentNotice)}</p>`
          : ""
      }
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
          ${
            companyGstin
              ? `<p class="box-id"><span>GSTIN</span> ${escapeHtml(
                  companyGstin
                )}</p>`
              : ""
          }
          ${
            companyPan
              ? `<p class="box-id"><span>PAN</span> ${escapeHtml(
                  companyPan
                )}</p>`
              : ""
          }
        </div>
        <div class="box">
          <h2 class="box-title">Bill To</h2>
          <p class="box-value">
            ${toSafeValue(invoice.billTo)}
            ${invoice.billToAddress ? `<br />${toLineBreaks(invoice.billToAddress)}` : ""}
            ${invoice.billToEmail ? `<br />${toSafeValue(invoice.billToEmail)}` : ""}
          </p>
          ${
            billToGstin
              ? `<p class="box-id"><span>GSTIN</span> ${escapeHtml(
                  billToGstin
                )}</p>`
              : ""
          }
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
                const rowClass =
                  row.kind === "grand"
                    ? ' class="grand"'
                    : row.kind === "info"
                      ? ' class="info"'
                      : "";
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

      ${paymentBlockHtml}

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
          ${
            signatureImageUrl
              ? `<img src="${signatureImageUrl}" alt="Signature" class="signature-image" />`
              : ""
          }
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

  const documentSpec = documentKindSpecFor(invoice.documentKind);
  const documentNotice = documentTaxNoticeFor({
    documentKind: invoice.documentKind,
    documentType: invoice.documentType,
    taxTreatment: invoice.taxTreatment,
  });

  const rows: Array<Array<string | undefined>> = [
    [documentSpec.printedNumberLabel, invoice.invoiceNumber],
    ["Document Type", documentTitleForRecord(invoice)],
    ["Company", invoice.companyName],
    ["Client", invoice.billTo],
    [documentSpec.printedDateLabel, formatDateLong(invoice.invoiceDate)],
    [documentSpec.printedDueDateLabel, formatDateLong(invoice.dueDate)],
    ["Currency", currency],
    // Same label/value pairs the HTML prints, from the same builders. The party
    // identities are rendered inside the address boxes on the sheet; the CSV
    // has no address boxes, so they become ordinary header rows here.
    ...partyIdentityRows(invoice).map(([label, value]) => [label, value]),
    // Rule 53(1A) particulars, ahead of the GST block for the same reason they
    // are printed first on the sheet: a note is defined by what it corrects.
    ...noteReferenceRows(invoice).map(([label, value]) => [label, value]),
    ...gstDetailRows(invoice).map(([label, value]) => [label, value]),
    ...(documentNotice ? [["Declaration", documentNotice]] : []),
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
