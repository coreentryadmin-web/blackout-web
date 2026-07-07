import { todayEtYmd } from "@/lib/providers/spx-session";
import type { UTCTimestamp } from "lightweight-charts";

export type RawAggBar = { t?: unknown; o: number; h: number; l: number; c: number };
export type VectorInitialBar = { time: UTCTimestamp; open: number; high: number; low: number; close: number };

export function toVectorBars(bars: RawAggBar[]): VectorInitialBar[] {
  return bars
    .filter((b) => typeof b.t === "number" && b.o > 0)
    .map((b) => ({
      time: Math.floor((b.t as number) / 1000) as UTCTimestamp,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    }));
}

/**
 * Today's ET session has no bars at all for a large chunk of every calendar day — anytime
 * before ~4am ET premarket — and /vector is reachable 24/7. Falling through to an empty
 * `initialBars` renders a totally void canvas: no candles, no axes, no "market closed"
 * messaging (reported live as a blank chart with no explanation). If `todayBars` is empty,
 * fall back to `fallbackBars` (expected to be a multi-day lookback, e.g. `priorEtYmd(5)` to
 * `today`) filtered down to just its single latest ET calendar date, so the chart always shows
 * one coherent prior session instead of a multi-day smear.
 */
export function pickSessionBars(todayBars: RawAggBar[], fallbackBars: RawAggBar[]): VectorInitialBar[] {
  if (todayBars.length > 0) return toVectorBars(todayBars);
  if (fallbackBars.length === 0) return [];
  const lastBarMs = fallbackBars[fallbackBars.length - 1].t;
  if (typeof lastBarMs !== "number") return [];
  const lastSessionYmd = todayEtYmd(new Date(lastBarMs));
  return toVectorBars(fallbackBars.filter((b) => typeof b.t === "number" && todayEtYmd(new Date(b.t)) === lastSessionYmd));
}
