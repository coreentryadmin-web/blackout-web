// SHADOW-ONLY signal — relative volume (RVOL), time-of-day-aware.
//
// WHY THIS EXISTS: a gap named in the 2026-10-19 missed-opportunity audit (user request, chat
// session) — the live 0DTE discovery engines (FLOW: options-premium-driven; BREAKOUT: whole-market
// gain/volume/close-strength screen) have no signal that answers "is THIS NAME trading unusually
// heavy FOR ITSELF, right now" — a stock's own volume compared to its own normal pace, not to the
// rest of the market. That is a distinct, real signal from BREAKOUT's absolute $-volume screen.
//
// WHY THIS IS STANDALONE AND UNWIRED (deliberately): this module is imported by NOTHING in the live
// board/scan/cortex/commit path, and imports NOTHING from it. It is pure, fully tested, and
// observationally dead code until a future PR explicitly wires it in. This is intentional: the live
// 0DTE engine is a real-money commit path (the same CLAUDE.md "ambiguous/live-trading-path → report
// with evidence, hold" discipline every other finding in this repo's audit lineage follows), and a
// brand-new signal's thresholds (see RVOL_* constants below) are not yet calibrated against any real
// outcome data. Wiring this into live scoring/gating before that calibration exists would be
// shipping an unvalidated change straight into a system that commits real capital. The intended path
// (not yet built — see the companion staged finding):
//   1. Attach the computed read, UNCONDITIONALLY NON-GATING, onto entry_context as an additive
//      `shadow_signals.relative_volume` field on every scanned setup (committed or not) — the exact
//      same idiom this file's own `entry_context.thesis_first`/`why_now` already use for diagnostic-
//      only fields that never touch score or gates.
//   2. Let it accumulate real sessions of paired (reading, eventual outcome) data, observable
//      through the existing `/board` and `/record` APIs this repo's own audit tooling already reads.
//   3. Only once a real sample justifies it, open a SEPARATE, explicitly-reviewed PR to register it
//      as an actual cortex source (compose.ts's SOURCE_SUPPORT_CAPS) or discovery gate input — a
//      decision this file does not make and should not make unilaterally.
//
// Standard RVOL formula: cumulative volume-to-date divided by a PRORATED expectation (trailing
// average daily volume scaled by the fraction of the regular session elapsed) — comparing a partial
// day's volume to a full day's average without prorating would read every morning as "quiet" and
// every afternoon as "heavy" regardless of anything real happening.

import { etMinutesOf } from "./plan";

const RTH_OPEN_ET_MIN = 9 * 60 + 30;
const RTH_CLOSE_ET_MIN = 16 * 60;
const RTH_SESSION_MINUTES = RTH_CLOSE_ET_MIN - RTH_OPEN_ET_MIN; // 390

/** Below this many elapsed RTH minutes, the prorated expectation is too close to zero for the
 *  ratio to mean anything (a single print in the first minute would read as "infinite" RVOL). */
export const RVOL_MIN_ELAPSED_MINUTES = 3;

/** Classification thresholds — INITIAL, UNCALIBRATED. Named constants (not inlined) specifically so
 *  the shadow-mode calibration pass in the PR above this comment describes can retune them against
 *  real paired-outcome data without touching the formula. Starting points chosen as the common
 *  convention several retail scanning tools use (>=2x = "very high", >=1.5x = "high"), not derived
 *  from this codebase's own data — that derivation is exactly what shadow mode exists to produce. */
export const RVOL_VERY_HIGH = 2.0;
export const RVOL_HIGH = 1.5;
export const RVOL_LOW = 0.5;

export type RelativeVolumeClass = "very_high" | "high" | "normal" | "low" | null;

export type RelativeVolumeRead = {
  /** cumulativeVolumeToday / (avgDailyVolume * sessionFractionElapsed). Null when not computable
   *  (missing inputs, pre-open, or too early in the session — see RVOL_MIN_ELAPSED_MINUTES). */
  ratio: number | null;
  classification: RelativeVolumeClass;
  /** Fraction of the regular session elapsed at `nowMs`, in [0, 1]. Null outside RTH. */
  session_fraction_elapsed: number | null;
};

function classify(ratio: number | null): RelativeVolumeClass {
  if (ratio == null) return null;
  if (ratio >= RVOL_VERY_HIGH) return "very_high";
  if (ratio >= RVOL_HIGH) return "high";
  if (ratio < RVOL_LOW) return "low";
  return "normal";
}

/**
 * Pure. `cumulativeVolumeToday` is the name's own total RTH volume from the open through `nowMs`
 * (shares, not dollars — matches `avgDailyVolume`'s unit). `avgDailyVolume` is a trailing average
 * full-session daily volume (the caller's choice of window, e.g. 20 trading days) — this function
 * does not fetch or average anything itself. Never guesses: any missing/non-finite/non-positive
 * input, or a `nowMs` outside RTH, returns ratio=null rather than a fabricated number.
 */
export function computeRelativeVolume(input: {
  cumulativeVolumeToday: number;
  avgDailyVolume: number;
  nowMs: number;
}): RelativeVolumeRead {
  const { cumulativeVolumeToday, avgDailyVolume, nowMs } = input;

  const etMin = etMinutesOf(nowMs);
  const insideRth = etMin >= RTH_OPEN_ET_MIN && etMin < RTH_CLOSE_ET_MIN;
  const sessionFractionElapsed = insideRth
    ? Math.min(1, Math.max(0, (etMin - RTH_OPEN_ET_MIN) / RTH_SESSION_MINUTES))
    : null;

  if (
    sessionFractionElapsed == null ||
    !Number.isFinite(cumulativeVolumeToday) ||
    cumulativeVolumeToday < 0 ||
    !Number.isFinite(avgDailyVolume) ||
    avgDailyVolume <= 0 ||
    etMin - RTH_OPEN_ET_MIN < RVOL_MIN_ELAPSED_MINUTES
  ) {
    return { ratio: null, classification: null, session_fraction_elapsed: sessionFractionElapsed };
  }

  const expected = avgDailyVolume * sessionFractionElapsed;
  const ratio = expected > 0 ? cumulativeVolumeToday / expected : null;
  return {
    ratio: ratio != null ? Math.round(ratio * 1000) / 1000 : null,
    classification: classify(ratio),
    session_fraction_elapsed: Math.round(sessionFractionElapsed * 10000) / 10000,
  };
}
