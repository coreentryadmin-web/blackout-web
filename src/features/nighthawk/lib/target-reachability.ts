// Night Hawk LEGACY — how reachable is a published target, in the horizon it is graded in?
//
// The Legacy lane grades a play on EXACTLY ONE daily bar: `outcomeSessionDate(row)` returns
// `row.edition_for` (play-outcomes.ts:553-555) and the grader fetches
// `fetchStockDailyBars(ticker, sessionDate, sessionDate, "1")` (play-outcomes.ts:666). A win
// requires the target to TRADE inside that single session. So "how far is the target" and
// "how likely is a win" are the same question, and the system has always had the first number
// without ever showing the second.
//
// The publish gate already computes the distance: publish-gates.ts:220-227 pins
// `{ code: "target_unreachable", value: |target − fill_edge| / atr14, threshold }` into
// publish_context.gates.checks[] on EVERY play, passed or blocked. This module turns that
// pinned multiple into the member-facing reachability statement it implies.
//
// ── PROVENANCE OF THE TABLE (read this before touching a number) ────────────────────────
// Source: 4,136 ticker-sessions over the 44 tickers Night Hawk actually published,
// March–August 2026, from real Polygon daily bars. Measured quantity: the one-session
// LONG favorable excursion from the open, (high − open) / ATR14 — i.e. the fraction of
// sessions in which a target set K × ATR14 away would have TRADED.
//
// ATR14 is production's own formula: the simple mean of the last 14 daily true ranges
// (polygon-largo.ts:329-338), computed over the 14 sessions ending strictly BEFORE
// edition_for — the same window the evening builder saw.
//
// The population is not the only estimator. The 30 Legacy plays that actually FILLED in
// the 2026-07-06..08-06 window corroborate it to within a couple of points at every
// K ≤ 1.0 (0.25× → 60%, 0.5× → 40%, 0.75× → 20%, 1.0× → 6.7%) and give 0.0% at every
// K ≥ 1.5 — two independent measurements landing on the same curve. A third, harder
// bound: across 64 published plays, ZERO sessions had a full high-to-low range reaching
// 3.5× ATR14 (median 0.85×, max 2.25×). At 3.5× the target was unreachable even buying
// the exact low and selling the exact high.
//
// ── HONEST LIMITS ───────────────────────────────────────────────────────────────────────
// This is a POPULATION BASE RATE, not a per-play probability. It carries no information
// about the specific setup's direction quality, catalyst, or regime — it answers only
// "how often does a name of this kind travel this far in one session". It is deliberately
// a STATIC committed table rather than a live query: it is disclosure, not gating, and a
// number that silently drifts is worse than one whose provenance is pinned in a comment.
// Re-measure it (and update the constants + this header together) if the published-ticker
// universe or the grading horizon changes.
//
// See docs/audit/FINDINGS.md 2026-08-06 for the full tables and the measurement scripts.

/** One measured point on the reachability curve: P(target at K × ATR14 trades) in ONE session. */
export type ReachabilityPoint = { readonly k: number; readonly pct: number };

/**
 * Measured one-session touch rate by target distance in ATR14 units.
 * n = 4,136 ticker-sessions, 44 NH-published tickers, Mar–Aug 2026. Monotonically
 * decreasing by construction (a farther target is a subset of a nearer one's touches) —
 * asserted in the unit test so a bad edit cannot ship a non-monotonic curve.
 */
export const TARGET_REACHABILITY_TABLE: readonly ReachabilityPoint[] = [
  { k: 0.25, pct: 65 },
  { k: 0.5, pct: 38 },
  { k: 0.75, pct: 21 },
  { k: 1.0, pct: 11 },
  { k: 1.25, pct: 5.5 },
  { k: 1.5, pct: 3.0 },
  { k: 2.0, pct: 0.9 },
  { k: 2.5, pct: 0.4 },
  { k: 3.5, pct: 0.1 },
] as const;

/** Below this we stop printing a false-precision decimal and say "<1%". */
export const REACHABILITY_FLOOR_PCT = 1;

