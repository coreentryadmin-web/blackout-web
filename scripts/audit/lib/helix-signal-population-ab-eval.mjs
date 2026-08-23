/**
 * Pure helpers for scripts/audit/helix-signal-population-ab.mjs — the A/B that measures what
 * #2723's population change did to HELIX's two persisted signals.
 *
 * WHY THIS MEASUREMENT EXISTS. #2723 taught `toIso` to read the epoch the index feed sends, and
 * signal eligibility went 1500/5000 -> 5000/5000 in one deploy. `MARKET-OPEN-VALIDATION.md` §5k
 * calls that "the risky half" and asks for before/after FIRING counts, on the stated expectation
 * that the radars will "fire on SPX/SPY for the first time ever" and that "a large jump is the fix
 * working". Measured, the velocity half moves the OTHER WAY, and a reader running §5k as written
 * would read the fix as not deployed. The helpers here are the parts of that measurement that can
 * be tested against fixed inputs; the harness holds the live fetch and the replay loop.
 *
 * ── THREE TRAPS THIS ENCODES, EACH PAID FOR ─────────────────────────────────────────────────────
 *
 * 1. A REPLAY MUST FEED ONLY WHAT HAD PRINTED. Handing a detector the whole session at a past
 *    `nowMs` gives every later print a NEGATIVE age, and a negative age is `<=` every window
 *    bound — so those prints count as maximally recent and the replay reports a spike storm. That
 *    is not hypothetical: the first velocity replay in this lane reported 91 spikes and a 95.4%
 *    cap-binding rate; fed correctly it was 14 and 11.3%, a 7x error, caught only by disbelieving
 *    the magnitude. `printedBy` is that filter. The product's own `signalWindowAgeMs` (#2725) now
 *    refuses future prints too, but a replay must not LEAN on it: a harness whose validity depends
 *    on the guard under test is measuring the guard, not the signal.
 *
 * 2. THE "BEFORE" COHORT IS RECONSTRUCTED BY WRITER, NEVER BY RE-EMPTYING `event_at`. The obvious
 *    way to rebuild the pre-#2723 population is to blank the timestamps the fix recovered. It is
 *    wrong: the old population was not "rows whose `event_at` we choose to hide", it was "rows the
 *    UW flow_alerts channel wrote", and those are identified by `alert_rule`. Blanking a field to
 *    simulate a bug reproduces the bug's SHAPE and not its POPULATION — and this harness imports
 *    `writerGroup` rather than restating either rule.
 *
 * 3. A FALL IN FIRINGS IS A RESULT, NOT A FAILURE. `compareRuns` reports direction explicitly and
 *    always beside the share of the ticker's prints the old cohort could see, because "SPX velocity
 *    fell 13 -> 1" is uninterpretable until you know the old detectors saw 1.3% of SPX. A harness
 *    that assumed "more data -> more signals" would have called the correct result a regression.
 */

/** Prints that had actually reached the tape by `nowMs`. See trap 1. */
export function printedBy(flows, nowMs, eventMsOf) {
  const out = [];
  for (const f of flows ?? []) {
    const ms = eventMsOf(f);
    if (ms != null && Number.isFinite(ms) && ms <= nowMs) out.push(f);
  }
  return out;
}

/**
 * Share of a ticker's prints the OLD detectors could see.
 *
 * Returned as a triple, never a bare percentage: a 1.3% share is the whole explanation for SPX's
 * firing count moving, and a rate without its counts is not a measurement (_COMMON.md #7).
 * `pct` is null on an empty population rather than 0 — no prints is not 0% coverage.
 */
export function visibleShare(allRows, oldRows) {
  const total = (allRows ?? []).length;
  const visible = (oldRows ?? []).length;
  return { total, visible, pct: total > 0 ? Math.round((1000 * visible) / total) / 10 : null };
}

/**
 * How one detector's firing behaviour differs between the two populations.
 *
 * `direction` is one of `rose` / `fell` / `unchanged` and is stated OUTRIGHT rather than left for a
 * reader to infer from two numbers, because the expectation on record (§5k) is "a large jump is the
 * fix working" and the measured velocity answer is a fall. A harness that reports only the pair
 * invites the reader to keep their prior.
 */
export function compareRuns(before, after) {
  const d = after.tickerFirings - before.tickerFirings;
  return {
    before: before.tickerFirings,
    after: after.tickerFirings,
    delta: d,
    direction: d > 0 ? "rose" : d < 0 ? "fell" : "unchanged",
    beforeStepPct: before.steps > 0 ? Math.round((1000 * before.firedSteps) / before.steps) / 10 : null,
    afterStepPct: after.steps > 0 ? Math.round((1000 * after.firedSteps) / after.steps) / 10 : null,
  };
}

/**
 * Does a detector fire on essentially every scan?
 *
 * A signal that is always on carries no information, and this is the shape #2723 produced for
 * split flow on the index names: SPX fired on 67 of 67 replay steps, with legs of $247M call /
 * $187M put against a $500K-per-leg threshold. Reported as SATURATED rather than as a high count,
 * because "SPX split flow: 67" reads like a strong result and means the opposite.
 *
 * `null` below `minSteps` — a verdict off three scans is not a verdict.
 */
export function saturationVerdict(firedSteps, steps, minSteps = 10, threshold = 0.95) {
  if (!Number.isFinite(steps) || steps < minSteps) return null;
  const rate = firedSteps / steps;
  return { rate: Math.round(1000 * rate) / 10, saturated: rate >= threshold };
}
