/**
 * localStorage draft persistence for the invoice editor.
 *
 * Today one back-swipe destroys everything typed into the editor: there is no
 * `beforeunload`, no route-change guard, and nothing writes the form to disk.
 * Ten minutes of typing — or an accepted AI draft — is gone with no
 * confirmation, on the intermittent connections this audience actually uses.
 *
 * All the decisions live here as pure functions over a `DraftStorage`, so the
 * expiry, key and version rules can be tested without a browser. The React hook
 * (`lib/hooks/use-invoice-draft.ts`) is only the adapter.
 *
 * PRIVACY. A draft contains the client's name, email, billing address, line
 * items and amounts — personal data under the DPDP Act, sitting unencrypted in
 * localStorage on a machine that may be shared. Three rules follow, and none of
 * them is optional:
 *
 *   1. It is keyed by user id, so a second account signing in on the same
 *      browser cannot read the first one's draft.
 *   2. It EXPIRES. A draft older than `INVOICE_DRAFT_TTL_MS` is refused on read
 *      and deleted, so an abandoned client's address does not resurface months
 *      later on a machine the user has since passed on.
 *   3. It must be cleared on sign-out and on account deletion. Both paths run
 *      `UserSessionManager.clearLocal()`, whose `localStorage.clear()` already
 *      removes these keys — but that is an accident of implementation, so
 *      `clearAllInvoiceDrafts` exists to make it a stated guarantee.
 */

import type { InvoiceFormState } from "@/lib/invoices";

/**
 * The subset of `Storage` this module uses. Narrowed so tests can pass a Map
 * and so nothing here can reach for a global.
 */
export interface DraftStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const INVOICE_DRAFT_PREFIX = "invoicey-draft:";

/**
 * Bumped whenever `InvoiceFormState` changes shape in a way an old draft cannot
 * satisfy. A version mismatch is treated exactly like an expiry: dropped, never
 * migrated. Restoring a half-shaped form is worse than losing it, because the
 * user cannot see which half is missing.
 */
export const INVOICE_DRAFT_VERSION = 1;

/**
 * Seven days. Long enough to survive a weekend, a crashed tab or a lost
 * connection — the cases this feature exists for — and short enough that a
 * draft is never a surprise. A month-old restore prompt would be read as a bug,
 * and it is a month of someone's client data sitting on disk for no benefit.
 */
export const INVOICE_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InvoiceDraftMode = "create" | "edit";

export interface InvoiceDraftKeyParts {
  userId: string;
  mode: InvoiceDraftMode;
  /** Required in edit mode; ignored in create mode. */
  invoiceId?: string;
}

/**
 * One key per (user, mode, invoice). Editing two invoices in two tabs must not
 * have them overwrite each other, and the create-mode draft is a third,
 * separate thing that must survive opening an existing invoice.
 *
 * Returns `null` when there is no user id — an unauthenticated editor has no
 * safe place to put this, and a shared "anonymous" key would leak one person's
 * client details to the next person on the machine.
 */
export const invoiceDraftKey = ({
  userId,
  mode,
  invoiceId,
}: InvoiceDraftKeyParts): string | null => {
  const uid = (userId || "").trim();
  if (!uid) {
    return null;
  }
  if (mode === "edit") {
    const id = (invoiceId || "").trim();
    return id ? `${INVOICE_DRAFT_PREFIX}${uid}:edit:${id}` : null;
  }
  return `${INVOICE_DRAFT_PREFIX}${uid}:create`;
};

export interface StoredInvoiceDraft {
  v: number;
  savedAt: number;
  state: InvoiceFormState;
}

export interface RestorableDraft {
  state: InvoiceFormState;
  savedAt: number;
  /** Whole minutes since the save, for "saved 4 minutes ago" copy. */
  ageMs: number;
}

export const serializeInvoiceDraft = (
  state: InvoiceFormState,
  now: number = Date.now()
): string =>
  JSON.stringify({
    v: INVOICE_DRAFT_VERSION,
    savedAt: now,
    state,
  } satisfies StoredInvoiceDraft);

/**
 * Parse a stored draft, or `null` for anything that cannot be trusted: corrupt
 * JSON, a wrong version, a missing/absurd timestamp, a non-object state, or an
 * expired one.
 *
 * A future `savedAt` is rejected too. It means the clock moved backwards (or a
 * hand-edited value), and an "expiry" measured against it would never fire.
 */
