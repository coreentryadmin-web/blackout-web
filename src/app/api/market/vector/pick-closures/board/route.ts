import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { fetchVectorPickClosureRows } from "@/lib/vector/vector-pick-closures-db";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { etSessionDate, etStamp } from "@/lib/largo/temporal/bar-session-date";

export const dynamic = "force-dynamic";

function toBoardRow(row: Awaited<ReturnType<typeof fetchVectorPickClosureRows>>[number]) {
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

/** Night Hawk Vector tab — read-only log of closed (Don't buy) Vector contract picks. */
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
    const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "300");
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.round(limitRaw))) : 300;
    const sessionDateRaw = req.nextUrl.searchParams.get("session_date")?.trim() ?? "";
    const sessionDate = /^\d{4}-\d{2}-\d{2}$/.test(sessionDateRaw) ? sessionDateRaw : null;
    const rows = await fetchVectorPickClosureRows(limit, sessionDate);
    const nowMs = Date.now();
    return NextResponse.json(
      roundFloats({
        available: true,
        as_of: etStamp(nowMs),
        session_date: etSessionDate(nowMs),
        note:
          "Closed Vector contract picks — first Don't buy per contract while the Vector desk live-evaluates picks. Premium % is vs pick entry mid, not a graded trade P&L.",
        coverage:
          "Logged when /vector (or any client) polls live pick quotes — not every ticker in the universe is evaluated unless the desk is open.",
        closed: rows.map(toBoardRow),
      }),
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[market/vector/pick-closures/board]", error);
    return NextResponse.json({ available: false, degraded: true }, { headers: NO_STORE_HEADERS });
  }
}
