/**
 * Pure evaluation helpers for the HELIX conviction-score probe (HELIX-MAP.md §9.7).
 *
 * §9.7's open question: `score` is `min(60, premium/$1M × 60) + sweep(25) + 0dte(15)`, so every
 * print at or above $1M contributes the same 60 premium points — a $50M block and a $1.1M print are
 * separated only by the two flags. Whether that compression is intended or accidental is UNKNOWN,
 * and the map says explicitly: **do not retune it on intuition.**
 *
 * The map names the signal ledger as the only instrument that could answer it. That instrument is
 * currently un-runnable — `helix-signal-outcomes` is registered but absent from the deployed cron
 * manifest (verified 2026-08-23 against blackout-infra), so the ledger has no writer. This module
 * takes the other route available to an offline audit: grade the prints' own underlyings forward on
 * REAL Polygon minute bars and ask whether score separates outcomes at all.
 *
 * WHAT THIS CAN AND CANNOT SAY. It measures whether score correlates with a forward move in the
 * UNDERLYING, direction taken from the print (option type × aggressor side, the same rule
 * `helix-flow-aggression.ts` states). It does NOT measure option P&L — no strike, no premium decay,
 * no exit rule — so a flat result is evidence that score does not rank direction, not proof that
 * score is worthless for sizing. Stated here so a reader cannot quietly upgrade the claim.
 */

/** Buckets chosen to isolate the saturation point: everything at/above 60 is premium-saturated. */
export const SCORE_BUCKETS = [
  { label: "0-19", min: 0, max: 19.999 },
  { label: "20-39", min: 20, max: 39.999 },
  { label: "40-59", min: 40, max: 59.999 },
  { label: "60 (saturated)", min: 60, max: 60.0001 },
  { label: "61-84", min: 60.0002, max: 84.999 },
  { label: "85-100", min: 85, max: 100 },
];

export function bucketForScore(score) {
  // `Number(null)` is 0 and `Number("")` is 0, so a Number()-then-isFinite guard alone buckets an
  // ABSENT score into "0-19" — a print nobody scored counted as a print scored zero. That is the
  // absence-as-measurement failure this lane has spent the day removing, and it appeared here in
  // the instrument built to measure it. Reject non-numbers explicitly, before coercion.
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return SCORE_BUCKETS.find((b) => score >= b.min && score <= b.max)?.label ?? null;
}

/**
 * Favourable-move outcome for one print.
 *
 * `direction` is bullish/bearish; anything else returns null rather than being graded as a
 * coin-flip — an ungradeable print must not dilute a hit rate toward 50%.
 */
export function gradeForward(direction, entryPrice, exitPrice) {
  if (direction !== "bullish" && direction !== "bearish") return null;
  const a = Number(entryPrice), b = Number(exitPrice);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) return null;
  const changePct = ((b - a) / a) * 100;
  return {
    changePct,
    // Signed by the print's own direction: a bearish print that fell is a WIN.
    favorablePct: direction === "bullish" ? changePct : -changePct,
    win: (direction === "bullish" ? changePct : -changePct) > 0,
  };
}

/** Aggregate graded rows into per-bucket stats. Pure. */
export function summarizeByBucket(rows) {
  const out = new Map();
  for (const r of rows) {
    const b = bucketForScore(r.score);
    if (!b || !r.graded) continue;
    const cur = out.get(b) ?? { bucket: b, n: 0, wins: 0, sumFavorable: 0, sumPremium: 0 };
    cur.n++;
    if (r.graded.win) cur.wins++;
    cur.sumFavorable += r.graded.favorablePct;
    cur.sumPremium += Number(r.premium) || 0;
    out.set(b, cur);
  }
  return SCORE_BUCKETS.map((b) => out.get(b.label)).filter(Boolean).map((c) => ({
    ...c,
    winRate: c.n > 0 ? (c.wins / c.n) * 100 : null,
    avgFavorablePct: c.n > 0 ? c.sumFavorable / c.n : null,
    avgPremium: c.n > 0 ? c.sumPremium / c.n : null,
  }));
}

/**
 * Does score separate outcomes at all?
 *
 * Deliberately conservative: reports a SPREAD between the best and worst sufficiently-populated
 * bucket rather than a correlation coefficient, because a coefficient over six ordinal buckets with
 * uneven n invites over-reading. Buckets below `minN` are excluded from the spread and SAID SO —
 * a spread computed off a 3-row bucket is noise wearing a number.
 */
export function scoreSeparation(summary, minN = 30) {
  const usable = summary.filter((s) => s.n >= minN && s.winRate != null);
  const excluded = summary.filter((s) => s.n < minN).map((s) => `${s.bucket}(n=${s.n})`);
  if (usable.length < 2) {
    return { verdict: "INSUFFICIENT DATA", usableBuckets: usable.length, excluded };
  }
  const rates = usable.map((s) => s.winRate);
  const spread = Math.max(...rates) - Math.min(...rates);
  return {
    verdict: spread >= 10 ? "SEPARATES" : spread >= 5 ? "WEAK" : "FLAT",
    spreadPp: spread,
    best: usable.reduce((a, b) => (b.winRate > a.winRate ? b : a)),
    worst: usable.reduce((a, b) => (b.winRate < a.winRate ? b : a)),
    usableBuckets: usable.length,
    excluded,
  };
}
