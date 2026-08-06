import type { VectorOhlcBar } from "./vector-bar-timeframes";

/**
 * 4-hour candle view (CTO audit P2, 2026-08-05 — "4h remains open"). The header comment on
 * `vector-bar-timeframes.ts` explains why 4h isn't a simple aggregation preset alongside
 * 1/3/5/15/30/60: those are all roll-ups of a SINGLE session's 1m bars, and a single RTH
 * session (6.5h) bucketed to 4h collapses to 1-2 bars — useless. A real 4h VIEW needs
 * MULTIPLE DAYS of intraday bars aggregated into 4h buckets, which `/api/market/vector/4h-bars`
 * fetches (see that route for the multi-day minute-bar fetch); this module is the PURE bucketing
 * math, unit-testable without a network call, mirroring `vector-daily-bars.ts`'s
 * `aggregateDailyToWeekly` at a different granularity.
 *
 * Buckets are anchored to real ET CLOCK-HOUR boundaries (00:00/04:00/08:00/12:00/16:00/20:00 ET)
 * rather than to whenever the fetch happened to start, so the same wall-clock window buckets
 * together across different days/tickers/fetches — a chart comparing Monday's 08:00-12:00 ET
 * candle to Tuesday's 08:00-12:00 ET candle is comparing the same real trading window both times.
 */

const ET_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** ET wall-clock hour/minute/second for an epoch-seconds instant. */
function etHms(epochSec: number): { hour: number; minute: number; second: number } {
  const parts = ET_TIME_FORMATTER.formatToParts(new Date(epochSec * 1000));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { hour: get("hour"), minute: get("minute"), second: get("second") };
}

/**
 * Epoch-seconds start of the real ET 4h clock bucket (00/04/08/12/16/20) an instant falls in.
 * Subtracting the ET wall-clock offset-into-bucket directly from the instant is valid across a
 * DST transition too — the offset is read fresh from the bar's OWN instant (which `Intl`
 * already resolves against the correct ET offset for that date), not assumed from a fixed UTC
 * delta — and Vector's intraday data never spans the 2am ET changeover window anyway.
 */
function et4hBucketStart(epochSec: number): number {
  const { hour, minute, second } = etHms(epochSec);
  const offsetIntoBucket = (hour % 4) * 3600 + minute * 60 + second;
  return epochSec - offsetIntoBucket;
}

/**
 * Bucket ascending intraday minute bars (potentially spanning many trading days) into
 * ET-anchored 4-hour candles (TradingView-style: first bar's open, last bar's close, max high,
 * min low, summed volume). Mirrors `aggregateVectorBars`'s reduce shape but keyed by a real ET
 * clock-hour boundary instead of a fixed offset from the first bar in the series, since a
 * first-bar-relative offset would drift depending on wherever the multi-day fetch happened to
 * start (today vs. 12 trading days ago) instead of landing on the same wall-clock windows every
 * day.
 */
export function aggregateMinuteTo4h<T extends VectorOhlcBar>(bars: readonly T[]): T[] {
  if (!bars.length) return [];
  const map = new Map<number, T>();
  for (const bar of bars) {
    const key = et4hBucketStart(bar.time);
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
