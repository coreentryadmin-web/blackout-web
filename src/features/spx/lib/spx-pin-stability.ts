// SPX EOD Pin Forecaster — temporal-stability gate.
//
// BUG (audit, 2026-08-05): buildSpxPinForecast() re-solves a brand-new pin from a single live
// snapshot every poll (SPX_PIN_POLL_MS, default 5s) with no requirement that the pin AGREE across
// consecutive polls before it's surfaced/trusted. A fragmented or fast-rebalancing 0DTE book can
// flip the snapped pin strike poll-to-poll (see spx-pin-forecast-core.ts's own history of exactly
// this failure mode for the dominant magnet — "thin put wall ... yanked projected close ~110pts").
// Every poll pushes a NEW number to the member with no confirmation, which reads as noise/flicker
// and erodes trust in the number — same class of issue as Night Hawk's PIN-wall single-snapshot
// test (docs/audit/INTENTIONAL-DESIGN.md item #3), but this is the SPX desk's independent
// EOD-pin codepath, not the Night Hawk discovery lane.
//
// Fix shape: track a short rolling window of the last N raw (snapped) pin computations. The pin is
// only "confirmed" (safe to surface as THE pin) once the last N agree within a tolerance (~one
// strike). Once confirmed, the confirmed value is held steady until a NEW cluster of N agreeing
// polls forms — so a single noisy poll can't yank the displayed number, but a genuine regime shift
// still comes through as soon as it re-stabilizes.
//
// Pure + fully unit-testable (no live data, no Date.now, no server import) — see
// spx-pin-stability.test.ts. The stateful rolling-window wrapper lives in spx-pin.ts (module-level,
// per-process — mirrors the pattern already used by src/lib/server-cache.ts's in-memory `store`).

/** How many consecutive polls must agree before a pin is trusted. */
export const PIN_STABILITY_WINDOW = 3;

/** Max spread (index points) allowed across the window's samples to count as "agreeing". Roughly
 *  one SPX 0DTE strike (5pt spacing) — real pins sit ON a strike, so anything wider than a strike's
 *  width is a genuine disagreement, not just rounding jitter. */
export const PIN_STABILITY_TOLERANCE_PTS = 5;

/** One rolling-window sample: the snapped pin value from one poll (or null when unavailable). */
export type PinStabilitySample = number | null;

/**
 * True when the LAST `window` samples are all non-null and agree within `tolerancePts`
 * (max − min ≤ tolerance). Fewer than `window` samples, or any null in the trailing window
 * (forecast was unavailable that poll), can never be stable — a gap breaks the streak rather
 * than being skipped, since a mid-window "collecting" tick means we don't actually know what
 * the book looked like then.
 */
export function isPinStable(
  samples: readonly PinStabilitySample[],
  tolerancePts: number = PIN_STABILITY_TOLERANCE_PTS,
  window: number = PIN_STABILITY_WINDOW
): boolean {
  if (window < 1 || samples.length < window) return false;
  const trailing = samples.slice(samples.length - window);
  if (trailing.some((s) => s == null || !Number.isFinite(s))) return false;
  const nums = trailing as number[];
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  return hi - lo <= tolerancePts;
}

/**
 * Push a new sample onto a bounded rolling window (pure — returns a new array, does not mutate).
 * A null sample (forecast unavailable / collecting) RESETS the window to just that null entry
 * rather than appending — an unavailable poll means the streak of agreement is broken, not that we
 * should just skip it and keep comparing across the gap.
 */
export function pushPinSample(
  history: readonly PinStabilitySample[],
  sample: PinStabilitySample,
  maxLen: number = PIN_STABILITY_WINDOW
): PinStabilitySample[] {
  if (sample == null || !Number.isFinite(sample)) return [null];
  const next = [...history, sample];
  return next.slice(-Math.max(1, maxLen));
}

/**
 * The pin to SURFACE, given the value currently held and the newest rolling window.
 *
 * THIS IS THE "HELD STEADY" HALF OF THE CONTRACT, AND IT WAS MISSING. This module's header has
 * always promised: *"Once confirmed, the confirmed value is held steady until a NEW cluster of N
 * agreeing polls forms — so a single noisy poll can't yank the displayed number."* The stateful
 * wrapper in `spx-pin.ts` did `if (stable) confirmed = latest`, overwriting the held value with the
 * raw pin on EVERY stable pass. That is not "held steady" — it is "track the raw pin whenever the
 * window happens to agree", which is a different behaviour wearing the same name.
 *
 * Measured live 2026-08-07 (`docs/audit/backlog/2026-08-07-spx-slayer.md`): `pinConfirmed === pin`
 * on **16 of 16** consecutive observations, `pinStable === true` on all 16, while the "confirmed"
 * pin travelled 7721.33 → 7731.15 — **9.8 points in six minutes**, nearly twice the tolerance the
 * gate is calibrated on. The gate surfaced every wiggle it existed to absorb.
 *
 * The rule below is the header's own sentence, as code:
 *   - not stable            → keep whatever is held (a noisy window never moves the number)
 *   - stable, nothing held  → adopt it (first confirmation of the session)
 *   - stable, agrees with held (within tolerance) → KEEP THE HELD VALUE — this is the line that
 *     was missing, and the only one that makes the number steady
 *   - stable, genuinely moved away → adopt the new cluster (a real relocation must come through)
 *
 * Deliberately NOT changed here: the window SIZE. `PIN_STABILITY_WINDOW = 3` at the deployed 2s pin
 * TTL asks "did the pin move more than a strike in ~6 seconds", which is structurally almost always
 * no — that is a calibration question needing out-of-sample evidence, not a bug fix, and it is
 * recorded in `docs/spx/SLAYER-MAP.md` rather than tuned here. This fix is correct at any window
 * size: it stops the held value tracking the raw pin, which is what the header promised.
 */
export function nextConfirmedPin(
  held: number | null,
  samples: readonly PinStabilitySample[],
  tolerancePts: number = PIN_STABILITY_TOLERANCE_PTS,
  window: number = PIN_STABILITY_WINDOW
): number | null {
  if (!isPinStable(samples, tolerancePts, window)) return held;
  const latest = samples[samples.length - 1];
  if (latest == null || !Number.isFinite(latest)) return held;
  if (held == null || !Number.isFinite(held)) return latest;
  // Within tolerance of what is already displayed → the book has not moved, so neither does the
  // number. Beyond it → a genuine relocation, and holding a stale pin would be its own lie.
  return Math.abs(latest - held) <= tolerancePts ? held : latest;
}
