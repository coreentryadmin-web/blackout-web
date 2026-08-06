// GET /api/admin/zerodte/funnel — discovery funnel for Admin BIE (Phase 2b).
//
// Optional `?date=YYYY-MM-DD` (added for the veto-flicker-rate probe, INTENTIONAL-DESIGN #2 —
// docs/audit/FINDINGS.md 2026-08-05): fetchZeroDteFunnelSnapshot always accepted a sessionDate
// param, this route just never plumbed one through, so every call silently meant "today" —
// with no way to pull a past session's raw events/rejections for offline analysis after the ET
// calendar day rolls over. A malformed/missing date silently falls back to today (never 400s —
// this is a read-only debug aid, not a strict API contract).
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchZeroDteFunnelSnapshot } from "@/lib/admin-zerodte-funnel";
import { roundFloats } from "@/lib/round-floats";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const dateParam = request.nextUrl.searchParams.get("date");
    const sessionDate = dateParam && YMD_RE.test(dateParam) ? dateParam : undefined;
    const snapshot = sessionDate
      ? await fetchZeroDteFunnelSnapshot(sessionDate)
      : await fetchZeroDteFunnelSnapshot();
    return NextResponse.json(roundFloats(snapshot), { headers: NO_STORE_HEADERS });
  } catch (error) {
    recordAdminRouteError("admin/zerodte/funnel", error);
    return NextResponse.json({ error: "Failed to load 0DTE discovery funnel" }, { status: 502 });
  }
}
