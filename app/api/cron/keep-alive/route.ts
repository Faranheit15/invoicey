import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Invoice from "@/models/Invoice";

// This route must run on every invocation (never cached/prerendered) — it is a
// liveness ping, not a cacheable response.
export const dynamic = "force-dynamic";

/**
 * Keep-alive endpoint.
 *
 * Free-tier (M0) MongoDB Atlas clusters are paused after a long stretch of
 * inactivity, after which they need a manual resume. This performs one cheap,
 * real read so the cluster registers activity and stays awake. It is triggered
 * on a schedule by Vercel Cron (see vercel.json).
 *
 * When CRON_SECRET is set, Vercel Cron sends it as `Authorization: Bearer <secret>`;
 * we require it so the endpoint can't be hit by arbitrary traffic. If it is not
 * set, the endpoint is open (fine for a read-only ping, but setting it is better).
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    await connectDB();
    // estimatedDocumentCount uses collection metadata — O(1), no scan — but is a
    // genuine round-trip to the cluster, which is all that's needed to keep it awake.
    const invoiceCount = await Invoice.estimatedDocumentCount();

    return NextResponse.json({
      ok: true,
      invoiceCount,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Keep-alive DB check failed:", message);
    return NextResponse.json(
      { ok: false, error: "Database unreachable" },
      { status: 503 }
    );
  }
}
