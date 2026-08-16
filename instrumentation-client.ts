import * as Sentry from "@sentry/nextjs";
import {
  scrubBreadcrumb,
  scrubEvent,
  scrubTransaction,
  type SentryBreadcrumbLike,
  type SentryEventLike,
} from "@/lib/observability/scrub";

/**
 * Browser Sentry init. (This file replaced the older sentry.client.config.ts
 * convention.)
 *
 * Inert without NEXT_PUBLIC_SENTRY_DSN — the DSN is an owner action and the app
 * must build and run without one.
 *
 * The scrubbing is the same module the server uses, deliberately: two copies
 * would drift and the drift would be silent.
 */

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

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

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
    // See instrumentation.ts — explicit, not inherited from the default.
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    // Session Replay records the DOM, and the DOM on this app's main screen IS
    // an invoice: client name, address, line items, bank details. There is no
    // masking configuration that makes recording it acceptable, so it is off at
    // the sample rate rather than merely unconfigured.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend: (event) => scrub(event),
    beforeSendTransaction: (event) => scrubTx(event),
    beforeBreadcrumb: (crumb) => scrumb(crumb),
  });
}

// Instruments client-side navigations for tracing. Harmless when init was
// skipped.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
