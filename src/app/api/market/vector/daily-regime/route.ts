import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { loadSessionWallTail } from "@/features/vector/lib/vector-wall-persist";
import { reduceSessionToDaily, coverage, type DailyRegimeRow } from "@/features/vector/lib/vector-daily-regime";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";

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

  /**
   * CACHE FIRST. This is a derived aggregate that changes at most once per session but costs a
   * full rail read per day to compute — see the walk below. Measured live 2026-08-09:
   * SPX `days=15` took **30.2s cold / 6.5s warm** for a 1.3 KB response, while NVDA and QQQ took
   * ~1.1s; even `days=1` took 5.1s. A 5-minute entry turns every request after the first into a
   * single Redis read, and 5 minutes is far shorter than the once-a-session cadence at which the
   * underlying answer can actually change.
   */
  const cacheKey = `vector:daily-regime:v1:${ticker}:${days}`;
  const cached = await sharedCacheGet<unknown>(cacheKey);
  if (cached) return NextResponse.json(cached, { headers: NO_STORE_HEADERS });

  // Walk back calendar days and keep whatever sessions actually recorded. Weekends and holidays
  // simply return nothing rather than needing a market-calendar dependency here — an absent
  // session and a closed one are the same thing to this overlay.
  //
  // IN CHUNKS, AND IT STOPS. The original issued `days + 10` reads in ONE Promise.all — so
  // `days=1` still pulled 11 whole session rails, and `days=15` pulled 25, no matter how few were
  // needed. Each read is an entire session's wall history (~5,760 samples at the SPX oracle's 5s
  // cadence, ~2.5 KB of ladder each) loaded to extract exactly ONE sample. Chunking lets the walk
  // stop as soon as `days` sessions have actually been found, which on a normal weekday is the
  // first chunk or two. The +10 slack still exists — it just isn't paid up front every time.
  const CHUNK = 5;
  const today = new Date();
  // Passed into every tail read so "is this session settled?" is decided once, from one clock.
  const todayYmd = today.toISOString().slice(0, 10);
  const rows: DailyRegimeRow[] = [];
  for (let start = 0; start < days + 10 && rows.length < days; start += CHUNK) {
    const batch: string[] = [];
    for (let i = start; i < Math.min(start + CHUNK, days + 10); i++) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
      batch.push(d.toISOString().slice(0, 10));
    }
    const settled = await Promise.all(
      batch.map(async (ymd) => {
        try {
          // TAIL, not the whole rail. `reduceSessionToDaily` keeps the session's LAST reading, so
          // one sample is all this needs — and for a settled session `loadSessionWallTail` answers
          // it with a single indexed row instead of loading ~5,760 samples to throw all but one
          // away. Today's session still takes the full read (the mirror lags the live recorder);
          // see loadSessionWallTail for why that exception is required rather than tidy.
          const samples = await loadSessionWallTail(ymd, ticker, "all", 1, todayYmd);
          return reduceSessionToDaily(ymd, samples);
        } catch {
          // One unreadable session must not blank the whole overlay — the rest is still true.
          return null;
        }
      })
    );
    for (const r of settled) if (r != null) rows.push(r);
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));

  const payload = roundFloats({
    ticker,
    rows: rows.slice(-days),
    coverage: coverage(rows.slice(-days)),
    // Stated explicitly so a client can never present this as long-range history.
    retentionNote: "Dealer-regime history is recorded per session and retained ~15 days.",
  });
  // Best-effort: a cache write failure must not fail a request whose answer is already computed.
  await sharedCacheSet(cacheKey, payload, 300).catch(() => {});

  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}
