/**
 * Sentry PII scrubbing, as pure functions.
 *
 * Sentry is a processor sitting outside India, and this app's payloads ARE the
 * personal data: a `POST /api/invoices` body is an invoice, complete with the
 * user's client's name, address, email and payment details, and the AI
 * assistant's request body is a free-text prompt the user typed. Shipping any
 * of that to an error tracker would make the privacy policy's processor table
 * false. So none of it may leave the process.
 *
 * The logic lives here rather than inline in `instrumentation.ts` for three
 * reasons: the server, edge and browser runtimes must scrub IDENTICALLY (three
 * copies would drift, and the drift would be silent); it must be importable by
 * a test without booting the Sentry SDK; and a scrubber nobody tests is a
 * scrubber that quietly stops working after an SDK upgrade renames a field.
 * Same shape as lib/numeric-input.ts: pure decisions here, adapter at the edge.
 *
 * The governing rule everywhere below is DEFAULT DENY. Anything not explicitly
 * recognised as safe is dropped or replaced with a placeholder, because the
 * failure mode of an allowlist is a missing breadcrumb and the failure mode of
 * a denylist is a client's home address sitting in a US SaaS.
 *
 * Structural types, not Sentry's: this module must stay dependency-free so it
 * can be imported from the browser bundle and asserted on in a unit test.
 */

export const REDACTED = "[REDACTED]";

/**
 * The denylist half of the defence, used where an allowlist is not workable
 * (tag keys, span attributes). Extends the pattern already proven in
 * lib/server/log.ts with this app's invoice/client field names.
 */
export const SENSITIVE_KEY =
  /token|secret|authorization|password|api[_-]?key|refresh|access|cookie|jwt|credential|session|email|phone|address|bill_?to|payment|notes|terms|items|client|customer|company|prompt|message|logo|bank|gst|account/i;

/** Keys allowed to survive in `event.extra`. Everything else is redacted. */
const SAFE_EXTRA_KEYS = new Set([
  "route",
  "status",
  "statusCode",
  "code",
  "reason",
  "attempt",
  "runtime",
]);

/**
 * Sentry-generated contexts that carry no user data. `state`, `redux`, `props`
 * and friends are exactly the ones that would carry a whole invoice, so the
 * list is closed rather than filtered.
 */
const SAFE_CONTEXT_KEYS = new Set([
  "trace",
  "runtime",
  "os",
  "device",
  "culture",
  "app",
  "browser",
  "cloud_resource",
  "response",
]);

/**
 * Breadcrumb categories worth keeping. `console` is deliberately absent: this
 * app's own console.error calls interpolate route errors, and a route error
 * message can carry whatever the caller passed in.
 */
const SAFE_BREADCRUMB_CATEGORIES = [
  "navigation",
  "fetch",
  "xhr",
  "ui.click",
  "ui.input",
  "sentry.event",
  "sentry.transaction",
];

/** Breadcrumb `data` keys worth keeping — never a body, never a payload. */
const SAFE_BREADCRUMB_DATA_KEYS = new Set([
  "method",
  "status_code",
  "url",
  "from",
  "to",
]);

/** Mongo/OTel span attributes that embed the query — i.e. the user's data. */
const FORBIDDEN_SPAN_KEYS = [
  "db.statement",
  "db.query.text",
  "db.query.parameter",
  "http.request.body",
  "http.response.body",
  // Deleted for consistency with `event.server_name`, which is stripped above:
  // the deployment hostname is not worth leaking back in through a span
  // attribute. The user agent is a fingerprinting input and tells us nothing an
  // error report needs.
  "http.host",
  "net.host.name",
  "server.address",
  "http.user_agent",
  "user_agent.original",
  "net.peer.ip",
  "client.address",
];

