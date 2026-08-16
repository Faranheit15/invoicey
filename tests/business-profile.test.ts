import { describe, it, expect, mock, beforeEach } from "bun:test";
import { NextResponse } from "next/server";
import * as realAuth from "@/lib/server/auth";

/**
 * The business profile route.
 *
 * Two properties are load-bearing and are what most of this file is about:
 *
 *  1. TENANT ISOLATION. The profile holds a GSTIN, a PAN and a postal address —
 *     the most identifying data the product stores. Every query must be scoped
 *     to the uid on the verified token and never to anything in the body.
 *  2. UPSERT, NOT INSERT. There is exactly one profile per user. A second save
 *     must update the first document, not create a rival one that then wins or
 *     loses a coin toss on the next read.
 *
 * Bun's `mock.module` is process-global and replaces the WHOLE module, so a
 * factory returning only the exports this file overrides makes every other
 * export vanish for every suite that runs afterwards (admin-auth.test.ts then
 * fails to import verifyRequestToken). Spreading the real module keeps the rest
 * intact and stops the suite being order-dependent. This has bitten the repo
 * before — do not "simplify" it to a partial factory.
 */

/** The uid the mocked auth helper hands back. Mutated per test. */
let currentUid = "A";

mock.module("@/lib/server/auth", () => ({
  ...realAuth,
  requireUser: async () => currentUid,
  authErrorResponse: () =>
    NextResponse.json({ error: "unauthorized" }, { status: 401 }),
}));
mock.module("@/lib/mongodb", () => ({ default: async () => {} }));
// Neutralize the real log writer's DB dependency rather than mocking the log
// module itself (a global partial mock of it would leak across suites).
mock.module("@/models/LogEntry", () => ({
  default: { create: async () => ({}) },
}));

type Doc = Record<string, unknown>;

/**
 * In-memory BusinessProfile honoring `{ userId }` filters and `findOneAndUpdate`
 * with `{ upsert: true, new: true }` — the only two operations the route uses.
 */
const store = new Map<string, Doc>();
let insertCount = 0;

const matches = (doc: Doc, filter: Doc): boolean =>
  Object.entries(filter).every(([key, value]) => doc[key] === value);

const lean = <T>(value: T) => ({ lean: async () => value });

const FakeBusinessProfile = {
  findOne(filter: Doc) {
    for (const doc of store.values()) {
      if (matches(doc, filter)) return lean({ ...doc });
    }
    return lean(null);
  },
  findOneAndUpdate(
    filter: Doc,
    update: { $set: Doc },
    options: { upsert?: boolean; new?: boolean } = {}
  ) {
    for (const [key, doc] of store.entries()) {
      if (matches(doc, filter)) {
        const next = { ...doc, ...update.$set };
        store.set(key, next);
        return lean(options.new ? { ...next } : { ...doc });
      }
    }
    if (!options.upsert) return lean(null);
    insertCount += 1;
    const created = { _id: `bp-${insertCount}`, ...filter, ...update.$set };
    store.set(created._id as string, created);
    return lean({ ...created });
  },
};

// The complete surface of @/models/BusinessProfile: the default export (which
// the fake replaces) and the one runtime value the route imports. Everything
// else in that module is a type and is erased. A factory that dynamically
// imported the real module here would deadlock — it is the module being mocked.
mock.module("@/models/BusinessProfile", () => ({
  default: FakeBusinessProfile,
  BUSINESS_PROFILE_TAX_TREATMENTS: ["none", "gst", "composition"],
}));

const { GET, PUT, POST } = await import("@/app/api/profile/route");

const makeReq = (body?: unknown) =>
  ({
    url: "http://x/api/profile",
    headers: { get: () => null },
    json: async () => body,
  }) as unknown as import("next/server").NextRequest;

/** A published, checksum-valid GSTIN: Karnataka (29), PAN AAGCB7383J. */
const VALID_GSTIN = "29AAGCB7383J1Z4";
/** A published, checksum-valid GSTIN in Maharashtra (27). */
const OTHER_GSTIN = "27AAPFU0939F1ZV";

interface ProfileBody {
  profile: Record<string, unknown>;
  exists: boolean;
  message?: string;
}

const readBody = async (res: Response) => (await res.json()) as ProfileBody;

beforeEach(() => {
  store.clear();
  insertCount = 0;
  currentUid = "A";
});

