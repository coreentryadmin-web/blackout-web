/**
 * Night Hawk Legacy — candidate-snapshot coverage-by-stage report (2026-09-23, Phase 3 of the
 * operator's wrong-direction/score-signal investigation: "determine how we can automatically
 * accumulate a larger, trustworthy dataset of completed trade outcomes ... including rejected
 * candidates ... use chronological out-of-sample validation").
 *
 * A Phase 3 evidence survey (before writing any code) confirmed the CAPTURE and GRADING
 * infrastructure is already built and running unattended in production — every pipeline stage
 * writes a `nighthawk_candidate_snapshot` row (published AND rejected alike), and
 * `candidate-forward-grade.ts`'s stage-agnostic grader (wired to the `nighthawk-outcomes` cron)
 * fills in multi-horizon forward returns + MFE/MAE for every row, published or rejected. What the
 * survey found genuinely MISSING was a way to see, at a glance, how much of that is actually
 * accumulating and how much of it is graded yet — every existing reader
 * (rank-bucket-analysis.ts, candidate-leaderboard.ts, score-signal-analysis.ts) answers a
 * narrower question over a fixed stage subset; none report raw coverage. This module is that
 * report: PURE, no I/O, takes the Postgres GROUP BY aggregate `fetchNighthawkCandidateSnapshotCoverage`
 * already computed and turns it into a human-readable summary.
 *
 * `stage` is intentionally free-text in the DB (no CHECK constraint — see the table's own
 * migration comment) and this module never re-enumerates "every stage the write side might use":
 * it reports exactly the buckets the aggregate returned, so a stage renamed or added on the write
 * side shows up here automatically instead of silently under-reporting.
 */

import type { NighthawkCandidateCoverageRow } from "@/lib/db";

export type StageCoverageSummary = {
  stage: string;
  rejection_reason: string | null;
  n: number;
  n_graded: number;
  grading_pct: number | null;
  n_editions: number;
  first_edition: string | null;
  last_edition: string | null;
};

export type CandidateCoverageReport = {
  window_days: number;
  total_rows: number;
  total_graded: number;
  overall_grading_pct: number | null;
  /** A LOWER BOUND on distinct edition_for dates covered, never a true total: the aggregate is
   *  grouped by (stage, rejection_reason), so the same edition_for showing up in two different
   *  stage buckets (e.g. a ticker present at both "discovery" and "rank_final" the same night)
   *  cannot be de-duplicated from this shape alone without a second query. Reporting the max
   *  across buckets rather than a fabricated sum keeps the number honestly under-, not
   *  over-, stated. */
  min_distinct_editions: number;
  first_edition: string | null;
  last_edition: string | null;
  by_stage: StageCoverageSummary[];
  /** True when the widest first-to-last-edition span across every bucket is under this many
   *  calendar days — a plain honesty flag, not a verdict, mirroring the low_n convention used
   *  throughout this codebase's other diagnostic reports (rank-bucket-analysis.ts,
   *  posture-backtest.ts). Days, not editions, because a thin span still reads as thin even if
   *  every one of those few days captured a lot of rows. */
  thin_history: boolean;
};

const THIN_HISTORY_DAY_FLOOR = 10;

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** Turns the raw per-(stage, rejection_reason) aggregate rows into a report: per-bucket grading
 *  rate plus an overall rollup. Never fetches anything — the caller already ran
 *  `fetchNighthawkCandidateSnapshotCoverage(startDate, endDate)` and passes the result straight
 *  through. */
export function buildCandidateCoverageReport(
  rows: NighthawkCandidateCoverageRow[],
  windowDays: number
): CandidateCoverageReport {
  const by_stage: StageCoverageSummary[] = rows.map((r) => ({
    stage: r.stage,
    rejection_reason: r.rejection_reason,
    n: r.n,
    n_graded: r.n_graded,
    grading_pct: pct(r.n_graded, r.n),
    n_editions: r.n_editions,
    first_edition: r.first_edition,
    last_edition: r.last_edition,
  }));

  const total_rows = rows.reduce((sum, r) => sum + r.n, 0);
  const total_graded = rows.reduce((sum, r) => sum + r.n_graded, 0);

  let first_edition: string | null = null;
  let last_edition: string | null = null;
  let min_distinct_editions = 0;
  for (const r of rows) {
    if (r.first_edition && (first_edition == null || r.first_edition < first_edition)) first_edition = r.first_edition;
    if (r.last_edition && (last_edition == null || r.last_edition > last_edition)) last_edition = r.last_edition;
    if (r.n_editions > min_distinct_editions) min_distinct_editions = r.n_editions;
  }
  const spanDays =
    first_edition && last_edition
      ? Math.round((Date.parse(`${last_edition}T00:00:00Z`) - Date.parse(`${first_edition}T00:00:00Z`)) / 86_400_000) + 1
      : 0;

  return {
    window_days: windowDays,
    total_rows,
    total_graded,
    overall_grading_pct: pct(total_graded, total_rows),
    min_distinct_editions,
    first_edition,
    last_edition,
    by_stage: by_stage.sort((a, b) => b.n - a.n),
    thin_history: spanDays < THIN_HISTORY_DAY_FLOOR,
  };
}