// Hex ObjectIds, Firebase uids and UUIDs in a path. An invoice id is not itself
// personal data, but it is a join key, and URLs are exactly what
// Referrer-Policy exists to keep out of third parties.
const ID_SEGMENT = /^(?:[0-9a-f]{24}|[0-9a-f-]{32,}|[A-Za-z0-9_-]{20,})$/;

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// 8+ consecutive digits: phone numbers, GSTINs, bank account numbers.
const LONG_NUMBER_PATTERN = /\b\d{8,}\b/g;
// `?key=...` / `&token=...` in any string, the same guard log.ts applies.
const SECRET_QUERY_PATTERN = /([?&](?:key|token|secret|password|auth)=)[^&\s]*/gi;

const LOOKS_LIKE_URL = /^(?:https?:\/\/|\/)/i;

const MAX_TEXT = 1000;

/**
 * Free-text scrub for messages and exception values.
 *
 * This is the ONE place that is pattern-based rather than default-deny, and
 * deliberately so: blanket-redacting every exception message would leave Sentry
 * showing only error types, which is no better than the outage detection we
 * have today. So the shapes that are personal data by construction — email
 * addresses, long digit runs (phone/GSTIN/account numbers), secret query
 * params — are replaced in place, and the text is capped.
 *
 * THE LIMIT, STATED PLAINLY: a person's or company's NAME cannot be detected by
 * pattern. If application code interpolates user data into an Error message
 * (`throw new Error(\`cannot save invoice for ${billTo}\`)`) it WILL reach
 * Sentry. That is a rule for the code that throws, not something this function
 * can enforce: keep identifiers in error messages, keep content out.
 */
export const scrubText = (value: string): string =>
  value
    .replace(SECRET_QUERY_PATTERN, `$1${REDACTED}`)
    .replace(EMAIL_PATTERN, "[email]")
    .replace(LONG_NUMBER_PATTERN, "[number]")
    .slice(0, MAX_TEXT);

/**
 * Reduces a URL to a route template: no origin, no query string, and dynamic
 * segments collapsed. `/create-invoice/68f0…?token=x` becomes
 * `/create-invoice/[id]`.
 */
export const sanitizeUrl = (value: string): string => {
  const withoutQuery = value.split("?")[0]!.split("#")[0]!;
  // Drop scheme+host without needing a base URL to parse against.
  const path = withoutQuery.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  const segments = path.split("/").map((segment) => {
    if (!segment) return segment;
    if (ID_SEGMENT.test(segment)) return "[id]";
    if (EMAIL_PATTERN.test(segment)) return "[email]";
    return segment;
  });
  return segments.join("/") || "/";
};

export interface SentryEventLike {
  message?: string;
  server_name?: string;
  request?: {
    url?: string;
    method?: string;
    data?: unknown;
    cookies?: unknown;
    headers?: unknown;
    query_string?: unknown;
    env?: unknown;
  };
  user?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  breadcrumbs?: SentryBreadcrumbLike[];
  exception?: { values?: Array<{ value?: string; type?: string }> };
  transaction?: string;
  spans?: Array<{ data?: Record<string, unknown>; description?: string }>;
  [key: string]: unknown;
}

export interface SentryBreadcrumbLike {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Applied to every event on every runtime. Mutates and returns the event
 * because that is the contract Sentry's `beforeSend` expects.
 */
export const scrubEvent = (event: SentryEventLike): SentryEventLike => {
  // The hostname is infrastructure detail with no debugging value here (every
  // instance is an interchangeable lambda).
  delete event.server_name;

  if (event.request) {
    const { url, method } = event.request;
    // Rebuilt from scratch rather than deleting known-bad keys: a future SDK
    // that starts attaching a new field must not be attached by default.
    event.request = {
      ...(url ? { url: sanitizeUrl(url) } : {}),
      ...(method ? { method } : {}),
    };
  }

  // uid only. It is the join key into a support ticket or a data export, which
  // is all that is needed; email/username/ip are not.
  if (event.user) {
    const id = event.user.id;
    event.user = typeof id === "string" || typeof id === "number" ? { id } : {};
  }

  if (event.extra) {
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event.extra)) {
      extra[key] = SAFE_EXTRA_KEYS.has(key) ? scrubValue(value) : REDACTED;
    }
    event.extra = extra;
  }

  if (event.contexts) {
    const contexts: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event.contexts)) {
      if (SAFE_CONTEXT_KEYS.has(key)) contexts[key] = scrubValue(value);
    }
    event.contexts = contexts;
  }

  if (event.tags) {
    const tags: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event.tags)) {
      if (SENSITIVE_KEY.test(key)) {
        tags[key] = REDACTED;
      } else if (typeof value === "string") {
        // Sentry auto-tags carry URLs (`page`, `url`, `transaction`), so tag
        // values get the same route-template treatment as request.url — an
        // invoice id smuggled in as a tag is still an invoice id.
        tags[key] = LOOKS_LIKE_URL.test(value)
          ? sanitizeUrl(value)
          : scrubText(value);
      } else {
        tags[key] = value;
      }
    }
    event.tags = tags;
  }

  if (typeof event.message === "string") {
    event.message = scrubText(event.message);
  }
  if (typeof event.transaction === "string") {
    event.transaction = sanitizeUrl(event.transaction);
  }

  for (const value of event.exception?.values ?? []) {
    if (typeof value.value === "string") value.value = scrubText(value.value);
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map(scrubBreadcrumb)
      .filter((crumb): crumb is SentryBreadcrumbLike => crumb !== null);
  }

  scrubSpans(event);

  return event;
};

