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
// Standard RVOL formula: cumulative volume-to-date divided by an EXPECTED-BY-NOW figure. The
// expectation can come from either of two proration methods (see `timeOfDayProfile` below) — both
// scale a trailing average daily volume down to "how much of a normal day should have traded by
// this clock time," which is why proration exists at all: comparing a partial day's volume to a
// full day's average without it would read every morning as "quiet" and every afternoon as "heavy"
// regardless of anything real happening.
//
// TIME-OF-DAY PROFILE (2026-10-19, live correction): the original shipped version (PR #6287) used
// FLAT proration — expected = avgDailyVolume * (elapsed minutes / 390) — which assumes volume trades
// at a constant pace all day. Real intraday volume is heavily U-shaped (the open and close both
// trade far more than the flat/constant-pace assumption would predict, the midday lull far less), so
// flat proration systematically UNDERSTATES the expectation near the open/close (making ordinary
// open/close volume read as falsely "high") and OVERSTATES it at midday (making ordinary midday
// volume read as falsely "low") — exactly the distortion a member flagged by name auditing this
// module before it was ever wired into anything live. `buildTimeOfDayVolumeProfile` below derives a
// REAL per-minute pace curve from a name's own trailing-day minute volumes instead of assuming a
// constant one; `computeRelativeVolume` uses it when supplied and falls back to flat proration
// (byte-identical to the original shipped behavior) when it isn't — e.g. too few historical days on
// record for a newly-listed or thinly-covered name. Both are real, never-fabricated expectations;
// neither is a guess of what SHOULD happen, only a different honest model of the SAME real trailing
// history. Callers wiring this signal in shadow mode should compute BOTH (profile omitted vs
// supplied) and persist both side by side — the "baseline vs candidate" comparison this module's own
// header above describes needing before any live gating decision.

import { etMinutesOf } from "./plan";

const RTH_OPEN_ET_MIN = 9 * 60 + 30;
const RTH_CLOSE_ET_MIN = 16 * 60;
const RTH_SESSION_MINUTES = RTH_CLOSE_ET_MIN - RTH_OPEN_ET_MIN; // 390

/** A real, measured (never fabricated) per-minute cumulative volume-pace curve for one ticker,
 *  built by `buildTimeOfDayVolumeProfile` from that ticker's OWN trailing-day minute volumes —
 *  never a market-wide or assumed shape. */
export type TimeOfDayVolumeProfile = {
  /** cumulativeFractionByMinute[i] = the fraction (0-1) of a full RTH session's volume this name
   *  has TYPICALLY traded by the END of elapsed minute `i` (i=0 is the first minute after the open).
   *  Length RTH_SESSION_MINUTES (390), non-decreasing, last entry ~1 (within real-data noise — never
   *  forced to exactly 1, so the honest trailing average is preserved). */
  cumulativeFractionByMinute: number[];
  /** How many real trailing days actually contributed to this profile — surfaced so a caller/
   *  shadow-log can distinguish a profile built from 3 days vs 60; never hidden inside the curve. */
  days_used: number;
};

/** Minimum real trailing days required before a profile is trusted at all — below this, per-minute
 *  noise in only a couple of real days can produce a wildly unrepresentative curve. Below this
 *  floor, `buildTimeOfDayVolumeProfile` returns null (never a profile built from too little). */
export const RVOL_PROFILE_MIN_DAYS = 5;

/**
 * Pure. `dailyMinuteVolumes` is one array per trailing trading day, each the SAME ticker's own real
 * per-RTH-minute volume (length up to RTH_SESSION_MINUTES; a day with missing/fewer minutes is
 * padded with 0 — a real no-trade minute, not treated as absent). Averages minute-by-minute across
 * all supplied days, takes the cumulative sum, and normalizes by the average day's own total volume
 * (NOT by `avgDailyVolume` — a caller-supplied trailing average computed over a possibly-different
 * window — so the curve's SHAPE is independent of which specific average-volume figure a caller
 * later multiplies it by). Returns null — never a fabricated or degenerate curve — when there are
 * fewer than `RVOL_PROFILE_MIN_DAYS` real days, or the averaged day's total volume is non-positive.
 */
