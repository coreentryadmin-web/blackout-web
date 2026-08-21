/**
 * Trailing-session skew baseline (Helix C10).
 *
 * WHY THIS EXISTS. `get_helix_tape_analytics.session.call_pct` gives Largo TODAY'S call/put premium
 * skew, but a single number has no reference frame: "SPX is 78% call today" is only meaningful next
 * to what SPX's skew usually is. Asked "is today's skew unusual?", Largo could only say it did not
 * know — honest, but a gap the product should close. This computes the recent NORM from prior
 * sessions so today's reading can be placed against it (typical / high / low, and how far out).
 *
 * PURE. Takes the already-derived per-session call_pct series (the DB aggregation that produces it
 * lives in the reader, which cannot be unit-tested without Postgres) and returns the distribution
 * plus today's placement. Split out so the statistics — the load-bearing part — are tested in
 * isolation against fixed inputs.
 *
 * DATA-INTEGRITY RULES (the same ones the rest of this lane holds):
 *  - Below MIN_BASELINE_SESSIONS measured prior sessions the verdict is WITHHELD (available:false),
 *    never a norm manufactured from three days. A percentile off a handful of sessions is noise.
 *  - A session whose call_pct is null (no measurable premium that day) is EXCLUDED from the
 *    baseline, not counted as 0 or 50 — absence is not a measurement.
 *  - The baseline is the PRIOR sessions only; today's own value is the thing being placed against
 *    it and must never be folded into the distribution it is compared to.
 *  - `today_pct` null (today unmeasurable) still returns the baseline distribution, with placement
 *    null — the norm is a fact even when today has no reading to place.
 */

/** Below this many measured prior sessions, no baseline verdict is shown. Matches the lane's
 *  established "don't claim a verdict off a handful of samples" floor (signal-outcome win rate,
 *  MIN_GRADED_SAMPLE_FOR_WIN_RATE). Percentiles need more support than a mean, so this is higher. */
export const MIN_BASELINE_SESSIONS = 10;

/** How far outside the interquartile range a reading must sit to be flagged `unusual` — the Tukey
 *  1.5×IQR fence, the standard outlier boundary. Named so the choice is visible, not a magic number. */
export const IQR_OUTLIER_FENCE = 1.5;

export type SkewBaselineUnavailable = {
  available: false;
  /** `insufficient_history` (< MIN_BASELINE_SESSIONS measured sessions) is the only reason today. */
  reason: "insufficient_history";
  /** How many measured prior sessions WERE available, so the caller can say "only N of the needed M". */
  measured_sessions: number;
  min_sessions: number;
};

export type SkewBaselinePlacement =
  /** Inside the interquartile range — today's skew is ordinary for this ticker. */
  | "typical"
  /** Above p75 but within the 1.5×IQR fence — call-heavier than usual, not extreme. */
  | "above_normal"
  /** Below p25 but within the fence — put-heavier than usual, not extreme. */
  | "below_normal"
  /** Beyond the upper 1.5×IQR fence — unusually call-heavy for this ticker. */
  | "unusually_high"
  /** Beyond the lower 1.5×IQR fence — unusually put-heavy for this ticker. */
  | "unusually_low";

export type SkewBaselineAvailable = {
  available: true;
  /** Measured prior sessions the distribution is built from (nulls already excluded). */
  measured_sessions: number;
  /** The recent norm: median call_pct across the prior sessions. */
  median_call_pct: number;
  /** Interquartile bounds — the middle-50% band of this ticker's daily skew. */
  p25_call_pct: number;
  p75_call_pct: number;
  /** p75 − p25. The spread of the norm; a wide IQR means the skew is naturally volatile. */
  iqr: number;
  /** Today's value carried alongside so the payload is self-contained (null when unmeasurable). */
  today_call_pct: number | null;
  /** Today's mid-rank percentile within the prior distribution (0–100), null when today is null. */
  today_percentile: number | null;
  /** Where today sits vs the norm — null when today is unmeasurable. Never invented. */
  placement: SkewBaselinePlacement | null;
  /** True only when today is beyond the 1.5×IQR fence in either direction. False (not null) when
   *  today is measured and ordinary — "checked, not unusual" is a known state. Null when today is null. */
  unusual: boolean | null;
};

export type SkewBaseline = SkewBaselineAvailable | SkewBaselineUnavailable;

/** Linear-interpolation percentile (the Excel / R type-7 method) over a NON-EMPTY sorted array. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
}

/**
 * Mid-rank percentile of `x` within a sorted sample: (below + 0.5·equal) / n · 100. The mid-rank
 * (rather than "fraction ≤ x") keeps a value exactly at the median near 50 instead of pushing it to
 * 100, which is the honest placement for "right in the middle".
 */
function midRankPercentile(sorted: readonly number[], x: number): number {
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < x) below++;
    else if (v === x) equal++;
  }
  return ((below + 0.5 * equal) / sorted.length) * 100;
}

/**
 * Build the baseline from a series of prior-session call_pct values and place today against it.
 *
 * @param priorCallPcts call_pct (0–100) for each PRIOR session, newest-or-oldest order irrelevant;
 *        `null`/non-finite entries are excluded (a session with no measurable premium is not a 0).
 * @param todayCallPct  today's session call_pct, or null when today itself is unmeasurable.
 */
export function trailingSkewBaseline(
  priorCallPcts: ReadonlyArray<number | null | undefined>,
  todayCallPct: number | null | undefined,
  minSessions: number = MIN_BASELINE_SESSIONS
): SkewBaseline {
  const measured = priorCallPcts
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .slice()
    .sort((a, b) => a - b);

  if (measured.length < minSessions) {
    return {
      available: false,
      reason: "insufficient_history",
      measured_sessions: measured.length,
      min_sessions: minSessions,
    };
  }

  const median = percentile(measured, 50);
  const p25 = percentile(measured, 25);
  const p75 = percentile(measured, 75);
  const iqr = p75 - p25;

  const today = typeof todayCallPct === "number" && Number.isFinite(todayCallPct) ? todayCallPct : null;

  let placement: SkewBaselinePlacement | null = null;
  let unusual: boolean | null = null;
  let todayPercentile: number | null = null;
  if (today != null) {
    todayPercentile = midRankPercentile(measured, today);
    const upperFence = p75 + IQR_OUTLIER_FENCE * iqr;
    const lowerFence = p25 - IQR_OUTLIER_FENCE * iqr;
    if (today > upperFence) placement = "unusually_high";
    else if (today < lowerFence) placement = "unusually_low";
    else if (today > p75) placement = "above_normal";
    else if (today < p25) placement = "below_normal";
    else placement = "typical";
    unusual = placement === "unusually_high" || placement === "unusually_low";
  }

  return {
    available: true,
    measured_sessions: measured.length,
    median_call_pct: median,
    p25_call_pct: p25,
    p75_call_pct: p75,
    iqr,
    today_call_pct: today,
    today_percentile: todayPercentile,
    placement,
    unusual,
  };
}
