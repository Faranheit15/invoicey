import { NextRequest, NextResponse } from "next/server";
import { verifyRequestToken, authErrorResponse } from "@/lib/server/auth";
import type { DecodedIdToken } from "firebase-admin/auth";
import admin from "@/lib/firebase-admin";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Invoice from "@/models/Invoice";
import Feedback from "@/models/Feedback";
import LogEntry from "@/models/LogEntry";
import { logEvent, logEventNow, logRouteError } from "@/lib/server/log";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import {
  confirmationMatches,
  isReauthFresh,
  pseudonymizeUid,
  REAUTH_MAX_AGE_SECONDS,
} from "@/lib/server/account-delete";

/**
 * The account resource. `GET` reports what deletion would destroy; `DELETE`
 * destroys it.
 *
 * This is the ONE surface in Invoicey that hard-deletes. "Nothing is ever
 * hard-deleted" governs the invoice lifecycle — it is not a defence against the
 * DPDP right of erasure, which a soft delete does not satisfy, because a row
 * flagged `is_deleted` is still the person's personal data sitting in our
 * database. PRODUCT.md carries the amendment that makes this the deliberate
 * exception, and every user-facing string here says "permanent" plainly.
 *
 * Both handlers take `verifyRequestToken` rather than `requireUser`: DELETE
 * needs the full decoded token for `auth_time` and `email`, and GET returns the
 * token's email so the dialog confirms against the same identity the server
 * will check.
 */

const DELETE_AUTH_MESSAGES = {
  EmailNotVerified:
    "Please verify your email before changing your account.",
} as const;

// The real protections are the 5-minute re-auth window and the typed email;
// this is only a brake on repeated attempts.
const BURST_LIMIT = {
  namespace: "account-delete",
  limit: 5,
  windowMs: 60 * 60 * 1000,
} as const;

