import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// The Firebase Auth popup lives on the project's auth domain (it loads an
// iframe and opens a window there), so the CSP has to name it. It is a public
// NEXT_PUBLIC_ value and is already in the client bundle.
const firebaseAuthDomain =
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "*.firebaseapp.com";

const isDev = process.env.NODE_ENV !== "production";

// Sentry's ingest host, added to connect-src ONLY when a DSN is configured at
// build time (headers() is resolved into the routes manifest at build, so this
// is stable per deployment). No DSN means no Sentry traffic, and no reason to
// widen the policy for it. The wildcard covers every data region: the DSN
// decides which one is actually used.
const sentryDsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
const sentryConnectSrc = sentryDsn
  ? " https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io"
  : "";

// Report-only, deliberately: this app injects THEME_INIT_SCRIPT inline
// `beforeInteractive`, signs in through Firebase's popup flow, and prints
// invoices by handing the browser a self-contained blob: document. An enforcing
// policy written before we have real violation data would break one of those.
// Collect reports first, then tighten (nonce the inline scripts, drop
// 'unsafe-inline') and flip to Content-Security-Policy.
const contentSecurityPolicy = [
  "default-src 'self'",
  // 'unsafe-inline' covers both the theme init script and Next's own inline
  // bootstrap/flight payloads; 'unsafe-eval' is dev-only (Turbopack HMR) and
  // would otherwise drown the reports in noise that says nothing about prod.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://apis.google.com https://va.vercel-scripts.com`,
  // Tailwind ships a stylesheet, but Next inlines critical CSS and the exported
  // invoice document carries its own <style> block.
  "style-src 'self' 'unsafe-inline'",
  // Logos are arbitrary user-supplied URLs (see toSafeImageUrl), avatars come
  // from Google, and the print document is rendered from a blob:.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Everything the app calls itself is same-origin (/api/*, /_vercel/*); the
  // rest is Firebase Auth's REST surface.
  `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://va.vercel-scripts.com${sentryConnectSrc}`,
  // apis.google.com + the auth domain are the sign-in popup's iframe; blob: is
  // the print document when it is rendered in a hidden iframe rather than a tab.
  `frame-src 'self' blob: https://apis.google.com https://${firebaseAuthDomain}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
  // Without this the report-only policy is decorative: violations would surface
  // only in each visitor's devtools console, and the tightening pass below would
  // have to be made blind. report-uri is deprecated but still the only one
  // Safari and Firefox honour; report-to covers Chrome.
  "report-uri /api/csp-report",
  "report-to csp-endpoint",
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy-Report-Only",
    value: contentSecurityPolicy,
  },
  {
    key: "Reporting-Endpoints",
    value: 'csp-endpoint="/api/csp-report"',
  },
  // No `preload`: submitting to the preload list is effectively irreversible,
  // and the apex domain is not settled yet.
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  // frame-ancestors is ignored while the CSP is report-only, so this is what
  // actually stops the clickjacking until the policy is enforced.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  // `X-Powered-By: Next.js` on every response is free version fingerprinting —
  // the same disclosure the /api/health body is written to avoid.
  poweredByHeader: false,
  // firebase-admin is a Node-only package; keep it external so Next require()s it
  // at runtime rather than bundling it into the server output. (jsonwebtoken was
  // removed in favor of jose, which bundles cleanly.)
  serverExternalPackages: ["firebase-admin"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "via.placeholder.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

/**
 * The Sentry wrapper is applied LAST and must not disturb anything above it:
 * `headers()` and the report-only CSP from Phase 0 are passed straight through
 * (withSentryConfig only adds build-time plugins and, optionally, source-map
 * upload). tests/security-headers.test.ts asserts on the exported config, so a
 * wrapper that dropped or rewrote the headers would fail the suite.
 *
 * Source-map upload is off: it needs SENTRY_AUTH_TOKEN plus the @sentry/cli
 * binary, whose postinstall is blocked in this repo, and a build that fails
 * because an optional observability nicety could not phone home is a bad trade.
 * Turning it on is an owner action (see docs/runbooks/backup-and-restore.md).
 */
export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: true },
  webpack: {
    // Strip the SDK's debug logging from the client bundle.
    treeshake: { removeDebugLogging: true },
    // The SDK otherwise reads vercel.json and auto-instruments the cron routes;
    // they are already covered by ordinary request instrumentation.
    automaticVercelMonitors: false,
  },
});
