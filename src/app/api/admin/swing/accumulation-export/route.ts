// GET /api/admin/swing/accumulation-export — admin-only export of swing_candidate_accumulation
// rows (both promoted AND still-pending), for a real recall study of the cross-session
// persistence gate (accumulation-store.ts's MIN_PERSISTENCE_SESSIONS=2 requirement).
//
// The gate's own header comment calls it "Provisional — never a graduated edge, just the
// persistence floor" — nothing has ever measured whether requiring a 2nd distinct session day
// (or same-day corroboration for event/immediate archetypes) actually protects edge or just
// costs it. Live-observed 2026-09-08: several TRIGGERED+AT_TRIGGER swing setups scoring 67-85
// sat in RESEARCH all day, blocked purely by "1/2 distinct session days" — one of them (EWY)
// was already up +1.4% in the underlying hours after being blocked. A single day's anecdote
// isn't evidence either way; this route is the data source for the real backtest
// (scripts/audit/swing-persistence-recall.mjs), mirroring how tier-export.ts feeds the
// analogous 0DTE C-tier/untiered exit-mode study.
//
// Per-row shaping stays a plain pass-through (SwingAccumRow already carries every field the
// backtest needs: ticker/direction/archetype/distinct_session_days/first_seen_at/
// promoted_position_id) — no derived "cleared/blocked" verdict is computed server-side, since
// per-archetype persistence rules (ARCHETYPE_PERSISTENCE in taxonomy.ts) are the backtest
// script's own concern, kept in sync with accumulation-store.ts like every other offline
// analysis in this audit toolkit.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchSwingAccumulationExport, requireDatabaseInProduction } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 120;
const MAX_ROWS = 5000;

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
    const rows = await fetchSwingAccumulationExport(since, MAX_ROWS);
    return NextResponse.json(
      roundFloats({ since, through: new Date().toISOString().slice(0, 10), days, rows }),
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    recordAdminRouteError("admin/swing/accumulation-export", error);
    return NextResponse.json({ error: "Failed to load swing accumulation export" }, { status: 502 });
  }
}
