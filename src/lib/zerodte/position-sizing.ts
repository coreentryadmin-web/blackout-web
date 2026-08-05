/**
 * 0DTE POSITION-SIZING FRAMEWORK — fractional-Kelly sizing recommendation, EVIDENCE ONLY.
 *
 * STANDALONE + UNWIRED (by design, this PR). This module is callable but is NOT imported by
 * plan.ts, scan.ts, or any commit/gate/allocation path — no field like `contracts`/`quantity`/
 * `numContracts` exists on any plan/setup type, and this PR does not add one. Every committed
 * play today is implicitly a single unit; that stays true after this PR. Think of this the same
 * way as scripts/audit/condor-wr.mjs: a reproducible evidence tool, just an importable lib
 * function instead of a CLI script, so a future PR can wire real sizing in once there is real
 * graded win/loss-MAGNITUDE data flowing end-to-end to size against safely. See feature-vector.ts
 * (the "Kelly sizing — needs the calibrated probability above" aspirational comment this closes
 * the loop on) and feature-store.ts (the calibrated-base-rate store this is meant to read from).
 *
 * ── The formula (classical/textbook Kelly criterion for a binary win/loss bet) ──────────────
 * For a bet that wins fraction b of the stake on a win and loses the whole stake on a loss
 * (simple win/loss, not the "b to 1" odds notation), with p = P(win) and q = 1 - p = P(loss):
 *
 *   f* = p/L - q/W
 *
 * where W = avgWinPct (fractional gain on a win, e.g. 1.00 for a 0DTE "doubled" +100%) and
 * L = avgLossPct (fractional loss on a loss, e.g. 0.50 for the shipped -50% stop), expressed as
 * POSITIVE magnitudes. This is the standard two-outcome Kelly result: maximize E[log(bankroll)]
 * over the two possible next-period bankroll multipliers (1 + W) with probability p and (1 - L)
 * with probability q. Differentiating p*ln(1+f*W) + q*ln(1-f*L) w.r.t. f and setting to zero
 * gives f* = p/L - q/W directly (see Kelly 1956, "A New Interpretation of Information Rate";
 * Thorp's applied restatement in "The Kelly Capital Growth Investment Criterion" is the more
 * common citation for the two-outcome win/loss form used here). Equivalent common form using
 * "odds" b = W/L: f* = (b*p - q) / b = p - q/b, which is algebraically identical to p/L - q/W
 * once you substitute b = W/L — included here as a comment-only cross-check, not two code paths.
 *
 * Worked textbook example (comment, verify by hand): p = 0.55, W = 1.00 (double), L = 0.50
 * (half-stake stop) — full Kelly f* = 0.55/0.50 - 0.45/1.00 = 1.10 - 0.45 = 0.65 (65% of
 * bankroll). That is an enormous, deliberately aggressive full-Kelly fraction (0DTE options are
 * high-variance, binary-ish bets — full Kelly on them is a bankroll-blowup risk under any real
 * estimation error in p/W/L), which is exactly why this module only ever recommends a FRACTION
 * of f*, never f* itself.
 *
 * ── The conservative fraction ────────────────────────────────────────────────────────────────
 * KELLY_FRACTION = 0.25 (quarter-Kelly). This is a deliberate FIRST-CUT choice, not a fitted
 * constant: quarter-Kelly is the standard practitioner discount for full-Kelly's known fragility
 * to estimation error (Kelly assumes p/W/L are exactly known; here they are themselves noisy
 * calibrated-base-rate ESTIMATES gated by MIN_SAMPLES, so the input itself carries sampling
 * error on top of the well-known full-Kelly volatility problem). Quarter-Kelly trades ~1/16th
 * the variance of full-Kelly for about half its long-run growth rate (variance under
 * fractional Kelly scales with the fraction squared while growth scales roughly linearly near
 * the optimum) — a standard, well-documented risk/growth trade a first-cut sizing tool should
 * default to over the raw optimum. A future PR can move this constant only off its OWN backtest
 * evidence (the same calibration-first bar every other constant in this file's neighborhood
 * uses), never by vibes.
 *
 * ── The graduation gate ──────────────────────────────────────────────────────────────────────
 * Reuses feature-store.ts's MIN_SAMPLES (=20) VERBATIM — the exact "is this calibrated enough to
 * trust" bar the feature store already uses for a win-rate to stop being null. Below it, this
 * function refuses to suggest a real size (graduated:false, suggestedFractionOfBankroll: 0,
 * mirroring the scoreFloorGraduated:false pattern used for the Swing lane elsewhere in this
 * codebase, horizons.ts/swing/taxonomy.ts) — the recommendation can still be COMPUTED and
 * displayed/logged for visibility, but the function's OWN output never asserts a real size off
 * an uncalibrated sample.
 *
 * PURE & deterministic — no IO, no DB, no clock. Not imported anywhere outside its own test file
 * as of this PR.
 */

import { MIN_SAMPLES } from "./feature-store";

/** Quarter-Kelly: recommend 1/4 of the full-Kelly fraction. See the module comment above for the
 *  variance/growth trade-off reasoning. A first cut, not a calibrated fit — a future PR may move
 *  this off backtest evidence, never off vibes. */
export const KELLY_FRACTION = 0.25;

/** Re-exported for callers/tests that want the exact reused threshold without a second import
 *  path — this module deliberately does NOT invent its own sample-size floor. */
