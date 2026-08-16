import { describe, it, expect } from "bun:test";
import {
  ACTIVITY_META_ALLOWLIST,
  accountExportFilename,
  buildAccountExport,
  buildAccountExportCsv,
  buildExportedProfile,
} from "@/lib/server/account-export";

/**
 * The export is a data-subject access request, so two properties matter more
 * than the shape: it must contain everything of the user's (including what they
 * deleted), and it must contain nothing of ours that was supposed to be gone.
 */

/**
 * A `.lean()` read returns what the DRIVER returned, not what the schema
 * declares. `accessToken` / `refreshToken` were removed from models/User.ts and
 * purged by scripts/purge-user-tokens.ts, but a document written before that
 * migration still carries them on disk. This fixture is that document.
 */
const legacyUserDoc = {
  _id: "507f1f77bcf86cd799439011",
  __v: 0,
  uid: "user-A",
  email: "a@example.com",
  name: "Operator A",
  avatar: "https://example.com/a.png",
  providerIds: ["google.com"],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  lastLoginAt: new Date("2026-08-01T00:00:00.000Z"),
  role: "admin",
  status: "active",
  accessToken: "eyJhbGciOi.LEAKED_ID_TOKEN",
  refreshToken: "AMf-vBx.NEVER_EXPIRES",
};

