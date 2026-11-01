// EARLY-ENTRY pressure detection (operator directive, 2026-10-25, 2nd iteration — supersedes the
// plain momentum+RVOL detection gate momentum-signal.ts used for the sub-$1.00 "runner" framing).
//
// OPERATOR'S OWN WORDS: "My goal for NIGHTHAWK is to catch the setup BEFORE the major move...
// Detect developing pressure: price compression, rising relative volume, directional order flow,
// and repeated tests of meaningful levels. Distinguish early preparation from an already extended
// move."
//
// WHAT "DEVELOPING" MEANS HERE, CONCRETELY: price has been testing the SAME extreme (a swing
// high for a long setup, a swing low for a short one) repeatedly WITHOUT closing through it, while
// its own trading range tightens (compression) and relative volume climbs — the classic
// pre-breakout coil, not a move that has already run. This module only describes that coil; it
// does NOT decide whether a breakout has actually triggered (early-entry-state.ts owns that
// WATCH -> ENTRY transition) and does NOT judge whether a contract still has room to run after a
// breakout (early-entry-contract-select.ts's "already extended" rejection owns that).
//
// DIRECTIONAL ORDER FLOW: this module has no options-flow input (same scope as
// momentum-signal.ts) — "directional order flow" here means the underlying's own tape leaning
// one way (more/stronger up bars than down bars within the compression window), a real, cheap
// proxy computable from bars alone. A caller with a real options-flow read (aggression/dominance)
// may fold that in as additional corroboration elsewhere; this module never claims to BE that.
//
// LEVEL CHOICE: the level under test is the extreme (highest high for "long", lowest low for
// "short") over `levelLookbackMin` minutes IMMEDIATELY BEFORE the compression window — i.e. "the
// level this consolidation is coiling under/above," not an arbitrary round number or a multi-day
// level this module has no data to compute honestly.

export type PressureBar = { t: number; h: number; l: number; c: number; v?: number };

export type PressureRead = {
  /** True only when compression + RVOL + repeated level tests ALL independently confirm — the
   *  same "no single signal is enough" discipline momentum-signal.ts's own detection gate used. */
  developing: boolean;
  compression: {
    recent_range_pct: number;
    baseline_range_pct: number;
    ratio: number | null;
    compressed: boolean;
  } | null;
  rvol_ratio: number | null;
  rvol_confirmed: boolean;
  /** The level being tested (a swing high for "long", a swing low for "short"). Null when there
   *  aren't enough lookback bars to establish one. */
  level: number | null;
  /** How many times price touched within tolerance of `level` in the compression window without
   *  closing through it. */
  level_tests: number;
  /** Last close's distance to `level`, % (signed: positive means still below a long-setup level
   *  / above a short-setup level — i.e. still on the "testing" side). Null without a level. */
  distance_to_level_pct: number | null;
  /** Share of up-bars minus down-bars (by close-over-close) in the compression window, in
   *  [-1, 1] — the directional-order-flow proxy. Positive leans up, negative leans down. */
  order_flow_bias: number | null;
};

const DEFAULT_COMPRESSION_WINDOW_MIN = 15;
const DEFAULT_LEVEL_LOOKBACK_MIN = 60;
/** Recent range (as % of price) must shrink to at most this fraction of the baseline range to
 *  count as "compressed" — a real tightening, not noise. */
const DEFAULT_COMPRESSION_MAX_RATIO = 0.6;
/** AND the recent range itself must be tight in absolute terms, regardless of how wide the
 *  baseline was — otherwise "compressed relative to an already-chaotic baseline" could still be a
 *  wide, tradeable range. */
const DEFAULT_COMPRESSION_MAX_ABS_PCT = 1.5;
/** How close (as % of the level) a touch must come to count as "testing" it. */
const DEFAULT_LEVEL_TEST_TOLERANCE_PCT = 0.15;
const DEFAULT_MIN_LEVEL_TESTS = 2;

function sorted(bars: PressureBar[]): PressureBar[] {
  return [...bars].filter((b) => Number.isFinite(b.t)).sort((a, b) => a.t - b.t);
}

function rangePct(bars: PressureBar[]): number | null {
  if (bars.length === 0) return null;
  const highs = bars.map((b) => b.h);
  const lows = bars.map((b) => b.l);
  const hi = Math.max(...highs);
  const lo = Math.min(...lows);
  const avgPrice = bars.reduce((s, b) => s + b.c, 0) / bars.length;
  if (!(avgPrice > 0)) return null;
  return ((hi - lo) / avgPrice) * 100;
}

/**
 * Pure. Evaluates whether `bars` (today's bars up to "now", any order, no look-ahead by
 * construction — the caller never passes a bar from the future) show a developing, pre-breakout
 * coil in `direction`. Returns honest nulls — never a guess — when there aren't enough bars to
 * form both the lookback and compression windows.
 */
