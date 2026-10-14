/**
 * Night Hawk Legacy Signal Intelligence — morning command-center table (operator priority #14,
 * 2026-09-18 continuous-learning mandate: "a compact table (TICKER/DIRECTION/SCORE/ENTRY/STOP/
 * TARGETS/WHY NOW/INVALIDATION), not paragraphs, plus WATCHING/REJECTED/MARKET REGIME/SYSTEM
 * CONFIDENCE sections"). Phase 2F part 1 (#5200) shipped the OTHER output surface the operator
 * named (the automatic post-market learning report); this is the pre-market one, not yet started
 * per the journal's own `legacyContinuousLearningMandate_2026_09_18T0621Z` roadmap entry.
 *
 * SAFE HALF, same discipline as every prior Phase 2 sub-step (2A/2B/2D/2F each shipped their pure
 * compute primitive first, a route wiring it up later): PURE composition only, ZERO new I/O.
 * Every section reuses data a caller already fetches elsewhere today:
 *  - ACTIVE: today's published edition plays (`PlaybookPlay[]`) — these already carry ticker/
 *    direction/score/entry/stop/target, just not assembled into one compact row shape.
 *  - WATCHING / REJECTED: `candidate-leaderboard.ts`'s `CandidateLeaderboardEntry[]` (built from
 *    `nighthawk_candidate_snapshot` rows Phase 1 already captures) — WATCH/READY/TRIGGERED
 *    entries are "still in the funnel", REJECTED entries carry their own `rejection_reason`.
 *    ACTIVE-status leaderboard entries are excluded here to avoid double-listing a ticker that's
 *    already in the `active` section built from `plays`.
 *  - MARKET REGIME: the `market_regime` tag Phase 2A part 2 (#5177) already stamps onto every
 *    candidate_snapshot row at edition-build time — read it off today's rows, never recomputed.
 *  - SYSTEM CONFIDENCE: the by-conviction Wilson CI the public `/api/market/nighthawk/record`
 *    route already computes (`wilsonLowerBound`/`wilsonUpperBound` from `@/lib/swing/calibration`)
 *    — passed in by the caller, not reimplemented here.
 *
 * Wiring an admin route around this composer (fetching the four inputs above and calling this
 * function) is the next, separately-scoped step — not done in this PR.
 *
 * FIELD-MAPPING HONESTY: the operator's spec names "INVALIDATION" as its own column. `PlaybookPlay`
 * has no dedicated invalidation field — `risk_note` (the closest existing field, a cautionary
 * prose note already shown to members) is used as a best-available proxy and is `null` when the
 * play carries none, never fabricated. `key_signal` (the play's stated signal/catalyst) maps to
 * "WHY NOW".
 */

import type { PlaybookPlay } from "./types";
import type { CandidateLeaderboardEntry } from "./candidate-leaderboard";
import type { MarketRegimeTag } from "./market-regime";

export type CommandCenterActiveRow = {
  ticker: string;
  direction: string;
  score: number | null;
  entry: string;
  stop: string;
  targets: string;
  why_now: string;
  /** Best-available proxy — see the module header's FIELD-MAPPING HONESTY note. Null, never
   *  fabricated, when the play carries no risk_note. */
  invalidation: string | null;
};

export type CommandCenterWatchingRow = {
  ticker: string;
  /** Excludes "ACTIVE"/"REJECTED" by construction — see `buildCommandCenterTable`. */
  promotion_status: Exclude<CandidateLeaderboardEntry["promotion_status"], "ACTIVE" | "REJECTED">;
  rank_delta: number | null;
};

export type CommandCenterRejectedRow = {
  ticker: string;
  rejection_reason: string | null;
};

/** One row of the by-conviction win-rate breakdown the `/record` route already computes. Passed
 *  in by the caller — this module performs no Wilson-CI math of its own. */
export type ConvictionConfidenceRow = {
  conviction: string;
  n: number;
  win_rate_pct: number | null;
  win_rate_ci_low_pct: number | null;
  win_rate_ci_high_pct: number | null;
};

export type CommandCenterTable = {
  active: CommandCenterActiveRow[];
  watching: CommandCenterWatchingRow[];
  rejected: CommandCenterRejectedRow[];
  /** Null when the caller has no snapshot rows for today yet (e.g. pre-edition-build) — never a
   *  guessed regime. */
  market_regime: MarketRegimeTag | null;
  system_confidence: ConvictionConfidenceRow[];
};

function rejectionReasonFor(entry: CandidateLeaderboardEntry): string | null {
  const rejectedPoint = entry.trajectory.find((p) => p.stage === "rejected");
  return rejectedPoint?.rejection_reason ?? null;
}

export function buildCommandCenterTable(input: {
  plays: readonly PlaybookPlay[];
  leaderboard: readonly CandidateLeaderboardEntry[];
  marketRegime: MarketRegimeTag | null;
  confidence: readonly ConvictionConfidenceRow[];
}): CommandCenterTable {
  const active: CommandCenterActiveRow[] = input.plays.map((p) => ({
    ticker: p.ticker,
    direction: p.direction,
    score: p.score ?? null,
    entry: p.entry_range,
    stop: p.stop,
    targets: p.target,
    why_now: p.key_signal,
    invalidation: p.risk_note ?? null,
  }));

  const watching: CommandCenterWatchingRow[] = [];
  const rejected: CommandCenterRejectedRow[] = [];
  for (const entry of input.leaderboard) {
    if (entry.promotion_status === "ACTIVE") continue;
    if (entry.promotion_status === "REJECTED") {
      rejected.push({ ticker: entry.ticker, rejection_reason: rejectionReasonFor(entry) });
      continue;
    }
    watching.push({
      ticker: entry.ticker,
      promotion_status: entry.promotion_status,
      rank_delta: entry.rank_delta,
    });
  }

  return {
    active,
    watching,
    rejected,
    market_regime: input.marketRegime,
    system_confidence: [...input.confidence],
  };
}