describe("account export — the purged-token allow-list", () => {
  it("omits accessToken and refreshToken from a pre-migration user document", () => {
    const profile = buildExportedProfile(legacyUserDoc);
    expect(profile).not.toBeNull();
    expect(Object.keys(profile!)).not.toContain("accessToken");
    expect(Object.keys(profile!)).not.toContain("refreshToken");
  });

  it("leaks no token material anywhere in the serialized export", () => {
    const serialized = JSON.stringify(
      buildAccountExport({
        profile: legacyUserDoc,
        invoices: [],
        feedback: [],
        activity: [],
        truncated: { invoices: false, activity: false },
      })
    );
    expect(serialized).not.toContain("LEAKED_ID_TOKEN");
    expect(serialized).not.toContain("NEVER_EXPIRES");
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("refreshToken");
  });

  it("drops our authorization state and storage plumbing, keeps their profile", () => {
    const profile = buildExportedProfile(legacyUserDoc)!;
    expect(Object.keys(profile).sort()).toEqual([
      "avatar",
      "createdAt",
      "email",
      "lastLoginAt",
      "name",
      "providerIds",
      "uid",
    ]);
    expect(profile.email).toBe("a@example.com");
    expect(profile.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("survives a user document that no longer exists", () => {
    expect(buildExportedProfile(null)).toBeNull();
  });

  it("would fail if a future field were spread in wholesale", () => {
    // A guard against someone replacing the allow-list with `{ ...doc }`: an
    // unknown key on the document must never reach the export.
    const profile = buildExportedProfile({
      ...legacyUserDoc,
      someFutureSecret: "do-not-ship",
    })!;
    expect(JSON.stringify(profile)).not.toContain("do-not-ship");
  });
});

describe("account export — soft-deleted invoices", () => {
  const invoices = [
    {
      _id: "inv-live",
      invoiceNumber: "INV-1",
      companyName: "Acme",
      billTo: "Client",
      currency: "INR",
      items: [{ name: "Work", price: 100, quantity: 1 }],
      subtotal: 100,
      total: 100,
      status: "sent",
      is_deleted: false,
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    },
    {
      _id: "inv-binned",
      invoiceNumber: "INV-2",
      companyName: "Acme",
      billTo: "Client",
      currency: "INR",
      items: [],
      subtotal: 0,
      total: 0,
      status: "draft",
      is_deleted: true,
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
    },
  ];

  it("includes deleted invoices and preserves the flag", () => {
    const out = buildAccountExport({
      profile: legacyUserDoc,
      invoices,
      feedback: [],
      activity: [],
      truncated: { invoices: false, activity: false },
    });
    expect(out.invoices).toHaveLength(2);
    expect(out.meta.counts.invoices).toBe(2);
    const binned = out.invoices.find((i) => i.invoiceNumber === "INV-2");
    expect(binned?.is_deleted).toBe(true);
  });

  it("carries the legacy single `tax` field through when present", () => {
    const out = buildAccountExport({
      profile: null,
      invoices: [{ ...invoices[0], tax: 18, cgst: 0, sgst: 0 }],
      feedback: [],
      activity: [],
      truncated: { invoices: false, activity: false },
    });
    expect(out.invoices[0].tax).toBe(18);
  });

  it("omits `tax` entirely on a migrated invoice rather than inventing a 0", () => {
    const out = buildAccountExport({
      profile: null,
      invoices: [{ ...invoices[0], cgst: 9, sgst: 9 }],
      feedback: [],
      activity: [],
      truncated: { invoices: false, activity: false },
    });
    expect(out.invoices[0].tax).toBeUndefined();
  });
});

describe("account export — activity redaction", () => {
  const errorRow = {
    at: new Date("2026-08-01T10:00:00.000Z"),
    level: "error",
    category: "system",
    event: "error.unhandled",
    userId: "user-A",
    ip: "203.0.113.9",
    userAgent: "Mozilla/5.0",
    requestId: "req-abc",
    message: "Cannot read properties of undefined (reading 'prototype')",
    meta: {
      route: "GET /api/invoices",
      statusCode: 500,
      stack: "Error: boom\n    at /var/task/.next/server/app/api/invoices/route.js:1:1",
      invoiceId: "inv-live",
      amount: 100,
      currency: "INR",
    },
  };

  const [row] = buildAccountExport({
    profile: null,
    invoices: [],
    feedback: [],
    activity: [errorRow],
    truncated: { invoices: false, activity: false },
  }).activity;

  it("keeps the user's own data: their IP and device string", () => {
    expect(row.ip).toBe("203.0.113.9");
    expect(row.userAgent).toBe("Mozilla/5.0");
    expect(row.event).toBe("error.unhandled");
  });

  it("drops our diagnostics — stack, internal route, status, requestId, message", () => {
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("/var/task");
    expect(serialized).not.toContain("GET /api/invoices");
    expect(serialized).not.toContain("req-abc");
    expect(serialized).not.toContain("prototype");
    expect(row.meta.stack).toBeUndefined();
    expect(row.meta.route).toBeUndefined();
    expect(row.meta.statusCode).toBeUndefined();
  });

  it("keeps only the allow-listed meta keys", () => {
    expect(Object.keys(row.meta).sort()).toEqual(["amount", "currency", "invoiceId"]);
    for (const key of Object.keys(row.meta)) {
      expect(ACTIVITY_META_ALLOWLIST as readonly string[]).toContain(key);
    }
  });
});

describe("account export — CSV", () => {
  it("neutralizes a spreadsheet formula smuggled into an invoice field", () => {
    const out = buildAccountExport({
      profile: null,
      invoices: [
        {
          _id: "x",
          invoiceNumber: "=cmd|'/c calc'!A1",
          companyName: 'Quote "Co"',
          billTo: "@SUM(1+1)",
          currency: "INR",
          items: [],
          total: 0,
          is_deleted: false,
        },
      ],
      feedback: [],
      activity: [],
      truncated: { invoices: false, activity: false },
    });
    const csv = buildAccountExportCsv(out.invoices);
    expect(csv).toContain(`"'=cmd|'/c calc'!A1"`);
    expect(csv).toContain(`"@SUM(1+1)"`.replace("@", "'@"));
    expect(csv).toContain(`"Quote ""Co"""`);
  });

  it("marks deleted invoices in the flat format too", () => {
    const out = buildAccountExport({
      profile: null,
      invoices: [{ _id: "x", invoiceNumber: "INV-9", is_deleted: true, items: [] }],
      feedback: [],
      activity: [],
      truncated: { invoices: false, activity: false },
    });
    const lines = buildAccountExportCsv(out.invoices).split("\n");
    expect(lines[0]).toContain("is_deleted");
    expect(lines[1]).toContain('"true"');
  });
});

describe("account export — meta", () => {
  it("reports truncation honestly", () => {
    const out = buildAccountExport({
      profile: null,
      invoices: [],
      feedback: [],
      activity: [],
      truncated: { invoices: true, activity: false },
    });
    expect(out.meta.truncated.invoices).toBe(true);
    expect(out.meta.format).toBe("invoicey-account-export");
  });

  it("tells the user that deleted invoices are in the file", () => {
    const out = buildAccountExport({
      profile: null,
      invoices: [],
      feedback: [],
      activity: [],
      truncated: { invoices: false, activity: false },
    });
    expect(out.meta.notes.join(" ")).toContain("is_deleted: true");
    expect(out.meta.notes.join(" ")).toContain("72 months");
  });

  it("dates the filename so repeat downloads do not collide", () => {
    expect(accountExportFilename("json", new Date("2026-08-17T12:00:00Z"))).toBe(
      "invoicey-export-2026-08-17.json"
    );
    expect(accountExportFilename("csv", new Date("2026-08-17T12:00:00Z"))).toBe(
      "invoicey-export-2026-08-17.csv"
    );
  });
});
