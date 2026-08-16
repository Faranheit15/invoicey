import { describe, it, expect } from "bun:test";
import {
  INVOICE_DRAFT_PREFIX,
  INVOICE_DRAFT_TTL_MS,
  INVOICE_DRAFT_VERSION,
  clearAllInvoiceDrafts,
  clearInvoiceDraft,
  clearInvoiceDraftsForUser,
  invoiceDraftKey,
  invoiceDraftKeys,
  isInvoiceDraftExpired,
  parseInvoiceDraft,
  pruneInvoiceDrafts,
  readInvoiceDraft,
  serializeInvoiceDraft,
  writeInvoiceDraft,
  type DraftStorage,
} from "@/lib/invoice-draft";
import { createDefaultInvoiceFormState } from "@/lib/invoices";
import type { InvoiceFormState } from "@/lib/invoices";

/** A `Storage`-shaped Map. No jsdom, no globals, no cleanup between tests. */
class MemoryStorage implements DraftStorage {
  private map = new Map<string, string>();
  /** Set to make every write throw, as Safari private mode does. */
  failWrites = false;

  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) {
      throw new DOMException("QuotaExceededError");
    }
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

const NOW = 1_800_000_000_000;

const formState = (overrides: Partial<InvoiceFormState> = {}): InvoiceFormState => ({
  ...createDefaultInvoiceFormState(),
  billTo: "Nova Health Pvt Ltd",
  ...overrides,
});

describe("invoiceDraftKey", () => {
  it("keys create mode by user", () => {
    expect(invoiceDraftKey({ userId: "uid-1", mode: "create" })).toBe(
      `${INVOICE_DRAFT_PREFIX}uid-1:create`
    );
  });

  it("keys edit mode by user AND invoice, so two tabs cannot collide", () => {
    expect(
      invoiceDraftKey({ userId: "uid-1", mode: "edit", invoiceId: "inv-9" })
    ).toBe(`${INVOICE_DRAFT_PREFIX}uid-1:edit:inv-9`);
    expect(
      invoiceDraftKey({ userId: "uid-1", mode: "edit", invoiceId: "inv-9" })
    ).not.toBe(invoiceDraftKey({ userId: "uid-1", mode: "create" }));
  });

  it("gives two users different keys — a draft holds the client's address", () => {
    expect(invoiceDraftKey({ userId: "uid-1", mode: "create" })).not.toBe(
      invoiceDraftKey({ userId: "uid-2", mode: "create" })
    );
  });

  it("refuses to key anything without a user id", () => {
    // A shared "anonymous" key would hand one person's client details to
    // whoever opens the editor next on the same machine.
    expect(invoiceDraftKey({ userId: "", mode: "create" })).toBeNull();
    expect(invoiceDraftKey({ userId: "   ", mode: "create" })).toBeNull();
  });

  it("refuses edit mode without an invoice id", () => {
    expect(invoiceDraftKey({ userId: "uid-1", mode: "edit" })).toBeNull();
    expect(
      invoiceDraftKey({ userId: "uid-1", mode: "edit", invoiceId: "  " })
    ).toBeNull();
  });
});

