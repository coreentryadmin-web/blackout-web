// GET /api/admin/banger/closed-export — admin-only export of ALL closed banger_positions rows
// (CLOSED_RUNNER/STOPPED) since a given date, for a real discovery-edge study of Engine B.
//
// Built 2026-09-25 (Ask Largo standing mandate, operator directive): Banger commits on a
// deliberately uncapped screen (discovery.ts's own header: "ZERO CAPS ... no top-N slice, no
// daily-commit cap, no position-count cap"), which is why the live open book reached 78-168
// concurrent positions. The operator wants that cut to a curated 10-20, but gated on MEASURED
// historical edge (which pre-entry variables actually separated the 100%+ runners from the
// losers), not an arbitrary tightening of the existing thresholds — and explicitly does not want
// production discovery/commit logic touched until that analysis exists. This route is the data
// source for that analysis (scripts/audit/banger-discovery-edge-analysis.mjs), mirroring how
// swing/accumulation-export feeds the analogous cross-session-persistence recall study.
//
// Per-row shaping stays a plain pass-through — BangerPositionRow already carries every pre-entry
// field the study needs (discovery_gain/vol/dollar_vol/close_strength, contract_strike/expiry,
// entry_premium, entry_context) alongside the outcome fields (peak_premium/trough_premium for
// MFE/MAE, realized_pnl_pct/usd, status, closed_at) — no derived verdict is computed server-side,
// since avoiding look-ahead bias in how those are combined is the analysis script's own concern.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { fetchBangerClosedExportRows } from "@/lib/banger/positions-db";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_DAYS = 180;
const MAX_DAYS = 365;
const MAX_ROWS = 5000;

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const days = Math.min(
    MAX_DAYS,
    Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS) || DEFAULT_DAYS),
  );
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const rows = await fetchBangerClosedExportRows(since, MAX_ROWS);
    return NextResponse.json(
      roundFloats({ since, through: new Date().toISOString(), days, count: rows.length, rows }),
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    recordAdminRouteError("admin/banger/closed-export", error);
    return NextResponse.json({ error: "Failed to load banger closed export" }, { status: 502 });
  }
}
