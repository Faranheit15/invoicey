"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  createInvoiceCsv,
  createInvoiceHtml,
} from "@/lib/invoice-export";
import {
  InvoiceRecord,
  formatCurrency,
  formatDateLong,
  getInvoiceStatus,
} from "@/lib/invoices";
import {
  Cross1Icon,
  DownloadIcon,
  FileIcon,
  Pencil1Icon,
} from "@radix-ui/react-icons";

interface InvoiceModalProps {
  invoice: InvoiceRecord;
  onClose: () => void;
  onEdit?: (invoiceId: string) => void;
  onSettle?: (invoiceId: string) => Promise<void> | void;
  onDelete?: (invoiceId: string) => Promise<void> | void;
  isMutating?: boolean;
}

const statusClassName = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-blue-100 text-blue-700",
  paid: "bg-emerald-100 text-emerald-700",
  overdue: "bg-rose-100 text-rose-700",
};

const downloadBlob = (filename: string, content: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export default function InvoiceModal({
  invoice,
  onClose,
  onEdit,
  onSettle,
  onDelete,
  isMutating = false,
}: InvoiceModalProps) {
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const currency = invoice.currency || "INR";
  const status = getInvoiceStatus(invoice);
  const subtotal =
    invoice.subtotal ??
    invoice.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const discount = invoice.discount || 0;
  const tax = invoice.tax || 0;
  const convenienceCharge = invoice.convenienceCharge || 0;
  const total = invoice.total || subtotal - discount + tax + convenienceCharge;
  const showCompanyLogo = Boolean(invoice.companyLogo?.trim()) && !logoLoadFailed;

  useEffect(() => {
    setLogoLoadFailed(false);
  }, [invoice.companyLogo]);

  const exportPdf = () => {
    const html = createInvoiceHtml(invoice, { autoPrint: true });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const printableWindow = window.open(url, "_blank", "noopener,noreferrer");
    if (!printableWindow) {
      URL.revokeObjectURL(url);
      return;
    }

    const revokeObjectUrl = () => URL.revokeObjectURL(url);
    printableWindow.addEventListener("afterprint", revokeObjectUrl, {
      once: true,
    });
    setTimeout(revokeObjectUrl, 60_000);
  };

  const exportHtml = () => {
    downloadBlob(
      `${invoice.invoiceNumber || "invoice"}.html`,
      createInvoiceHtml(invoice),
      "text/html;charset=utf-8"
    );
  };

  const exportCsv = () => {
    downloadBlob(
      `${invoice.invoiceNumber || "invoice"}.csv`,
      createInvoiceCsv(invoice),
      "text/csv;charset=utf-8"
    );
  };

  const exportJson = () => {
    downloadBlob(
      `${invoice.invoiceNumber || "invoice"}.json`,
      JSON.stringify(invoice, null, 2),
      "application/json;charset=utf-8"
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-3 backdrop-blur-[2px] sm:p-6">
      <div className="relative max-h-[95vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div>
            <p className="text-xs tracking-wider uppercase text-slate-500 dark:text-slate-400">
              Invoice
            </p>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              {invoice.invoiceNumber}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onEdit ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEdit(invoice._id)}
                disabled={isMutating}
              >
                <Pencil1Icon className="w-4 h-4" />
                Edit
              </Button>
            ) : null}
            {onSettle && status !== "paid" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSettle(invoice._id)}
                disabled={isMutating}
              >
                Settle
              </Button>
            ) : null}
            {onDelete ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onDelete(invoice._id)}
                disabled={isMutating}
              >
                Delete
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={exportPdf}>
              <DownloadIcon className="w-4 h-4" />
              Print / PDF
            </Button>
            <Button size="sm" variant="outline" onClick={exportHtml}>
              <FileIcon className="w-4 h-4" />
              HTML
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <DownloadIcon className="w-4 h-4" />
              CSV
            </Button>
            <Button size="sm" variant="outline" onClick={exportJson}>
              JSON
            </Button>
            <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
              <Cross1Icon className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="max-h-[calc(95vh-80px)] overflow-auto p-4 sm:p-6">
          <article className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md dark:border-slate-700 dark:bg-slate-950">
            <header className="flex flex-wrap justify-between gap-5 border-b border-slate-200 bg-slate-900 px-6 py-6 text-slate-100 sm:px-8 dark:border-slate-700">
              <div>
                <p className="text-xs tracking-[0.2em] uppercase text-slate-300">Invoice</p>
                <h3 className="mt-1 text-2xl font-semibold">{invoice.invoiceNumber}</h3>
                <p className="mt-3 text-sm text-slate-300">
                  Issued by <span className="font-medium text-white">{invoice.companyName}</span>
                </p>
              </div>
              <div className="text-sm">
                {showCompanyLogo ? (
                  <img
                    src={invoice.companyLogo}
                    alt={`${invoice.companyName || "Company"} logo`}
                    className="mb-3 ml-auto h-12 w-12 rounded-md border border-white/20 bg-white/10 object-contain p-1"
                    onError={() => setLogoLoadFailed(true)}
                  />
                ) : null}
                <div className="space-y-2">
                  <div className="text-slate-300">Invoice Date</div>
                  <div className="font-medium text-white">
                    {formatDateLong(invoice.invoiceDate)}
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  <div className="text-slate-300">Due Date</div>
                  <div className="font-medium text-white">
                    {formatDateLong(invoice.dueDate)}
                  </div>
                </div>
                <span
                  className={`inline-flex rounded-full px-3 py-1 mt-4 text-xs font-semibold uppercase ${statusClassName[status]}`}
                >
                  {status}
                </span>
              </div>
            </header>

            <section className="grid gap-4 border-b border-slate-200 px-6 py-5 sm:grid-cols-2 sm:px-8 dark:border-slate-700">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500 dark:text-slate-400">
                  Bill From
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {invoice.companyName}
                </p>
                {invoice.companyAddress ? (
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    {invoice.companyAddress}
                  </p>
                ) : null}
                {invoice.companyEmail ? (
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {invoice.companyEmail}
                  </p>
                ) : null}
                {invoice.companyPhone ? (
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {invoice.companyPhone}
                  </p>
                ) : null}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500 dark:text-slate-400">
                  Bill To
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {invoice.billTo}
                </p>
                {invoice.billToAddress ? (
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    {invoice.billToAddress}
                  </p>
                ) : null}
                {invoice.billToEmail ? (
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {invoice.billToEmail}
                  </p>
                ) : null}
              </div>
            </section>

            <section className="px-6 py-5 sm:px-8">
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="grid min-w-[640px] grid-cols-[64px_1.5fr_96px_140px_140px] bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                  <div>#</div>
                  <div>Description</div>
                  <div className="text-right">Qty</div>
                  <div className="text-right">Unit</div>
                  <div className="text-right">Amount</div>
                </div>
                <div className="min-w-[640px] divide-y divide-slate-100 dark:divide-slate-800">
                  {invoice.items.map((item, index) => (
                    <div
                      className="grid grid-cols-[64px_1.5fr_96px_140px_140px] px-4 py-3 text-sm"
                      key={`${item.name}-${index}`}
                    >
                      <div className="text-slate-500 dark:text-slate-300">{index + 1}</div>
                      <div className="text-slate-800 dark:text-slate-100">{item.name}</div>
                      <div className="text-right text-slate-600 dark:text-slate-300">
                        {item.quantity}
                      </div>
                      <div className="text-right font-medium text-slate-700 dark:text-slate-200">
                        {formatCurrency(item.price, currency)}
                      </div>
                      <div className="text-right font-semibold text-slate-900 dark:text-slate-100">
                        {formatCurrency(item.price * item.quantity, currency)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="flex justify-end px-6 pb-6 sm:px-8">
              <div className="w-full max-w-sm text-sm">
                <div className="flex justify-between py-1 text-slate-600 dark:text-slate-300">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal, currency)}</span>
                </div>
                <div className="flex justify-between py-1 text-slate-600 dark:text-slate-300">
                  <span>Discount</span>
                  <span>- {formatCurrency(discount, currency)}</span>
                </div>
                <div className="flex justify-between py-1 text-slate-600 dark:text-slate-300">
                  <span>Tax</span>
                  <span>{formatCurrency(tax, currency)}</span>
                </div>
                <div className="flex justify-between py-1 text-slate-600 dark:text-slate-300">
                  <span>Service Charge</span>
                  <span>{formatCurrency(convenienceCharge, currency)}</span>
                </div>
                <div className="mt-2 flex justify-between border-t border-slate-200 pt-3 text-base font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100">
                  <span>Total</span>
                  <span>{formatCurrency(total, currency)}</span>
                </div>
              </div>
            </section>

            {(invoice.terms || invoice.paymentInfo || invoice.notes) && (
              <section className="grid gap-4 border-t border-slate-200 px-6 py-5 sm:grid-cols-3 sm:px-8 dark:border-slate-700">
                {invoice.terms ? (
                  <div>
                    <h4 className="text-xs font-semibold tracking-wider uppercase text-slate-500 dark:text-slate-400">
                      Terms
                    </h4>
                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      {invoice.terms}
                    </p>
                  </div>
                ) : null}
                {invoice.paymentInfo ? (
                  <div>
                    <h4 className="text-xs font-semibold tracking-wider uppercase text-slate-500 dark:text-slate-400">
                      Payment Information
                    </h4>
                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      {invoice.paymentInfo}
                    </p>
                  </div>
                ) : null}
                {invoice.notes ? (
                  <div>
                    <h4 className="text-xs font-semibold tracking-wider uppercase text-slate-500 dark:text-slate-400">
                      Notes
                    </h4>
                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      {invoice.notes}
                    </p>
                  </div>
                ) : null}
              </section>
            )}
          </article>
        </div>
      </div>
    </div>
  );
}
