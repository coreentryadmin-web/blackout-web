/**
 * Night Hawk Legacy — rank-bucket forward-performance analysis (2026-09-20, "does Legacy's
 * ranking actually have predictive value, and why have recent Top-5 picks been losing" audit,
 * Phase 0 of the operator's "upgrade Legacy" mandate — diagnosis only, no scoring/ranking/
 * publishing change).
 *
 * PURE, no I/O: takes `nighthawk_candidate_snapshot` rows a caller already fetched (via
 * `fetchNighthawkCandidateSnapshotsInRange`) and answers the one question nothing in this
 * codebase computed before: do candidates ranked 1-5 forward-perform better than 6-10, 11-25,
 * or rejected? The raw substrate already exists — `candidate-forward-grade.ts` grades every
 * stage row, published or rejected, with real multi-horizon forward returns and session
 * MFE/MAE — this module is the first thing to actually bucket and compare it.
 *
 * SIGN-ALIGNMENT: `forward_returns`/MFE/MAE are stored direction-agnostic (raw underlying %,
 * see candidate-forward-grade.ts's own header) — a row's `snapshot_json.direction` ("long" |
 * "short", present on every scored/rank_governor/rank_final/rejected-after-scoring row) is used
 * here to sign-align
 * each row's own numbers into "favorable" (positive) / "adverse" (negative), so buckets can be
 * compared on a like-for-like "did the thesis play out" basis rather than raw unsigned price
 * movement. A row with no direction (e.g. a STAGE-2 confluence-gate reject that never reached
 * scoring) is bucketed but its return stats are left null — never guessed.
 *
 * NO LOOK-AHEAD: this module only reads `forward_returns` already pinned by
 * candidate-forward-grade.ts (itself entry-anchored at session open, never `observed_at`) — it
 * performs no new market-data fetch and no new inference about what "would have" happened.
 *
 * LOW-N HONESTY: every bucket reports its own `n`/`n_graded` and a `low_n` flag (same convention
 * as posture-backtest.ts/swing-score-calibration.mjs elsewhere in this codebase) rather than a
 * verdict — the caller decides whether a bucket has enough evidence to act on.
 */

import type { NighthawkCandidateSnapshotRow } from "@/lib/db";

export const RANK_BUCKET_LOW_N_THRESHOLD = 10;

export type RankBucketKey = "rank_1_5" | "rank_6_10" | "rank_11_25" | "rank_26_plus" | "rejected_unranked";

const RANK_BUCKET_ORDER: RankBucketKey[] = [
  "rank_1_5",
  "rank_6_10",
  "rank_11_25",
  "rank_26_plus",
  "rejected_unranked",
];

/** Buckets purely by the row's own `rank` column — a "rejected" row that WAS ranked before being
 *  cut (e.g. by the cross-edition governor or a STAGE-6 gate) buckets by that rank, same as a
 *  `rank_final` row; only a row with no rank at all (never reached scoring, e.g. a confluence-
 *  gate reject) falls into `rejected_unranked`. This is deliberate: it answers "did depth in the
 *  ranking predict forward performance" INCLUDING candidates the ranking liked but a downstream
 *  gate vetoed, not just the raw discovery funnel. */
export function bucketForRank(rank: number | null): RankBucketKey {
  if (rank == null) return "rejected_unranked";
  if (rank <= 5) return "rank_1_5";
  if (rank <= 10) return "rank_6_10";
  if (rank <= 25) return "rank_11_25";
  return "rank_26_plus";
}

type Direction = "long" | "short";

function directionOf(row: NighthawkCandidateSnapshotRow): Direction | null {
  const d = row.snapshot_json?.direction;
  return d === "long" || d === "short" ? d : null;
}

/** Sign-aligns a raw (unsigned, price-up-is-positive) % move so positive always means "favorable
 *  to this row's own direction" — a LONG's favorable move is a raw rise, a SHORT's favorable
 *  move is a raw fall. */
function signAlignFavorable(rawPct: number | null | undefined, direction: Direction): number | null {
  if (rawPct == null || !Number.isFinite(rawPct)) return null;
  return direction === "long" ? rawPct : -rawPct;
}

type ForwardReturnsShape = {
  horizons?: Record<string, number | null>;
  session_high_pct?: number | null;
  session_low_pct?: number | null;
};

/** One row's sign-aligned reading, or null across the board when direction/forward_returns are
 *  unavailable — never fabricated. */
function signAlignedReading(row: NighthawkCandidateSnapshotRow): {
  h1: number | null;
  eod: number | null;
  mfe: number | null;
  mae: number | null;
} {
  const direction = directionOf(row);
  const fr = row.forward_returns as ForwardReturnsShape | null | undefined;
  if (!direction || !fr) return { h1: null, eod: null, mfe: null, mae: null };
  const h1 = signAlignFavorable(fr.horizons?.h1 ?? null, direction);
  const eod = signAlignFavorable(fr.horizons?.eod ?? null, direction);
  // Favorable excursion: a LONG's best case is the session high; a SHORT's best case is the
  // session low (so it's negated to read positive-favorable, same convention as h1/eod above).
  const mfe =
    direction === "long"
      ? signAlignFavorable(fr.session_high_pct ?? null, "long")
      : signAlignFavorable(fr.session_low_pct ?? null, "short");
  // Adverse excursion: the mirror image — a LONG's worst case is the session low, a SHORT's
  // worst case is the session high.
  const mae =
    direction === "long"
      ? signAlignFavorable(fr.session_low_pct ?? null, "long")
      : signAlignFavorable(fr.session_high_pct ?? null, "short");
  return { h1, eod, mfe, mae };
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return Math.round(m * 100) / 100;
}