describe("parseInvoiceDraft", () => {
  it("round-trips a serialized draft", () => {
    const state = formState();
    const draft = parseInvoiceDraft(serializeInvoiceDraft(state, NOW), { now: NOW });
    expect(draft?.state.billTo).toBe("Nova Health Pvt Ltd");
    expect(draft?.savedAt).toBe(NOW);
    expect(draft?.ageMs).toBe(0);
  });

  it("accepts a draft one millisecond inside the TTL", () => {
    const raw = serializeInvoiceDraft(formState(), NOW);
    const draft = parseInvoiceDraft(raw, { now: NOW + INVOICE_DRAFT_TTL_MS });
    expect(draft).not.toBeNull();
    expect(draft?.ageMs).toBe(INVOICE_DRAFT_TTL_MS);
  });

  it("refuses a draft one millisecond past the TTL", () => {
    const raw = serializeInvoiceDraft(formState(), NOW);
    expect(parseInvoiceDraft(raw, { now: NOW + INVOICE_DRAFT_TTL_MS + 1 })).toBeNull();
  });

  it("refuses a draft from months ago — a stale client address must not resurface", () => {
    const raw = serializeInvoiceDraft(formState(), NOW);
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    expect(parseInvoiceDraft(raw, { now: NOW + ninetyDays })).toBeNull();
  });

  it("refuses a draft saved in the future — the clock moved, so the TTL is meaningless", () => {
    const raw = serializeInvoiceDraft(formState(), NOW);
    expect(parseInvoiceDraft(raw, { now: NOW - 1 })).toBeNull();
  });

  it("honours a caller-supplied TTL", () => {
    const raw = serializeInvoiceDraft(formState(), NOW);
    expect(parseInvoiceDraft(raw, { now: NOW + 500, ttlMs: 1000 })).not.toBeNull();
    expect(parseInvoiceDraft(raw, { now: NOW + 1500, ttlMs: 1000 })).toBeNull();
  });

  it("refuses a draft written by another version rather than migrating it", () => {
    const raw = JSON.stringify({
      v: INVOICE_DRAFT_VERSION + 1,
      savedAt: NOW,
      state: formState(),
    });
    expect(parseInvoiceDraft(raw, { now: NOW })).toBeNull();
  });

  it("refuses corrupt, empty and structurally wrong payloads", () => {
    for (const raw of [
      null,
      "",
      "not json",
      "[]",
      '"a string"',
      "null",
      JSON.stringify({ v: INVOICE_DRAFT_VERSION, savedAt: NOW }),
      JSON.stringify({ v: INVOICE_DRAFT_VERSION, savedAt: "yesterday", state: {} }),
      JSON.stringify({ v: INVOICE_DRAFT_VERSION, savedAt: NaN, state: {} }),
      JSON.stringify({ savedAt: NOW, state: {} }),
      JSON.stringify({ v: INVOICE_DRAFT_VERSION, savedAt: NOW, state: "x" }),
    ]) {
      expect(parseInvoiceDraft(raw, { now: NOW })).toBeNull();
    }
  });
});

describe("isInvoiceDraftExpired", () => {
  it("holds the boundary in both directions", () => {
    expect(isInvoiceDraftExpired(NOW, { now: NOW })).toBe(false);
    expect(
      isInvoiceDraftExpired(NOW, { now: NOW + INVOICE_DRAFT_TTL_MS })
    ).toBe(false);
    expect(
      isInvoiceDraftExpired(NOW, { now: NOW + INVOICE_DRAFT_TTL_MS + 1 })
    ).toBe(true);
    expect(isInvoiceDraftExpired(NOW, { now: NOW - 1 })).toBe(true);
  });
});

describe("read / write", () => {
  it("writes and reads back", () => {
    const store = new MemoryStorage();
    const key = invoiceDraftKey({ userId: "uid-1", mode: "create" }) as string;
    expect(writeInvoiceDraft(store, key, formState(), NOW)).toBe(true);
    expect(readInvoiceDraft(store, key, { now: NOW })?.state.billTo).toBe(
      "Nova Health Pvt Ltd"
    );
  });

  it("reports failure instead of throwing when storage refuses the write", () => {
    // Losing the safety net is bad; taking the editor down with it is worse.
    const store = new MemoryStorage();
    store.failWrites = true;
    expect(writeInvoiceDraft(store, "k", formState(), NOW)).toBe(false);
  });

  it("deletes an expired draft on the way out of the read", () => {
    const store = new MemoryStorage();
    store.setItem("k", serializeInvoiceDraft(formState(), NOW));
    expect(
      readInvoiceDraft(store, "k", { now: NOW + INVOICE_DRAFT_TTL_MS + 1 })
    ).toBeNull();
    expect(store.getItem("k")).toBeNull();
  });

  it("deletes a corrupt draft on read", () => {
    const store = new MemoryStorage();
    store.setItem("k", "{{{");
    expect(readInvoiceDraft(store, "k", { now: NOW })).toBeNull();
    expect(store.getItem("k")).toBeNull();
  });

  it("leaves an absent key alone", () => {
    const store = new MemoryStorage();
    expect(readInvoiceDraft(store, "missing", { now: NOW })).toBeNull();
    expect(store.length).toBe(0);
  });

  it("clearing a key that is not there is a no-op", () => {
    const store = new MemoryStorage();
    expect(() => clearInvoiceDraft(store, "nope")).not.toThrow();
  });
});