describe("GET /api/profile — the empty shape", () => {
  it("answers 200 with every field present when no profile exists", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    const body = await readBody(res);
    // Absence is the normal state for a user who has never opened the page. A
    // 404 here would force every caller to special-case a cold start.
    expect(body.exists).toBe(false);
    expect(body.profile).toEqual({
      companyName: "",
      companyEmail: "",
      companyPhone: "",
      companyAddress: "",
      companyLogo: "",
      companyGstin: "",
      companyPan: "",
      supplierStateCode: "",
      taxTreatment: "none",
      lutArn: "",
      upiVpa: "",
      bankAccountName: "",
      bankAccountNumber: "",
      bankIfsc: "",
      bankName: "",
      defaultCurrency: "INR",
      defaultTerms: "",
      defaultPaymentInfo: "",
      defaultDueDays: 14,
      invoiceNumberPattern: "",
      signatureLabel: "",
      signatureImageUrl: "",
    });
  });

  it("never invents a profile as a side effect of reading", async () => {
    await GET(makeReq());
    expect(store.size).toBe(0);
  });
});

describe("PUT /api/profile — upsert", () => {
  it("creates on the first save and UPDATES on the second, never duplicating", async () => {
    const first = await PUT(
      makeReq({ companyName: "Acme Consulting", defaultDueDays: 30 })
    );
    expect(first.status).toBe(200);
    expect(store.size).toBe(1);
    expect(insertCount).toBe(1);

    const second = await PUT(
      makeReq({ companyName: "Acme Consulting Pvt Ltd", defaultDueDays: 7 })
    );
    expect(second.status).toBe(200);
    // The property under test: one document, mutated — not two documents.
    expect(store.size).toBe(1);
    expect(insertCount).toBe(1);

    const body = await readBody(second);
    expect(body.exists).toBe(true);
    expect(body.profile.companyName).toBe("Acme Consulting Pvt Ltd");
    expect(body.profile.defaultDueDays).toBe(7);

    const read = await readBody(await GET(makeReq()));
    expect(read.exists).toBe(true);
    expect(read.profile.companyName).toBe("Acme Consulting Pvt Ltd");
  });

  it("POST is the same upsert as PUT (a double-save must not 409)", async () => {
    await POST(makeReq({ companyName: "Acme" }));
    const res = await POST(makeReq({ companyName: "Acme" }));
    expect(res.status).toBe(200);
    expect(store.size).toBe(1);
  });

  it("stamps the uid from the token and ignores one in the body", async () => {
    await PUT(makeReq({ userId: "B", companyName: "Acme" }));
    const stored = [...store.values()][0];
    expect(stored.userId).toBe("A");
  });
});

describe("tenant isolation", () => {
  beforeEach(async () => {
    currentUid = "A";
    await PUT(makeReq({ companyName: "A's business", companyGstin: VALID_GSTIN }));
    currentUid = "B";
    await PUT(makeReq({ companyName: "B's business", companyGstin: OTHER_GSTIN }));
    currentUid = "A";
  });

  it("A reads only A's profile", async () => {
    const body = await readBody(await GET(makeReq()));
    expect(body.profile.companyName).toBe("A's business");
    expect(body.profile.companyGstin).toBe(VALID_GSTIN);
  });

  it("B reads only B's profile", async () => {
    currentUid = "B";
    const body = await readBody(await GET(makeReq()));
    expect(body.profile.companyName).toBe("B's business");
    expect(body.profile.companyGstin).toBe(OTHER_GSTIN);
  });

  it("A's write cannot reach B's profile, even carrying B's userId", async () => {
    await PUT(makeReq({ userId: "B", companyName: "hijacked" }));

    currentUid = "B";
    const body = await readBody(await GET(makeReq()));
    expect(body.profile.companyName).toBe("B's business");
    expect(body.profile.companyGstin).toBe(OTHER_GSTIN);
  });

  it("keeps one document per user (two users, two documents)", async () => {
    expect(store.size).toBe(2);
    const uids = [...store.values()].map((doc) => doc.userId).sort();
    expect(uids).toEqual(["A", "B"]);
  });
});

