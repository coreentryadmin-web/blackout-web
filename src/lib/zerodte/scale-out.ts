/**
 * SCALE-OUT EXIT — the mechanical banger exit, as production code.
 *
 * WHY (docs/audit/0DTE-RESEARCH.md, market-banger-scan.mjs): a whole-market breakout screen surfaces
 * bangers constantly — 75% of movers' cheap OTM weeklies touch ≥2×, 50% ≥3×, 25% ≥5×. But HELD TO
 * EXPIRY they decay to ~zero (mean ~1.3×). Finding them is trivial; EXITING them is the entire edge.
 * A mechanical scale-out — take a partial at 2×, trail the runner off its peak, hard-stop the rest —
 * returned +47% / +86% / +16% REALIZED EV across the sessions with data (~+50% weighted), where
 * hold-to-expiry made ~nothing. This module is that rule, pure and testable, so a live banger manager
 * (and the backtest) share one exit definition instead of drifting.
 *
 * TWO ENTRY POINTS, ONE RULE:
 *  - gradeScaleOut(bars, entry): batch backtest — realized multiple over a play's forward bars
 *    (parity with the scanner tool). Deterministic given bars.
 *  - deriveScaleOutAction({entry, peak, lastMark, scaledAlready}): live state machine — what to DO at
 *    the current mark for an open runner (HOLD / TAKE_PARTIAL / EXIT_RUNNER / STOP_OUT). Pure; the
 *    caller owns the latched peak + the "already scaled" flag (same split as plan.ts derivePlayStatus).
 *
 * HORIZON NOTE: this is the WEEKLY-banger exit. It is deliberately NOT the 0DTE grinder's exit — the
 * P3 exit study proved trailing/ratchet HURT same-day 0DTE (intraminute chop stops you out before the
 * move completes; the fixed −50/+100 is best there). Do not apply this to the 0DTE board.
 */

/** The scale-out rule. Exported so the backtest can sweep it and the UI can cite the exact numbers. */
export const SCALE_OUT_RULES = {
  /** Take the first tranche when the mark reaches this multiple of entry. */
  scale_at_mult: 2.0,
  /** Fraction of the position realized at the 2× tranche. */
  scale_fraction: 0.5,
  /** After scaling, the runner exits if the mark retraces to this fraction of its peak. */
  trail_from_peak: 0.5,
  /** Before any tranche is taken, exit everything if the mark falls to this multiple of entry (−60%). */
  hard_stop_mult: 0.4,
} as const;

/** Human-readable exit guidance for a banger/breakout play — the scale-out rule in one sentence, for
 *  a play's risk_note. Numbers come straight from SCALE_OUT_RULES so the copy never drifts. */
export function bangerScaleOutNote(): string {
  const { scale_at_mult, scale_fraction, trail_from_peak, hard_stop_mult } = SCALE_OUT_RULES;
  return (
    `Banger exit — scale out, don't hold to expiry: realize ${(scale_fraction * 100).toFixed(0)}% at ` +
    `${scale_at_mult}×, trail the runner at ${(trail_from_peak * 100).toFixed(0)}% of its peak, hard stop ` +
    `−${((1 - hard_stop_mult) * 100).toFixed(0)}%. These cheap OTM weeklies spike then decay — the exit is the edge.`
  );
}

export type ScaleOutAction = "HOLD" | "TAKE_PARTIAL" | "EXIT_RUNNER" | "STOP_OUT";

export type ScaleOutBar = { t: number; h: number; l: number; c: number };

/**
 * Batch grade: realized multiple (× entry) walking a play's forward bars under the scale-out rule.
 * Conservative intrabar ordering — a hard-stop touch is checked before a 2× touch in the same bar.
 * Bars must be entry-onward; unsorted is fine (sorted here). Returns 1.0 (breakeven) for no bars.
 */
export function gradeScaleOut(bars: ScaleOutBar[], entryPremium: number): number {
  if (!(entryPremium > 0)) return 1;
  const { scale_at_mult, scale_fraction, trail_from_peak, hard_stop_mult } = SCALE_OUT_RULES;
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  let peak = entryPremium;
  let scaled = false;
  let realized = 0; // absolute premium realized (per 1 contract's worth of entry premium)
  let remaining = 1;
  for (const b of sorted) {
    // Was the partial already taken BEFORE this bar? The runner's trailing stop only governs from
    // the bar AFTER the scale — the low that enabled a 2× high almost always preceded it intrabar,
    // so exiting the runner on the scale bar's own low would be a phantom fill.
    const wasScaledBefore = scaled;
    // The trail level must derive from a peak that ALREADY PRINTED — capture the running peak
    // BEFORE folding in this bar's own high, and only update `peak` AFTER the trailing-stop test.
    // Otherwise a single bar's high raises the peak and its own low is then measured against that
    // same-bar peak (intrabar look-ahead — clairvoyance, and the grade runs on DAILY bars in prod
    // so the "same bar" is a whole session). A retrace can only be measured against a prior high;
    // this mirrors the `wasScaledBefore` discipline already applied to the scale bar itself.
    const prevPeak = peak;
    if (!scaled && b.l <= entryPremium * hard_stop_mult) {
      realized += remaining * entryPremium * hard_stop_mult;
      remaining = 0;
      break;
    }
    if (!scaled && b.h >= entryPremium * scale_at_mult) {
      realized += scale_fraction * entryPremium * scale_at_mult;
      remaining -= scale_fraction;
      scaled = true;
    }
    if (wasScaledBefore && b.l <= prevPeak * trail_from_peak) {
      realized += remaining * prevPeak * trail_from_peak;
      remaining = 0;
      break;
    }
    peak = Math.max(peak, b.h);
  }
  if (remaining > 0) realized += remaining * (sorted.at(-1)?.c ?? entryPremium);
  return realized / entryPremium;
}