describe("clearing (sign-out and account deletion)", () => {
  const seed = () => {
    const store = new MemoryStorage();
    store.setItem(
      `${INVOICE_DRAFT_PREFIX}uid-1:create`,
      serializeInvoiceDraft(formState(), NOW)
    );
    store.setItem(
      `${INVOICE_DRAFT_PREFIX}uid-1:edit:inv-9`,
      serializeInvoiceDraft(formState(), NOW)
    );
    store.setItem(
      `${INVOICE_DRAFT_PREFIX}uid-2:create`,
      serializeInvoiceDraft(formState(), NOW)
    );
    store.setItem("invoicey-theme", "dark");
    store.setItem("user", '{"uid":"uid-1"}');
    return store;
  };

  it("enumerates only draft keys", () => {
    expect(invoiceDraftKeys(seed())).toEqual([
      `${INVOICE_DRAFT_PREFIX}uid-1:create`,
      `${INVOICE_DRAFT_PREFIX}uid-1:edit:inv-9`,
      `${INVOICE_DRAFT_PREFIX}uid-2:create`,
    ]);
  });

  it("clearAllInvoiceDrafts removes every draft and nothing else", () => {
    const store = seed();
    expect(clearAllInvoiceDrafts(store)).toBe(3);
    expect(invoiceDraftKeys(store)).toEqual([]);
    expect(store.getItem("invoicey-theme")).toBe("dark");
  });

  it("clearInvoiceDraftsForUser leaves the other user's drafts", () => {
    const store = seed();
    expect(clearInvoiceDraftsForUser(store, "uid-1")).toBe(2);
    expect(invoiceDraftKeys(store)).toEqual([`${INVOICE_DRAFT_PREFIX}uid-2:create`]);
  });

  it("clearInvoiceDraftsForUser with no user id clears nothing", () => {
    const store = seed();
    expect(clearInvoiceDraftsForUser(store, "")).toBe(0);
    expect(invoiceDraftKeys(store)).toHaveLength(3);
  });

  it("a user id is not a prefix of another user's keys", () => {
    const store = new MemoryStorage();
    store.setItem(
      `${INVOICE_DRAFT_PREFIX}uid-1:create`,
      serializeInvoiceDraft(formState(), NOW)
    );
    store.setItem(
      `${INVOICE_DRAFT_PREFIX}uid-10:create`,
      serializeInvoiceDraft(formState(), NOW)
    );
    clearInvoiceDraftsForUser(store, "uid-1");
    expect(invoiceDraftKeys(store)).toEqual([`${INVOICE_DRAFT_PREFIX}uid-10:create`]);
  });
});

describe("pruneInvoiceDrafts", () => {
  it("sweeps expired and corrupt drafts, keeping the live ones", () => {
    const store = new MemoryStorage();
    store.setItem(
      `${INVOICE_DRAFT_PREFIX}uid-1:create`,
      serializeInvoiceDraft(formState(), NOW)
    );
    store.setItem(
      `${INVOICE_DRAFT_PREFIX}uid-1:edit:old`,
      serializeInvoiceDraft(formState(), NOW - INVOICE_DRAFT_TTL_MS - 1)
    );
    store.setItem(`${INVOICE_DRAFT_PREFIX}uid-1:edit:bad`, "{{{");

    expect(pruneInvoiceDrafts(store, { now: NOW })).toBe(2);
    expect(invoiceDraftKeys(store)).toEqual([`${INVOICE_DRAFT_PREFIX}uid-1:create`]);
  });

  it("is a no-op on an empty store", () => {
    expect(pruneInvoiceDrafts(new MemoryStorage(), { now: NOW })).toBe(0);
  });
});
