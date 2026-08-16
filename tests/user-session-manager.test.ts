import { describe, it, expect, afterEach } from "bun:test";

// js-cookie writes through `document.cookie`; Bun's test runner has no DOM, so
// stand up the smallest stub that records what was written.
const cookieWrites: string[] = [];

const installDocumentStub = () => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get cookie() {
        return "";
      },
      set cookie(value: string) {
        cookieWrites.push(value);
      },
    },
  });
};

afterEach(() => {
  cookieWrites.length = 0;
  Reflect.deleteProperty(globalThis, "document");
});

const { default: UserSessionManager } = await import("@/modules/UserSessionManager");

describe("UserSessionManager — legacy token purge", () => {
  // The Firebase ID/refresh tokens are no longer written, but a browser that
  // signed in before the change still holds them in a JS-readable cookie, and a
  // Firebase refresh token never expires. Constructing the manager — which every
  // page that touches session state does — has to destroy them.
  it("expires the legacy access-token and refresh-token cookies on construction", () => {
    installDocumentStub();

    new UserSessionManager();

    const purged = cookieWrites.filter((write) => write.includes("expires="));
    expect(purged.some((write) => write.startsWith("access-token="))).toBe(true);
    expect(purged.some((write) => write.startsWith("refresh-token="))).toBe(true);
  });

  it("does not touch the still-live session cookies", () => {
    installDocumentStub();

    new UserSessionManager();

    expect(cookieWrites.some((write) => write.startsWith("session-token="))).toBe(false);
    expect(cookieWrites.some((write) => write.startsWith("session-id="))).toBe(false);
  });

  it("is inert during SSR, where there is no document", () => {
    expect(() => new UserSessionManager()).not.toThrow();
    expect(cookieWrites).toEqual([]);
  });
});

/**
 * A localStorage stub whose `clear()` deliberately does NOTHING.
 *
 * That is the whole point of the assertion below: `clearLocal` used to remove
 * invoice drafts only as a side effect of `localStorage.clear()`, and an
 * incidental clear is one refactor away from leaving a previous user's client
 * names, emails, addresses and amounts on a shared machine. Neutering `clear()`
 * proves the drafts are removed by an explicit `clearAllInvoiceDrafts` call.
 */
const installLocalStorageStub = (seed: Record<string, string>) => {
  const map = new Map(Object.entries(seed));
  const clearCalls: number[] = [];
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return map.size;
      },
      key: (index: number) => [...map.keys()][index] ?? null,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
      clear: () => {
        clearCalls.push(1);
      },
    },
  });
  return { map, clearCalls };
};

describe("UserSessionManager.clearLocal — invoice drafts", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("deletes every invoice draft explicitly, not as a side effect of clear()", () => {
    installDocumentStub();
    const { map, clearCalls } = installLocalStorageStub({
      "invoicey-draft:uid-1:create": '{"v":1,"savedAt":0,"state":{}}',
      "invoicey-draft:uid-1:edit:inv-9": '{"v":1,"savedAt":0,"state":{}}',
      "invoicey-draft:uid-2:create": '{"v":1,"savedAt":0,"state":{}}',
      "invoicey-theme": "dark",
    });

    new UserSessionManager().clearLocal();

    expect([...map.keys()]).toEqual(["invoicey-theme"]);
    // The blanket clear still runs; it is simply no longer the thing the
    // privacy guarantee rests on.
    expect(clearCalls).toHaveLength(1);
  });

  it("clears the drafts when the session is torn down by setting user = null", () => {
    installDocumentStub();
    const { map } = installLocalStorageStub({
      "invoicey-draft:uid-1:create": '{"v":1,"savedAt":0,"state":{}}',
    });

    const manager = new UserSessionManager();
    manager.user = null;

    expect(map.has("invoicey-draft:uid-1:create")).toBe(false);
  });
});
