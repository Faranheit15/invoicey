import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/server/auth";
import { logEvent, clientIp } from "@/lib/server/log";
import { createRateLimiter } from "@/lib/server/rate-limit";

/**
 * Low-trust client telemetry beacon. The browser generates invoice reports
 * (PDF/HTML/CSV/JSON) entirely client-side, so the server must be TOLD one
 * happened. Every field is treated as hostile:
 *  - userId is derived from the verified token, never from the body.
 *  - `event` is checked against an allow-list; unknown events are silent no-ops.
 *  - meta is whitelisted per event; all other keys are dropped.
 *  - body size + per-uid rate are capped (best-effort — this is engagement
 *    telemetry, not an audit-grade record).
 */

const ALLOWED_FORMATS = new Set(["pdf", "html", "csv", "json"]);
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const MAX_BODY_BYTES = 4096;

const rateLimited = createRateLimiter({
  namespace: "events",
  limit: 30,
  windowMs: 60_000,
});

const sanitizeMeta = (
  event: string,
  meta: unknown
): Record<string, unknown> => {
  const src = (meta && typeof meta === "object" ? meta : {}) as Record<
    string,
    unknown
  >;
  const out: Record<string, unknown> = {};
  if (typeof src.invoiceId === "string" && OBJECT_ID.test(src.invoiceId)) {
    out.invoiceId = src.invoiceId;
  }
  if (event === "report.generated") {
    if (typeof src.format === "string" && ALLOWED_FORMATS.has(src.format)) {
      out.format = src.format;
    }
  }
  return out;
};

export async function POST(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await requireUser(req);
  } catch (error: unknown) {
    return authErrorResponse(error);
  }

  if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  if (rateLimited(userUid)) {
    return NextResponse.json({ error: "Too many events" }, { status: 429 });
  }

  let body: { event?: unknown; meta?: unknown };
  try {
    body = (await req.json()) as { event?: unknown; meta?: unknown };
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const event = typeof body.event === "string" ? body.event : "";
  if (event !== "report.generated" && event !== "invoice.viewed") {
    // Unknown/probing event: silent no-op, no signal to a prober.
    return new NextResponse(null, { status: 204 });
  }

  logEvent({
    category: "client",
    event,
    userId: userUid,
    meta: sanitizeMeta(event, body.meta),
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  return new NextResponse(null, { status: 204 });
}
