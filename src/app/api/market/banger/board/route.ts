// ENGINE B — Banger board (member-facing read). A standalone product like the 0DTE Command board
// (src/app/api/market/zerodte/board/route.ts): read-only listing of open + recently-closed
// banger_positions, following the same auth/shape conventions (cron OR premium+ user, no-store, gate
// behind the Night Hawk tool launch since this ships as part of that surface).
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { fetchBangerBoardRows, type BangerPositionRow } from "@/lib/banger/positions-db";
import { isBangerEngineEnabled } from "@/lib/banger/flag";
import { bangerScaleOutNote } from "@/lib/zerodte/scale-out";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

function toBoardPlay(row: BangerPositionRow) {
  return {
    id: row.id,
    ticker: row.ticker,
    session_date: row.session_date,
    contract: {
      strike: row.contract_strike,
      expiry: row.contract_expiry,
      occ: row.contract_occ,
    },
    entry_premium: row.entry_premium,
    last_mark: row.last_mark,
    peak_premium: row.peak_premium,
    status: row.status,
    scaled_already: row.scaled_already,
    scale_out_action: row.scale_out_action,
    scale_out_reason: row.scale_out_reason,
    realized_pnl_pct: row.realized_pnl_pct,
    realized_pnl_usd: row.realized_pnl_usd,
    discovery: {
      gain: row.discovery_gain,
      vol: row.discovery_vol,
      dollar_vol: row.discovery_dollar_vol,
      close_strength: row.discovery_close_strength,
    },
    committed_at: row.committed_at,
    closed_at: row.closed_at,
  };
}

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  if (authResult.via === "user") {
    const nighthawkDenied = await requireToolApi("nighthawk");
    if (nighthawkDenied) return nighthawkDenied;
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  if (!isBangerEngineEnabled()) {
    return NextResponse.json(
      { available: false, enabled: false, reason: "BANGER_ENGINE_ENABLED=0", plays: [] },
      { headers: NO_STORE_HEADERS },
    );
  }

  try {
    const rows = await fetchBangerBoardRows(60);
    const open = rows.filter((r) => r.status === "OPEN" || r.status === "PARTIAL");
    const closed = rows.filter((r) => r.status === "CLOSED_RUNNER" || r.status === "STOPPED");
    return NextResponse.json(
      roundFloats({
        available: true,
        enabled: true,
        as_of: new Date().toISOString(),
        exit_rule_note: bangerScaleOutNote(),
        open: open.map(toBoardPlay),
        closed: closed.map(toBoardPlay),
      }),
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[market/banger/board]", error);
    return NextResponse.json({ available: false, degraded: true }, { headers: NO_STORE_HEADERS });
  }
}
