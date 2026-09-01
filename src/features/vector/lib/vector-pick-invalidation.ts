/**
 * Bar-close helpers for Vector pick invalidation — "5m close > X" must use the last CLOSED
 * bar's close, not the live tick (measured 2026-09-01: 119 false setup_invalidated closures).
 */
import type { UTCTimestamp } from "lightweight-charts";

export type InvalidationBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/** Parse the bar timeframe from an invalidation string, e.g. "5m close > 325" → 5. */
export function parseInvalidationTimeframeMinutes(invalidation: string | null | undefined): number | null {
  if (!invalidation) return null;
  const m = invalidation.match(/(\d+)\s*m\b/i);
  if (m) {
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const h = invalidation.match(/(\d+)\s*h\b/i);
  if (h) {
    const n = Number(h[1]);
    return Number.isFinite(n) && n > 0 ? n * 60 : null;
  }
  return null;
}

/**
 * Close of the last fully closed `timeframeMin` bar from 1m seed bars.
 * Returns null when bars are empty or the bucket has no data.
 */
export function lastClosedTimeframeBarClose(
  bars: readonly InvalidationBar[],
  timeframeMin: number,
  nowMs: number
): number | null {
  if (!bars.length || !(timeframeMin > 0)) return null;
  const tfSec = timeframeMin * 60;
  const nowSec = Math.floor(nowMs / 1000);
  const currentBucketStart = Math.floor(nowSec / tfSec) * tfSec;
  const bucketStart = currentBucketStart - tfSec;
  const bucketEnd = currentBucketStart;

  let close: number | null = null;
  for (const b of bars) {
    const t = b.time;
    if (t >= bucketStart && t < bucketEnd) {
      close = b.close;
    }
    if (t >= bucketEnd) break;
  }
  return close;
}

/** Prefer bar close for timeframe-tagged invalidation rules; else live spot. */
export function resolveInvalidationSpot(input: {
  liveSpot: number;
  invalidation: string | null | undefined;
  bars?: readonly InvalidationBar[];
  nowMs?: number;
}): number {
  const tf = parseInvalidationTimeframeMinutes(input.invalidation);
  if (tf == null || !input.bars?.length) return input.liveSpot;
  const barClose = lastClosedTimeframeBarClose(input.bars, tf, input.nowMs ?? Date.now());
  return barClose ?? input.liveSpot;
}

/** Normalize VectorSeedBar time field to unix seconds. */
export function invalidationBarsFromSeed(
  bars: readonly { time: UTCTimestamp; open: number; high: number; low: number; close: number }[]
): InvalidationBar[] {
  return bars.map((b) => ({
    time: typeof b.time === "number" ? b.time : Number(b.time),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
  }));
}
