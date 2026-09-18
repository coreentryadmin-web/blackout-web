/**
 * Night Hawk Legacy Signal Intelligence — candidate leaderboard (operator priority #7:
 * "Create a candidate leaderboard that records how rankings change... continuously reranked").
 *
 * SCOPE OF THIS FIRST CUT — read the whole header before extending it: this surfaces the rank
 * trajectory a candidate ALREADY travels through the overnight edition-build funnel (discovery ->
 * scored -> rank_governor -> rank_final/rejected, per PR #5184's now-complete `nighthawk_
 * candidate_snapshot` capture). It does NOT track rank changes through premarket/RTH — that half
 * of the operator's ask needs a NEW periodic re-scoring capture point (a live cron re-running
 * scoreCandidate against the published pool at intervals), which is a materially different, more
 * expensive build (new recurring UW/Polygon load) flagged separately in the 2026-09-18 08:24 UTC
 * journal entry for explicit confirmation before wiring. This module ships the safe, immediately-
 * available half now: every candidate this session already produces a real multi-stage trajectory,
 * and nothing has ever assembled it into one ordered, per-ticker view.
 *
 * PURE, no I/O: takes the rows a caller already fetched (fetchNighthawkCandidateSnapshots) and
 * groups/orders/summarizes them. The funnel's real stage set (verified against every actual write
 * site, not the aspirational docs some of those sites used to carry) is exactly: discovery, scored,
 * rank_governor, rank_final, rejected — STAGE_ORDER below encodes that, not the wider conceptual
 * stage list ("rank_initial"/"rank_bearish_posture"/"rank_grounding_merge") some doc comments
 * mention but which nothing actually writes.
 */

import type { NighthawkCandidateSnapshotRow } from "@/lib/db";

/** The funnel's real depth order — lower number = earlier in the pipeline. `rank_final` and
 *  `rejected` share the last depth: they're mutually exclusive terminal outcomes for a ticker,
 *  never both reached, so ordering between them is meaningless (a ticker has at most one). */
const STAGE_ORDER: Record<string, number> = {
  discovery: 0,
  scored: 1,
  rank_governor: 2,
  rank_final: 3,
  rejected: 3,
};

/** A stage this module doesn't recognize (a future addition, or test fixture noise) sorts last
 *  and never crashes the ordering — honest "unknown position", not a guess. */
function stageDepth(stage: string): number {
  return STAGE_ORDER[stage] ?? Number.POSITIVE_INFINITY;
}

export type CandidateLeaderboardStagePoint = {
  stage: string;
  rank: number | null;
  score: number | null;
  observed_at: string;
  selected_for_publish: boolean | null;
  rejection_reason: string | null;
};

export type CandidateLeaderboardOutcome = "published" | "rejected" | "in_progress";

/**
 * Operator priority #10 ("promotion/demotion ladder WATCH->READY->TRIGGERED->ACTIVE with
 * explicit 'what changed' reasons") — the safe half of Phase 2D. Item #11 of the same mandate
 * (a real NO-TRADE state) is a genuine product trade-off against the shipped backfill-floor
 * behavior (play-backfill.ts's backfillThinEditionPlays/effectiveMinPublishPlays) and stays
 * explicitly BLOCKED pending operator confirmation (see the 2026-09-18 06:21Z journal entry).
 * This status label is unrelated to that blocker: it changes NOTHING about which candidates get
 * published or how many — it only names where a candidate ALREADY in the funnel currently sits,
 * the same way `outcome` below already does, just with the three in-progress funnel depths
 * distinguished instead of collapsed into one "in_progress" bucket.
 */
export type CandidatePromotionStatus = "WATCH" | "READY" | "TRIGGERED" | "ACTIVE" | "REJECTED";

