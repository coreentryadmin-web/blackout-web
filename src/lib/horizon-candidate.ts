/**
 * Night Hawk — the candidate builder (remodel slice 5b): the glue between raw provider signals and the
 * play producer.
 *
 * horizon-scorers.ts defines the three lenses; horizon-plays.ts fans a candidate across the three DTE
 * windows and reads `horizonScores` to COMMIT/WATCH. This module is what connects them: given one name's
 * RAW signals (flow read, gamma, multi-day returns, EMA stack, chain depth, catalyst), it runs each lens
 * through the grounded normalizers and emits a HorizonCandidate with a per-lane score attached — ready to
 * drop straight into produceHorizonPlays.
 *
 * Calibration-first honesty: a lane's score is set ONLY when that lane's PRIMARY signal is actually
 * present. A name with live flow but no multi-day history gets a ZERO_DTE score and NO Swing/LEAPS score —
 * so it's evaluated for 0DTE and simply absent from the other lanes, rather than emitting a fabricated
 * 0-score WATCH play off signals we never had. (scoreForHorizon in horizon-plays.ts treats an omitted lane
 * as "not evaluated here.")
 *
 * PURE & deterministic — no IO. The live route/discovery fetches the raw signals; this shapes them.
 */

import type { Horizon } from "./horizons";
import type { HorizonCandidate } from "./horizon-plays";
import type { PlayDirection } from "./horizon-fanout";
import {
  scoreZeroDte,
  scoreSwing,
  scoreLeaps,
  momentumFromReturnPct,
  accumulationPersistence,
  trendStackScore,
  trendDurabilityScore,
  relativeStrengthScore,
  liquidityDepthScore,
  type HorizonScore,
} from "./horizon-scorers";

/**
 * Every raw signal the three lenses need for one name. All lane-specific fields are optional: a lane whose
 * PRIMARY signal is absent is simply not scored (see module header). The caller fills whatever its providers
 * returned — flow-quality/GEX for 0DTE, multi-day flow + bars for Swing, daily bars/EMAs + chain for LEAPS.
 */
export interface RawHorizonSignals {
  ticker: string;
  direction: PlayDirection;
  asOfYmd: string;
  chainRows: HorizonCandidate["chainRows"];

  // ── ZERO_DTE (primary: flowQuality) ──
  /** 0–100 from computeFlowQuality — the same-day primary trigger. */
  flowQuality?: number | null;
  gammaPull?: number | null;
  sweepShare?: number | null;
  intradayAlign?: number | null;

  // ── SWING (primary: a multi-day return OR accumulation read) ──
  returnPct10d?: number | null;
  accumAlignedDays?: number | null;
  accumTotalDays?: number | null;
  priceAboveEma20?: boolean;
  ema20AboveEma50?: boolean;
  ema50Rising?: boolean;
  spyReturnPct10d?: number | null;

  // ── LEAPS (primary: a long-trend structure read) ──
  priceAboveEma200?: boolean;
  ema200Rising?: boolean;
  higherLows?: boolean;
  /** Long-trend structure known at all? When false the LEAPS lane isn't scored (no structure read). */
  hasLongTrendRead?: boolean;
  returnPct63d?: number | null;
  spyReturnPct63d?: number | null;
  leapsStrikeOi?: number | null;
  leapsStrikeVol?: number | null;
  catalyst?: number | null;
}

/** A candidate with its per-lane score objects kept alongside (the reasons/components feed the desk UI). */
export interface ScoredHorizonCandidate extends HorizonCandidate {
  /** The full HorizonScore per lane that was actually evaluated (omitted lanes absent). */
  laneScores: Partial<Record<Horizon, HorizonScore>>;
}

const has = (n: number | null | undefined): boolean => n != null && Number.isFinite(n);

/**
 * Build one scored candidate from raw signals. Each lane is scored only when its primary signal exists, so
 * `horizonScores` carries a lane iff we actually had a read for it — a name absent from a lane's map is
 * skipped by produceHorizonPlays rather than emitted as a hollow 0.
 */
export function buildHorizonCandidate(raw: RawHorizonSignals): ScoredHorizonCandidate {
  const horizonScores: Partial<Record<Horizon, number>> = {};
  const laneScores: Partial<Record<Horizon, HorizonScore>> = {};

  // ZERO_DTE — primary signal is the flow-quality read.
  if (has(raw.flowQuality)) {
    const s = scoreZeroDte({
      flowQuality: raw.flowQuality ?? null,
      gammaPull: raw.gammaPull,
      sweepUrgency: raw.sweepShare,
      intradayAlign: raw.intradayAlign,
    });
    horizonScores.ZERO_DTE = s.score;
    laneScores.ZERO_DTE = s;
  }

  // SWING — primary signal is a multi-day move OR a cross-session accumulation read.
  const hasSwingPrimary = has(raw.returnPct10d) || (has(raw.accumAlignedDays) && has(raw.accumTotalDays));
  if (hasSwingPrimary) {
    const s = scoreSwing({
      momentum: momentumFromReturnPct(raw.returnPct10d),
      accumulation: accumulationPersistence(raw.accumAlignedDays, raw.accumTotalDays),
      trendStack: trendStackScore({
        priceAboveEma20: raw.priceAboveEma20,
        ema20AboveEma50: raw.ema20AboveEma50,
        ema50Rising: raw.ema50Rising,
      }),
      relStrength: relativeStrengthScore(raw.returnPct10d, raw.spyReturnPct10d),
    });
    horizonScores.SWING = s.score;
    laneScores.SWING = s;
  }

  // LEAPS — primary signal is a long-trend structure read (we must know the multi-month trend to hold weeks).
  if (raw.hasLongTrendRead) {
    const s = scoreLeaps({
      trendDurability: trendDurabilityScore({
        priceAboveEma200: raw.priceAboveEma200,
        ema200Rising: raw.ema200Rising,
        higherLows: raw.higherLows,
      }),
      relStrength: relativeStrengthScore(raw.returnPct63d, raw.spyReturnPct63d),
      liquidityDepth: liquidityDepthScore(raw.leapsStrikeOi, raw.leapsStrikeVol),
      catalyst: raw.catalyst,
    });
    horizonScores.LEAPS = s.score;
    laneScores.LEAPS = s;
  }

  return {
    ticker: raw.ticker,
    direction: raw.direction,
    asOfYmd: raw.asOfYmd,
    chainRows: raw.chainRows,
    horizonScores,
    laneScores,
  };
}

/** Convenience: build scored candidates for a whole discovery pool in one pass. */
export function buildHorizonCandidates(raws: RawHorizonSignals[]): ScoredHorizonCandidate[] {
  return raws.map(buildHorizonCandidate);
}
