import { describe, it, expect } from "bun:test";
import nextConfig from "@/next.config";

const headerRules = await nextConfig.headers!();
const rule = headerRules[0]!;
const headers = new Map(rule.headers.map((h) => [h.key, h.value]));

const csp = headers.get("Content-Security-Policy-Report-Only") ?? "";
const directive = (name: string) =>
  csp
    .split("; ")
    .find((part) => part === name || part.startsWith(`${name} `)) ?? "";

describe("security headers", () => {
  it("applies to every route", () => {
    expect(rule.source).toBe("/:path*");
  });

  it("ships the non-CSP baseline", () => {
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin"
    );
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
  });

  it("blocks framing with a header, not only with the CSP", () => {
    // frame-ancestors is ignored while the policy is report-only, so
    // X-Frame-Options is what actually stops clickjacking today.
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  it("keeps the CSP report-only so it cannot break the product", () => {
    expect(csp).not.toBe("");
    expect(headers.has("Content-Security-Policy")).toBe(false);
  });

  it("allows the inline theme init script", () => {
    expect(directive("script-src")).toContain("'unsafe-inline'");
  });

  it("allows Firebase Auth's REST endpoints and sign-in popup", () => {
    expect(directive("connect-src")).toContain(
      "https://identitytoolkit.googleapis.com"
    );
    expect(directive("connect-src")).toContain(
      "https://securetoken.googleapis.com"
    );
    expect(directive("script-src")).toContain("https://apis.google.com");
    expect(directive("frame-src")).toContain("https://apis.google.com");
  });

  it("permits the blob: invoice document in both popup and iframe shapes", () => {
    // A blob: document inherits this CSP, so its inline <style>/<script> and its
    // logo <img> have to be covered; frame-src covers the hidden-iframe variant.
    expect(directive("img-src")).toContain("blob:");
    expect(directive("frame-src")).toContain("blob:");
    expect(directive("style-src")).toContain("'unsafe-inline'");
    expect(directive("script-src")).toContain("'unsafe-inline'");
  });

  it("allows arbitrary https logo URLs the exporter already accepts", () => {
    expect(directive("img-src")).toContain("https:");
  });

  it("locks down the directives with no legitimate use here", () => {
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
    expect(directive("form-action")).toBe("form-action 'self'");
  });
});
