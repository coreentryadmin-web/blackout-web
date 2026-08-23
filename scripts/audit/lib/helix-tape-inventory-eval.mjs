/**
 * Pure helpers for scripts/audit/helix-tape-inventory.mjs — the HELIX tape field-provenance
 * inventory behind docs/audit/HELIX-MAP.md.
 *
 * WHY THESE ARE SPLIT OUT. The harness itself needs live auth and a live tape, so nothing inside
 * it can be unit-tested. The load-bearing part is not the fetch — it is the CLASSIFICATION: which
 * writer produced a row, and what a field's presence/absence actually licenses you to say. Those
 * are pure functions over a row shape, so they are testable against fixed inputs and are kept
 * here, the same split `breakout-cohort-split.mjs` and `grading-agreement-eval.mjs` already use.
 *
 * THE MEASUREMENT THIS EXISTS FOR (live, 2026-08-22, 5000-row/168h member tape). The HELIX tape is
 * written by TWO producers with DIFFERENT payload schemas, and the split is exact — not a
 * distribution, a boundary:
 *
 *   cross-tab event_at x alert_rule -> both 1500 | event_at only 0 | alert_rule only 0 | neither 3500
 *
 *   Group A (1500 rows, 273 tickers): event_at, alert_rule, open_interest, ask_pct,
 *                                     underlying_price, otm_pct — and NO implied_volatility.
 *   Group B (3500 rows, SPX + SPY ONLY): implied_volatility — and NONE of the above.
 *
 * That boundary is why several HELIX numbers cannot be read at face value, and every helper below
 * exists to make one of those readings safe rather than to tidy the harness.
 */

/** The six keys `executionRouteKey` (src/features/helix/lib/helix-flow-format.ts) scans for, in
 *  its own precedence order. Duplicated ONLY as a reference for the multi-match report below —
 *  the harness imports the real function for actual bucketing and never reimplements it. */
export const ROUTE_KEYS = Object.freeze(["SWEEP", "BLOCK", "SPLIT", "CROSS", "FLOOR", "MULTI"]);

/**
 * Which writer produced this row.
 *
 * `event_at` is the discriminator because it is the field whose absence the rest of HELIX already
 * reacts to — but the point of naming the GROUP rather than testing the field at each call site is
 * that "no event_at" is not one fact. It means: this row came from the producer that also sends no
 * alert_rule, no open interest, no ask side, no underlying price and no OTM% — and that IS an
 * SPX-or-SPY row. Reading it as "this particular print happened to lack a timestamp" is the
 * mistake this function exists to prevent.
 */
export function writerGroup(row) {
  if (!row || typeof row !== "object") return "unknown";
  const hasEvent = row.event_at != null && row.event_at !== "";
  const hasRule = row.alert_rule != null && row.alert_rule !== "";
  if (hasEvent && hasRule) return "A";
  if (!hasEvent && !hasRule) return "B";
  // Neither pure A nor pure B. Today this is EMPTY live (0 of 5000), and that is exactly why it
  // must be reported rather than folded into one of the two: the clean split is the finding, so
  // the first row that breaks it is the news.
  return "mixed";
}

/**
 * Every route key a rule string contains, not just the winning one.
 *
 * `executionRouteKey` returns the FIRST key in its fixed list that appears anywhere in the rule,
 * so a rule naming two mechanisms is silently attributed to whichever the list happens to reach
 * first. Live example: `SweepsFollowedByFloor` matches SWEEP and FLOOR, and is filed as SWEEP.
 * Small today (3 rows), but it is a silent precedence decision no one chose, and it can only be
 * seen by listing ALL matches beside the winner.
 */
export function routeKeyMatches(rule) {
  const r = String(rule ?? "").toUpperCase();
  return ROUTE_KEYS.filter((k) => r.includes(k));
}

