import { NextRequest, NextResponse } from "next/server";
import type { PipelineStage } from "mongoose";
import connectDB from "@/lib/mongodb";
import Invoice from "@/models/Invoice";
import { requireUser, authErrorResponse } from "@/lib/server/auth";
import { parsePagination } from "@/lib/server/pagination";
import { logRouteError } from "@/lib/server/log";
import {
  DEFAULT_CLIENT_PAGE_SIZE,
  MAX_CLIENT_PAGE_SIZE,
  MAX_INVOICES_SCANNED,
  buildClientDirectoryPipeline,
  serializeClientRow,
  type ClientDirectoryResponse,
} from "@/lib/clients";

/**
 * GET /api/clients — the distinct clients this user has invoiced.
 *
 * Read-only and derived: there is no clients collection and no write verb here.
 * See `lib/clients.ts` for why, and for the grouping key.
 *
 * Three rules, the same three the invoice route keeps:
 *
 *  1. `userId` comes from `requireUser(req)` — the verified Firebase token —
 *     and from nowhere else. A `userId` in the query string is ignored.
 *  2. Soft-deleted invoices are excluded (`is_deleted: { $ne: true }`), so
 *     removing an invoice removes its contribution to the directory.
 *  3. Errors are bare. No exception text reaches the client.
 */

const CLIENTS_AUTH_MESSAGES = {
  EmailNotVerified: "Please verify your email before accessing your clients.",
} as const;

interface FacetResult {
  rows?: Record<string, unknown>[];
  total?: { value?: number }[];
}

export async function GET(req: NextRequest) {
  let userUid: string;
  try {
    userUid = await requireUser(req);
  } catch (error: unknown) {
    return authErrorResponse(error, CLIENTS_AUTH_MESSAGES);
  }

  await connectDB();

  const { searchParams } = new URL(req.url);
  const { page, limit, skip } = parsePagination(searchParams, {
    defaultLimit: DEFAULT_CLIENT_PAGE_SIZE,
    maxLimit: MAX_CLIENT_PAGE_SIZE,
  });

  try {
    const [facet] = (await Invoice.aggregate(
      // The builder is deliberately mongoose-free (it is pure and unit-tested
      // on its own), so the driver's stage union is applied here.
      buildClientDirectoryPipeline({
        userId: userUid,
        skip,
        limit,
        search: searchParams.get("q") ?? "",
      }) as unknown as PipelineStage[]
    )) as FacetResult[];

    const rows = facet?.rows ?? [];
    const total = facet?.total?.[0]?.value ?? 0;

    // One extra count, only to say whether the scan window was full. It is a
    // countDocuments on the same index the pipeline used, not a second scan.
    const invoiceCount = await Invoice.countDocuments({
      userId: userUid,
      is_deleted: { $ne: true },
    });

    const body: ClientDirectoryResponse = {
      clients: rows.map(serializeClientRow),
      page,
      limit,
      total,
      hasMore: skip + rows.length < total,
      truncated: invoiceCount > MAX_INVOICES_SCANNED,
    };

    return NextResponse.json(body);
  } catch (error: unknown) {
    logRouteError(error, {
      req,
      route: "GET /api/clients",
      userId: userUid,
      category: "invoice",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
