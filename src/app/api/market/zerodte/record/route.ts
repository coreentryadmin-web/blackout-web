// GET /api/market/zerodte/record — the 0DTE Command multi-day track record (P-3).
// Same auth/gating as the board route (this is the same product surface, read-only),
// same window convention as /api/market/nighthawk/record (?days=N, default 30, cap 90).
// All aggregation math lives in src/lib/zerodte/record.ts (pure, unit-tested); this
// route only fetches ledger rows and shapes the response.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchZeroDteSetupLogRange, requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { buildZeroDteRecord } from "@/lib/zerodte/record";
import { formatEtDate, todayEt } from "@/features/nighthawk/lib/session";
import { roundFloats, reconcileTrancheFractions } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;


const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
// Row budget: the scanner ledger caps out well under 15 committed rows/session in
// practice (10 setups/scan, one row per session+ticker), so days*20 with a hard
// ceiling comfortably covers the window without an unbounded fetch.
const MAX_ROWS = 2000;

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  if (authResult.via === "user") {
    // 0DTE Command lives on /nighthawk behind Night Hawk's launch gate — same
    // gating decision as the board route (see its comment).
    const nighthawkDenied = await requireToolApi("nighthawk");
    if (nighthawkDenied) return nighthawkDenied;
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const days = Math.min(
    MAX_DAYS,
    Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS) || DEFAULT_DAYS)
  );
  const through = todayEt();
  const since = formatEtDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

  try {
    const rows = await fetchZeroDteSetupLogRange(since, Math.min(MAX_ROWS, days * 20));
    const record = buildZeroDteRecord(rows, { since, through, days });
    // Numbers are rounded at the data layer (record.ts); roundFloats is the same
    // response-boundary backstop every other market endpoint ships with.
    const rounded = roundFloats(record);
    // A WS-11 reconstructed TRIM-SCALE play's `entry_context.executable.tranches[]` audit
    // trail just had each leg's `fraction` rounded INDEPENDENTLY by roundFloats() above — a
    // fully-fired ⅓/⅓/⅓ play now displays 0.33/0.33/0.33, which sums to 0.99, not 1.00
    // (live-caught 2026-10-25). The official `managed_pnl_pct` headline is unaffected (it
    // blends the exact, unrounded fractions before this rounding pass ever runs) — only this
    // served audit trail drifts. reconcileTrancheFractions (round-floats.ts) adjusts the
    // runner leg to absorb the residual, same rounding-composition fix as
    // reconcileStrikeTotal/reconcileCellStrikeTotals one level deeper.
    for (const play of rounded.plays) {
      const ex = play.entry_context?.executable;
      if (ex && typeof ex === "object" && Array.isArray((ex as Record<string, unknown>).tranches)) {
        (ex as Record<string, unknown>).tranches = reconcileTrancheFractions(
          (ex as Record<string, unknown>).tranches as { fraction: number }[]
        );
      }
    }
    return NextResponse.json(rounded, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[market/zerodte/record]", error);
    return NextResponse.json(
      { available: false, degraded: true },
      { headers: NO_STORE_HEADERS }
    );
  }
}
