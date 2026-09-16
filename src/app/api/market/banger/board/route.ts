// ENGINE B — Banger board (member-facing read). A standalone product like the 0DTE Command board
// (src/app/api/market/zerodte/board/route.ts): read-only listing of open + recently-closed
// banger_positions, following the same auth/shape conventions (cron OR premium+ user, no-store, gate
// behind the Night Hawk tool launch since this ships as part of that surface).
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import {
  fetchBangerOpenBookRows,
  fetchBangerClosedBoardRows,
  type BangerPositionRow,
} from "@/lib/banger/positions-db";
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
    // BUG (found live 2026-09-16, Ask Largo standing mandate): this used to be one combined
    // `fetchBangerBoardRows(60)` query (top 60 rows of ALL statuses, filtered into open/closed in
    // JS afterward) — the exact page-limited-tally shape `fetchBangerOpenCount`'s own doc comment
    // already names as a measured bug for the COUNT ("Largo reported 40 open positions... then 20
    // ...60s later"), just never fixed for this LISTING. Once total (open+closed) rows exceed 60,
    // older-but-still-OPEN positions age out of the shared window and silently vanish from the
    // member-facing board while still being live, real holdings — confirmed live: this route
    // reported exactly open:33/closed:27/total:60 (the limit fully saturated) while the swing
    // play-brief's portfolio-overlap check (fetchBangerOpenBookRows, filtered at the SQL level
    // BEFORE any limit) correctly saw a second, older OPEN CRWD position this route's `open` array
    // was dropping. Fetching open and closed as two separately-limited queries means the closed
    // backlog can never crowd a real open position out of the board.
    const [open, closed] = await Promise.all([
      fetchBangerOpenBookRows(80),
      fetchBangerClosedBoardRows(60),
    ]);
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
