/**
 * Night Hawk Legacy Signal Intelligence — R-multiple normalization (operator priority #4:
 * "Start collecting MFE, MAE, realized R, hypothetical R, and outcome for every candidate").
 *
 * Pure derivation, no new DB schema/writes of its own: `nighthawk_candidate_snapshot`'s
 * `forward_returns` (candidate-forward-grade.ts, session-wide, shared byte-identically across
 * every stage row for a ticker/session) already carries the raw %-move horizons plus MFE/MAE
 * (session_high_pct/session_low_pct). `buildRankFinalSnapshotRows`/`buildStageRejectionSnapshotRows`
 * (edition-builder.ts, schema v2) now also stamp the row's own PARSED trade-geometry levels
 * (entry_range_low/high, target, stop — parsePlayLevels, the exact same parser publish-time
 * gating and grading already use) into `snapshot_json.levels`. This module combines the two into
 * R-multiples for any row that has both — never a second DB write, always computed at read time.
 *
 * WHY R AND NOT JUST %: a 3% favorable move means something very different on a play risking 1%
 * to its stop (3R, a big win) than one risking 6% (0.5R, still underwater relative to plan).
 * Aggregating raw % returns across plays with different risk sizes mixes incomparable units — R
 * is the standard normalization, and it is what makes cross-play/cross-archetype expectancy
 * comparisons meaningful (the operator's explicit "optimize for expectancy... not win rate
 * alone", not just a superficial rebrand of the existing %-move numbers).
 *
 * ENTRY CONVENTION — deliberately NOT the same "entry" as forward_returns: `entry_price` here is
 * the PLAY's own intended fill edge (LONG fills at the entry band's TOP, SHORT at its BOTTOM —
 * the same convention entry-range.ts/debrief.ts's `fillEdgeOf` already uses platform-wide), i.e.
 * "what the plan assumed the member would pay." `forward_returns.entry_price` is the session's
 * own opening print, i.e. "what the tape actually opened at" — a DIFFERENT, also legitimate,
 * anchor. This module is explicit about which one R is computed against: risk_per_share is
 * |fill_edge − stop|, and every horizon/MFE/MAE price is reconstructed by applying
 * forward_returns' own %-move (the only real intraday price ladder available) to the SESSION's
 * entry_price, then converted to R relative to the PLAY's fill edge and stop. This mirrors how a
 * live member actually experiences the trade: the tape moves from its own open, but P&L is
 * measured from where the plan said to get in.
 *
 * NEVER FABRICATES: a row with no direction, no parseable entry+stop, or an inverted/zero risk
 * distance (entry == stop, or the "stop" is on the wrong side of entry) returns risk_per_share
 * null and every R field null — the caller is trusted to have flagged/rejected such a play
 * elsewhere (the geometry gate); this module does not re-derive that judgment, it just refuses to
 * divide by a distance that isn't real.
 */

import type { CandidateForwardReturns, ForwardHorizonKey } from "./candidate-forward-grade";
import type { ParsedPlayLevels } from "./play-levels";

export type CandidateDirection = "LONG" | "SHORT";