export type CandidateLeaderboardEntry = {
  ticker: string;
  /** Ordered by the funnel's own stage depth (STAGE_ORDER), not raw observed_at — same-batch
   *  writes during one edition build can carry near-identical or even out-of-order timestamps,
   *  so the funnel's own known topology is the more reliable ordering signal. */
  trajectory: CandidateLeaderboardStagePoint[];
  outcome: CandidateLeaderboardOutcome;
  /** WATCH (seen only at discovery) -> READY (survived to scored) -> TRIGGERED (survived to
   *  rank_governor) -> ACTIVE (published) -> REJECTED (terminal, regardless of how far it got
   *  first). See the type's own doc above for the Phase 2D scope boundary this respects. */
  promotion_status: CandidatePromotionStatus;
  /** rank at the FIRST ranked stage this ticker reached minus rank at the LAST ranked stage it
   *  reached (both taken from `trajectory`, i.e. respecting STAGE_ORDER, not observed_at). Ranks
   *  are 1-based and lower is better, so a POSITIVE delta means the ticker improved (climbed) and
   *  a NEGATIVE delta means it fell. Null when fewer than 2 stages of this ticker's trajectory
   *  carry a non-null rank (e.g. confluence-gate-rejected at discovery, never reaching `scored`).
   */
  rank_delta: number | null;
};

function outcomeFor(trajectory: CandidateLeaderboardStagePoint[]): CandidateLeaderboardOutcome {
  if (trajectory.some((p) => p.selected_for_publish === true)) return "published";
  if (trajectory.some((p) => p.stage === "rejected")) return "rejected";
  return "in_progress";
}

function rankDeltaFor(trajectory: CandidateLeaderboardStagePoint[]): number | null {
  const ranked = trajectory.filter((p) => p.rank != null);
  if (ranked.length < 2) return null;
  const first = ranked[0]!.rank!;
  const last = ranked[ranked.length - 1]!.rank!;
  return first - last;
}

/** `outcome` already decides ACTIVE/REJECTED; for "in_progress" this reads the DEEPEST stage the
 *  trajectory (already sorted by STAGE_ORDER) actually reached — an unrecognized/future stage
 *  degrades to WATCH rather than guessing a deeper status it hasn't earned. */
function promotionStatusFor(
  trajectory: CandidateLeaderboardStagePoint[],
  outcome: CandidateLeaderboardOutcome
): CandidatePromotionStatus {
  if (outcome === "published") return "ACTIVE";
  if (outcome === "rejected") return "REJECTED";
  const deepest = trajectory[trajectory.length - 1];
  if (deepest?.stage === "scored") return "READY";
  if (deepest?.stage === "rank_governor") return "TRIGGERED";
  return "WATCH";
}

/**
 * Groups a set of `nighthawk_candidate_snapshot` rows (typically one edition's worth, via
 * `fetchNighthawkCandidateSnapshots(editionFor)`) into one leaderboard entry per ticker, each
 * carrying its ordered stage trajectory, terminal outcome, and net rank delta. Rows from more
 * than one edition are NOT separated here — pass rows already scoped to one `edition_for`, same
 * contract `fetchNighthawkCandidateSnapshots` itself documents.
 */
export function buildCandidateLeaderboard(rows: readonly NighthawkCandidateSnapshotRow[]): CandidateLeaderboardEntry[] {
  const byTicker = new Map<string, CandidateLeaderboardStagePoint[]>();
  for (const r of rows) {
    const point: CandidateLeaderboardStagePoint = {
      stage: r.stage,
      rank: r.rank,
      score: r.score,
      observed_at: r.observed_at,
      selected_for_publish: r.selected_for_publish,
      rejection_reason: r.rejection_reason,
    };
    const existing = byTicker.get(r.ticker);
    if (existing) existing.push(point);
    else byTicker.set(r.ticker, [point]);
  }

  const entries: CandidateLeaderboardEntry[] = [];
  for (const [ticker, points] of byTicker) {
    const trajectory = [...points].sort((a, b) => stageDepth(a.stage) - stageDepth(b.stage));
    const outcome = outcomeFor(trajectory);
    entries.push({
      ticker,
      trajectory,
      outcome,
      promotion_status: promotionStatusFor(trajectory, outcome),
      rank_delta: rankDeltaFor(trajectory),
    });
  }
  return entries;
}
