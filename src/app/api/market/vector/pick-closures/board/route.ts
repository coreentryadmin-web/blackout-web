import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { fetchVectorPickClosureRows } from "@/lib/vector/vector-pick-closures-db";
import { fetchVectorPickLeaderRows } from "@/lib/vector/vector-pick-leaders-db";
import {
  isVectorPickWinner,
  leaderEligibleForBoard,
  sortLeadersForBoard,
} from "@/lib/vector/vector-pick-sweep-core";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { etSessionDate, etStamp } from "@/lib/largo/temporal/bar-session-date";

export const dynamic = "force-dynamic";

function toClosureRow(row: Awaited<ReturnType<typeof fetchVectorPickClosureRows>>[number]) {
  return {
    id: row.id,
    ticker: row.ticker,
    session_date: row.session_date,
    contract: {
      occ: row.occ,
      side: row.side,
      strike: row.strike,
      expiry: row.expiry,
      label: row.label,
    },
    rank: row.rank,
    role: row.role,
    entry_mid: row.entry_mid,
    close_mid: row.close_mid,
    premium_pct_from_entry: row.premium_pct_from_entry,
    close_reason: row.close_reason,
    setup_invalidated: row.setup_invalidated,
    spot: row.spot,
    play: row.vector_play,
    pick_context: row.pick_context,
    closed_at: row.closed_at,
  };
}

function toLeaderRow(row: Awaited<ReturnType<typeof fetchVectorPickLeaderRows>>[number]) {
  const pickCtx = row.pick_context;
  const tierRaw = pickCtx && typeof pickCtx.tier === "string" ? pickCtx.tier : null;
  const tier = tierRaw === "elite" ? "elite" : "standard";
  return {
    id: row.id,
    ticker: row.ticker,
    session_date: row.session_date,
    contract: {
      occ: row.occ,
      side: row.side,
      strike: row.strike,
      expiry: row.expiry,
      label: row.label,
    },
    rank: row.rank,
    role: row.role,
    entry_mid: row.entry_mid,
    live_mid: row.live_mid,
    premium_pct_from_entry: row.premium_pct_from_entry,
    peak_premium_pct: row.peak_premium_pct,
    action_status: row.action_status,
    action_reason: row.action_reason,
    setup_invalidated: row.setup_invalidated,
    spot: row.spot,
    play: row.vector_play,
    pick_context: row.pick_context,
    tier,
    updated_at: row.updated_at,
    is_winner: isVectorPickWinner(row),
  };
}

/** Night Hawk Vector tab — live leaders (winners) + closed Don't buy picks. */
export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  if (authResult.via === "user") {
    const nighthawkDenied = await requireToolApi("nighthawk");
    if (nighthawkDenied) return nighthawkDenied;
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  try {
    const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "500");
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.round(limitRaw))) : 500;
    const sessionDateRaw = req.nextUrl.searchParams.get("session_date")?.trim() ?? "";
    const nowMs = Date.now();
    const todaySession = etSessionDate(nowMs);
    const sessionDate = /^\d{4}-\d{2}-\d{2}$/.test(sessionDateRaw) ? sessionDateRaw : todaySession;

    const [leaderRows, closedRows] = await Promise.all([
      fetchVectorPickLeaderRows({ sessionDate, limit }),
      fetchVectorPickClosureRows(limit, sessionDate),
    ]);

    const leadersAll = leaderRows.filter(leaderEligibleForBoard).map(toLeaderRow);
    const leaders = sortLeadersForBoard(leadersAll);
    const winners = leaders.filter((r) => r.is_winner);
    const closed = closedRows.map(toClosureRow);

    return NextResponse.json(
      roundFloats({
        available: true,
        as_of: etStamp(nowMs),
        session_date: sessionDate,
        note:
          "Premium % is option mid vs pick entry — not Night Hawk 0DTE trade P&L. Leaders refresh via vector-pick-sweep cron (~2 min RTH).",
        coverage: {
          leaders: leaders.length,
          winners: winners.length,
          closed: closed.length,
          note: "Universe sweep evaluates every Vector ticker — no /vector viewer required.",
        },
        leaders,
        winners,
        closed,
      }),
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[market/vector/pick-closures/board]", error);
    return NextResponse.json({ available: false, degraded: true }, { headers: NO_STORE_HEADERS });
  }
}
