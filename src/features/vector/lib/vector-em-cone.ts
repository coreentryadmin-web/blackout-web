/**
 * TIME-CONVERGING EXPECTED-MOVE CONE — the "remaining intraday move" geometry (a follow-up to the
 * flat ±1σ/2σ price-lines in `applyExpectedMoveBand`).
 *
 * The flat band draws the CURRENT ±1σ/2σ range as horizontal lines: the chain's expected move to the
 * front expiry, honest for "where could price be by the close" but static — it says nothing about
 * how that budget SHRINKS as the session burns down. This helper turns it into that decaying cone:
 * wide at "now", converging to the spot at 16:00.
 *
 * Critical: `H1` (the σ=1 half-width from `computeExpectedMove`) is ALREADY the remaining move to
 * expiry — `spot·σ·√(t_to_expiry)` — so it equals the CURRENT expected move at `now`, not a
 * whole-session budget anchored at the open. The cone must therefore START at exactly `H1` at `now`
 * (matching the flat band a member sees) and decay from THERE to 0 at the close. Anchoring the √time
 * decay at the session OPEN instead would double-count the decay already baked into H1 (the cone
 * would start strictly inside the flat band and the gap would grow all day) — the bug this file was
 * corrected for. So the scale runs off the `now → close` window, not `open → close`:
 *     scale(τ) = √( clamp( (closeMin - τ) / (closeMin - nowMin), 0, 1 ) )   for τ ∈ [now, close]
 *     halfWidthAt(τ) = H1 · scale(τ)        (and 2·that for the σ=2 edge, via H2)
 * At τ=now scale=1 → half-width = H1 (matches the flat band); at τ=close scale=0 → 0 (funnels to
 * spot). The √ is the Black-Scholes lognormal-diffusion time scaling (move ∝ √time).
 *
 * Honesty (per repo policy): this NEVER fabricates a cone. A non-finite input, a non-positive
 * half-width, a degenerate session window, or a clock outside RTH (`nowEtMin < openEtMin` or
 * `nowEtMin >= closeEtMin` — the move budget is spent) returns `null`, so the caller draws nothing.
 * Pure and `Date`-free (the caller supplies `nowEtMin`) so it is fully unit-testable.
 */

import type { ExpectedMove } from "./vector-expected-move";

/** RTH bounds as ET minutes-of-day: 9:30 = 570, 16:00 = 960. */
export const RTH_OPEN_ET_MIN = 9 * 60 + 30; // 570
export const RTH_CLOSE_ET_MIN = 16 * 60; // 960

/** One sampled cross-section of the cone at ET minute `etMin`. */
export type EmConeSample = {
  etMin: number;
  /** ±1σ edges of the move STILL ahead from now: spot ± H1·scale(etMin). */
  upper1: number;
  lower1: number;
  /** ±2σ edges: spot ± H2·scale(etMin). */
  upper2: number;
  lower2: number;
};

export type EmConeInput = {
  /** Anchor price the cone funnels toward at the close (the current spot). */
  spot: number;
  /** CURRENT ±1σ half-width `H1` (the chain's remaining-move-to-expiry at `now`, = the flat band). */
  sigma1HalfWidth: number;
  /** CURRENT ±2σ half-width `H2` (≈ 2·H1). */
  sigma2HalfWidth: number;
  /** "Now" as an ET minute-of-day (derived from the latest bar time by the caller). */
  nowEtMin: number;
  /** RTH open minute; defaults to 9:30 ET. Used ONLY as the "must be > open to draw" guard — the
   *  decay is anchored at `now`, not the open (see the module header). */
  openEtMin?: number;
  /** RTH close minute; defaults to 16:00 ET. */
  closeEtMin?: number;
  /** How many sample cross-sections to emit (>= 2, endpoints inclusive). */
  steps?: number;
};

/**
 * Fraction of the `[fromMin, toMin]` window still AHEAD at minute `t`, clamped to [0, 1]. The cone
 * calls this with `fromMin = nowEtMin` (NOT the session open) so the √time decay is anchored at now:
 * `remainingFrac(now, now, close) = 1` (widest = H1) and `remainingFrac(close, now, close) = 0`.
 */