export type RankBucketStats = {
  bucket: RankBucketKey;
  n: number;
  /** Rows with BOTH a resolvable direction AND a pinned forward_returns grade — the subset the
   *  stats below are actually computed from. Always <= n. */
  n_graded: number;
  mean_h1_pct: number | null;
  median_h1_pct: number | null;
  mean_eod_pct: number | null;
  median_eod_pct: number | null;
  mean_mfe_pct: number | null;
  mean_mae_pct: number | null;
  /** Share of graded rows whose sign-aligned EOD move was > 0 — a coarse "did the thesis play
   *  out by the close" rate, not a substitute for the real entry/stop/target grading
   *  `resolveOutcome` performs for published plays. */
  win_rate_eod_pct: number | null;
  low_n: boolean;
};

/** Rows are already scoped by the caller to whichever stages/date-range it wants compared (see
 *  `fetchNighthawkCandidateSnapshotsInRange`). Buckets, then computes sign-aligned stats per
 *  bucket. A ticker/edition pair that appears more than once at the SAME stage (shouldn't happen
 *  per the write-site contract, but not assumed) is not deduplicated here — the caller controls
 *  which stages it passes in. */
export function computeRankBucketStats(rows: readonly NighthawkCandidateSnapshotRow[]): RankBucketStats[] {
  const byBucket = new Map<RankBucketKey, NighthawkCandidateSnapshotRow[]>();
  for (const key of RANK_BUCKET_ORDER) byBucket.set(key, []);
  for (const row of rows) {
    byBucket.get(bucketForRank(row.rank))!.push(row);
  }

  return RANK_BUCKET_ORDER.map((bucket) => {
    const bucketRows = byBucket.get(bucket)!;
    const readings = bucketRows.map(signAlignedReading).filter((r) => r.eod != null || r.h1 != null);
    const h1Values = readings.map((r) => r.h1).filter((v): v is number => v != null);
    const eodValues = readings.map((r) => r.eod).filter((v): v is number => v != null);
    const mfeValues = readings.map((r) => r.mfe).filter((v): v is number => v != null);
    const maeValues = readings.map((r) => r.mae).filter((v): v is number => v != null);
    const winCount = eodValues.filter((v) => v > 0).length;

    return {
      bucket,
      n: bucketRows.length,
      n_graded: readings.length,
      mean_h1_pct: mean(h1Values),
      median_h1_pct: median(h1Values),
      mean_eod_pct: mean(eodValues),
      median_eod_pct: median(eodValues),
      mean_mfe_pct: mean(mfeValues),
      mean_mae_pct: mean(maeValues),
      win_rate_eod_pct: eodValues.length ? Math.round((winCount / eodValues.length) * 1000) / 10 : null,
      low_n: readings.length < RANK_BUCKET_LOW_N_THRESHOLD,
    };
  });
}

export type RegimeBucketKey = "expansive" | "neutral" | "defensive" | "unknown";

/** Coarse regime proxy from `snapshot_json.regime_multiplier` (the ONE regime-derived field that
 *  survives onto scored/rank_governor/rank_final/rejected rows — the fuller `market_regime` classification object
 *  is only stamped at STAGE-2 discovery, which this module's default stage scope excludes).
 *  Bands are wide and unbacktested on purpose — this is a coarse "was the multiplier pushing
 *  scores up or down that session" read, not a calibrated regime model. */
export function regimeBucketFor(row: NighthawkCandidateSnapshotRow): RegimeBucketKey {
  const m = row.snapshot_json?.regime_multiplier;
  if (typeof m !== "number" || !Number.isFinite(m)) return "unknown";
  if (m > 1.05) return "expansive";
  if (m < 0.95) return "defensive";
  return "neutral";
}

export type RegimeBucketStats = {
  regime: RegimeBucketKey;
  n: number;
  n_graded: number;
  mean_eod_pct: number | null;
  win_rate_eod_pct: number | null;
  low_n: boolean;
};

export function computeRegimeBucketStats(rows: readonly NighthawkCandidateSnapshotRow[]): RegimeBucketStats[] {
  const byRegime = new Map<RegimeBucketKey, NighthawkCandidateSnapshotRow[]>();
  const order: RegimeBucketKey[] = ["expansive", "neutral", "defensive", "unknown"];
  for (const key of order) byRegime.set(key, []);
  for (const row of rows) byRegime.get(regimeBucketFor(row))!.push(row);

  return order.map((regime) => {
    const regimeRows = byRegime.get(regime)!;
    const readings = regimeRows.map(signAlignedReading).filter((r) => r.eod != null);
    const eodValues = readings.map((r) => r.eod).filter((v): v is number => v != null);
    const winCount = eodValues.filter((v) => v > 0).length;
    return {
      regime,
      n: regimeRows.length,
      n_graded: readings.length,
      mean_eod_pct: mean(eodValues),
      win_rate_eod_pct: eodValues.length ? Math.round((winCount / eodValues.length) * 1000) / 10 : null,
      low_n: readings.length < RANK_BUCKET_LOW_N_THRESHOLD,
    };
  });
}
