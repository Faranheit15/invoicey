"use client";

import { useCallback, useMemo, useState } from "react";
import { ChatBubbleIcon, Share1Icon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { resolveRecordAmounts } from "@/lib/invoice-domain";
import type { InvoiceRecord } from "@/lib/invoices";
import { buildShareMessage, buildWhatsAppUrl } from "@/components/invoice-share";

interface ShareInvoiceButtonsProps {
  invoice: InvoiceRecord;
  /** The seller's UPI ID from the business profile. Appended to the draft for INR. */
  upiVpa?: string;
  /** Recipient's number. Unrecognised formats are dropped, not guessed. */
  phone?: string;
  className?: string;
}

/**
 * Hand the invoice off to WhatsApp — or to the OS share sheet where there is
 * one.
 *
 * WHAT THIS DOES NOT DO: send anything. It opens the user's own WhatsApp with a
 * draft in the composer, which they then edit and send themselves, under their
 * own name, from their own number. `PRODUCT.md` forbids the product sending on
 * the user's behalf, and this stays on the correct side of that line only as
 * long as the copy does too — the button says "Share on WhatsApp", never
 * "Send", and the helper line says the message opens rather than goes.
 *
 * The file is not attached: no web API can put a file into WhatsApp's composer,
 * and `navigator.share` with files is unavailable on the desktop browsers that
 * are this product's real usage scene. The user exports the PDF and attaches
 * it, so the draft never claims an attachment exists.
 */
export function ShareInvoiceButtons({
  invoice,
  upiVpa,
  phone,
  className,
}: ShareInvoiceButtonsProps) {
  const [status, setStatus] = useState("");

  const message = useMemo(
    () =>
      buildShareMessage({
        invoice,
        total: resolveRecordAmounts(invoice).total,
        upiVpa,
      }),
    [invoice, upiVpa]
  );

  const openWhatsApp = useCallback(() => {
    setStatus("");
    // `noopener` is not optional on a `window.open` to a third-party origin:
    // without it the opened tab gets a handle on this one via `window.opener`.
    window.open(
      buildWhatsAppUrl({ message, phone }),
      "_blank",
      "noopener,noreferrer"
    );
  }, [message, phone]);

  /**
   * `navigator.share` where it exists — which on a phone is the share sheet the
   * user already knows, including WhatsApp itself. It must be called straight
   * out of the click handler: browsers require a user gesture, and an `await`
   * before it (fetching, generating a file) spends the gesture and the call
   * throws `NotAllowedError`.
   *
   * Cancelling the sheet rejects with `AbortError`. That is the user saying no,
   * not a failure, so it is swallowed; anything else falls back to WhatsApp so
   * the button always does something.
   */
  const shareNative = useCallback(async () => {
    setStatus("");
    if (typeof navigator === "undefined" || !navigator.share) {
      openWhatsApp();
      return;
    }
    try {
      await navigator.share({
        title: invoice.invoiceNumber
          ? `Invoice ${invoice.invoiceNumber}`
          : "Invoice",
        text: message,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      setStatus("Couldn't open the share sheet — opening WhatsApp instead.");
      openWhatsApp();
    }
  }, [invoice.invoiceNumber, message, openWhatsApp]);

  const canShareNatively =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={openWhatsApp}>
          <ChatBubbleIcon aria-hidden="true" />
          Share on WhatsApp
        </Button>
        {canShareNatively ? (
          <Button type="button" variant="ghost" onClick={shareNative}>
            <Share1Icon aria-hidden="true" />
            Share&hellip;
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Opens WhatsApp with the message ready. You attach the invoice and press
        send &mdash; Invoicey never sends anything for you.
      </p>
      {status ? (
        <p
          role="status"
          className="mt-1 text-xs text-amber-600 dark:text-amber-300"
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}
