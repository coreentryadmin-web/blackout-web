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
  winCount: number;
  /** null when gradedCount < MIN_GRADED_SAMPLE_FOR_WIN_RATE — never a fabricated 0%. */
  winRatePct: number | null;
};

export function summarizeHelixSignalOutcomes(rows: HelixSignalOutcomeRow[]): HelixSignalOutcomeSummary {
  const graded = rows.filter((r) => r.outcome !== "pending");
  const wins = graded.filter((r) => r.outcome === "continued").length;
  const gradedCount = graded.length;
  return {
    gradedCount,
    pendingCount: rows.length - gradedCount,
    winCount: wins,
    winRatePct:
      gradedCount >= MIN_GRADED_SAMPLE_FOR_WIN_RATE
        ? Math.round((wins / gradedCount) * 1000) / 10
        : null,
  };
}
