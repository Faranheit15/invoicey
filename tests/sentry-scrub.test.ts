import { describe, it, expect } from "bun:test";
import {
  REDACTED,
  sanitizeUrl,
  scrubBreadcrumb,
  scrubEvent,
  scrubText,
  type SentryEventLike,
} from "@/lib/observability/scrub";

/**
 * The scrubber is the only thing standing between Sentry and a client's home
 * address, so this suite is written the way the export-escaping suite is: feed
 * it a realistic hostile payload and assert that nothing recognisable survives.
 *
 * The `serialized` helper is the load-bearing assertion style — checking
 * individual fields would pass while the same string sat in a nested context
 * nobody thought to look at.
 */

const CLIENT_NAME = "Ravi Kumar Textiles";
const CLIENT_EMAIL = "ravi@kumartextiles.example";
const CLIENT_PHONE = "9876543210";
const CLIENT_ADDRESS = "14 MG Road, Bengaluru 560001";

const invoiceEvent = (): SentryEventLike => ({
  message: `Failed to save invoice (${CLIENT_EMAIL})`,
  server_name: "iad1-lambda-7f3a",
  transaction: "/create-invoice/68f0a1b2c3d4e5f60718293a",
  request: {
    url: "https://invoicey.app/api/invoices?id=68f0a1b2c3d4e5f60718293a&key=AIzaSyTOPSECRET",
    method: "POST",
    data: {
      billTo: CLIENT_NAME,
      billToEmail: CLIENT_EMAIL,
      billToAddress: CLIENT_ADDRESS,
      items: [{ name: "Cotton bolts", price: 4200, quantity: 3 }],
      paymentInfo: "HDFC 50100123456789",
    },
    cookies: { session: "abc123" },
    headers: { authorization: "Bearer eyJhbGciOi" },
    query_string: "key=AIzaSyTOPSECRET",
  },
  user: {
    id: "firebase-uid-123",
    email: CLIENT_EMAIL,
    username: "ravi",
    ip_address: "203.0.113.5",
  },
  extra: {
    route: "/api/invoices",
    invoicePayload: { billTo: CLIENT_NAME, notes: CLIENT_ADDRESS },
    aiPrompt: `Make an invoice for ${CLIENT_NAME} at ${CLIENT_ADDRESS}`,
  },
  contexts: {
    trace: { trace_id: "abc" },
    state: { state: { formState: { billTo: CLIENT_NAME, billToEmail: CLIENT_EMAIL } } },
  },
  tags: {
    environment: "production",
    billToEmail: CLIENT_EMAIL,
    page: `https://invoicey.app/create-invoice/68f0a1b2c3d4e5f60718293a`,
  },
  exception: {
    values: [
      { type: "Error", value: `Validation failed for ${CLIENT_EMAIL} / ${CLIENT_PHONE}` },
    ],
  },
  breadcrumbs: [
    {
      category: "console",
      message: `Saving invoice for ${CLIENT_NAME} <${CLIENT_EMAIL}>`,
      data: { arguments: [CLIENT_ADDRESS] },
    },
    {
      category: "fetch",
      data: {
        method: "POST",
        url: "https://invoicey.app/api/invoices?id=68f0a1b2c3d4e5f60718293a",
        status_code: 500,
        request_body: { billTo: CLIENT_NAME },
        response_body: { error: CLIENT_EMAIL },
      },
    },
  ],
  spans: [
    {
      description: "mongodb.find invoices",
      data: {
        "db.statement": `{"billToEmail":"${CLIENT_EMAIL}"}`,
        "db.system": "mongodb",
      },
    },
  ],
});

const serialized = (event: unknown) => JSON.stringify(event);