/**
 * Returns null to drop the breadcrumb entirely. Breadcrumbs are the sneaky
 * path — nobody remembers that the SDK records the failing request alongside
 * the error it caused.
 */
export const scrubBreadcrumb = (
  crumb: SentryBreadcrumbLike
): SentryBreadcrumbLike | null => {
  const category = crumb.category ?? "";
  const allowed = SAFE_BREADCRUMB_CATEGORIES.some(
    (safe) => category === safe || category.startsWith(`${safe}.`)
  );
  if (!allowed) return null;

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(crumb.data ?? {})) {
    if (!SAFE_BREADCRUMB_DATA_KEYS.has(key)) continue;
    data[key] =
      typeof value === "string" && (key === "url" || key === "from" || key === "to")
        ? sanitizeUrl(value)
        : value;
  }

  return {
    ...crumb,
    ...(typeof crumb.message === "string"
      ? { message: sanitizeUrl(scrubText(crumb.message)) }
      : {}),
    data,
  };
};

/**
 * Transactions carry no exception but they do carry spans, and the Mongo
 * instrumentation puts the query — filters and all — in `db.statement`.
 */
export const scrubTransaction = (event: SentryEventLike): SentryEventLike => {
  scrubEvent(event);
  return event;
};

const scrubSpanData = (data: Record<string, unknown>): void => {
  for (const key of Object.keys(data)) {
    if (
      FORBIDDEN_SPAN_KEYS.some((forbidden) => key.startsWith(forbidden)) ||
      SENSITIVE_KEY.test(key)
    ) {
      delete data[key];
    } else if (typeof data[key] === "string") {
      data[key] = sanitizeUrl(scrubText(data[key] as string));
    }
  }
};

const scrubSpans = (event: SentryEventLike): void => {
  for (const span of event.spans ?? []) {
    if (typeof span.description === "string") {
      span.description = sanitizeUrl(scrubText(span.description));
    }
    if (span.data) scrubSpanData(span.data);
  }

  // `contexts.trace.data` is a verbatim copy of the ROOT span's attributes, and
  // it does not travel in `event.spans` — so the rules above would never see
  // it. The HTTP instrumentation puts `url.full`, `http.target` (path AND query
  // string), `http.host` and `http.user_agent` there, which on this app means
  // an invoice id in a query string plus the deployment hostname, on every
  // sampled transaction. Same rules, applied where they were escaping.
  const trace = event.contexts?.trace as
    | { data?: Record<string, unknown> }
    | undefined;
  if (trace?.data) scrubSpanData(trace.data);
};

const MAX_DEPTH = 4;

/** Recursive key-based redaction for the values an allowlist let through. */
const scrubValue = (value: unknown, depth = 0): unknown => {
  if (depth > MAX_DEPTH) return REDACTED;
  if (typeof value === "string") return scrubText(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : scrubValue(val, depth + 1);
  }
  return out;
};
