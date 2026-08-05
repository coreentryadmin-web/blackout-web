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