export async function GET(req: NextRequest) {
  let decodedToken: DecodedIdToken;
  try {
    decodedToken = await verifyRequestToken(req);
  } catch (error: unknown) {
    return authErrorResponse(error, DELETE_AUTH_MESSAGES);
  }

  const uid = decodedToken.uid;
  try {
    await connectDB();

    // No `is_deleted` filter on the total: the dialog has to name what will
    // actually be destroyed, and that includes the recycle bin.
    const [invoices, deletedInvoices, feedback, activity] = await Promise.all([
      Invoice.countDocuments({ userId: uid }),
      Invoice.countDocuments({ userId: uid, is_deleted: true }),
      Feedback.countDocuments({ userId: uid }),
      LogEntry.countDocuments({ userId: uid }),
    ]);

    return NextResponse.json(
      {
        email: decodedToken.email ?? "",
        counts: { invoices, deletedInvoices, feedback, activity },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "GET /api/account",
      userId: uid,
      category: "admin",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  let decodedToken: DecodedIdToken;
  try {
    decodedToken = await verifyRequestToken(req);
  } catch (error: unknown) {
    return authErrorResponse(error, DELETE_AUTH_MESSAGES);
  }

  const uid = decodedToken.uid;

  const burst = consumeRateLimit(BURST_LIMIT, uid);
  if (burst.limited) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
    );
  }

  // Gate: proof of identity within the last 5 minutes. `code` is machine-
  // readable so the client can re-authenticate and retry instead of showing a
  // dead end.
  if (!isReauthFresh(decodedToken.auth_time)) {
    return NextResponse.json(
      {
        error: "Please sign in again to confirm.",
        code: "REAUTH_REQUIRED",
        maxAgeSeconds: REAUTH_MAX_AGE_SECONDS,
      },
      { status: 401 }
    );
  }

  // Gate: the typed confirmation, checked here and not only in the dialog.
  let body: { confirmEmail?: unknown } | null = null;
  try {
    body = (await req.json()) as { confirmEmail?: unknown };
  } catch {
    body = null;
  }
  if (!confirmationMatches(body?.confirmEmail, decodedToken.email)) {
    return NextResponse.json(
      {
        error:
          "That email doesn't match the account you're signed in to. Type it exactly to confirm.",
      },
      { status: 400 }
    );
  }

  // Tracked so the failure path can say what actually happened. Deletion is
  // irreversible and partly ordered, so "nothing has been lost" is a claim
  // that stops being true after the very first step.
  let invoicesDestroyed = false;

  try {
    await connectDB();

    // Awaited, NOT `logEvent`. `logEvent` defers through `after()`, which would
    // land this row after the anonymisation pass below and leave a surviving
    // log entry carrying the uid of an erased account — the exact thing the
    // erasure is meant to remove.
    await logEventNow({
      category: "admin",
      event: "account.delete.requested",
      userId: uid,
      meta: { subject: pseudonymizeUid(uid) },
    });

    // ORDER MATTERS, AND MONGO GOES FIRST.
    //
    // If any of these fail, the Firebase account still exists and the user can
    // sign in and retry — nothing is lost. Deleting Firebase first would leave
    // them locked out forever with their data still in Mongo and no way to
    // reach it. The residual failure is the last step failing after these
    // succeeded: a Firebase identity with no data behind it, which mints a
    // fresh empty account on next sign-in. Annoying, not harmful, detectable.
    const invoicesResult = await Invoice.deleteMany({ userId: uid });
    invoicesDestroyed = (invoicesResult?.deletedCount ?? 0) > 0;
    const feedbackResult = await Feedback.deleteMany({ userId: uid });

    // Logs are ANONYMISED, not destroyed: once every identifying field is gone
    // the row is no longer personal data, and what remains is the aggregate
    // operational history that expires on its own TTL. Destroying them instead
    // would erase the record that any account was ever deleted, which is the
    // opposite of an audit trail.
    //
    // `userId` and `ip` are NOT sufficient on their own. The AI route writes the
    // typed prompt to `message` and the whole serialised draft to
    // `meta.fullPrompt` — the user's business address and phone, their client's
    // name, email and address, every line item, and `paymentInfo`, which is the
    // free-text bank/UPI block. A row stripped only of its uid would still be
    // squarely about a named person and their named client. `userAgent` and
    // `requestId` go for the same reason: both re-identify across rows.
    const activityResult = await LogEntry.updateMany(
      { userId: uid },
      {
        $set: {
          userId: null,
          ip: null,
          userAgent: null,
          requestId: null,
          message: "",
          meta: {},
        },
      }
    );

    await User.deleteOne({ uid });

    // Known, accepted gap: `logEvent` defers its write through `after()`, so a
    // request that returned moments before this one can still land a row
    // carrying the uid and IP after the pass above has run. Re-running the
    // deletion clears it, and the row expires on its own TTL regardless. Closing
    // it properly means making every writer awaited, which trades a permanent
    // latency cost on every request for a narrow window on a rare one.
    await LogEntry.updateMany(
      { userId: uid },
      { $set: { userId: null, ip: null, userAgent: null, requestId: null, message: "", meta: {} } }
    );

    // Last. Without this, lib/auth-user-sync.ts recreates the Mongo user on the
    // next sign-in and the "deleted" account silently resurrects.
    try {
      await admin.auth().deleteUser(uid);
    } catch (error: unknown) {
      // Already gone (a retry after a partial failure) is success, not an error.
      const code = (error as { code?: string })?.code;
      if (code !== "auth/user-not-found") throw error;
    }

    // `userId: null` and a pseudonym in meta. An audit row that outlives the
    // erasure and still names the person defeats the erasure it records; the
    // HMAC lets an operator correlate two support tickets without being able to
    // recover who they belonged to. See lib/server/account-delete.ts.
    logEvent({
      category: "admin",
      event: "account.deleted",
      userId: null,
      meta: {
        subject: pseudonymizeUid(uid),
        invoices: invoicesResult?.deletedCount ?? 0,
        feedback: feedbackResult?.deletedCount ?? 0,
        activityAnonymised: activityResult?.modifiedCount ?? 0,
      },
    });

    return NextResponse.json(
      {
        deleted: {
          invoices: invoicesResult?.deletedCount ?? 0,
          feedback: feedbackResult?.deletedCount ?? 0,
          activityAnonymised: activityResult?.modifiedCount ?? 0,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: unknown) {
    // `userId: null` and no `req`, both deliberately: this row can be written
    // after the anonymisation pass has already run, and `logRouteError` records
    // the caller's IP off the request. Re-attaching either the uid or the IP
    // here would put back exactly what the anonymisation removed.
    logRouteError(error, {
      route: "DELETE /api/account",
      userId: null,
      category: "admin",
      event: "account.delete.failed",
    });
    return NextResponse.json(
      {
        error: invoicesDestroyed
          ? "Account deletion stopped partway. Your invoices have already been permanently deleted and cannot be recovered; the rest of your account has not. You are still signed in — run it again to finish."
          : "Account deletion did not start. Nothing has been deleted — you're still signed in, please try again.",
      },
      { status: 500 }
    );
  }
}