/**
 * Live state machine: the action to take at the current mark for an OPEN banger. The caller latches
 * the peak (highest mark since entry) and whether the 2× partial was already taken — this is a pure
 * decision over those, never IO.
 *  - STOP_OUT   : not yet scaled and the mark hit the −60% hard stop → exit everything.
 *  - TAKE_PARTIAL: not yet scaled and the mark reached 2× → sell scale_fraction, keep the runner.
 *  - EXIT_RUNNER: already scaled and the mark retraced to 50% of the peak → close the runner.
 *  - HOLD       : none of the above.
 */
export type ScaleOutTriggerInfo = {
  /** Short label for the next mechanical event this position is walking toward. */
  next_trigger_label: string;
  /** Premium level ($) at which that event fires, or null if there's no usable mark/entry. */
  next_trigger_price: number | null;
  /** Signed % move from the current mark to next_trigger_price (positive = mark must rise). */
  pct_to_next_trigger: number | null;
  /** Hard-stop premium level, shown as a floor reference; null once scaled (the hard stop no longer applies). */
  hard_stop_price: number | null;
};

/**
 * Live "how far to the next trigger" readout for the Bangers detail panel — turns the static
 * scale_out_reason string into an actual price target a member can watch for. Pure function over
 * the same inputs as deriveScaleOutAction (SCALE_OUT_RULES is the single source for both), so the
 * detail panel can never drift from the state machine that actually manages the position.
 *  - Pre-scale: next event is the 2× partial (upside) with the hard stop shown as the downside floor.
 *  - Post-scale: the hard stop no longer applies (partial already locked); the next event is the
 *    runner's trailing stop off its peak.
 */
export function computeScaleOutTriggerInfo(input: {
  entryPremium: number;
  peakPremium: number;
  lastMark: number | null;
  scaledAlready: boolean;
}): ScaleOutTriggerInfo {
  const { entryPremium, peakPremium, lastMark, scaledAlready } = input;
  const { scale_at_mult, trail_from_peak, hard_stop_mult } = SCALE_OUT_RULES;
  const noMark = !(entryPremium > 0) || lastMark == null || !Number.isFinite(lastMark);

  if (!scaledAlready) {
    const triggerPrice = entryPremium > 0 ? entryPremium * scale_at_mult : null;
    const hardStop = entryPremium > 0 ? entryPremium * hard_stop_mult : null;
    return {
      next_trigger_label: `${scale_at_mult}× partial`,
      next_trigger_price: triggerPrice,
      pct_to_next_trigger:
        noMark || triggerPrice == null || !(lastMark! > 0) ? null : ((triggerPrice - lastMark!) / lastMark!) * 100,
      hard_stop_price: hardStop,
    };
  }

  // Post-scale: the runner's trailing stop is the only thing left to watch; the hard stop no
  // longer applies (the partial is already locked in).
  const trailPrice = peakPremium > 0 ? peakPremium * trail_from_peak : null;
  return {
    next_trigger_label: "runner trailing stop",
    next_trigger_price: trailPrice,
    pct_to_next_trigger:
      noMark || trailPrice == null || !(lastMark! > 0) ? null : ((trailPrice - lastMark!) / lastMark!) * 100,
    hard_stop_price: null,
  };
}

export function deriveScaleOutAction(input: {
  entryPremium: number;
  peakPremium: number;
  lastMark: number;
  scaledAlready: boolean;
}): { action: ScaleOutAction; reason: string } {
  const { entryPremium, peakPremium, lastMark, scaledAlready } = input;
  const { scale_at_mult, scale_fraction, trail_from_peak, hard_stop_mult } = SCALE_OUT_RULES;
  if (!(entryPremium > 0) || !Number.isFinite(lastMark)) {
    return { action: "HOLD", reason: "no usable entry/mark" };
  }
  if (!scaledAlready) {
    if (lastMark <= entryPremium * hard_stop_mult) {
      return { action: "STOP_OUT", reason: `mark ≤ ${(hard_stop_mult).toFixed(2)}× entry (hard stop −${((1 - hard_stop_mult) * 100).toFixed(0)}%)` };
    }
    if (lastMark >= entryPremium * scale_at_mult) {
      return { action: "TAKE_PARTIAL", reason: `mark ≥ ${scale_at_mult}× entry — realize ${(scale_fraction * 100).toFixed(0)}%, trail the runner` };
    }
    return { action: "HOLD", reason: "below the 2× partial and above the hard stop" };
  }
  // Runner management (partial already taken).
  if (peakPremium > 0 && lastMark <= peakPremium * trail_from_peak) {
    return { action: "EXIT_RUNNER", reason: `runner retraced to ${(trail_from_peak * 100).toFixed(0)}% of peak — close it` };
  }
  return { action: "HOLD", reason: "runner still above its trailing stop" };
}