export function buildTimeOfDayVolumeProfile(
  dailyMinuteVolumes: number[][]
): TimeOfDayVolumeProfile | null {
  const realDays = dailyMinuteVolumes.filter(
    (day) => Array.isArray(day) && day.some((v) => Number.isFinite(v) && v > 0)
  );
  if (realDays.length < RVOL_PROFILE_MIN_DAYS) return null;

  const avgByMinute: number[] = new Array(RTH_SESSION_MINUTES).fill(0);
  for (const day of realDays) {
    for (let i = 0; i < RTH_SESSION_MINUTES; i++) {
      const v = day[i];
      avgByMinute[i] += Number.isFinite(v) && v > 0 ? v : 0;
    }
  }
  for (let i = 0; i < RTH_SESSION_MINUTES; i++) avgByMinute[i] /= realDays.length;

  const totalAvgVolume = avgByMinute.reduce((sum, v) => sum + v, 0);
  if (!(totalAvgVolume > 0)) return null;

  const cumulativeFractionByMinute: number[] = new Array(RTH_SESSION_MINUTES);
  let running = 0;
  for (let i = 0; i < RTH_SESSION_MINUTES; i++) {
    running += avgByMinute[i];
    cumulativeFractionByMinute[i] = running / totalAvgVolume;
  }
  return { cumulativeFractionByMinute, days_used: realDays.length };
}

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
  /** cumulativeVolumeToday / (avgDailyVolume * expectedFraction). Null when not computable
   *  (missing inputs, pre-open, or too early in the session — see RVOL_MIN_ELAPSED_MINUTES). */
  ratio: number | null;
  classification: RelativeVolumeClass;
  /** Fraction of the regular session elapsed at `nowMs`, in [0, 1]. Null outside RTH. ALWAYS the
   *  flat elapsed-time fraction regardless of which proration method computed `ratio` — this is a
   *  clock-time fact, not a volume-pace estimate. */
  session_fraction_elapsed: number | null;
  /** Which expectation this ratio was actually computed against. "time_of_day_profile" only when a
   *  valid `timeOfDayProfile` was supplied AND used; "flat_proration" otherwise (no profile supplied,
   *  or an invalid one) — byte-identical to the original shipped behavior in that case. Surfaced so
   *  a caller logging baseline-vs-candidate side by side can tell which row is which without having
   *  to remember whether it passed a profile. */
  expected_fraction_source: "time_of_day_profile" | "flat_proration" | null;
};

function classify(ratio: number | null): RelativeVolumeClass {
  if (ratio == null) return null;
  if (ratio >= RVOL_VERY_HIGH) return "very_high";
  if (ratio >= RVOL_HIGH) return "high";
  if (ratio < RVOL_LOW) return "low";
  return "normal";
}

function isValidProfile(profile: TimeOfDayVolumeProfile | null | undefined): profile is TimeOfDayVolumeProfile {
  return (
    profile != null &&
    Array.isArray(profile.cumulativeFractionByMinute) &&
    profile.cumulativeFractionByMinute.length === RTH_SESSION_MINUTES &&
    profile.cumulativeFractionByMinute.every((v) => Number.isFinite(v) && v >= 0)
  );
}

/**
 * Pure. `cumulativeVolumeToday` is the name's own total RTH volume from the open through `nowMs`
 * (shares, not dollars — matches `avgDailyVolume`'s unit). `avgDailyVolume` is a trailing average
 * full-session daily volume (the caller's choice of window, e.g. 20 trading days) — this function
 * does not fetch or average anything itself. Never guesses: any missing/non-finite/non-positive
 * input, or a `nowMs` outside RTH, returns ratio=null rather than a fabricated number.
 *
 * `timeOfDayProfile` (optional) — when supplied and well-formed (see `isValidProfile`), the expected
 * volume-by-now is `avgDailyVolume * profile.cumulativeFractionByMinute[elapsedMinute]` instead of
 * the flat `avgDailyVolume * sessionFractionElapsed` — a real measured intraday pace instead of an
 * assumed constant one (see this module's header for why that matters most near the open/close).
 * Omitted, null, or malformed → falls back to flat proration, byte-identical to pre-2026-10-19
 * behavior; this function never fails closed over a missing profile.
 */
export function computeRelativeVolume(input: {
  cumulativeVolumeToday: number;
  avgDailyVolume: number;
  nowMs: number;
  timeOfDayProfile?: TimeOfDayVolumeProfile | null;
}): RelativeVolumeRead {
  const { cumulativeVolumeToday, avgDailyVolume, nowMs, timeOfDayProfile } = input;

  const etMin = etMinutesOf(nowMs);
  const insideRth = etMin >= RTH_OPEN_ET_MIN && etMin < RTH_CLOSE_ET_MIN;
  const sessionFractionElapsed = insideRth
    ? Math.min(1, Math.max(0, (etMin - RTH_OPEN_ET_MIN) / RTH_SESSION_MINUTES))
    : null;
  const elapsedMinuteIndex = insideRth ? Math.min(RTH_SESSION_MINUTES - 1, etMin - RTH_OPEN_ET_MIN) : null;

  if (
    sessionFractionElapsed == null ||
    !Number.isFinite(cumulativeVolumeToday) ||
    cumulativeVolumeToday < 0 ||
    !Number.isFinite(avgDailyVolume) ||
    avgDailyVolume <= 0 ||
    etMin - RTH_OPEN_ET_MIN < RVOL_MIN_ELAPSED_MINUTES
  ) {
    return {
      ratio: null,
      classification: null,
      session_fraction_elapsed: sessionFractionElapsed,
      expected_fraction_source: null,
    };
  }

  const profileValid = isValidProfile(timeOfDayProfile);
  const expectedFraction =
    profileValid && elapsedMinuteIndex != null
      ? timeOfDayProfile!.cumulativeFractionByMinute[elapsedMinuteIndex]
      : sessionFractionElapsed;
  const expected = avgDailyVolume * expectedFraction;
  const ratio = expected > 0 ? cumulativeVolumeToday / expected : null;
  return {
    ratio: ratio != null ? Math.round(ratio * 1000) / 1000 : null,
    classification: classify(ratio),
    session_fraction_elapsed: Math.round(sessionFractionElapsed * 10000) / 10000,
    expected_fraction_source: ratio == null ? null : profileValid ? "time_of_day_profile" : "flat_proration",
  };
}
