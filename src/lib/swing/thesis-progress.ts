// src/lib/swing/thesis-progress.ts — pure helpers for management edge inputs.
//
// thesisProgress01: how far the underlying has traveled from entry toward the pinned target (0 at entry,
// 1 at target). time_stop only fires when sessionsHeld is high AND progress is stagnant — without this
// read the time_stop rung is permanently inert (sessionsHeld alone is not enough).
//
// volCollapsedFromIvRanks: IV crush vs the commit-pinned rank. Honest-null when either side is missing.

const isFin = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

/** Normalize UW IV rank whether it arrives as 0–100 or already 0–1. */
function rank01(iv: number): number {
  return iv > 1 ? iv / 100 : iv;
}

/**
 * Progress of the underlying thesis toward its target, in [0, ∞) conceptually (clamped display is the
 * caller's job). Returns null when entry/target/spot are unusable or the target is not past entry in
 * the trade direction (degenerate plan).
 *
 * LONG: (spot − entry) / (target − entry)
 * SHORT: (entry − spot) / (entry − target)
 */
export function thesisProgress01(args: {
  direction: "long" | "short";
  entryPx: number | null | undefined;
  targetPx: number | null | undefined;
  spot: number | null | undefined;
}): number | null {
  const { direction, entryPx: entry, targetPx: target, spot } = args;
  if (!isFin(entry) || !isFin(target) || !isFin(spot) || entry <= 0) return null;
  if (direction === "long") {
    const span = target - entry;
    if (!(span > 0)) return null;
    return (spot - entry) / span;
  }
  const span = entry - target;
  if (!(span > 0)) return null;
  return (entry - spot) / span;
}

/**
 * True when live IV rank has crushed versus the commit-pinned rank by ≥ `dropPts` (default 15 points on
 * a 0–100 scale). Null when either rank is absent — never fabricates a crush.
 */
export function volCollapsedFromIvRanks(
  entryIvRank: number | null | undefined,
  liveIvRank: number | null | undefined,
  dropPts = 15,
): boolean | null {
  if (!isFin(entryIvRank) || !isFin(liveIvRank)) return null;
  const entry100 = rank01(entryIvRank) * 100;
  const live100 = rank01(liveIvRank) * 100;
  return live100 <= entry100 - dropPts;
}
