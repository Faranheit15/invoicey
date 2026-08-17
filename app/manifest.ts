import type { MetadataRoute } from "next";

/**
 * The install manifest, as a route rather than a file in `public/`.
 *
 * Next's metadata convention serves this at `/manifest.webmanifest` with the
 * `application/manifest+json` content type and injects the `<link rel="manifest">`
 * into every page's head. A hand-written `public/manifest.webmanifest` would
 * depend on the host guessing the type from the extension and would still need
 * the link tag added by hand — two ways to end up with a manifest the browser
 * fetches and ignores, which is exactly how installability fails silently.
 *
 * The CSP has no `manifest-src` of its own; it inherits `default-src 'self'`,
 * and this route is same-origin, so nothing in `next.config.ts` needed loosening.
 *
 * NO SERVICE WORKER accompanies this, deliberately. See the note at the bottom.
 */

/**
 * Icon provenance: the PNGs under `public/icons/` are rasterised from
 * `public/icon.svg` (the fixed-navy brand mark). SVG icons are declared too and
 * are what a browser that supports them will actually use; the PNGs exist
 * because Chrome's installability check wants a raster ≥192px and iOS ignores
 * SVG for home-screen icons entirely.
 *
 * `maskable` is a SEPARATE file, not a `purpose: "any maskable"` on the square
 * one. Declaring an unpadded icon as maskable is how apps end up with their logo
 * cropped into a circle — the maskable file puts the mark inside the 80% safe
 * zone on a full-bleed brand ground so every mask shape crops only background.
 */
const ICONS: MetadataRoute.Manifest["icons"] = [
  { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  {
    src: "/icons/icon-maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Invoicey",
    short_name: "Invoicey",
    description: "Create invoices fast and easily",
    lang: "en",
    dir: "ltr",
    // The dashboard, not the marketing page: an installed icon is pressed by
    // someone who already knows what the app is. Signed-out visitors are sent
    // to /auth by the existing route guard, so this is safe for a fresh
    // install too.
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    // No `orientation`: the desktop browser is the real usage scene and the
    // editor is a wide form. Pinning portrait would fight the product.
    // Splash background: white, matching the light surface the app boots into
    // unless a stored preference says dark.
    background_color: "#ffffff",
    // The brand navy, and the same colour as the icon's ground, so the standalone
    // title bar reads as part of the app. `app/layout.tsx` additionally ships a
    // light/dark <meta name="theme-color"> pair, which browsers prefer over this
    // single value.
    theme_color: "#0f172a",
    categories: ["business", "finance", "productivity"],
    // There is no native app to defer to, and there never will be — the plan
    // says a PWA is the Android answer.
    prefer_related_applications: false,
    icons: ICONS,
    shortcuts: [
      {
        name: "New invoice",
        short_name: "New invoice",
        description: "Start a blank invoice",
        url: "/create-invoice",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}

/**
 * WHY THERE IS NO SERVICE WORKER
 *
 * Invoicey is auth-gated and multi-tenant, and every page fetches its data with
 * a Bearer token from a client component. A worker that cached responses would
 * be one bug away from handing user A's `/api/invoices` to user B: the Cache API
 * is keyed by URL, the URL carries no tenant, and the token that made the
 * request is not part of the key. That is a cross-tenant data leak, and it is
 * not worth taking on for an offline experience the product does not promise —
 * "Delivery is the user's own" and every save is a network write anyway.
 *
 * Chromium has not required a service worker for installability since it
 * dropped the offline-capability check; a manifest, HTTPS and an icon ≥192px
 * are enough, and that is what this file provides.
 *
 * If one is ever added, the rule is: precache ONLY immutable static assets —
 * `/icon.svg`, `/favicon.svg`, `/icons/*` — and never `/api/*`, never a page
 * that renders account data, never a response carrying `Authorization`,
 * `Set-Cookie` or `Cache-Control: private`. The safe shape is a request-scoped
 * allowlist (cache only same-origin GETs under `/icons/`), not a denylist.
 */
