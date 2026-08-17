import { describe, it, expect } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import manifest from "@/app/manifest";

/**
 * A manifest that names a file which is not there does not fail loudly — the
 * browser fetches it, 404s the icon, and quietly decides the app is not
 * installable. Nothing in the UI says so. So the icon paths are checked against
 * the filesystem, which is the only way this class of bug ever surfaces before
 * a user tries to install.
 */

const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const value = manifest();

const fileFor = (src: string) => join(PUBLIC_DIR, src.replace(/^\//, ""));

describe("web app manifest", () => {
  it("is plain JSON — no undefined, no functions, no cycles", () => {
    expect(() => JSON.parse(JSON.stringify(value))).not.toThrow();
  });

  it("carries what a browser needs to offer an install", () => {
    expect(value.name).toBe("Invoicey");
    expect(value.short_name).toBe("Invoicey");
    expect(value.start_url).toBe("/dashboard");
    expect(value.scope).toBe("/");
    expect(value.display).toBe("standalone");
    expect(value.id).toBe("/");
    expect(value.prefer_related_applications).toBe(false);
  });

  it("keeps every referenced icon on disk and non-empty", () => {
    const sources = [
      ...(value.icons ?? []).map((icon) => icon.src),
      ...(value.shortcuts ?? []).flatMap((shortcut) =>
        (shortcut.icons ?? []).map((icon) => icon.src)
      ),
    ];

    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) {
      expect(src.startsWith("/")).toBe(true);
      const file = fileFor(src);
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(0);
    }
  });

  it("ships a raster icon of at least 192px, which is what Chrome checks", () => {
    const rasters = (value.icons ?? []).filter(
      (icon) => icon.type === "image/png"
    );
    const sizes = rasters.map((icon) => Number(String(icon.sizes).split("x")[0]));
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(512);
    expect(sizes.some((size) => size >= 192)).toBe(true);
  });

  it("keeps the maskable icon a SEPARATE file from the square one", () => {
    // `purpose: "any maskable"` on an unpadded icon is how a logo ends up
    // cropped into a circle on Android.
    const maskable = (value.icons ?? []).filter((icon) =>
      String(icon.purpose).includes("maskable")
    );
    expect(maskable).toHaveLength(1);
    const anyPurpose = (value.icons ?? []).filter(
      (icon) => icon.purpose === "any"
    );
    expect(anyPurpose.length).toBeGreaterThan(0);
    for (const icon of anyPurpose) {
      expect(icon.src).not.toBe(maskable[0]!.src);
    }
  });

  it("points its shortcut at a route that exists", () => {
    expect(value.shortcuts?.[0]?.url).toBe("/create-invoice");
    expect(
      existsSync(join(import.meta.dir, "..", "app", "create-invoice", "page.tsx"))
    ).toBe(true);
  });

  it("keeps the apple-touch-icon a PNG, because iOS ignores SVG", () => {
    const apple = join(PUBLIC_DIR, "icons", "apple-touch-icon.png");
    expect(existsSync(apple)).toBe(true);
  });
});

describe("no service worker ships with this manifest", () => {
  // Deliberate, and load-bearing: this app is auth-gated and multi-tenant, and
  // the Cache API keys on URL alone. A cached /api/invoices response is a
  // cross-tenant leak. If a worker is ever added it must precache immutable
  // static assets only — this test is the tripwire that makes that a decision
  // someone takes on purpose rather than by copying a PWA template.
  const candidates = ["public/sw.js", "public/service-worker.js", "app/sw.ts"];

  it("has no service worker file in the tree", () => {
    for (const candidate of candidates) {
      expect(existsSync(join(import.meta.dir, "..", candidate))).toBe(false);
    }
  });
});