describe("sentry scrub", () => {
  it("lets nothing recognisable from the invoice reach Sentry", () => {
    const out = serialized(scrubEvent(invoiceEvent()));
    for (const secret of [
      CLIENT_NAME,
      CLIENT_EMAIL,
      CLIENT_PHONE,
      CLIENT_ADDRESS,
      "AIzaSyTOPSECRET",
      "eyJhbGciOi",
      "HDFC",
      "Cotton bolts",
    ]) {
      expect(out).not.toContain(secret);
    }
  });

  it("drops the request body, cookies and headers entirely", () => {
    const event = scrubEvent(invoiceEvent());
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.headers).toBeUndefined();
    expect(event.request?.query_string).toBeUndefined();
    // Rebuilt, not filtered: only these two keys may survive.
    expect(Object.keys(event.request ?? {}).sort()).toEqual(["method", "url"]);
  });

  it("keeps the uid and nothing else about the user", () => {
    const event = scrubEvent(invoiceEvent());
    expect(event.user).toEqual({ id: "firebase-uid-123" });
  });

  it("strips query strings and collapses dynamic path segments", () => {
    expect(event().request?.url).toBe("/api/invoices");
    expect(event().transaction).toBe("/create-invoice/[id]");
    function event() {
      return scrubEvent(invoiceEvent());
    }
  });

  it("defaults to deny in extra: unknown keys are redacted, not filtered", () => {
    const event = scrubEvent(invoiceEvent());
    expect(event.extra?.route).toBe("/api/invoices");
    expect(event.extra?.invoicePayload).toBe(REDACTED);
    expect(event.extra?.aiPrompt).toBe(REDACTED);
  });

  it("drops non-allowlisted contexts such as React/redux state", () => {
    const event = scrubEvent(invoiceEvent());
    expect(event.contexts?.trace).toBeDefined();
    expect(event.contexts?.state).toBeUndefined();
  });

  it("redacts sensitive tag keys and sanitizes tag values", () => {
    const event = scrubEvent(invoiceEvent());
    expect(event.tags?.environment).toBe("production");
    expect(event.tags?.billToEmail).toBe(REDACTED);
    expect(event.tags?.page).not.toContain("68f0a1b2c3d4e5f60718293a");
  });

  it("drops console breadcrumbs and every breadcrumb body", () => {
    const event = scrubEvent(invoiceEvent());
    expect(event.breadcrumbs).toHaveLength(1);
    const crumb = event.breadcrumbs![0]!;
    expect(crumb.category).toBe("fetch");
    expect(crumb.data).toEqual({
      method: "POST",
      status_code: 500,
      url: "/api/invoices",
    });
  });

  it("drops db.statement, which carries the query filter", () => {
    const event = scrubEvent(invoiceEvent());
    const span = event.spans![0]!;
    expect(span.data?.["db.statement"]).toBeUndefined();
    expect(span.data?.["db.system"]).toBe("mongodb");
  });

  it("documents the one non-default-deny path: free text is pattern-scrubbed", () => {
    // A name cannot be detected by pattern. This asserts the known limit so it
    // stays a deliberate decision rather than an unnoticed hole: code that
    // interpolates user content into an Error message defeats the scrubber.
    const event = scrubEvent({ message: `saving invoice for ${CLIENT_NAME}` });
    expect(event.message).toContain(CLIENT_NAME);
  });

  it("scrubs emails, long numbers and secret query params out of free text", () => {
    expect(scrubText("mail me at a@b.co")).toBe("mail me at [email]");
    expect(scrubText("gstin 29AABBC1234")).toBe("gstin 29AABBC1234");
    expect(scrubText("phone 9876543210")).toBe("phone [number]");
    expect(scrubText("GET /x?key=AIzaSecret&z=1")).toBe(
      `GET /x?key=${REDACTED}&z=1`
    );
  });

  it("survives a bare/edge-shaped event without throwing", () => {
    expect(scrubEvent({})).toEqual({});
    expect(scrubBreadcrumb({ category: "navigation" })).toEqual({
      category: "navigation",
      data: {},
    });
  });

  it("collapses uuid, ObjectId and firebase-uid path segments alike", () => {
    expect(sanitizeUrl("/create-invoice/68f0a1b2c3d4e5f60718293a")).toBe(
      "/create-invoice/[id]"
    );
    expect(sanitizeUrl("/api/admin/users/kJ8sd7Fh2LqZxCv1Bn0M")).toBe(
      "/api/admin/users/[id]"
    );
    expect(sanitizeUrl("https://invoicey.app/dashboard?tab=paid")).toBe(
      "/dashboard"
    );
  });

  it("scrubs contexts.trace.data, which does not travel in event.spans", () => {
    // The root span's attributes are copied verbatim into contexts.trace.data.
    // The span rules only ever walked event.spans, so this was a live bypass:
    // every sampled transaction carried the full URL, query string, hostname
    // and user agent straight past a scrubber that deleted them elsewhere.
    const event = scrubEvent({
      contexts: {
        trace: {
          trace_id: "abc",
          data: {
            "url.full":
              "https://invoicey.app/create-invoice/68f0c1a2b3c4d5e6f7a8b9c0?client=acme%40corp.com",
            "http.target": "/api/invoices?id=68f0c1a2b3c4d5e6f7a8b9c0",
            "http.host": "invoicey-prod-xyz.vercel.app",
            "http.user_agent": "Mozilla/5.0 (iPhone)",
            "db.statement": '{"userId":"uid123","billTo":"Acme Ltd"}',
          },
        },
      },
    } as never) as never as {
      contexts: { trace: { data: Record<string, unknown> } };
    };

    const data = event.contexts.trace.data;
    expect(data["db.statement"]).toBeUndefined();
    expect(data["http.host"]).toBeUndefined();
    expect(data["http.user_agent"]).toBeUndefined();
    expect(data["url.full"]).toBe("/create-invoice/[id]");
    expect(data["http.target"]).toBe("/api/invoices");
    expect(JSON.stringify(data)).not.toContain("acme");
    expect(JSON.stringify(data)).not.toContain("68f0c1a2b3c4d5e6f7a8b9c0");
  });

});
