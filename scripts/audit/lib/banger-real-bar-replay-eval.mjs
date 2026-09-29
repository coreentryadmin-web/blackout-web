/**
 * PARAMETERIZED REAL-BAR SCALE-OUT REPLAY (operator directive 2026-09-27, adversarial validation
 * of the 100%/33%/70% candidate). A COPY, not an import, of production's own
 * `gradeScaleOut` (src/lib/zerodte/scale-out.ts) — same intrabar-ordering discipline, same
 * conservative "hard-stop-before-partial-in-the-same-bar" rule, same "trail measured against a
 * peak that already printed, never the same bar's own high" rule — generalized to accept
 * `scale_at_mult` / `scale_fraction` / `trail_from_peak` as parameters instead of the fixed
 * SCALE_OUT_RULES constant. `hard_stop_mult` stays fixed at production's real 0.4 (−60%) always,
 * per the operator's explicit instruction to keep the hard stop unchanged. Validated against
 * production's own test fixtures (scale-out.test.ts) at the default 2.0/0.5/0.5 parameters before
 * being trusted for anything else — see this module's own test file.
 *
 * WHY THIS EXISTS: every other tool in this line of work (banger-exit-headtohead-eval.mjs,
 * banger-exit-trail-grid-eval.mjs) reconstructs candidate outcomes from SUMMARY fields only
 * (entry/peak/final-outcome), under a disclosed single-monotonic-decline assumption. That
 * assumption has a real, specific failure mode for a TIGHTER trail (60-70%, closer to peak) than
 * production's real 50%: if a position's real price path had MULTIPLE separate peak-then-retrace
 * cycles before production's own (looser, 50%) trail finally closed it, the reconstruction credits
 * the tighter hypothetical with the FINAL, highest recorded peak — even though a genuinely tighter,
 * faster-firing trail would have exited MUCH EARLIER, at an EARLIER (possibly much lower) peak,
 * and could never have observed or benefited from a later, higher one. This is not testable from
 * summary fields alone (Banger keeps no per-tick history) — it requires replaying the REAL
 * historical price path. This module does that, using real Polygon daily option bars (the same
 * granularity production's own gradeScaleOut is designed for — its own header says so), for BOTH
 * the control (100/50/50) and the candidate (100/33/70) against the IDENTICAL real bars per
 * contract. Where this and the summary-tier reconstruction agree, the reconstruction is
 * vindicated; where they disagree, THIS is the ground truth.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

export const HARD_STOP_MULT = 0.4; // fixed, per operator instruction -- never varied here.

/** @typedef {{t:number,h:number,l:number,c:number}} ReplayBar */

/**
 * Mirrors production's gradeScaleOut exactly at rules={scale_at_mult:2,scale_fraction:0.5,
 * trail_from_peak:0.5,hard_stop_mult:0.4} -- verified against scale-out.test.ts's own fixtures.
 * Returns richer detail than the production function (which returns only the realized multiple)
 * because this adversarial validation needs to know WHICH rung fired and at what peak, not just
 * the final number.
 *
 * OPTIONAL SLIPPAGE (`rules.slippagePctOfPremium`, default 0): a disclosed, adversarial "realistic
 * fills" haircut -- every SELL-side fill (hard stop, scale-out partial, trail-stop close, and the
 * final mark-to-close if the position is never triggered) is filled `slippagePctOfPremium` WORSE
 * than the model price at that instant (i.e. the exit price is multiplied by (1 - slippage), never
 * improved). Applied IDENTICALLY to control and candidate so the comparison stays apples-to-apples;
 * it changes the ABSOLUTE level of both, not which one wins by construction. Default 0 preserves
 * every existing PARITY assertion against production's own fixtures untouched.
 */
export function replayScaleOut(bars, entryPremium, rules) {
  const { scale_at_mult, scale_fraction, trail_from_peak, slippagePctOfPremium = 0 } = rules;
  const hard_stop_mult = HARD_STOP_MULT;
  const fill = (px) => px * (1 - slippagePctOfPremium);
  if (!(entryPremium > 0) || !Array.isArray(bars) || bars.length === 0) {
    return { realizedMultiple: 1, exitCause: "no_data", scaled: false, peakAtExit: entryPremium, exitDayIndex: null };
  }
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  let peak = entryPremium;
  let scaled = false;
  let realized = 0;
  let remaining = 1;
  let scaleMark = null;

  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    const wasScaledBefore = scaled;
    const prevPeak = peak;

    if (!scaled && b.l <= entryPremium * hard_stop_mult) {
      realized += remaining * fill(entryPremium * hard_stop_mult);
      remaining = 0;
      return { realizedMultiple: realized / entryPremium, exitCause: "hard_stop", scaled: false, peakAtExit: prevPeak, exitDayIndex: i };
    }
    if (!scaled && b.h >= entryPremium * scale_at_mult) {
      scaleMark = entryPremium * scale_at_mult;
      realized += scale_fraction * fill(scaleMark);
      remaining -= scale_fraction;
      scaled = true;
    }
    if (wasScaledBefore && b.l <= prevPeak * trail_from_peak) {
      realized += remaining * fill(prevPeak * trail_from_peak);
      remaining = 0;
      return { realizedMultiple: realized / entryPremium, exitCause: "trail_stop", scaled: true, peakAtExit: prevPeak, exitDayIndex: i, scaleMark };
    }
    peak = Math.max(peak, b.h);
  }
  if (remaining > 0) realized += remaining * fill(sorted.at(-1)?.c ?? entryPremium);
  return {
    realizedMultiple: realized / entryPremium,
    exitCause: scaled ? "series_end_after_scale" : "series_end_never_triggered",
    scaled,
    peakAtExit: peak,
    exitDayIndex: sorted.length - 1,
    scaleMark,
  };
}

function finite(x) {
  return typeof x === "number" && Number.isFinite(x);
}
const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

/** Runs both configs against the SAME real bars for one position and returns a paired result. */
export function replayPair(bars, entryPremium, controlRules, candidateRules) {
  const control = replayScaleOut(bars, entryPremium, controlRules);
  const candidate = replayScaleOut(bars, entryPremium, candidateRules);
  const controlPct = round2((control.realizedMultiple - 1) * 100);
  const candidatePct = round2((candidate.realizedMultiple - 1) * 100);
  return {
    control: { ...control, realizedPnlPct: controlPct },
    candidate: { ...candidate, realizedPnlPct: candidatePct },
    delta: finite(controlPct) && finite(candidatePct) ? round2(candidatePct - controlPct) : null,
  };
}
