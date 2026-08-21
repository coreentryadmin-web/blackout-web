import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import {
  attachPostedTweetId,
  listQueueRows,
  type ListQueueOptions,
} from "@/lib/x-intel/queue-store";
import { X_INTEL_STATUSES, type XIntelStatus } from "@/lib/x-intel/queue-types";

/**
 * The reviewer's read surface for the X intel queue.
 *
 * GET returns rows newest-first. POST records which tweet a package became — that id is the join
 * key the learning loop needs to attribute impressions back to a package, and a human is the only
 * one who knows it, because a human is the only one who publishes.
 *
 * This route CANNOT publish. It has no path to `x-api.ts` and must never gain one: the queue's
 * entire purpose is that a person stands between a generated package and the live account.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseStatus(raw: string | null): ListQueueOptions["status"] {
  if (!raw || raw === "ALL") return "ALL";
  return (X_INTEL_STATUSES as readonly string[]).includes(raw)
    ? (raw as XIntelStatus)
    : "ALL";
}

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const params = req.nextUrl.searchParams;
    const rawLimit = parseInt(params.get("limit") ?? "50", 10);
    const rows = await listQueueRows({
      limit: Number.isFinite(rawLimit) ? rawLimit : 50,
      status: parseStatus(params.get("status")),
      sessionDate: params.get("session_date") ?? undefined,
    });

    // No roundFloats() here: the only float on a row is `confidence.score`, and rounding it would
    // silently change a calibrated 0.78 into a value the reviewer cannot trace to its basis.
    return NextResponse.json({ rows, count: rows.length }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    recordAdminRouteError("admin/x-intel/queue", error);
    return NextResponse.json(
      { error: "Failed to load X intel queue" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  let body: { cycle_key?: unknown; tweet_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const cycleKey = typeof body.cycle_key === "string" ? body.cycle_key : "";
  const tweetId = typeof body.tweet_id === "string" ? body.tweet_id : "";
  if (!cycleKey || !tweetId) {
    return NextResponse.json(
      { error: "cycle_key and tweet_id are required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const updated = await attachPostedTweetId(cycleKey, tweetId);
    if (!updated) {
      return NextResponse.json(
        { error: "No queue row for that cycle_key" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    // attachPostedTweetId throws on a malformed id — that is a 400, not a server fault.
    const message = error instanceof Error ? error.message : "";
    if (message.includes("invalid tweet id")) {
      return NextResponse.json(
        { error: "tweet_id must be numeric" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    recordAdminRouteError("admin/x-intel/queue", error);
    return NextResponse.json(
      { error: "Failed to record tweet id" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
