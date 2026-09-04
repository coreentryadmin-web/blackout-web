/** Ordinary clock skew — a future `updatedAt` must not read as infinitely fresh. */
export const WS_TIMESTAMP_FUTURE_TOLERANCE_MS = 5_000;

export function wsUpdatedAtAgeMs(updatedAt: number, now = Date.now()): number {
  return Math.max(0, now - updatedAt);
}

/** True when `updatedAt` is within [−futureTolerance, staleMs) of `now`. */
export function isWsUpdatedAtFresh(
  updatedAt: number | null | undefined,
  staleMs: number,
  now = Date.now(),
  futureToleranceMs = WS_TIMESTAMP_FUTURE_TOLERANCE_MS
): boolean {
  if (updatedAt == null || !Number.isFinite(updatedAt) || updatedAt <= 0) return false;
  const ageMs = now - updatedAt;
  return ageMs >= -futureToleranceMs && ageMs < staleMs;
}