describe("server-side normalization", () => {
  it("normalizes a pasted lowercase, space-broken GSTIN rather than rejecting it", async () => {
    const res = await PUT(makeReq({ companyGstin: " 29aagcb7383j 1z4 " }));
    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body.profile.companyGstin).toBe(VALID_GSTIN);
  });

  it("rejects a checksum-invalid GSTIN with a 400 and stores nothing", async () => {
    // Last character bumped: format-valid, checksum-wrong. This is the case a
    // regex-only validator waves through.
    const res = await PUT(makeReq({ companyGstin: "29AAGCB7383J1Z5" }));
    expect(res.status).toBe(400);
    expect(store.size).toBe(0);
  });

  it("derives the state code and PAN from the GSTIN, overriding what was sent", async () => {
    const body = await readBody(
      await PUT(
        makeReq({
          companyGstin: VALID_GSTIN,
          supplierStateCode: "27", // a lie: the GSTIN says 29
          companyPan: "ZZZZZ9999Z", // also a lie
        })
      )
    );
    expect(body.profile.supplierStateCode).toBe("29");
    expect(body.profile.companyPan).toBe("AAGCB7383J");
  });

  it("derives taxTreatment: no GSTIN means none, however the client asks", async () => {
    const body = await readBody(
      await PUT(makeReq({ taxTreatment: "gst", companyName: "Acme" }))
    );
    // An unregistered person's document must never be headed TAX INVOICE.
    expect(body.profile.taxTreatment).toBe("none");
  });

  it("derives taxTreatment: a valid GSTIN means gst", async () => {
    const body = await readBody(await PUT(makeReq({ companyGstin: VALID_GSTIN })));
    expect(body.profile.taxTreatment).toBe("gst");
  });

  it("keeps composition, which a GSTIN cannot reveal", async () => {
    const body = await readBody(
      await PUT(makeReq({ companyGstin: VALID_GSTIN, taxTreatment: "composition" }))
    );
    expect(body.profile.taxTreatment).toBe("composition");
  });

  it("clamps defaultDueDays into [0, 365] and survives nonsense", async () => {
    expect(
      (await readBody(await PUT(makeReq({ defaultDueDays: -5 })))).profile
        .defaultDueDays
    ).toBe(0);
    expect(
      (await readBody(await PUT(makeReq({ defaultDueDays: 99999 })))).profile
        .defaultDueDays
    ).toBe(365);
    expect(
      (await readBody(await PUT(makeReq({ defaultDueDays: "not a number" }))))
        .profile.defaultDueDays
    ).toBe(14);
  });

  it("drops a javascript: logo URL — it is interpolated into the printed HTML", async () => {
    const body = await readBody(
      await PUT(makeReq({ companyLogo: "javascript:alert(1)" }))
    );
    expect(body.profile.companyLogo).toBe("");
  });

  it("keeps https and data:image logo URLs", async () => {
    expect(
      (await readBody(await PUT(makeReq({ companyLogo: "https://cdn.test/l.png" }))))
        .profile.companyLogo
    ).toBe("https://cdn.test/l.png");
    expect(
      (
        await readBody(
          await PUT(makeReq({ companyLogo: "data:image/png;base64,AAAA" }))
        )
      ).profile.companyLogo
    ).toBe("data:image/png;base64,AAAA");
  });

  it("falls back to INR for an unsupported currency", async () => {
    const body = await readBody(await PUT(makeReq({ defaultCurrency: "XYZ" })));
    expect(body.profile.defaultCurrency).toBe("INR");
  });

  it("rejects a state code that is not a GST state code", async () => {
    const res = await PUT(makeReq({ supplierStateCode: "77" }));
    expect(res.status).toBe(400);
  });

  it("never leaks exception text on a malformed body", async () => {
    const bad = {
      url: "http://x/api/profile",
      headers: { get: () => null },
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      },
    } as unknown as import("next/server").NextRequest;

    const res = await PUT(bad);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid request body.");
    expect(body.error).not.toContain("SyntaxError");
  });
});

describe("payment identity", () => {
  it("stores a valid UPI ID, lower-cased", async () => {
    const body = await readBody(
      await PUT(makeReq({ upiVpa: "  ACME@OKHDFCBANK " }))
    );
    expect(body.profile.upiVpa).toBe("acme@okhdfcbank");
  });

  it("REFUSES an invalid UPI ID rather than dropping it silently", async () => {
    // Silently blanking it would leave the user printing invoices with no QR
    // and no way to find out why.
    const res = await PUT(makeReq({ upiVpa: "acme@" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("UPI ID");
    expect(store.size).toBe(0);
  });

  it("normalizes the IFSC and the account number, and rejects bad ones", async () => {
    const body = await readBody(
      await PUT(
        makeReq({
          bankIfsc: " hdfc0000123 ",
          bankAccountNumber: "0000 1111 2222",
          bankName: "HDFC Bank",
          bankAccountName: "Acme Inc",
        })
      )
    );
    expect(body.profile.bankIfsc).toBe("HDFC0000123");
    expect(body.profile.bankAccountNumber).toBe("000011112222");
    expect(body.profile.bankName).toBe("HDFC Bank");

    expect((await PUT(makeReq({ bankIfsc: "HDFC1000123" }))).status).toBe(400);
    expect((await PUT(makeReq({ bankAccountNumber: "12" }))).status).toBe(400);
  });

  it("ignores a non-string payment field instead of coercing it", async () => {
    const body = await readBody(
      await PUT(
        makeReq({ upiVpa: { $ne: null }, bankIfsc: 42, bankAccountNumber: [] })
      )
    );
    expect(body.profile.upiVpa).toBe("");
    expect(body.profile.bankIfsc).toBe("");
    expect(body.profile.bankAccountNumber).toBe("");
  });

  it("is empty on a profile that has never been saved", async () => {
    const body = await readBody(await GET(makeReq()));
    expect(body.profile.upiVpa).toBe("");
    expect(body.profile.bankName).toBe("");
    expect(body.profile.bankAccountName).toBe("");
    expect(body.profile.bankAccountNumber).toBe("");
    expect(body.profile.bankIfsc).toBe("");
  });
});