export function detectDevelopingPressure(input: {
  bars: PressureBar[];
  direction: "long" | "short";
  rvolRatio: number | null;
  rvolFloor?: number;
  compressionWindowMin?: number;
  levelLookbackMin?: number;
  compressionMaxRatio?: number;
  compressionMaxAbsPct?: number;
  levelTestTolerancePct?: number;
  minLevelTests?: number;
}): PressureRead {
  const compressionWindowMin = input.compressionWindowMin ?? DEFAULT_COMPRESSION_WINDOW_MIN;
  const levelLookbackMin = input.levelLookbackMin ?? DEFAULT_LEVEL_LOOKBACK_MIN;
  const compressionMaxRatio = input.compressionMaxRatio ?? DEFAULT_COMPRESSION_MAX_RATIO;
  const compressionMaxAbsPct = input.compressionMaxAbsPct ?? DEFAULT_COMPRESSION_MAX_ABS_PCT;
  const tolerancePct = input.levelTestTolerancePct ?? DEFAULT_LEVEL_TEST_TOLERANCE_PCT;
  const minLevelTests = input.minLevelTests ?? DEFAULT_MIN_LEVEL_TESTS;
  const rvolFloor = input.rvolFloor ?? 1.5;

  const bars = sorted(input.bars);
  const needed = compressionWindowMin + levelLookbackMin;
  if (bars.length < needed) {
    return {
      developing: false,
      compression: null,
      rvol_ratio: input.rvolRatio,
      rvol_confirmed: false,
      level: null,
      level_tests: 0,
      distance_to_level_pct: null,
      order_flow_bias: null,
    };
  }

  const compressionBars = bars.slice(bars.length - compressionWindowMin);
  const lookbackBars = bars.slice(bars.length - needed, bars.length - compressionWindowMin);

  const recentRangePct = rangePct(compressionBars);
  const baselineRangePct = rangePct(lookbackBars);
  let compression: PressureRead["compression"] = null;
  if (recentRangePct != null && baselineRangePct != null) {
    // A zero (or near-zero) baseline range means no real prior swing ever existed to compress
    // FROM — perfectly flat/dead data must never read as "coiling under a tested level" just
    // because its own tiny range also clears the absolute ceiling. Compression requires a REAL
    // baseline range to shrink relative to.
    const ratio = baselineRangePct > 0 ? recentRangePct / baselineRangePct : null;
    const compressed =
      baselineRangePct > 0 && recentRangePct <= compressionMaxAbsPct && ratio! <= compressionMaxRatio;
    compression = {
      recent_range_pct: Math.round(recentRangePct * 10000) / 10000,
      baseline_range_pct: Math.round(baselineRangePct * 10000) / 10000,
      ratio: ratio != null ? Math.round(ratio * 10000) / 10000 : null,
      compressed,
    };
  }

  const level = input.direction === "long"
    ? Math.max(...lookbackBars.map((b) => b.h))
    : Math.min(...lookbackBars.map((b) => b.l));

  let levelTests = 0;
  for (const b of compressionBars) {
    if (input.direction === "long") {
      const touched = b.h >= level * (1 - tolerancePct / 100);
      const closedThrough = b.c > level;
      if (touched && !closedThrough) levelTests++;
    } else {
      const touched = b.l <= level * (1 + tolerancePct / 100);
      const closedThrough = b.c < level;
      if (touched && !closedThrough) levelTests++;
    }
  }

  const last = compressionBars[compressionBars.length - 1]!.c;
  const distanceToLevelPct = level > 0
    ? Math.round(((input.direction === "long" ? level - last : last - level) / level) * 10000) / 100
    : null;

  let upBars = 0, downBars = 0;
  for (let i = 1; i < compressionBars.length; i++) {
    if (compressionBars[i]!.c > compressionBars[i - 1]!.c) upBars++;
    else if (compressionBars[i]!.c < compressionBars[i - 1]!.c) downBars++;
  }
  const totalMoves = upBars + downBars;
  const orderFlowBias = totalMoves > 0 ? Math.round(((upBars - downBars) / totalMoves) * 10000) / 10000 : null;

  const rvolConfirmed = input.rvolRatio != null && input.rvolRatio >= rvolFloor;
  const developing = (compression?.compressed ?? false) && rvolConfirmed && levelTests >= minLevelTests;

  return {
    developing,
    compression,
    rvol_ratio: input.rvolRatio,
    rvol_confirmed: rvolConfirmed,
    level: Math.round(level * 100) / 100,
    level_tests: levelTests,
    distance_to_level_pct: distanceToLevelPct,
    order_flow_bias: orderFlowBias,
  };
}
