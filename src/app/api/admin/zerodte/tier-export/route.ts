// GET /api/admin/zerodte/tier-export — admin-only per-play export carrying the fields
// a real historical C-tier/untiered exit-mode backtest needs (Task tracking #59,
// docs/audit/0DTE-RESEARCH.md's "Follow-up scoped but BLOCKED" note, 2026-08-28).
//
// The public /api/market/zerodte/record route (record.ts's buildZeroDteRecord) only ever
// returns AGGREGATE stats — it drops entry_premium/top_strike/expiry per play, so a real
// historical row can never be re-priced against the option's own minute bars. Those three
// fields already exist on every ZeroDteSetupLogRow (src/lib/db.ts's fetchZeroDteSetupLogRange
// — see mapZeroDteLogRow), they were just never exposed past record.ts's aggregation. This
// route exposes them directly, admin-gated read-only, so an offline backtest script (the
// zerodte-sim.mjs-style `gradeThroughExitEngine` A/B already used for the E5 exit-engine study)
// can pull a REAL C-tier/untiered population instead of zerodte-sim.mjs's own simulated
// candidates — which can't be tiered correctly (assignZeroDteTier needs live VIX/Cortex reads
// the sim's candidate loop never performs; see the same doc section for why that path is a
// confound, not a genuine C-tier sample).
//
// Per-row shaping (in particular which tier a row gets) lives in the pure, unit-tested
// buildTierExportRow (tier-export.ts) — this route only fetches and serializes.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchZeroDteSetupLogRange, requireDatabaseInProduction } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { buildTierExportRow } from "@/lib/zerodte/tier-export";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const MAX_ROWS = 2000;

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const days = Math.min(
    MAX_DAYS,
    Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS) || DEFAULT_DAYS)
  );
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    const rows = await fetchZeroDteSetupLogRange(since, Math.min(MAX_ROWS, days * 20));
    const plays = rows.map(buildTierExportRow);
    return NextResponse.json(roundFloats({ since, through: new Date().toISOString().slice(0, 10), days, plays }), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    recordAdminRouteError("admin/zerodte/tier-export", error);
    return NextResponse.json({ error: "Failed to load 0DTE tier export" }, { status: 502 });
  }
}
