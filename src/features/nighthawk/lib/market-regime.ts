/**
 * Night Hawk Legacy Signal Intelligence, Phase 2A part 2 — coarse market-regime tag captured
 * once per edition build and stamped onto every `nighthawk_candidate_snapshot` row (Phase 1's
 * per-candidate capture), so Phase 2C's segmentation work ("do not mix every market environment
 * together" — the operator's own words) can split performance by regime without reconstructing
 * it after the fact from raw bars.
 *
 * COARSE V1 ON PURPOSE, same posture as `regimeFromSpyTrend`'s own header comment
 * (src/lib/swing/swing-ingest.ts): this is a starting point for segmentation, not a calibrated
 * decision boundary — it gates nothing and blocks nothing. The trend/volatility bands below
 * (±0.5% SMA20 distance, VIX 15/25) are common, widely-used heuristics, not backtested
 * thresholds; treat any conclusion drawn FROM a regime bucket with the same small-sample caution
 * every other segmentation in this codebase already applies, and revisit the bands themselves
 * once real segmented outcome data exists to check them against.
 *
 * ZERO NEW I/O: every input (`spx_bars`, `vix_bars`, `spx_gap`, `macro_events`) is already
 * fetched once per edition build as part of `MarketWideContext` — this module only classifies
 * data the pipeline already has in hand.
 *
 * NULL-HONEST: a component reads null when there isn't enough history to classify it (e.g. fewer
 * than 20 SPX daily bars for the SMA20 trend read), never a fabricated default.
 */

import { smaFromCloses } from "@/lib/providers/ma-math";
import type { MarketWideContext } from "./market-wide";
import type { SpxGapContext } from "./spx-gap";

export type MarketRegimeTrend = "up" | "down" | "neutral";
export type MarketRegimeVolatility = "low" | "normal" | "high";

export type MarketRegimeTag = {
  schema_version: 1;
  /** SPX close vs its own 20-session SMA, banded so noise near the line doesn't flip-flop. */
  trend: MarketRegimeTrend | null;
  spx_close: number | null;
  spx_sma20: number | null;
  /** VIX close bucketed into common low/normal/high bands (see header — not backtested). */
  volatility: MarketRegimeVolatility | null;
  vix_close: number | null;
  /** Today's SPX gap-open pattern, straight from the already-computed SpxGapContext. */
  gap_pattern: SpxGapContext["pattern"] | null;
  gap_pct: number | null;
  /** True when at least one macro event (FOMC/CPI/etc.) is on today's calendar. */
  event_day: boolean;
};

/** ±0.5% band around SMA20: inside it reads "neutral" rather than letting sub-noise moves flip
 *  the trend label back and forth session to session. */
const TREND_BAND_PCT = 0.5;
const TREND_SMA_WINDOW = 20;

/** Common VIX regime bands (not backtested — see header). */
const VIX_LOW = 15;
const VIX_HIGH = 25;

function lastFiniteClose(bars: MarketWideContext["spx_bars"]): number | null {
  for (let i = bars.length - 1; i >= 0; i--) {
    const c = bars[i]!.c;
    if (Number.isFinite(c) && c > 0) return c;
  }
  return null;
}

export function classifyMarketRegime(input: {
  spx_bars: MarketWideContext["spx_bars"];
  vix_bars: MarketWideContext["vix_bars"];
  spx_gap: SpxGapContext | null;
  macro_events: Record<string, unknown>[];
}): MarketRegimeTag {
  const spxCloses = input.spx_bars.map((b) => b.c).filter((c) => Number.isFinite(c) && c > 0);
  const spxClose = lastFiniteClose(input.spx_bars);
  const spxSma20 = smaFromCloses(spxCloses, TREND_SMA_WINDOW);

  let trend: MarketRegimeTrend | null = null;
  if (spxClose != null && spxSma20 != null && spxSma20 > 0) {
    const distPct = ((spxClose - spxSma20) / spxSma20) * 100;
    trend = distPct > TREND_BAND_PCT ? "up" : distPct < -TREND_BAND_PCT ? "down" : "neutral";
  }

  const vixClose = lastFiniteClose(input.vix_bars);
  const volatility: MarketRegimeVolatility | null =
    vixClose == null ? null : vixClose < VIX_LOW ? "low" : vixClose > VIX_HIGH ? "high" : "normal";

  return {
    schema_version: 1,
    trend,
    spx_close: spxClose,
    spx_sma20: spxSma20,
    volatility,
    vix_close: vixClose,
    gap_pattern: input.spx_gap?.pattern ?? null,
    gap_pct: input.spx_gap?.gap_pct ?? null,
    event_day: input.macro_events.length > 0,
  };
}