/**
 * Interpolated one-session touch rate for a target `k` × ATR14 from the fill edge.
 * Linear between measured points; clamped (never extrapolated) outside the measured
 * range — beyond 3.5× the curve is already at the floor, and inventing a value out
 * there would be fabricating evidence the measurement does not contain.
 * Returns null for a non-finite or negative multiple (never guesses).
 */
export function targetReachabilityPct(k: number): number | null {
  if (!Number.isFinite(k) || k < 0) return null;
  const table = TARGET_REACHABILITY_TABLE;
  const first = table[0]!;
  const last = table[table.length - 1]!;
  // A target inside the nearest measured point is at least as reachable as that point.
  // Clamp rather than extrapolate toward 100% — nothing was measured below 0.25×.
  if (k <= first.k) return first.pct;
  if (k >= last.k) return last.pct;
  for (let i = 1; i < table.length; i++) {
    const hi = table[i]!;
    if (k > hi.k) continue;
    // Exact hit on a measured point returns the MEASURED value, not an interpolation of
    // it — otherwise float error turns a published 0.9% into 0.8999999999999999.
    if (k === hi.k) return hi.pct;
    const lo = table[i - 1]!;
    const span = hi.k - lo.k;
    const t = span === 0 ? 0 : (k - lo.k) / span;
    return lo.pct + t * (hi.pct - lo.pct);
  }
  return last.pct;
}

/**
 * Member-facing reachability label for a pinned target multiple, e.g.
 * `"~11%"` or `"<1%"`. Null when the multiple is unusable — the caller must render
 * nothing rather than a fabricated figure.
 */
export function formatReachabilityPct(k: number): string | null {
  const pct = targetReachabilityPct(k);
  if (pct == null) return null;
  if (pct < REACHABILITY_FLOOR_PCT) return `<${REACHABILITY_FLOOR_PCT}%`;
  // One decimal only below 10% — above that the sampling error swamps it.
  return `~${pct < 10 ? Math.round(pct * 10) / 10 : Math.round(pct)}%`;
}

/**
 * The full member-facing sentence for a play card: how far the target sits, and how
 * often comparable setups actually travelled that far in one session.
 * Null when the multiple is unusable.
 */
export function targetReachabilityNote(k: number): string | null {
  const label = formatReachabilityPct(k);
  if (label == null) return null;
  const mult = k < 10 ? Math.round(k * 100) / 100 : Math.round(k);
  return `Target sits ${mult}× ATR14 from the entry edge — comparable setups traded that far within the next session ${label} of the time.`;
}

// ── Pinned-multiple histogram (admin analytics) ─────────────────────────────────────────

/** Bucket edges for the pinned target-ATR-multiple distribution. Chosen to straddle the
 *  two constants that matter: the 1.0× minimum-target floor (deterministic-edition.ts)
 *  and the 3.5× publish-gate bar (publish-gates.ts:69). */
export const TARGET_ATR_HISTOGRAM_EDGES: readonly number[] = [0, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 5.0];

export type TargetAtrHistogramBin = {
  /** Inclusive lower edge. */
  from: number;
  /** Exclusive upper edge; null on the open-ended top bin. */
  to: number | null;
  n: number;
  pct: number | null;
};

/**
 * Bucket pinned target-ATR multiples into the histogram the calibration question needs.
 * Non-finite / negative values are ignored (and are visible as a shortfall against the
 * caller's own row count) — never bucketed into 0.
 */
export function targetAtrHistogram(multiples: readonly (number | null | undefined)[]): TargetAtrHistogramBin[] {
  const usable = multiples.filter(
    (m): m is number => typeof m === "number" && Number.isFinite(m) && m >= 0
  );
  const edges = TARGET_ATR_HISTOGRAM_EDGES;
  const bins: TargetAtrHistogramBin[] = edges.map((from, i) => ({
    from,
    to: i === edges.length - 1 ? null : edges[i + 1]!,
    n: 0,
    pct: null,
  }));
  for (const m of usable) {
    let idx = bins.length - 1;
    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i]!;
      if (bin.to != null && m < bin.to) {
        idx = i;
        break;
      }
    }
    bins[idx]!.n += 1;
  }
  for (const bin of bins) {
    bin.pct = usable.length > 0 ? Math.round((bin.n / usable.length) * 1000) / 10 : null;
  }
  return bins;
}
