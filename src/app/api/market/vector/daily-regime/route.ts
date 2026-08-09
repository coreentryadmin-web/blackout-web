import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { loadSessionWallHistory } from "@/features/vector/lib/vector-wall-persist";
import { reduceSessionToDaily, coverage, type DailyRegimeRow } from "@/features/vector/lib/vector-daily-regime";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

/**
 * GET /api/market/vector/daily-regime?ticker=SPX&days=15
 *
 * End-of-session dealer gamma flip + primary call/put wall, one row per recorded session, for the
 * historical (1D/1W/4H) chart's regime overlay.
 *
 * DELIBERATELY SHORT-RANGE, AND IT SAYS SO. Wall history is recorded per session with roughly
 * 15-day retention (vector-wall-persist.ts: 72h Redis over a Postgres mirror sized for 15-day
 * replay). There is no multi-year series to serve, so this returns `coverage` alongside the rows
 * and the client states the window instead of drawing a short line across a long axis and letting
 * it imply history that was never recorded.
 *
 * `days` is clamped to [1, 30]: past retention the extra sessions are all empty, and each one is a
 * separate store read, so an unbounded value would just buy latency for nothing.
 */
const MAX_DAYS = 30;

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const ticker = normalizeVectorTicker(req.nextUrl.searchParams.get("ticker") ?? "SPX");
  const requested = Number(req.nextUrl.searchParams.get("days") ?? 15);
  const days = Math.min(MAX_DAYS, Math.max(1, Number.isFinite(requested) ? Math.trunc(requested) : 15));

  // Walk back calendar days and keep whatever sessions actually recorded. Weekends and holidays
  // simply return nothing rather than needing a market-calendar dependency here — an absent
  // session and a closed one are the same thing to this overlay.
  const today = new Date();
  const ymds: string[] = [];
  for (let i = 0; i < days + 10 && ymds.length < days + 10; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    ymds.push(d.toISOString().slice(0, 10));
  }

  const settled = await Promise.all(
    ymds.map(async (ymd) => {
      try {
        const samples = await loadSessionWallHistory(ymd, ticker, "all");
        return reduceSessionToDaily(ymd, samples);
      } catch {
        // One unreadable session must not blank the whole overlay — the rest is still true.
        return null;
      }
    })
  );

  const rows: DailyRegimeRow[] = settled.filter((r): r is DailyRegimeRow => r != null).sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json(
    roundFloats({
      ticker,
      rows,
      coverage: coverage(rows),
      // Stated explicitly so a client can never present this as long-range history.
      retentionNote: "Dealer-regime history is recorded per session and retained ~15 days.",
    }),
    { headers: NO_STORE_HEADERS }
  );
}
