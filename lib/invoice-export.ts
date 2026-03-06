import {
  InvoiceRecord,
  formatCurrency,
  formatDateLong,
  getInvoiceStatus,
} from "@/lib/invoices";

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

interface CreateInvoiceHtmlOptions {
  autoPrint?: boolean;
}

export const createInvoiceHtml = (
  invoice: InvoiceRecord,
  options: CreateInvoiceHtmlOptions = {}
) => {
  const subtotal =
    invoice.subtotal ??
    invoice.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const discount = invoice.discount || 0;
  const cgst = invoice.cgst ?? invoice.tax ?? 0;
  const sgst = invoice.sgst || 0;
  const convenienceCharge = invoice.convenienceCharge || 0;
  const total = invoice.total || subtotal - discount + cgst + sgst + convenienceCharge;
  const status = getInvoiceStatus(invoice).toUpperCase();
  const currency = invoice.currency || "INR";
  const logoUrl = toSafeImageUrl(invoice.companyLogo);

  const rows = invoice.items
    .map((item, index) => {
      const lineTotal = item.quantity * item.price;
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${toSafeValue(item.name)}</td>
          <td>${item.quantity}</td>
          <td>${escapeHtml(formatCurrency(item.price, currency))}</td>
          <td>${escapeHtml(formatCurrency(lineTotal, currency))}</td>
        </tr>
      `;
    })
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Invoice ${toSafeValue(invoice.invoiceNumber)}</title>
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
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        color: #111827;
        background: #f3f4f6;
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

      table {
        width: calc(100% - 56px);
        margin: 0 28px 24px;
        border-collapse: collapse;
      }

      thead th {
        text-align: left;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #6b7280;
        padding: 12px 10px;
        border-bottom: 1px solid #d1d5db;
      }

      tbody td {
        font-size: 13px;
        color: #111827;
        padding: 12px 10px;
        border-bottom: 1px solid #f1f5f9;
        vertical-align: top;
      }

      tbody tr:last-child td {
        border-bottom: none;
      }

      .summary {
        display: flex;
        justify-content: flex-end;
        padding: 0 28px 24px;
      }

      .summary table {
        width: 320px;
        margin: 0;
      }

      .summary td {
        border-bottom: none;
        padding: 7px 0;
      }

      .summary .amount {
        text-align: right;
        font-weight: 600;
      }

      .summary .grand td {
        border-top: 1px solid #d1d5db;
        padding-top: 10px;
        font-size: 15px;
        font-weight: 700;
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
            <h1>INVOICE</h1>
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
          <span class="status">${status}</span>
        </div>
      </section>

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

      <table>
        <thead>
          <tr>
            <th style="width: 48px">#</th>
            <th>Description</th>
            <th style="width: 80px">Qty</th>
            <th style="width: 140px">Unit Price</th>
            <th style="width: 140px">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>

      <section class="summary">
        <table>
          <tbody>
            <tr>
              <td>Subtotal</td>
              <td class="amount">${escapeHtml(formatCurrency(subtotal, currency))}</td>
            </tr>
            <tr>
              <td>Discount</td>
              <td class="amount">- ${escapeHtml(
                formatCurrency(discount, currency)
              )}</td>
            </tr>
            <tr>
              <td>CGST</td>
              <td class="amount">${escapeHtml(formatCurrency(cgst, currency))}</td>
            </tr>
            <tr>
              <td>SGST</td>
              <td class="amount">${escapeHtml(formatCurrency(sgst, currency))}</td>
            </tr>
            <tr>
              <td>Service Charge</td>
              <td class="amount">${escapeHtml(
                formatCurrency(convenienceCharge, currency)
              )}</td>
            </tr>
            <tr class="grand">
              <td>Total</td>
              <td class="amount">${escapeHtml(formatCurrency(total, currency))}</td>
            </tr>
          </tbody>
        </table>
      </section>

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

      <footer class="footer">
        Generated by Invoicey • ${escapeHtml(formatDateLong(new Date()))}
      </footer>
    </article>
    ${
      options.autoPrint
        ? `<script>
            window.addEventListener("load", function () {
              setTimeout(function () {
                window.focus();
                window.print();
              }, 150);
            });
          </script>`
        : ""
    }
  </body>
</html>
  `.trim();
};

export const createInvoiceCsv = (invoice: InvoiceRecord) => {
  const subtotal =
    invoice.subtotal ??
    invoice.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const discount = invoice.discount || 0;
  const cgst = invoice.cgst ?? invoice.tax ?? 0;
  const sgst = invoice.sgst || 0;
  const serviceCharge = invoice.convenienceCharge || 0;
  const total = invoice.total || subtotal - discount + cgst + sgst + serviceCharge;

  const rows = [
    ["Invoice Number", invoice.invoiceNumber],
    ["Company", invoice.companyName],
    ["Client", invoice.billTo],
    ["Invoice Date", formatDateLong(invoice.invoiceDate)],
    ["Due Date", formatDateLong(invoice.dueDate)],
    ["Currency", invoice.currency || "INR"],
    [],
    ["Item", "Quantity", "Unit Price", "Amount"],
    ...invoice.items.map((item) => [
      item.name,
      String(item.quantity),
      String(item.price.toFixed(2)),
      String((item.price * item.quantity).toFixed(2)),
    ]),
    [],
    ["Subtotal", String(subtotal.toFixed(2))],
    ["Discount", String(discount.toFixed(2))],
    ["CGST", String(cgst.toFixed(2))],
    ["SGST", String(sgst.toFixed(2))],
    ["Service Charge", String(serviceCharge.toFixed(2))],
    ["Total", String(total.toFixed(2))],
  ];

  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell === undefined) {
            return "";
          }
          const value = String(cell);
          return `"${value.replaceAll('"', '""')}"`;
        })
        .join(",")
    )
    .join("\n");
};