export type CandidateRMultiples = {
  schema_version: 1;
  direction: CandidateDirection;
  /** The PLAY's own intended fill edge — NOT forward_returns' session-open anchor (see header). */
  entry_price: number | null;
  stop_price: number | null;
  /** |entry_price - stop_price|. Null (and every R field below null) when not a real risk distance. */
  risk_per_share: number | null;
  /** R at each forward horizon, direction-signed (positive = favorable), reconstructed from
   *  forward_returns' own %-move applied to the session's entry — see header. */
  horizons_r: Record<ForwardHorizonKey, number | null>;
  /** Best-case R this session actually reached — the "hypothetical R" the operator asked for:
   *  LONG uses forward_returns.session_high_pct, SHORT uses session_low_pct (forward_returns'
   *  own direction convention, mirrored here). */
  mfe_r: number | null;
  /** Worst-case R this session actually reached — opposite side of mfe_r. */
  mae_r: number | null;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** LONG fills at the entry band's top, SHORT at its bottom — entry-range.ts/debrief.ts's
 *  existing `fillEdgeOf` convention, re-derived here since this module stays free of any
 *  NighthawkPlayOutcomeRow-shaped import (it only needs the raw parsed levels). */
function fillEdgeFor(direction: CandidateDirection, levels: ParsedPlayLevels): number | null {
  return direction === "SHORT" ? levels.entry_range_low : levels.entry_range_high;
}

function priceAtPct(sessionEntryPrice: number, pct: number): number {
  return sessionEntryPrice * (1 + pct / 100);
}

/** Direction-signed R: positive = favorable, negative = adverse. `risk` must already be a
 *  verified positive real distance — callers never pass an unchecked value. */
function rMultiple(direction: CandidateDirection, entry: number, risk: number, price: number): number {
  const favorable = direction === "LONG" ? price - entry : entry - price;
  return round2(favorable / risk);
}

const EMPTY_HORIZONS_R: Record<ForwardHorizonKey, number | null> = {
  m5: null,
  m15: null,
  m30: null,
  h1: null,
  eod: null,
};

/**
 * Combine one candidate_snapshot row's own parsed levels + direction with its ticker/session's
 * already-pinned forward_returns to produce R-multiples. Any missing/invalid input degrades to a
 * null-field result (or `null` outright when there's no direction at all) — never a guess.
 */
export function computeCandidateRMultiples(
  direction: CandidateDirection | null | undefined,
  levels: ParsedPlayLevels | null | undefined,
  forwardReturns: CandidateForwardReturns | null | undefined
): CandidateRMultiples | null {
  if (direction !== "LONG" && direction !== "SHORT") return null;
  if (!levels) return null;

  const entry = fillEdgeFor(direction, levels);
  const stop = levels.stop;
  const rawRisk = entry != null && stop != null ? (direction === "LONG" ? entry - stop : stop - entry) : null;
  const riskPerShare = rawRisk != null && Number.isFinite(rawRisk) && rawRisk > 0 ? round2(rawRisk) : null;

  const base: CandidateRMultiples = {
    schema_version: 1,
    direction,
    entry_price: entry,
    stop_price: stop,
    risk_per_share: riskPerShare,
    horizons_r: EMPTY_HORIZONS_R,
    mfe_r: null,
    mae_r: null,
  };

  if (riskPerShare == null || entry == null) return base;
  if (!forwardReturns || forwardReturns.entry_price == null) return base;

  const sessionEntry = forwardReturns.entry_price;
  const horizons_r: Record<ForwardHorizonKey, number | null> = { ...EMPTY_HORIZONS_R };
  for (const key of Object.keys(forwardReturns.horizons) as ForwardHorizonKey[]) {
    const pct = forwardReturns.horizons[key];
    horizons_r[key] = pct != null ? rMultiple(direction, entry, riskPerShare, priceAtPct(sessionEntry, pct)) : null;
  }

  // MFE/MAE — forward_returns' own header doc: session_high_pct is LONG-favorable/SHORT-adverse,
  // session_low_pct is the reverse. Mirror that here rather than re-deriving it.
  const favorablePct = direction === "LONG" ? forwardReturns.session_high_pct : forwardReturns.session_low_pct;
  const adversePct = direction === "LONG" ? forwardReturns.session_low_pct : forwardReturns.session_high_pct;
  const mfe_r = favorablePct != null ? rMultiple(direction, entry, riskPerShare, priceAtPct(sessionEntry, favorablePct)) : null;
  const mae_r = adversePct != null ? rMultiple(direction, entry, riskPerShare, priceAtPct(sessionEntry, adversePct)) : null;

  return { ...base, horizons_r, mfe_r, mae_r };
}
