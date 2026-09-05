// Pure, alias-free desk-staleness helpers for the SPX play engine.
// Mirrors the inline guard used in spx-play-gates.ts so the open-play management
// path can decide whether desk.price is fresh enough to drive price-based exits.
// No imports, no I/O, no @/ alias — directly unit-testable via `npx tsx --test`.

/** Keep in sync with ZERODTE_MARK_FUTURE_TOLERANCE_MS in marks-math.ts. */
const DESK_FUTURE_TOLERANCE_MS = 60_000;

/**
 * Age of the desk snapshot in seconds. Prefers polled_at (the real quote time),
 * falling back to as_of. Returns null when neither timestamp is usable, so callers
 * can decide their own fail policy (we treat null as NOT stale to avoid spuriously
 * freezing management when a timestamp is simply missing).
 *
 * When `staleMaxSec` is provided and the stamp is more than DESK_FUTURE_TOLERANCE_MS
 * in the future (cross-process clock skew), returns staleMaxSec + 1 so isDeskStale()
 * fails closed — same shape as spx-play-gates.ts's entry gate.
 */
export function deskAgeSec(
  polledAt: string | null | undefined,
  asOf: string | null | undefined,
  now: number = Date.now(),
  staleMaxSec?: number
): number | null {
  const stamp = polledAt ?? asOf;
  if (!stamp) return null;
  const t = new Date(stamp).getTime();
  if (!Number.isFinite(t)) return null;
  const ageMs = now - t;
  if (ageMs < -DESK_FUTURE_TOLERANCE_MS) {
    return staleMaxSec != null ? staleMaxSec + 1 : Number.POSITIVE_INFINITY;
  }
  return ageMs / 1000;
}

/**
 * True when the desk snapshot is older than maxSec. Unknown age (null) is treated
 * as NOT stale: a missing timestamp must not silently freeze open-play management.
 */
export function isDeskStale(ageSec: number | null, maxSec: number): boolean {
  if (ageSec == null) return false;
  return ageSec > maxSec;
}
