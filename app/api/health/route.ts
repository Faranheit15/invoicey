import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/server/log";
import { consumeRateLimit } from "@/lib/server/rate-limit";

/**
 * Public liveness/readiness probe for an external uptime monitor.
 *
 * DELIBERATELY UNAUTHENTICATED: an uptime probe cannot hold a Firebase ID
 * token, and gating this behind a secret would mean the monitor can only see
 * the failures we thought to instrument, not the ones a real visitor hits.
 *
 * The consequence is that THE RESPONSE BODY IS A PUBLISHED DOCUMENT. Everything
 * below is written to keep it that way:
 *
 *   - Three keys, three enum values ("ok" | "fail"). No free text, ever.
 *   - No version numbers (app, Node, Next, or Mongo server) — version
 *     disclosure is how an unauthenticated stranger maps this deployment onto a
 *     CVE list.
 *   - No hostnames, cluster names, database names, regions, deployment ids or
 *     git SHAs.
 *   - No exception text and no stack: every check collapses its error to a
 *     boolean, the same discipline as dropping `details: err.message` from the
 *     API routes.
 *   - No counts. /api/cron/keep-alive is the obvious template for this file and
 *     it returns `invoiceCount`; that is fine there because it is CRON_SECRET
 *     gated. DO NOT COPY IT HERE — a public invoice counter is a free business
 *     metric for anyone who curls it on a schedule.
 *   - No latency figures: a precise timing readout on an endpoint that performs
 *     a database round trip is a timing oracle.
 *
 * If a richer body is ever needed for debugging, it belongs on a separate
 * CRON_SECRET-gated /api/health/detail route, not bolted onto this one.
 */

// A cached health check is a lie — it would report the state of whichever
// instance happened to answer first, forever.
export const dynamic = "force-dynamic";

// The probe runs every few minutes forever and the endpoint touches the
// database, so cap it. Generous: this is anti-amplification, not access
// control, and a monitor plus a couple of humans must never trip it.
const HEALTH_LIMIT = { namespace: "health", limit: 60, windowMs: 60_000 };

// Well under any serverless execution ceiling, and deliberately shorter than
// the driver's own serverSelectionTimeoutMS (5s in lib/mongodb.ts): a paused or
// unreachable Atlas cluster must not be able to hold this function open while
// the monitor times out and reports a generic "down" that says nothing.
const DB_PING_TIMEOUT_MS = 2000;

type CheckResult = "ok" | "fail";

/**
 * Resolves to `false` if `work` has not settled within `ms`.
 *
 * The losing promise is left running with its rejection swallowed. That is
 * intentional on both counts: it is the shared cached connection attempt from
 * lib/mongodb.ts, so cancelling is neither possible nor desirable (a later
 * request will happily use it if it eventually succeeds), and an unobserved
 * rejection would otherwise surface as an unhandled rejection and take the
 * whole process down.
 */
const withDeadline = async (
  work: Promise<unknown>,
  ms: number
): Promise<boolean> => {
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([work.then(() => true), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const checkDatabase = async (): Promise<CheckResult> => {
  try {
    // Imported lazily for two reasons: lib/mongodb.ts throws at MODULE scope
    // when MONGODB_URI is absent (a static import would turn a missing env var
    // into an unexplained 500 instead of the config:"fail" this route exists to
    // report), and it keeps mongoose off the cold-start path of the one route
    // that has to answer fast.
    const { default: connectDB } = await import("@/lib/mongodb");
    const mongoose = (await import("mongoose")).default;

    const ping = (async () => {
      // connectDB() returns the process-wide cached connection, so this reuses
      // the existing pool rather than dialling a second one — a health check
      // that opened its own connection every 3 minutes would eat the M0
      // connection budget it is supposed to be watching.
      await connectDB();
      const db = mongoose.connection.db;
      if (!db) throw new Error("no db handle");
      // A ping, not keep-alive's estimatedDocumentCount(): cheaper, touches no
      // collection, and this route is hit far more often than the cron is.
      await db.admin().command({ ping: 1 });
    })();

    return (await withDeadline(ping, DB_PING_TIMEOUT_MS)) ? "ok" : "fail";
  } catch {
    return "fail";
  }
};

const checkAuth = async (): Promise<CheckResult> => {
  try {
    // Malformed or missing FIREBASE_ADMIN_CREDENTIALS takes down every
    // authenticated route while the app still happily serves HTML, so an uptime
    // check that only asks "does the page load" would miss a total outage.
    // Lazy for the same cold-start reason as above (and firebase-admin is the
    // heaviest import in the app).
    const { ensureFirebaseAdmin } = await import("@/lib/firebase-admin");
    ensureFirebaseAdmin();
    return "ok";
  } catch {
    return "fail";
  }
};

// Presence only. Never a value, never a length, never a prefix — any of those
// would leak key material one bit at a time.
const REQUIRED_ENV = [
  "MONGODB_URI",
  "FIREBASE_ADMIN_CREDENTIALS",
  "GEMINI_API_KEY",
] as const;

const checkConfig = (): CheckResult =>
  REQUIRED_ENV.every((name) => Boolean(process.env[name])) ? "ok" : "fail";

export async function GET(req: NextRequest) {
  const ip = clientIp(req) ?? "unknown";
  const verdict = consumeRateLimit(HEALTH_LIMIT, ip);
  if (verdict.limited) {
    return new NextResponse(null, {
      status: 429,
      headers: {
        "Retry-After": String(verdict.retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    });
  }

  const [database, auth] = await Promise.all([checkDatabase(), checkAuth()]);
  const config = checkConfig();

  // Gemini is NOT checked. It is a third party with its own latency, the AI
  // assistant is non-essential by design, and a Gemini blip must not page
  // anyone at 3am or turn the status page red.

  // config being incomplete is not on its own an outage — GEMINI_API_KEY only
  // disables the assistant — so it is reported but does not decide the status
  // code. Mongo or Firebase down means every signed-in user is broken, and that
  // MUST be a 503: the monitor keys off the status code, not the body, and a
  // 200 with "degraded" in the payload alerts nobody.
  const healthy = database === "ok" && auth === "ok";

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: { database, auth, config },
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
