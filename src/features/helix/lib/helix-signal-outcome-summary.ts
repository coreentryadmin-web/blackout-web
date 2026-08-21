import type { HelixSignalOutcomeRow } from "@/lib/db";

/**
 * Tier 2 item #10 (follow-through tracker). Pure summary logic over the ledger
 * helix-signal-outcomes-job.ts writes — kept separate from the API route so it's
 * independently unit-testable without a DB.
 *
 * Below this many GRADED (non-pending) rows, no win-rate is shown — matches the
 * repo's own established threshold (signal-accuracy.ts's
 * MIN_SAMPLE_FOR_RECOMMENDATION) for "don't claim a verdict off a handful of
 * samples." This is the concrete implementation of the audit's sequencing-risk
 * finding: Tier 3's conviction scores must never ship ahead of real evidence, and
 * this is the first UI surface where that discipline has to hold.
 */
export const MIN_GRADED_SAMPLE_FOR_WIN_RATE = 10;

export type HelixSignalOutcomeSummary = {
  gradedCount: number;
  pendingCount: number;
  /** Firings that CONTINUED in the signal's own direction. Kept under this name because the
   *  existing tracker panel reads it; it is a continuation count, not a P&L "win". */
  winCount: number;
  /** null when gradedCount < MIN_GRADED_SAMPLE_FOR_WIN_RATE — never a fabricated 0%. */
  winRatePct: number | null;
  /** The full graded distribution. `winRatePct` alone cannot express it, and the missing half
   *  changes the read: live 2026-08-20, 40 graded split 25 continued / 12 flat / 3 reversed, so
   *  "62.5%" implied 37.5% went wrong when only 7.5% actually reversed and 30% went nowhere.
   *  A signal that rarely reverses but often stalls is a different instrument from one that is
   *  wrong a third of the time, and the two were indistinguishable in the payload. */
  continuedCount: number;
  flatCount: number;
  reversedCount: number;
  /** Graded rows whose outcome is none of continued/flat/reversed — 0 today. Present so an
   *  unrecognised grade can never be silently absorbed into one of the three real buckets. */
  otherCount: number;
};

export function summarizeHelixSignalOutcomes(rows: HelixSignalOutcomeRow[]): HelixSignalOutcomeSummary {
  const graded = rows.filter((r) => r.outcome !== "pending");
  const continuedCount = graded.filter((r) => r.outcome === "continued").length;
  const flatCount = graded.filter((r) => r.outcome === "flat").length;
  const reversedCount = graded.filter((r) => r.outcome === "reversed").length;
  const gradedCount = graded.length;
  return {
    gradedCount,
    pendingCount: rows.length - gradedCount,
    winCount: continuedCount,
    winRatePct:
      gradedCount >= MIN_GRADED_SAMPLE_FOR_WIN_RATE
        ? Math.round((continuedCount / gradedCount) * 1000) / 10
        : null,
    continuedCount,
    flatCount,
    reversedCount,
    // Derived by subtraction rather than by a fourth filter, so the four buckets ALWAYS sum to
    // gradedCount even if the grader gains a new outcome value.
    otherCount: gradedCount - continuedCount - flatCount - reversedCount,
  };
}