/**
 * Verdict on `implied_volatility` units for one sample.
 *
 * `fmtIv` renders `iv < 3` as `iv * 100` and anything else verbatim — i.e. it decides
 * fraction-vs-percent PER ROW, from the value itself. That is only safe if the feed is genuinely
 * mixed-unit. Measured live: min 0.07, p25 0.13, median 0.17, p75 0.23, max 106.2 — a single
 * fractional mode with a long right tail, NOT the bimodal shape a mixed-unit feed produces (which
 * would cluster a second lump around 15-30). So the feed is uniformly FRACTIONAL and the branch
 * misreads its own tail: a 3.5 (350% IV, ordinary for a near-dated contract) renders as "4%".
 *
 * Returns the evidence rather than a bare verdict, because the conclusion depends on the SHAPE of
 * the distribution and a caller quoting "4.2% of rows are misrendered" should be able to show why.
 * `verdict` is null — never a guess — below `minSample`.
 */
export function ivUnitVerdict(values, { minSample = 200, branchAt = 3 } = {}) {
  const nums = (values ?? []).filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0)
    .slice().sort((a, b) => a - b);
  const n = nums.length;
  if (n < minSample) {
    return { verdict: null, reason: "insufficient_sample", sample: n, min_sample: minSample };
  }
  const q = (p) => nums[Math.min(n - 1, Math.floor(p * n))];
  const belowBranch = nums.filter((v) => v < branchAt).length;
  const aboveBranch = n - belowBranch;
  const median = q(0.5);
  // A fractional feed sits well under 1 at the median; a percent feed sits in the tens. The tail
  // above the branch is then MISRENDERED, not evidence of a second unit.
  const looksFractional = median < 1;
  return {
    verdict: looksFractional ? "fractional" : "percent_or_mixed",
    sample: n,
    min: nums[0],
    p25: q(0.25),
    median,
    p75: q(0.75),
    max: nums[n - 1],
    below_branch: belowBranch,
    above_branch: aboveBranch,
    /** Rows the `iv < branchAt` heuristic renders on the WRONG side, IF the feed is uniform. */
    misrendered: looksFractional ? aboveBranch : belowBranch,
    misrendered_pct: Math.round((1000 * (looksFractional ? aboveBranch : belowBranch)) / n) / 10,
    branch_at: branchAt,
  };
}

/**
 * Implied contract count for a print: premium = fill_price x 100 x contracts.
 *
 * The honest test of whether a premium is a premium at all. Written after a $1,307,530,000 SPX
 * print read as an obvious units error and turned out to be arithmetically exact
 * (14,000 x 100 x 933.95). A number being astonishing is not evidence that it is wrong, and this
 * is the cheapest check that separates the two. Returns null when fill is missing or non-positive
 * — an unknown denominator must not become a contract count.
 */
export function impliedContracts(row) {
  const fill = Number(row?.fill_price);
  const premium = Number(row?.premium);
  if (!Number.isFinite(fill) || fill <= 0) return null;
  if (!Number.isFinite(premium) || premium <= 0) return null;
  return premium / (fill * 100);
}

/**
 * Can this row EVER fire HELIX's two persisted signals?
 *
 * `detectVelocitySpikes` skips any row without `event_at`; `detectSplitFlow` filters on
 * `flowEventTimeMs`, which returns null for the same rows. So a Group B row is structurally
 * incapable of contributing to either signal — while still counting toward every PREMIUM
 * aggregate (leaderboard, session skew, expiry concentration, route breakdown).
 *
 * Measured consequence: Group B is SPX and SPY only and carries 92.1% of all premium on the tape,
 * so the two names that dominate every premium panel are the two that can never raise a signal.
 * That is not a bug in either detector — each is correctly refusing to date a print it cannot
 * date. It is a property of the tape that nothing currently states.
 */
export function signalEligible(row) {
  return writerGroup(row) === "A";
}

/** Share of a population that is signal-eligible, with the counts that produced it — never a bare
 *  rate. (_COMMON.md #7: a rate without its denominator is not a measurement.) */
export function signalEligibility(rows) {
  const total = (rows ?? []).length;
  const eligible = (rows ?? []).filter(signalEligible).length;
  return {
    total,
    eligible,
    ineligible: total - eligible,
    eligible_pct: total > 0 ? Math.round((1000 * eligible) / total) / 10 : null,
  };
}
