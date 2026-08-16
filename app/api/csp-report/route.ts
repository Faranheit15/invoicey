import { NextRequest, NextResponse } from "next/server";
import { logEvent, clientIp } from "@/lib/server/log";
import { consumeRateLimit } from "@/lib/server/rate-limit";

/**
 * Where the report-only CSP actually reports.
 *
 * A `Content-Security-Policy-Report-Only` header with no collector is
 * decorative: violations land in each visitor's devtools console and nowhere
 * else, so the "collect data, then flip to enforcing" plan has no data to flip
 * on. This is that collector.
 *
 * Everything about it is hostile-input handling. It is unauthenticated by
 * necessity — the browser posts it, and a violation on the signed-out landing
 * page is exactly the kind we need — so it is rate limited by IP, size capped,
 * and reduced to a fixed set of fields. It never echoes anything back.
 */

const MAX_BODY_BYTES = 8192;
const REPORT_LIMIT = { namespace: "csp-report", limit: 20, windowMs: 60_000 };

const asText = (value: unknown, max = 512): string =>
  typeof value === "string" ? value.slice(0, max) : "";

export async function POST(req: NextRequest) {
  // Shared across callers behind a proxy that strips the header; acceptable,
  // since the cap only exists to stop this endpoint becoming a log amplifier.
  const ip = clientIp(req) ?? "unknown";
  if (consumeRateLimit(REPORT_LIMIT, ip).limited) {
    return new NextResponse(null, { status: 429 });
  }

  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    // A malformed report is not worth a log line, let alone an error.
    return new NextResponse(null, { status: 204 });
  }

  // Browsers disagree on the envelope: the older `report-uri` sends
  // { "csp-report": {...} } with hyphenated keys, the Reporting API sends an
  // array of { type, body } with camelCase. Accept both, keep the union.
  const source = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
  const nested = (source["csp-report"] ?? source.body ?? source) as Record<
    string,
    unknown
  >;

  logEvent({
    level: "warn",
    category: "system",
    event: "csp.violation",
    meta: {
      directive: asText(
        nested["effective-directive"] ??
          nested.effectiveDirective ??
          nested["violated-directive"] ??
          nested.violatedDirective,
        128
      ),
      blockedUri: asText(nested["blocked-uri"] ?? nested.blockedURL),
      documentUri: asText(nested["document-uri"] ?? nested.documentURL),
      ip,
    },
  });

  return new NextResponse(null, { status: 204 });
}
