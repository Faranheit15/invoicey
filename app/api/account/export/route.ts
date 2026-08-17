import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/server/auth";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Invoice from "@/models/Invoice";
import BusinessProfile from "@/models/BusinessProfile";
import Feedback from "@/models/Feedback";
import LogEntry from "@/models/LogEntry";
import { logEvent, logRouteError } from "@/lib/server/log";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { reserveDailyExportQuota } from "@/lib/server/account-quota";
import {
  accountExportFilename,
  buildAccountExport,
  buildAccountExportCsv,
} from "@/lib/server/account-export";

/**
 * GET /api/account/export — the DPDP data-subject access request.
 *
 * Everything the app holds on the caller, in one file they can read: account
 * profile, business profile, every invoice INCLUDING the ones they deleted,
 * their feedback, and their activity. The dashboard's
 * `is_deleted: { $ne: true }` filter is deliberately absent — a soft-deleted
 * invoice is still their data, and an export that hides it is not a complete
 * answer to the request.
 *
 * THE COLLECTION LIST HERE MUST MATCH `DELETE /api/account`. Anything that
 * route destroys and this one does not read is data the user loses by
 * following our own "download your data first" instruction. That is precisely
 * how BusinessProfile — GSTIN, PAN, bank account, IFSC, UPI VPA, signature —
 * came to be missing from this file for two phases.
 *
 * GET rather than POST to match the two existing bulk exports
 * (app/api/admin/export/*), which are also reads. `Cache-Control: no-store`
 * carries the caching concern instead.
 */

const EXPORT_AUTH_MESSAGES = {
  EmailNotVerified: "Please verify your email before exporting your data.",
} as const;

// Best-effort brake on hammering; the durable daily quota is the real limit.
const BURST_LIMIT = {
  namespace: "account-export",
  limit: 5,
  windowMs: 10 * 60 * 1000,
} as const;

// Caps, not pagination: an export is all-or-a-stated-truncation, and the meta
// block says which. A tenant past these is far outside the product's shape.
const INVOICE_CAP = 20_000;
const ACTIVITY_CAP = 5_000;

export async function GET(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await requireUser(req);
  } catch (error: unknown) {
    return authErrorResponse(error, EXPORT_AUTH_MESSAGES);
  }

  const burst = consumeRateLimit(BURST_LIMIT, userUid);
  if (burst.limited) {
    return NextResponse.json(
      { error: "Too many export requests. Wait a moment and try again." },
      {
        status: 429,
        headers: { "Retry-After": String(burst.retryAfterSeconds) },
      }
    );
  }

  try {
    // Inside the try: a connection failure is a 500 for this request, not an
    // unhandled rejection escaping the handler.
    await connectDB();

    const format =
      new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "json";

    const quota = await reserveDailyExportQuota(userUid, format);
    if (quota.exceeded) {
      return NextResponse.json(
        {
          error: `You've downloaded your data ${quota.limit} times in the last 24 hours. This limit rolls, so try again a little later — nothing has changed in your account.`,
        },
        { status: 429, headers: { "Retry-After": "3600" } }
      );
    }

    // Every read is scoped to the caller's uid. There is no path here that
    // takes an identifier from the request.
    const [profile, businessProfile, invoicesRaw, feedbackRaw, activityRaw] =
      await Promise.all([
        User.findOne({ uid: userUid }).lean(),
        // The seller side: GSTIN, PAN, address, bank account, IFSC, UPI VPA,
        // signature. `DELETE /api/account` hard-deletes this collection, and
        // the delete flow tells the user to export first — so leaving it out
        // of the export made that instruction a trap.
        BusinessProfile.findOne({ userId: userUid }).lean(),
        Invoice.find({ userId: userUid })
          .sort({ createdAt: -1 })
          .limit(INVOICE_CAP + 1)
          .lean(),
        Feedback.find({ userId: userUid }).sort({ createdAt: -1 }).lean(),
        LogEntry.find({ userId: userUid })
          .sort({ at: -1 })
          .limit(ACTIVITY_CAP + 1)
          .lean(),
      ]);

    const invoicesAll = invoicesRaw as unknown as Record<string, unknown>[];
    const activityAll = activityRaw as unknown as Record<string, unknown>[];
    const truncated = {
      invoices: invoicesAll.length > INVOICE_CAP,
      activity: activityAll.length > ACTIVITY_CAP,
    };

    const payload = buildAccountExport({
      profile: profile as unknown as Record<string, unknown> | null,
      businessProfile: businessProfile as unknown as Record<
        string,
        unknown
      > | null,
      invoices: truncated.invoices ? invoicesAll.slice(0, INVOICE_CAP) : invoicesAll,
      feedback: feedbackRaw as unknown as Record<string, unknown>[],
      activity: truncated.activity ? activityAll.slice(0, ACTIVITY_CAP) : activityAll,
      truncated,
    });

    logEvent({
      category: "admin",
      event: "account.export.completed",
      userId: userUid,
      meta: { format, ...payload.meta.counts },
    });

    const filename = accountExportFilename(format);
    const headers: Record<string, string> = {
      "Content-Disposition": `attachment; filename="${filename}"`,
      // The whole account in one response. It must not sit in any cache.
      "Cache-Control": "no-store",
    };

    if (format === "csv") {
      return new NextResponse(buildAccountExportCsv(payload.invoices), {
        headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
      });
    }

    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "GET /api/account/export",
      userId: userUid,
      category: "admin",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
