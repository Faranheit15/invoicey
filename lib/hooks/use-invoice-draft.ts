"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearInvoiceDraft,
  invoiceDraftKey,
  pruneInvoiceDrafts,
  readInvoiceDraft,
  writeInvoiceDraft,
  type InvoiceDraftMode,
  type RestorableDraft,
} from "@/lib/invoice-draft";
import type { InvoiceFormState } from "@/lib/invoices";

export interface UseInvoiceDraftOptions {
  /** Firebase uid. Empty until the session resolves; nothing is stored until it does. */
  userId: string;
  mode: InvoiceDraftMode;
  invoiceId?: string;
  /** Create mode: keeps a proforma draft out of the invoice draft's slot. */
  documentKind?: string;
  /** The live form state. */
  state: InvoiceFormState;
  /**
   * Autosave only once the user has actually touched the form. Saving the
   * pristine default would create a draft nobody typed, and then offer to
   * restore it.
   */
  isDirty: boolean;
  /**
   * False while the editor is still loading an existing invoice, or while it is
   * saving. Writing during the load would persist the empty placeholder over a
   * real draft.
   */
  enabled?: boolean;
  /** Debounce, ms. Long enough that typing does not hit localStorage per key. */
  debounceMs?: number;
}

export interface UseInvoiceDraftResult {
  /**
   * A draft found on mount that the user has not yet accepted or dismissed.
   * Render an offer, never apply it silently: the user may have deliberately
   * abandoned it, and overwriting a freshly loaded invoice with a stale draft
   * is the one failure mode worse than losing the draft.
   */
  pendingDraft: RestorableDraft | null;
  /** Accept it: hand the state back so the editor can `setInvoice` it. */
  restoreDraft: () => InvoiceFormState | null;
  /** Refuse it, and delete it. */
  discardDraft: () => void;
  /** Delete the draft for this key. Call after a successful save. */
  clearDraft: () => void;
  /** When the current draft was last written, or null if none. */
  savedAt: number | null;
}

const DEFAULT_DEBOUNCE_MS = 800;

const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Safari private mode and "block all cookies" both throw on access.
    return null;
  }
};

/**
 * Autosave the editor's form state to localStorage, and offer to restore it.
 *
 * All the rules live in `lib/invoice-draft.ts` (keying, expiry, versioning,
 * privacy); this is the React adapter around them.
 */
export function useInvoiceDraft({
  userId,
  mode,
  invoiceId,
  documentKind,
  state,
  isDirty,
  enabled = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseInvoiceDraftOptions): UseInvoiceDraftResult {
  const key = invoiceDraftKey({ userId, mode, invoiceId, documentKind });
  const [pendingDraft, setPendingDraft] = useState<RestorableDraft | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Read once per key. Also sweeps every expired draft on the device while it
  // is here — this is the one moment something is guaranteed to look at them.
  useEffect(() => {
    const store = storage();
    if (!store || !key) {
      setPendingDraft(null);
      return;
    }
    pruneInvoiceDrafts(store);
    setPendingDraft(readInvoiceDraft(store, key));
  }, [key]);

  useEffect(() => {
    const store = storage();
    if (!store || !key || !enabled || !isDirty) {
      return;
    }
    const timer = setTimeout(() => {
      const now = Date.now();
      if (writeInvoiceDraft(store, key, stateRef.current, now)) {
        setSavedAt(now);
      }
    }, debounceMs);
    return () => clearTimeout(timer);
    // `state` is the dependency that matters: every edit reschedules the write.
  }, [key, enabled, isDirty, debounceMs, state]);

  const restoreDraft = useCallback((): InvoiceFormState | null => {
    if (!pendingDraft) {
      return null;
    }
    setPendingDraft(null);
    return pendingDraft.state;
  }, [pendingDraft]);

  const clearDraft = useCallback(() => {
    const store = storage();
    if (store && key) {
      clearInvoiceDraft(store, key);
    }
    setSavedAt(null);
  }, [key]);

  const discardDraft = useCallback(() => {
    setPendingDraft(null);
    clearDraft();
  }, [clearDraft]);

  return { pendingDraft, restoreDraft, discardDraft, clearDraft, savedAt };
}
