/**
 * Chronological out-of-sample split helpers (2026-09-23, Phase 3 of the operator's wrong-
 * direction/score-signal investigation: "use chronological out-of-sample validation — do not
 * tune and evaluate on the same observations").
 *
 * A Phase 3 evidence survey found NO reusable mechanism for this anywhere in the codebase — every
 * existing "discovery window vs held-out window" comparison (e.g. `scripts/audit/
 * breakout-ranking-signal.mjs`, `breakout-gain-over-range-option-pnl-ab.mjs`) is a one-off,
 * hand-rolled pattern: run the same script twice against two separately-chosen calendar ranges
 * and eyeball the delta. That works but doesn't scale to repeated use and has no shared guard
 * against the one failure mode that actually matters here — a "holdout" window that silently
 * overlaps or precedes the "train" window, which turns an out-of-sample check back into an
 * in-sample one without anything visibly wrong.
 *
 * PURE, no I/O, no market-data/DB dependency — takes whatever chronologically-ordered rows a
 * caller already has (candidate_snapshot rows, graded plays, anything with a date/timestamp
 * field) and returns a train/holdout split with an explicit, checkable no-leakage guarantee:
 * every row in `holdout` has a date strictly greater than every row in `train`. This is
 * deliberately narrower than a generic ML train/test splitter — it only ever splits along the
 * time axis, never randomly, because a random split is exactly the informal-and-wrong shortcut
 * this module exists to replace.
 */

export type ChronologicalSplit<T> = {
  train: T[];
  holdout: T[];
  /** The last date INCLUDED in `train` — every `holdout` row's date is strictly after this. */
  trainEndDate: string;
  /** True when either side ended up empty (a real possibility at low n, e.g. a single-edition
   *  dataset) — the caller decides whether an empty side makes the split unusable, this module
   *  never silently drops rows to force a non-empty result. */
  degenerate: boolean;
};

function sortByDate<T>(rows: T[], dateOf: (r: T) => string): T[] {
  return [...rows].sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : dateOf(a) > dateOf(b) ? 1 : 0));
}

/**
 * Splits `rows` into a `train` (earlier) set and a `holdout` (strictly later) set.
 *
 * Pass exactly one of:
 *   - `holdoutFraction` (0 < f < 1): the LAST f-fraction of distinct dates becomes holdout —
 *     fraction is taken over distinct DATES, not row count, so a date with many rows (e.g. a
 *     high-volume session) doesn't skew where the cut falls.
 *   - `cutoffDate` (inclusive to train): every row with `dateOf(row) <= cutoffDate` is train,
 *     everything strictly after is holdout.
 *
 * Rows sharing `trainEndDate` exactly are ALWAYS placed in `train`, never split between the two
 * sides — a fraction-based cut that landed mid-date would otherwise let same-day rows leak across
 * the boundary, which is the exact kind of silent leakage this module exists to prevent.
 */
export function chronologicalSplit<T>(
  rows: T[],
  dateOf: (r: T) => string,
  opts: { holdoutFraction: number } | { cutoffDate: string }
): ChronologicalSplit<T> {
  const sorted = sortByDate(rows, dateOf);
  if (sorted.length === 0) {
    return { train: [], holdout: [], trainEndDate: "", degenerate: true };
  }

  const distinctDates = [...new Set(sorted.map(dateOf))].sort();

  let trainEndDate: string;
  if ("cutoffDate" in opts) {
    trainEndDate = opts.cutoffDate;
  } else {
    const f = opts.holdoutFraction;
    if (!(f > 0 && f < 1)) {
      throw new Error(`chronologicalSplit: holdoutFraction must be in (0, 1), got ${f}`);
    }
    // Ceil so a tiny dataset (e.g. 2 distinct dates, f=0.2) still reserves at least one date for
    // holdout rather than rounding it away to zero.
    const holdoutDateCount = Math.max(1, Math.ceil(distinctDates.length * f));
    const trainDateCount = Math.max(0, distinctDates.length - holdoutDateCount);
    trainEndDate = trainDateCount > 0 ? distinctDates[trainDateCount - 1]! : "";
  }

  const train = sorted.filter((r) => dateOf(r) <= trainEndDate);
  const holdout = sorted.filter((r) => dateOf(r) > trainEndDate);

  return {
    train,
    holdout,
    trainEndDate,
    degenerate: train.length === 0 || holdout.length === 0,
  };
}

export type ExpandingWindowFold<T> = ChronologicalSplit<T> & {
  /** 1-indexed fold number, in chronological order. */
  fold: number;
};

/**
 * Walk-forward validation folds: an EXPANDING train window (fold N's train = fold N-1's train +
 * the next holdout slice) paired with a fixed-size holdout slice immediately following it —
 * mirrors the shape of a proper walk-forward backtest rather than a single static split, so a
 * caller can check whether a pattern holds up repeatedly across time rather than on one lucky (or
 * unlucky) cut. `minTrainDates` bounds fold 1's train size so the earliest fold isn't evaluated
 * off a near-empty history; `holdoutDatesPerFold` is the number of distinct dates each fold's
 * holdout slice covers. Returns fewer than `maxFolds` folds (never fabricates one) if the data
 * runs out first.
 */
export function expandingWindowFolds<T>(
  rows: T[],
  dateOf: (r: T) => string,
  opts: { minTrainDates: number; holdoutDatesPerFold: number; maxFolds?: number }
): ExpandingWindowFold<T>[] {
  const sorted = sortByDate(rows, dateOf);
  const distinctDates = [...new Set(sorted.map(dateOf))].sort();
  const { minTrainDates, holdoutDatesPerFold } = opts;
  const maxFolds = opts.maxFolds ?? Infinity;

  const folds: ExpandingWindowFold<T>[] = [];
  let trainDateCount = minTrainDates;
  let foldNum = 1;

  while (trainDateCount < distinctDates.length && folds.length < maxFolds) {
    const trainEndDate = distinctDates[trainDateCount - 1]!;
    const holdoutEndDateIndex = Math.min(distinctDates.length, trainDateCount + holdoutDatesPerFold) - 1;
    const holdoutEndDate = distinctDates[holdoutEndDateIndex]!;

    const train = sorted.filter((r) => dateOf(r) <= trainEndDate);
    const holdout = sorted.filter((r) => dateOf(r) > trainEndDate && dateOf(r) <= holdoutEndDate);

    folds.push({
      fold: foldNum,
      train,
      holdout,
      trainEndDate,
      degenerate: train.length === 0 || holdout.length === 0,
    });

    trainDateCount += holdoutDatesPerFold;
    foldNum++;
  }

  return folds;
}
