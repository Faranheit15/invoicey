import { describe, it, expect } from "bun:test";
import {
  shouldInterceptNavigation,
  UNSAVED_CHANGES_MESSAGE,
  type NavigationClick,
  type NavigationTarget,
} from "@/lib/navigation-guard";

const CONTEXT = {
  currentHref: "https://invoicey.app/create-invoice",
  origin: "https://invoicey.app",
};

const plainClick: NavigationClick = { button: 0 };
const link = (overrides: Partial<NavigationTarget> = {}): NavigationTarget => ({
  href: "https://invoicey.app/dashboard",
  ...overrides,
});

describe("shouldInterceptNavigation", () => {
  it("intercepts a plain click on a same-origin link", () => {
    expect(shouldInterceptNavigation(plainClick, link(), CONTEXT)).toBe(true);
  });

  it("ignores a click that hit no link", () => {
    expect(shouldInterceptNavigation(plainClick, null, CONTEXT)).toBe(false);
  });

  it("ignores modified clicks — they open a new tab, so this page stays put", () => {
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(
        shouldInterceptNavigation({ ...plainClick, [modifier]: true }, link(), CONTEXT)
      ).toBe(false);
    }
  });

  it("ignores middle and right clicks", () => {
    expect(shouldInterceptNavigation({ button: 1 }, link(), CONTEXT)).toBe(false);
    expect(shouldInterceptNavigation({ button: 2 }, link(), CONTEXT)).toBe(false);
  });

  it("ignores a click something else already handled", () => {
    expect(
      shouldInterceptNavigation({ ...plainClick, defaultPrevented: true }, link(), CONTEXT)
    ).toBe(false);
  });

  it("ignores target=_blank but honours target=_self", () => {
    expect(
      shouldInterceptNavigation(plainClick, link({ target: "_blank" }), CONTEXT)
    ).toBe(false);
    expect(
      shouldInterceptNavigation(plainClick, link({ target: "_self" }), CONTEXT)
    ).toBe(true);
    expect(shouldInterceptNavigation(plainClick, link({ target: "" }), CONTEXT)).toBe(
      true
    );
  });

  it("ignores a download link — the page is not going anywhere", () => {
    // Load-bearing here: the export menu's HTML/CSV/JSON downloads are anchors.
    expect(
      shouldInterceptNavigation(plainClick, link({ download: true }), CONTEXT)
    ).toBe(false);
  });

  it("ignores a cross-origin link — beforeunload already covers those", () => {
    expect(
      shouldInterceptNavigation(
        plainClick,
        link({ href: "https://buymeacoffee.com/faaaaraaaan" }),
        CONTEXT
      )
    ).toBe(false);
  });

  it("ignores a bare fragment and a link to the page we are already on", () => {
    expect(shouldInterceptNavigation(plainClick, link({ href: "#items" }), CONTEXT)).toBe(
      false
    );
    expect(
      shouldInterceptNavigation(
        plainClick,
        link({ href: "https://invoicey.app/create-invoice" }),
        CONTEXT
      )
    ).toBe(false);
    expect(
      shouldInterceptNavigation(
        plainClick,
        link({ href: "https://invoicey.app/create-invoice#totals" }),
        CONTEXT
      )
    ).toBe(false);
  });

  it("intercepts a same-path link with a different query", () => {
    expect(
      shouldInterceptNavigation(
        plainClick,
        link({ href: "https://invoicey.app/create-invoice?mode=edit" }),
        CONTEXT
      )
    ).toBe(true);
  });

  it("resolves a relative href against the current page", () => {
    expect(shouldInterceptNavigation(plainClick, link({ href: "/dashboard" }), CONTEXT)).toBe(
      true
    );
  });

  it("honours the data-no-guard opt-out", () => {
    expect(shouldInterceptNavigation(plainClick, link({ optedOut: true }), CONTEXT)).toBe(
      false
    );
  });

  it("ignores an unparseable href instead of throwing", () => {
    expect(
      shouldInterceptNavigation(plainClick, link({ href: "http://[bad" }), CONTEXT)
    ).toBe(false);
  });

  it("treats an absent button as a primary click", () => {
    expect(shouldInterceptNavigation({}, link(), CONTEXT)).toBe(true);
  });
});

describe("UNSAVED_CHANGES_MESSAGE", () => {
  it("says what is at stake, since the in-app dialog can actually show it", () => {
    expect(UNSAVED_CHANGES_MESSAGE).toContain("unsaved changes");
  });
});
