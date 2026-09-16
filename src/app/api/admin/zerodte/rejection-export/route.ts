// GET /api/admin/zerodte/rejection-export — admin-only per-rejection export carrying the
// skip-grading counterfactual (verdict/outcome/pnl_pct) alongside the ticker/session/direction a
// gate blocked, for one specific `gate_failed` code.
//
// WHY THIS EXISTS (2026-09-16, Ask 0DTE deep-dive, operator directive: "fix up all shit"):
// `GET /api/market/zerodte/calibration?grade_skips=1` (calibration.ts's blockedValueLines) already
// aggregates a gate's false-block rate (n / would_have_won / rate_pct) — that's how G-18
// (early_window_prime_score) was measured at a 71.4% false-block rate over 30-45 real days
// (docs/audit/findings-staging/2026-09-16-zerodte-g18-early-window-false-block-rate.md). But that
// aggregate cannot say WHICH specific tickers/sessions it's wrongly rejecting, which is exactly
// what a targeted fix (e.g. a G-17-style conditional-admission carve-out) needs to know. The
// counterfactual (verdict/outcome/pnl_pct) already lives on every graded `zerodte_scan_rejections`
// row (skip-grading.ts's SkipCounterfactual, in `counterfactual_json`) — it was just never exposed
// past the aggregate. This route exposes it directly, admin-gated, read-only, same pattern as
// tier-export.ts (which did the identical thing for committed plays' entry_premium/top_strike).
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchZeroDteScanRejections, requireDatabaseInProduction } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2000;

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const gateFailed = req.nextUrl.searchParams.get("gate_failed") ?? undefined;
  const sessionDate = req.nextUrl.searchParams.get("session_date") ?? undefined;
  const ticker = req.nextUrl.searchParams.get("ticker") ?? undefined;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT)
  );

  try {
    const rows = await fetchZeroDteScanRejections({
      gate_failed: gateFailed,
      session_date: sessionDate,
      ticker,
      limit,
    });
    return NextResponse.json(roundFloats({ gate_failed: gateFailed ?? null, count: rows.length, rows }), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    recordAdminRouteError("admin/zerodte/rejection-export", error);
    return NextResponse.json({ error: "Failed to load 0DTE rejection export" }, { status: 502 });
  }
}
