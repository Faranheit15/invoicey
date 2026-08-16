import { describe, it, expect, mock } from "bun:test";
import { NextRequest } from "next/server";

// The route imports lib/server/log (for clientIp), which statically imports
// connectDB — and lib/mongodb.ts throws at module scope without MONGODB_URI.
// Same neutralization invoices-isolation.test.ts uses.
mock.module("@/lib/mongodb", () => ({ default: async () => {} }));

const route = await import("@/app/api/health/route");

// Distinct IPs per case: the route is rate limited by IP and the limiter's
// bucket map is process-global, so sharing one would make the suite
// order-dependent.
const probe = (ip: string) =>
  route.GET(
    new NextRequest("https://invoicey.app/api/health", {
      headers: { "x-forwarded-for": ip },
    })
  );

describe("GET /api/health", () => {
  it("never caches — a cached health check is a lie", async () => {
    const res = await probe("198.51.100.1");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("returns 503 when the database is unreachable, so the monitor pages", async () => {
    // No mongoose connection exists in this process, so the ping cannot resolve.
    const res = await probe("198.51.100.2");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.checks.database).toBe("fail");
  });

  it("publishes exactly three checks and nothing else", async () => {
    // This is the disclosure contract. The endpoint is unauthenticated and
    // permanently discoverable, so the body is a published document: any new
    // key here is a new thing a stranger learns about the deployment.
    const body = await (await probe("198.51.100.3")).json();
    expect(Object.keys(body).sort()).toEqual(["checks", "status"]);
    expect(Object.keys(body.checks).sort()).toEqual([
      "auth",
      "config",
      "database",
    ]);
    for (const value of Object.values(body.checks)) {
      expect(["ok", "fail"]).toContain(value as string);
    }
    expect(["ok", "degraded"]).toContain(body.status);
  });

  it("leaks no hostname, version, count, env value or error text", async () => {
    const raw = await (await probe("198.51.100.4")).text();
    // Whole-body assertion on purpose: checking named fields would pass while
    // the leak sat in a field nobody thought to look for.
    // A regex rather than a literal so the assertion does not depend on which
    // env vars happen to be set on the machine running the suite.
    expect(raw).toMatch(
      /^\{"status":"(?:ok|degraded)","checks":\{"database":"(?:ok|fail)","auth":"(?:ok|fail)","config":"(?:ok|fail)"\}\}$/
    );
    for (const forbidden of [
      "mongodb",
      "mongodb+srv",
      "Error",
      "ECONNREFUSED",
      "version",
      "count",
      "MONGODB_URI",
      "127.0.0.1",
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("rate limits an unauthenticated endpoint that touches the database", async () => {
    const ip = "198.51.100.5";
    let last = await probe(ip);
    for (let i = 0; i < 61; i += 1) last = await probe(ip);
    expect(last.status).toBe(429);
    expect(last.headers.get("Retry-After")).toBeTruthy();
    expect(await last.text()).toBe("");
  });
});
