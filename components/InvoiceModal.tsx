"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal, ModalCloseButton } from "@/components/ui/modal";
import {
  STATUS_PILL_BASE,
  statusPillOnMastheadClass,
} from "@/lib/invoice-status";
import { AlertBanner } from "@/components/ui/alert-banner";
import { MicroLabel } from "@/components/ui/micro-label";
import {
  buildLineItemCells,
  createInvoiceCsv,
  createInvoiceHtml,
} from "@/lib/invoice-export";
import { downloadBlob } from "@/lib/download";
import {
  buildLineItemColumns,
  buildTotalsRows,
  resolveRecordAmounts,
} from "@/lib/invoice-domain";
import { eventsApi } from "@/lib/api-client";
import {
  InvoiceRecord,
  formatCurrency,
  formatDateLong,
  getInvoiceStatus,
} from "@/lib/invoices";
import {
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

export default function InvoiceModal({
  invoice,
  onClose,
  onEdit,
  onSettle,
  onDelete,
  isMutating = false,
}: InvoiceModalProps) {
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const [exportError, setExportError] = useState("");
  const titleId = useId();
  const currency = invoice.currency || "INR";
  const status = getInvoiceStatus(invoice);
  const amounts = resolveRecordAmounts(invoice);
  const totalsRows = buildTotalsRows(amounts);
  // The same column list the export and the editor preview read. Before this,
  // the modal was the one renderer still hard-coding five columns, so an
  // invoice with HSN/SAC, UOM, per-line rates or per-line tax showed none of
  // them on the screen the user checks before sending.
  const lineTableInput = {
    items: invoice.items || [],
    totals: amounts,
    currency,
  };
  const lineColumns = buildLineItemColumns(lineTableInput);
  const showCompanyLogo = Boolean(invoice.companyLogo?.trim()) && !logoLoadFailed;

  useEffect(() => {
    setLogoLoadFailed(false);
  }, [invoice.companyLogo]);

  // Best-effort view telemetry for the admin activity/log surface.
  useEffect(() => {
    eventsApi.emit({ event: "invoice.viewed", meta: { invoiceId: invoice._id } });
  }, [invoice._id]);

  // The print frame outlives the click that made it — the dialog stays open for
  // as long as the user wants — so it is tracked here rather than torn down on a
  // timer. An earlier version removed it after 60s, which blanked the preview of
  // anyone who spent longer than that in Save-as-PDF.
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);

  const releasePrintFrame = useCallback(() => {
    printFrameRef.current?.remove();
    printFrameRef.current = null;
  }, []);

  useEffect(() => releasePrintFrame, [releasePrintFrame]);

  const exportPdf = () => {
    setExportError("");
    // Printed from a hidden same-document iframe, not a popup. `window.open`
    // with `noopener` returns null on SUCCESS per spec, so the old popup-blocked
    // branch fired every time — it reported a blocker that wasn't there and
    // revoked the blob out from under the tab still loading it. An iframe cannot
    // be blocked at all, and its load event is the real "it worked" signal the
    // null-check was reaching for. The document is built without `autoPrint`
    // because we drive `print()` ourselves once that signal arrives; letting the
    // document print itself too would raise the dialog twice.
    releasePrintFrame();

    const html = createInvoiceHtml(invoice);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.title = "Printable invoice";
    // A blob: document inherits this origin, so anything that ever slipped past
    // the export template's escaping would run with access to our storage. The
    // template needs no script of its own — the parent drives print() — so the
    // frame is sandboxed down to the two things this flow actually requires:
    // same-origin (so contentWindow is reachable) and modals (so the print
    // dialog can open). Scripts are not in the list.
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0";

    let urlRevoked = false;
    const revokeUrl = () => {
      if (urlRevoked) {
        return;
      }
      urlRevoked = true;
      URL.revokeObjectURL(url);
    };
    const fail = () => {
      revokeUrl();
      releasePrintFrame();
      setExportError(
        "Your browser could not open the printable copy. Download the HTML copy and print that instead."
      );
    };

    // Only covers the load; once the document is up the print dialog may sit
    // open for as long as the user wants it to.
    const loadTimeout = setTimeout(fail, 15_000);

    /**
     * Item 8(4). `load` fires before web fonts settle and before a remote
     * `companyLogo` (or signature image) has DECODED, so the print dialog could
     * capture a logo-less, fallback-font page — on a document whose whole job is
     * to look right in someone else's printer.
     *
     * The 3s race is not optional: a logo pointing at a dead host must never
     * stop the user printing. Failures are swallowed for the same reason — a
     * broken image is a worse-looking invoice, not a blocked one.
     */
    const settleFrameAssets = async (frameWindow: Window): Promise<void> => {
      try {
        const doc = frameWindow.document;
        const assets = Promise.all([
          doc.fonts?.ready ?? Promise.resolve(),
          ...Array.from(doc.images).map((img) =>
            img.complete
              ? Promise.resolve()
              : typeof img.decode === "function"
                ? img.decode().catch(() => {})
                : new Promise<void>((done) => {
                    img.addEventListener("load", () => done(), { once: true });
                    img.addEventListener("error", () => done(), { once: true });
                  })
          ),
        ]);
        const deadline = new Promise<void>((done) => {
          setTimeout(done, 3_000);
        });
        await Promise.race([assets, deadline]);
      } catch {
        // Intentionally silent — see above.
      }
    };

    frame.onload = () => {
      clearTimeout(loadTimeout);
      const frameWindow = frame.contentWindow;
      if (!frameWindow) {
        fail();
        return;
      }

      // Safe the moment the document exists: revoking a blob URL does not
      // disturb a document already parsed from it, and the export template is
      // self-contained, so nothing is fetched later. The FRAME is what has to
      // survive — Chrome drops the preview if it leaves the DOM while the dialog
      // is up — so it stays until afterprint, the next export supersedes it, or
      // the modal unmounts. `afterprint` is unreliable outside Chrome, hence
      // those two other releases rather than a timer.
      revokeUrl();
      printFrameRef.current = frame;
      frameWindow.addEventListener("afterprint", releasePrintFrame, {
        once: true,
      });

      // The frame is already tracked and the blob already revoked above, so an
      // unmount during this await still tears everything down correctly.
      void settleFrameAssets(frameWindow).then(() => {
        // The modal may have unmounted (or a second export superseded this
        // frame) while we waited; printing a detached frame does nothing useful.
        if (printFrameRef.current !== frame) {
          return;
        }
        try {
          frameWindow.focus();
          frameWindow.print();
        } catch {
          fail();
          return;
        }

        eventsApi.emit({
          event: "report.generated",
          meta: { format: "pdf", invoiceId: invoice._id },
        });
      });
    };
    frame.onerror = fail;
    frame.src = url;
    document.body.appendChild(frame);
  };

  const exportHtml = () => {
    downloadBlob(
      `${invoice.invoiceNumber || "invoice"}.html`,
      createInvoiceHtml(invoice),
      "text/html;charset=utf-8"
    );
    eventsApi.emit({
      event: "report.generated",
      meta: { format: "html", invoiceId: invoice._id },
    });
  };

  const exportCsv = () => {
    downloadBlob(
      `${invoice.invoiceNumber || "invoice"}.csv`,
      createInvoiceCsv(invoice),
      "text/csv;charset=utf-8"
    );
    eventsApi.emit({
      event: "report.generated",
      meta: { format: "csv", invoiceId: invoice._id },
    });
  };

  const exportJson = () => {
    downloadBlob(
      `${invoice.invoiceNumber || "invoice"}.json`,
      JSON.stringify(invoice, null, 2),
      "application/json;charset=utf-8"
    );
    eventsApi.emit({
      event: "report.generated",
      meta: { format: "json", invoiceId: invoice._id },
    });
  };

  return (
    <Modal open onClose={onClose} labelledBy={titleId} className="max-w-6xl">
      <div className="flex flex-col max-h-[95vh]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="min-w-0">
            <MicroLabel as="p" variant="section">
              Invoice
            </MicroLabel>
            <h2
              id={titleId}
              className="truncate text-xl font-semibold text-slate-900 dark:text-slate-100"
            >
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
            <ModalCloseButton onClose={onClose} />
          </div>
        </div>

        {exportError ? (
          <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-700">
            <AlertBanner>{exportError}</AlertBanner>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
          <article className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md dark:border-slate-700 dark:bg-slate-950">
            <header className="flex flex-wrap justify-between gap-5 border-b border-slate-200 bg-slate-900 px-6 py-6 text-slate-100 sm:px-8 dark:border-slate-700">
              <div>
                <MicroLabel variant="onDark">Invoice</MicroLabel>
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
                  className={`${STATUS_PILL_BASE} mt-4 px-3 ${statusPillOnMastheadClass[status]}`}
                >
                  {status}
                </span>
              </div>
            </header>

            <section className="grid gap-4 border-b border-slate-200 px-6 py-5 sm:grid-cols-2 sm:px-8 dark:border-slate-700">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
                <MicroLabel as="p" variant="section">
                  Bill From
                </MicroLabel>
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
                {/* Rule 46(a): the supplier's GSTIN, read off the invoice and
                    never from the live profile — this is the document as it was
                    issued. Omitted when blank rather than shown empty. */}
                {invoice.companyGstin ? (
                  <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <span className="text-slate-500 dark:text-slate-400">GSTIN </span>
                    {invoice.companyGstin}
                  </p>
                ) : null}
                {invoice.companyPan ? (
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    <span className="text-slate-500 dark:text-slate-400">PAN </span>
                    {invoice.companyPan}
                  </p>
                ) : null}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
                <MicroLabel as="p" variant="section">
                  Bill To
                </MicroLabel>
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
                {/* Rule 46(e): the recipient's GSTIN — what lets them claim the
                    input tax credit this invoice carries. */}
                {invoice.billToGstin ? (
                  <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <span className="text-slate-500 dark:text-slate-400">GSTIN </span>
                    {invoice.billToGstin}
                  </p>
                ) : null}
              </div>
            </section>

            <section className="px-6 py-5 sm:px-8">
              {/* Columns and cells both come from the shared builders, so this
                  table cannot disagree with the printed sheet about which
                  columns exist, in what order, or what an empty one means. */}
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                      {lineColumns.map((column) => (
                        <th
                          key={column.key}
                          scope="col"
                          className={`px-4 py-2 ${
                            column.align === "right" ? "text-right" : "text-left"
                          } ${column.wrap ? "" : "whitespace-nowrap"}`}
                        >
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(invoice.items || []).map((item, index) => (
                      <tr key={`${item.name}-${index}`}>
                        {buildLineItemCells(lineColumns, lineTableInput, index).map(
                          (cell, cellIndex) => (
                            <td
                              key={lineColumns[cellIndex].key}
                              className={`px-4 py-3 ${
                                lineColumns[cellIndex].align === "right"
                                  ? "tabular text-right text-slate-700 dark:text-slate-200"
                                  : "text-slate-800 dark:text-slate-100"
                              } ${
                                lineColumns[cellIndex].wrap
                                  ? ""
                                  : "whitespace-nowrap"
                              }`}
                            >
                              {cell || "-"}
                            </td>
                          )
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="flex justify-end px-6 pb-6 sm:px-8">
              {/* The one place every figure in the invoice is compared against
                  its neighbours, so the whole ladder gets tabular figures. */}
              <div className="tabular w-full max-w-sm text-sm">
                {totalsRows.map((row) => (
                  <div
                    key={row.label}
                    className={
                      row.kind === "grand"
                        ? "mt-2 flex justify-between border-t border-slate-200 pt-3 text-base font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100"
                        : row.kind === "info"
                          ? // Non-arithmetic (TDS): quieter than a real line, so
                            // it cannot read as a reduction of the total.
                            "flex justify-between py-1 text-xs text-slate-500 dark:text-slate-400"
                          : "flex justify-between py-1 text-slate-600 dark:text-slate-300"
                    }
                  >
                    <span>{row.label}</span>
                    <span>
                      {row.kind === "discount" ? "- " : ""}
                      {formatCurrency(row.amount, currency)}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {(invoice.terms || invoice.paymentInfo || invoice.notes) && (
              <section className="grid gap-4 border-t border-slate-200 px-6 py-5 sm:grid-cols-3 sm:px-8 dark:border-slate-700">
                {invoice.terms ? (
                  <div>
                    <MicroLabel as="h4" variant="section">
                      Terms
                    </MicroLabel>
                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      {invoice.terms}
                    </p>
                  </div>
                ) : null}
                {invoice.paymentInfo ? (
                  <div>
                    <MicroLabel as="h4" variant="section">
                      Payment Information
                    </MicroLabel>
                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      {invoice.paymentInfo}
                    </p>
                  </div>
                ) : null}
                {invoice.notes ? (
                  <div>
                    <MicroLabel as="h4" variant="section">
                      Notes
                    </MicroLabel>
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
    </Modal>
  );
}
