import type { VectorOhlcBar } from "./vector-bar-timeframes";

/**
 * Daily/weekly bar support for Vector's "Daily"/"Weekly" chart view (CTO audit P2 #5) — the
 * multi-day historical view the intraday 1m-seeded chart can't provide (see
 * `vector-bar-timeframes.ts`'s header comment on why 1D/1W aren't intraday presets). This module
 * is PURE (no fetch, no Date.now) so the weekly bucketing is unit-testable independent of the
 * `/api/market/vector/daily-bars` route that calls it.
 */

export type VectorDailyUnit = "1D" | "1W";

export const VECTOR_DAILY_UNITS: readonly VectorDailyUnit[] = ["1D", "1W"];

export function isVectorDailyUnit(v: unknown): v is VectorDailyUnit {
  return v === "1D" || v === "1W";
}

/** UTC day-of-week for an epoch-seconds daily bar time (Polygon daily bars stamp midnight UTC of
 *  the session date, so no ET conversion is needed here — unlike intraday bars). 0=Sun..6=Sat. */
function utcDow(epochSec: number): number {
  return new Date(epochSec * 1000).getUTCDay();
}

/** Monday-anchored week-start (UTC midnight) for an epoch-seconds daily bar time. Sunday (dow 0)
 *  belongs to the week that started the PRECEDING Monday (6 days back); every other day counts
 *  back (dow - 1) days to Monday. Trading days are Mon-Fri, so Sunday inputs are a defensive
 *  no-op in practice, not a real path. */
function weekStartSec(epochSec: number): number {
  const dow = utcDow(epochSec);
  const backDays = dow === 0 ? 6 : dow - 1;
  return epochSec - backDays * 86400;
}

/**
 * Bucket ascending daily bars into Monday-anchored weekly candles (TradingView-style: first
 * session's open, last session's close, max high, min low, summed volume). Mirrors
 * `aggregateVectorBars`'s reduce shape but keyed by calendar week instead of a fixed-minute
 * bucket, since trading weeks are irregular (holidays, half-weeks) in a way pure minute-bucketing
 * never has to handle.
 */
export function aggregateDailyToWeekly<T extends VectorOhlcBar>(bars: readonly T[]): T[] {
  if (!bars.length) return [];
  const map = new Map<number, T>();
  for (const bar of bars) {
    const key = weekStartSec(bar.time);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...bar, time: key } as T);
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      if (bar.volume != null && bar.volume > 0) {
        existing.volume = (existing.volume ?? 0) + bar.volume;
      }
    }
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}