export function remainingFrac(t: number, fromMin: number, toMin: number): number {
  const span = toMin - fromMin;
  if (!(span > 0)) return 0;
  const frac = (toMin - t) / span;
  return Math.min(1, Math.max(0, frac));
}

const DEFAULT_STEPS = 32;

/**
 * Build the cone samples from "now" to the close, or `null` when there is nothing honest to draw.
 * `null` on: any non-finite input, a non-positive half-width, a degenerate session window, or a
 * clock outside RTH (pre-open or at/after the close — the remaining-move budget is spent).
 */
export function emConeGeometry(input: EmConeInput): EmConeSample[] | null {
  const {
    spot,
    sigma1HalfWidth,
    sigma2HalfWidth,
    nowEtMin,
    openEtMin = RTH_OPEN_ET_MIN,
    closeEtMin = RTH_CLOSE_ET_MIN,
    steps = DEFAULT_STEPS,
  } = input;

  // Every numeric input must be real; the half-widths must be positive (a zero-width band is not a
  // cone). A non-positive session window is degenerate.
  if (
    !Number.isFinite(spot) ||
    !Number.isFinite(sigma1HalfWidth) ||
    !Number.isFinite(sigma2HalfWidth) ||
    !Number.isFinite(nowEtMin) ||
    !Number.isFinite(openEtMin) ||
    !Number.isFinite(closeEtMin)
  ) {
    return null;
  }
  if (!(sigma1HalfWidth > 0) || !(sigma2HalfWidth > 0)) return null;
  if (!(closeEtMin > openEtMin)) return null;

  // Only RTH has a remaining-move budget: pre-open there is no "now" anchor on the tape, and at/after
  // the close the whole budget is spent (half-width → 0). Both draw nothing rather than a flat cone.
  if (nowEtMin < openEtMin || nowEtMin >= closeEtMin) return null;

  const n = Number.isFinite(steps) && steps >= 2 ? Math.floor(steps) : DEFAULT_STEPS;
  const samples: EmConeSample[] = [];
  for (let i = 0; i < n; i++) {
    // Linear ET-minute march from now → close (endpoints inclusive), widest first.
    const etMin = nowEtMin + ((closeEtMin - nowEtMin) * i) / (n - 1);
    // Decay anchored at NOW (denominator close−now), so the leftmost sample keeps the full H1 that
    // already equals the current flat band, and it funnels to 0 at the close — NOT re-decayed off the
    // session open (which would start the cone inside the flat band; see the module header).
    const scale = Math.sqrt(remainingFrac(etMin, nowEtMin, closeEtMin));
    const h1 = sigma1HalfWidth * scale;
    const h2 = sigma2HalfWidth * scale;
    samples.push({
      etMin,
      upper1: spot + h1,
      lower1: spot - h1,
      upper2: spot + h2,
      lower2: spot - h2,
    });
  }
  return samples;
}

/**
 * Convenience: derive the cone directly from a chain-sourced {@link ExpectedMove} + a live spot.
 * `H1`/`H2` are the σ=1 / σ=2 band half-widths (`movePts`); if the σ=2 band is absent it falls back
 * to `2·H1` (the linear-in-σ relationship). Returns `null` on the same honest-absence conditions as
 * {@link emConeGeometry}, plus a missing/degenerate band or spot.
 */
export function emConeFromExpectedMove(
  em: ExpectedMove | null,
  spot: number | null,
  nowEtMin: number,
  opts?: { openEtMin?: number; closeEtMin?: number; steps?: number }
): EmConeSample[] | null {
  if (!em || em.bands.length === 0) return null;
  const s = spot != null && Number.isFinite(spot) && spot > 0 ? spot : em.spot;
  const band1 = em.bands.find((b) => b.sigma === 1);
  const h1 = band1?.movePts;
  if (h1 == null || !(h1 > 0)) return null;
  const band2 = em.bands.find((b) => b.sigma === 2);
  const h2 = band2?.movePts ?? h1 * 2;
  return emConeGeometry({
    spot: s,
    sigma1HalfWidth: h1,
    sigma2HalfWidth: h2,
    nowEtMin,
    openEtMin: opts?.openEtMin,
    closeEtMin: opts?.closeEtMin,
    steps: opts?.steps,
  });
}