export const parseInvoiceDraft = (
  raw: string | null,
  options: { now?: number; ttlMs?: number } = {}
): RestorableDraft | null => {
  if (!raw) {
    return null;
  }
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? INVOICE_DRAFT_TTL_MS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const draft = parsed as Partial<StoredInvoiceDraft>;
  if (draft.v !== INVOICE_DRAFT_VERSION) {
    return null;
  }
  if (typeof draft.savedAt !== "number" || !Number.isFinite(draft.savedAt)) {
    return null;
  }
  if (!draft.state || typeof draft.state !== "object") {
    return null;
  }

  const ageMs = now - draft.savedAt;
  if (ageMs < 0 || ageMs > ttlMs) {
    return null;
  }

  return { state: draft.state as InvoiceFormState, savedAt: draft.savedAt, ageMs };
};

export const isInvoiceDraftExpired = (
  savedAt: number,
  options: { now?: number; ttlMs?: number } = {}
): boolean => {
  const age = (options.now ?? Date.now()) - savedAt;
  return age < 0 || age > (options.ttlMs ?? INVOICE_DRAFT_TTL_MS);
};

/**
 * Read and validate. An unreadable or expired draft is DELETED on the way out
 * rather than left to rot — the read is the only moment anything is guaranteed
 * to look at that key again.
 */
export const readInvoiceDraft = (
  storage: DraftStorage,
  key: string,
  options: { now?: number; ttlMs?: number } = {}
): RestorableDraft | null => {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  const draft = parseInvoiceDraft(raw, options);
  if (!draft && raw !== null) {
    clearInvoiceDraft(storage, key);
  }
  return draft;
};

/**
 * Write, swallowing quota and private-mode failures. A draft that cannot be
 * saved must never break the editor the user is typing into — losing the
 * safety net is bad, losing the form is worse.
 */
export const writeInvoiceDraft = (
  storage: DraftStorage,
  key: string,
  state: InvoiceFormState,
  now: number = Date.now()
): boolean => {
  try {
    storage.setItem(key, serializeInvoiceDraft(state, now));
    return true;
  } catch {
    return false;
  }
};

export const clearInvoiceDraft = (storage: DraftStorage, key: string): void => {
  try {
    storage.removeItem(key);
  } catch {
    /* nothing to do: the draft is best-effort in both directions */
  }
};

/** Every draft key currently in storage, in storage order. */
export const invoiceDraftKeys = (storage: DraftStorage): string[] => {
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith(INVOICE_DRAFT_PREFIX)) {
        keys.push(key);
      }
    }
  } catch {
    return keys;
  }
  return keys;
};

/**
 * Delete every draft on this device.
 *
 * **Call this on sign-out and on account deletion.** See the privacy note at
 * the top: the drafts hold client names, addresses and amounts, and leaving
 * them behind after the session ends hands them to whoever signs in next.
 */
export const clearAllInvoiceDrafts = (storage: DraftStorage): number => {
  const keys = invoiceDraftKeys(storage);
  for (const key of keys) {
    clearInvoiceDraft(storage, key);
  }
  return keys.length;
};

/** Delete only the drafts belonging to one user — the finer-grained sign-out. */
export const clearInvoiceDraftsForUser = (
  storage: DraftStorage,
  userId: string
): number => {
  const uid = (userId || "").trim();
  if (!uid) {
    return 0;
  }
  const prefix = `${INVOICE_DRAFT_PREFIX}${uid}:`;
  const keys = invoiceDraftKeys(storage).filter((key) => key.startsWith(prefix));
  for (const key of keys) {
    clearInvoiceDraft(storage, key);
  }
  return keys.length;
};

/**
 * Sweep expired and unreadable drafts. Cheap, and it means an abandoned draft
 * is gone from disk at the next editor open rather than only when something
 * happens to read that exact key.
 */
export const pruneInvoiceDrafts = (
  storage: DraftStorage,
  options: { now?: number; ttlMs?: number } = {}
): number => {
  let removed = 0;
  for (const key of invoiceDraftKeys(storage)) {
    let raw: string | null = null;
    try {
      raw = storage.getItem(key);
    } catch {
      continue;
    }
    if (!parseInvoiceDraft(raw, options)) {
      clearInvoiceDraft(storage, key);
      removed += 1;
    }
  }
  return removed;
};
