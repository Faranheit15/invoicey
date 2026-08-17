import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { INVOICE_DRAFT_PREFIX, INVOICE_DRAFT_TTL_MS } from "@/lib/invoice-draft";

/**
 * The privacy policy is a claim about what the code does, so it is checked
 * against the code — the same class of guard as the JSX source checks in
 * tests/invoices.test.ts, and for the same reason: these strings have no other
 * test, and every one of them has been wrong at least once.
 *
 * Two things were missing when the launch-blocker pass started:
 *
 *  1. The localStorage invoice DRAFT. `lib/invoice-draft.ts` writes the client's
 *     name, address, line items and amounts to the user's browser and keeps
 *     them for seven days. The policy's "Cookies and browser storage" section
 *     listed the session cookies and the theme key and stopped there.
 *  2. The BUSINESS PROFILE — GSTIN, PAN, bank account, IFSC, UPI VPA — which is
 *     stored, is destroyed by account deletion, and (until this pass) was not
 *     even in the data export.
 */

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const privacy = read("app/privacy/page.tsx");
const account = read("app/account/page.tsx");
const dangerZone = read("components/AccountDangerZone.tsx");

describe("/privacy discloses the localStorage invoice draft", () => {
  it("names the storage key the code actually writes", () => {
    expect(INVOICE_DRAFT_PREFIX).toBe("invoicey-draft:");
    expect(privacy).toContain(INVOICE_DRAFT_PREFIX);
  });

  it("says what is in it — the client's details and the amounts", () => {
    expect(privacy).toContain("local storage as you type");
    expect(privacy.replace(/\s+/g, " ")).toContain(
      "address and email, the line items and the amounts"
    );
  });

  it("states the retention the code enforces", () => {
    expect(INVOICE_DRAFT_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(privacy.replace(/\s+/g, " ")).toContain("up to seven days");
  });

  it("says it stays on the device rather than implying we receive it", () => {
    expect(privacy.replace(/\s+/g, " ")).toContain("never leaves your browser");
  });
});

describe("/privacy discloses the business profile", () => {
  it("lists it in what we collect, bank details named", () => {
    const collapsed = privacy.replace(/\s+/g, " ");
    expect(collapsed).toContain("Your business details.");
    expect(collapsed).toContain("your GSTIN and PAN");
    expect(collapsed).toContain("IFSC code, bank name and UPI ID");
  });

  it("names it in the export and the deletion rights, where it is load-bearing", () => {
    const collapsed = privacy.replace(/\s+/g, " ");
    expect(collapsed).toContain("your saved business details");
    expect(collapsed).toContain("your business profile");
  });
});

describe("the account page describes the file the export actually produces", () => {
  it("promises the business details it now contains", () => {
    const collapsed = account.replace(/\s+/g, " ");
    expect(collapsed).toContain("saved business details");
    expect(collapsed).toContain("GSTIN");
  });

  it("does not sell CSV as an equivalent of the JSON", () => {
    const collapsed = account.replace(/\s+/g, " ");
    expect(collapsed).toContain("JSON is the complete record");
    expect(collapsed).toContain("no line items");
  });

  it("warns that deletion destroys the business profile too", () => {
    const collapsed = dangerZone.replace(/\s+/g, " ");
    expect(collapsed).toContain("saved business details");
  });
});
