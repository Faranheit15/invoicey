import * as Sentry from "@sentry/nextjs";
import {
  scrubBreadcrumb,
  scrubEvent,
  scrubTransaction,
  type SentryBreadcrumbLike,
  type SentryEventLike,
} from "@/lib/observability/scrub";

/**
 * Server + edge Sentry init.
 *
 * Everything here is inert when no DSN is configured: `register()` returns
 * before `Sentry.init` runs, so a build or a local `bun dev` with no Sentry
 * account attached loads none of the SDK's OpenTelemetry instrumentation and
 * sends nothing. The DSN is an owner action; the app must not depend on it.
 *
 * Init is inline rather than in sentry.server.config.ts / sentry.edge.config.ts
 * because the two runtimes need the same six options and the only part worth
 * factoring out — the PII scrubbing — is already shared, in
 * lib/observability/scrub.ts, with instrumentation-client.ts.
 */

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

// Sentry's event/breadcrumb types are structurally compatible with the
// dependency-free shapes in lib/observability/scrub.ts, but not assignable to
// them (they lack an index signature), so the cast is unavoidable. Doing it
// once here keeps it out of the option literals.
const scrub = <T>(event: T): T =>
  scrubEvent(event as unknown as SentryEventLike) as unknown as T;
const scrubTx = <T>(event: T): T =>
  scrubTransaction(event as unknown as SentryEventLike) as unknown as T;
const scrumb = <T>(crumb: T): T | null =>
  scrubBreadcrumb(crumb as unknown as SentryBreadcrumbLike) as unknown as T | null;

export async function register() {
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    // THE MASTER SWITCH. Set explicitly rather than left to the default: this
    // is what stops IP addresses, cookies and request bodies being attached
    // automatically. beforeSend below is the second line, not the first.
    sendDefaultPii: false,
    // Enough to see a latency regression, cheap enough for the free tier.
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrub(event),
    beforeSendTransaction: (event) => scrubTx(event),
    beforeBreadcrumb: (crumb) => scrumb(crumb),
  });
}

// Next calls this for every uncaught error in a nested React Server Component
// render; without it those never reach Sentry at all. It is a no-op when init
// above was skipped.
export const onRequestError = Sentry.captureRequestError;
