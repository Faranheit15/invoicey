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