export const POSITION_SIZING_MIN_SAMPLES = MIN_SAMPLES;

export interface PositionSizeInput {
  /** Calibrated P(win), 0..1 — expected to come from the feature-store base rates once wired. */
  calibratedWinProb: number;
  /** Average fractional gain on a win, POSITIVE magnitude (e.g. 1.00 for a +100% "doubled"). */
  avgWinPct: number;
  /** Average fractional loss on a loss, POSITIVE magnitude (e.g. 0.50 for a -50% stop). */
  avgLossPct: number;
  /** Graded sample size backing calibratedWinProb/avgWinPct/avgLossPct — gates the output. */
  sampleSize: number;
}

export interface PositionSizeRecommendation {
  /** Whether sampleSize clears POSITION_SIZING_MIN_SAMPLES — mirrors scoreFloorGraduated. */
  graduated: boolean;
  /** The uncapped classical Kelly fraction f* = p/L - q/W. Always computed (for visibility/
   *  logging) even when not graduated or negative — never itself the suggested size. */
  fullKellyFraction: number;
  /** fullKellyFraction * KELLY_FRACTION, with NO other clamping — the "what the math says"
   *  number, always computed for visibility even pre-graduation or when negative. */
  fractionalKellyFraction: number;
  /** The number this function actually recommends acting on: fractionalKellyFraction, clamped
   *  to >= 0 (never suggest sizing into a negative-EV setup), and forced to 0 when !graduated. */
  suggestedFractionOfBankroll: number;
  sampleSize: number;
  minSamples: number;
  reason: string;
}

/**
 * Fractional-Kelly position-size recommendation. Pure function, EVIDENCE-ONLY — see the module
 * header. Never throws: degenerate inputs (avgLossPct/avgWinPct <= 0, out-of-range probabilities)
 * are handled explicitly and always resolve to a safe (graduated:false or size 0) recommendation,
 * never a NaN/Infinity leaking out.
 */
export function recommendPositionSize(input: PositionSizeInput): PositionSizeRecommendation {
  const { calibratedWinProb, avgWinPct, avgLossPct, sampleSize } = input;

  const graduated = Number.isFinite(sampleSize) && sampleSize >= MIN_SAMPLES;

  // Degenerate/invalid inputs: no well-defined edge to size. avgLossPct/avgWinPct must be a
  // strictly positive magnitude (a 0 or negative "loss"/"win" percentage isn't a real payoff to
  // divide by) and calibratedWinProb must be a finite probability in [0, 1]. Any violation is
  // reported honestly (fullKellyFraction 0, never sized) rather than producing Infinity/NaN.
  const validPayoffs = Number.isFinite(avgWinPct) && avgWinPct > 0 && Number.isFinite(avgLossPct) && avgLossPct > 0;
  const validProb = Number.isFinite(calibratedWinProb) && calibratedWinProb >= 0 && calibratedWinProb <= 1;

  if (!validPayoffs || !validProb) {
    return {
      graduated: false,
      fullKellyFraction: 0,
      fractionalKellyFraction: 0,
      suggestedFractionOfBankroll: 0,
      sampleSize,
      minSamples: MIN_SAMPLES,
      reason: !validProb
        ? `calibratedWinProb=${calibratedWinProb} is not a finite probability in [0, 1] — cannot size.`
        : `avgWinPct=${avgWinPct} / avgLossPct=${avgLossPct} must both be positive magnitudes — cannot size.`,
    };
  }

  const p = calibratedWinProb;
  const q = 1 - p;
  // Classical two-outcome Kelly: f* = p/L - q/W (see module header for the derivation + the
  // equivalent b = W/L cross-check form).
  const fullKellyFraction = p / avgLossPct - q / avgWinPct;
  const fractionalKellyFraction = fullKellyFraction * KELLY_FRACTION;
  // Never suggest sizing into a negative-EV setup — clamp the ACTED-ON number to >= 0, but keep
  // the raw fractionalKellyFraction visible above for diagnostics (a negative number there is
  // itself useful evidence that this setup's edge, as currently estimated, is negative).
  const clamped = Math.max(0, fractionalKellyFraction);
  const suggestedFractionOfBankroll = graduated ? clamped : 0;

  const reason = !graduated
    ? `sampleSize=${sampleSize} is below MIN_SAMPLES=${MIN_SAMPLES} (feature-store.ts's calibration-` +
      `enough-to-trust bar) — computed for visibility only; refusing to suggest a real size off an ` +
      `uncalibrated sample.`
    : fullKellyFraction <= 0
      ? `Kelly fraction is ${fullKellyFraction.toFixed(4)} (<= 0) at p=${p}, avgWinPct=${avgWinPct}, ` +
        `avgLossPct=${avgLossPct} — this is a negative-EV setup as currently estimated; suggested size ` +
        `clamped to 0, never a negative allocation.`
      : `graduated at n=${sampleSize} (>= ${MIN_SAMPLES}); full Kelly f*=${fullKellyFraction.toFixed(4)}, ` +
        `quarter-Kelly (${KELLY_FRACTION}x) suggests ${suggestedFractionOfBankroll.toFixed(4)} of bankroll.`;

  return {
    graduated,
    fullKellyFraction,
    fractionalKellyFraction,
    suggestedFractionOfBankroll,
    sampleSize,
    minSamples: MIN_SAMPLES,
    reason,
  };
}
